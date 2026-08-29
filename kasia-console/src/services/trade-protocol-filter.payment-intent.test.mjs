// P7-bis sub-case (ii) 向量 (NWT/Bettor GO 8/29): auto-pay 转账前 write-ahead 付款意图 (CAS), 成功 CAS 换真 hash, 失败/抛 标记不清 ⇒ reopen 被门。
// 跑: cd kasia-console && node src/services/trade-protocol-filter.payment-intent.test.mjs  (真 schema)
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'payintent-'));
process.env.DB_PATH = join(dir, 't.db');
const { sqlite: db } = await import('../db/client.js');
const { runMigrations } = await import('../db/migrate.js');
await runMigrations();
const tpf = await import('./trade-protocol-filter.js');
const em = await import('./exchange-machine.js');
const { _reservePaymentIntent, _finalizePaymentIntent, _alertPaymentIntentStuck, PAYMENT_INTENT_PREFIX } = tpf;
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, 'trade-protocol-filter.js'), 'utf8');
const TX = (c) => c.repeat(64);
const en = (() => { const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='exchange_offers'`).get().sql; const o = {}; for (const x of sql.matchAll(/(\w+)\s+TEXT[^,]*?CHECK\s*\(\s*\1\s+IN\s*\(([^)]*)\)/g)) o[x[1]] = x[2].split(',')[0].trim().replace(/^'|'$/g, ''); return o; })();
let _mi = 0;
function mkOffer(id, extra = {}) { const cols = db.prepare(`PRAGMA table_info(exchange_offers)`).all(); const want = { id, created_at: new Date().toISOString(), broadcast_tx_id: TX('b'), message_index: ++_mi, maker: 'kaspa:maker-nonlocal', protocol_status: 'matched', taker: 'kaspa:taker1', matched_at: new Date(Date.now() - 60 * 60e3).toISOString().replace('T', ' ').slice(0, 19), ...extra }; for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in want)) want[c.name] = en[c.name] ?? (c.type === 'INTEGER' || c.type === 'REAL' ? 1 : 'x'); const names = Object.keys(want); db.prepare(`INSERT INTO exchange_offers (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((n) => want[n])); }
const ptx = (id) => db.prepare(`SELECT payment_tx, protocol_status FROM exchange_offers WHERE id = ?`).get(id);

await t('X-a 转账前标记已落 (真 schema): reserve ⇒ payment_tx = PENDING:<offer8>:<uuid8>, UNIQUE 索引下两 offer 标记不同', () => {
  mkOffer('pi_1'); mkOffer('pi_2');
  const m1 = _reservePaymentIntent(db, 'pi_1'); const m2 = _reservePaymentIntent(db, 'pi_2');
  assert.ok(m1 && new RegExp('^' + PAYMENT_INTENT_PREFIX + 'pi_1:[0-9a-f]{8}$').test(m1), m1);
  assert.notStrictEqual(m1, m2); assert.strictEqual(ptx('pi_1').payment_tx, m1);
});
await t('X-b 第二次进入 ⇒ changes=0 ⇒ null (调用方不转账); 已有真 hash 的 offer 也 null', () => {
  assert.strictEqual(_reservePaymentIntent(db, 'pi_1'), null);
  mkOffer('pi_real', { payment_tx: TX('9') }); assert.strictEqual(_reservePaymentIntent(db, 'pi_real'), null);
});
await t('X-a2 成功: finalize CAS (WHERE payment_tx = marker) 换真 hash ⇒ true; 再 finalize ⇒ false (标记已不在); 错 marker ⇒ false 且列不动', () => {
  const m = ptx('pi_1').payment_tx;
  assert.strictEqual(_finalizePaymentIntent(db, 'pi_1', m, TX('a')), true); assert.strictEqual(ptx('pi_1').payment_tx, TX('a'));
  assert.strictEqual(_finalizePaymentIntent(db, 'pi_1', m, TX('c')), false); assert.strictEqual(ptx('pi_1').payment_tx, TX('a'));
  assert.strictEqual(_finalizePaymentIntent(db, 'pi_2', 'PENDING:wrong', TX('d')), false); assert.ok(ptx('pi_2').payment_tx.startsWith('PENDING:pi_2:'));
});
await t('X-c 转账抛/失败 ⇒ 标记留 + events autopay_ambiguous; matched 超时 tick ⇒ reopen-guard 转 verifying (不 reopen, 标记仍在)', async () => {
  const m = ptx('pi_2').payment_tx;
  _alertPaymentIntentStuck(db, 'pi_2', m, 'test', 'ETIMEDOUT');
  assert.strictEqual(db.prepare(`SELECT count(*) AS n FROM events WHERE event_type = 'autopay_ambiguous'`).get().n, 1);
  await em.checkMatchedTimeout();
  const o = ptx('pi_2'); assert.strictEqual(o.protocol_status, 'verifying'); assert.strictEqual(o.payment_tx, m, '标记不得被 reopen 清掉');
});
await t('X-d 源级: _autoPayExchange 与 _autoSettleAsset 都在 await transferUsdt(/sendAsset( 之前 _reservePaymentIntent, 之后用 _finalizePaymentIntent; 旧形 "SET payment_tx = ? WHERE id = ?" 在两函数内不残留; 失败/抛路调 _alertPaymentIntentStuck 且不清标记', () => {
  for (const [fn, xfer] of [['_autoPayExchange', 'await transferUsdt('], ['_autoSettleAsset', 'await sendAsset(']]) {
    const s = SRC.indexOf(`async function ${fn}(`); const body = SRC.slice(s, SRC.indexOf('\n}\n', s));
    const iR = body.indexOf('_reservePaymentIntent(sqlite, offer.id)'), iX = body.indexOf(xfer), iF = body.indexOf('_finalizePaymentIntent(sqlite, offer.id, _intent');
    assert.ok(iR > 0 && iX > iR && iF > iX, `${fn}: reserve@${iR} xfer@${iX} finalize@${iF}`);
    assert.ok(!/UPDATE exchange_offers SET payment_tx = \? WHERE id = \?'/.test(body), `${fn}: 旧形送后写残留`);
    assert.ok(/if \(!_intent\) \{[\s\S]*?return; \}/.test(body), `${fn}: 无意图须 return`);
    assert.ok((body.match(/_alertPaymentIntentStuck\(/g) || []).length >= 3, `${fn}: 抛/失败/finalize-miss 三处告警`);
    assert.ok(!/payment_tx = NULL/.test(body), `${fn}: 失败路不得清标记`);
  }
});
await t('X-e (Bettor ③) processPaymentSubmit 遇本地 PENDING 标记 ⇒ 不覆盖列、返回 payment_intent_pending、events 记一条; 列仍是标记', () => {
  mkOffer('pi_sub', { protocol_status: 'verifying' }); const m = _reservePaymentIntent(db, 'pi_sub'); assert.ok(m);
  const r = em.processPaymentSubmit({ offer_id: 'pi_sub', payment_tx: TX('e'), payment_chain: 'bnb' });
  assert.strictEqual(r?.error, 'payment_intent_pending'); assert.strictEqual(ptx('pi_sub').payment_tx, m);
  assert.strictEqual(db.prepare(`SELECT count(*) AS n FROM events WHERE event_type = 'payment_submit_while_intent_pending'`).get().n, 1);
});
db.close(); rmSync(dir, { recursive: true, force: true });
console.log(`payment-intent: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
