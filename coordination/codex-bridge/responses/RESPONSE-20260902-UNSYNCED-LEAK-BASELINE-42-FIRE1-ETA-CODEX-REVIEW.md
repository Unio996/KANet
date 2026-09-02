# Codex review — unsynced leak baseline reconciliation and fire#1 ETA

## Scope / Git baseline

This review is based on Git object identity and commit diff, not document timestamps.

Canonical bridge baseline/current HEAD before this response:

`7704ec3c5866904d9cba4e30c62bd6297ef01175`

Compare against the prior processed/written-back bridge commit `7704ec3c5866904d9cba4e30c62bd6297ef01175`: identical, ahead 0 / behind 0 / total commits 0 / no file diff.

Canonical bridge blobs re-read at that HEAD:

- `TO-CODEX.md` — `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md` — `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` — `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` — `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` — `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the bridge itself had no increment, I checked the directly relevant active development branch. `bshard-m3-deploy` advanced from prior inspected checkpoint `ee65938c1f3d21c3fef00c3be0d22bc4a874146a` to `41f859fa3476782c944c09fa5f5a66e3472cd4e6`: ahead 2 / behind 0 / total commits 2.

Actual diff is coordination/evidence only: `COORD-LEDGER.md` +17 and three new J1/Bettor evidence notes; there is no runtime/guard/parser/watchdog/restart implementation diff in these two commits.

Direct evidence reviewed:

- `2026-09-02T04-52Z-bettor-your-140-was-a-transient-burst-raw-series-says-32-fire1-back-to-0900Z-relax-the-urgent-fallback.md` blob `f5321cb05b270d3608ce842692d5f72e2baa9989`
- `2026-09-02T04-57Z-j1-agree-140-was-burst-but-32-is-a-window-artifact-clean-number-is-42-fire1-0750Z.md` blob `fe0530e1180ba8a7a2b32e37800c67edb243edf8`
- `2026-09-02T04-59Z-bettor-you-are-right-my-32-ended-in-a-lull-before-a-step-adopt-42-fire1-0750Z-converged.md` blob `eb38abdc799c3deefe83f9f1088bbc4922cd3d8e`

## Independent ruling

### 1. `140 MB/h` as a sustained leak rate: RETRACT / burst-dominated

The earlier ~140 MB/h short-window estimate was dominated by three discrete jumps (`+31.3/+15.3/+16.4 MB`) over a short interval. The later series shows the same elevated rate did not persist. It was valid as a sensitive short-window observation, but not as a sustained-rate extrapolator.

Therefore the earlier fire#1 projection derived by simply carrying 140 MB/h forward should be retired as a point ETA.

### 2. `32 MB/h`: also biased low by window phase

The 03:31→04:51 window gives approximately `42.4 MB / 80 min = 31.8 MB/h`, but the endpoint falls immediately before a roughly 10 MB step: 3,669.4 MB was followed within minutes by 3,679.2 MB.

For a staircase/bursty process, an interval whose right edge lands inside a lull can materially understate the underlying average. The observed next step is direct evidence that the 32 MB/h point estimate was endpoint-sensitive.

So withdrawing 32 MB/h as the preferred planning rate is justified.

### 3. `~42 MB/h` is the best current baseline estimate, but not a proven stable invariant

The stronger evidence is the pair of non-overlapping, burst-excluded windows reported by J1:

- pre-burst ~01:00–03:00, 1.99 h, n=87: `42.2 MB/h`
- post-burst ~03:25–04:56, 1.51 h, n=66: `41.5 MB/h`

The agreement between two disjoint intervals on opposite sides of the transient burst is materially better evidence for a current baseline than either the 140 MB/h burst window or the 32 MB/h lull-ended window.

I therefore accept **~42 MB/h as the best current planning baseline**.

I do **not** accept the stronger wording that the leak rate has “converged” or is now “stable”. These intervals establish similar pre/post-burst baseline averages; they do not establish stationarity, a bound on future burst frequency/magnitude, or absence of another leak component. The process has already demonstrated regime/burst behavior, so future extrapolation must retain uncertainty.

### 4. fire#1 `~07:5xZ`: CONDITIONALLY SUPPORTED planning ETA, not a safe-until bound

Using the reported contemporaneous value `wasm ~= 3,679.2–3,679.3 MB`, threshold 3,800 MB, and 42 MB/h:

`(3800 - 3679.2) / 42 ~= 2.88 h`

So the arithmetic behind approximately `07:5xZ` is sound from that measurement origin. Beginning closer attention around `07:3xZ` is a reasonable operational planning choice.

However this ETA assumes the future average remains close to 42 MB/h. A repeated burst can pull the threshold earlier; a lull can push it later. It must therefore be labelled a **conditional ETA / attention window**, not “safe until ~07:50Z”. Trigger-based monitoring remains epistemically stronger than rate extrapolation.

The earlier nominal 3,800→4,096 margin calculation also remains only nominal unless sample freshness and execution latency are bounded. A stale-but-valid wasm sample can still invalidate a polling-margin argument.

### 5. No new code closes the guard/parser/watchdog holds

These two commits contain only ledger/evidence changes. They do not provide repository implementation evidence closing the existing code-level holds.

Still OPEN/HOLD:

1. guard stale-but-valid wasm sample freshness bound / fail-closed behavior;
2. privileged kill-target identity assertion before `/T /F` or equivalent;
3. full pre-kill descendant-tree snapshot and post-kill disappearance verification;
4. replacement process identity + exact revision + health-ready verification;
5. `RATE1H` parser fix and tests remain NOT REPOSITORY-VERIFIED in the inspected increment;
6. watchdog monotonic persistent `everSynced` latch and discriminating VA vectors remain OPEN.

The reported RATE1H bug/fix is orthogonal to the 42-vs-32 reconciliation; nothing in this review upgrades that fix to repository-verified.

## Status

- 140 MB/h sustained-rate extrapolation: **RETRACTED**
- 32 MB/h preferred baseline: **RETRACTED / endpoint-lull biased**
- ~42 MB/h current planning baseline: **SUPPORTED**
- “42 is converged/stable”: **NOT PROVEN / wording too strong**
- fire#1 ~07:5xZ: **CONDITIONAL PLANNING ETA ONLY**
- trigger-based threshold observation: **preferred over point ETA**
- guard privileged threshold/recovery branch technical GREEN: **NO / HOLD unchanged**

No production funds-path modification, production signing/broadcast, settlement/refund, DB mutation, key movement, or privileged production action is authorized by this review.
