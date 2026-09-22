// proto-fee-reservation.test.mjs — F4(设计 v0.2.1 §3.2/§3.5, 账本1614/1615/1616): fee 输入预留。
// 真 migration 临时库(proto_settlement_intents 是本批唯一接线的 DB 派生源——proto_markets/proto_bet_intents
// 的 prepared_tx_json 在当前生产路径下从未真正写入, 见 proto-fee-reservation.mjs SOURCES 头注的实测更正,
// 本文件不再重复验证那两张表的"零动作", 因为它们本来就不在 SOURCES 里), 零链零 IPC。
// Run: cd kasia-console && node src/lib/proto-fee-reservation.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_FEE_RESERVATION_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_fee_reservation_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_FEE_RESERVATION_TEST_BOOTSTRAPPED: '1' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { createHash } = await import('node:crypto');
const {
  reservedFeeOutpoints, selectAndReserveFeeUtxo, releaseReservationOnPrepared, releaseReservationOnFailure,
  reconcileUncertainReservation, reservationLeakTelemetry, _snapshotInMemoryReserved, _resetInMemoryReserved,
  RESERVATION_UNCERTAIN_TIMEOUT_MS,
} = await import('./proto-fee-reservation.mjs');
const { ensureSettlementIntent, markSettlementIntent, settlementIntentKeyFor } = await import('./proto-settlement-intent.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}: ${JSON.stringify(cond)}`); fails++; } };
const hex = (seed) => createHash('sha256').update(seed).digest('hex');
const mid = (s) => hex('market-fr-' + s);
const txJsonWith = (outpoints) => JSON.stringify({ inputs: outpoints.map((o) => ({ transactionId: o.txid, index: o.vout })), outputs: [] });
const cand = (txid, vout, value = 50_000_000n) => ({ txid, vout, value, scriptPublicKeyHex: '0x00' });

console.log('[test] ① reservedFeeOutpoints(DB 派生层): 只认 proto_settlement_intents 非终态(prepared/submitted/ambiguous)行, pending/landed 不算; 解出全部输入 outpoint 的并集:');
{
  const M = mid('a'); const key = settlementIntentKeyFor('market', M, 'seal');
  ensureSettlementIntent({ subjectType: 'market', subjectId: M, step: 'seal' });   // status = pending, 无 tx_json
  ok(!reservedFeeOutpoints({ db: sqlite }).has(`${hex('op1')}:0`), 'pending 行不贡献任何 outpoint(还没构造)');

  markSettlementIntent(key, { status: 'prepared', prepared_tx_json: txJsonWith([{ txid: hex('op1'), vout: 0 }, { txid: hex('op2'), vout: 1 }]) });
  const r1 = reservedFeeOutpoints({ db: sqlite });
  ok(r1.has(`${hex('op1')}:0`) && r1.has(`${hex('op2')}:1`), 'prepared 行: 两个输入 outpoint 都进集合');

  const M2 = mid('b'); const key2 = settlementIntentKeyFor('market', M2, 'seal');
  ensureSettlementIntent({ subjectType: 'market', subjectId: M2, step: 'seal' });
  markSettlementIntent(key2, { status: 'submitted', prepared_tx_json: txJsonWith([{ txid: hex('op3'), vout: 0 }]), submitted_txid: hex('tx3') });
  ok(reservedFeeOutpoints({ db: sqlite }).has(`${hex('op3')}:0`), 'submitted 行同样贡献(未落链前仍占位)');

  markSettlementIntent(key2, { status: 'landed', landed_depth: 20, landed_at: new Date().toISOString() });
  ok(!reservedFeeOutpoints({ db: sqlite }).has(`${hex('op3')}:0`), 'landed(终态)⇒ 不再贡献(该行已落链, 输入已确定花掉/已确定失败, 不占位)');

  const M3 = mid('c'); const key3 = settlementIntentKeyFor('market', M3, 'seal');
  ensureSettlementIntent({ subjectType: 'market', subjectId: M3, step: 'seal' });
  markSettlementIntent(key3, { status: 'ambiguous', prepared_tx_json: txJsonWith([{ txid: hex('op4'), vout: 0 }]), last_error: 'inputs_spent' });
  ok(reservedFeeOutpoints({ db: sqlite }).has(`${hex('op4')}:0`), 'ambiguous(不确定是否已落链)⇒ 保守继续占位');
}

console.log('[test] ② M3 fail-closed: 非终态行 tx_json 缺失 / 损坏 ⇒ 整个 reservedFeeOutpoints 抛(不是跳过该行); 突变对照(手写等价"跳过"逻辑, 证明这条测试确实在守这个行为):');
{
  const M = mid('bad1'); const key = settlementIntentKeyFor('market', M, 'seal');
  ensureSettlementIntent({ subjectType: 'market', subjectId: M, step: 'seal' });
  markSettlementIntent(key, { status: 'prepared' });   // prepared 但 prepared_tx_json 仍是 NULL(prepared_without_bytes)
  let e1 = null; try { reservedFeeOutpoints({ db: sqlite }); } catch (x) { e1 = x; }
  ok(!!e1 && /fail-closed/.test(e1.message) && /prepared_without_bytes/.test(e1.message), 'prepared 行缺字节 ⇒ 抛(HOLD), 不是当它不存在');
  markSettlementIntent(key, { status: 'landed', landed_depth: 1, landed_at: new Date().toISOString() });   // 清掉, 不污染后面的测试

  const M2 = mid('bad2'); const key2 = settlementIntentKeyFor('market', M2, 'seal');
  ensureSettlementIntent({ subjectType: 'market', subjectId: M2, step: 'seal' });
  markSettlementIntent(key2, { status: 'prepared', prepared_tx_json: '{not valid json' });
  let e2 = null; try { reservedFeeOutpoints({ db: sqlite }); } catch (x) { e2 = x; }
  ok(!!e2 && /fail-closed/.test(e2.message), 'JSON 损坏 ⇒ 抛');
  markSettlementIntent(key2, { status: 'landed', landed_depth: 1, landed_at: new Date().toISOString() });

  const M3 = mid('bad3'); const key3 = settlementIntentKeyFor('market', M3, 'seal');
  ensureSettlementIntent({ subjectType: 'market', subjectId: M3, step: 'seal' });
  markSettlementIntent(key3, { status: 'prepared', prepared_tx_json: JSON.stringify({ outputs: [] }) });   // 缺 inputs 数组
  let e3 = null; try { reservedFeeOutpoints({ db: sqlite }); } catch (x) { e3 = x; }
  ok(!!e3 && /fail-closed/.test(e3.message), '缺 inputs 数组 ⇒ 抛');
  markSettlementIntent(key3, { status: 'landed', landed_depth: 1, landed_at: new Date().toISOString() });

  // 突变说明性断言(同 R-a 既有写法): 若把"抛"改成"跳过该行继续扫其它行", 下面这个断言会不成立——
  // 证明当前实现选的是"抛"这一支, 不是巧合地两支行为一样。
  const M4 = mid('bad4'); const key4 = settlementIntentKeyFor('market', M4, 'seal');
  ensureSettlementIntent({ subjectType: 'market', subjectId: M4, step: 'seal' });
  markSettlementIntent(key4, { status: 'prepared' });
  const M5 = mid('good5'); const key5 = settlementIntentKeyFor('market', M5, 'seal');
  ensureSettlementIntent({ subjectType: 'market', subjectId: M5, step: 'seal' });
  markSettlementIntent(key5, { status: 'prepared', prepared_tx_json: txJsonWith([{ txid: hex('op5'), vout: 0 }]) });
  let threw = false; try { reservedFeeOutpoints({ db: sqlite }); } catch { threw = true; }
  ok(threw, '一坏一好混在一起扫描 ⇒ 整体抛(不是"跳过坏的, 只返回好的那条"——若是"跳过", threw 会是 false)');
  markSettlementIntent(key4, { status: 'landed', landed_depth: 1, landed_at: new Date().toISOString() });
  markSettlementIntent(key5, { status: 'landed', landed_depth: 1, landed_at: new Date().toISOString() });
}

console.log('[test] ③ selectAndReserveFeeUtxo: T-race-sequential(DB 层已占的候选被排除)+ 进程内层(同一 tick 内先选中的候选, 第二次选择立即被排除, 不需要等 DB 写入)+ 选择失败无副作用:');
{
  _resetInMemoryReserved();
  const A = cand(hex('r1'), 0), B = cand(hex('r2'), 0);
  const fakeBuild = (u) => ({ ok: true, feeUtxo: u });
  const fakeSelect = (candidates, tryBuild) => {
    if (!candidates.length) throw new Error('selectFeeUtxoByConstruction: no_suitable_fee_utxo(候选被排空)');
    return { feeUtxo: candidates[0], built: tryBuild(candidates[0]) };
  };
  const r1 = selectAndReserveFeeUtxo({ candidates: [A, B], tryBuild: fakeBuild, readReserved: () => new Set(), intentKey: 'k1', selectFeeUtxoByConstruction: fakeSelect });
  ok(r1.feeUtxo.txid === A.txid, '第一次选中 A(升序/首个可行)');
  const snap1 = _snapshotInMemoryReserved();
  ok(snap1.has(`${A.txid}:0`) && snap1.get(`${A.txid}:0`).intentKey === 'k1', '选中后立即记入进程内预留层(同步段内, 不需要等 DB 写入)');

  const r2 = selectAndReserveFeeUtxo({ candidates: [A, B], tryBuild: fakeBuild, readReserved: () => new Set(), intentKey: 'k2', selectFeeUtxoByConstruction: fakeSelect });
  ok(r2.feeUtxo.txid === B.txid, 'T-race-sequential: A 已被进程内层占, 第二次选择自动跳过 A 选 B(不需要等 DB, 这正是 A 臂 genesis_ambiguous 死锁要治的窗口)');

  let e4 = null;
  try { selectAndReserveFeeUtxo({ candidates: [A, B], tryBuild: fakeBuild, readReserved: () => new Set([`${A.txid}:0`, `${B.txid}:0`]), intentKey: 'k4', selectFeeUtxoByConstruction: fakeSelect }); }
  catch (x) { e4 = x; }
  ok(!!e4 && /no_suitable_fee_utxo/.test(e4.message), 'DB 派生层已占的候选(readReserved 返回的集合)同样被排除; 全占满 ⇒ selectFeeUtxoByConstruction 报 no_suitable_fee_utxo');

  releaseReservationOnPrepared(A); releaseReservationOnFailure(B);
  ok(_snapshotInMemoryReserved().size === 0, '释放两个 ⇒ 进程内层清空');

  const C = cand(hex('r5'), 0);
  const failSelect = () => { throw new Error('selectFeeUtxoByConstruction: no_suitable_fee_utxo(全部真实构造失败)'); };
  let e5 = null;
  try { selectAndReserveFeeUtxo({ candidates: [C], tryBuild: fakeBuild, readReserved: () => new Set(), intentKey: 'k5', selectFeeUtxoByConstruction: failSelect }); }
  catch (x) { e5 = x; }
  ok(!!e5, '选择失败 ⇒ 原样向上抛');
  ok(_snapshotInMemoryReserved().size === 0, '选择失败(还没选中就抛)⇒ 不留任何预留残留(无副作用)');
}

console.log('[test] ④ readReserved 抛错(M3 fail-closed 的传导): selectAndReserveFeeUtxo 原样向上抛, 不吞不跳过, 不记入任何预留:');
{
  _resetInMemoryReserved();
  const readReserved = () => { throw new Error('reservedFeeOutpoints: fail-closed — 模拟坏行'); };
  let e = null;
  try { selectAndReserveFeeUtxo({ candidates: [cand(hex('r6'), 0)], tryBuild: (u) => u, readReserved, intentKey: 'k6', selectFeeUtxoByConstruction: () => { throw new Error('不该走到这里'); } }); }
  catch (x) { e = x; }
  ok(!!e && /fail-closed/.test(e.message), 'readReserved 抛 ⇒ selectAndReserveFeeUtxo 原样向上抛(不掩盖, 调用方据此判 HOLD)');
  ok(_snapshotInMemoryReserved().size === 0, '不记入任何预留');
}

console.log('[test] ⑤ reconcileUncertainReservation: 有 ⇒ 移交 DB 层(released 语义外); 无 ⇒ 释放; 两种结局都从内存层移除:');
{
  _resetInMemoryReserved();
  const A = cand(hex('r7'), 0);
  selectAndReserveFeeUtxo({ candidates: [A], tryBuild: (u) => ({ ok: true }), readReserved: () => new Set(), intentKey: 'k7', selectFeeUtxoByConstruction: (c, tb) => ({ feeUtxo: c[0], built: tb(c[0]) }) });
  ok(_snapshotInMemoryReserved().has(`${A.txid}:0`), '前置: 已预留');
  const res1 = reconcileUncertainReservation({ txid: A.txid, vout: 0 }, () => true);
  ok(res1.action === 'handed_to_db_layer', 'DB 里已有 prepared 字节 ⇒ handed_to_db_layer');
  ok(!_snapshotInMemoryReserved().has(`${A.txid}:0`), '移交后从内存层移除(不是"续期")');

  const B = cand(hex('r8'), 0);
  selectAndReserveFeeUtxo({ candidates: [B], tryBuild: (u) => ({ ok: true }), readReserved: () => new Set(), intentKey: 'k8', selectFeeUtxoByConstruction: (c, tb) => ({ feeUtxo: c[0], built: tb(c[0]) }) });
  const res2 = reconcileUncertainReservation({ txid: B.txid, vout: 0 }, () => false);
  ok(res2.action === 'released', 'DB 里无痕迹 ⇒ released');
  ok(!_snapshotInMemoryReserved().has(`${B.txid}:0`), '释放后从内存层移除, 之后可再被选中');

  const res3 = reconcileUncertainReservation({ txid: hex('never-reserved'), vout: 0 }, () => true);
  ok(res3.action === 'noop', '对没预留过的 outpoint 对账 ⇒ noop(不误建条目)');
  ok(Number.isInteger(RESERVATION_UNCERTAIN_TIMEOUT_MS) && RESERVATION_UNCERTAIN_TIMEOUT_MS >= 30_000, 'RESERVATION_UNCERTAIN_TIMEOUT_MS ≥ 30s(≥2× IPC 超时下界, 设计 §3.2 B.2)');
}

console.log('[test] ⑥ reservationLeakTelemetry: 预留数 / 最老年龄:');
{
  _resetInMemoryReserved();
  ok(reservationLeakTelemetry().count === 0, '空 ⇒ count 0');
  const A = cand(hex('r9'), 0);
  selectAndReserveFeeUtxo({ candidates: [A], tryBuild: (u) => ({ ok: true }), readReserved: () => new Set(), intentKey: 'k9', selectFeeUtxoByConstruction: (c, tb) => ({ feeUtxo: c[0], built: tb(c[0]) }) });
  const t1 = reservationLeakTelemetry({ nowMs: Date.now() + 5000 });
  ok(t1.count === 1 && t1.oldestAgeMs >= 5000, '有一条预留 ⇒ count=1, oldestAgeMs 反映经过的时间');
  releaseReservationOnPrepared(A);
  ok(reservationLeakTelemetry().count === 0, '释放后 ⇒ count 回 0');
}

console.log(fails === 0 ? '\n✅✅ ALL PASS — proto-fee-reservation(DB 派生层 M1/M3 + 进程内层 T-race/释放/对账/遥测)' : `\n❌ ${fails} assertions failed`);
process.exitCode = fails === 0 ? 0 : 1;
