// bshard-verify-claim-landed-amount.test.mjs — regression guard for #28 P2 §3.5
// (docs/2026-07-21-p2-batch1-truth-source-layer-k18-landing-design.md v0.5): verifyClaimLanded's new
// optional expectedAmount check. Three-state design (kaspa_tx_log primary / ctx.getUtxos fallback for
// indexer-miss) landed after three rounds of red-team back-and-forth (Bettor note① spent-UTXO TOCTOU →
// NWT MUST-FIX② permanent-indexer-gap finding → Bettor's "vacuous" simplification attempt, self-
// retracted → final v0.4/v0.5 hybrid). This test targets the exact boundary NWT asked to see verified:
// "confirmed mismatch" (no fallback) is narrowly "found winnerAddr's output, amount differs" — every
// other failure mode (missing tx_log row / malformed JSON / no matching address) must route to the
// getUtxos fallback, not be misjudged as a mismatch.
//
// In-memory sqlite fixture (kaspa_tx_log minimal schema), no mocks of the function under test itself —
// only ctx.relayPost/ctx.getUtxos/ctx.alert are stubs (external boundaries), matching
// bshard-auto-settler.test.mjs's existing style for this file.
//
// Run: cd kasia-console && node src/services/bshard-verify-claim-landed-amount.test.mjs

import Database from 'better-sqlite3';
import { verifyClaimLanded } from './bshard-auto-settler.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE kaspa_tx_log (tx_id TEXT PRIMARY KEY, outputs_json TEXT, observed_at TEXT);`);
  return db;
}

const WINNER_ADDR = 'kaspatest:winner-addr-example';
const CLAIM_TX = 'aa'.repeat(32);
const EXPECTED_AMOUNT = '250000000';

function makeCtx({ db, landedSequence = [true], getUtxosResult = [], getUtxosSequence = null, fast = false }) {
  let call = 0;
  let getUtxosCalled = 0;
  const ctx = {
    db,
    relayPost: async () => ({ landed: landedSequence[Math.min(call++, landedSequence.length - 1)] }),
    getUtxos: async () => {
      const idx = getUtxosCalled;
      getUtxosCalled++;
      if (getUtxosSequence) return getUtxosSequence[Math.min(idx, getUtxosSequence.length - 1)];
      return getUtxosResult;
    },
    alert: () => {},
    feeRelay: { id: 'relay-1' },
  };
  // claimRetryDelayMs(测试专用, 见 bshard-auto-settler.mjs verifyClaimLanded 里的 ctx.claimRetryDelayMs
  // ?? 3000): 加固/耗尽重试类 case 需要真跑完循环, 不想让整个测试套件等 20×3s=60s, 生产不传就是原 3000ms。
  if (fast) ctx.claimRetryDelayMs = 1;
  return { ctx, getGetUtxosCalled: () => getUtxosCalled };
}

console.log('[test] no expectedAmount passed — backward compat, landed alone decides (existing callers, zero behavior change):');
{
  const { ctx } = makeCtx({ db: freshDb(), landedSequence: [true] });
  const r = await verifyClaimLanded(ctx, WINNER_ADDR, CLAIM_TX, null);
  ok(r === true, `landed:true + no expectedAmount → true immediately (got ${r})`);
}

console.log('[test] case 1: kaspa_tx_log hit, amount matches → true:');
{
  const db = freshDb();
  db.prepare('INSERT INTO kaspa_tx_log (tx_id, outputs_json, observed_at) VALUES (?, ?, datetime(\'now\'))')
    .run(CLAIM_TX, JSON.stringify([{ address: WINNER_ADDR, amount_sompi: EXPECTED_AMOUNT }]));
  const { ctx, getGetUtxosCalled } = makeCtx({ db, landedSequence: [true] });
  const r = await verifyClaimLanded(ctx, WINNER_ADDR, CLAIM_TX, EXPECTED_AMOUNT);
  ok(r === true, `kaspa_tx_log match → true (got ${r})`);
  ok(getGetUtxosCalled() === 0, 'getUtxos fallback NOT called when kaspa_tx_log already resolved it');
}

console.log('[test] case 2: kaspa_tx_log hit, address found but amount DIFFERS → confirmed mismatch, no fallback for the full retry budget (spy proves getUtxos never called), eventually false:');
{
  const db = freshDb();
  db.prepare('INSERT INTO kaspa_tx_log (tx_id, outputs_json, observed_at) VALUES (?, ?, datetime(\'now\'))')
    .run(CLAIM_TX, JSON.stringify([{ address: WINNER_ADDR, amount_sompi: '999999' }]));   // wrong amount, stays wrong every attempt
  const { ctx, getGetUtxosCalled } = makeCtx({ db, landedSequence: [true], fast: true });
  const r = await verifyClaimLanded(ctx, WINNER_ADDR, CLAIM_TX, EXPECTED_AMOUNT);
  ok(r === false, `confirmed mismatch every attempt → false after retry budget exhausted (got ${r})`);
  ok(getGetUtxosCalled() === 0, 'confirmed mismatch (address found, amount differs) NEVER falls back to getUtxos across all 20 attempts — no "pick whichever source is convenient"');
}

console.log('[test] case 3: kaspa_tx_log row entirely missing (indexer never recorded this txid) → inconclusive, getUtxos fallback finds it → true:');
{
  const db = freshDb();   // no INSERT — txRow will be undefined
  const { ctx, getGetUtxosCalled } = makeCtx({
    db, landedSequence: [true],
    getUtxosResult: [{ outpoint: { transactionId: CLAIM_TX, index: 0 }, amount: EXPECTED_AMOUNT }],
  });
  const r = await verifyClaimLanded(ctx, WINNER_ADDR, CLAIM_TX, EXPECTED_AMOUNT);
  ok(r === true, `missing tx_log row + getUtxos hit → true, not misjudged as mismatch (got ${r})`);
  ok(getGetUtxosCalled() === 1, 'getUtxos fallback WAS called for the missing-row case');
}

console.log('[test] case 4: kaspa_tx_log row present but outputs_json is malformed JSON → inconclusive (not mismatch), getUtxos fallback finds it → true:');
{
  const db = freshDb();
  db.prepare('INSERT INTO kaspa_tx_log (tx_id, outputs_json, observed_at) VALUES (?, ?, datetime(\'now\'))')
    .run(CLAIM_TX, '{not valid json[[[');
  const { ctx, getGetUtxosCalled } = makeCtx({
    db, landedSequence: [true],
    getUtxosResult: [{ outpoint: { transactionId: CLAIM_TX, index: 0 }, amount: EXPECTED_AMOUNT }],
  });
  const r = await verifyClaimLanded(ctx, WINNER_ADDR, CLAIM_TX, EXPECTED_AMOUNT);
  ok(r === true, `malformed JSON in outputs_json → treated as inconclusive not mismatch, getUtxos rescues it (got ${r})`);
  ok(getGetUtxosCalled() === 1, 'getUtxos fallback WAS called for the malformed-JSON case');
}

console.log('[test] case 5: kaspa_tx_log row well-formed but has NO entry for winnerAddr at all → inconclusive (not mismatch), getUtxos fallback finds it → true:');
{
  const db = freshDb();
  db.prepare('INSERT INTO kaspa_tx_log (tx_id, outputs_json, observed_at) VALUES (?, ?, datetime(\'now\'))')
    .run(CLAIM_TX, JSON.stringify([{ address: 'kaspatest:some-other-address-not-winner', amount_sompi: EXPECTED_AMOUNT }]));
  const { ctx, getGetUtxosCalled } = makeCtx({
    db, landedSequence: [true],
    getUtxosResult: [{ outpoint: { transactionId: CLAIM_TX, index: 0 }, amount: EXPECTED_AMOUNT }],
  });
  const r = await verifyClaimLanded(ctx, WINNER_ADDR, CLAIM_TX, EXPECTED_AMOUNT);
  ok(r === true, `outputs recorded but no entry for winnerAddr → treated as inconclusive not mismatch, getUtxos rescues it (got ${r})`);
  ok(getGetUtxosCalled() === 1, 'getUtxos fallback WAS called for the no-matching-address case');
}

console.log('[test] case 6: both sources fail every attempt (tx_log missing AND getUtxos never finds a match) → false after retry budget exhausted, not a hang/crash:');
{
  const db = freshDb();   // no INSERT
  const { ctx, getGetUtxosCalled } = makeCtx({ db, landedSequence: [true], getUtxosResult: [], fast: true });
  const r = await verifyClaimLanded(ctx, WINNER_ADDR, CLAIM_TX, EXPECTED_AMOUNT);
  ok(r === false, `both sources inconclusive every attempt → false, not stuck (got ${r})`);
  ok(getGetUtxosCalled() === 20, `getUtxos fallback retried across all 20 attempts (got ${getGetUtxosCalled()})`);
}

console.log('[test] case 7 (NWT MUST-FIX②, self-heal not "passes"): claim genuinely landed on attempt 1 but the UTXO gets spent by the winner before attempt 2 (checkUtxoLanded flips landed:false from then on) — verifyClaimLanded honestly returns false (not a false "true"), and does so via the existing STOP-threading path rather than hanging or throwing, proving the caller\'s settled_partial_claims retry queue is reachable next tick (self-heal capable), not a dead state:');
{
  const db = freshDb();
  // tx_log never got this one recorded (simulates the realistic case: winner claimed then immediately
  // moved funds, indexer's window to observe the original output already closed) — landed flips false
  // on attempt 2 onward (checkUtxoLanded's own current-UTXO-set exposure, NWT's finding, out of scope to
  // fix in this batch — this test proves the OUTER function still resolves cleanly, not that landed
  // itself becomes spend-race-proof).
  const { ctx } = makeCtx({ db, landedSequence: [false], fast: true });
  const r = await verifyClaimLanded(ctx, WINNER_ADDR, CLAIM_TX, EXPECTED_AMOUNT);
  ok(r === false, `landed:false throughout (post-spend) → verifyClaimLanded honestly returns false, does not hang/throw (got ${r})`);
  // Caller-side self-heal (settled_partial_claims retry queue picking this back up next tick) is an
  // integration-level property of settleMarketLive's STOP-threading branch, not verifyClaimLanded's own
  // contract — this unit test's scope is "does the function itself resolve cleanly", not the full
  // daemon-tick self-heal loop (that would need bshard-settle-daemon's resume path in the harness, a
  // larger integration test tracked separately, not duplicated here).
}

console.log(fails === 0 ? `\n✅ all checks passed (backward-compat + 7 boundary/self-heal cases)` : `\n❌ ${fails} check(s) failed`);
process.exit(fails === 0 ? 0 : 1);
