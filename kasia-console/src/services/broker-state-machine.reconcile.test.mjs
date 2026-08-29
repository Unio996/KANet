// 阶段 2 审点③: reconcile 退化前置 (无 held_for_review 枚举 ⇒ alert_once, 非 A) + 三态动作映射 (真 schema temp DB)
// 跑法: cd kasia-console && node src/services/broker-state-machine.reconcile.test.mjs
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'recon-'));
process.env.DB_PATH = join(dir, 't.db');
process.env.BROKER_RELAY_ID = process.env.BROKER_RELAY_ID || 'test-broker-relay';
const { sqlite: db } = await import('../db/client.js');
const { runMigrations } = await import('../db/migrate.js');
await runMigrations();
const { reconcileOneStaleOrder, orderStateEnumSupports, RECONCILE_MODE_ACTIVE } = await import('./broker-state-machine.js');
const { RECONCILE_MODE, ESCROW } = await import('../lib/broker-escrow-check.mjs');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const NOW = Date.parse('2026-08-29T10:00:00.000Z'); const iso = (ms) => new Date(ms).toISOString();
const USER = 'kaspatest:qq' + 'u'.repeat(59), TN_ADDR = 'kaspatest:qq' + 'a'.repeat(59), MAIN_ADDR = 'kaspa:qq' + 'b'.repeat(59);
const ENUMS = (() => { const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='retail_dex_orders'`).get().sql; const m = {}; for (const x of sql.matchAll(/(\w+)\s+TEXT[^,]*?CHECK\s*\(\s*\1\s+IN\s*\(([^)]*)\)/g)) m[x[1]] = x[2].split(',')[0].trim().replace(/^'|'$/g, ''); return m; })();
function mkOrder(id, state) {
  const cols = db.prepare(`PRAGMA table_info(retail_dex_orders)`).all();
  const want = { id, state, side: 'sell_kas', user_kasia_address: USER, qty: 10, created_at: iso(NOW - 3600e3), updated_at: iso(NOW - 3600e3) };
  for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in want)) want[c.name] = ENUMS[c.name] ?? (c.type === 'INTEGER' || c.type === 'REAL' ? 0 : 'x');
  const names = Object.keys(want); db.prepare(`INSERT INTO retail_dex_orders (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((n) => want[n]));
  return db.prepare(`SELECT id, user_kasia_address, qty, created_at FROM retail_dex_orders WHERE id = ?`).get(id);
}
const st = (id) => db.prepare(`SELECT state FROM retail_dex_orders WHERE id = ?`).get(id).state;
const events = (type) => db.prepare(`SELECT payload_json FROM events WHERE event_type = ?`).all(type);
db.prepare(`INSERT INTO spc_tip_heartbeat (id, daa_score, updated_at) VALUES (1, 1, ?)`).run(iso(NOW - 30e3));
const envTN = { KASPA_NETWORK: 'testnet-12', BROKER_KAS_ADDR: TN_ADDR };
const covOk = () => ({ covered: true, holes: [] });

t('E0 默认 mode = B(held_for_review); 库 CHECK 枚举当前不含 held_for_review (v200 未落)', () => { assert.strictEqual(RECONCILE_MODE_ACTIVE, RECONCILE_MODE.B_HELD); assert.strictEqual(orderStateEnumSupports(db, 'held_for_review'), false); assert.strictEqual(orderStateEnumSupports(db, 'refunding'), true); });
t('E1 生产形(主网地址+TN12) ⇒ UNKNOWN ⇒ alert_once, 单仍 awaiting_payment (今天的 bug 关掉)', () => { const row = mkOrder('r1', 'awaiting_payment'); const r = reconcileOneStaleOrder({ db, row, env: { KASPA_NETWORK: 'testnet-12', BROKER_KAS_ADDR: MAIN_ADDR }, nowMs: NOW, rpcUtxoLookup: () => [], indexerCoverage: covOk }); assert.strictEqual(r.verdict, ESCROW.UNKNOWN); assert.strictEqual(r.action, 'alert_once'); assert.strictEqual(st('r1'), 'awaiting_payment'); assert.strictEqual(events('broker_escrow_unknown').length, 1); });
t('E2 NOT_PAID + 选项 B 但枚举缺 ⇒ 退化 alert_once(broker_escrow_held_enum_missing), 不 transition, 【不是】failed+no_escrow', () => { const row = mkOrder('r2', 'awaiting_payment'); const r = reconcileOneStaleOrder({ db, row, env: envTN, nowMs: NOW, rpcUtxoLookup: () => [], indexerCoverage: covOk, mode: RECONCILE_MODE.B_HELD }); assert.strictEqual(r.verdict, ESCROW.NOT_PAID); assert.strictEqual(r.action, 'alert_once'); assert.strictEqual(r.event_type, 'broker_escrow_held_enum_missing'); assert.strictEqual(st('r2'), 'awaiting_payment'); assert.strictEqual(events('broker_escrow_held_enum_missing').length, 1); });
t('E3 NOT_PAID + 选项 A(显式) ⇒ transition failed + no_escrow (今天的终态, 只有 Owner 定 A 才走)', () => { const row = mkOrder('r3', 'awaiting_payment'); const r = reconcileOneStaleOrder({ db, row, env: envTN, nowMs: NOW, rpcUtxoLookup: () => [], indexerCoverage: covOk, mode: RECONCILE_MODE.A_FAILED }); assert.strictEqual(r.action, 'transition'); assert.strictEqual(r.toState, 'failed'); assert.strictEqual(r.result?.ok, true, JSON.stringify(r.result)); assert.strictEqual(st('r3'), 'failed'); });
t('E4 ESCROWED(RPC 见 UTXO) ⇒ none, 单不动', () => { const row = mkOrder('r4', 'awaiting_payment'); const r = reconcileOneStaleOrder({ db, row, env: envTN, nowMs: NOW, rpcUtxoLookup: () => [{ amountKas: 10.2 }], indexerCoverage: covOk }); assert.strictEqual(r.action, 'none'); assert.strictEqual(st('r4'), 'awaiting_payment'); });
t('E5 RPC 缺 ⇒ UNKNOWN ⇒ alert_once 且同单去重 (第二次不再写)', () => { const row = mkOrder('r5', 'awaiting_payment'); reconcileOneStaleOrder({ db, row, env: envTN, nowMs: NOW, indexerCoverage: covOk }); reconcileOneStaleOrder({ db, row, env: envTN, nowMs: NOW, indexerCoverage: covOk }); assert.strictEqual(events('broker_escrow_unknown').filter((e) => JSON.parse(e.payload_json).order_id === 'r5').length, 1); assert.strictEqual(st('r5'), 'awaiting_payment'); });
t('E6 枚举含 held_for_review 时(模拟 v200: 改 sqlite_master 不可; 用 orderStateEnumSupports 正则对照) ⇒ 检测函数对 DDL 文本正确', () => { assert.strictEqual(orderStateEnumSupports({ prepare: () => ({ get: () => ({ sql: "CREATE TABLE retail_dex_orders (state TEXT CHECK(state IN ('aligning','held_for_review')))" }) }) }, 'held_for_review'), true); assert.strictEqual(orderStateEnumSupports({ prepare: () => { throw new Error('x'); } }, 'held_for_review'), false); });
db.close(); rmSync(dir, { recursive: true, force: true });
console.log(`reconcile: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
