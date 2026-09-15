// covenant-roundtrip.test.mjs — (c) 第 5 笔 (A) · Codex 8118732e: 用【真实 covenant 交易】(covenant 输入 UTXO 上下文 + 续约输出 CovenantBinding)
// 做 serializeToSafeJSON → deserializeFromSafeJSON → finalize() 往返, 证 id_before === id_after 且 covenant 绑定/输入上下文都在;
// 再把这笔 covenant 交易喂 replayPreparedTransactions(假 RPC): 幂等接受(mempool 已有 ⇒ 不重发)/正常重播/拒绝(改字节 ⇒ txid 不等; 输入被花 ⇒ inputs_spent;
// 反序列化失败 ⇒ replay_bad_json ⇒ console 侧 hold)。全部离线, 零 RPC 零广播。
// 交易形照 relay p2sh.mjs bshard continuation(version 1, P2SH covenant 输入带 utxo.covenantId, no-sig scriptSig 押 redeem, 输出 CovenantBinding(0, covId)) + 一个 P2PK fee 输入真签名。
// Run: cd kasia-relay && node src/lib/covenant-roundtrip.test.mjs
//
// 🔴 合并交互(2026-09-13, coord/mainline-abc-merge 补第 4 笔): 同 serialize-roundtrip.test.mjs 头注——
//   本文件静态 import transaction.mjs 转引 rpc-listener.mjs 顶层的 b 分支 `_configuredNetwork()`(未设即 throw)。
//   修法同款: 自举子进程先设 KASPA_NETWORK 再动态 import。
import { spawnSync } from 'node:child_process';

if (!process.env._COVENANT_RT_TEST_BOOTSTRAPPED) {
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, _COVENANT_RT_TEST_BOOTSTRAPPED: '1', KASPA_NETWORK: process.env.KASPA_NETWORK || 'mainnet' },
  });
  process.exit(r.status ?? 1);
}

const kaspa = await import('kaspa-wasm');
const { replayPreparedTransactions } = await import('./transaction.mjs');

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
// 🔴 账本1468修复后改法: fee 输入(P2PK)活在 feeAddr, covenant 输入(leaf 等价物)活在它自己的 p2shAddr——
// 两者是两个不同地址, fakeRpc 按 replayPreparedTransactions 新逻辑(每个外部输入按自己 utxo.scriptPublicKey
// 派生地址分别查询)分别响应, 不再把两个 outpoint 硬塞进同一个 fee 地址的集合"模拟全部在"(那是修复前
// 用来绕开"只查 senderAddress 一个地址"这个真实限制的测试变通, 账本1468 修复后不再需要, 也不该再这样测
// ——真实还原两个地址各自独立的可花集, 才是这次修复要验证的东西)。
function fakeRpc({ mempool = new Set(), feeHas = [feeOutpoint], covHas = [covOutpoint], targetLanded = false, submitThrows = false } = {}) {
  const R = { submitted: [], mempool };
  R.getMempoolEntry = async ({ transactionId }) => { if (R.mempool.has(transactionId)) return { entry: { transactionId } }; throw new Error('not found'); };
  R.getUtxosByAddresses = async ([addr]) => {
    const a = String(addr);
    if (a === feeAddr.toString()) return { entries: feeHas.map(o => ({ outpoint: o })) };
    if (a === String(p2shAddr)) {
      const entries = covHas.map(o => ({ outpoint: o }));
      if (targetLanded) entries.push({ outpoint: { transactionId: idBefore, index: 0 } });
      return { entries };
    }
    return { entries: [] };
  };
  R.submitTransaction = async ({ transaction }) => { if (submitThrows) throw new Error('rejected (fake)'); R.submitted.push(transaction.id); R.mempool.add(transaction.id); return { transactionId: transaction.id }; };
  return R;
}
const call = (rpc, over = {}) => replayPreparedTransactions({ txJsonList: [json], expectedTxId: idBefore, senderAddress: feeAddr.toString(), targetAddress: String(p2shAddr), rpcOverride: rpc, ...over });
{ const rpc = fakeRpc(); const r = await call(rpc); ok(r.ok && r.replayed && r.txId === idBefore && rpc.submitted.length === 1 && rpc.submitted[0] === idBefore, 'replay covenant tx: 正常(fee 在 feeAddr、covenant 在它自己的 p2shAddr, 两者分别真实核对, 都在) → 同字节提交 1 笔, txId == 记录值'); }
{ const rpc = fakeRpc({ mempool: new Set([idBefore]) }); const r = await call(rpc); ok(r.ok && r.alreadyInMempool && rpc.submitted.length === 0, 'replay covenant tx: mempool 已有 → 幂等接受, 零提交'); }
{ const rpc = fakeRpc({ targetLanded: true }); const r = await call(rpc); ok(r.ok && r.alreadyLanded && rpc.submitted.length === 0, 'replay covenant tx: 续约输出已在 P2SH 地址 UTXO 集 → 幂等接受, 零提交'); }
{ const rpc = fakeRpc(); const r = await call(rpc, { txJsonList: [tampered] }); ok(!r.ok && r.code === 'replay_txid_mismatch' && rpc.submitted.length === 0, 'replay covenant tx: 改字节 → 拒(finalize 后 txid 不等), 零提交'); }
{ const rpc = fakeRpc({ feeHas: [] }); const r = await call(rpc); ok(!r.ok && r.code === 'inputs_spent' && rpc.submitted.length === 0, 'replay covenant tx: fee 输入不在它自己地址的可花集 → inputs_spent, 零提交(console 才允许重建)'); }
{ const rpc = fakeRpc({ covHas: [] }); const r = await call(rpc); ok(!r.ok && r.code === 'inputs_spent' && rpc.submitted.length === 0, `账本1468回归·真阳性: covenant 输入真的不在它自己 P2SH 地址的可花集(真被花了) → 依然正确判 inputs_spent, 零提交——修复没有把这条真实检测能力弄丢`); }
{
  // 账本1468回归·真阴性(核心修复目标): covenant 输入不在 feeAddr(它本来就不该在那)、但在它自己的
  // p2shAddr 里真实存在(从未被花) → 修复前会被误判 inputs_spent(旧逻辑只查 feeAddr 一个地址), 修复后
  // 必须正确放行——这正是账本1468真实故障复现的最小形状(genesis 刚落链、leaf 从未被花, 却被判"不再在")。
  const rpc = fakeRpc({ feeHas: [feeOutpoint], covHas: [covOutpoint] });
  // 双重确认 fakeRpc 语义本身没有作弊: 直接查 feeAddr 应该查不到 covOutpoint。
  const feeOnly = await rpc.getUtxosByAddresses([feeAddr.toString()]);
  ok(!feeOnly.entries.some(e => e.outpoint.transactionId === covOutpoint.transactionId && e.outpoint.index === covOutpoint.index), '账本1468回归·前提核实: covOutpoint 确实不在 feeAddr 的 UTXO 集里(不是巧合通过)');
  const r = await call(rpc);
  ok(r.ok && r.replayed && rpc.submitted.length === 1, '账本1468回归·真阴性: covenant 输入只在它自己的 p2shAddr(不在 feeAddr)也能被正确核对为"仍未花" → 不再误判 inputs_spent, 正常重播');
}
{ const rpc = fakeRpc(); const r = await call(rpc, { txJsonList: ['{"id":"zz"}'] }); ok(!r.ok && r.code === 'replay_bad_json' && rpc.submitted.length === 0, 'replay covenant tx: 往返失败(反序列化抛) → replay_bad_json, 零提交(console 侧 hold 人工)'); }
{ const rpc = fakeRpc({ submitThrows: true }); const r = await call(rpc); ok(!r.ok && r.code === 'replay_rejected' && rpc.submitted.length === 0, 'replay covenant tx: submit 抛错且 mempool 无 → replay_rejected(console 不重建)'); }
// harness 翻转臂
{ const before = fails; ok(back.id === 'ff'.repeat(32), 'harness-flip (expect FAIL)'); if (fails === before + 1) { fails--; console.log('  ✅ harness flip arm went red as required'); } else { fails++; } }

console.log(fails ? `\n❌ ${fails} failure(s)` : '\n✅ all covenant round-trip / replay vectors passed');
process.exit(fails ? 1 : 0);
