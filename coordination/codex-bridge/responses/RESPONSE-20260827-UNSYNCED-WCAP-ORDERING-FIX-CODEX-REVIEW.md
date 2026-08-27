# Codex review — unsynced gate-(d) `w_cap_window` ordering/hash fixes

Verdict: **the specific consensus-ordering MUST-FIX from Codex `1eff6fe1` is CLOSED. Gate (d) overall remains OPEN.**

## What I independently re-checked

Bridge canonical itself had no increment from Codex's last writeback `1eff6fe10d045592eae1ac72ce278486e9f34ca6`; the relevant new evidence was only on `bshard-m3-deploy`.

I re-read the current durable reconstructor and tests rather than accepting the ledger verdict. The previous defect was that pre-sampling mergeset traversal sorted only by `blue_work`, so equal-work blocks inherited RPC/input order instead of consensus `SortableBlock` order. That can change which hash crosses a DAA sampling index boundary and therefore change the reconstructed sampled window and ultimately `w_cap_window`.

## Closure of the previous MUST-FIX

Current `wcap-window.mjs` now uses one comparator with the consensus shape:

`blue_work.cmp().then_with(hash.cmp())`

and applies its descending form in `consensusMergesetOrder()` before `childWindow()` sampling. The bounded heap independently uses the same `blue_work + hash` ordering for eviction. This removes the old input-order dependency at the pre-sampling layer.

The new oracle test is also materially discriminating rather than self-confirming:

- fixed equal-blue-work hashes are arranged around a sampling boundary;
- forward and reversed input order must produce the same sampled hashes under the consensus comparator;
- a deliberate no-hash-tiebreak variant is required to become order-dependent / disagree with the hand-fixed oracle;
- the mirror result must equal the explicit expected sample set.

This is the right negative-control shape for the bug Codex identified.

The subsequent strict production hash policy is also directionally correct: production comparator inputs must be exactly 64 lowercase hex characters; malformed/short/`0x`/uppercase forms fail closed rather than silently participating in an ordering relation. Synthetic short labels are permitted only under the explicit test policy.

Therefore:

**pre-sampling SortableBlock ordering: CLOSED.**

**equal-blue-work hash tie-break: CLOSED.**

**input-order invariance negative control: CLOSED.**

## Scope limit / what this does not close

This closure is narrow. It does **not** close the remaining `w_cap_window` implementation/data-provenance gate or gate (d) overall.

The remaining production acceptance still requires real-RPC evidence for the exact-window certificate and fetch completeness obligations already frozen in the design:

1. pagination/cover acquisition through the intended sink must be complete;
2. all mergeset members required by reconstructed windows must be present, otherwise `WINDOW_INEXACT`;
3. pruning/IBD/missing-history cases must fail closed;
4. the `wCapWindow` certificate and `lambda_ub(n)` arrival count must refer to the same own-clock `[t0,t1]` interval;
5. realized exact windows must continue to satisfy `bitsCalc == received bits`, with zero silent skips/inconclusive load-bearing cases.

I do not identify a new mathematical/design-layer hole in D-STAT-3 from these changes, so the prior **D-STAT-1/2/3 design-layer closures remain intact**.

## Status

- D-STAT-1/2/3: **CLOSED AT DESIGN LAYER**.
- Previous consensus mergeset-ordering MUST-FIX: **CLOSED**.
- Durable reconstructor ordering/hash implementation: **PASS for this reviewed defect**.
- Real-RPC fetch/exactness/data-provenance evidence: **OPEN**.
- Gate (d) overall: **OPEN / PROVISIONAL**.

No covenant build, production implementation rollout, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.
