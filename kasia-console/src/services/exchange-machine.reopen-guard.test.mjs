// P7-bis (race 盘点 §9.3/§10.2, NWT P1, Bettor GO 8/29) 向量: 两处 reopen 都门 — payment_tx OR delivery_tx 非空 ⇒ 不 reopen、转 verifying、不清、taker 保留、releaseFunds 不调、告警一次。
// 跑: cd kasia-console && node src/services/exchange-machine.reopen-guard.test.mjs  (真 schema; checkMatchedTimeout 走"非本地 maker"分支 = 不广播)
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'reopen-'));
process.env.DB_PATH = join(dir, 't.db');
const { sqlite: db } = await import('../db/client.js');
const { runMigrations } = await import('../db/migrate.js');
await runMigrations();
const em = await import('./exchange-machine.js');
const tpf = await import('./trade-protocol-filter.js');
const { checkMatchedTimeout, guardReopenIfSettled } = em;
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const here = dirname(fileURLToPath(import.meta.url));
const EM = readFileSync(join(here, 'exchange-machine.js'), 'utf8'), TPF = readFileSync(join(here, 'trade-protocol-filter.js'), 'utf8');
const TX = (c) => c.repeat(64);
const en = (() => { const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='exchange_offers'`).get().sql; const o = {}; for (const x of sql.matchAll(/(\w+)\s+TEXT[^,]*?CHECK\s*\(\s*\1\s+IN\s*\(([^)]*)\)/g)) o[x[1]] = x[2].split(',')[0].trim().replace(/^'|'$/g, ''); return o; })();
let _mi = 0;
function mkOffer(id, extra = {}) {
  const cols = db.prepare(`PRAGMA table_info(exchange_offers)`).all();
  const want = { id, created_at: new Date().toISOString(), broadcast_tx_id: TX('b'), message_index: ++_mi, maker: 'kaspa:maker-nonlocal', protocol_status: 'matched', taker: 'kaspa:taker1', taker_chain: 'bnb', taker_payment_address: '0xtaker', matched_at: new Date(Date.now() - 60 * 60e3).toISOString().replace('T', ' ').slice(0, 19), ...extra };
  for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in want)) want[c.name] = en[c.name] ?? (c.type === 'INTEGER' || c.type === 'REAL' ? 1 : 'x');
  const names = Object.keys(want); db.prepare(`INSERT INTO exchange_offers (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((n) => want[n]));
}
function mkLock(orderId) { const cols = db.prepare(`PRAGMA table_info(fund_locks)`).all(); const want = { order_id: orderId, status: 'locked' }; for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in want)) want[c.name] = c.type === 'INTEGER' || c.type === 'REAL' ? 1 : (c.name === 'id' ? 'lock_' + orderId : 'x'); if (cols.some((c) => c.name === 'id') && !('id' in want)) want.id = 'lock_' + orderId; const names = Object.keys(want); db.prepare(`INSERT INTO fund_locks (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((n) => want[n])); }
const get = (id) => db.prepare(`SELECT protocol_status, taker, payment_tx, delivery_tx, matched_at FROM exchange_offers WHERE id = ?`).get(id);
const lockStatus = (id) => db.prepare(`SELECT status FROM fund_locks WHERE order_id = ?`).get(id)?.status;
const alerts = (id) => db.prepare(`SELECT count(*) AS n FROM events WHERE event_type = 'reopen_blocked_settled' AND json_extract(payload_json, '$.offer_id') = ?`).get(id).n;

await t('V1 无 payment_tx/delivery_tx + matched 超时 ⇒ 照旧 reopen: open, taker/payment_tx 清空, fund_lock released (现行为不变)', async () => {
  mkOffer('r_plain'); mkLock('r_plain');
  await checkMatchedTimeout();
  const o = get('r_plain'); assert.strictEqual(o.protocol_status, 'open'); assert.strictEqual(o.taker, null); assert.strictEqual(o.matched_at, null); assert.strictEqual(lockStatus('r_plain'), 'released'); assert.strictEqual(alerts('r_plain'), 0);
});
await t('V2 payment_tx 非空 + matched 超时 ⇒ 不 reopen: verifying, payment_tx 仍在, taker 保留, fund_lock 仍 locked, events reopen_blocked_settled 1', async () => {
  mkOffer('r_paid', { payment_tx: '0xpaid' }); mkLock('r_paid');
  await checkMatchedTimeout();
  const o = get('r_paid'); assert.strictEqual(o.protocol_status, 'verifying'); assert.strictEqual(o.payment_tx, '0xpaid'); assert.strictEqual(o.taker, 'kaspa:taker1'); assert.strictEqual(lockStatus('r_paid'), 'locked'); assert.strictEqual(alerts('r_paid'), 1);
});
await t('V3 只有 delivery_tx 非空 ⇒ 同样不 reopen (OR 半边)', async () => {
  mkOffer('r_deliv', { delivery_tx: TX('d') }); mkLock('r_deliv');
  await checkMatchedTimeout();
  const o = get('r_deliv'); assert.strictEqual(o.protocol_status, 'verifying'); assert.strictEqual(o.delivery_tx, TX('d')); assert.strictEqual(o.taker, 'kaspa:taker1'); assert.strictEqual(lockStatus('r_deliv'), 'locked');
});
await t('V4 第二次 tick: 已 verifying 的不在 stale 集合 (WHERE matched), 状态不变, 不重复告警', async () => {
  await checkMatchedTimeout();
  assert.strictEqual(get('r_paid').protocol_status, 'verifying'); assert.strictEqual(alerts('r_paid'), 1);
  assert.strictEqual(guardReopenIfSettled('r_paid', 'test').blocked, true); assert.strictEqual(alerts('r_paid'), 1, '直接再调也不重复告警');
});
await t('V5 tpf handleExchangeTimeout (对端 timeout_v1 经 onBroadcastWritten): payment_tx 非空 ⇒ 不 reopen/verifying/lock 仍 locked + exchange_timeout 事件带 reopen_blocked; 无 payment_tx ⇒ 照旧 reopen', async () => {
  mkOffer('r_peer_paid', { payment_tx: '0xpaid2' }); mkLock('r_peer_paid');
  mkOffer('r_peer_plain'); mkLock('r_peer_plain');
  for (const [id, tx] of [['r_peer_paid', TX('1')], ['r_peer_plain', TX('2')]]) {
    await tpf.onBroadcastWritten({ tx_hash: tx, content: JSON.stringify({ t: 'kanet_exchange_timeout_v1', offer_id: id, taker: 'kaspa:taker1', reason: 'payment_timeout', reopen: true }), sender_address: 'kaspa:maker-nonlocal', channel_name: 'kanet-exchange', created_at: new Date().toISOString() });
  }
  const a = get('r_peer_paid'); assert.strictEqual(a.protocol_status, 'verifying'); assert.strictEqual(a.payment_tx, '0xpaid2'); assert.strictEqual(lockStatus('r_peer_paid'), 'locked');
  const ev = db.prepare(`SELECT payload FROM chain_events WHERE event_type = 'exchange_timeout' AND txid = ?`).get(TX('1')); assert.ok(ev && JSON.parse(ev.payload).reopen_blocked === true, 'exchange_timeout 事件须带 reopen_blocked');
  const b = get('r_peer_plain'); assert.strictEqual(b.protocol_status, 'open'); assert.strictEqual(b.taker, null); assert.strictEqual(lockStatus('r_peer_plain'), 'released');
});
await t('V6 源级: 两处 reopen 都调 guardReopenIfSettled; em 门在 timeout_v1 广播之前; tpf UPDATE 带 AND protocol_status = \'matched\'; 门判 payment_tx 与 delivery_tx 两半; 写 payment_tx 的 tpf:_autoPayExchange/_autoSettleAsset 与门读同一列', () => {
  const emFn = EM.slice(EM.indexOf('export async function checkMatchedTimeout'), EM.indexOf('export async function checkMatchedTimeout') + 3000);
  const iG = emFn.indexOf('guardReopenIfSettled(offer.id'), iB = emFn.indexOf("t: 'kanet_exchange_timeout_v1'"); assert.ok(iG > 0 && iB > iG, `em guard@${iG} broadcast@${iB}`);
  const tp = TPF.slice(TPF.indexOf('async function handleExchangeTimeout'), TPF.indexOf('async function handleExchangeTimeout') + 2500);
  assert.ok(/guardReopenIfSettled\(msg\.offer_id/.test(tp), 'tpf 未门'); assert.ok(/WHERE id = \? AND protocol_status = 'matched'\s*`\)\.run\(nowIso, msg\.offer_id\)/.test(tp), 'tpf UPDATE 缺 CAS 谓词');
  const g = EM.slice(EM.indexOf('export function guardReopenIfSettled'), EM.indexOf('export async function checkMatchedTimeout'));
  assert.ok(/if \(!row\.payment_tx && !row\.delivery_tx\) return \{ blocked: false/.test(g), '门须判两半');
  assert.ok((TPF.match(/UPDATE exchange_offers SET payment_tx = \? WHERE id = \?/g) || []).length >= 2, '_autoPayExchange/_autoSettleAsset 写 payment_tx 同列');
});
db.close(); rmSync(dir, { recursive: true, force: true });
console.log(`reopen-guard: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
