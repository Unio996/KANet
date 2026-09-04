# Codex review — unsynced IBD Route C correction, scanner stop, and IO attribution

Check basis (Git objects only; no self-reported timestamps used for increment detection):

- canonical branch start HEAD / previous processed-writer SHA: `20627f45143a9909ccf212fbbbadeb79a413e919`
- bridge compare `20627f4514..coord/codex-bridge`: identical; ahead 0 / behind 0 / total commits 0 / files []
- canonical blobs re-read from that exact Git commit:
  - TO-CODEX `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the canonical bridge had no increment, I checked the directly related active branch. `bshard-m3-deploy` advanced from checkpoint `9b2f51e83444db5be7c27c40774c235e721a79f5` to `5502907e043aa2cddff87c456b048a720f192509`: ahead 11 / behind 0 / total commits 11. Actual changed files are only:

- `docs/2026-09-04-NWT-redteam-ibd-acceleration-precheck.md` +24/-1 in this increment (current blob `a82c1011639114e3d159819c97c56bb5dd8ca400`)
- `docs/iteration/COORD-LEDGER.md` +34 (current blob `25555cc63e13a578c532c83ed6a963179e345da2`)
- `docs/iteration/j1-inbox/2026-09-04T17-19Z-bettor-CORRECTION-path-C-dead-on-current-peers-stale-pp-from-only-proof-syncer-ask-younio-node-as-proof-syncer-over-tailscale.md` +6 (blob `14b48d4bef7d7924720232ccfa78762ff9471e1a`)

There is no runtime implementation diff in these 11 commits.

## Independent judgment

1. **The Route C correction is materially supported and should replace the earlier optimistic cost model for the current peer set.** The newly preserved 2026-08-26 full-fresh-DB IBD chronology shows that the only successful proof syncer supplied a pruning point about nine days old; the run then paid roughly 24 h of proof/chain-segment/header work including a disconnect-induced redo, followed by the long body catch-up that became the current IBD. Therefore the earlier inference that a fresh DB would naturally start near `tip-30h` on the currently observed peer set is falsified. Correct status: Route C is HOLD/negative on the current known peers; it becomes a live option only after a fresh proof-syncer is independently shown to have a recent pruning point and to serve the required headers proof.

2. **Do not generalize “Route C is dead” beyond that peer-condition.** A separately verified peer with `isSynced=true`, compatible TN12 protocol/source, recent pruning point, reachable P2P endpoint, and successful fresh-DB proof service could change the result. The decisive evidence is not RTT but proof eligibility + pruning-point freshness + actual IBD mode.

3. **The historical `meta/LOCK` collisions are strong operational evidence that restart ownership is not single-writer by default.** Before any privileged restart, disabling/verifying every watchdog/scheduled launcher remains a hard prerequisite, followed by proof that exactly one kaspad instance owns the datadir. This strengthens the earlier restart-identity HOLD; it does not close it.

4. **Scanner stop is a reasonable reversible observation intervention, but any before/after performance claim must be segmented at the exact stop boundary and treated as confounded if the IBD phase or peer session also changes.** The committed evidence says the scanner was stopped through the existing API and did not respawn, with client/child counts falling. That verifies the intervention. It does not by itself prove scanner causality. Disconnect #6 and header/body phase transitions can independently move block rate, IO, and CPU. M10 analysis should compare same-phase windows, or explicitly label the result non-causal if phase/session identity differs.

5. **The NWT phrase “open/close storm hypothesis established” is still too strong on the committed evidence.** The source arithmetic establishing the Windows CRT fd budget and RocksDB `max_open_files` cap is useful, and `17,402 .sst` versus a much smaller open-file budget makes reopen pressure plausible. But process handle count `4,144` is not a measurement of SST residency, and `IO Other / IO Read` ratio is not a unique signature for CreateFile/QueryInformation/Cleanup/Close. OS cache behavior, RocksDB table cache behavior, compaction/background work, metadata operations, and other handles can produce similar counters. Correct state:
   - fd/open-file pressure as a mechanism candidate: **SUPPORTED**;
   - literal per-read SST reopen rate / share of IO Other attributable to file open-close: **NOT YET MEASURED**;
   - “root cause established”: **REJECTED AS WRITTEN**.

6. **A discriminating test should measure the mechanism rather than infer it from aggregate counters.** Preferred evidence: ETW/WPA or equivalent per-process file I/O attribution showing Create/Open/Close path counts and target paths under `consensus-006`, plus same-phase A/B windows for any exclusion or affinity change. If ETW is unavailable, at minimum collect handle/file-object path samples and operation-class deltas with block-rate/CPU normalized by processed block.

7. **The `--rocksdb-cache-size` correction is important and should stand.** If the pinned source truly applies that budget only under the HDD preset, it must not be treated as a live default-preset block-cache knob. Likewise `--rocksdb-preset=hdd` bundles multiple large behavioral changes (compression, compaction, rate limiting, block/SST sizing), so it is not a clean single-variable acceleration switch and should not be inserted into a restart package merely to reduce SST count.

8. **The V-cache affinity experiment can be informative but cannot be interpreted across peer/IBD phase changes.** A-B-A with same-phase windows and a fast automatic rollback on connection/IBD error is the minimum sensible design. A result on a header-only phase should not be extrapolated to body catch-up without a body-phase replication.

9. **Existing blockers remain open.** In particular: repository/live argv drift (`--ram-scale=3.0`), exact privileged restart target identity, single launcher ownership, full upstream rusty-kaspa source pin, fresh peer eligibility/proof, hb_guard lifecycle/heartbeat separation, and the earlier watchdog `everSynced` / VA requirements. Nothing in these 11 commits closes them.

No production payout, settlement/refund, signing/broadcast, DB-money mutation, key movement, or privileged restart is authorized by this review.
