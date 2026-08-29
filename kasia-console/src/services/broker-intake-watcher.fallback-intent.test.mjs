// P2 (race 盘点, NWT CONFIRMED) 向量: T2.5c claim write-ahead + Z20/fallback 排除片段逐字 + intent 三态 + 重入闸接线。
// 跑: cd kasia-console && node src/services/broker-intake-watcher.fallback-intent.test.mjs
// 红于旧码的向量: X0(片段含 intent)/X1(intent 先于 placeCexOrder)/X4(setInterval 经 createTickGuard) 在 12fcc48b 形上必红。
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'fbintent-'));
process.env.DB_PATH = join(dir, 't.db');
const { sqlite: db } = await import('../db/client.js');
const { runMigrations } = await import('../db/migrate.js');
await runMigrations();
const { recordChainEvent } = await import('./chain-event.js');
const { writeFallbackIntent, resolveFallbackIntent, FALLBACK_INTENT_OR_CLAIM_NOT_EXISTS, FALLBACK_INTENT_EVENT, FALLBACK_CLAIM_EVENT } = await import('../lib/broker-fallback-intent.mjs');
let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'broker-intake-watcher.js'), 'utf8');
const TX = (c) => c.repeat(64);

t('X0 排除片段: 单一权威 FALLBACK_INTENT_OR_CLAIM_NOT_EXISTS 含 claim 与 intent 两型; 源里 Z20 与 fallback 两处都用它(不再手写 claim-only)', () => {
  assert.ok(/IN \('broker_fallback_claim', 'broker_fallback_intent'\)/.test(FALLBACK_INTENT_OR_CLAIM_NOT_EXISTS));
  assert.strictEqual((SRC.match(/\$\{FALLBACK_INTENT_OR_CLAIM_NOT_EXISTS\}/g) || []).length, 2, 'Z20 + fallback 两处');
  assert.ok(!/event_type = 'broker_fallback_claim'\s*\n\s*AND ce2\.payload/.test(SRC), '残留 claim-only 手写片段');
});
t('X1 顺序: _scanUntakenOffersFallback 内 writeFallbackIntent( 出现在 placeCexOrder( 之前, 且 placeCexOrder 在 try 内(ambiguous 分支)', () => {
  const fn = SRC.slice(SRC.indexOf('export async function _scanUntakenOffersFallback'), SRC.indexOf('export async function _scanUntakenBuyOffersFallback'));
  const iIntent = fn.indexOf('writeFallbackIntent('); const iPlace = fn.indexOf('await placeCexOrder(');
  assert.ok(iIntent > 0 && iPlace > 0 && iIntent < iPlace, `intent@${iIntent} place@${iPlace}`);
  assert.ok(/outcome: 'ambiguous'/.test(fn) && /outcome: 'claimed'/.test(fn) && /outcome: 'failed_definitive'/.test(fn), '三态都接了');
});
// 真 schema: 造 offer + 跑片段 (alias exchange_offers)
const en = (() => { const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='exchange_offers'`).get().sql; const o = {}; for (const x of sql.matchAll(/(\w+)\s+TEXT[^,]*?CHECK\s*\(\s*\1\s+IN\s*\(([^)]*)\)/g)) o[x[1]] = x[2].split(',')[0].trim().replace(/^'|'$/g, ''); return o; })();
let _mi = 0;
function mkOffer(id) { const cols = db.prepare(`PRAGMA table_info(exchange_offers)`).all(); const want = { id, created_at: new Date().toISOString(), broadcast_tx_id: TX('b'), message_index: ++_mi }; for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in want)) want[c.name] = en[c.name] ?? (c.type === 'INTEGER' || c.type === 'REAL' ? 1 : 'x'); const names = Object.keys(want); db.prepare(`INSERT INTO exchange_offers (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((n) => want[n])); }
const kept = (id) => db.prepare(`SELECT count(*) AS n FROM exchange_offers WHERE id = ? ${FALLBACK_INTENT_OR_CLAIM_NOT_EXISTS}`).get(id).n;
for (const id of ['o_none', 'o_intent', 'o_claim', 'o_amb', 'o_fail']) mkOffer(id);
t('X2 片段语义: 无痕迹 ⇒ kept=1; 有 intent ⇒ 0; 有 claim ⇒ 0', () => {
  assert.strictEqual(kept('o_none'), 1);
  const r = writeFallbackIntent({ db, recordChainEvent, offerId: 'o_intent', cancelTx: TX('1'), qty: 5, midPrice: 0.04 });
  assert.ok(r.intentId && r.existedBefore === false); assert.strictEqual(kept('o_intent'), 0);
  recordChainEvent({ txid: TX('2'), eventType: FALLBACK_CLAIM_EVENT, payload: { offer_id: 'o_claim', cex_order_id: 'x' } }); assert.strictEqual(kept('o_claim'), 0);
});
t('X3 intent 三态: claimed ⇒ intent 留 + claim 出现; failed_definitive ⇒ 删无 orderId 的 intent(offer 回到可扫); ambiguous ⇒ 留 + payload.ambiguous=1 + events 告警; 有 orderId 的 intent 绝不删', () => {
  writeFallbackIntent({ db, recordChainEvent, offerId: 'o_fail', cancelTx: TX('3'), qty: 1, midPrice: 1 });
  const rf = resolveFallbackIntent({ db, recordChainEvent, offerId: 'o_fail', cancelTx: TX('3'), outcome: 'failed_definitive', error: 'too small' });
  assert.strictEqual(rf.deleted, 1); assert.strictEqual(kept('o_fail'), 1);
  writeFallbackIntent({ db, recordChainEvent, offerId: 'o_amb', cancelTx: TX('4'), qty: 1, midPrice: 1 });
  const ra = resolveFallbackIntent({ db, recordChainEvent, offerId: 'o_amb', cancelTx: TX('4'), outcome: 'ambiguous', error: 'ETIMEDOUT' });
  assert.strictEqual(ra.kept, true); assert.strictEqual(kept('o_amb'), 0);
  const row = db.prepare(`SELECT payload FROM chain_events WHERE txid = ? AND event_type = ?`).get(TX('4'), FALLBACK_INTENT_EVENT); assert.strictEqual(JSON.parse(row.payload).ambiguous, 1);
  assert.strictEqual(db.prepare(`SELECT count(*) AS n FROM events WHERE event_type = 'broker_fallback_ambiguous'`).get().n, 1);
  const rc = resolveFallbackIntent({ db, recordChainEvent, offerId: 'o_intent', cancelTx: TX('1'), outcome: 'claimed', cexOrderId: 'ord-9', qty: 5, midPrice: 0.04 });
  assert.strictEqual(rc.claimed, true); assert.strictEqual(db.prepare(`SELECT count(*) AS n FROM chain_events WHERE txid = ? AND event_type IN (?, ?)`).get(TX('1'), FALLBACK_INTENT_EVENT, FALLBACK_CLAIM_EVENT).n, 2);
  // intent 带 orderId 时 failed_definitive 不删
  db.prepare(`UPDATE chain_events SET payload = json_set(payload, '$.cex_order_id', 'keep') WHERE txid = ? AND event_type = ?`).run(TX('4'), FALLBACK_INTENT_EVENT);
  assert.strictEqual(resolveFallbackIntent({ db, recordChainEvent, offerId: 'o_amb', cancelTx: TX('4'), outcome: 'failed_definitive' }).deleted, 0);
  assert.throws(() => resolveFallbackIntent({ db, recordChainEvent, offerId: 'x', cancelTx: TX('5'), outcome: 'nope' }), /outcome 非法/);
});
t('X3b intent 未落库 ⇒ throw (fail-closed): 非 64-hex cancel_tx 被 v83 trigger 拒 ⇒ 不许继续下单', () => {
  assert.throws(() => writeFallbackIntent({ db, recordChainEvent, offerId: 'o_none', cancelTx: 'not-a-txid', qty: 1, midPrice: 1 }), /intent 未落库/);
  assert.strictEqual(kept('o_none'), 1);
});
t('X4 重入闸接线: _refundInterval 的 setInterval 回调经 createTickGuard(...).run, 且 onOverrun/onStale 写 events', () => {
  const blk = SRC.slice(SRC.indexOf('if (!_refundInterval) {'), SRC.indexOf('}, REFUND_TICK_MS);'));
  assert.ok(/createTickGuard\(\{/.test(blk) && /_refundInterval = setInterval\(\(\) => _refundGuard\.run\(async \(\) => \{/.test(blk), 'setInterval 未经 guard');
  assert.ok(/refund_tick_overrun/.test(blk) && /refund_tick_stale/.test(blk), 'events 告警缺');
});
db.close(); rmSync(dir, { recursive: true, force: true });
console.log(`fallback-intent: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
