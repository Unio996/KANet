// serialize-roundtrip.test.mjs — (c) F2-R relay 侧离线向量 (J2 2026-09-13, 设计 v0.3 §7 Q6 + F2-R 四向量的 relay 半边)。
// 守什么:
//   Q6  Generator→sign→serializeToSafeJSON→deserializeFromSafeJSON 往返 txid 不变(签名前后也不变) ; 改一字节(输出金额) ⇒ txid 变
//   replayPreparedTransactions(假 rpc): txid 不等 ⇒ replay_txid_mismatch(零提交) · mempool 已有 ⇒ alreadyInMempool(零提交) ·
//        收款地址已落 ⇒ alreadyLanded(零提交) · 外部输入不在发送方 UTXO 集 ⇒ inputs_spent(零提交) · 正常 ⇒ 提交 1 笔同 txid ·
//        submit 抛错但 mempool 随后有 ⇒ ok(不靠报错串)
//   transferWithIntentRelay(假 sendKaspa/假回执): prepared 回执失败 ⇒ 零广播(fail-closed) · 正常 ⇒ prepared 在广播前、submitted 在后 ·
//        同 key 二次 ⇒ reused 零广播 · replay 路 ⇒ 走 replayFn 不走 sendKaspa
// Run: cd kasia-relay && node src/lib/serialize-roundtrip.test.mjs
//
// 🔴 合并交互(2026-09-13, coord/mainline-abc-merge 补第 4 笔): b 分支给 rpc-listener.mjs 顶层加了
//   `const KASPA_NETWORK = _configuredNetwork();`(未设 KASPA_NETWORK 即 throw, 活 relay 进程本该如此暴露)。
//   本文件静态 import transaction.mjs → 转引 rpc-listener.mjs, 在 c 分支单独存在时这条转引链没有这一步,
//   b+c 合流后才炸。修法照抄 rpc-health-datacheck.test.mjs 的"自举子进程先设 env 再动态 import"套路:
//   ESM 静态 import 会被提升到本文件任何语句之前执行, 文件顶部加一行 `process.env.KASPA_NETWORK=...`
//   救不了(顶层 import 早就跑完了)——自举子进程在 spawnSync 时把 env 传进去, 子进程里再用 await import()
//   延后到运行期才加载 transaction.mjs/submit-intent-relay.mjs 的模块图, 此时 env 已经在。
import { spawnSync } from 'node:child_process';

if (!process.env._SERIALIZE_RT_TEST_BOOTSTRAPPED) {
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, _SERIALIZE_RT_TEST_BOOTSTRAPPED: '1', KASPA_NETWORK: process.env.KASPA_NETWORK || 'mainnet' },
  });
  process.exit(r.status ?? 1);
}

const kaspa = await import('kaspa-wasm');
const { replayPreparedTransactions } = await import('./transaction.mjs');
const { transferWithIntentRelay, _intentDoneSize } = await import('./submit-intent-relay.mjs');

const { Keypair, Generator, PaymentOutput, Address, Transaction } = kaspa;
let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const quiet = () => {};

// ── 离线造一笔真签名交易 ──
const kp = Keypair.random();
const sender = kp.toAddress('mainnet');
const spk = kaspa.payToAddressScript(sender);
const OUTPOINT = { transactionId: 'aa'.repeat(32), index: 0 };
const entries = [{ address: sender, outpoint: OUTPOINT, amount: 500_000_000n, scriptPublicKey: spk, blockDaaScore: 1000n, isCoinbase: false }];
const recipient = Keypair.random().toAddress('mainnet');
const gen = new Generator({ entries, outputs: [new PaymentOutput(new Address(recipient.toString()), 100_000_000n)], priorityFee: 3_000_000n, changeAddress: sender, networkId: 'mainnet' });
const pendings = []; let p; while ((p = await gen.next())) pendings.push(p);
const pt = pendings[0];
const idPreSign = pt.id;
await pt.sign([kp.privateKey]);
const json = pt.serializeToSafeJSON();
const back = Transaction.deserializeFromSafeJSON(json);
ok(pendings.length === 1 && idPreSign === pt.id && back.id === pt.id, `Q6: txid 签名前后 + 序列化往返不变 (${pt.id.slice(0, 12)})`);
// 改一字节: 输出金额 100000000 → 100000001。🔴 实测陷阱: safe JSON 自带 "id", deserializeFromSafeJSON 信它不重算 ⇒ 改了字节 id 照旧;
//   finalize() 才从字节重算 ⇒ replayPreparedTransactions 必须 finalize 后再断言(否则断言空)。两臂都钉住。
const tampered = json.replace('"value":"100000000"', '"value":"100000001"');
const tamperedTx = Transaction.deserializeFromSafeJSON(tampered);
const embeddedId = tamperedTx.id;
tamperedTx.finalize();
ok(tampered !== json && embeddedId === pt.id, 'Q6-陷阱: deserializeFromSafeJSON 信 JSON 里的 id(改了字节 id 照旧) — 不 finalize 的断言是空的');
ok(tamperedTx.id !== pt.id && String(Transaction.deserializeFromSafeJSON(json).finalize()) === pt.id, `Q6: finalize() 从字节重算 ⇒ 改一字节 txid 变 (${tamperedTx.id.slice(0, 12)}); 未改的重算 == 原 id`);

// ── 假 rpc ──
function fakeRpc({ mempool = new Set(), senderUtxos = [OUTPOINT], targetLanded = false, submitThrows = false, mempoolAfterThrow = false } = {}) {
  const R = { submitted: [], mempool };
  R.getMempoolEntry = async ({ transactionId }) => { if (R.mempool.has(transactionId)) return { entry: { transactionId } }; throw new Error('not found'); };
  R.getUtxosByAddresses = async ([addr]) => {
    const a = String(addr);
    if (a === sender.toString()) return { entries: senderUtxos.map(o => ({ outpoint: o, amount: 500_000_000n })) };
    if (targetLanded) return { entries: [{ outpoint: { transactionId: pt.id, index: 0 }, amount: 100_000_000n }] };
    return { entries: [] };
  };
  R.submitTransaction = async ({ transaction }) => {
    if (submitThrows) { if (mempoolAfterThrow) R.mempool.add(transaction.id); throw new Error('Rejected transaction: already in mempool (fake)'); }
    R.submitted.push(transaction.id); R.mempool.add(transaction.id); return { transactionId: transaction.id };
  };
  return R;
}
const call = (rpc, over = {}) => replayPreparedTransactions({ txJsonList: [json], expectedTxId: pt.id, senderAddress: sender.toString(), targetAddress: recipient.toString(), rpcOverride: rpc, ...over });

{ const rpc = fakeRpc(); const r = await call(rpc, { expectedTxId: 'ff'.repeat(32) }); ok(!r.ok && r.code === 'replay_txid_mismatch' && rpc.submitted.length === 0, 'replay: prepared_txid ≠ bytes txid → 拒, 零提交'); }
{ const rpc = fakeRpc(); const r = await call(rpc, { txJsonList: [tampered] }); ok(!r.ok && r.code === 'replay_txid_mismatch' && rpc.submitted.length === 0, 'replay: 被改过的字节 → txid 不等 → 拒(F2-R-弱注入 b relay 半边)'); }
{ const rpc = fakeRpc({ mempool: new Set([pt.id]) }); const r = await call(rpc); ok(r.ok && r.alreadyInMempool && rpc.submitted.length === 0, 'replay: mempool 已有 → 不再广播'); }
{ const rpc = fakeRpc({ targetLanded: true }); const r = await call(rpc); ok(r.ok && r.alreadyLanded && rpc.submitted.length === 0, 'replay: 收款地址已落 → 不再广播'); }
{ const rpc = fakeRpc({ senderUtxos: [] }); const r = await call(rpc); ok(!r.ok && r.code === 'inputs_spent' && rpc.submitted.length === 0, 'replay: 外部输入不在发送方 UTXO 集 → inputs_spent, 零提交(F2-R-3 relay 半边)'); }
{ const rpc = fakeRpc(); const r = await call(rpc); ok(r.ok && r.replayed && r.txId === pt.id && rpc.submitted.length === 1 && rpc.submitted[0] === pt.id, 'replay: 正常 → 同字节提交 1 笔, txId == prepared'); }
{ const rpc = fakeRpc({ submitThrows: true, mempoolAfterThrow: true }); const r = await call(rpc); ok(r.ok && r.txId === pt.id, 'replay: submit 抛错但 mempool 有它 → ok(活性判定, 不解析报错串)'); }
{ const rpc = fakeRpc({ submitThrows: true }); const r = await call(rpc); ok(!r.ok && r.code === 'replay_rejected', 'replay: submit 抛错且 mempool 无 → replay_rejected(console 侧不重建)'); }
{ const r = await call(fakeRpc(), { txJsonList: ['not json'] }); ok(!r.ok && r.code === 'replay_bad_json', 'replay: 坏 JSON → replay_bad_json'); }

// ── transferWithIntentRelay ──
function fakeSendKaspa(state) {
  return async ({ to, amount, beforeSubmit }) => {
    const list = [{ txid: 'ee'.repeat(32), txJson: '{"fake":1}' }];
    await beforeSubmit(list);   // 回执失败 ⇒ throw ⇒ 不广播
    state.broadcasts++;
    return { txId: list[0].txid, fee: '0.03' };
  };
}
{ const st = { broadcasts: 0 }; const phases = [];
  const ingest = async (x) => { phases.push(x.phase); if (x.phase === 'prepared') throw new Error('HTTP 503'); };
  let err = null;
  try { await transferWithIntentRelay({ cmd: { intent_key: 'k1', target: 't', amount: '1' }, sendKaspa: fakeSendKaspa(st), localAddress: 's', log: quiet, ingestPhase: ingest }); } catch (e) { err = e; }
  ok(err && st.broadcasts === 0 && phases.join() === 'prepared', 'intent fresh: prepared 回执失败 → 零广播(fail-closed)'); }
{ const st = { broadcasts: 0 }; const phases = [];
  const ingest = async (x) => { phases.push(`${x.phase}:${st.broadcasts}`); };
  const r = await transferWithIntentRelay({ cmd: { intent_key: 'k2', target: 't', amount: '1' }, sendKaspa: fakeSendKaspa(st), localAddress: 's', log: quiet, ingestPhase: ingest });
  ok(r.ok && st.broadcasts === 1 && phases.join() === 'prepared:0,submitted:1', 'intent fresh: prepared 在广播前(计数 0)、submitted 在广播后(计数 1)');
  const r2 = await transferWithIntentRelay({ cmd: { intent_key: 'k2', target: 't', amount: '1' }, sendKaspa: fakeSendKaspa(st), localAddress: 's', log: quiet, ingestPhase: ingest });
  ok(r2.ok && r2.reused && r2.txId === r.txId && st.broadcasts === 1 && _intentDoneSize() >= 1, 'intent 进程内幂等: 同 key 二次 → reused, 零广播'); }
{ const st = { broadcasts: 0 }; let replayed = null;
  const r = await transferWithIntentRelay({ cmd: { intent_key: 'k3', target: 't', amount: '1', replay_tx_json: JSON.stringify([json]), prepared_txid: pt.id }, sendKaspa: fakeSendKaspa(st), localAddress: sender.toString(), log: quiet, ingestPhase: async () => {}, replayFn: async (a) => { replayed = a; return { ok: true, txId: a.expectedTxId, replayed: true }; } });
  ok(r.ok && r.replayed && replayed?.expectedTxId === pt.id && st.broadcasts === 0, 'intent replay: 走 replayFn, 不走 sendKaspa'); }
{ const r = await transferWithIntentRelay({ cmd: { intent_key: 'k4', target: 't', amount: '1', replay_tx_json: 'nope', prepared_txid: pt.id }, sendKaspa: fakeSendKaspa({ broadcasts: 0 }), localAddress: 's', log: quiet, ingestPhase: async () => {} });
  ok(!r.ok && r.code === 'replay_bad_json', 'intent replay: 坏 JSON → replay_bad_json'); }
// harness 翻转臂
{ const before = fails; ok(back.id === 'ff'.repeat(32), 'harness-flip (expect FAIL)'); if (fails === before + 1) { fails--; console.log('  ✅ harness flip arm went red as required'); } else { fails++; } }

console.log(fails ? `\n❌ ${fails} failure(s)` : '\n✅ all relay round-trip / replay / intent vectors passed');
process.exit(fails ? 1 : 0);
