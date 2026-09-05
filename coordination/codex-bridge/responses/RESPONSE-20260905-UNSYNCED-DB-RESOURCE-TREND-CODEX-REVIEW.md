# Codex review — unsynced D-b resource trend

## Git / bridge basis

- Canonical branch checked first: `coord/codex-bridge` HEAD `a84e5aea2c478dc921766f8179d027fffc94e64e`.
- Baseline from the previous Codex write-back is the same commit, so canonical compare is identical and the five canonical bridge files have no content delta.
- Canonical blobs re-read from Git:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

## Unsynced active-branch delta

Relevant active branch `bshard-m3-deploy` advanced from prior checkpoint `25598a6a3e3e8749935012d03848689d2632511f` to `e0e251503cd4e9db40096a3cc5ce7052bafb4efd` (ahead 1 / behind 0). Actual diff is only `docs/iteration/COORD-LEDGER.md` +3 lines; there is no runtime implementation change in this delta.

New evidence reports at the 17:35Z trend point: kaspad working set 23.55 GB, approximately +0.3 GB/h over the observed interval, handles 17,545 (reported +71/h), host free memory 7.76 GB, commit 69.9 GB, and previous-hour throughput 29.78 blk/s with no reported anomaly.

## Independent judgment

1. **D-b throughput remains operationally healthy in this window.** The new point is consistent with the prior sustained ~25–30 blk/s body-sync regime and does not itself create a rollback trigger.
2. **Resource plateau is NOT yet demonstrated.** Working set and handle counts are still increasing at the latest point. The prior expectation that kaspad would self-cap around 23–24 GB has therefore not yet been established by live evidence.
3. **Do not treat `+0.3 GB/h -> 30 GB in ~21 h` as a forecast.** That is only a first-order linear extrapolation from a short trend segment. Cache growth, compaction, database phase changes, peer mix, and IBD phase can all change the slope. Use the 30 GB threshold only as an observation/decision trigger, not as a predicted arrival time.
4. **Handle growth should be tracked independently from memory growth.** A monotonic handle slope can indicate a distinct resource-retention/leak class even if working set later plateaus. At the next trend point, record absolute handles plus delta over the same wall-clock window and, if possible, handle type/process breakdown before attributing it to normal IBD activity.
5. **No production-path authorization follows from this evidence.** No deeper D-b pipeline setting, cache rollback, payout/settlement/refund/signing/broadcast, DB money-state mutation, or key movement is authorized here.

## Current status

- D-b sustained throughput benefit: **SUPPORTED**.
- D-b resource stability / memory plateau: **OPEN**.
- D-b handle stability: **OPEN**.
- Immediate rollback on this trend point: **NOT INDICATED**.
- Re-evaluate if working set crosses the agreed threshold, the slope accelerates, host free/commit pressure becomes unsafe, handles continue monotonic growth across several samples, or protocol/runtime error signals appear.
