// 阶段 2 审点②: Phase-1 CAS + intent INSERT 同一 transaction —— crash-between ⇒ both-or-neither (真 schema temp DB, 不碰 live)
// 跑法: cd kasia-console && node src/services/broker-state-authority.refund-lock.test.mjs
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'rlock-'));
process.env.DB_PATH = join(dir, 't.db');
process.env.BROKER_RELAY_ID = process.env.BROKER_RELAY_ID || 'test-broker-relay';   // 模块顶层 fail-loud 守卫
const { sqlite: db } = await import('../db/client.js');
const { runMigrations } = await import('../db/migrate.js');
await runMigrations();
const { claimRefundLockWithIntent, recordRefundIntentTxid, rollbackRefundLockWithIntent, _alertRefundOnce } = await import('./broker-state-authority.js');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const NOW = new Date().toISOString();
const USER = 'kaspatest:qq' + 'u'.repeat(59);
// retail_dex_orders 最小行 (NOT NULL 无默认列用 PRAGMA 自动占位, 真 schema 不猜列名)
// 真 schema 的 CHECK(col IN (...)) 枚举从 DDL 文本解析, 取首个合法值 (不逐列猜)
const ENUMS = (() => { const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='retail_dex_orders'`).get().sql; const m = {}; for (const x of sql.matchAll(/(\w+)\s+TEXT[^,]*?CHECK\s*\(\s*\1\s+IN\s*\(([^)]*)\)/g)) m[x[1]] = x[2].split(',')[0].trim().replace(/^'|'$/g, ''); return m; })();
function mkOrder(id, state, extra = {}) {
  const cols = db.prepare(`PRAGMA table_info(retail_dex_orders)`).all();
  const want = { id, state, side: 'sell_kas', user_kasia_address: USER, qty: 10, created_at: NOW, updated_at: NOW, ...extra };
  for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in want)) want[c.name] = ENUMS[c.name] ?? (c.type === 'INTEGER' || c.type === 'REAL' ? 0 : 'x');
  const names = Object.keys(want);
  db.prepare(`INSERT INTO retail_dex_orders (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((n) => want[n]));
}
const orderState = (id) => db.prepare(`SELECT state, refund_tx_hash, error_reason FROM retail_dex_orders WHERE id = ?`).get(id);
const intents = (orderId) => db.prepare(`SELECT id, txid FROM broker_refund_intents WHERE order_id = ?`).all(orderId);

mkOrder('o1', 'awaiting_payment');
t('L1 正常: CAS 抢到 ⇒ state=refunding ∧ intent 1 行 txid NULL (both)', () => { const r = claimRefundLockWithIntent(db, { orderId: 'o1', offerId: 'of1', userAddr: USER, amountKas: 10 }); assert.strictEqual(r.claimed, true); assert.ok(r.intentId); assert.strictEqual(orderState('o1').state, 'refunding'); assert.strictEqual(intents('o1').length, 1); assert.strictEqual(intents('o1')[0].txid, null); });
t('L2 重入: 已 refunding ⇒ CAS 输 ⇒ claimed=false ∧ 不多插 intent (neither)', () => { const r = claimRefundLockWithIntent(db, { orderId: 'o1', offerId: 'of1', userAddr: USER, amountKas: 10 }); assert.strictEqual(r.claimed, false); assert.strictEqual(r.intentId, null); assert.strictEqual(intents('o1').length, 1); });
t('L3 Phase 2 resolve: recordRefundIntentTxid 写 txid; 二次写不覆盖', () => { const iid = intents('o1')[0].id; assert.strictEqual(recordRefundIntentTxid(db, iid, 'a'.repeat(64)), 1); assert.strictEqual(intents('o1')[0].txid, 'a'.repeat(64)); assert.strictEqual(recordRefundIntentTxid(db, iid, 'b'.repeat(64)), 0); assert.strictEqual(intents('o1')[0].txid, 'a'.repeat(64)); });
mkOrder('o2', 'expired');
t('L4 crash-between 模拟: intent INSERT 抛(违 CHECK: user_addr NULL) ⇒ 事务回滚 ⇒ CAS 也不生效 (neither)', () => {
  assert.throws(() => claimRefundLockWithIntent(db, { orderId: 'o2', offerId: 'of2', userAddr: null, amountKas: 10 }), /bad args/);   // 参数守卫先拦
  // 绕过参数守卫直击事务: 临时把 intents 表的 amount_kas 改成会失败的形 —— 用触发器让 INSERT 必抛
  db.exec(`CREATE TRIGGER _t_fail BEFORE INSERT ON broker_refund_intents BEGIN SELECT RAISE(ABORT, 'simulated crash between CAS and intent'); END`);
  assert.throws(() => claimRefundLockWithIntent(db, { orderId: 'o2', offerId: 'of2', userAddr: USER, amountKas: 10 }), /simulated crash/);
  db.exec(`DROP TRIGGER _t_fail`);
  assert.strictEqual(orderState('o2').state, 'expired', 'CAS 必须随事务回滚');
  assert.strictEqual(intents('o2').length, 0);
});
t('L5 回滚后可再抢 (both)', () => { const r = claimRefundLockWithIntent(db, { orderId: 'o2', offerId: 'of2', userAddr: USER, amountKas: 10 }); assert.strictEqual(r.claimed, true); assert.strictEqual(orderState('o2').state, 'refunding'); assert.strictEqual(intents('o2').length, 1); });
t('L6 明确失败回滚: rollbackRefundLockWithIntent ⇒ state=expired + error_reason + intent(无 txid) 删 (同事务)', () => { const iid = intents('o2')[0].id; rollbackRefundLockWithIntent(db, { orderId: 'o2', intentId: iid, errorReason: 'refund_send_failed: x' }); const s = orderState('o2'); assert.strictEqual(s.state, 'expired'); assert.ok(/refund_send_failed/.test(s.error_reason)); assert.strictEqual(intents('o2').length, 0); });
t('L7 回滚不删已有 txid 的 intent (那是已发过的证据)', () => { mkOrder('o3', 'paid'); const r = claimRefundLockWithIntent(db, { orderId: 'o3', offerId: null, userAddr: USER, amountKas: 5, noOffer: true }); recordRefundIntentTxid(db, r.intentId, 'c'.repeat(64)); rollbackRefundLockWithIntent(db, { orderId: 'o3', intentId: r.intentId, errorReason: 'x' }); assert.strictEqual(intents('o3').length, 1); assert.strictEqual(intents('o3')[0].txid, 'c'.repeat(64)); });
// exchange_offers 行 (FK 目标; 同样 DDL 解析 CHECK 枚举)
function mkOffer(id) {
  const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='exchange_offers'`).get().sql; const en = {}; for (const x of sql.matchAll(/(\w+)\s+TEXT[^,]*?CHECK\s*\(\s*\1\s+IN\s*\(([^)]*)\)/g)) en[x[1]] = x[2].split(',')[0].trim().replace(/^'|'$/g, '');
  const cols = db.prepare(`PRAGMA table_info(exchange_offers)`).all(); const want = { id, created_at: NOW };
  for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in want)) want[c.name] = en[c.name] ?? (c.type === 'INTEGER' || c.type === 'REAL' ? 1 : 'x');
  const names = Object.keys(want); db.prepare(`INSERT INTO exchange_offers (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((n) => want[n]));
}
t('L8 noOffer 形: exchange_offer_id 非 NULL 的单不被 noOffer CAS 抢', () => { mkOffer('of4'); mkOrder('o4', 'awaiting_payment', { exchange_offer_id: 'of4' }); const r = claimRefundLockWithIntent(db, { orderId: 'o4', offerId: null, userAddr: USER, amountKas: 5, noOffer: true }); assert.strictEqual(r.claimed, false); assert.strictEqual(intents('o4').length, 0); });
t('L9 _alertRefundOnce: 同 order 同 type 只写一条 events; 第二次返回 false', () => { assert.strictEqual(_alertRefundOnce('o1', 'refund_unknown_hold', 'rpc_lookup_unavailable', { a: 1n }), true); assert.strictEqual(_alertRefundOnce('o1', 'refund_unknown_hold', 'again', {}), false); const rows = db.prepare(`SELECT payload_json FROM events WHERE event_type='refund_unknown_hold'`).all(); assert.strictEqual(rows.length, 1); assert.strictEqual(JSON.parse(rows[0].payload_json).order_id, 'o1'); });
t('L10 bad args ⇒ throw', () => { assert.throws(() => claimRefundLockWithIntent(db, { orderId: '', userAddr: USER, amountKas: 1 })); assert.throws(() => claimRefundLockWithIntent(db, { orderId: 'o9', userAddr: USER, amountKas: 0 })); });
db.close(); rmSync(dir, { recursive: true, force: true });
console.log(`refund-lock: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
