// 03_adv_owner_zero.mjs — ADVERSARIAL: attempt to spend Bob's KTT with next_states[0].owner=ZERO32.
// Expect real rejection (must fail the `next_states[j].owner != ZERO32` require in transferPolicy).
import { readFileSync } from 'node:fs';
import { kaspa, getRpc, FUND_PRIV_HEX, FUND_ADDR, computeKttV2TokenArtifact } from './common.mjs';

const { encodeKttV2TransferAction, combineKttV2ActionAndRedeem } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_ktt_panel/kasia-console/src/lib/kcc20-token/ktt-v2-transfer-witness.mjs');

const KTT_B_SPK = 'aa2061c3fe73ef3d8df17de45ec11a2d29301d485bcbf7b1b37d4b0f77af31c8dcef87';
const KTT_B_REDEEM_HEX = JSON.parse(readFileSync('./transfer_ab_output.log', 'utf8').trim().split('\n').pop()).redeemScriptHex;
const bobPriv = new kaspa.PrivateKey('bb'.repeat(32));
const entryAbi = { dispatch_tag: 'd9a2b797' };
const stateFields = [{"name":"amount","type":{"kind":"int"}},{"name":"owner","type":{"kind":"fixed_bytes","len":32}},{"name":"owner_scheme","type":{"kind":"byte"}},{"name":"borrow_scheme","type":{"kind":"byte"}},{"name":"borrow_guard","type":{"kind":"fixed_bytes","len":32}},{"name":"extension_commitment","type":{"kind":"fixed_bytes","len":32}}];

const rpc = await getRpc();
try {
  const ktSpk = new kaspa.ScriptPublicKey(0, KTT_B_SPK);
  const ktAddr = kaspa.addressFromScriptPublicKey(ktSpk, 'simnet').toString();
  const { entries: ktEntries } = await rpc.getUtxosByAddresses({ addresses: [ktAddr] });
  if (!ktEntries.length) throw new Error('KTT-B UTXO not found');
  const ktEntry = ktEntries[0];
  const ktAmount = BigInt(ktEntry.entry?.amount ?? ktEntry.amount ?? 0);

  const dag = await rpc.getBlockDagInfo();
  const matureCutoff = dag.virtualDaaScore - 1000n;
  const fundPriv = new kaspa.PrivateKey(FUND_PRIV_HEX);
  const { entries: fundEntries } = await rpc.getUtxosByAddresses({ addresses: [FUND_ADDR] });
  const feeUtxo = fundEntries.find(e => BigInt(e.entry?.amount ?? e.amount ?? 0) > 1_000_000n && BigInt(e.entry?.blockDaaScore ?? e.blockDaaScore ?? 0) < matureCutoff);
  const fee = 6_000_000n;
  const feeUtxoAmount = BigInt(feeUtxo.entry?.amount ?? feeUtxo.amount ?? 0);
  const change = feeUtxoAmount - fee;

  // MALICIOUS: next_states[0].owner = ZERO32, owner_scheme=0(pubkey) — structurally well-formed,
  // semantically forbidden(should hit `require(next_states[j].owner != ZERO32)`).
  // 🔴 修正(第一次尝试的教训): continuation 输出的真实 scriptPubKey 必须是"同一份合约字节码 + 这个
  // 新 State 编码后"的真实 P2SH(同 genesis 的推导方式, 模板哈希与 State 无关但完整脚本字节随 State
  // 变)——不能偷懒复用 KTT-B 原本(owner=Bob)的 scriptPubKey, 那样会导致"输出真实字节声明 owner=Bob"
  // 但"witness 里的 next_states 声明 owner=0"两者不一致, 触发的是一个无关的 mismatch 而不是我想测的
  // owner!=ZERO32 这条 require——第一次尝试正是撞在这个不相关的失败上("covenant id 0000...0000
  // input 0 is out of bounds"), 不是我想验证的那一条。
  const maliciousArt = computeKttV2TokenArtifact({ amount: Number(ktAmount), ownerScheme: 0, ownerBytesHex: '00'.repeat(32) });
  const maliciousOut = new kaspa.TransactionOutput(ktAmount, new kaspa.ScriptPublicKey(0, maliciousArt.scriptPubKeyHex.slice(2)));
  const changeOut = new kaspa.TransactionOutput(change, kaspa.payToAddressScript(new kaspa.Address(FUND_ADDR)));
  const outputs = [maliciousOut, changeOut];

  const mk = (sigScripts) => new kaspa.Transaction({
    version: 1,
    inputs: [
      { previousOutpoint: ktEntry.outpoint, signatureScript: sigScripts[0], sequence: 0n, sigOpCount: 0, computeBudget: 400, utxo: ktEntry.entry ?? ktEntry },
      { previousOutpoint: feeUtxo.outpoint, signatureScript: sigScripts[1], sequence: 0n, sigOpCount: 0, computeBudget: 70, utxo: feeUtxo.entry ?? feeUtxo },
    ],
    outputs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });

  const unsigned = mk(['', '']);
  const bobSigRaw = kaspa.createInputSignature(unsigned, 0, bobPriv, kaspa.SighashType.All);
  const fundSigHex = kaspa.createInputSignature(unsigned, 1, fundPriv, kaspa.SighashType.All);
  const bobSig65 = bobSigRaw.slice(2);

  const nextStates = [{ amount: ktAmount, ownerHex: '00'.repeat(32), ownerScheme: 0, borrowScheme: 0, borrowGuardHex: '00'.repeat(32), extensionCommitmentHex: '00'.repeat(32) }];
  const actionHex = encodeKttV2TransferAction(kaspa, entryAbi, stateFields, nextStates, [0], [bobSig65]);
  const sigScript0 = combineKttV2ActionAndRedeem(kaspa, actionHex, Buffer.from(KTT_B_REDEEM_HEX, 'hex'));

  const signedTx = mk([sigScript0, fundSigHex]);
  try {
    const result = await rpc.submitTransaction({ transaction: signedTx, allowOrphan: false });
    console.log('UNEXPECTED SUCCESS(should have been rejected!):', result.transactionId);
    process.exitCode = 1;
  } catch (e) {
    console.log('EXPECTED REJECTION — verbatim error text:');
    console.log(e.message);
  }
} finally { await rpc.disconnect(); }
