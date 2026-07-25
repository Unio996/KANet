# Codex review — unsynced G5 v2 / runtime identity progress

## Git and cursor basis

- Last processed bridge commit: `9f4cf8fec33841e60a3a3acb80d11f608d4f124e`
- `coord/codex-bridge` compare result: identical, no canonical-file diff.
- Current canonical blobs:
  - `TO-CODEX.md`: `87aeaa1c7e6f951f5ee98d21919c28793d425240`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `3e60dcf089c5e8656b61a9d9518e1fe0ad6e107b`
  - `DECISIONS.md`: `4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md`: `edce2d5cb05f76c0b001edce5e29d10f2741c862`

Because bridge had no increment, the active branch `bshard-m3-deploy` was checked against reviewed G5 v1 commit `d725000c8673c07c0cf135aeb250a35759f83cc9`.

## Active-branch increment

The branch is four commits ahead and changes only:

- `docs/evidence/2026-07-25-live-console-db-schema-currency-evidence.json`
- `docs/2026-07-25-j2-runtime-identity-endpoint-pending-review-diff.md`
- `docs/2026-07-25-j2-g5-v2-redesign-pending-review-diff.md`
- `kasia-console/src/api/health.js`
- `kasia-console/src/db/client.js`

The shipped runtime-identity code is commit `a7aeb28d0b1cc9805dfd100e4c3893b2c1540752`; blobs inspected include `health.js` `f90a466fb2b4186a60224721d52db1abe755c9e0`, `client.js` `157091c7dfb6a91f69763b3f45d43fc2a36cb4e2`, runtime-identity note `c4979938a488a8e3c2eb62d866a20b2ba87f5e86`, and G5-v2 note `f4890959cc773db8f5d287f7a3f7e467edede50f`.

## Independent verdict

### Accepted progress

1. Exporting the already-resolved `dbPath` from `client.js` is correct and avoids a second DB-path parser.
2. Computing `git_commit`, `db_path`, `db_stat`, `pid`, and `started_at` once at module load is directionally correct for process-lifetime identity.
3. The ROOT-depth bug was genuinely fixed before landing.
4. The G5-v2 design directly addresses the prior blocker set: no arbitrary `--db`, explicit snapshot binding, O_EXCL lock, pre-POST journal, corrupt-journal fail-closed, ambiguous-state halt, singleton scopes, and canonical decimal-to-BigInt parsing.

### Remaining blockers

#### R1 — runtime endpoint is publicly readable by design

`GET /api/system/runtime-identity` has no server-side loopback check or authorization. It discloses absolute DB path, process PID, start time, filesystem identifiers, and repository commit to any network caller that can reach Console. A money-path identity endpoint must itself enforce loopback or an operator-tier credential; relying on G5 to behave locally does not constrain other callers.

Required: add endpoint-side loopback enforcement at minimum, preferably the existing admin-tier + IP allowlist helper. Add positive loopback and negative non-loopback/auth tests.

#### R2 — `git rev-parse HEAD` does not prove loaded bytes

The endpoint records repository HEAD at startup, not the actual bytes loaded by the process. A dirty worktree at startup, generated files, or edit-start-revert sequences can produce a clean tree later while the process still runs previously loaded bytes. The external harness's later clean-tree/diff check cannot repair that gap.

Required: at startup compute and return a deterministic digest set for the exact load-bearing runtime files, or at least a runtime-scope tree digest plus dirty-state marker captured before route registration. G5 must compare this startup-captured digest to the reviewed package/snapshot, not only compare commit names and current disk state.

#### R3 — runtime-equivalent acceptance is too broad without a frozen file manifest

The proposed `git diff --stat <package_commit> <runtime_commit> -- RUNTIME_SCOPE_DIRS` allows any difference outside broad directories and relies on directory selection remaining complete. It also treats an empty Git diff as equivalent even though untracked/generated/runtime-loaded artifacts are outside that comparison.

Required: freeze an explicit load-bearing path manifest and compare startup-captured file blobs/digests. Package identity may differ only when every frozen load-bearing digest is equal. Do not use directory-level emptiness as the sole equivalence proof.

#### R4 — G5 v2 implementation and tests are not committed

The G5-v2 note explicitly says the actual harness rewrite is still uncommitted and no new tests exist. Therefore there is no code object available for independent review and no evidence for lock contention, corrupt journal, kill-after-POST recovery, exact snapshot binding, wrong DB/process rejection, or amount parsing.

Required before re-review:

- commit the full G5-v2 harness;
- update M0a manifest with a new review_ref and exact content digest;
- commit negative tests for every prior blocker;
- generate immutable test evidence bound to the source commit and harness blob;
- submit via Issue #5 and sync bridge.

#### R5 — live process validation remains absent

The endpoint has not been exercised by the actual running Console. Repository code alone does not prove the deployed process exposes the endpoint, reports non-null identity, or binds to the expected DB file.

Required after Owner-authorized restart/containment sequence: immutable evidence binding runtime endpoint output, actual process, DB path/stat, package/load-bearing digests, post-restart diagnose, and legacy `/send` denial.

## Formal status

- Runtime-identity endpoint: **PARTIAL / NOT READY FOR MONEY-PATH RELIANCE**.
- G5 v2 design: **DIRECTIONALLY ACCEPTED, IMPLEMENTATION NOT REVIEWABLE YET**.
- G5 execution: **BLOCKED_DO_NOT_RUN_G5** remains unchanged.
- No grant issuance, POST, signing, broadcast, live smoke, refund, restart, DB mutation, or fund movement is authorized by this review.

Next valid review object is a committed G5-v2 source package with endpoint hardening, startup-captured load-bearing digests, full negative tests, immutable evidence, and an exact package identity model.