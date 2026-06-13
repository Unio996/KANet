// L2 — handler logic (Bettor r954 全自动测试 L2, the core). Zero real Telegram, zero human.
//
// Feeds field-complete (real-shaped) Telegram Updates through the PRODUCTION handler pipeline
// (grammy bot.handleUpdate on the imported bot — bot.mjs now exports {bot} without auto-starting),
// capturing replies via an api transformer (no real sendMessage). This is the real surface, not a
// replica (NWT fixture-mirror discipline).
//
// Assertions (locked by team consensus r958-r960, NWT+J1+J2+Bettor):
//   L2① /start → reply === M.startMessage() (the menu the user gets).
//   L2② broker-scoped /bet:
//       (a) the handler calls the canonical /api/pool/markets WITH broker_relay_id=<bot's broker>
//           — fetch-spy direct proof the filter is applied (NWT bonus).
//       (b) ⊆: every market the bot displays ∈ the canonical broker-1 set (no foreign-broker leak).
//       (c) ≥1: the bot displays at least one market (non-empty — guards the vacuous-⊆ false-green).
//   We do NOT assert exact == (bot legitimately post-filters by usable/deadline — J2 code-proof
//   prediction-menu.mjs:343/422 — so bot ⊊ canonical is by-design; == would false-fail). Drift-free:
//   the expected set is fetched from the SAME canonical endpoint the bot uses, not a re-written query.
//
// Honest boundary (J1 co-review angle): this proves the handler LOGIC (menu + broker-scoping) against
// a mock transport. It does NOT prove a real end-to-end Telegram round-trip — that is L1 (transport)
// + L4 (real user). Run:  node tg-bot/test/l2-handler.test.mjs   (from tg-bot/ so grammy + bot.mjs resolve)

import { readFileSync } from 'node:fs';

// ── env for importing bot.mjs (token real; ingest dummy — pool/markets is a public read) ──
const kanetEnv = (() => { try { return readFileSync(new URL('../../kanet.env', import.meta.url), 'utf8'); } catch { return ''; } })();
const kv = (k) => (kanetEnv.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || '';
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || kv('TELEGRAM_BOT_TOKEN');
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || kv('TELEGRAM_BOT_USERNAME') || 'KANET_Broker_bot';
process.env.INGEST_SECRET = process.env.INGEST_SECRET || 'l2-test-dummy';
process.env.CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3200';

const BROKER_1 = '15593e10-fe63-4806-a7b5-cae062699de8';

let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? ` (${detail})` : ''}`); fail++; } };

if (!process.env.TELEGRAM_BOT_TOKEN) { console.log('  ✗ no TELEGRAM_BOT_TOKEN'); console.log('\nL2: 0/? PASS'); process.exit(1); }

// ── fixture (Bettor r963): the test seeds its OWN usable broker-1 market so the non-empty assertion
// has a legitimate input regardless of live demo data — NOT a hack (it's a real-shaped controlled input,
// torn down after). Mirrors a real pending_bettors v0.6/v0.7 market's full column set (NWT fixture-mirror),
// overriding only id / broker / spec / deadline. Seeded at the DB layer so BOTH the bot's /api/pool/markets
// fetch AND the canonical comparison read the same row. Console reads console.db live, so it's visible at once.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../kasia-console/package.json', import.meta.url));
const Database = require('better-sqlite3');
const db = new Database(fileURLToPath(new URL('../../kasia-console/data/console.db', import.meta.url)), { timeout: 5000 });
const FIXTURE_ID = '_l2-fixture-' + Date.now();
function removeFixture() { try { db.prepare('DELETE FROM pool_markets WHERE id=?').run(FIXTURE_ID); } catch {} }
function createFixture() {
  const tmpl = db.prepare(
    "SELECT * FROM pool_markets WHERE protocol_status='pending_bettors' AND protocol_version IN ('v0.6','v0.7') AND resolution_rule_spec LIKE '{%' ORDER BY created_at DESC LIMIT 1"
  ).get();
  if (!tmpl) throw new Error('no template usable market to mirror for fixture');
  const row = { ...tmpl };
  row.id = FIXTURE_ID;
  row.broker_relay_id = BROKER_1;
  row.resolution_rule_spec = JSON.stringify({
    title: 'L2 fixture — broker-scope test market',
    resolution_criteria: 'Resolves YES if the L2 test observes this market in broker-1\'s menu.',
    data_source_canonical: 'kanet-l2-test-fixture',
  });
  row.deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;   // well past the 10-min display buffer
  row.created_at = new Date().toISOString();
  row.updated_at = row.created_at;
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO pool_markets (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(row);
}
process.on('exit', removeFixture);   // belt-and-suspenders teardown even on a thrown assertion
createFixture();

// ── fetch-spy: observe the REAL fetch URLs the production console-api builds (no replacement) ──
const fetchUrls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => { fetchUrls.push(String(url)); return realFetch(url, opts); };

// import AFTER env is set — bot.mjs registers handlers (no side-effects now) + resolves broker from Console.
const { bot } = await import('../bot.mjs');
const M = await import('../messages.mjs');
const { specTitle } = await import('../prediction-menu.mjs');

// ── api transformer: capture outgoing sendMessage text, never hit Telegram ──
const replies = [];
bot.api.config.use(async (_prev, method, payload) => {
  if (method === 'sendMessage') { replies.push(payload?.text || ''); return { ok: true, result: { message_id: 1, date: 0, chat: payload.chat_id, text: payload.text } }; }
  return { ok: true, result: {} };
});

// L2 is handler-logic (transport is L1's job) → set a mock botInfo so handleUpdate skips the real
// getMe/init network call. The handlers don't depend on real bot identity.
bot.botInfo = {
  id: 1, is_bot: true, first_name: 'KANet Broker', username: process.env.TELEGRAM_BOT_USERNAME,
  can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
};

let _uid = 1000;
function tgUpdate(text, fromId = 424242) {
  // field-complete real-shaped Telegram Update (NWT: 非简化对象 — real update_id/message/chat/from/text)
  const message = {
    message_id: _uid,
    date: 1718000000,
    chat: { id: fromId, type: 'private', first_name: 'Test' },
    from: { id: fromId, is_bot: false, first_name: 'Test', language_code: 'en' },
    text,
  };
  // A real Telegram command update carries a bot_command entity — grammy's bot.command() routes via it.
  // (Omitting it is the classic fixture-mirror miss: the simplified mock won't reach the handler.)
  if (text.startsWith('/')) {
    const cmd = text.split(/\s/)[0];
    message.entities = [{ type: 'bot_command', offset: 0, length: cmd.length }];
  }
  return { update_id: ++_uid, message };
}
async function feed(text) { replies.length = 0; await bot.handleUpdate(tgUpdate(text)); return replies.slice(); }

// ── L2① /start → the menu ──
const startReplies = await feed('/start');
check('L2① /start returns the menu (=== M.startMessage())', startReplies.length === 1 && startReplies[0] === M.startMessage(), `got ${startReplies.length} replies`);

// ── L2② /bet broker-scoped ──
fetchUrls.length = 0;
const betReplies = await feed('/bet');
const betText = betReplies.join('\n');

// (a) filter applied: a /api/pool/markets fetch carried broker_relay_id=<bot's broker>
const marketsFetch = fetchUrls.find(u => u.includes('/api/pool/markets'));
check('L2②a handler fetched /api/pool/markets', !!marketsFetch, fetchUrls.join(' | ').slice(0, 120));
check('L2②a fetch is broker-scoped (broker_relay_id=broker-1)', !!marketsFetch && marketsFetch.includes(`broker_relay_id=${BROKER_1}`), marketsFetch);

// (c) non-empty: /bet did not return the no-markets message + shows a category menu
const noMarkets = betText.includes('现在没有可押注的市场');
check('L2②c non-empty (broker-1 has ≥1 displayable market)', !noMarkets && /\d+\.\s/.test(betText), noMarkets ? 'no-markets message' : 'no menu rows');

// (b) ⊆: drill every category → collect displayed market titles → each ∈ canonical broker-1 titles
const canonical = await realFetch(`${process.env.CONSOLE_URL}/api/pool/markets?broker_relay_id=${BROKER_1}&status=pending_bettors&limit=200`).then(r => r.json()).catch(() => ({}));
const canonTitles = new Set((canonical.markets || []).map(m => (specTitle(m.resolution_rule_spec) || '').trim()).filter(Boolean));

// parse the /bet category menu for category option numbers (skip 🔍搜索), drill each, collect displayed titles.
const catNums = [...betText.matchAll(/^(\d+)\.\s+(?!🔍)/gm)].map(m => Number(m[1]));
const displayedTitles = [];
for (const n of catNums) {
  const marketList = (await feed(String(n))).join('\n');
  // market rows: "N. <trunc title>  · 出单人 …" — take the title segment before " · "
  for (const row of marketList.split('\n')) {
    const mm = row.match(/^\d+\.\s+(.+?)\s+·\s+出单人/);
    if (mm) displayedTitles.push(mm[1].trim());
  }
  await feed('/start'); // reset session between category drills
}
// title-tolerant ⊆: displayed title is trunc(specTitle,56) → it must be a prefix of some canonical broker-1 title
const leaks = displayedTitles.filter(dt => ![...canonTitles].some(ct => ct.startsWith(dt.replace(/…$/, '')) || ct === dt));
check('L2②b ⊆ — every displayed market ∈ broker-1 canonical (no foreign-broker leak)', leaks.length === 0, `leaks: ${leaks.join(' / ').slice(0, 100)}`);
console.log(`  displayed ${displayedTitles.length} market(s); canonical broker-1 = ${canonTitles.size}`);

console.log(`\nL2: ${pass}/${pass + fail} PASS`);

// Clean exit: tear down fixture + close the open handles (better-sqlite3 db + undici keep-alive pool
// from the Console fetches) so process.exit doesn't trip the Windows libuv UV_HANDLE_CLOSING assert.
globalThis.fetch = realFetch;
removeFixture();
try { db.close(); } catch { /* already closed */ }
process.exit(fail > 0 ? 1 : 0);   // sockets already non-keep-alive (set at top) → clean exit
