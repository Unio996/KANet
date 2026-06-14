// dm-bet-e2e.mjs — DM→chain full-auto bet persona (demo ② "电报DM押注真上链", Bettor r491b plan).
//
// Drives the REAL tg-bot handler pipeline (bot.handleUpdate — same surface as l2-handler.test.mjs,
// NWT fixture-mirror: production handler, not a replica) from /link through the /bet menu to confirm,
// then AUTO-PAYS the deterministic side-P2SH from a persona relay, then drives register-v06/confirm,
// then verifies the PoolSide stake lock landed on-chain. Zero human, one command = the "从源头通过DM
// 全自动" entry of the end-to-end demo.
//
// Usage:  node tg-bot/test/dm-bet-e2e.mjs --market <id> --side YES|NO --stake 1 [--persona <relayId>]
// Run from repo root or tg-bot/ (paths resolve via import.meta.url). Reads ../../kanet.env for token +
// CONSOLE_ENCRYPTION_KEY (to decrypt ingest_secret, same as _launch_tg_bot.mjs). Never prints secrets.
//
// Exit 0 = PoolSide lock landed on-chain (demo ② PASS). Exit 1 = a stage failed (printed). Exit 2 = bad args.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// ── args ──
const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const MARKET_ID = arg('market');
const SIDE = String(arg('side', 'YES')).toUpperCase();          // YES | NO
const STAKE_KAS = Number(arg('stake', '1'));
const PERSONA_RELAY = arg('persona', 'ecb15318-cbb0-4335-aff7-a549f870b7f8');   // AutoBetter-1 (oracle=0)
if (!MARKET_ID) { console.error('usage: --market <id> --side YES|NO --stake <kas> [--persona <relayId>]'); process.exit(2); }
if (SIDE !== 'YES' && SIDE !== 'NO') { console.error('--side must be YES or NO'); process.exit(2); }

// ── env (real token + real ingest_secret — /link bind + register-v06/confirm are authed) ──
const kanetEnv = readFileSync(new URL('../../kanet.env', import.meta.url), 'utf8');
const kv = (k) => (kanetEnv.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || '';
process.env.TELEGRAM_BOT_TOKEN = kv('TELEGRAM_BOT_TOKEN');
process.env.TELEGRAM_BOT_USERNAME = kv('TELEGRAM_BOT_USERNAME') || 'KANET_Broker_bot';
process.env.CONSOLE_URL = 'http://127.0.0.1:3200';
process.env.CONSOLE_ENCRYPTION_KEY = kv('CONSOLE_ENCRYPTION_KEY');
process.env.BROKER_RELAY_ID = '15593e10-fe63-4806-a7b5-cae062699de8';   // broker-1 (tg-bot face)
const CONSOLE = process.env.CONSOLE_URL;
if (!process.env.TELEGRAM_BOT_TOKEN) { console.error('FAIL: no TELEGRAM_BOT_TOKEN in kanet.env'); process.exit(1); }

// Open console.db by ABSOLUTE path (the shared db/client.js resolves a CWD-relative path that breaks when
// this runs from tg-bot/). Read ingest_secret straight from config_entries + decrypt with crypto.js (the
// same path getConfig uses, minus the mis-resolved client) — /link bind + register-v06/confirm are authed.
const require = createRequire(new URL('../../kasia-console/package.json', import.meta.url));
const Database = require('better-sqlite3');
const db = new Database(fileURLToPath(new URL('../../kasia-console/data/console.db', import.meta.url)), { timeout: 8000, readonly: true });
function die(msg) { console.error('\nFAIL:', msg); try { db.close(); } catch {} process.exit(1); }
const { decrypt } = await import('../../kasia-console/src/services/crypto.js');
const _cfg = db.prepare('SELECT value_encrypted, is_sensitive FROM config_entries WHERE key=?').get('ingest_secret');
process.env.INGEST_SECRET = _cfg ? (_cfg.is_sensitive ? decrypt(_cfg.value_encrypted) : _cfg.value_encrypted) : '';
if (!process.env.INGEST_SECRET) die('ingest_secret did not decrypt (CONSOLE_ENCRYPTION_KEY?)');

// ── persona ──
const persona = db.prepare('SELECT id,name,address FROM relay_nodes WHERE id=?').get(PERSONA_RELAY);
if (!persona?.address) die(`persona relay ${PERSONA_RELAY} not found / no address`);
const LINKED_ADDR = persona.address;
const TG_USER = '990001';   // synthetic test tg user
console.log(`[dm-bet-e2e] market=${MARKET_ID}`);
console.log(`             side=${SIDE} stake=${STAKE_KAS} KAS  persona=${persona.name} (${LINKED_ADDR.slice(0, 26)}…)`);

// ── import the REAL bot, mock only the Telegram transport ──
const { bot } = await import('../bot.mjs');
const PM = await import('../prediction-menu.mjs');
const { specTitle } = PM;
bot.botInfo = { id: 1, is_bot: true, first_name: 'KANet Broker', username: process.env.TELEGRAM_BOT_USERNAME, can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false };
const replies = [];
bot.api.config.use(async (_prev, method, payload) => {
  if (method === 'sendMessage') { replies.push(typeof payload?.text === 'string' ? payload.text : ''); return { ok: true, result: { message_id: 1, date: 0, chat: payload.chat_id, text: payload.text } }; }
  return { ok: true, result: {} };
});
let _u = 5000;
function update(text) {
  const message = { message_id: ++_u, date: 1718000000, chat: { id: Number(TG_USER), type: 'private', first_name: 'Persona' }, from: { id: Number(TG_USER), is_bot: false, first_name: 'Persona', language_code: 'en' }, text };
  if (text.startsWith('/')) { const c = text.split(/\s/)[0]; message.entities = [{ type: 'bot_command', offset: 0, length: c.length }]; }
  return { update_id: ++_u, message };
}
async function feed(text) { replies.length = 0; await bot.handleUpdate(update(text)); return replies.join('\n'); }

async function relayCmd(cmd) {
  const r = await fetch(`${CONSOLE}/api/relay/${PERSONA_RELAY}/send-command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-secret': process.env.INGEST_SECRET }, body: JSON.stringify(cmd),
  });
  return r.json().catch(() => ({}));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── 1. /link (DM-originated identity bind) ──
const linkR = await feed(`/link ${LINKED_ADDR}`);
if (!/已绑定/.test(linkR)) die(`/link did not bind: ${linkR.slice(0, 200)}`);
console.log('  ✓ 1. /link bound (DM identity)');

// ── 2. resolve target title for menu matching ──
const tm = await fetch(`${CONSOLE}/api/pool/market/${encodeURIComponent(MARKET_ID)}`).then(r => r.json()).catch(() => ({}));
const market = tm.market || (tm.id ? tm : null);
if (!market) die('target market not found via /api/pool/market');
const targetTitle = (specTitle(market.resolution_rule_spec) || '').trim();
if (!targetTitle) die('target market has no usable title');
console.log(`  target: "${targetTitle}"`);

// ── 3. /bet → search → pick target (real menu navigation) ──
const betMenu = await feed('/bet');
if (/现在没有可押注的市场/.test(betMenu)) die('/bet shows no markets (broker/usable filter)');
const searchNum = (betMenu.match(/^(\d+)\.\s+🔍/m) || [])[1];
if (!searchNum) die(`no 🔍 search option in /bet menu: ${betMenu.slice(0, 200)}`);
await feed(searchNum);                                  // → search_input
const kw = (targetTitle.split(/\s+/).find(w => w.length >= 4) || targetTitle.slice(0, 6)).replace(/[^\p{L}\p{N}]/gu, '');
const searchRes = await feed(kw);
let pickNum = null;
for (const line of searchRes.split('\n')) {
  const mm = line.match(/^(\d+)\.\s+(.+?)\s+·\s+出单人/);
  if (mm) { const disp = mm[2].trim().replace(/…$/, ''); if (targetTitle.startsWith(disp) || disp === targetTitle) { pickNum = mm[1]; break; } }
}
if (!pickNum) die(`target not in search results for "${kw}":\n${searchRes.slice(0, 360)}`);
const detail = await feed(pickNum);                     // → detail
if (!/你押哪边/.test(detail)) die(`detail stage not reached: ${detail.slice(0, 200)}`);
console.log(`  ✓ 2-3. /bet → search "${kw}" → selected target (menu nav, real handler)`);

// ── 4. side → amount → confirm ──
await feed(SIDE === 'YES' ? '1' : '2');                 // detail → amount
const amtReply = await feed(String(STAKE_KAS));         // amount → confirm (复核 with side_p2sh)
if (!/(押注复核|地址)/.test(amtReply)) die(`amount stage failed: ${amtReply.slice(0, 200)}`);
const confirmReply = await feed('1');                   // confirm → pendingPayments set
if (!/已记录/.test(confirmReply)) die(`confirm failed: ${confirmReply.slice(0, 200)}`);
console.log('  ✓ 4. side+amount+confirm (pendingPayment set)');

// ── 5. read side_p2sh + exact_sompi from the real pendingPayments store ──
const pending = PM.listPendingPayments().find(p => p.tgUser === TG_USER);
if (!pending?.side_p2sh) die('no pendingPayment recorded for persona');
const { side_p2sh, exact_sompi, direction } = pending;
const exactKas = (Number(exact_sompi) / 1e8).toFixed(8);
console.log(`  side_p2sh=${side_p2sh}`);
console.log(`  exact=${exactKas} KAS (${exact_sompi} sompi)  direction=${direction}`);

// ── 6. AUTO-PAY: persona relay transfers exact KAS to side_p2sh (全自动, no human wallet) ──
const pay = await relayCmd({ type: 'transfer', target: side_p2sh, amount: exactKas });
const payTxid = pay?.txId || pay?.result?.txId;
if (!payTxid) die(`auto-pay transfer returned no txid: ${JSON.stringify(pay).slice(0, 240)}`);
console.log(`  ✓ 5. auto-paid ${exactKas} KAS → side_p2sh  tx=${payTxid.slice(0, 16)}…`);

// ── 7. wait for the payment (= PoolSide stake lock) to land on-chain ──
async function landed(addr, txid) { const r = await relayCmd({ type: 'check_utxo_landed', address: addr, txid }); return r?.landed ?? r?.result?.landed; }
let paid = false;
process.stdout.write('       waiting for lock to land ');
for (let i = 0; i < 30; i++) { await sleep(5000); if (await landed(side_p2sh, payTxid)) { paid = true; break; } process.stdout.write('.'); }
console.log('');
if (!paid) die('PoolSide stake lock did not land within 150s');
console.log('  ✓ 6. PoolSide stake lock LANDED on side_p2sh (NO-TX-NO-STATE satisfied)');

// ── 8. drive register-v06/confirm (3-validation: dest+amount+UNIQUE) → pool_bettor_sides insert ──
let registered = false, lockTx = null;
for (let i = 0; i < 12; i++) {
  const cr = await fetch(`${CONSOLE}/api/pool/market/${encodeURIComponent(MARKET_ID)}/bettor/register-v06/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ingest-secret': process.env.INGEST_SECRET },
    body: JSON.stringify({ linked_addr: LINKED_ADDR, direction, stake_kas: pending.stakeKas }),
  }).then(r => r.json()).catch(e => ({ error: String(e) }));
  if (cr.registered || cr.already_registered || cr.side_lock_tx || cr.merkle_index != null) { registered = true; lockTx = cr.side_lock_tx || null; break; }
  if (cr.wrong_payment_detected) die('confirm reports wrong_payment_detected (amount mismatch)');
  await sleep(5000);
}
if (!registered) die('register-v06/confirm never registered the side');
console.log(`  ✓ 7. register-v06/confirm registered  side_lock_tx=${(lockTx || payTxid).slice(0, 16)}…`);

// ── 9. verify the PoolSide row is genuinely MINE (not a shared-side_p2sh collision) ──
// side_p2sh is per-(bettor_pk, direction) — shared across markets — so a polluted persona (prior bets on
// the SAME pk+direction) makes (market, side_p2sh) ambiguous. Guard hard: attribute the row to MY payment
// (side_lock_tx == payTxid) or, on a fresh persona+market, the sole row; AND assert stake == what I paid.
const rows = db.prepare('SELECT side_lock_tx, direction, stake_amount, merkle_index FROM pool_bettor_sides WHERE market_id=? AND side_p2sh=?').all(MARKET_ID, side_p2sh);
if (rows.length === 0) die('no pool_bettor_sides row for (market, side_p2sh)');
const mine = rows.find(r => r.side_lock_tx === payTxid) || (rows.length === 1 ? rows[0] : null);
if (!mine) die(`registered row not attributable to my payment ${payTxid.slice(0, 16)} — ${rows.length} rows at this side_p2sh (persona polluted? use a fresh one)`);
if (!mine.side_lock_tx) die('attributed row has no side_lock_tx');
if (Math.abs(Number(mine.stake_amount) - Number(exact_sompi)) > 100000) die(`stake mismatch: row ${(mine.stake_amount / 1e8).toFixed(8)} vs paid ${exactKas} KAS (wrong row matched)`);
const lockIsMine = mine.side_lock_tx === payTxid ? ' (== my auto-pay tx ✓)' : '';
console.log(`  ✓ 8. pool_bettor_sides row is MINE: dir=${mine.direction} stake=${(mine.stake_amount / 1e8).toFixed(8)} KAS merkle_idx=${mine.merkle_index} lock_tx=${mine.side_lock_tx.slice(0, 16)}…${lockIsMine}`);
const row = mine;

console.log('\n✅ demo ② PASS — DM-originated bet真锁 PoolSide on-chain (全自动):');
console.log(`   /link → /bet menu → ${SIDE} → auto-pay → lock landed → register-v06 → pool_bettor_sides`);
console.log(`   market=${MARKET_ID} side_p2sh=${side_p2sh} lock_tx=${row.side_lock_tx}`);
try { db.close(); } catch {}
process.exit(0);
