// offline 真 schema: runMigrations → temp DB; 加一张候选 intents 表(未迁移的期望形); 不碰 live。跑法: cd kasia-console && node ../scratch/_j2_refund_dedup/refund-dedup.v02.test.mjs
import assert from 'node:assert';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'rdd-'));
process.env.DB_PATH = join(dir, 't.db');
let repo = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(repo, 'kasia-console', 'package.json'))) { const up = dirname(repo); if (up === repo) throw new Error('repo root not found'); repo = up; }
const { sqlite: db } = await import(pathToFileURL(join(repo, 'kasia-console', 'src', 'db', 'client.js')).href);
const { runMigrations } = await import(pathToFileURL(join(repo, 'kasia-console', 'src', 'db', 'migrate.js')).href);
await runMigrations();
const { classifyRefundState, decideRefundAction, classifyQueueFailure, REFUND } = await import('./refund-dedup.v02.mjs');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const NOW = Date.parse('2026-08-29T10:00:00.000Z'); const iso = (ms) => new Date(ms).toISOString();
const USER = 'kaspatest:qq' + 'u'.repeat(59);
const H = (c) => c.repeat(64);
const SINCE = iso(NOW - 3600e3);
const rpcNone = () => [], covOk = () => ({ covered: true, holes: [] }), covHole = () => ({ covered: false, holes: [{ start_daa: 1, end_daa: 2 }] });
const base = { db, offerId: 'offer-1', orderId: 'order-1', userAddr: USER, amountKas: 87.9, sinceIso: SINCE, nowMs: NOW };
// 候选 intents 表 (期望迁移形; 测试自建)
db.exec(`CREATE TABLE IF NOT EXISTS broker_refund_intents (id TEXT PRIMARY KEY, order_id TEXT, offer_id TEXT, user_addr TEXT NOT NULL, amount_kas REAL NOT NULL, txid TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
const ceRefunded = (offerId, txid) => db.prepare(`INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at) VALUES (lower(hex(randomblob(16))), ?, 'broker_kas_refunded', NULL, ?, ?, 'test', ?)`).run(txid, USER, JSON.stringify({ offer_id: offerId, amount: 87.9 }), iso(NOW - 600e3));

// --- 无任何证据 ---
t('V1 无 intent/无行/无 RPC 注入 ⇒ UNKNOWN(rpc_lookup_unavailable) ⇒ hold_and_alert (不发)', () => { const r = classifyRefundState({ ...base }); assert.strictEqual(r.state, REFUND.UNKNOWN); assert.strictEqual(decideRefundAction(r.state).action, 'hold_and_alert'); });
t('V2 无 intent + RPC 无匹配 + 无 coverage 账 ⇒ UNKNOWN(coverage_ledger_unavailable)', () => { const r = classifyRefundState({ ...base, rpcUtxoLookup: rpcNone }); assert.strictEqual(r.state, REFUND.UNKNOWN); assert.ok(/coverage_ledger_unavailable/.test(r.reason)); });
t('V3 无 intent + RPC 无匹配 + coverage 有洞 ⇒ UNKNOWN(coverage_holes) — 索引漏行不再等于"未退"', () => { const r = classifyRefundState({ ...base, rpcUtxoLookup: rpcNone, indexerCoverage: covHole }); assert.strictEqual(r.state, REFUND.UNKNOWN); });
t('V4 无 intent + RPC 无匹配 + coverage 无洞 ⇒ NOT_REFUNDED ⇒ send', () => { const r = classifyRefundState({ ...base, rpcUtxoLookup: rpcNone, indexerCoverage: covOk }); assert.strictEqual(r.state, REFUND.NOT_REFUNDED); assert.strictEqual(decideRefundAction(r.state).action, 'send'); });
t('V5 RPC 抛 / 劣化 ⇒ UNKNOWN', () => { assert.strictEqual(classifyRefundState({ ...base, rpcUtxoLookup: () => { throw new Error('down'); }, indexerCoverage: covOk }).state, REFUND.UNKNOWN); assert.strictEqual(classifyRefundState({ ...base, rpcUtxoLookup: () => null, indexerCoverage: covOk }).state, REFUND.UNKNOWN); });
t('V6 RPC 见用户地址 87.9 UTXO ⇒ REFUNDED_CONFIRMED(rpc_utxo_match) ⇒ backfill', () => { const r = classifyRefundState({ ...base, rpcUtxoLookup: () => [{ amountKas: 87.9 }], indexerCoverage: covHole }); assert.strictEqual(r.state, REFUND.REFUNDED_CONFIRMED); assert.strictEqual(decideRefundAction(r.state).action, 'backfill_refunded'); });
// --- intent 账 (write-ahead) ---
t('V7 intent 有 txid 但 kaspa_tx_log 无行(索引漏) ⇒ REFUNDED_INTENT ⇒ verify_landing, 【不重发】 (v0.1 这里会重退)', () => {
  db.prepare(`INSERT INTO broker_refund_intents VALUES ('i1','order-1','offer-1',?,87.9,?,?,?)`).run(USER, H('a'), iso(NOW - 300e3), iso(NOW - 290e3));
  const r = classifyRefundState({ ...base, rpcUtxoLookup: rpcNone, indexerCoverage: covOk }); assert.strictEqual(r.state, REFUND.REFUNDED_INTENT); assert.strictEqual(decideRefundAction(r.state).action, 'verify_landing_then_backfill');
});
t('V8 intent 无 txid, 5 min 内 ⇒ INFLIGHT ⇒ wait', () => { db.prepare(`DELETE FROM broker_refund_intents`).run(); db.prepare(`INSERT INTO broker_refund_intents VALUES ('i2','order-1','offer-1',?,87.9,NULL,?,?)`).run(USER, iso(NOW - 300e3), iso(NOW - 300e3)); const r = classifyRefundState({ ...base, rpcUtxoLookup: rpcNone, indexerCoverage: covOk }); assert.strictEqual(r.state, REFUND.INFLIGHT); assert.strictEqual(decideRefundAction(r.state).action, 'wait'); });
t('V9 intent 无 txid, 超 30 min ⇒ UNKNOWN(intent_stale_ambiguous) ⇒ hold (可能已广播回执丢, 不重发)', () => { db.prepare(`UPDATE broker_refund_intents SET created_at = ?`).run(iso(NOW - 3600e3)); const r = classifyRefundState({ ...base, rpcUtxoLookup: rpcNone, indexerCoverage: covOk }); assert.strictEqual(r.state, REFUND.UNKNOWN); assert.strictEqual(r.reason, 'intent_stale_ambiguous'); db.prepare(`DELETE FROM broker_refund_intents`).run(); });
// --- chain_events (Phase 3) 不 join kaspa_tx_log ---
t('V10 chain_events broker_kas_refunded(offer_id) 存在 且 kaspa_tx_log 无该 txid ⇒ REFUNDED_CONFIRMED (v0.1 的 IN 子查询会把它排除 ⇒ 重退)', () => { ceRefunded('offer-1', H('b')); const r = classifyRefundState({ ...base, rpcUtxoLookup: rpcNone, indexerCoverage: covOk }); assert.strictEqual(r.state, REFUND.REFUNDED_CONFIRMED); assert.strictEqual(r.reason, 'chain_events_broker_kas_refunded'); });
t('V11 chain_events 是别的 offer ⇒ 不算 (offer_id 精确)', () => { const r = classifyRefundState({ ...base, offerId: 'offer-2', orderId: 'order-2', rpcUtxoLookup: rpcNone, indexerCoverage: covOk }); assert.strictEqual(r.state, REFUND.NOT_REFUNDED); });
t('V12 kaspa_tx_log 真行(肯定证据)命中 ⇒ REFUNDED_CONFIRMED 带 txid', () => { db.prepare(`INSERT INTO kaspa_tx_log (tx_id, to_address, amount, block_time, observed_at, network) VALUES (?, ?, 87.9, ?, ?, 'testnet-12')`).run(H('c'), USER, Math.floor((NOW - 100e3) / 1000), iso(NOW - 100e3)); const r = classifyRefundState({ ...base, offerId: 'offer-3', orderId: 'order-3', rpcUtxoLookup: rpcNone, indexerCoverage: covHole }); assert.strictEqual(r.state, REFUND.REFUNDED_CONFIRMED); assert.strictEqual(r.txid, H('c')); });
t('V13 bad args ⇒ UNKNOWN', () => { assert.strictEqual(classifyRefundState({ ...base, amountKas: 0 }).state, REFUND.UNKNOWN); assert.strictEqual(classifyRefundState({ ...base, userAddr: '' }).state, REFUND.UNKNOWN); });
// --- exchange 路形 (broker-cancel-refund.js:86 预筛: 只有 offer, 无 orderId; :123-148 unlinked draft / state-authority:550 no_offer: 只有 orderId) ---
t('X1 exchange 预筛形(offerId, orderId=null): chain_events(offer_id) 命中 ⇒ CONFIRMED(不 join log) — 预筛不再把已退 offer 重新呈现', () => { ceRefunded('offer-x1', H('d')); const r = classifyRefundState({ ...base, offerId: 'offer-x1', orderId: null, rpcUtxoLookup: rpcNone, indexerCoverage: covOk }); assert.strictEqual(r.state, REFUND.REFUNDED_CONFIRMED); });
t('X2 exchange 预筛形: intent(offer_id) 有 txid, orderId=null ⇒ REFUNDED_INTENT 不重发', () => { db.prepare(`INSERT INTO broker_refund_intents VALUES ('ix2',NULL,'offer-x2',?,87.9,?,?,?)`).run(USER, H('e'), iso(NOW - 300e3), iso(NOW - 290e3)); const r = classifyRefundState({ ...base, offerId: 'offer-x2', orderId: null, rpcUtxoLookup: rpcNone, indexerCoverage: covOk }); assert.strictEqual(r.state, REFUND.REFUNDED_INTENT); });
t('X3 no_offer 形(orderId, offerId=null): intent(order_id) 命中 ⇒ 不重发 (state-authority:550 findPriorRefundTxs 同 fail-open 的替代)', () => { db.prepare(`INSERT INTO broker_refund_intents VALUES ('ix3','order-x3',NULL,?,87.9,NULL,?,?)`).run(USER, iso(NOW - 60e3), iso(NOW - 60e3)); const r = classifyRefundState({ ...base, offerId: null, orderId: 'order-x3', rpcUtxoLookup: rpcNone, indexerCoverage: covOk }); assert.strictEqual(r.state, REFUND.INFLIGHT); });
t('X4 两 id 都空 ⇒ 仍能走 S3/S4/coverage 判 (纯地址+金额形), 无 intent/行 ⇒ NOT_REFUNDED 只在 coverage+rpc 齐时', () => { const r = classifyRefundState({ ...base, offerId: null, orderId: null, amountKas: 12.5, rpcUtxoLookup: rpcNone, indexerCoverage: covOk }); assert.strictEqual(r.state, REFUND.NOT_REFUNDED); assert.strictEqual(classifyRefundState({ ...base, offerId: null, orderId: null, amountKas: 12.5, rpcUtxoLookup: rpcNone }).state, REFUND.UNKNOWN); });
// --- X5 先例复现 (39ac2b69 时间线): 04-28 auto-expiry 退第一次(chain_events 记真 txid) → kaspa_tx_log 没索引到该 tx → 04-29 owner-cancel 二次尝试.
//     旧逻辑 (broker-refund-dedup.js:78-84 原 SQL 逐字作 oracle) 判"未退" ⇒ 【必须红】; 新逻辑 ⇒ CONFIRMED 拦.
t('X5 先例复现: auto-expiry 已退(chain_events 有真 txid, log 无行) → owner-cancel 再判: 旧 SQL 判未退(红=双退), 新 classify=REFUNDED_CONFIRMED(拦)', () => {
  const OWNER = 'kaspatest:qq' + 'o'.repeat(59);   // 独立地址/金额, 避免与 V12 的同人同额行混(那正是代码注释里的 cross-order false positive)
  db.prepare(`INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at) VALUES (lower(hex(randomblob(16))), ?, 'broker_kas_refunded', NULL, ?, ?, 'test', ?)`).run(H('f'), OWNER, JSON.stringify({ offer_id: 'offer-prec', amount: 88 }), iso(NOW - 86400e3));   // 第一次退款(auto-expiry): 真 64-hex txid; kaspa_tx_log 故意不插 (索引漏)
  const oldSql = db.prepare(`SELECT txid FROM chain_events WHERE event_type = 'broker_kas_refunded' AND payload LIKE '%"offer_id":"' || ? || '"%' AND txid IN (SELECT tx_id FROM kaspa_tx_log) LIMIT 1`).get('offer-prec');
  assert.strictEqual(oldSql, undefined, '旧 SQL 应判"未退"(这就是双退的根: IN kaspa_tx_log 把已记的退款排除)');
  const oldFallback = db.prepare(`SELECT tx_id FROM kaspa_tx_log WHERE to_address = ? AND amount BETWEEN ? AND ? AND block_time > ?`).all(OWNER, 87.99, 88.01, 0);
  assert.strictEqual(oldFallback.length, 0, '旧 fallback 同样空 ⇒ v0.1 alreadyRefunded=false ⇒ 第二次 sendKas');
  const r = classifyRefundState({ ...base, offerId: 'offer-prec', orderId: null, userAddr: OWNER, amountKas: 88, rpcUtxoLookup: rpcNone, indexerCoverage: covOk });
  assert.strictEqual(r.state, REFUND.REFUNDED_CONFIRMED); assert.strictEqual(decideRefundAction(r.state).action, 'backfill_refunded');
});
// --- 队列层: 歧义失败不得重试 sendKas ---
t('Q1 timeout / empty result / no txId ⇒ ambiguous, retry=false', () => { for (const m of ['relay timeout after 30000ms', 'no txId from sendCommandAsync (relay returned empty result)', 'socket hang up']) assert.strictEqual(classifyQueueFailure(m).retry, false, m); });
t('Q2 明确未广播的拒因 ⇒ definite_fail, retry=true', () => { for (const m of ['insufficient funds', 'Rejected transaction x: is not standard', 'invalid address']) assert.strictEqual(classifyQueueFailure(m).retry, true, m); });
t('Q3 未知文本 ⇒ 按 ambiguous 处理(保守)', () => { assert.strictEqual(classifyQueueFailure('weird').retry, false); assert.strictEqual(classifyQueueFailure('').retry, false); });

db.close(); rmSync(dir, { recursive: true, force: true });
console.log(`refund-dedup v02: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
