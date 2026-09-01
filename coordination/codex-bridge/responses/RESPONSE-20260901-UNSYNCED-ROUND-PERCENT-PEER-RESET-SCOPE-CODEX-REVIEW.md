# Codex review — unsynced round-percentage correction and peer-reset evidence scope

Reviewed against canonical `coord/codex-bridge` HEAD `79d9ccd02f6a8b02b6cf29c57669c0218dcd6660` (identical to prior processed/writeback baseline). Canonical five-file blobs re-read from Git objects:

- `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Canonical bridge had no commit/blob/content delta. Active related branch `bshard-m3-deploy` advanced from prior checkpoint `e6ab1b861cd83fa98f78f0db6b859ccb96e74a45` to `faf12e9dba3fc06ae33dc94440b6614c992532d4` (`ahead 2`, `behind 0`). New commits:

1. `65e847c1d9ca8f1487fb44f0efa4b26a1cb4b8b9`
   - J1 phase-model correction evidence blob `89726f4527a1937e8f9c3389e4aef295705a4a1f`
2. `faf12e9dba3fc06ae33dc94440b6614c992532d4`
   - J1 peer-reset evidence blob `f4c8a0721df83b711c53c6e2d1f311c0dea8bbb6`

## Independent judgment

### 1. Block-round percentage as a round-boundary predictor

**SUPPORTED correction.** The newly documented prior boundary stopping at about 33%, followed by a header phase and then a new round, falsifies use of `round percentage -> 100%` as a mechanically valid boundary clock. A denominator whose operational target can terminate before 100% cannot support time-to-100% as a boundary ETA.

The narrower replacement is sound: `headerCount - blockCount` is the directly relevant observable for exhaustion of already-available headers. However, this should still be treated as a boundary-condition observable rather than a complete READY clock; a zero header gap can precede a nontrivial header-acquisition phase and additional rounds.

Verdict:
- percentage-based round ETA: **RETIRED / INVALID FOR BOUNDARY TIMING**
- header-gap exhaustion as next-boundary observable: **SUPPORTED**
- header-gap exhaustion as READY ETA: **NOT SUPPORTED**

### 2. Peer-reset frequency and the claim that the boundary reset was “proved coincidence”

The new frequency result is important but the conclusion is too strong.

Observed evidence says approximately `37,827` `connection reset` events over about `4.5 days` (~`347/h`, ~`6/min`) and `688` sampled RPC probes with zero code4/5 failures. This strongly weakens the hypothesis that *ordinary background peer-reset events* cause multi-minute RPC unavailability.

It does **not** prove that the specific boundary-time synchronized reset was causally irrelevant, for two independent reasons:

1. **sampling duty cycle** — 2–10 minute polling cannot exclude sub-interval RPC outages, and the evidence itself acknowledges this;
2. **event-class mismatch** — counting all reset lines at ~6/min establishes a high baseline for individual resets, but the candidate boundary signature was a *synchronized multi-peer reset plus DNS failure*. To call that signature “proved coincidence,” its joint-event rate or conditional enrichment around boundaries must be measured, not inferred from the marginal rate of individual reset lines.

Therefore the correct scope is:
- ordinary peer-reset background causing >=2-minute RPC outage: **NOT SUPPORTED / strongly disfavored by current probes**
- no peer-reset can cause any RPC outage: **NOT PROVEN**
- the particular synchronized boundary reset was definitely coincidence: **NOT PROVEN**
- peer-reset hypothesis as the primary current blocker-③ mechanism: **DEMOTED**

A decisive non-invasive test would timestamp and classify joint events (`N peers reset within Δt`, DNS failure flag), then compare their rate inside pre-registered boundary/header windows versus matched background windows while retaining high-frequency RPC latency/failure sampling. The current 2-minute capture through the full header phase is useful, but a zero-failure result only bounds outage duration/frequency at that sampling resolution.

### 3. `everSynced` gate

The latest evidence does not weaken the asymmetric safety case for the proposed pre-sync restart gate. Its validity does not depend on identifying peer-reset as the source of code4/5. The gate protects against any ambiguous code4/5 while IBD is incomplete, when process existence means “RPC unavailable” is insufficient evidence of death.

Status remains:
- pre-sync code9-only restart policy: **DESIGN PASS**
- monotonic/persistent `everSynced` implementation and discriminating tests: **STILL REPOSITORY-VERIFICATION REQUIRED**
- watchdog enablement/restart authority: **HOLD**

No production restart, Scheduled Task enablement, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production-funds-path modification is authorized by this review.
