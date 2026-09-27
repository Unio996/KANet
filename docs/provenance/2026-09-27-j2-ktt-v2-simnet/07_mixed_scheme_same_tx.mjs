// 07_mixed_scheme_same_tx.mjs — POSITIVE: one tx spends KTT-D(covenant-owned, owner=Carol's KTT
// covenant_id, in-place branch) together with Carol's KTT(pubkey-owned, checkSig branch), both
// continuing. Demonstrates NWT adversarial#4's reasoning("mixing is safe because each branch verifies
// independently") with a real broadcast, not just argument.
import { readFileSync } from 'node:fs';
import { kaspa, computeKttV2TokenArtifact, getRpc, FUND_PRIV_HEX, FUND_ADDR, combineKttV2ActionAndRedeem } from './common.mjs';
const { encodeKttV2TransferAction, encodeKttV2TransferDelegatorAction } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_ktt_panel/kasia-console/src/lib/kcc20-token/ktt-v2-transfer-witness.mjs');
const STATE_FIELDS = [{"name":"amount","type":{"kind":"int"}},{"name":"owner","type":{"kind":"fixed_bytes","len":32}},{"name":"owner_scheme","type":{"kind":"byte"}},{"name":"borrow_scheme","type":{"kind":"byte"}},{"name":"borrow_guard","type":{"kind":"fixed_bytes","len":32}},{"name":"extension_commitment","type":{"kind":"fixed_bytes","len":32}}];
const entryAbi = { dispatch_tag: 'd9a2b797' };
const delegatorAbi = { dispatch_tag: 'b7f7ac61' };

const carol = JSON.parse(readFileSync('./carol_info.json', 'utf8'));
const carolPriv = new kaspa.PrivateKey(carol.carolPrivHex);
const d = JSON.parse(readFileSync('./mint_d_output.log', 'utf8').trim().split('\n').filter(l => l.startsWith('{')).pop());

const rpc = await getRpc();
try {
  const carolSpk = new kaspa.ScriptPublicKey(0, carol.scriptPubKeyHex.slice(2));
  const carolAddr = kaspa.addressFromScriptPublicKey(carolSpk, 'simnet').toString();
  const { entries: carolEntries } = await rpc.getUtxosByAddresses({ addresses: [carolAddr] });
  const carolEntry = carolEntries.find(e => String(e.entry.covenantId) === carol.covId);
  if (!carolEntry) throw new Error('Carol KTT UTXO not found');
  const carolAmount = BigInt(carolEntry.entry.amount);

  const dSpk = new kaspa.ScriptPublicKey(0, d.scriptPubKeyHex.slice(2));
  const dAddr = kaspa.addressFromScriptPublicKey(dSpk, 'simnet').toString();
  const { entries: dEntries } = await rpc.getUtxosByAddresses({ addresses: [dAddr] });
  const dEntry = dEntries.find(e => String(e.entry.covenantId) === d.covId);
  if (!dEntry) throw new Error('KTT-D UTXO not found');
  const dAmount = BigInt(dEntry.entry.amount);

  const dag = await rpc.getBlockDagInfo();
  const matureCutoff = dag.virtualDaaScore - 1000n;
  const fundPriv = new kaspa.PrivateKey(FUND_PRIV_HEX);
  const { entries: fundEntries } = await rpc.getUtxosByAddresses({ addresses: [FUND_ADDR] });
  const feeUtxo = fundEntries.find(e => BigInt(e.entry.amount) > 1_000_000n && BigInt(e.entry.blockDaaScore) < matureCutoff);
  const fee = 12_000_000n; // two covenant inputs -> higher compute mass than a single-input transfer
  const change = BigInt(feeUtxo.entry.amount) - fee;

  // input0 = KTT-D (leader, covenant-owned, in-place ref to Carol's covenant_id at input1)
  // input1 = Carol's KTT (delegate, pubkey-owned, checkSig)
  // input2 = fee
  // KTT-D continues unchanged (still owner=carol.covId). Carol's KTT continues back to Alice's xOnly pubkey.
  const alicePriv = new kaspa.PrivateKey('aa'.repeat(32));
  const aliceXOnlyHex = Buffer.from(kaspa.payToAddressScript(alicePriv.toPublicKey().toAddress('mainnet')).script, 'hex').subarray(1, 33).toString('hex');

  const dContArt = computeKttV2TokenArtifact({ amount: Number(dAmount), ownerScheme: 4, ownerBytesHex: carol.covId });
  const carolContArt = computeKttV2TokenArtifact({ amount: Number(carolAmount), ownerScheme: 0, ownerBytesHex: aliceXOnlyHex });

  const outputs = [
    new kaspa.TransactionOutput(dAmount, new kaspa.ScriptPublicKey(0, dContArt.scriptPubKeyHex.slice(2)), new kaspa.CovenantBinding(0, new kaspa.Hash(d.covId))),
    new kaspa.TransactionOutput(carolAmount, new kaspa.ScriptPublicKey(0, carolContArt.scriptPubKeyHex.slice(2)), new kaspa.CovenantBinding(1, new kaspa.Hash(carol.covId))),
    new kaspa.TransactionOutput(change, kaspa.payToAddressScript(new kaspa.Address(FUND_ADDR))),
  ];

  const mk = (sigScripts) => new kaspa.Transaction({
    version: 1,
    inputs: [
      { previousOutpoint: dEntry.outpoint, signatureScript: sigScripts[0], sequence: 0n, sigOpCount: 0, computeBudget: 400, utxo: dEntry.entry },
      { previousOutpoint: carolEntry.outpoint, signatureScript: sigScripts[1], sequence: 0n, sigOpCount: 0, computeBudget: 400, utxo: carolEntry.entry },
      { previousOutpoint: feeUtxo.outpoint, signatureScript: sigScripts[2], sequence: 0n, sigOpCount: 0, computeBudget: 70, utxo: feeUtxo.entry },
    ],
    outputs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });

  const unsigned = mk(['', '', '']);
  // input0(KTT-D, covenant-owned): owner_input_idx points at input1(where Carol's covenant_id is
  // in-place present); sig unused by that branch, pass a dummy 65B placeholder.
  const dummySig65 = '11'.repeat(65);
  const carolSigRaw = kaspa.createInputSignature(unsigned, 1, carolPriv, kaspa.SighashType.All);
  const carolSig65 = carolSigRaw.slice(2);
  const fundSigHex = kaspa.createInputSignature(unsigned, 2, fundPriv, kaspa.SighashType.All);

  // 🔴 修正(第一次尝试的教训): KTT-D 与 Carol 的 KTT 是【不同 covenant_id 的两个独立实例】(同一份
  // 合约字节码, 不同身份)——不是同一个 binding=cov 覆盖组的"多输入成员"(那是指同一个 covenant 实例
  // 因某种原因产生多个输入的场景, 例如同一 covenant 早前状态拆过)。两个独立实例各自都是自己那个
  // "组的唯一成员"(leader-of-one, 同已验证过的单输入 transfer 形状), 只是恰好同笔 tx 里各自独立
  // 花费——"混用"的意思是"tx 里同时有 owner_scheme=4 与 owner_scheme=0 两个独立输入", 不需要真的把
  // 它们绑进同一次 transfer 调用。
  const dNextStates = [{ amount: dAmount, ownerHex: carol.covId, ownerScheme: 4, borrowScheme: 0, borrowGuardHex: '00'.repeat(32), extensionCommitmentHex: '00'.repeat(32) }];
  const dActionHex = encodeKttV2TransferAction(kaspa, entryAbi, STATE_FIELDS, dNextStates, [1], [dummySig65]);
  const sigScript0 = combineKttV2ActionAndRedeem(kaspa, dActionHex, Buffer.from(d.redeemScriptHex, 'hex'));

  const carolNextStates = [{ amount: carolAmount, ownerHex: aliceXOnlyHex, ownerScheme: 0, borrowScheme: 0, borrowGuardHex: '00'.repeat(32), extensionCommitmentHex: '00'.repeat(32) }];
  const carolActionHex = encodeKttV2TransferAction(kaspa, entryAbi, STATE_FIELDS, carolNextStates, [0], [carolSig65]);
  const sigScript1 = combineKttV2ActionAndRedeem(kaspa, carolActionHex, Buffer.from(carol.redeemScriptHex, 'hex'));

  const signedTx = mk([sigScript0, sigScript1, fundSigHex]);
  const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
  console.log('MIXED-SCHEME txid:', result.transactionId);
} finally { await rpc.disconnect(); }
