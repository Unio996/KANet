# Codex review — unsynced gate-(d) `w_cap_window` reconstructor

Verdict: **MATERIAL PROGRESS / IMPLEMENTATION HOLD — one deterministic consensus-ordering bug plus data-provenance gates remain.**

This review is triggered by the directly-related `bshard-m3-deploy` delta after the last processed checkpoint. It does **not** reopen D-STAT-3's design-layer closure; it reviews the newly durable reconstructor/test implementation and the v0.2 fetch acceptance design.

## 1. PASS direction — v0.2 fetch/data-provenance gates

The four fail-closed gates in `docs/2026-08-27-nwt-s63-wcap-fetch-design-v0.2.md` are the right implementation boundary:

- page/cover through the sink must be complete and deterministic;
- per-window `missing==0` is the relevant closure test, with the documented legitimate `past(R)` exclusion;
- pruning/IBD/missing members must return `WINDOW_INEXACT` and no cap;
- `lambda_ub(n)` and `wCapWindow` must be tied to one own-clock `[t0,t1]` observation window.

Those are data-provenance requirements. They still need real-RPC evidence before the self-route can be used as a funds-bearing admission gate.

## 2. MUST-FIX — `childWindow()` does not reproduce consensus SortableBlock ordering on equal blue work

The durable implementation currently orders mergeset members with:

```js
mergesetOthers.slice().sort((x, y) =>
  bw(y) > bw(x) ? 1 : bw(y) < bw(x) ? -1 : 0
)
```

so equal-blue-work blocks compare as `0` and preserve whatever order happened to arrive from the input arrays.

The deployed rusty-kaspa ordering is not blue-work-only. `SortableBlock::cmp` is:

```text
blue_work.cmp(other.blue_work).then_with(|| hash.cmp(other.hash))
```

and `sampled_mergeset_iterator()` consumes `descending_mergeset_without_selected_parent(...)`. Therefore the hash tie-break is consensus-relevant.

This is not an exotic edge. Sibling/anticone blocks can legitimately have equal blue work. If two equal-work members straddle a DAA sampling index boundary, changing their order changes which hash is sampled; that can change the reconstructed heap, `bitsCalc`, `T_lb`, and ultimately `w_cap_window`.

The local heap comparator already implements the blue-work + hash tie-break, but `childWindow()`'s pre-sampling ordering does not. The two ordering layers must match consensus independently.

### Required fix

Use the exact **descending SortableBlock order** for the mergeset iterator, including hash tie-break, with hash comparison matching the consensus hash byte/order semantics — not locale/string accident.

Add a mechanized negative/regression vector with at least two equal-blue-work mergeset members deliberately positioned so their order changes the sampled member. The test must prove:

1. the mirror selects the same member as the consensus-order oracle;
2. reversing the RPC/input list does not change the result;
3. deleting the hash tie-break changes the result and makes the test fail.

Until that is fixed, production `bitsCalc == received bits` checks may fail on real equal-work windows, or worse, synthetic vectors can remain self-consistent while not mirroring consensus.

## 3. Test-suite gap — current synthetic generator does not establish the tie-order invariant

The current durable `wcap-window.test.mjs` exercises chains, red pairs, truncation, squeezed timestamps, bounded enumeration, etc., but I do not see a dedicated equal-blue-work / hash-tie sampling vector. Because the implementation and generator use the same mirror code to assign/reconstruct bits in several cases, this class needs an independent oracle-style vector rather than another self-confirming generated case.

## 4. Current status

- D-STAT-1/2/3 design layer: **remain CLOSED**.
- `w_cap_window` implementation: **OPEN**.
- fetch/reconstruction data provenance: **OPEN**, four real-RPC gates still required.
- exact consensus mergeset ordering: **OPEN / MUST-FIX**.
- gate (d) overall: **OPEN / PROVISIONAL**.

No covenant build, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, production issuance endpoint, or production money-path action is authorized by this review.
