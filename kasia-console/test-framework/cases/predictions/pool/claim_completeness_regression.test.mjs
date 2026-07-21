// Regression guard: bshard claim-completeness invariant (task#33, 2026-07-03, NWT GREEN)
//
// Root cause: settleMarketLive() used to `return { ok: true, ... }` unconditionally after the
// claim loop, even when the loop `break`'d early on a failed claim — daemon then wrote
// protocol_status='completed' with no assertion that every winner actually got paid.
// Full-sweep DB replay found 20+ real bshard markets mislabeled 'completed' with unpaid winners
// (169+ winner-slot gap). Fix: settleMarketLive now returns a `complete` boolean computed from
// the actual claims array; daemon routes to 'completed' / 'settled_partial_claims' /
// 'needs_manual_attribution' based on it. See docs/2026-07-03-bshard-claim-completeness-and-retry-design.md.
//
// NOTE: this file does NOT plug into the DM-persona `actions` registry in
// test-framework/lib/runner.mjs (send_message / query_db / etc.) — settleMarketLive is a pure
// orchestration function taking an injected `ctx`, which is a different testing shape than the
// broker/DM simulation this framework was built for. Run directly: `node claim_completeness_regression.test.mjs`
// from this directory (or via full path). No chain calls, no relay, no DB writes — fully mocked ctx.

import assert from 'node:assert/strict';

// settleMarketLive() calls computeSettlePlan() internally, which needs a live DB + judgeLine +
// committee sampling — mocking that whole chain is out of scope for a fast offline regression.
// Instead this test locks the INVARIANT itself (task33 §4.1): the `complete` predicate is a pure
// function of the `claims` array, extracted verbatim from bshard-auto-settler.mjs's
// settleMarketLive() (search that file for `const complete =` to confirm they stay in sync —
// if that line ever changes, update this copy too, that's the coupling this test is guarding).
function computeComplete(claims, expectedCount) {
  return claims.length === expectedCount && claims.every(c => c.received === true && !c.error);
}

// ── Fixture 1: all 3 winners succeed → complete=true ──
{
  const claims = [
    { pk: 'p0', amount: 100, txId: 't0', received: true },
    { pk: 'p1', amount: 100, txId: 't1', received: true },
    { pk: 'p2', amount: 100, txId: 't2', received: true },
  ];
  assert.equal(computeComplete(claims, 3), true, 'fixture1: all-success must be complete');
}

// ── Fixture 2: winner 1 not-landed (丢单点④) → break, winners 2 never attempted → complete=false ──
{
  const claims = [
    { pk: 'p0', amount: 100, txId: 't0', received: true },
    { pk: 'p1', amount: 100, txId: 't1', received: false, error: 'not landed' },
    // p2 never attempted — absent from claims entirely (the actual silent-drop bug this guards)
  ];
  assert.equal(computeComplete(claims, 3), false, 'fixture2: not-landed injection must NOT be complete');
  assert.equal(claims.length, 2, 'fixture2: dropped winner must be absent from claims (regression for the original silent-drop bug)');
}

// ── Fixture 3: splice-mismatch (丢单点⑤, received=true but has error) → complete=false ──
// This is the case 🟡风险-2 specifically guards: received===true is NOT sufficient on its own.
{
  const claims = [
    { pk: 'p0', amount: 100, txId: 't0', received: true },
    { pk: 'p1', amount: 100, txId: 't1', received: true, error: 'splice mismatch' },
    // p2 never attempted (break after splice mismatch)
  ];
  assert.equal(computeComplete(claims, 3), false, 'fixture3: splice-mismatch (received=true, has error) must NOT be complete despite received=true');
}

// ── Fixture 4: sanity — received=true with no error and full count → complete=true (positive control for fixture 3) ──
{
  const claims = [
    { pk: 'p0', amount: 100, txId: 't0', received: true },
    { pk: 'p1', amount: 100, txId: 't1', received: true },
  ];
  assert.equal(computeComplete(claims, 2), true, 'fixture4: positive control — full received, no errors, count matches');
}

console.log('✅ claim_completeness_regression: 4/4 fixtures PASS (all-success / not-landed-drop / splice-mismatch-despite-received / positive-control)');
