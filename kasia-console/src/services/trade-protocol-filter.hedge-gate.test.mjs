// DEFECT1b 可见性补丁向量 (race 盘点 §8/§10.1; NWT P2; Bettor GO): 门 SELECT meta 抛 ⇒ 记事件 + skip, 不开对冲; 列名红线不动。
// 跑: cd kasia-console && node src/services/trade-protocol-filter.hedge-gate.test.mjs  (真 schema)
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'hedgegate-'));
process.env.DB_PATH = join(dir, 't.db');
const { sqlite: db } = await import('../db/client.js');
const { runMigrations } = await import('../db/migrate.js');
await runMigrations();
const tpf = await import('./trade-protocol-filter.js');
const { executeHedge, _isMissingColumnError, _recordHedgeGateError } = tpf;
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'trade-protocol-filter.js'), 'utf8');
const cols = db.prepare(`PRAGMA table_info(exchange_offers)`).all().map((c) => c.name);
await t('G0 前提: 真 schema exchange_offers 无 meta 列 (有 metadata)', () => { assert.ok(!cols.includes('meta') && cols.includes('metadata'), cols.join(',')); });
await t('G1 (向量①) 列不存在 ⇒ executeHedge 不抛、返回 undefined; chain_events hedge_gate_error 1 条 (txid=offer_id, payload.error 含 no such column: meta); events 1 条; 无 hedge% 事件 (后半未执行)', async () => {
  const r = await executeHedge('offer-gate-1', 'agent-x', 'SELL', 1.5);
  assert.strictEqual(r, undefined);
  const ce = db.prepare(`SELECT txid, payload FROM chain_events WHERE event_type = 'hedge_gate_error'`).all();
  assert.strictEqual(ce.length, 1); assert.strictEqual(ce[0].txid, 'offer-gate-1'); assert.ok(/no such column: meta/.test(JSON.parse(ce[0].payload).error));
  assert.strictEqual(db.prepare(`SELECT count(*) AS n FROM events WHERE event_type = 'hedge_gate_error'`).get().n, 1);
  assert.strictEqual(db.prepare(`SELECT count(*) AS n FROM chain_events WHERE event_type LIKE 'hedge_%' AND event_type != 'hedge_gate_error'`).get().n, 0, '对冲后半不得执行');
});
await t('G1b 节流: 同 offer 再调 ⇒ chain_events/events 仍各 1 条; 另一 offer ⇒ 各 +1', async () => {
  await executeHedge('offer-gate-1', 'agent-x', 'SELL', 1.5);
  assert.strictEqual(db.prepare(`SELECT count(*) AS n FROM chain_events WHERE event_type = 'hedge_gate_error'`).get().n, 1);
  assert.strictEqual(db.prepare(`SELECT count(*) AS n FROM events WHERE event_type = 'hedge_gate_error'`).get().n, 1);
  await executeHedge('offer-gate-2', 'agent-x', 'BUY', 2);
  assert.strictEqual(db.prepare(`SELECT count(*) AS n FROM chain_events WHERE event_type = 'hedge_gate_error'`).get().n, 2);
});
await t('G2 (向量②) 只裹 no such column: _isMissingColumnError 对 busy/其它 ⇒ false; 源级 catch 体含 `if (!_isMissingColumnError(e)) throw e`', () => {
  assert.strictEqual(_isMissingColumnError(new Error('no such column: meta')), true);
  assert.strictEqual(_isMissingColumnError({ message: 'SQLITE_BUSY: database is locked' }), false);
  assert.strictEqual(_isMissingColumnError(new Error('no such table: exchange_offers')), false);
  assert.strictEqual(_isMissingColumnError(null), false);
  const gate = SRC.slice(SRC.indexOf('async function _executeHedge('), SRC.indexOf('async function _executeHedge(') + 2500);
  assert.ok(/catch \(e\) \{\s*if \(!_isMissingColumnError\(e\)\) throw e;/.test(gate), '其它异常须原路抛');
  assert.ok(/_recordHedgeGateError\(offerId, e\);\s*return;/.test(gate), '记录后须 return skip');
});
await t('G3 (向量③) 红线: 源里 "SELECT meta FROM exchange_offers WHERE id = ? LIMIT 1" 字面仍在且恰 1 处; 无 "SELECT metadata FROM exchange_offers WHERE id = ? LIMIT 1"', () => {
  assert.strictEqual((SRC.match(/"SELECT meta FROM exchange_offers WHERE id = \? LIMIT 1"/g) || []).length, 1);
  assert.ok(!/SELECT metadata FROM exchange_offers WHERE id = \? LIMIT 1/.test(SRC), '列名被"修"了 = 真开对冲, 越权');
});
await t('G4 _recordHedgeGateError 直接调: 首次 recorded, 二次 throttled', () => {
  assert.deepStrictEqual(_recordHedgeGateError('offer-gate-3', new Error('no such column: meta')), { recorded: true });
  assert.deepStrictEqual(_recordHedgeGateError('offer-gate-3', new Error('no such column: meta')), { recorded: false, throttled: true });
});
db.close(); rmSync(dir, { recursive: true, force: true });
console.log(`hedge-gate: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
