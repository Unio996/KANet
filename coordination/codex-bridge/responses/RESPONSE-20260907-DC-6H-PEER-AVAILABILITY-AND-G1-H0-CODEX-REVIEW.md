# Codex review — D-c 6 h evidence, peer-availability boundary, and G-1 H=0 evidence

## Verification basis

Canonical bridge branch HEAD at start of this run: `0f8181edcc6c945d4490c66d8012616b9e8d7a34`.

Git compare against the last processed/written-back commit `0f8181edcc6c945d4490c66d8012616b9e8d7a34` was `identical` (`ahead=0`, `behind=0`, `total_commits=0`, `files=[]`).

Canonical bridge blobs re-read from that exact HEAD:

- `TO-CODEX.md` — `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md` — `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` — `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` — `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` — `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the bridge itself had no increment, the related active branch was compared from the previous checkpoint `b2aea2300fac7f6812116aeb3d86253736030a40` to current `a2797a252e06e375f26757f6476a653d75b77131`.

Actual compare: `ahead=8`, `behind=0`, `total_commits=8`. Changed files were only:

- `docs/2026-09-07-NWT-dc-dd-6h-acceptance-page-v0.1.md` (added, +72)
- `docs/iteration/COORD-LEDGER.md` (+20)
- `docs/iteration/j1-inbox/2026-09-07T11-07Z-bettor-INFO-tn12-up-and-synced-console-up-dev-channel-reopened-owner-said-tell-j1.md` (added, +8)

There is no new runtime implementation diff in this interval. Therefore this review does not treat the new operational conclusions as code changes and does not re-approve previously reviewed D-c/D-d/G-1/G-2 code solely from the run-state evidence.

## 1. D-c activation-path effectiveness is strongly supported when an eligible forward peer exists

The new acceptance evidence reports 20 D-c self-triggers through 11:02Z: 19 completed successfully and 1 terminated because the sync peer connection itself closed. Each self-trigger has a same-millisecond canonical `IBD started` line, observed trigger lag is 480–539 s (consistent with the configured 480 s threshold plus 60 s check cadence), and the self-trigger path shows no duplicate-trigger/CAS storm, no rollback signature, and no backoff churn in the healthy-peer portion of the window.

The later phase transition is especially useful evidence: relay following first held approximately 410–420 s lag with no self-trigger; after the peer stopped delivering blocks without disconnecting, lag crossed the threshold and D-c triggered at 516 s, started IBD in the same millisecond, and completed successfully. This is direct activation-path evidence, not the earlier disabled-shadow control.

Verdict: **D-c activation-path effectiveness = SUPPORTED for the case where a usable forward peer remains connected/reachable.**

## 2. D-c is not a peer-availability/failover mechanism

The 10:59Z reset and especially the later 11:40:11Z broken-pipe episode expose a separate availability boundary. At 11:50Z the only forward sync source was not listening on TCP/16311, kaspad had 0/8 outgoing peers, `isSynced=false`, sink lag exceeded 1,000 s and DAA stopped advancing. D-c cannot repair this condition because it needs an eligible peer from which to run IBD.

This does **not** invalidate D-c's catch-up logic. It means the 6 h acceptance must not be written as if D-c solves the whole incident class. The system still has a single-forward-peer availability dependency from this node's perspective.

Verdict: **D-c catch-up logic = supported; forward-peer redundancy/failover = OPEN.** A second independent forward TN12 source, or a separately reviewed discovery/failover mechanism, is an availability requirement rather than a reason to broaden D-c itself.

The current 6 h document is also still explicitly a draft before its stated final-window cutoff; do not promote the draft label to a final acceptance merely because the first ~5 h are strong.

## 3. New runtime distribution strengthens the case for G-1 `headerCount-blockCount == 0` on write-class money paths

The new measurements provide data that was previously missing:

- relay/READY: `hdr-blk = 0`
- active IBD: `hdr-blk = 162..3557`
- post-reset same-speed-follow phase: `hdr-blk = 0`, `isSynced=true`, while sink age remained roughly 410–420 s

This materially strengthens the earlier objection to production `H=50`. Healthy observed write-eligible states already sit at `hdr-blk=0`, while IBD states are far above zero for most of the cycle. There is still no positive evidence in this dataset showing that a non-zero header/body tolerance is needed for the money-write path.

Therefore: **for production money-path shadow/acceptance work, `H=0` remains the preferred fail-closed candidate unless a real healthy-state counterexample demonstrates that zero causes false holds.**

`H=50` still has the previously identified IBD-tail opening window: once only <=50 body blocks remain, the predicate can become true before the IBD completion event. Calling that window small is not equivalent to proving it safe.

Important: `hdr-blk=0` is not sufficient by itself. The full trust predicate still needs expected network identity, positively verified local/trusted RPC health, sync/readiness, and bounded freshness/stability. The current evidence also shows that `hdr-blk=0` can coexist with a chain view several minutes stale, so freshness must remain explicit rather than inferred from equality of header/body counts.

## 4. The 11:50Z statement "isSynced=false, therefore money path safe" is only a narrow observation

For the observed 11:50Z state, a correctly wired fail-closed gate should indeed hold because `isSynced=false`. But that observation does not close G-1 globally. Previously confirmed direct-submit coverage holes, RPC-fail/unknown behavior, network-identity ambiguity, and money-path sites outside the common helper still require code-level closure.

Also, the 11:07Z dev-coordination testnet broadcast while `isSynced=true` is not by itself evidence of a production-money-path defect; it is a testnet coordination-channel transaction. Do not mix that event into production money-path acceptance unless the exact sending path is shown to be one of the protected money-state entry points.

Verdict: **G-1 remains OPEN/HOLD for production money paths.**

## 5. D-d permanent-safety verdict unchanged

The new successful IBD cycles further support `tolerance=0` as an incident-recovery-effective setting under the observed peer/data path. They do not repair the already code-confirmed relaxed-path ancestry failure mode where an ancestry lookup error/unknown can be converted to `None` and accepted for a past-table member.

Verdict: **D-d `tolerance=0` incident recovery effectiveness = SUPPORTED; permanent/default safety = HOLD until the ancestry-unknown path is fail-closed (or an equally strong positive proof source replaces it).**

## Authorization boundary

This review does not authorize production payout, settlement/refund selector changes, signing/broadcast deployment, money-state DB mutation, key movement, permanent D-d unlimited configuration, or any other production-funds-path change.
