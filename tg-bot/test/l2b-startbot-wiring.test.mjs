// L2b — startBot() poller-wiring regression guard (J1 #357/#358 poller-gap closure).
//
// Why this exists: L1 (getMe) and L2 (handleUpdate) both BYPASS the production poller — they import
// { bot } and feed updates directly, never calling startBot(). So if a future refactor drops a line
// from startBot() (the classic "handlers registered but never polling = silently dead bot"), L1+L2
// stay green while production is dead — they structurally cannot catch it. KANet-UI's one-time dev
// runtime check (_launch→startBot→up) proved the CURRENT refactor is fine, but it's not in the test
// suite. This micro-test closes the gap permanently, at the WIRING level.
//
// What it asserts: startBot() calls bot.start() (grammy poller launched) + registers its background
// pollers — with both stubbed, so nothing actually connects to Telegram or schedules real timers.
//
// Honest boundary (J1 lane): this proves startBot() WIRES the poller path. It does NOT prove the
// poller receives real Telegram updates end-to-end — that stays L4 (real round-trip) / Owner /start.
// Layered honest reporting: L1 transport + L2 handler logic + L2b startBot-wiring = "bot logic +
// go-live mechanism wired"; real end-to-end round-trip = L4.
//
// Run:  node tg-bot/test/l2b-startbot-wiring.test.mjs   (from repo root or tg-bot/; grammy + bot.mjs resolve)

import { readFileSync } from 'node:fs';

// ── env for importing bot.mjs (token real so `new Bot(token)` constructs; rest dummy / best-effort) ──
const kanetEnv = (() => { try { return readFileSync(new URL('../../kanet.env', import.meta.url), 'utf8'); } catch { return ''; } })();
const kv = (k) => (kanetEnv.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || '';
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || kv('TELEGRAM_BOT_TOKEN');
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || kv('TELEGRAM_BOT_USERNAME') || 'KANET_Broker_bot';
process.env.INGEST_SECRET = process.env.INGEST_SECRET || 'l2b-test-dummy';
// bot.mjs import does a best-effort resolveBrokerRelayId() (graceful: falls back to env on unreachable),
// so the Console need not be up for this test; the default just matches the rest of the suite.
process.env.CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3200';

let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? ` (${detail})` : ''}`); fail++; } };

if (!process.env.TELEGRAM_BOT_TOKEN) { console.log('  ✗ no TELEGRAM_BOT_TOKEN'); console.log('\nL2b: 0/? PASS'); process.exit(1); }

// import bot.mjs (registers handlers; the refactor moved all polling into startBot() so import does NOT go live)
const { bot, startBot } = await import('../bot.mjs');

// ── stub the go-live primitives BEFORE calling startBot() so nothing actually goes live ──
// (1) global setInterval → count + no-op (don't schedule real poll timers that would hit the Console)
const realSetInterval = globalThis.setInterval;
let intervalCount = 0;
globalThis.setInterval = (_fn, _ms) => { intervalCount++; return 0; };
// (2) grammy bot.start() → the long-poll launcher; stub so it never connects to Telegram (also avoids 409)
let botStartCalled = 0;
const realBotStart = bot.start;
bot.start = async () => { botStartCalled++; };

let threw = null;
try { startBot(); } catch (e) { threw = e; }

// restore globals immediately
globalThis.setInterval = realSetInterval;
bot.start = realBotStart;

// ── assertions: startBot() must wire the full go-live path ──
check('L2b startBot() runs without throwing', threw === null, threw && threw.message);
// THE critical one: dropping bot.start() = bot registers handlers but never polls = silently dead.
check('L2b startBot() calls bot.start() (poller launched — guards "registered but not polling = dead bot")',
  botStartCalled === 1, `bot.start called ${botStartCalled}x`);
// the 4 background pollers (broker-refresh + pollLoop + pollPendingBets + pollSettleResults). Exact count
// is intentional: dropping/adding one should be a conscious change that updates this guard.
check('L2b startBot() registers its 4 background pollers (setInterval x4)',
  intervalCount === 4, `got ${intervalCount} setInterval(s)`);

console.log(`\nL2b: ${pass}/${pass + fail} PASS`);

// clean exit (bot.mjs import may open an undici keep-alive handle from the broker-resolve fetch)
const code = fail > 0 ? 1 : 0;
try { const u = await import('undici'); u.getGlobalDispatcher().destroy(); } catch { /* not available */ }
process.exit(code);
