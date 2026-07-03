// Regression guard: G5-5a transient RPC/consolidate bounded retry classifier (2026-07-04, Bettor task)
//
// bshard-settle-daemon.mjs's settleOneMarket() wraps _settleOneMarketAttempt() in a 3-attempt bounded
// retry, but ONLY for whitelisted transient failure signatures (RPC/network/UTXO-indexing-lag class).
// Business/security failures (ABSTAIN, commingled, needs_rolling, enforce mismatch, climb-fail,
// round-trip-fail) must fail fast — retrying them wastes time and (for enforce mismatch) would be a
// security anti-pattern (silently re-attempting past a driver-enforce halt).
//
// This test locks the classifier regex itself (copied from bshard-settle-daemon.mjs — if the source
// regex changes, update this copy, that coupling is what the test guards).

import assert from 'node:assert/strict';

const TRANSIENT_RE = /UTXO not found|fetch failed|ECONNREFUSED|RPC connect timeout|not synced|no working Kaspa RPC|ETIMEDOUT|network.*(timeout|error)|no land\b|not landed/i;

const TRANSIENT_CASES = [
  'build fail: UTXO not found at kaspatest:abc for tx xyz:0',
  'plan threw (fetch failed)',
  'RPC connect timeout',
  'consolidate shard 0 no land: {"foo":"bar"}',
  'close not landed',
  'submit fail: ECONNREFUSED',
  'no working Kaspa RPC node — retry shortly',
];
const NON_TRANSIENT_CASES = [
  'plan threw (UMA judge ABSTAIN: ABSTAIN (conditionId 0x123))',
  'commingled: logical 键有 3 bet (v06 路) + shard 路·shard-only settle 会 strand·跳过挂 alert',
  'needs_rolling',
  'enforce mismatch (driver-side 硬闸)',
  'committee_pk_hash 自核失败',
  '< 4-of-5 sig (got 3)',
  'no PS',
  'no consolidated PS',
];

for (const c of TRANSIENT_CASES) {
  assert.equal(TRANSIENT_RE.test(c), true, `expected TRANSIENT (retry-eligible): "${c}"`);
}
for (const c of NON_TRANSIENT_CASES) {
  assert.equal(TRANSIENT_RE.test(c), false, `expected NON-TRANSIENT (fail-fast, no retry): "${c}"`);
}

console.log(`✅ g5_transient_retry_regression: ${TRANSIENT_CASES.length} transient + ${NON_TRANSIENT_CASES.length} non-transient cases all classified correctly`);
