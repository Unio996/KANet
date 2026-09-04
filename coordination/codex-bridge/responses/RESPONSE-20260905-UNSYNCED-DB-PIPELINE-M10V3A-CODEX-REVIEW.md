# Codex review — unsynced D-b implementation/provenance + M10 v3-A SQL observer

## Git baseline

- canonical branch: `coord/codex-bridge`
- checked HEAD / previous processed write-back baseline: `6968232ef7815ce29269400a25e5c815238d10b5`
- bridge compare: `identical`; ahead 0 / behind 0 / total commits 0 / changed files 0
- canonical blobs at checked HEAD:
  - `TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No bridge-file timestamp was used for increment detection.

## Unsynced active-branch compare

Relevant active branch `bshard-m3-deploy` advanced from prior checkpoint `8798b95efef6cc4807ceaa0d931c99a7cc0271fe` to current HEAD `788656779d046e77520a7360f367eabd40cbae8c`: ahead 20 / behind 0.

Actual compare contains D-b build/provenance (`docs/provenance/2026-09-05-kaspad-db-ibd-pipeline/*`), D-b/NWT coordination evidence, and real M10 v3-A console code (`kasia-console/src/db/client.js`, `slow-sql-observe.mjs`, tests). This is not coordination-only.

## Independent findings

### 1. D-b is now repository-resolvable enough for a real code review

The previous `NOT REPOSITORY-RESOLVABLE` blocker is materially changed. The repository now contains an immutable provenance diff for full implementation commit:

`4d0a9e30215031ae5a980c1c72f01c2eea13ac81`

based on D-a commit `1b3046fbb86687560468b2960132a82893d1e96b`, with patch sha256 `fd7d76722d793bc23006eb8c313c4f54a97484de49be98637d809b6dc3c86067`, plus build/test logs and artifact sha256 `2432c36b0cdf5e561eeeebe5de3e4cb807b962797109b11a29c4eef8f6361a95`.

The patch itself is narrow: body-only IBD sends request `i+1` before draining request `i`, keeps depth fixed at 2, splits the prior body-only helper into send/receive halves, and leaves the non-body/v7 path in the original loop.

Code-level review supports the following conditional invariants:

- with `IBD_BATCH_SIZE=99`, at most two requested body chunks can coexist at the incoming route, so the stated 198-message bound is consistent with a 256-entry route **if the cited router capacity/overflow semantics remain exact**;
- the current chunk is still fully received before its processing jobs become the `prev` set, and `try_join_all(prev_jobs)` remains after receiving the next chunk, so the intended overlap is actually present;
- one-chunk boundary handling is valid (`prev` becomes populated before the final `expect`);
- receive order is fail-closed only because the unchanged receive loop validates expected block hashes; this still depends on the cited peer-side in-order response behavior. The client itself does not associate each response body with a specific outstanding request.

Therefore D-b implementation status can move from `NOT REPOSITORY-RESOLVABLE` to **`CODE-REVIEWED / GREEN-CONDITIONAL FOR ISOLATED EXPERIMENT`**.

It does **not** move to production/live authorization. There is still no dedicated IBD-pipeline unit/integration test in the provenance run (`kaspa-p2p-flows`: 7 existing tests only), and the decisive properties — real peer ordering, overlap, timeout behavior, route-capacity behavior and throughput — are runtime properties. A live binary switch remains **HOLD pending Owner GO + the already-defined rollback/observation gate**.

### 2. D-b provenance exposes a deployment hygiene issue that must stay closed by process

The second build attempt tried to use the default target directory and collided with the currently running D-a executable. The successful build only became isolated after moving to `CARGO_TARGET_DIR=D:\rusty-kaspa-da\target-db`.

This is useful evidence, not merely a build nuisance: a mutable compiler target directory is not an acceptable durable deployment identity. The already-recorded rule — build to an independent target and copy any approved executable to an immutable/versioned deployment path before switching — should remain a hard prerequisite. Do not point watchdog/supervisor directly at a compiler output path without a real SHA-256 check.

### 3. M10 v3-A is real observe instrumentation, but raw SQL text logging has a confidentiality gap

`slow-sql-observe.mjs` correctly avoids logging **bind arguments**, but it logs the first 80 characters of the raw SQL statement:

`sql=${JSON.stringify(head)}`

where `head` is whitespace-normalized `String(sql).slice(0, 80)`.

That is not equivalent to "no sensitive values." Any caller that constructs SQL with an inline literal (template interpolation, generated `IN (...)`, diagnostic SQL, or an embedded token/address/string literal) can put the literal directly into the SQL text. The current tests only prove that a bound value such as `SECRET-ADDR` is absent; they do not prove that literals are sanitized.

**Codex status: raw SQL-head evidence logging = MUST-FIX before these logs are broadly copied into bridge/evidence.**

Preferred fix: log a normalized/fingerprinted statement shape, or redact string/numeric/blob literals before truncation. Add a negative vector with a literal secret in SQL text, e.g. `SELECT 'SECRET-LITERAL-123'`, and prove the diagnostic line contains no literal value. Existing logs produced after activation should be treated as potentially containing SQL literals until sanitized.

### 4. The observer is low-impact but not literally identity-preserving

The implementation returns a `Proxy` from `prepare()`, and chain methods returning the native Statement are deliberately converted back to that Proxy. Method receiver correctness is handled well (`fn.apply(stmt, args)`), and tests cover `all/get/run`, chain methods, transactions, getters, `iterate`, `columns`, detached methods, error propagation and logger fail-open behavior.

However, statements such as "return value/this unchanged" or "zero semantic change" are too strong. Statement object identity is changed by design. That is probably harmless for current normal callers, but it has not been proved for any code that may perform native-Statement identity/type-sensitive integration.

Accurate status: **query/result/error semantics are well-covered; Statement identity preservation is intentionally not provided.** Keep this helper limited to the current database boundary and do not reuse it in APIs where Statement identity is observable without a separate compatibility check.

### 5. M10 v3-A remains suitable for diagnosis after the above logging fix

The wrapper measures synchronous wall time exactly around `stmt.all/get/run`; it therefore addresses the earlier attribution gap for synchronous SQLite work even when an outer async tick has already crossed its first `await`. It does not measure `iterate`, `exec`, `pragma` or transaction wrapper overhead, so absence of a `sql.*` line is not evidence that SQLite performed no synchronous work.

Any root-cause claim should continue to combine these spans with caller/source and tick-phase timing, not infer causality from timer co-start.

## Required next evidence

1. Sanitize/fingerprint SQL text; add a literal-secret negative test before exporting M10 v3-A logs as durable evidence.
2. Keep D-b executable switch gated: immutable/versioned executable identity, exact SHA-256 verification, Owner GO, and the existing fail-fast rollback strings.
3. On any D-b trial, record actual request/response timing, first/second chunk gap, peer/session identity, disconnect/timeout/capacity errors and same-phase throughput; do not infer success merely from lower RTT or a successful process start.
4. If D-b ever observes response reorder/hash mismatch, treat it as a correctness failure and roll back; do not solve it by enlarging route capacity or relaxing expected-hash checking.
5. No production money-path authorization is implied by this review.

## Safety boundary

No production payout, settlement/refund, signing/broadcast, DB money mutation, key movement, or other production funds-path change is authorized. No privileged live D-b deployment is authorized by this review.
