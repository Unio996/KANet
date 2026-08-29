// broker-hold-monitor 四个数 + 阈值 + 去重告警 (真 schema temp DB; 只读语义). 跑法: cd kasia-console && node src/services/broker-hold-monitor.test.mjs
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'hold-'));
process.env.DB_PATH = join(dir, 't.db');
const { sqlite: db } = await import('../db/client.js');
const { runMigrations } = await import('../db/migrate.js');
await runMigrations();
const { computeHoldMetrics, breaches, alertBreachesOnce, THRESHOLDS } = await import('./broker-hold-monitor.mjs');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const NOW = '2026-08-29T10:00:00.000Z';
const ENUMS = (() => { const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='retail_dex_orders'`).get().sql; const m = {}; for (const x of sql.matchAll(/(\w+)\s+TEXT[^,]*?CHECK\s*\(\s*\1\s+IN\s*\(([^)]*)\)/g)) m[x[1]] = x[2].split(',')[0].trim().replace(/^'|'$/g, ''); return m; })();
function mkOrder(id, state, updatedAt) {
  const cols = db.prepare(`PRAGMA table_info(retail_dex_orders)`).all();
  const want = { id, state, side: 'sell_kas', user_kasia_address: 'kaspatest:qq' + 'u'.repeat(59), qty: 1, created_at: updatedAt, updated_at: updatedAt };
  for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in want)) want[c.name] = ENUMS[c.name] ?? (c.type === 'INTEGER' || c.type === 'REAL' ? 0 : 'x');
  const names = Object.keys(want); db.prepare(`INSERT INTO retail_dex_orders (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((n) => want[n]));
}
t('H1 空库: 四数 = 0/0/0/null(无账无心跳), 无 breach', () => { const m = computeHoldMetrics(db, NOW); assert.deepStrictEqual([m.held, m.stuck_refunding, m.intent_stale, m.coverage_lag_daa], [0, 0, 0, null]); assert.deepStrictEqual(breaches(m), []); assert.deepStrictEqual(m.errors, []); });
t('H2 refunding 40 min ⇒ stuck=1 breach; refunding 5 min 不算', () => { mkOrder('s1', 'refunding', '2026-08-29T09:20:00.000Z'); mkOrder('s2', 'refunding', '2026-08-29T09:55:00.000Z'); const m = computeHoldMetrics(db, NOW); assert.strictEqual(m.stuck_refunding, 1); assert.ok(breaches(m).some((b) => b.metric === 'stuck_refunding')); });
t('H3 intent 无 txid 超 30 min ⇒ intent_stale=1; 有 txid 或 30 min 内不算', () => {
  db.prepare(`INSERT INTO broker_refund_intents (id, order_id, offer_id, user_addr, amount_kas, txid, created_at, updated_at) VALUES ('i1','o1',NULL,'a',1,NULL,'2026-08-29T09:00:00.000Z','2026-08-29T09:00:00.000Z'), ('i2','o2',NULL,'a',1,NULL,'2026-08-29T09:50:00.000Z','2026-08-29T09:50:00.000Z'), ('i3','o3',NULL,'a',1,'${'f'.repeat(64)}','2026-08-29T08:00:00.000Z','2026-08-29T08:00:00.000Z')`).run();
  const m = computeHoldMetrics(db, NOW); assert.strictEqual(m.intent_stale, 1); assert.strictEqual(m.detail.intent_stale[0].id, 'i1');
});
t('H4 coverage_lag: 心跳 tip=5000, 账 max end=1000 ⇒ lag=4000 ≥ 3600 breach; 账 max=4900 ⇒ 100 不 breach', () => {
  db.prepare(`INSERT INTO spc_tip_heartbeat (id, daa_score, updated_at) VALUES (1, 5000, ?)`).run(NOW);
  db.prepare(`INSERT INTO kaspa_tx_log_coverage (network,address,start_daa,end_daa,indexer,updated_at) VALUES ('testnet-12','a',900,1000,'relay:x',?)`).run(NOW);
  let m = computeHoldMetrics(db, NOW); assert.strictEqual(m.coverage_lag_daa, 4000); assert.ok(breaches(m).some((b) => b.metric === 'coverage_lag_daa'));
  db.prepare(`INSERT INTO kaspa_tx_log_coverage (network,address,start_daa,end_daa,indexer,updated_at) VALUES ('testnet-12','b',4800,4900,'kaspa-scout',?)`).run(NOW);
  m = computeHoldMetrics(db, NOW); assert.strictEqual(m.coverage_lag_daa, 100); assert.ok(!breaches(m).some((b) => b.metric === 'coverage_lag_daa'));
});
t('H5 held_for_review 单(枚举未扩时无法插; 用 breaches 纯函数验阈值语义)', () => { assert.deepStrictEqual(breaches({ held: 1, stuck_refunding: 0, intent_stale: 0, coverage_lag_daa: null }), [{ metric: 'held', value: 1 }]); assert.strictEqual(THRESHOLDS.coverage_lag_daa, 3600); });
t('H7 unknown_1h: 60 min 内 refund_unknown_hold/broker_escrow_unknown 事件合计; ≥3 breach; 61 min 前不算', () => {
  const ins = db.prepare(`INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at) VALUES (lower(hex(randomblob(16))), 'system', ?, 't', 'warn', '', '{}', ?)`);
  ins.run('refund_unknown_hold', '2026-08-29T09:30:00.000Z'); ins.run('broker_escrow_unknown', '2026-08-29T09:45:00.000Z'); ins.run('refund_unknown_hold', '2026-08-29T08:58:00.000Z');
  let m = computeHoldMetrics(db, NOW); assert.strictEqual(m.unknown_1h, 2); assert.ok(!breaches(m).some((b) => b.metric === 'unknown_1h'));
  ins.run('refund_unknown_hold', '2026-08-29T09:59:00.000Z'); m = computeHoldMetrics(db, NOW); assert.strictEqual(m.unknown_1h, 3); assert.ok(breaches(m).some((b) => b.metric === 'unknown_1h' && b.value === 3));
});
t('H6 alertBreachesOnce: 同 hour bucket 去重; 下一小时再写', () => { const list = [{ metric: 'stuck_refunding', value: 1 }]; assert.strictEqual(alertBreachesOnce(db, list, NOW), 1); assert.strictEqual(alertBreachesOnce(db, list, NOW), 0); assert.strictEqual(alertBreachesOnce(db, list, '2026-08-29T11:00:00.000Z'), 1); assert.strictEqual(db.prepare(`SELECT count(*) AS n FROM events WHERE event_type='broker_hold_stuck_refunding'`).get().n, 2); });
db.close(); rmSync(dir, { recursive: true, force: true });
console.log(`hold-monitor: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
