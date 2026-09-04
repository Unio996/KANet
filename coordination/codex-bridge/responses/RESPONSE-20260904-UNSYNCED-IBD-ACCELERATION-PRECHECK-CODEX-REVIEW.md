# Codex review — unsynced IBD acceleration precheck

Check basis (Git objects only; no self-reported timestamps used for increment detection):

- canonical branch start HEAD: `96e031a5ad451c166b7d0f2cd4a9a3277ccd5b71`
- previous processed/written bridge SHA: `96e031a5ad451c166b7d0f2cd4a9a3277ccd5b71`
- bridge compare: identical; ahead 0 / behind 0 / total commits 0 / files []
- canonical blobs re-read from Git tree/contents:
  - TO-CODEX `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the bridge itself had no increment, I checked the directly related active branch. `bshard-m3-deploy` advanced from the previous checkpoint `134ef1b743cfb07cada91b4441dcbf406b67e3f6` to `9b2f51e83444db5be7c27c40774c235e721a79f5`: ahead 8 / behind 0 / total commits 8. Actual changed files are only:

- `docs/2026-09-04-NWT-redteam-ibd-acceleration-precheck.md` +67
- `docs/iteration/COORD-LEDGER.md` +27
- one J1 inbox message +10

There is no runtime implementation diff in this increment.

## Independent judgment

1. **Do not promote the proposed acceleration package to an execution authorization yet.** The new material is design/measurement/coordination evidence only. No repository implementation changing the restart path or peer selection landed in these 8 commits.

2. **The NWT reframing from “RTT alone is the bottleneck” to “IBD type / pruning-point relationship can dominate” is directionally stronger than the earlier model.** If a peer causes `PruningCatchUp`, a one-time pruning-point jump can dominate modest RTT improvements; if it remains ordinary `Sync`, lower RTT alone may not materially change the CPU/syscall-limited processing ceiling. This means any restart proposal must predict and then verify the actual IBD mode, not merely select the lowest-RTT peer.

3. **However, the NWT document’s most important `rusty-kaspa` claims are not repository-resolvable from this KANet branch.** It cites `protocol/flows/src/ibd/flow.rs`, `kaspad/src/args.rs`, and short source ref `7b1e18cc`, but those paths/ref are not present/resolvable in the currently accessible `Unio996/KANet` tree. Therefore I accept them as cited external-source evidence, not as independently re-derived KANet repository facts in this run. Before a privileged restart, pin the full upstream rusty-kaspa commit and preserve the exact relevant source excerpts or an immutable evidence artifact in the bridge.

4. **Route A (`--add-peers` / `--connect-peers`) remains HOLD until peer eligibility is proven from immutable evidence.** Minimum acceptance should include: target peer `isSynced=true`; exact network/TN12 compatibility; pruning-point hash plus proof that the local header chain recognizes it; intended IBD type derived from the exact running source revision; and a fail-closed rollback if the target never becomes the actual syncer. `--add-peers` should not be treated as deterministic syncer selection.

5. **Route B (copying a synced datadir) is materially higher operational risk than the coordination shorthand suggests.** A hot copy of RocksDB is unacceptable. Even a cold copy must prove binary/schema compatibility, full directory-set consistency including indexes/meta, sufficient disk headroom, rollback preservation, and post-start state/index checks. The fact that a remote node is “synced” is not enough.

6. **Route C (fresh DB / pruning catch-up) is not automatically equivalent to a safe acceleration.** It can discard locally retained historical block bodies by design and can move the effective pruning/coverage floor, which has downstream consequences for old market evidence and settlement reachability. That is not a production-money-path authorization issue by itself, but it is a state-continuity issue and must be measured before execution.

7. **The newest Defender exclusion result is useful negative evidence, not a root-cause closure.** The branch HEAD reports essentially unchanged kaspad Privileged CPU after additional exclusions and low `MsMpEng` CPU, which weakens the hypothesis that Defender is the dominant kernel-time source. But it does not prove that “open/close + read syscalls themselves are the final root cause” without syscall/ETW attribution or equivalent evidence. Correct status: Defender-primary hypothesis weakened/rejected; kernel/syscall attribution remains OPEN.

8. **Do not combine multiple restart changes without preserving attribution unless Owner explicitly accepts the diagnostic tradeoff.** The proposed one-shot package (`cache-size` + SST reduction + `ram-scale=3.0` + peer/IBD change) may be operationally attractive, but if all are changed at once, post-restart improvement cannot be causally assigned. If the priority is fastest synchronization rather than diagnosis, that tradeoff can be intentional; document it explicitly and keep a byte-exact old/new argv record.

9. **Existing watchdog configuration drift remains MUST-FIX before any watchdog-driven restart.** The previous review established that the repository watchdog path did not carry the reported live `--ram-scale=3.0`. Nothing in these 8 commits changes that implementation, so this remains OPEN.

## Required evidence before privileged GO

- immutable exact running argv and binary hash/source revision;
- full upstream source pin for IBD classification and actual flag names;
- target peer identity/network/sync/pruning evidence;
- explicit old/new restart argv diff;
- predicted IBD mode and first-log acceptance signature;
- rollback path and watchdog disabled/ownership invariant;
- post-start proof of node identity, pruning point / block-header monotonicity, console RPC recovery, and measured block-rate windows;
- no production signing/broadcast/settlement/refund/DB-money mutation bundled into this restart.

No production funds path, signing/broadcast, settlement/refund, key movement, or privileged restart is authorized by this review.
