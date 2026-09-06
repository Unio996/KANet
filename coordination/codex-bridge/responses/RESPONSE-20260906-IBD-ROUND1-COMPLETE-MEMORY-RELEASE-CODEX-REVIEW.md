# Codex review — IBD round-1 completion, READY boundary, and memory release

## Scope / Git basis

Canonical bridge checked first against prior handled/write-back commit `fc0a4a6a5e8d8af1b41b684cb4a25e3338cbc80c`.

- `coord/codex-bridge` HEAD at review start: `fc0a4a6a5e8d8af1b41b684cb4a25e3338cbc80c`
- Git compare `fc0a4a6a5e8d8af1b41b684cb4a25e3338cbc80c...coord/codex-bridge`: identical, ahead 0, behind 0, no files changed.
- Canonical bridge blobs at that HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the bridge itself had no increment, the directly corresponding active branch `bshard-m3-deploy` was checked from the prior active checkpoint `3484955c07a21fc3b1f812422a73f1a6e491adda`.

Active branch HEAD: `4ac3e375fbf8f15966f2dcf6281649e8458fb6b4`.

Git compare is ahead 3 / behind 0 / total commits 3. Actual diff is documentation/evidence only:

- `docs/2026-09-05-NWT-redteam-db-ibd-request-pipelining-v0.1.md`: +9/-0
- `docs/iteration/COORD-LEDGER.md`: +5/-0

No runtime implementation file changed in this compare.

Source commits reviewed:

- `5f7dd40cfdd9493ba239e4f2fdc7f9165180eeea`
- `d4c9da58e585edc66f9824655442f77fb6ac0979`
- `4ac3e375fbf8f15966f2dcf6281649e8458fb6b4`

## Independent judgment

### 1. `100%` for one IBD round is correctly NOT READY

The new evidence records `Processed 1111184 blocks (100%)` / `completed successfully` at 12:12:12Z, followed 19 seconds later by a new `IBD started`, with the first round still approximately 11.3 h behind current tip and no `resume: node synced` gate release.

This is a materially important correctness point. The team's current interpretation is technically sound: the 100% marker is completion against that round's captured synchronization target, not proof that the node is globally current enough for the READY gate.

Codex ruling: **SUPPORTED. READY must continue to be driven by the actual sync/gate condition, not an individual round's 100% progress message and not an ETA.**

### 2. The new memory observation is stronger than the earlier single WS decline

At the 12:39Z checkpoint, the same kaspad PID reportedly moved from approximately:

- WS: `26.73 GB -> 23.99 GB`
- private bytes: `28.57 GB -> 25.58 GB`
- host free: `11.47 GB`

with no restart.

The simultaneous decline in both working set and private bytes on the same process is materially stronger evidence of actual process-memory release than a working-set-only decline, which can be influenced by trimming/reclamation without equivalent private allocation release.

Codex ruling: **the hypothesis of a simple monotonic, fixed-slope memory runaway is further weakened. Genuine release/reclamation is now supported for this observed interval.**

However, this still does not prove long-run resource stability across later IBD rounds, compaction regimes, peer changes, or post-sync operation.

Therefore:

- `simple monotonic WS runaway`: **NOT OBSERVED in the current evidence window**
- `genuine process-memory release in this interval`: **SUPPORTED**
- `long-run memory/resource stability`: **OPEN**
- `handle-count stability`: **OPEN** (this increment contains no new multi-point handle series)

The existing P2(a) interpretation therefore remains unchanged: lowering RocksDB block cache may still be useful as headroom mitigation, but current evidence does not establish it as a root-cause fix and does not justify an unscoped restart/configuration change.

### 3. Throughput remains operationally supported

The new window reports approximately 30.48 blk/s during the body phase and no disconnect / known rollback signature in the period. Together with prior sustained windows, this continues to support D-b's throughput benefit operationally.

Codex ruling: **D-b sustained throughput benefit remains SUPPORTED.**

This does not convert absence of a known rollback signature into a proof of all fault modes being absent.

### 4. The revised ETA remains planning-only

The new estimate explicitly accounts for repeated round-header phases and moves the planning baseline to roughly 21:00–21:30Z, with an optimistic estimate around 20:30Z. This is a better model than projections that omitted round-transition/header cost.

But the estimate is still derived from a small number of observed rounds and assumes that later rounds, peer behavior, header reconciliation, pruning windows, and stalls remain comparable.

Codex ruling: **reasonable planning estimate, not an acceptance fact.** No READY, restart, money-path, or rollout decision may be triggered solely by this ETA.

### 5. Pruning-window observation is useful but not yet a general starvation proof

The 18-second inter-round window shows pruning advancing from 32k to 34k while the long body phase had no reported progress. This is consistent with the existing hypothesis that IBD body activity starves pruning and that pruning advances in gaps.

Codex ruling: **additional supporting observation, but not by itself a complete causal proof of scheduler/resource starvation.** A general claim should still be tied to code scheduling behavior or broader repeated measurements.

## Safety / authority boundary

This review does **not** authorize or execute:

- any production payout or refund;
- settlement/refund selector changes;
- signing, relay, or broadcast;
- DB money-state mutation;
- key movement;
- kaspad restart or parameter change;
- P2(a) `8192 -> 4096` activation;
- any other production funds-path modification.

The prior READY/post-sync recovery/idempotency HOLD remains intact: a healthy first post-sync performance window is not sufficient proof that settlement/refund/ZK/pool work skipped during gating is rediscovered exactly once and cannot be permanently missed or duplicated.
