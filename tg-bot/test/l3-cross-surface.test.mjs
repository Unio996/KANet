// L3 — cross-surface consistency (Bettor r954 全自动测 L3). Zero real Telegram, zero LLM, zero human.
//
// Proves a broker-1 prediction market is shown CONSISTENTLY across BOTH broker faces:
//   • Telegram menu  — tg-bot bot.handleUpdate('/bet') → broker-scoped market menu (the L2 surface).
//   • Kasia broker-DM — broker-llm-agent.js list_broker_prediction_markets handler → preview_text
//     (the deterministic text the LLM forwards 100% verbatim — testing it = testing the Kasia surface,
//      no :8000 / LLM non-determinism).
// …against the single canonical source GET /api/pool/markets?broker_relay_id=<broker-1>&status=pending_bettors.
//
// Both surfaces hit the SAME canonical endpoint with the SAME broker_relay_id filter (single-source);
// they apply DIFFERENT display post-filters (tg-bot: specIsUsable + category + deadline buffer,
// prediction-menu.mjs:343/422; Kasia: deadline>now + v0.6/v0.7 + slice 8, broker-llm-agent.js:599-601).
// So neither is a strict == of canonical, and the two may differ in count — by design.
//
// Assertions (granularity locked r960-r962 by J2 code-proof: ⊆ + non-empty, NOT ==):
//   L3① tg-bot surface: non-empty + ⊆ canonical broker-1 (no foreign-broker leak)   [L2 re-affirmed].
//   L3② Kasia surface:  non-empty + ⊆ canonical broker-1 (no foreign-broker leak).
//   L3③ CROSS-SURFACE PARITY (the L3-distinct claim): the fixture market (UNIQUE title) appears on
//       BOTH surfaces — the same brokered market is visible on the Telegram face AND the Kasia DM face.
//   L3④ regression guard (after the finding fix): both faces now apply the SAME single-source usable
//       gate (lib/spec-validation.isStructuredSpec) → un-usable/junk markets appear on NEITHER face.
//
// Fixture (Bettor r963 + NWT fixture-mirror): clone a REAL usable v0.6/v0.7 broker market's full
// column set (production-faithful, NOT a hand-built minimal row), override id/broker=broker-1/spec
// (UNIQUE title)/deadline → DB layer (both surfaces + canonical read the same row) → assert → teardown.
//
// Run:  node tg-bot/test/l3-cross-surface.test.mjs   (from tg-bot/ so grammy + bot.mjs resolve)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// ── env: token real; broker filter = broker-1; DB_PATH absolute so broker-llm-agent's db/client.js
//    (cwd-relative default) opens the real console.db regardless of cwd; PORT/CONSOLE_URL → live Console.
//    (DB_PATH + BROKER_PREDICTION_BROKER_RELAY_ID MUST be set before importing broker-llm-agent.js.) ──
const kanetEnv = (() => { try { return readFileSync(new URL('../../kanet.env', import.meta.url), 'utf8'); } catch { return ''; } })();
const kv = (k) => (kanetEnv.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || '';
const BROKER_1 = '15593e10-fe63-4806-a7b5-cae062699de8';
const DB_ABS = fileURLToPath(new URL('../../kasia-console/data/console.db', import.meta.url));
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || kv('TELEGRAM_BOT_TOKEN');
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || kv('TELEGRAM_BOT_USERNAME') || 'KANET_Broker_bot';
process.env.INGEST_SECRET = process.env.INGEST_SECRET || 'l3-test-dummy';
process.env.CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3200';
process.env.PORT = process.env.PORT || '3200';                          // broker-llm markets-tool fetch target
process.env.DB_PATH = process.env.DB_PATH || DB_ABS;                    // broker-llm-agent db/client.js
process.env.BROKER_PREDICTION_BROKER_RELAY_ID = BROKER_1;               // Kasia markets-tool broker scope

let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? ` (${detail})` : ''}`); fail++; } };

if (!process.env.TELEGRAM_BOT_TOKEN) { console.log('  ✗ no TELEGRAM_BOT_TOKEN'); console.log('\nL3: 0/? PASS'); process.exit(1); }

// ── fixture: clone a real usable market full row → override id/broker/spec(UNIQUE)/deadline (NWT mirror) ──
const require = createRequire(new URL('../../kasia-console/package.json', import.meta.url));
const Database = require('better-sqlite3');
const db = new Database(DB_ABS, { timeout: 5000 });
const FIXTURE_ID = '_l3-fixture-' + Date.now();
const FIXTURE_TITLE = 'L3 cross-surface fixture ' + FIXTURE_ID;        // UNIQUE → unambiguous parity check
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
    title: FIXTURE_TITLE,
    resolution_criteria: 'Resolves YES if the L3 test observes this market on both broker surfaces.',
    data_source_canonical: 'kanet-l3-test-fixture',
  });
  row.deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;        // well past any display buffer
  row.created_at = new Date().toISOString();
  row.updated_at = row.created_at;
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO pool_markets (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(row);
}
process.on('exit', removeFixture);   // belt-and-suspenders teardown even on a thrown assertion
createFixture();

// ── canonical broker-1 set (the single source BOTH surfaces must be ⊆ of) ──
const { specTitle } = await import('../prediction-menu.mjs');
const canonical = await fetch(`${process.env.CONSOLE_URL}/api/pool/markets?broker_relay_id=${BROKER_1}&status=pending_bettors&limit=200`).then(r => r.json()).catch(() => ({}));
const canonTitles = new Set((canonical.markets || []).map(m => (specTitle(m.resolution_rule_spec) || '').trim()).filter(Boolean));
// title-tolerant ∈: surface title may be truncated (tg-bot trunc 56) → prefix of some canonical title.
const inCanon = (t) => [...canonTitles].some(ct => ct.startsWith(t.replace(/…$/, '')) || ct === t);

// ── Surface A: tg-bot Telegram menu (real bot.handleUpdate on the imported bot; mock transport) ──
const { bot } = await import('../bot.mjs');
const replies = [];
bot.api.config.use(async (_prev, method, payload) => {
  if (method === 'sendMessage') { replies.push(payload?.text || ''); return { ok: true, result: { message_id: 1, date: 0, chat: payload.chat_id, text: payload.text } }; }
  return { ok: true, result: {} };
});
bot.botInfo = { id: 1, is_bot: true, first_name: 'KANet Broker', username: process.env.TELEGRAM_BOT_USERNAME, can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false };
let _uid = 2000;
function tgUpdate(text, fromId = 525252) {
  const message = { message_id: _uid, date: 1718000000, chat: { id: fromId, type: 'private', first_name: 'Test' }, from: { id: fromId, is_bot: false, first_name: 'Test', language_code: 'en' }, text };
  if (text.startsWith('/')) { const cmd = text.split(/\s/)[0]; message.entities = [{ type: 'bot_command', offset: 0, length: cmd.length }]; }
  return { update_id: ++_uid, message };
}
async function feed(text) { replies.length = 0; await bot.handleUpdate(tgUpdate(text)); return replies.slice(); }

const betText = (await feed('/bet')).join('\n');
const tgNoMarkets = betText.includes('现在没有可押注的市场');
const catNums = [...betText.matchAll(/^(\d+)\.\s+(?!🔍)/gm)].map(m => Number(m[1]));
const tgTitles = [];
for (const n of catNums) {
  const list = (await feed(String(n))).join('\n');
  for (const r of list.split('\n')) { const mm = r.match(/^\d+\.\s+(.+?)\s+·\s+出单人/); if (mm) tgTitles.push(mm[1].trim()); }
  await feed('/start'); // reset session between category drills
}

// ── Surface B: Kasia broker-DM (real broker-llm-agent markets-tool handler → preview_text) ──
const { _testListBrokerMarketsPreview } = await import('../../kasia-console/src/services/broker-llm-agent.js');
const kasiaRes = await _testListBrokerMarketsPreview();
const kasiaText = kasiaRes?.preview_text || '';
const kasiaNoMarkets = kasiaText.includes('暂时没有活跃的预测市场');
// preview_text market rows: "N. <title>" then a separate "   截止 …" line → capture the "N. <title>" lines.
const kasiaTitles = [...kasiaText.matchAll(/^\d+\.\s+(.+)$/gm)].map(m => m[1].trim());

// ── assertions ──
// L3① tg-bot surface
check('L3① tg-bot non-empty (broker-1 ≥1 displayable)', !tgNoMarkets && tgTitles.length > 0, tgNoMarkets ? 'no-markets msg' : `${tgTitles.length} titles`);
const tgLeaks = tgTitles.filter(t => !inCanon(t));
check('L3① tg-bot ⊆ canonical broker-1 (no foreign-broker leak)', tgLeaks.length === 0, `leaks: ${tgLeaks.join(' / ').slice(0, 100)}`);
// L3② Kasia surface
check('L3② Kasia non-empty (broker-1 ≥1 displayable)', !kasiaNoMarkets && kasiaTitles.length > 0, kasiaNoMarkets ? 'no-markets msg' : `${kasiaTitles.length} titles`);
const kasiaLeaks = kasiaTitles.filter(t => !inCanon(t));
check('L3② Kasia ⊆ canonical broker-1 (no foreign-broker leak)', kasiaLeaks.length === 0, `leaks: ${kasiaLeaks.join(' / ').slice(0, 100)}`);
// L3③ cross-surface parity: fixture (unique title) shown on BOTH faces
const inTg = tgTitles.some(t => FIXTURE_TITLE.startsWith(t.replace(/…$/, '')) || t === FIXTURE_TITLE);
const inKasia = kasiaTitles.some(t => t === FIXTURE_TITLE || FIXTURE_TITLE.startsWith(t.replace(/…$/, '')));
check('L3③ cross-surface parity: fixture market shown on BOTH tg-bot AND Kasia', inTg && inKasia, `tg=${inTg} kasia=${inKasia}`);
// L3④ regression guard (Bettor r971 + L3 finding FIX): Kasia broker-DM now applies the SAME usable
// gate as tg-bot (single-source lib/spec-validation.isStructuredSpec) → un-usable/junk markets must
// appear on NEITHER face. Before the fix Kasia showed junk tg-bot hid — the bug this cross-surface test caught.
const { isStructuredSpec } = await import('../../kasia-console/src/lib/spec-validation.js');
const usableTitle = (m) => { try { const o = JSON.parse(m.resolution_rule_spec); return (o.title || '').trim(); } catch { return String(m.resolution_rule_spec || '').trim(); } };
const unusableTitles = (canonical.markets || []).filter(m => !isStructuredSpec(m.resolution_rule_spec)).map(usableTitle).filter(Boolean);
const shows = (titles, ut) => titles.some(t => t === ut || ut.startsWith(t.replace(/…$/, '')) || t.startsWith(ut.slice(0, 40)));
const kasiaJunk = unusableTitles.filter(ut => shows(kasiaTitles, ut));
const tgJunk = unusableTitles.filter(ut => shows(tgTitles, ut));
check('L3④ Kasia applies usable gate — no un-usable/junk shown (regression: finding fix)', kasiaJunk.length === 0, `kasia junk: ${kasiaJunk.join(' / ').slice(0, 80)}`);
check('L3④ tg-bot applies usable gate — no un-usable/junk shown', tgJunk.length === 0, `tg junk: ${tgJunk.join(' / ').slice(0, 80)}`);
console.log(`  ⓘ counts: tg-bot ${tgTitles.length} / Kasia ${kasiaTitles.length} / canonical broker-1 ${canonTitles.size} (${unusableTitles.length} un-usable, now excluded by BOTH faces)`);

console.log(`\nL3: ${pass}/${pass + fail} PASS`);

// clean exit: teardown fixture + close handles (better-sqlite3 + undici keep-alive) so process.exit is clean.
removeFixture();
try { db.close(); } catch { /* already closed */ }
const code = fail > 0 ? 1 : 0;
try { const u = await import('undici'); u.getGlobalDispatcher().destroy(); } catch { /* not available */ }
process.exit(code);
