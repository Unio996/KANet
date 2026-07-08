// L2d — FULL-CHAIN E2E for the 2026-07-08 auto-pay/pendingPayments bug (Owner-mandated standard:
// "必须实实测试上链跑通过, 才算过" — a stubbed test alone does not close this out).
//
// Unlike L2c (which stubs the two custodial-wallet HTTP calls to isolate the state-management
// logic), this test uses a REAL funded testnet custodial wallet, a REAL tgWalletSend broadcast,
// waits for REAL on-chain landing, and asserts REAL confirm's pollPendingBets() run produces a
// REAL new pool_bettor_sides row. Nothing here is mocked except the passage of time (poll loop is
// invoked directly rather than waiting for its 3s cron tick — same function, same code path).
//
// Prerequisite (one-time, done manually by J2 2026-07-08): a dedicated test wallet
// tg_user_id='j2_l2c_fullchain_e2e_test' created via POST /api/tg-wallet/create and funded with
// 3 KAS from a relay (kaspatest:qzd43fwr88zjvlfmrwwvkujvldk3gtv89fsudw2xa7uxpa8w84m8k2hsczxce).
// Reused across runs (each run spends ~0.5-1 KAS; balance_kas is asserted >= exactPayKas+0.01 up
// front so the test fails loud with a clear refill instruction instead of a confusing downstream
// error if it ever runs dry).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const kanetEnv = (() => { try { return readFileSync(new URL('../../kanet.env', import.meta.url), 'utf8'); } catch { return ''; } })();
const kv = (k) => (kanetEnv.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() || '';
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || kv('TELEGRAM_BOT_TOKEN');
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || kv('TELEGRAM_BOT_USERNAME') || 'KANET_Broker_bot';
process.env.CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3200';
process.env.CONSOLE_ENCRYPTION_KEY = process.env.CONSOLE_ENCRYPTION_KEY || kv('CONSOLE_ENCRYPTION_KEY');
// db/client.js resolves DB_PATH relative to process.cwd() — this test may run from tg-bot/, not
// kasia-console/, so it must be pinned to an absolute path or db/client.js opens/creates the wrong
// (empty) sqlite file and every downstream getConfig/query silently operates on nothing.
process.env.DB_PATH = process.env.DB_PATH || fileURLToPath(new URL('../../kasia-console/data/console.db', import.meta.url));

let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? ` (${detail})` : ''}`); fail++; } };

// ── real ingest_secret (DB-stored, encrypted at rest — same decrypt path the live console uses) ──
const { getConfig } = await import('../../kasia-console/src/data/settings/configs.js');
const INGEST_SECRET = await getConfig('ingest_secret');
if (!INGEST_SECRET) { console.log('  ✗ no ingest_secret in config_entries — is console running with CONSOLE_ENCRYPTION_KEY set?'); console.log('\nL2d: 0/? PASS'); process.exit(1); }
process.env.INGEST_SECRET = INGEST_SECRET;

const TG_USER = 'j2_l2c_fullchain_e2e_test';

const require = createRequire(new URL('../../kasia-console/package.json', import.meta.url));
const Database = require('better-sqlite3');
const db = new Database(fileURLToPath(new URL('../../kasia-console/data/console.db', import.meta.url)), { timeout: 5000 });

const wallet = db.prepare('SELECT kaspa_address FROM tg_custodial_wallets WHERE tg_user_id = ?').get(TG_USER);
if (!wallet) { console.log(`  ✗ test wallet ${TG_USER} not found — create it once via POST /api/tg-wallet/create + fund with ~3 KAS`); console.log('\nL2d: 0/? PASS'); process.exit(1); }

const kaspa = (await import('../../kasia-console/node_modules/kaspa-wasm/kaspa.js')).default;
const LINKED_ADDR = kaspa.Keypair.random().toAddress(kaspa.NetworkType.Testnet).toString();

const PM = await import('../prediction-menu.mjs');
const BOT = await import('../bot.mjs');
PM.setLinkedAddr(TG_USER, LINKED_ADDR);

// MIN_STAKE_KAS in prediction-menu.mjs is 1.0 — use exactly that floor so the reusable wallet's
// 3 KAS balance survives several runs' worth of miner fees + stake before needing a top-up.
const REAL_STAKE_KAS = 1.0;

const FIXTURE_ID = '_l2d-fixture-' + Date.now();
// teardown must cover every table a real registration touches — a real bet here also genesis-mints
// a real PayoutShard (funded from the gateway relay's own testnet balance, a small accepted cost of
// testing the real path) and creates a real market_shards/pool_bettor_sides row, not just the
// logical pool_markets row. Missing any of these leaves permanent debug rows in a shared live DB
// (caught by hand after this test's first run — L2c's simpler fixture never needed this because it
// never got past prep to a real registration).
function removeFixture() {
  // FK order matters: pool_bettor_sides/market_shards/payout_shards reference pool_markets rows
  // (both the logical row AND the shard-clone row created at `${FIXTURE_ID}-s0` by
  // createShardMarketRow during registration) — deleting pool_markets first throws
  // SQLITE_CONSTRAINT_FOREIGNKEY (caught by hand once already; codified here so it stays fixed).
  try { db.prepare(`DELETE FROM pool_bettor_sides WHERE market_id LIKE ?`).run(`${FIXTURE_ID}%`); } catch {}
  try { db.prepare(`DELETE FROM market_shards WHERE logical_market_id LIKE ?`).run(`${FIXTURE_ID}%`); } catch {}
  try { db.prepare(`DELETE FROM payout_shards WHERE logical_market_id LIKE ?`).run(`${FIXTURE_ID}%`); } catch {}
  try { db.prepare(`DELETE FROM pool_markets WHERE id LIKE ?`).run(`${FIXTURE_ID}%`); } catch {}
}
function createFixture() {
  const tmpl = db.prepare(
    "SELECT * FROM pool_markets WHERE protocol_status='pending_bettors' AND protocol_version='v0.7' AND resolution_rule_spec LIKE '{%' ORDER BY created_at DESC LIMIT 1"
  ).get();
  if (!tmpl) throw new Error('no v0.7 template market to mirror for fixture');
  const row = { ...tmpl };
  row.id = FIXTURE_ID;
  row.spine_p2sh = 'kaspatest:l2dfixturedummyspine' + Date.now();   // FINDING-2 commingled guard, same as L2c
  row.deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  row.created_at = new Date().toISOString();
  row.updated_at = row.created_at;
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO pool_markets (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(row);
}
process.on('exit', removeFixture);
createFixture();

// ── preflight: confirm the reusable test wallet still has enough balance (fail loud + tell the
//    operator exactly what to do, rather than a confusing mid-flow error many steps downstream). ──
const balRes = await fetch(`${process.env.CONSOLE_URL}/api/tg-wallet/${encodeURIComponent(TG_USER)}`, { headers: { 'x-ingest-secret': INGEST_SECRET } }).then((r) => r.json());
check('preflight: reusable test wallet has enough balance for this run', balRes.ok && balRes.balance_kas >= REAL_STAKE_KAS + 0.01,
  `balance=${balRes.balance_kas}, need>=${REAL_STAKE_KAS + 0.01} — refund kaspatest relay → ${wallet.kaspa_address} if this fails`);
if (!(balRes.ok && balRes.balance_kas >= REAL_STAKE_KAS + 0.01)) { removeFixture(); console.log(`\nL2d: ${pass}/${pass + fail} PASS`); process.exit(1); }

await PM.startBetFromMarket(TG_USER, FIXTURE_ID);
await PM.handleReply(TG_USER, '1', LINKED_ADDR);                 // side YES
await PM.handleReply(TG_USER, String(REAL_STAKE_KAS), LINKED_ADDR);  // real poolRegisterPrep against the live console

const reply = await PM.handleReply(TG_USER, '1', LINKED_ADDR);  // confirm → REAL tgWalletSend broadcast
check('auto-pay reply is the success message', typeof reply === 'string' && !/error|fail/i.test(reply), reply);

const afterSend = PM.listPendingPayments().find((p) => p.tgUser === TG_USER);
check('pendingPayments entry survives the real broadcast (the regression itself)', !!afterSend, JSON.stringify(afterSend));

// ── wait for the real payment to land, then run the REAL pollPendingBets() (same function
//    bot.mjs's cron calls, invoked directly instead of waiting up to pendingBetPollMs for the
//    next tick) until it registers the bet. ──
let registered = false;
for (let i = 0; i < 20 && !registered; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  await BOT.pollPendingBets();
  registered = !PM.listPendingPayments().some((p) => p.tgUser === TG_USER);
}
check('pollPendingBets clears the entry within the wait window (confirm succeeded)', registered, `still pending after wait: ${JSON.stringify(PM.listPendingPayments().find((p) => p.tgUser === TG_USER))}`);

const bettorSideRow = db.prepare(`
  SELECT pbs.* FROM pool_bettor_sides pbs
  JOIN market_shards ms ON pbs.market_id = ms.shard_market_id
  WHERE ms.logical_market_id = ?
  ORDER BY pbs.id DESC LIMIT 1
`).get(FIXTURE_ID);
check('a real pool_bettor_sides row exists for this bet', !!bettorSideRow, `no row for market ${FIXTURE_ID}`);
if (bettorSideRow) check('the registered stake matches what was sent', Number(bettorSideRow.stake_amount) === Math.round(REAL_STAKE_KAS * 1e8), `stake_amount=${bettorSideRow.stake_amount}`);

PM.clearPendingPayment(TG_USER);
removeFixture();

console.log(`\nL2d: ${pass}/${pass + fail} PASS`);
if (fail > 0) process.exit(1);
