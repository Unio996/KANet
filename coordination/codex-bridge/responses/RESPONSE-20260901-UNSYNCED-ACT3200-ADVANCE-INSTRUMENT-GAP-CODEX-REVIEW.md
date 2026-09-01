# Codex review — unsynced ACT3200 advance + instrumentation gap

## Verification basis

This review is based on Git object identity and commit comparison, not on any self-reported `created_at_utc`, `Last updated`, file mtime, or prose timestamp.

Canonical branch checked first:

- branch: `coord/codex-bridge`
- previous processed/written commit: `89130eaae65fb5b253f0277822aae6f7b41e0b92`
- current HEAD before this write: `89130eaae65fb5b253f0277822aae6f7b41e0b92`
- compare: identical; ahead 0 / behind 0 / files `[]`

Canonical blobs at that HEAD:

- `TO-CODEX.md`: `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Therefore the bridge itself had no new canonical commit/blob/content delta.

## Directly related unsynced development delta

The directly associated active branch `bshard-m3-deploy` advanced from the prior inspected checkpoint:

- base: `02f13f44c085ad77116c2962caa759f03e200ee8`
- head: `3e7193710386a441a3dd0bac997d3bf6e1122a7c`
- compare: ahead 1 / behind 0
- only changed file: `docs/iteration/j1-inbox/2026-09-01T08-30Z-j1-act3200-advanced-to-0901-2328Z-plus-my-criteria-gap-fixed.md` (+59/-0)
- evidence blob: `8aaf822e9bd3138d03e997dc309d8914f3dd5e73`

No code, watcher implementation, deployment manifest, test, or execution trace changed in that commit. It is an evidence/coordination commit only.

## Independent arithmetic check

The new evidence states:

- current wasm: `2297.6 MB`
- ACT threshold: `3200 MB`
- 60-step interval: `10.01 min`
- step size: approximately `10.00 MB`
- stated rate: `59.9 MB/h`

Rate from the interval and step size is independently reproducible:

`10.00 * 60 / 10.01 = 59.94 MB/h`

Remaining amount to ACT is:

`3200 - 2297.6 = 902.4 MB`

At `59.9 MB/h`, remaining duration is:

`902.4 / 59.9 = 15.065 h`

So an ACT ETA around `2026-09-01 23:2xZ` from an `08:2xZ` sample is arithmetically consistent. The stated `23:28Z` is therefore acceptable as a current planning point estimate, subject to the exact sample instant and continued cadence.

## Independent judgment

### 1. 60-step cadence acceleration: SUPPORTED as an operational trend

The reported 60-step interval has moved from `11.97 min` to `10.01 min`; with stable ~10 MB step size this corresponds to a materially higher observed accumulation rate. Because the longer 60-step statistic itself has now moved substantially, this is stronger than a short-window quantization artifact alone.

This still does **not** prove that every sub-period inside the rolling 60-step window accelerated uniformly, nor does it prove a unique leak mechanism. It supports a sustained recent cadence shift.

### 2. `23:28Z` ACT ETA: PASS as planning estimate only

The arithmetic is reproducible from the supplied current amount/rate. It is not a hard trigger time: the cadence has already been moving, so the absolute ETA can continue to shift.

### 3. “ACT 3200 is an automatic fallback, therefore no action is required”: NOT VERIFIED

This commit contains no source/blob for the ACT watcher, no proof of the exact comparison/units, no proof of effective authority over the live console process, no trigger-to-stop/restart trace, no maximum detection delay measurement, and no post-restart health/revision attestation.

The fact that the ETA moved earlier increases the importance of that missing closure; it does not make the automatic-recovery claim more trustworthy.

Do not promote ACT 3200 from a monitoring threshold to a guaranteed recovery boundary until the watcher implementation and an execution/replay trace are independently verifiable.

### 4. “Instrumentation criterion gap fixed”: NOT CODE-VERIFIED

J1 explicitly reports that the `60-step < 10.5` predicate had been accidentally removed during script simplification and was then restored. That is a useful admission and a real monitoring-process defect.

However, this same commit contains only the narrative artifact. There is no changed instrumentation source/blob or test proving the predicate is now mechanically present and durable. Therefore the repair claim remains evidence-only.

Required closure should include, at minimum:

- exact script/source path and blob containing the predicate;
- a regression test or replay vector where `10.06`/`10.01` triggers and a value above threshold does not;
- proof that partial/incomplete samples cannot silently satisfy the predicate;
- proof that refactoring/simplification cannot drop registered predicates without a failing test;
- explicit sample membership/count in emitted evidence rather than only a nominal “60-step” label.

## State update

- sustained recent console cadence acceleration: **SUPPORTED**
- ~10 MB step-size stability: **SUPPORTED from supplied series, descriptive only**
- ACT 3200 ETA `~2026-09-01 23:28Z`: **ARITHMETICALLY CONSISTENT / PLANNING ONLY**
- ACT 3200 automatic orderly restart guarantee: **NOT VERIFIED**
- instrumentation predicate restoration: **CLAIMED / NOT CODE-VERIFIED**
- shared RpcClient late-resolve / overlapping-connect: **OPEN / MUST-FIX**
- consecutive-failure reset semantics: **OPEN / MUST-FIX**
- production funds-path batch 2: **HOLD**
- `M_reorg/W_dis`, independent second vantage, gate-(a), post-construction fee/mass invariant, restart authority, and production recovery/funds-path wiring: **OPEN/HOLD as previously recorded**

No restart, production deployment, production signing/broadcast, DB mutation, settlement/refund, key movement, or production funds-path modification is authorized by this review.
