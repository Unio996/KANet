# Codex review — unsynced IBD 7.6h / console stability evidence

## Check basis

- Canonical bridge baseline / HEAD checked: `22792a3232a94c47cfae3dc1a7cdeb4b1662d7d4`.
- Git compare `22792a3232a94c47cfae3dc1a7cdeb4b1662d7d4...coord/codex-bridge`: `identical`, ahead `0`, behind `0`, total commits `0`, files `[]`.
- Canonical bridge blobs re-read from Git objects:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Related active branch previous checkpoint: `e225fe31d84e16ff77e4ee17fb8a811a98cca38d`.
- Current `bshard-m3-deploy` HEAD: `1bc72477d0d6edd5b2fcba795a660093f7bc6228`.
- Real compare: ahead `1`, behind `0`, total commits `1`; only `docs/iteration/COORD-LEDGER.md` changed (`+6/-0`); no runtime implementation diff.
- M10 v3-A implementation commit re-read: `76773b766650b039803bd1af1c41874f54947c36`; it explicitly activates on the next natural console restart.

## Independent judgment on new evidence

The new 7.6h observation reports 2,746 ten-second buckets / 410,058 blocks, mean `14.93 blk/s`, last 4h `15.23 blk/s`, zero disconnect / IBD error / panic / route-capacity / zero-outbound events, compaction-start counts `78/55/70/34` per hour, kaspad WS about 20.22 GB, and console PID 15196 remaining alive for the full interval.

### 1. D-a long-window stability: strengthened

This extends the prior 3.6h stability evidence to 7.6h with no reported protocol/session failure. Current D-a runtime therefore remains **STABILITY SUPPORTED**, with no rollback trigger visible in this evidence.

### 2. D-a throughput gain remains unproven

`14.93 blk/s` overall and `15.23 blk/s` over the last 4h are somewhat above the cited pre-switch `14.43 blk/s` baseline, but not enough by themselves to establish the earlier predicted `1.4x+` throughput gain. The evidence is compatible with a small improvement, phase drift, peer-service variation, or reduced compaction. A same-phase A/B or stronger contemporaneous control is still needed before attributing throughput gain to D-a.

Disposition: **large local CPU/IO savings remain supported; material IBD throughput improvement remains NOT DEMONSTRATED**.

### 3. Falling compaction remains a useful confounder reduction

Compaction frequency is now materially lower than earlier windows, yet body rate remains in the same broad 13–15 blk/s regime. This further weakens the hypothesis that compaction alone was masking a large D-a throughput win. It still does not identify the remaining bottleneck.

### 4. Console stability is an operational state change, not a causal result

The console staying alive for >7h after several prior restarts is a real status change and operationally positive. However, scanner stop, M10 v2 activation, D-a, workload/phase changes, and other concurrent conditions prevent causal attribution. Do not claim M10 v2, scanner removal, or D-a caused the stability interval without controlled evidence.

### 5. M10 v3-A remains not activated

The v3-A implementation commit explicitly says activation occurs on the next natural console restart. Since PID 15196 did not restart during this 7.6h interval, the conclusion that v3-A has not yet taken effect is repository-consistent. No restart should be forced merely to activate instrumentation unless separately authorized and justified.

### 6. ETA / net catch-up caution remains

Any `observed blk/s - TN12 nominal 10 blk/s` calculation is still modelled bookkeeping, not measured contemporaneous net catch-up. READY ETA claims should use actual tip growth over the same wall-clock window when available.

## Current disposition

- D-a live stability: **SUPPORTED, strengthened to 7.6h**.
- D-a material throughput gain: **NOT DEMONSTRATED**.
- Console >7h survival: **SUPPORTED operational observation; causality OPEN**.
- M10 v3-A activation: **NOT YET ACTIVE** under the current no-restart interval.
- D-b privileged live deployment: **HOLD**; this commit adds no D-b runtime validation.

No production payout, settlement/refund, signing/broadcast, DB money mutation, key movement, or other production-funds-path change is authorized by this review.
