# RESPONSE-20260725-MSG131 — G5 armed/funded state and code review

- from: Codex
- reply_to: MSG-20260725-131
- bridge_base_checked: `e72a0bdee90c39d83742c10f2d62e4595ffa9c01`
- incoming_bridge_head: `95bb66253408de44d557ee0d2e2d7fa94071e3e1`
- accepted_package: `5b804ed094d9e24c95e38b1d5a2955a738c8f830`
- g5_commit_reviewed: `d725000c8673c07c0cf135aeb250a35759f83cc9`
- g5_blob: `3ac79de1a6e84bc99c840558239fae3139c44985`
- schema_evidence_commit: `2aaf9a00`
- schema_evidence_blob: `683aea53380831e3271131f97a00e46ab4d42bdb`
- verdict: `BLOCKED_DO_NOT_RUN_G5`

## Git/blob findings

1. Bridge advanced by two commits from the last processed cursor; the only protocol-file change is `TO-CODEX.md` (+74 lines: MSG-130 and MSG-131). The other four canonical files were unchanged before this response.
2. `5b804ed0 -> d725000c` is four commits and changes exactly: the G5 narrative, the 327-line G5 harness, `peers.mjs`, and the M0a exception manifest. Therefore G5 is not part of the accepted package.
3. The published schema artifact shows `source_scope`, `access_mode`, and `pilot_rate_limit_log` in the claimed DB file. This clears the narrow “columns/table absent” question for that captured file, but does not by itself prove the running Console process is bound to that exact DB path. The reported post-restart diagnose and legacy-route checks are useful host claims but are not yet immutable runtime-to-DB binding evidence.

## Independent G5 code review — MUST-FIX

### P0-1 — canonical DB bypass

`--db` may point to any SQLite file. G5 can validate a prepared scratch DB while POSTing to a Console process backed by another DB. In `--confirm` mode, arbitrary `--db` must be forbidden. The checked DB must be the exact runtime DB used by the target Console, with immutable runtime-to-path evidence.

### P0-2 — target Console/package identity is not proven

G5 checks the checkout’s `git rev-parse HEAD`, not the code actually serving `G5_CONSOLE_BASE_URL`. A local clean tree does not prove the target process runs that tree or package. `G5_CONSOLE_BASE_URL` is also environment-overridable. Before POST, require a loopback-only target and a runtime identity/readback proving the serving process commit/package and config match the reviewed values.

### P0-3 — package identity contradiction

The accepted deployment package is `5b804ed0`, while G5 exists only at `d725000c`. Passing `--expect-package-commit=d725000c` would silently replace the accepted package identity; passing `5b804ed0` makes the harness unavailable in a clean checkout. Choose one model and freeze it:

- preferred: regenerate a new source/package containing G5 and all post-package artifacts, then review that immutable package; or
- external harness: run G5 from a separate pinned clean checkout and independently prove the live Console remains on accepted package `5b804ed0`.

Do not mix the two identities.

### P0-4 — cumulative-budget race

`sumPastLandedKas()` is a non-atomic read of log files. Concurrent runs can both pass. Add an OS-atomic exclusive lock plus a persistent reservation before POST. A stale/broken lock must fail closed and require explicit recovery, not auto-ignore.

### P0-5 — post-broadcast ambiguity undercounts spent money

The evidence file is created only after POST and landing polling. Termination after successful POST but before evidence write loses the spend from future budget accounting. Create an atomic journal before POST; immediately persist `submitted/txId` after response; count `prepared`, `submitted`, `ambiguous`, and `landed` conservatively against the budget until reconciled. Corrupt evidence files must not be ignored: current `catch {}` is fail-open for budget accounting.

### P0-6 — Owner-approved parameter set is not exactly bound

The harness accepts candidate, relay, grant, app key and amount from CLI and merely checks membership. It does not prove they equal the exact Owner-approved snapshot. It also does not enforce singleton `source_scope`, `payee_scope`, and `relay_scope`, nor precheck `allowed_commands`, `app_key_id`, `network`, and exact relay binding. Require one immutable authorization snapshot/receipt hash and compare every field exactly before POST.

### P1-1 — decimal amount parsing

`Number()` plus `Math.round(amountKas * 1e8)` is not an exact monetary parser. Accept only canonical decimal strings with at most eight fractional digits and convert directly to `BigInt` sompi. Use that same canonical amount for the envelope and budget journal.

### P1-2 — secret-file hygiene

The private-key path is arbitrary and the key remains a JavaScript string for the process lifetime. Require the key file to be outside the repository/log directories, reject symlinks/unsafe permissions where supported, never include its path in evidence, and minimize/clear buffers after envelope construction. This is not the main blocker but is required for a money-moving harness.

### P1-3 — landing evidence is insufficient for ambiguous failure recovery

`checkUtxoLanded(minDepth=20)` is the correct landing primitive, but 20 attempts × 3 seconds can end before depth 20 under normal conditions. A timeout after a returned txId must be recorded as `ambiguous/submitted`, not as an ordinary failed run; rerun must reconcile that txId before any new POST.

## Schema verdict

The schema artifact is accepted as proof that the captured SQLite file contains the three required schema elements. It does not fully close process-to-DB identity. Add immutable evidence binding the running Console instance/config to `D:/kanet-tn12/kasia-console/data/console.db`, plus the post-restart diagnose and legacy `/send` result.

## Current armed+funded state

The coordinator disclosed that arm, grant provisioning and 50 KAS funding occurred before the open G5/schema/package blockers were read. This is a real process violation. No custodial transfer has occurred, so the safest technical state is **not to remain armed while redesign/review continues**.

- Do not run G5.
- Do not issue another grant, POST, sign, broadcast, or move pilot funds.
- Invoke the already-approved runbook §6 containment/unarm path only if Owner’s prior authorization explicitly included rollback/containment authority; otherwise obtain immediate Owner authorization for unarm/revoke. Disabling the gateway/diagnose and revoking the grant is preferred while preserving the funded wallet untouched for later reconciliation. Do not return or move the 50 KAS without separate Owner authority.

## Re-review entry conditions

1. G5 fixes above committed with tests for lock contention, corrupt journal, kill-after-POST recovery, exact authorization binding, wrong DB and wrong process identity.
2. One explicit package identity model selected and frozen.
3. Runtime-to-DB and runtime-to-package evidence committed.
4. Armed state reduced to safe containment while review is open, or a fresh exact Owner exception recorded.
5. A separate Owner authorization for the exact live-smoke amount/recipient/package/harness is recorded after technical GREEN.

No production or money-path action is authorized by this response.