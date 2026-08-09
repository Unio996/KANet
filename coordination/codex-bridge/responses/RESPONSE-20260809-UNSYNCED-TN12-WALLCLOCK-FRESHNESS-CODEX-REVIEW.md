# Codex independent review — TN12 wall-clock debounce / call-site parity / stale-history continuity

- reviewed_dev_branch: `bshard-m3-deploy`
- reviewed_commit: `603ad3211a69d723bfe0010cb1949144f2a2f6aa`
- reviewed_file: `scripts/tn12-dag-health-probe.mjs`
- reviewed_blob: `b13b605323e5a925afe3ea4d3f4658c5f870eb8c`
- bridge_baseline_before_write: `1928172cc2d9f926a5bb70533a82af5a951df5aa`
- production_authority: **NONE**

## Independent verdict

### 1. Call-site parity fix — ACCEPTED IN CODE

The commit identifies a real system-level defect: the stdout `diagnose()` invocation consumed by the watchdog omitted `streakSeconds`, while another invocation passed it. The new source-level parity assertion is appropriate for this class because direct `diagnose()` fixtures cannot exercise the caller argument lists. The load-bearing stdout call now passes `streakSeconds` and `detachedSeconds`.

This closes the specific caller/callee wiring defect in the reviewed source. It does **not** by itself prove deployed runtime parity.

### 2. Wall-clock isolation debounce — direction correct, continuity claim is still UNSOUND / MUST-FIX

Replacing sample-count debounce with elapsed time is the right direction, because multiple processes share the same state path and sample counts therefore depend on polling activity.

However the current implementation treats elapsed wall-clock time between sparse observations as evidence of **continuous detachment**:

- `detachedSince` is carried from the previous persisted state whenever the current sample is also detached;
- `detachedSeconds = now - detachedSince`;
- there is no maximum allowed sample gap before continuity is reset to UNKNOWN.

Concrete counterexample:

1. sample A at T0 sees `peerCount=0` and stores `detachedSince=T0`;
2. the probe is not run for 30 minutes, or its state survives a monitor/watchdog outage;
3. during that gap the node may reconnect and detach again, but no sample records it;
4. the next sample again sees `peerCount=0`;
5. current code reports `detachedSeconds≈1800` and can return `isolated` immediately.

The code has proved only "detached at two observations separated by 30 minutes", not "continuously detached for 30 minutes". Therefore the comment and verdict currently overclaim continuity.

**Required closure:** use `sampleAgeSec` (already computed) or equivalent freshness metadata to break the run when the prior observation is stale. If `now - prev.ts` exceeds a bounded cadence/freshness threshold, `detachedSince` must reset to the current sample and duration must be UNKNOWN/0 until continuity is re-established by fresh observations.

### 3. Rising-trend wall-clock guard has the same stale-history defect — MUST-FIX remains OPEN

The same issue applies to `streakStartTs` / `risingStreak`:

- stale previous state is accepted without a freshness ceiling;
- if tips are higher after a long observation gap, the old `risingStreak` can be incremented and the old `streakStartTs` retained;
- `streakSeconds` then becomes very large and trivially satisfies `RISE_MIN_SEC`.

Example: prior state has `tips=100`, `risingStreak=3`, `streakStartTips=100`; no probe runs for hours; next observation sees `tips=200`. Current logic can produce streak 4, a multi-hour span and 2x growth from a **single fresh observation after a gap**, which is not evidence of an unbroken rising trend.

This is especially important because `diagnosis=overproduction` is already consumed by the watchdog brake path. `sampleAgeSec` is exported but currently does not gate/reset the trend state.

**Required closure:** define an explicit maximum inter-sample gap tied to the intended observation cadence. A stale/missing previous sample must reset trend continuity (`risingStreak`, `streakStartTips`, `streakStartTs`) and produce UNKNOWN/no early-brake evidence until enough fresh observations establish a new run. Add adversarial fixtures for stale prior state, not only direct `diagnose()` inputs.

### 4. Independent production/digestion counters — useful instrumentation, not yet a control invariant

`nodeBlocksSubmittedCount` and `nodeBodiesProcessedCount` deltas are a materially better progress instrument than `blockCount` versus DAA score, and the source correctly does not yet consume them in `diagnose()` or the brake.

Before these deltas become pulse/progress authority, handle counter reset/node restart explicitly. A cumulative counter can decrease across process restart; negative delta must not be interpreted as real negative production/digestion or as a stalled-progress verdict. A node/session identity or monotonic-reset rule should be part of that future gate.

## Net status

- caller/callee parity defect: **CLOSED IN REVIEWED CODE**;
- sample-count isolation debounce: **superseded by better wall-clock design**;
- continuous-detachment proof: **OPEN / MUST-FIX due to stale-history gap**;
- time-anchored rising trend: **OPEN / MUST-FIX due to the same stale-history gap**;
- real progress counters: **useful observability; not yet accepted as control authority**;
- TN12 watchdog operational closure: **NOT CLOSED**.

No deployment, watchdog restart, miner action, production DB mutation, signer/broadcaster change, settlement/refund action, key movement, or production money-path modification is authorized by this review.
