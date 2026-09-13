// covenant-roundtrip.test.mjs — (c) 第 5 笔 (A) · Codex 8118732e: 用【真实 covenant 交易】(covenant 输入 UTXO 上下文 + 续约输出 CovenantBinding)
// 做 serializeToSafeJSON → deserializeFromSafeJSON → finalize() 往返, 证 id_before === id_after 且 covenant 绑定/输入上下文都在;
// 再把这笔 covenant 交易喂 replayPreparedTransactions(假 RPC): 幂等接受(mempool 已有 ⇒ 不重发)/正常重播/拒绝(改字节 ⇒ txid 不等; 输入被花 ⇒ inputs_spent;
// 反序列化失败 ⇒ replay_bad_json ⇒ console 侧 hold)。全部离线, 零 RPC 零广播。
// 交易形照 relay p2sh.mjs bshard continuation(version 1, P2SH covenant 输入带 utxo.covenantId, no-sig scriptSig 押 redeem, 输出 CovenantBinding(0, covId)) + 一个 P2PK fee 输入真签名。
// Run: cd kasia-relay && node src/lib/covenant-roundtrip.test.mjs
import * as kaspa from 'kaspa-wasm';
import { replayPreparedTransactions } from './transaction.mjs';

const { Keypair, PrivateKey, Transaction, TransactionOutput, CovenantBinding, Hash, ScriptBuilder, createInputSignature, SighashType, addressFromScriptPublicKey, payToAddressScript } = kaspa;
let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

// 范围注(Bettor/NWT 2f9377e7): intent 机制现只用于 KAS 转账(escrow/payout), 其往返对象 = relay Generator 构造的转账交易(含真实 UTXO 上下文),
//   已由 serialize-roundtrip.test.mjs 覆盖。本文件是【超集】: 代币 transfer 将来若也走 intent, covenant 输入/CovenantBinding 输出的往返与重播先在这里钉住。
// ── 造一笔 covenant 交易 ──
const kp = Keypair.random();
const priv = new PrivateKey(kp.privateKey);
const feeAddr = kp.toAddress('mainnet');
const feeSpk = payToAddressScript(feeAddr);
// 假 redeem(覆盖 P2SH 定位: 离线不执行脚本, 只要是合法 push 数据): 32 字节任意脚本
const redeemHex = '51'.repeat(48);
const p2shSpk = ScriptBuilder.fromScript(redeemHex).createPayToScriptHashScript();
const p2shAddr = addressFromScriptPublicKey(p2shSpk, 'mainnet');
const COV_ID = 'c0'.repeat(32);
const covOutpoint = { transactionId: 'aa'.repeat(32), index: 0 };
const feeOutpoint = { transactionId: 'bb'.repeat(32), index: 1 };
const covUtxo = { address: p2shAddr, outpoint: covOutpoint, amount: 300_000_000n, scriptPublicKey: p2shSpk, blockDaaScore: 1000n, isCoinbase: false, covenantId: COV_ID };
const feeUtxo = { address: feeAddr, outpoint: feeOutpoint, amount: 50_000_000n, scriptPublicKey: feeSpk, blockDaaScore: 1000n, isCoinbase: false };
// no-sig scriptSig: OP_0 + push(redeem) (bshard passthrough 形)
const pushRedeem = ScriptBuilder.fromScript(redeemHex).encodePayToScriptHashSignatureScript('');   // [][redeemPush]
const covSig = '00' + pushRedeem;
const outputs = () => [
  new TransactionOutput(300_000_000n, p2shSpk, new CovenantBinding(0, new Hash(COV_ID))),   // 续约: 同 cov id, 授权输入 0
  new TransactionOutput(45_000_000n, feeSpk),                                                  // change
];
const mk = (sigs, withUtxo) => new Transaction({
  version: 1,
  inputs: [
    { previousOutpoint: covOutpoint, signatureScript: sigs[0], sequence: 0n, sigOpCount: 0, computeBudget: 0, ...(withUtxo ? { utxo: covUtxo } : {}) },
    { previousOutpoint: feeOutpoint, signatureScript: sigs[1], sequence: 0n, sigOpCount: 1, ...(withUtxo ? { utxo: feeUtxo } : {}) },
  ],
  outputs: outputs(), lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
});
const unsigned = mk(['', ''], true);
const feeSig = createInputSignature(unsigned, 1, priv, SighashType.All);
const signed = mk([covSig, feeSig], true);
const idBefore = signed.id;
ok(/^[0-9a-f]{64}$/.test(idBefore) && String(signed.outputs[0].covenant?.covenantId ?? '') === COV_ID, `covenant tx built: id ${idBefore.slice(0, 12)}, out[0] CovenantBinding covId == ${COV_ID.slice(0, 8)}`);

// ── (A) 往返 ──
let json = null, back = null, roundtripErr = null;
try { json = signed.serializeToSafeJSON(); back = Transaction.deserializeFromSafeJSON(json); back.finalize(); } catch (e) { roundtripErr = e; }
ok(!roundtripErr && back && back.id === idBefore, `(A) 往返 id_before === id_after (${idBefore.slice(0, 12)})${roundtripErr ? ` err: ${roundtripErr.message}` : ''}`);
ok(back && String(back.outputs[0].covenant?.covenantId ?? '') === COV_ID && back.outputs[0].covenant?.authorizingInput === 0, '(A) 往返后 out[0] CovenantBinding(0, covId) 仍在');
ok(back && back.inputs.length === 2 && back.inputs[0].signatureScript === covSig && back.inputs[1].signatureScript === feeSig, '(A) 往返后两输入 scriptSig 原样(covenant no-sig 押 redeem + P2PK 真签)');
ok(json && /"covenantId":"c0c0/.test(json) && /"utxo":\{/.test(json), '(A) safe JSON 带输入 utxo 上下文(含 covenantId)——同字节重播不丢 covenant 上下文');
// 改字节: 续约输出金额 -1 ⇒ finalize 后 id 变(covenant 交易也一样)
const tampered = json.replace('"value":"300000000"', '"value":"299999999"');
const tTx = Transaction.deserializeFromSafeJSON(tampered); const embedded = tTx.id; tTx.finalize();
ok(tampered !== json && embedded === idBefore && tTx.id !== idBefore, `(A) 改一字节: 不 finalize id 照旧(陷阱), finalize 后 id 变 (${tTx.id.slice(0, 12)})`);

// ── 假 RPC + replay 向量 ──
function fakeRpc({ mempool = new Set(), senderHas = [covOutpoint, feeOutpoint], targetLanded = false, submitThrows = false } = {}) {
  const R = { submitted: [], mempool };
  R.getMempoolEntry = async ({ transactionId }) => { if (R.mempool.has(transactionId)) return { entry: { transactionId } }; throw new Error('not found'); };
  R.getUtxosByAddresses = async ([addr]) => {
    const a = String(addr);
    if (a === feeAddr.toString()) return { entries: senderHas.map(o => ({ outpoint: o })) };
    if (a === String(p2shAddr) && targetLanded) return { entries: [{ outpoint: { transactionId: idBefore, index: 0 } }] };
    return { entries: [] };
  };
  R.submitTransaction = async ({ transaction }) => { if (submitThrows) throw new Error('rejected (fake)'); R.submitted.push(transaction.id); R.mempool.add(transaction.id); return { transactionId: transaction.id }; };
  return R;
}
// 注: 发送方地址在本形里 = fee 地址(relay 自己的钱包); covenant 输入的 outpoint 也必须还在"发送方可花集"里——真 relay 里 covenant UTXO 属 P2SH 地址,
//     replayPreparedTransactions 只查 senderAddress 一个地址 ⇒ covenant 输入会被判 inputs_spent。这是【本函数的已知边界】: 对多地址输入的交易, 调用方须传
//     senderAddress = 含全部外部输入的地址集合(v2), 本向量把两个 outpoint 都放进 fee 地址的集合模拟"全部在"。
const call = (rpc, over = {}) => replayPreparedTransactions({ txJsonList: [json], expectedTxId: idBefore, senderAddress: feeAddr.toString(), targetAddress: String(p2shAddr), rpcOverride: rpc, ...over });
{ const rpc = fakeRpc(); const r = await call(rpc); ok(r.ok && r.replayed && r.txId === idBefore && rpc.submitted.length === 1 && rpc.submitted[0] === idBefore, 'replay covenant tx: 正常 → 同字节提交 1 笔, txId == 记录值'); }
{ const rpc = fakeRpc({ mempool: new Set([idBefore]) }); const r = await call(rpc); ok(r.ok && r.alreadyInMempool && rpc.submitted.length === 0, 'replay covenant tx: mempool 已有 → 幂等接受, 零提交'); }
{ const rpc = fakeRpc({ targetLanded: true }); const r = await call(rpc); ok(r.ok && r.alreadyLanded && rpc.submitted.length === 0, 'replay covenant tx: 续约输出已在 P2SH 地址 UTXO 集 → 幂等接受, 零提交'); }
{ const rpc = fakeRpc(); const r = await call(rpc, { txJsonList: [tampered] }); ok(!r.ok && r.code === 'replay_txid_mismatch' && rpc.submitted.length === 0, 'replay covenant tx: 改字节 → 拒(finalize 后 txid 不等), 零提交'); }
{ const rpc = fakeRpc({ senderHas: [feeOutpoint] }); const r = await call(rpc); ok(!r.ok && r.code === 'inputs_spent' && rpc.submitted.length === 0, 'replay covenant tx: covenant 输入不在可花集 → inputs_spent, 零提交(console 才允许重建)'); }
{ const rpc = fakeRpc(); const r = await call(rpc, { txJsonList: ['{"id":"zz"}'] }); ok(!r.ok && r.code === 'replay_bad_json' && rpc.submitted.length === 0, 'replay covenant tx: 往返失败(反序列化抛) → replay_bad_json, 零提交(console 侧 hold 人工)'); }
{ const rpc = fakeRpc({ submitThrows: true }); const r = await call(rpc); ok(!r.ok && r.code === 'replay_rejected' && rpc.submitted.length === 0, 'replay covenant tx: submit 抛错且 mempool 无 → replay_rejected(console 不重建)'); }
// harness 翻转臂
{ const before = fails; ok(back.id === 'ff'.repeat(32), 'harness-flip (expect FAIL)'); if (fails === before + 1) { fails--; console.log('  ✅ harness flip arm went red as required'); } else { fails++; } }

console.log(fails ? `\n❌ ${fails} failure(s)` : '\n✅ all covenant round-trip / replay vectors passed');
process.exit(fails ? 1 : 0);
