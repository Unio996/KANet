// 04_transfer_b_to_c.mjs — round-trip proof: Bob(pubkey-owned, received via transfer in 02) spends
// his KTT onward to Carol. Proves the continuation-bound output from 02 is genuinely re-spendable,
// not a one-shot artifact.
import { readFileSync } from 'node:fs';
import { kaspa, computeKttV2TokenArtifact, getRpc, xOnlyPubkeyHex, FUND_PRIV_HEX, FUND_ADDR, combineKttV2ActionAndRedeem } from './common.mjs';
const { encodeKttV2TransferAction } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_ktt_panel/kasia-console/src/lib/kcc20-token/ktt-v2-transfer-witness.mjs');
const STATE_FIELDS = [{"name":"amount","type":{"kind":"int"}},{"name":"owner","type":{"kind":"fixed_bytes","len":32}},{"name":"owner_scheme","type":{"kind":"byte"}},{"name":"borrow_scheme","type":{"kind":"byte"}},{"name":"borrow_guard","type":{"kind":"fixed_bytes","len":32}},{"name":"extension_commitment","type":{"kind":"fixed_bytes","len":32}}];

const entryAbi = { dispatch_tag: 'd9a2b797' };
const KTT_B_SPK = 'aa2061c3fe73ef3d8df17de45ec11a2d29301d485bcbf7b1b37d4b0f77af31c8dcef87';
const KTT_B_REDEEM_HEX = JSON.parse(readFileSync('./transfer_ab_output.log', 'utf8').trim().split('\n').filter(l=>l.startsWith('{')).pop()).redeemScriptHex;
const bobPriv = new kaspa.PrivateKey('bb'.repeat(32));
const carolPriv = new kaspa.PrivateKey('cd'.repeat(32));
const carolXOnly = xOnlyPubkeyHex(carolPriv);
console.log('carol xOnly pubkey:', carolXOnly);

const rpc = await getRpc();
try {
  const ktSpk = new kaspa.ScriptPublicKey(0, KTT_B_SPK);
  const ktAddr = kaspa.addressFromScriptPublicKey(ktSpk, 'simnet').toString();
  const { entries: ktEntries } = await rpc.getUtxosByAddresses({ addresses: [ktAddr] });
  // pick the CORRECTLY-bound one (real covenantId, not the broken artifact from the pre-fix run)
  const ktEntry = ktEntries.find(e => e.entry.covenantId != null && String(e.entry.covenantId) !== 'undefined');
  if (!ktEntry) throw new Error('no properly-bound Bob KTT UTXO found');
  const ktAmount = BigInt(ktEntry.entry.amount);
  const ktCovId = String(ktEntry.entry.covenantId);
  console.log('spending Bob KTT outpoint:', ktEntry.outpoint.transactionId, 'covId:', ktCovId);

  const dag = await rpc.getBlockDagInfo();
  const matureCutoff = dag.virtualDaaScore - 1000n;
  const fundPriv = new kaspa.PrivateKey(FUND_PRIV_HEX);
  const { entries: fundEntries } = await rpc.getUtxosByAddresses({ addresses: [FUND_ADDR] });
  const feeUtxo = fundEntries.find(e => BigInt(e.entry.amount) > 1_000_000n && BigInt(e.entry.blockDaaScore) < matureCutoff);
  const fee = 6_000_000n;
  const feeUtxoAmount = BigInt(feeUtxo.entry.amount);
  const change = feeUtxoAmount - fee;

  const artC = computeKttV2TokenArtifact({ amount: Number(ktAmount), ownerScheme: 0, ownerBytesHex: carolXOnly });
  const outputs = [
    new kaspa.TransactionOutput(ktAmount, new kaspa.ScriptPublicKey(0, artC.scriptPubKeyHex.slice(2)), new kaspa.CovenantBinding(0, new kaspa.Hash(ktCovId))),
    new kaspa.TransactionOutput(change, kaspa.payToAddressScript(new kaspa.Address(FUND_ADDR))),
  ];
  const mk = (sigScripts) => new kaspa.Transaction({
    version: 1,
    inputs: [
      { previousOutpoint: ktEntry.outpoint, signatureScript: sigScripts[0], sequence: 0n, sigOpCount: 0, computeBudget: 400, utxo: ktEntry.entry },
      { previousOutpoint: feeUtxo.outpoint, signatureScript: sigScripts[1], sequence: 0n, sigOpCount: 0, computeBudget: 70, utxo: feeUtxo.entry },
    ],
    outputs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });
  const unsigned = mk(['', '']);
  const bobSigRaw = kaspa.createInputSignature(unsigned, 0, bobPriv, kaspa.SighashType.All);
  const fundSigHex = kaspa.createInputSignature(unsigned, 1, fundPriv, kaspa.SighashType.All);
  const bobSig65 = bobSigRaw.slice(2);
  const nextStates = [{ amount: ktAmount, ownerHex: carolXOnly, ownerScheme: 0, borrowScheme: 0, borrowGuardHex: '00'.repeat(32), extensionCommitmentHex: '00'.repeat(32) }];
  const actionHex = encodeKttV2TransferAction(kaspa, entryAbi, STATE_FIELDS, nextStates, [0], [bobSig65]);
  const sigScript0 = combineKttV2ActionAndRedeem(kaspa, actionHex, Buffer.from(KTT_B_REDEEM_HEX, 'hex'));
  const signedTx = mk([sigScript0, fundSigHex]);
  const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
  console.log('B->C TRANSFER txid:', result.transactionId);
  console.log(JSON.stringify({ carolXOnly, carolPrivHex: carolPriv.toString(), scriptPubKeyHex: artC.scriptPubKeyHex, redeemScriptHex: Buffer.from(artC.script).toString('hex'), amount: ktAmount.toString(), covId: ktCovId }));
} finally { await rpc.disconnect(); }
