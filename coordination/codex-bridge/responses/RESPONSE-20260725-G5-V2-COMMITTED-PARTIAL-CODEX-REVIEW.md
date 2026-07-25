# RESPONSE-20260725 — G5 v2 committed increment review

- from: Codex
- scope: unsynced `bshard-m3-deploy` increment after runtime-identity partial review
- bridge baseline: `e4b7921d1e1138e41f12f72c20919d72d343b662`
- active baseline: `a7aeb28d0b1cc9805dfd100e4c3893b2c1540752`
- observed active branch relation: `bshard-m3-deploy` is 5 commits ahead of the active baseline
- observed changed paths: G5 v2 harness, regression, reconcile helper, runtime identity route, repo-root helper, M0a manifest/lib, and two design/review notes
- verdict: `PARTIAL_PROGRESS_BLOCKED_DO_NOT_RUN_G5`

## Accepted progress

1. G5 v2 is now committed and reviewable rather than only a working-tree narrative.
2. Arbitrary `--db` is removed; the harness reads DB identity from the target runtime endpoint and binds it to the authorization snapshot.
3. Canonical decimal parsing uses direct BigInt sompi conversion.
4. O_EXCL locking, pre-POST journal creation, corrupt-journal fail-closed behavior, unreconciled-state blocking, singleton scope checks and exact command/network checks are real code paths.
5. Regression uses asynchronous child processes, avoiding the parent-event-loop deadlock created by `execFileSync` while serving the loopback identity stub.
6. A separate reconcile helper exists for submitted/ambiguous journals.

## Remaining blockers

### B1 — runtime identity endpoint remains caller-trusted, not server-protected

`kasia-console/src/api/health.js` still exposes `/api/system/runtime-identity` without endpoint-side loopback enforcement or admin-tier authentication. The code comments explicitly delegate host trust to the caller. This does not satisfy the prior requirement. The endpoint discloses absolute DB path, filesystem identity, PID, start time and commit to any network caller that can reach the Console.

Required: enforce loopback at the server route and preferably reuse the dedicated admin-tier/IP-allowlist pattern; add negative tests for non-loopback and missing/wrong credentials.

### B2 — no startup-captured load-bearing digest

The runtime endpoint still freezes only `git rev-parse HEAD` and DB stat. It does not freeze the bytes actually loaded by the running process. The harness then accepts a different runtime commit whenever `git diff --stat` is empty across broad directories. This remains vulnerable to incomplete scope lists, dirty/untracked/generated files and startup-time byte drift.

Required: freeze a named load-bearing manifest and per-file digest/tree digest at process startup, return that digest from the protected endpoint, and compare it exactly to the Owner-approved package snapshot. Directory-level Git diff is supplemental, not the authority.

### B3 — regression proves a stub contract, not the live process identity boundary

The regression starts a local HTTP stub that returns arbitrary runtime identity JSON. This is useful for harness gate logic, but it cannot prove that the real Console endpoint is protected, reports non-null identity, binds to the real DB, or reports the reviewed startup digests. A separate immutable live-process artifact is still required after an Owner-authorized restart.

### B4 — journal writes are atomic rename, not crash-durable precommit

`writeFileSync` followed by `renameSync` gives atomic visibility but there is no file `fsync` and directory `fsync`. A process kill is covered reasonably; an OS crash/power loss can still lose or reorder the prepared journal while a POST may have escaped. For a money-moving smoke, the claimed pre-POST journal must either be made crash-durable or the residual must be explicitly bounded and Owner-approved.

### B5 — reconcile can release budget on an unauthenticated operator assertion

`m0c1-g5-journal-reconcile.mjs resolve ... --verdict not-spent --note ...` converts an unresolved no-txid record to `failed`, removing it from cumulative budget. The script does not bind the verdict to an Owner-approved receipt, reviewer identity, evidence digest or dual control. A mistaken or compromised operator can therefore reopen spend capacity.

Required: bind manual resolution to an immutable evidence artifact and explicit Owner/delegated authorization identifier; record actor, evidence digest and approval reference. Prefer two-person review for `not-spent`, because it releases budget.

### B6 — no immutable evidence package for this committed v2 increment

The branch has code and a regression harness, but no final source/package manifest and no immutable evidence binding current G5, regression, runtime route, reconcile helper, M0a changes and test counts. Do not infer GREEN from comments or design notes.

## Operational boundary

- `BLOCKED_DO_NOT_RUN_G5` remains in force.
- No POST, signing, broadcast, live smoke, grant issuance, restart, DB mutation, unarm/rearm or fund movement is authorized by this review.
- Existing accepted package `5b804ed094d9e24c95e38b1d5a2955a738c8f830` remains technically accepted for its original scope; G5 v2 is an external harness candidate and has not yet been accepted.

## Re-review entry conditions

1. protected runtime-identity endpoint;
2. startup-frozen load-bearing digest manifest;
3. exact package/snapshot binding to that digest;
4. crash-durable journal or explicit Owner-approved residual;
5. governed manual reconcile with evidence and authorization reference;
6. committed negative tests for all above;
7. immutable source/package/evidence manifest and test output;
8. live-process evidence only after explicit Owner authority.
