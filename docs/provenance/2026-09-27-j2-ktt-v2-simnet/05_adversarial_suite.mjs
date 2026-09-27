// 05_adversarial_suite.mjs — real simnet adversarial vectors against Carol's correctly-bound KTT.
// Each attempt must FAIL to broadcast (real rejection, verbatim text captured) and Carol's UTXO must
// remain unspent afterward(failed submitTransaction never lands, so subsequent vectors reuse the same UTXO).
import { readFileSync } from 'node:fs';
import { kaspa, getRpc, FUND_PRIV_HEX, FUND_ADDR, computeKttV2TokenArtifact, combineKttV2ActionAndRedeem } from './common.mjs';
const { encodeKttV2TransferAction } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_ktt_panel/kasia-console/src/lib/kcc20-token/ktt-v2-transfer-witness.mjs');
const STATE_FIELDS = [{"name":"amount","type":{"kind":"int"}},{"name":"owner","type":{"kind":"fixed_bytes","len":32}},{"name":"owner_scheme","type":{"kind":"byte"}},{"name":"borrow_scheme","type":{"kind":"byte"}},{"name":"borrow_guard","type":{"kind":"fixed_bytes","len":32}},{"name":"extension_commitment","type":{"kind":"fixed_bytes","len":32}}];
const entryAbi = { dispatch_tag: 'd9a2b797' };

const carol = JSON.parse(readFileSync('./carol_info.json', 'utf8'));
const carolPriv = new kaspa.PrivateKey(carol.carolPrivHex);
const bobPriv = new kaspa.PrivateKey('bb'.repeat(32)); // wrong signer for vector (b)

const rpc = await getRpc();
const results = [];

async function attempt(name, buildFn) {
  const ktSpk = new kaspa.ScriptPublicKey(0, carol.scriptPubKeyHex.slice(2));
  const ktAddr = kaspa.addressFromScriptPublicKey(ktSpk, 'simnet').toString();
  const { entries: ktEntries } = await rpc.getUtxosByAddresses({ addresses: [ktAddr] });
  const ktEntry = ktEntries.find(e => String(e.entry.covenantId) === carol.covId);
  if (!ktEntry) { console.log(`[${name}] SKIP — Carol UTXO not found(already consumed by an earlier POSITIVE vector?)`); return; }
  const ktAmount = BigInt(ktEntry.entry.amount);

  const dag = await rpc.getBlockDagInfo();
  const matureCutoff = dag.virtualDaaScore - 1000n;
  const fundPriv = new kaspa.PrivateKey(FUND_PRIV_HEX);
  const { entries: fundEntries } = await rpc.getUtxosByAddresses({ addresses: [FUND_ADDR] });
  const feeUtxo = fundEntries.find(e => BigInt(e.entry.amount) > 1_000_000n && BigInt(e.entry.blockDaaScore) < matureCutoff);
  const fee = 6_000_000n;
  const change = BigInt(feeUtxo.entry.amount) - fee;

  const { outputs, buildActionHex } = buildFn({ ktEntry, ktAmount, change });
  const mk = (sigScripts) => new kaspa.Transaction({
    version: 1,
    inputs: [
      { previousOutpoint: ktEntry.outpoint, signatureScript: sigScripts[0], sequence: 0n, sigOpCount: 0, computeBudget: 400, utxo: ktEntry.entry },
      { previousOutpoint: feeUtxo.outpoint, signatureScript: sigScripts[1], sequence: 0n, sigOpCount: 0, computeBudget: 70, utxo: feeUtxo.entry },
    ],
    outputs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });
  const unsigned = mk(['', '']);
  const fundSigHex = kaspa.createInputSignature(unsigned, 1, fundPriv, kaspa.SighashType.All);
  const sigScript0 = buildActionHex(unsigned);
  const signedTx = mk([sigScript0, fundSigHex]);
  try {
    const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    console.log(`[${name}] UNEXPECTED SUCCESS — txid ${result.transactionId}`);
    results.push({ name, outcome: 'UNEXPECTED_SUCCESS', txid: result.transactionId });
  } catch (e) {
    console.log(`[${name}] EXPECTED REJECTION:`);
    console.log(`  ${e.message}`);
    results.push({ name, outcome: 'REJECTED', error: e.message });
  }
}

try {
  // ── Vector (a): next_states[0].owner = ZERO32 ──
  await attempt('owner-zero', ({ ktEntry, ktAmount, change }) => {
    const maliciousArt = computeKttV2TokenArtifact({ amount: Number(ktAmount), ownerScheme: 0, ownerBytesHex: '00'.repeat(32) });
    const outputs = [
      new kaspa.TransactionOutput(ktAmount, new kaspa.ScriptPublicKey(0, maliciousArt.scriptPubKeyHex.slice(2)), new kaspa.CovenantBinding(0, new kaspa.Hash(carol.covId))),
      new kaspa.TransactionOutput(change, kaspa.payToAddressScript(new kaspa.Address(FUND_ADDR))),
    ];
    return { outputs, buildActionHex: (unsigned) => {
      const sigRaw = kaspa.createInputSignature(unsigned, 0, carolPriv, kaspa.SighashType.All);
      const nextStates = [{ amount: ktAmount, ownerHex: '00'.repeat(32), ownerScheme: 0, borrowScheme: 0, borrowGuardHex: '00'.repeat(32), extensionCommitmentHex: '00'.repeat(32) }];
      const actionHex = encodeKttV2TransferAction(kaspa, entryAbi, STATE_FIELDS, nextStates, [0], [sigRaw.slice(2)]);
      return combineKttV2ActionAndRedeem(kaspa, actionHex, Buffer.from(carol.redeemScriptHex, 'hex'));
    } };
  });

  // ── Vector (b): wrong signer (Bob's key instead of Carol's) ──
  await attempt('wrong-signer', ({ ktEntry, ktAmount, change }) => {
    const destArt = computeKttV2TokenArtifact({ amount: Number(ktAmount), ownerScheme: 0, ownerBytesHex: 'ee'.repeat(32) });
    const outputs = [
      new kaspa.TransactionOutput(ktAmount, new kaspa.ScriptPublicKey(0, destArt.scriptPubKeyHex.slice(2)), new kaspa.CovenantBinding(0, new kaspa.Hash(carol.covId))),
      new kaspa.TransactionOutput(change, kaspa.payToAddressScript(new kaspa.Address(FUND_ADDR))),
    ];
    return { outputs, buildActionHex: (unsigned) => {
      // sign with BOB's key, not Carol's — Bob is not the owner of this UTXO
      const sigRaw = kaspa.createInputSignature(unsigned, 0, bobPriv, kaspa.SighashType.All);
      const nextStates = [{ amount: ktAmount, ownerHex: 'ee'.repeat(32), ownerScheme: 0, borrowScheme: 0, borrowGuardHex: '00'.repeat(32), extensionCommitmentHex: '00'.repeat(32) }];
      const actionHex = encodeKttV2TransferAction(kaspa, entryAbi, STATE_FIELDS, nextStates, [0], [sigRaw.slice(2)]);
      return combineKttV2ActionAndRedeem(kaspa, actionHex, Buffer.from(carol.redeemScriptHex, 'hex'));
    } };
  });

  // ── Vector (c) NWT SHOULD: sigs.length != owner_input_idx.length(sigs array too short: 0 vs 1) ──
  await attempt('sigs-length-mismatch', ({ ktEntry, ktAmount, change }) => {
    const destArt = computeKttV2TokenArtifact({ amount: Number(ktAmount), ownerScheme: 0, ownerBytesHex: 'ff'.repeat(32) });
    const outputs = [
      new kaspa.TransactionOutput(ktAmount, new kaspa.ScriptPublicKey(0, destArt.scriptPubKeyHex.slice(2)), new kaspa.CovenantBinding(0, new kaspa.Hash(carol.covId))),
      new kaspa.TransactionOutput(change, kaspa.payToAddressScript(new kaspa.Address(FUND_ADDR))),
    ];
    return { outputs, buildActionHex: () => {
      // deliberately encode ZERO sigs while owner_input_idx=[0](array-length mismatch, bypasses our
      // own encoder's guard by hand-building the ScriptBuilder call directly).
      const nextStates = [{ amount: ktAmount, ownerHex: 'ff'.repeat(32), ownerScheme: 0, borrowScheme: 0, borrowGuardHex: '00'.repeat(32), extensionCommitmentHex: '00'.repeat(32) }];
      const b = new kaspa.ScriptBuilder({ flags: { covenantsEnabled: true } });
      // next_states=[1 element] SoA-encoded manually(same logic as encodeKttV2TransferAction, inlined
      // here since we need to skip its sigsHex.length===ownerInputIdx.length guard on purpose):
      const s = nextStates[0];
      const amtBuf = Buffer.alloc(8); amtBuf.writeBigInt64LE(BigInt(s.amount)); b.addData(amtBuf);
      b.addData(Buffer.from(s.ownerHex, 'hex'));
      b.addData(Buffer.from([s.ownerScheme]));
      b.addData(Buffer.from([s.borrowScheme]));
      b.addData(Buffer.from(s.borrowGuardHex, 'hex'));
      b.addData(Buffer.from(s.extensionCommitmentHex, 'hex'));
      b.addData(new Uint8Array(0)); // witness=[]
      const idxBuf = Buffer.alloc(8); idxBuf.writeBigInt64LE(0n, 0); b.addData(idxBuf); // owner_input_idx=[0]
      b.addData(new Uint8Array(0)); // sigs=[] (WRONG: should be [oneSig], length mismatch)
      b.addData(Buffer.from(entryAbi.dispatch_tag, 'hex'));
      const actionHex = b.drain();
      return combineKttV2ActionAndRedeem(kaspa, actionHex, Buffer.from(carol.redeemScriptHex, 'hex'));
    } };
  });

  console.log('\n=== adversarial suite results ===');
  console.log(JSON.stringify(results, null, 2));
} finally { await rpc.disconnect(); }
