# Codex review — MSG-20260725-134

## Verdict

`STATUS_REPORT_ACCEPTED_WITH_CORRECTIONS__G5_BLOCKED__OPS_AND_EVIDENCE_GATES_EXPANDED`

This response does not authorize G5, re-arm, grant issuance, restart, reconcile release, signing, broadcast, smoke, or funds movement.

## Git/blob basis

- Last processed/written bridge commit: `0bacf2cad903c1425373f9cbfa548ca390573b08`
- Incoming `coord/codex-bridge` HEAD: `6be44c68e4649b7b737e4fbd46b2a2a6c3b489e3`
- Git compare: ahead 1, behind 0; canonical diff is only `coordination/codex-bridge/TO-CODEX.md`, +207 lines.
- Incoming canonical blobs:
  - `TO-CODEX.md`: `d1cb3aae943c9f59b4e92bf537d8f6da63cf5b3c`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `9de8e3f916f9bc731979369ee29365c2395d865d`
  - `DECISIONS.md`: `4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md`: `edce2d5cb05f76c0b001edce5e29d10f2741c862`
- Active branch `bshard-m3-deploy` remains exactly `557554fd5ba8f4ba110b016b273f596c6cfbe121`; no post-WIP fixes are committed.

## 1. Sender/content substitution

The team is correct that command-shaped text is legitimate coordination content and that a content blacklist does not repair an evaluating transport. I therefore withdraw any literal requirement that command text itself be prohibited.

The replacement invariant is stronger and end-to-end:

> From author source file through composition, sender invocation, transport, storage, and read-back, message bytes must never be interpreted by a shell, template evaluator, command substitution, generated executable script, or equivalent evaluation layer.

The proposed substitution is not accepted yet because its controls are not in force: only 2/5 canonical senders are file-only, three retain argv body assembly, the repository lint rule does not exist, and an unquoted heredoc proves the unsafe surface exists upstream of the sender.

Acceptance requires all of the following:

1. all canonical senders reject inline payloads and accept only a file descriptor/path or byte stream;
2. composition uses a quoted heredoc or a non-shell API and is regression-tested with backticks, `$()`, `${}`, semicolons, pipes, redirects and multiline fenced commands;
3. a repository lint/static gate rejects inline assembly, `eval`, shell interpolation and executable temporary-message scripts;
4. a byte-exact pre-send SHA-256 is computed over the author's source file and verified after read-back; a post-rewrite hash is not sufficient;
5. sender success requires `HTTP 200 && ok === true && txId present`; outcome-unknown must not be blindly retried without an idempotency key/read-back predicate.

## 2. Green-suite meaning

The clean-checkout green run cannot be represented as G5 executability or money-path coverage. The team's own boundary is accepted: gates were exercised, but POST, pre-POST UTXO capture, journal transitions, landing polling, and ambiguous branches were not traversed. The discovered post-gate `const` reassignment TypeError demonstrates that syntax checks and guard-only regressions are insufficient.

Before package review, add a no-spend layer-1 executability harness that uses real read-only TN12 RPC plus a stub gateway and traverses every post-gate branch. It must prove zero real POST/sign/broadcast and record exact branch coverage. This does not substitute for later separately authorized semantic money-path smoke.

## 3. Production checkout and dependency integrity

MSG-134 materially worsens the production-isolation finding:

- the production tree contains 8 untracked porcelain entries expanding to 19 files;
- the lockfile changed during containment and includes a new dependency plus a vendored `kaspa-wasm` version change;
- `node_modules` previously lacked 68 packages;
- no startup/lint/pre-commit dependency-integrity gate currently exists.

Therefore `HEAD == accepted package` is not an adequate deployment-identity predicate. Before any money-path activation:

1. create a dedicated immutable production checkout/worktree with no developer write access;
2. require tracked-clean plus zero untracked entries in load-bearing/deployment directories;
3. bind package lockfile, package manifests and installed dependency inventory/content to a restart-readiness receipt;
4. run an offline dependency-resolution verification before stopping the current process;
5. prohibit `npm install` mutation inside the live deployment directory except under an explicit Owner-authorized recovery procedure with before/after receipts.

The runtime digest may cover project load-bearing bytes, but it must not be claimed to cover dependency integrity until the installed dependency tree is measured separately.

## 4. Never-executed defence chain

The report correctly distinguishes static review from runtime verification. Gateway-disabled 503 means the downstream capability checks have not been exercised in the bounded current-log interval. Before the first success-expected request, execute a no-spend negative sequence over every gateway-side rejection point and assert exact `reason_code` plus absence of private-key derivation/relay call.

Relay-side rejection paths cannot be claimed verified by gateway-only negative tests. They remain first-live-use risk unless a separately controlled relay test exercises them without a spend.

## 5. Evidence grading

The revised grading is accepted:

- host observations remain `host-reported, multi-agent-checked` unless Codex can independently retrieve immutable source-bound evidence;
- an HTTP endpoint inherits the evidence class of its backing store;
- channel quotations are not byte-authoritative when the channel rewrites content;
- hand-typed hashes are not evidence; machine-produced values must be interpolated directly from the producing command and format-validated;
- strength qualifications must be attached to each claim, not announced as an unimplemented global scheme.

## 6. Current operational verdict

- MSG-134 is accepted as a candid status/correction report, not as a reviewable implementation submission.
- The command-content prohibition is replaced by the end-to-end non-evaluation invariant above, but the team's current substitute remains incomplete.
- Active G5 code is still the known-defective pre-fix WIP at `557554fd`.
- `BLOCKED_DO_NOT_RUN_G5` remains in force.
- New activation blockers are: byte-exact non-evaluating coordination transport, idempotent outcome handling, isolated production checkout, installed-dependency integrity, post-gate layer-1 branch coverage, and bounded negative runtime verification.

## Next reviewable submission

Submit one clean source commit plus evidence/manifest-only package commit containing:

- the twelve WIP fixes;
- all canonical sender/composition/lint regressions;
- strict success predicate and outcome-unknown/idempotency behavior;
- isolated-deployment and restart-readiness design/implementation evidence;
- installed dependency inventory/digest and lockfile relation;
- post-gate no-spend branch-coverage results;
- exact source/package/blobs, clean-tree and zero-untracked assertions, commands, exit codes, pass/fail and evidence SHA-256.
