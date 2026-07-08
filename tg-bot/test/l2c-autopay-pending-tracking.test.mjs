// L2c — regression guard for the 2026-07-08 "auto-pay success wipes pendingPayments" bug.
//
// Root cause (commit 51a1ad1c, 2026-07-05): the custodial auto-pay success branch in
// prediction-menu.mjs called pendingPayments.delete(tgUser) right after tgWalletSend()
// returned ok:true. register-v07/confirm's ONLY caller anywhere in tg-bot is
// pollPendingBets() (bot.mjs), which only ever looks at entries still in pendingPayments —
// so deleting the entry the instant the transfer broadcast succeeded (long before the
// payment could actually land + get registered) silently stopped confirm from EVER being
// called again for that bet. Fixed by commit 4385d633 (2026-07-08): keep the entry so
// pollPendingBets can poll it to completion, same as the manual-payment path already does.
//
// This test proves the specific failure mode directly against the production handler
// (handleReply), not a re-written replica: drive a session through stage='confirm' with a
// custodial wallet that has sufficient balance, force tgWalletSend to report success, and
// assert the pendingPayments entry survives the reply (NWT fixture-mirror discipline: same
// module, same functions, only the two outbound HTTP calls are stubbed).

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'l2c-test-dummy-token';
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'KANET_Broker_bot';
process.env.CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3200';
process.env.INGEST_SECRET = process.env.INGEST_SECRET || 'l2c-test-dummy';

let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) { console.log(`  ✓ ${name}`); pass++; } else { console.log(`  ✗ ${name}${detail ? ` (${detail})` : ''}`); fail++; } };

// ── fetch-stub (NOT a spy — this test needs controlled responses for the two custodial-wallet
//    calls the auto-pay branch makes, without touching a real wallet or moving real KAS) ──
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('/api/tg-wallet/') && u.endsWith('/send')) {
    return new Response(JSON.stringify({ ok: true, txId: 'l2c-fake-txid-'.padEnd(64, '0') }), { status: 200 });
  }
  if (u.includes('/api/tg-wallet/')) {
    // GET balance check: report a custodial wallet with ample balance → forces the auto-pay branch.
    return new Response(JSON.stringify({ ok: true, exists: true, balance_kas: 999999 }), { status: 200 });
  }
  return realFetch(url, opts);
};

const PM = await import('../prediction-menu.mjs');

// linked_addr only needs to be a well-formed testnet-12 address (register-v07/prep derives an
// x-only pubkey from it) — it never needs funding for this test, since the logic under test is
// purely about pendingPayments state, not a real payment landing.
const kaspa = (await import('../../kasia-console/node_modules/kaspa-wasm/kaspa.js')).default;
const LINKED_ADDR = kaspa.Keypair.random().toAddress(kaspa.NetworkType.Testnet).toString();

const TG_USER = 999_000_777;
PM.setLinkedAddr(TG_USER, LINKED_ADDR);

// handleReply reads/writes the module-private `sessions` map — no exported setter for
// stage='confirm' (users only reach it by walking the flow). Drive it for real: startBetFromMarket
// → pick side → enter amount → handleReply lands the session on stage='confirm' itself (this file
// L763-794). That needs one usable v0.7 market row, mirrored from a live one exactly like L2's
// fixture (l2-handler.test.mjs) — the real poolRegisterPrep call it triggers hits the live console.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../kasia-console/package.json', import.meta.url));
const Database = require('better-sqlite3');
const db = new Database(fileURLToPath(new URL('../../kasia-console/data/console.db', import.meta.url)), { timeout: 5000 });
const FIXTURE_ID = '_l2c-fixture-' + Date.now();
function removeFixture() { try { db.prepare('DELETE FROM pool_markets WHERE id=?').run(FIXTURE_ID); } catch {} }
function createFixture() {
  const tmpl = db.prepare(
    "SELECT * FROM pool_markets WHERE protocol_status='pending_bettors' AND protocol_version='v0.7' AND resolution_rule_spec LIKE '{%' ORDER BY created_at DESC LIMIT 1"
  ).get();
  if (!tmpl) throw new Error('no v0.7 template market to mirror for fixture');
  const row = { ...tmpl };
  row.id = FIXTURE_ID;
  // must NOT share spine_p2sh with the template row — FINDING-2 commingled-spine guard (J1,
  // pool-commingle-detect.mjs) rejects registration if >1 v0.7 market shares a spine_p2sh, exactly
  // the kind of deeper validation L2's own fixture never exercises (it only tests listing, not prep).
  row.spine_p2sh = 'kaspatest:l2cfixturedummyspine' + Date.now();
  row.deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  row.created_at = new Date().toISOString();
  row.updated_at = row.created_at;
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO pool_markets (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(row);
  return row;
}
process.on('exit', removeFixture);
const marketRow = createFixture();

await PM.startBetFromMarket(TG_USER, FIXTURE_ID);
await PM.handleReply(TG_USER, '1', LINKED_ADDR);           // pick side YES
await PM.handleReply(TG_USER, '2.5', LINKED_ADDR);         // stake amount → triggers real poolRegisterPrep (hits live console)
const beforeConfirm = PM.listPendingPayments().find((p) => p.tgUser === TG_USER);
check('setup: reached stage=confirm without a pending entry yet', !beforeConfirm, JSON.stringify(beforeConfirm));

const reply = await PM.handleReply(TG_USER, '1', LINKED_ADDR);  // confirm → custodial auto-pay branch
check('handler returned the auto-pay success message (not a fallback/error path)', typeof reply === 'string' && !/error|fail/i.test(reply), reply);

// ── the regression assertion: with a sufficiently-funded custodial wallet and a successful
//    tgWalletSend, the entry MUST still be in pendingPayments after the reply — this is exactly
//    the invariant commit 51a1ad1c broke and commit 4385d633 restored. ──
const afterConfirm = PM.listPendingPayments().find((p) => p.tgUser === TG_USER);
check('pendingPayments entry SURVIVES auto-pay success (the actual regression)', !!afterConfirm, JSON.stringify(afterConfirm));
if (afterConfirm) {
  check('surviving entry carries the marketId needed for pollPendingBets to complete confirm', afterConfirm.marketId === FIXTURE_ID);
  check('surviving entry carries a betId (needed to re-derive the exact per-bet address)', !!afterConfirm.betId);
}

PM.clearPendingPayment(TG_USER);
removeFixture();
globalThis.fetch = realFetch;

console.log(`\nL2c: ${pass}/${pass + fail} PASS`);
if (fail > 0) process.exit(1);
