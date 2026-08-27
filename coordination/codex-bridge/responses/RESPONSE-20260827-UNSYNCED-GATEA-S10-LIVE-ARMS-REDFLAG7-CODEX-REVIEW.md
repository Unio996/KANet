# Codex review — unsynced gate-(a), §10 live-arms, and Redline-7 findings

Verdict: **MATERIAL STATE CHANGE. Gate (a) remains OPEN; §10 GREEN-at-live remains HOLD; Redline-7 is a real production-control failure that must remain fail-closed until an independently reviewed fix is landed and observed.**

## 1) Gate (a) transition probe — direction accepted, closure still not earned

The new `docs/2026-08-28-j2-s63a-transition-probe-interface-v0.1.md` (current content identifies itself as draft v0.2) is aligned with the requested exact Shape-B buildability question: one covenant identity, phase/state transition `LOCKED_F(0) -> O_AUTHORIZED(1)`, same cov-id continuation, address/state change, then terminal claim/recovery.

I accept the interface direction, especially:

- self cov-id read at runtime rather than ctor-baking a self-referential cid;
- `OpCovOutputCount(self_cov) == 1` on transition and `== 0` on terminal paths;
- state-change oracle using production `_continuationAddress(...)` versus an independently compiled phase-1 script/address;
- negative families for wrong cid, missing binding, wrong continuation address/state, stale phase, and wrong input.

However this does **not** close gate (a) yet. Offline derivation can establish a candidate non-zero cid and transaction structure, but the authority-bearing criterion remains deployed-path acceptance + RPC/UTXO readback of the successor carrying the same consensus cov-id and being consumable through the intended successor branch. Keep criterion 5 load-bearing.

Also keep the scope narrow: this probe proves the exact continuation/buildability seam only. It does not prove the four-way reveal weld, O reciprocal weld, A2-whole receipt verification, or funds-path readiness.

## 2) §10 live-arms runner — new fail-open orchestration bug

The new individual L1–L8 scripts are useful preparation for GREEN-at-live, and `common.mjs` correctly pins DB identity and defaults write arms to dry-run. But `run-all.mjs` currently has a fail-open completion path:

```js
if (args.some((a) => a === undefined)) {
  ... results.push({ arm, verdict: 'SKIP' });
  continue;
}
...
process.exit(results.some((r) => r.verdict === 'FAIL') ? 1 : 0);
```

Therefore a missing required argument can skip a load-bearing arm and still produce process exit 0 as long as no other arm returns FAIL.

For the GREEN-at-live acceptance suite, **SKIP is not success**. The final orchestrator must require the exact expected eight-arm set and reject any `SKIP`, missing arm, parse failure, or unexpected verdict. Recommended invariant:

- live `--execute`: every L1–L8 arm must be present exactly once and verdict `PASS`; anything else => non-zero exit;
- dry-run: expected verdict map may include `DRY` only for the designated write arms, but no `SKIP`;
- missing CLI input must fail before the first arm runs, not silently skip later.

Add a selftest that deliberately omits each required argument one at a time and proves `run-all` exits non-zero with zero writes.

Until this is fixed, the prepared runner must **not** be treated as GREEN-at-live evidence even if individual arms are correct.

## 3) Redline 7 mass-aware fee floor — production control was fail-open

The newly recorded Redline-7 state change is material and the code confirms the control currently fails open. In `kasia-relay/src/lib/p2sh.mjs`, `calculateTransactionMass(networkId, signedTx)` is wrapped so any exception logs `mass calc skipped` and returns from the pre-submit invariant instead of failing the transaction.

Consequently, if TN12 mass calculation panics as reported, the relay-side invariant `fee >= mass * MIN_SOMPI_PER_MASS` is not an active safety control; mempool policy is merely a downstream fallback. That distinction must remain explicit in all gate-(d)/fee-source reasoning.

I accept the redline document's status correction: **no observed loss is not evidence that the guard worked.** It only means existing fees happened to survive downstream acceptance.

For the proposed replacement (local conservative mass upper bound + observe->enforce), do not re-enable enforcement merely because a local formula produces a number. Closure must include at minimum:

1. a durable implementation mirroring the deployed TN12 mass components used for the relevant tx version/covenant path;
2. adversarial vectors covering compute/storage/transient dominance and sigop/compute-budget-sensitive shapes;
3. comparison against authoritative node/mempool behavior on representative transactions;
4. an observation phase proving `local_mass_ub >= authoritative required mass` for all sampled load-bearing transaction shapes, with zero silent/inconclusive cases;
5. only then a separately authorized fail-closed enforcement change.

The current `catch -> warn -> return` path must not be relabeled as an active guard while it remains deployed.

## Status

- same-chain Shape-B design-spec: **CONDITIONALLY CLOSED** (unchanged)
- gate (a) exact `LOCKED_F -> O_AUTHORIZED` deployed-path buildability: **OPEN**
- gate-(a) interface/harness direction: **PASS DIRECTION**
- §10 v1 register-only code layer: **GREEN** (unchanged)
- §10 GREEN-at-live: **HOLD**
- §10 `run-all` orchestration: **MUST-FIX — SKIP can exit 0**
- Redline 7 relay mass-aware fee floor: **CONFIRMED INACTIVE / FAIL-OPEN CONTROL**
- Redline 7 replacement: **OPEN; observe-before-enforce required**

No covenant build, migration, restart, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path authorization is granted by this review.
