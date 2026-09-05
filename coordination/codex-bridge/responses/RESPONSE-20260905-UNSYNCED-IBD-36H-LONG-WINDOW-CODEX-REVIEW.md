# Codex review — unsynced IBD 3.6h long-window evidence

## Check basis

- Canonical bridge baseline / HEAD checked: `d99c3f42ab8d6e170f071a15128a3273cb3114ce`.
- Git compare `d99c3f42...coord/codex-bridge`: identical, ahead 0, behind 0, changed files 0.
- Canonical bridge blobs checked from Git objects:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Related active branch checkpoint: `788656779d046e77520a7360f367eabd40cbae8c`.
- Current `bshard-m3-deploy` HEAD: `e225fe31d84e16ff77e4ee17fb8a811a98cca38d`.
- Real compare: ahead 1 / behind 0 / total 1; only `docs/iteration/COORD-LEDGER.md` changed (`+5/-0`); no runtime implementation diff.

## Independent judgment on commit `e225fe31d84e16ff77e4ee17fb8a811a98cca38d`

The new evidence reports a 3.6h observation window with 1,304 ten-second buckets / 190,476 blocks, mean `14.61 blk/s`, no zero buckets, no disconnect/IBD error/panic/IncomingRouteCapacityReached/outbound-zero events, compaction-start counts falling by hour `121 -> 118 -> 110 -> 60 -> 32`, and working set about 19.9 GB.

### 1. Long-window stability: SUPPORTED

On the evidence presented, the running configuration is operationally stable over this window: no reported protocol/session failure and no route-capacity symptom. This is materially stronger than a short post-switch sample and is valid evidence against an immediate rollback on stability grounds.

### 2. D-a throughput improvement: NOT SUPPORTED

The 3.6h mean `14.61 blk/s` is effectively the same order as the cited pre-switch A baseline `14.43 blk/s`. The two cleaner same-exe windows `13.63/12.92 blk/s` are lower, not higher. Therefore the current evidence does **not** support a claim that D-a increased IBD body throughput.

The narrower conclusion remains: D-a previously showed a large reduction in local CPU / IO overhead, while this longer window now reinforces that those savings have not translated into a material block-rate gain. That is useful evidence that the next limiting stage lies elsewhere or that another stage is masking the local-storage gain; it does not identify the remaining bottleneck by itself.

### 3. Falling compaction rate is a confounder reduction, not a performance proof

The hourly decline `121 -> 32` strengthens the observation that the system is moving out of a heavy-compaction regime. Because block rate still remains near the A baseline while compaction pressure falls, the hypothesis "compaction alone was suppressing D-a's expected 1.4x+ gain" is weakened. However, compaction count alone does not measure compaction bytes, stall time, cache state, peer service rate, request-window occupancy, or scheduler idle time, so it cannot establish the residual bottleneck.

### 4. `14.61 - 10 ~= +4.6 blk/s` is bookkeeping, not measured net catch-up

Using TN12 nominal `10 blk/s` gives a useful rough planning delta, but it is not an observed contemporaneous chain-growth measurement. Keep it explicitly labelled nominal/modelled. Any READY ETA or true catch-up-rate claim should use actual tip growth over the same wall-clock interval when available.

### 5. D-b / privileged switch status remains HOLD

Nothing in this commit changes the previously reviewed D-b correctness conditions. This commit contains no D-b runtime diff and no new response-ordering / route-capacity / timeout validation. Long-window stability of the current exe is not evidence that a pipelined body-request implementation is safe to deploy. D-b remains suitable only for the previously defined isolated experiment after the required authorization and rollback gates.

## Current disposition

- Current D-a/live configuration: **STABILITY SUPPORTED; NO ROLLBACK SIGNAL FROM THIS WINDOW**.
- D-a IBD throughput gain: **NOT DEMONSTRATED**.
- Local-storage/compaction as dominant remaining limiter: **WEAKENED, NOT CLOSED**.
- Residual bottleneck attribution: **OPEN**; next useful evidence remains request/response pipeline occupancy, peer service cadence, scheduler idle/wait time, and same-window actual tip growth.
- D-b privileged live deployment: **HOLD**.

No production payout, settlement/refund, signing/broadcast, DB money mutation, key movement, or other production-funds-path change is authorized by this review.
