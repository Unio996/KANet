# Codex review — unsynced phase 3 model + fire#1 imminent

## Git evidence basis

- canonical bridge start/head inspected: `bdcd3cb88b062e490e2b62e32f8e0cde5f8c303d`
- previous processed/written bridge baseline: `bdcd3cb88b062e490e2b62e32f8e0cde5f8c303d`
- canonical compare: identical / ahead 0 / behind 0 / files=[]
- active development branch baseline: `41f859fa3476782c944c09fa5f5a66e3472cd4e6`
- active development branch inspected head: `2dfbb9de560c747ab6ad64bdb3a0aab2da1e9f8d`
- active development compare: ahead 3 / behind 0
- relevant new commits:
  - `d078bf1b66cc14db95f5bcbbbbdcb1904f17328f`
  - `bdbb471bac3558120e0a25d9ee11e9084d6fdc35`
  - `2dfbb9de560c747ab6ad64bdb3a0aab2da1e9f8d`

No runtime/watchdog/guard implementation change is established by these commits; the observed diffs are coordination/evidence material.

## 1. Phase 3: accept the observed completion, narrow the model claim

Observed evidence supports that phase 3 completed after about 5.35 h, with 2,934,340 downloaded headers, and that block processing then resumed. The arithmetic of the preregistered estimate is internally consistent:

`5091.8 chain-min * (544..638 headers-or-daa per chain-min) = 2.77M..3.25M`

and 2.934M lies inside that band, close to its midpoint. The registered 5.0–5.8 h duration band also contains the observed 5.35 h.

Therefore:

- `phase-3 size prediction`: PASS for this episode.
- `phase-3 duration prediction`: PASS for this episode.
- `IBD counter and RPC header-count increment are comparable for the checked episode`: supported by the reported same-time difference of 39.
- previous categorical statement that those counters were intrinsically incomparable: correctly retracted.

But do **not** upgrade one successful episode into a generally validated phase-4/READY law yet. The critical assumption — that a future header-only phase terminates after downloading approximately `entry lag * contemporaneous density` — has one clean prospective confirmation here. That is useful evidence, not yet a stable cross-episode invariant.

For the next phase, preregister before outcome:

1. exact entry lag;
2. exact density definition and sampling window;
3. target header-count interval;
4. observed header download-rate interval;
5. predicted completion interval;
6. failure rule if the phase terminates materially before/after the target.

A second independent prospective episode is the minimum useful next check before calling the relation reusable for READY planning.

## 2. Silent-phase field evidence increased, but taxonomy issue remains

The reported `n=157`, 5.35 h sample with no sampler-local code4/code5 materially strengthens the narrow field observation that this particular header-only phase did not exhibit the sampled failure signature.

It does **not** close the earlier instrumentation semantics issue. Current repository `scripts/kaspad-rpc-probe.mjs` semantics previously reviewed assign pre-sync `isSynced !== true` to code7/8, whereas code0 requires the synced/alive branch. Until the actual 2-minute sampler/invocation and any exit-code remapping are committed as resolvable repository evidence, the table labels `code0/code4/code5` must not be presented as watchdog-native exit codes without qualification.

So:

- field availability evidence for this phase: stronger / supported;
- watchdog-native code4/5 absence inferred directly from those labels: NOT YET PROVEN;
- `everSynced` persistent monotonic latch + discriminating VA vectors: still OPEN;
- watchdog enablement: still HOLD.

## 3. fire#1 is now threshold-imminent; ETA must follow absolute headroom, not baseline projection

The new observation `wasm = 3766.1 MB` leaves only about 33.9 MB to the 3800 MB guard threshold.

At the current planning baseline of 42 MB/h, simple arithmetic gives:

`33.9 / 42 = 0.807 h = 48.4 min`.

That makes the team's correction from the former ~07:5xZ estimate directionally correct. More importantly, the process has already shown large bursts, so the 48-minute figure is **not** a safe-until bound. A further burst can move the crossing materially earlier.

Correct interpretation:

- ~42 MB/h remains the best clean baseline estimate from the two non-overlapping non-burst windows;
- current threshold headroom must be calculated from the latest **fresh absolute measurement**;
- crossing ETA is conditional only and should be secondary to the live absolute threshold observation;
- the new +91 MB one-hour movement is another burst observation, not evidence by itself that the clean baseline permanently changed to 91 MB/h.

## 4. Reject the statement that guard safety is "unaffected by timing"

The operational trigger threshold may be independent of an ETA, but the guard's **technical safety is not established merely because it triggers on an absolute threshold**.

The following prior MUST-FIX items remain open and become more important as fire#1 approaches:

1. **freshness bound** for a stale-but-valid wasm sample, fail-closed if too old;
2. **independent KANet process identity assertion** before privileged `/T /F` kill — port 3200 ownership alone is insufficient;
3. **recursive pre-kill descendant snapshot + post-kill verification** that every snapshotted descendant is gone;
4. **replacement identity + exact target revision + health-ready verification**, not merely a new PID/listener;
5. repository-resolvable guard source/test evidence for the privileged threshold/recovery branch.

The observed SYSTEM `noop` smoke tests did not execute this privileged branch. No new runtime implementation diff in the three commits above closes these points.

Therefore current state remains:

- Owner operational authorization: PRESENT.
- scheduled guard deployment/pre-trigger recurrence: previously observed LIVE.
- threshold/recovery branch independent technical GREEN: **NO / HOLD**.
- if the deployed guard fires before the MUST-FIX items are closed, that is an **Owner operational risk acceptance**, not a Codex safety approval.

## 5. Evidence package required from fire#1

If fire#1 occurs, capture mechanically, without treating PID replacement alone as success:

- last fresh pre-trigger wasm sample + sample age;
- exact trigger observation and guard log line;
- old PID and verified old process identity;
- complete pre-kill descendant PID set;
- post-kill result for every snapshotted PID;
- new PID and verified KANet process identity;
- exact loaded target revision/build identity;
- health-ready evidence;
- wasm slope after restart, with sample count and span;
- OS process-memory slope after restart, reported separately from wasm slope;
- whether the former staircase/burst morphology disappears.

Do not merge OS private-page slope and self-reported wasm slope into one metric; they measure different quantities.

## Safety boundary

This review does not authorize privileged restart, guard changes, production funds-path changes, production signing/broadcast, settlement/refund, DB mutation, key movement, or any deployment affecting production funds.
