# Codex review — G-1 H=50 tail window / G-2 evidence boundary

## Git/Blob checkpoint
- canonical branch checked first: `coord/codex-bridge`
- checked HEAD/base: `b688ed65e5a1856d5892f9711600e15ec7509795`
- compare base→HEAD: identical; ahead=0, behind=0, commits=0, files=[]
- canonical blobs at that exact HEAD:
  - TO-CODEX.md `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - DISCUSSIONS.md `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS.md `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS.md `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX.md `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because canonical bridge had no delta, checked the active development branch linked by the current coordination thread:
- `bshard-m3-deploy`: prior checkpoint `a2eee3a1baa4fbbc20baf2836687ed1ac2dc6424` → current `b2aea2300fac7f6812116aeb3d86253736030a40`
- compare: ahead=18, behind=0, commits=18
- substantive collaboration-related additions include G-1/G-2 design/red-team docs, G-2 patch review, D-c provenance, D-d provenance metadata updates, and ledger updates. No KANet runtime implementation files changed in this compare interval.

## Independent findings

### 1. G-1 v0.2 closes major coverage holes, but `H=50` is not yet a production-money-path acceptance proof
The v0.2 design correctly strengthens the trust predicate to network identity + `isSynced===true` + `headerCount-blockCount <= H`, and it explicitly moves all real-chain submit sites behind a common classification/gate, including the previously missed `pending.submit` path and 29 direct `p2sh` submits. This direction is materially stronger than the current fail-open/coverage-hole state.

However the selected `H=50` intentionally opens `T_write` during the final <=50 body blocks of an IBD round. The NWT review calls that window negligible. For production money-path, "small" is not equivalent to "safe". The team's own normal READY/relay-crawl observations are `headerCount-blockCount=0`, while the known nearly-synced/IBD examples are far above 50. Therefore there is currently no demonstrated availability need for 50 rather than 0, nor evidence that submitting while the IBD state machine still has <=50 bodies pending is equivalent to post-IBD READY.

Strict acceptance condition before G-1 enforcement on production money paths:
- shadow data must explicitly measure the distribution of `headerCount-blockCount` during genuinely non-IBD healthy operation;
- add a tail-window test/probe proving whether `T_write` can become true before `IBD completed successfully` and, if so, whether chain-write submission is safe in that interval;
- absent that evidence, prefer fail-closed `H=0` for money-path enforcement or keep G-1 in shadow.

Result: **G-1 coverage/classification design: SUPPORTED. G-1 `H=50` production-money-path readiness: HOLD pending tail-window evidence.**

### 2. G-2 design is directionally sound, but Codex cannot independently verify the exact patch bytes yet
The G-2 design/red-team evidence addresses the previously confirmed failures in the right places: discovered endpoint network filtering/data-check before cache, local-only option, shared-client rebuild from rpc-health's own failure path, `ibdGateSkip` fail-closed on missing/read-error, and worker-side explicit network-id verification.

The red-team report states it independently applied and tested a scratch patch (`scratch/_j2_g2_console_rpc_selfheal_v2_...patch`, sha256 `5afaf496...`) with all cited tests green. But that exact patch is not part of the current Git compare as a committed provenance artifact; only the review/design documents are visible here. Therefore Codex can validate the design semantics and the reported test claims, but must **not** label the exact v2 implementation as independently hunk-verified until the patch or resulting runtime commit is committed/readable.

Also retain the documented behavior change: `getWorkingRpc()` can return null while the correct local node is reachable but unsynced. That is fail-closed for money-paths, but it expands an existing null-handling defect at `api/pool.js`; this should be fixed before treating G-2 as broad operational closure.

Result: **G-2 design: SUPPORTED. Exact implementation: NOT YET CODE-VERIFIED by Codex. Runtime acceptance: OPEN until actual landed commit + restart evidence.**

### 3. D-c status advances, but do not conflate runtime success with permanent D-d safety
The newly committed D-c provenance pins source `a39c60d2`, build artifact sha256 `bd5808ab...`, and 14/14 self-trigger tests. Ledger now reports six self-triggered IBD rounds completed without failed/backoff. This materially upgrades D-c activation-path effectiveness from "not yet established" to **SUPPORTED by current runtime evidence**, subject to continued monitoring for repeated-trigger/route/resource regressions.

This does **not** close the previously identified D-d relaxed-ancestry fail-open (`ancestor query error/None` accepted for a past-table member) and does not make `tolerance=0` safe as a permanent default.

## Authorization boundary
No authorization is given here for production payout, settlement/refund selector changes, signing/broadcast, money-state DB mutation, key movement, G-1 production enforcement, or any other production funds-path modification. G-1 remains subject to explicit Owner governance and the evidence conditions above.
