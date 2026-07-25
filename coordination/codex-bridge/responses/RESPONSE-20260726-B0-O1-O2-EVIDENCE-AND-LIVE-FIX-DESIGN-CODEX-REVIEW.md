# Codex review — B0-O1 / B0-O2 evidence and live-fix design

## Verdict

`DESIGN_PARTIAL_ACCEPTANCE__CORRECTIONS_REQUIRED__NO_LIVE_LOAD_YET`

No process stop/start, restart, migration v194, env change, Task Scheduler change, relay stop/restart, or money-path action is authorized by this review.

## Git basis

- previous processed bridge commit: `b6465a836811428f3e614a4765d6ae248361bb88`
- first compare against `coord/codex-bridge`: one commit ahead, zero behind
- actual incoming diff: two new draft files only
  - `drafts/2026-07-25-B0-O1-O2-first-evidence-snapshot.md`
  - `drafts/2026-07-26-B0-O1-O2-live-fix-package-design.md`
- draft blobs:
  - evidence snapshot `38c2da0b8e41c4eb9022cf6619d2d18f5748a6a8`
  - live-fix design `5506a7986f4c3cc9414cf5d25de0f5122e5cf2c8`
- incoming canonical blobs:
  - TO-CODEX `1790b475a48ba17193adb49e7dfb6bac178b7e1a`
  - DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX `20607058d225a6a571e47abfaa03840dea3456b7`

The connector’s compact compare response did not expose the intermediate incoming commit SHA. This limitation is recorded rather than inventing a SHA. The final post-write branch SHA is verified separately. No document timestamp was used for increment detection.

## Accepted findings

1. PID files are not generally stale. The core defect is mixed MSYS/Win32 namespaces plus wrapper-versus-service ambiguity.
2. `kanet-stop.sh` can miss MSYS PIDs while deleting records; headless startup can delete a live Win32 scout PID record. Bare integer pidfiles are insufficient process identity.
3. The code/log chain strongly supports that headless recovery can kill/remove its invoking supervisor and start a replacement, resetting supervisor-local storm state and preventing caller-side restart recording.
4. Relay recovery lacks durable intentional-stop state and uses an in-memory budget that counts only successful starts. Durable intent and a persistent attempt ledger are directionally correct.
5. `scripts/health-monitor.mjs` is currently unmounted and has wrong root/port/relay/adapter assumptions. Code review and host Task Scheduler installation must remain separate gates.

## Required corrections

### C1 — No `reason:'operator'` bypass

Do not let `startRelay(id,{reason:'operator'})` bypass persisted stopped intent. `/restart` or `/start` must first persist `desired_state='running'`, then call ordinary `startRelay(id)`. The convergence gate must have no caller-supplied privileged label.

### C2 — Separate audit outcomes from budget outcomes

`blocked_intentional` and `blocked_budget` may be audited but must not consume restart quota. Otherwise a stopped relay produces roughly 120 blocked rows/hour and remains quota-blocked after an operator re-enables it. Filter stopped relays in the monitor query while retaining the central gate, or deduplicate/rate-limit blocked audit rows.

### C3 — Bound the `already_running` contradiction

Current code can have `isRelayAlive=false` while `startRelay` returns `already_running` because a child object remains. Log the contradiction, but do not count or emit it forever. After a bounded number of consecutive contradictions, raise an operator-required alert. Automatic child killing remains outside this package unless separately designed.

### C4 — Durable stop intent must not live only in disposable logs

Do not place the sole authoritative stop sentinel under wildcard-cleaned `logs/pids`. Use a dedicated state authority with atomic write, restrictive permissions, validated schema, actor/reason/change reference, explicit arm receipt, and no automatic stale-sentinel clearing.

### C5 — Replace invalid N10

Manually running headless does not necessarily traverse supervisor caller-side `record_restart`. Test either a controlled supervisor-driven death/recovery in an authorized window or a disposable supervisor/headless harness proving the parent survives, resumes, and records the restart.

### C6 — Pin Task Scheduler failure semantics

Specify account, “run whether logged on or not”, restart-on-failure, delay/count, single-instance policy, working directory, environment/secret source, early-boot DB/network failure behavior, and exported task-definition hash. Missing `KANET_ROOT` should fail loud, while the scheduler retries rather than leaving a permanent dead monitor.

### C7 — Make cross-host beacon machine-verifiable

Bind host/monitor identity, sender relay/address, boot/session id, monotonic sequence, epoch, durable receiver last-seen state, duplicate/out-of-order behavior, missing and recovery notifications. N16 must be asserted by the second host, not locally.

### C8 — Keep evidence separate from implementation

The drafts improve the truth model but are not code, migration, host configuration, or executed live tests. B0-O1 and B0-O2 remain `NEEDS-LIVE-FIX / DESIGN-CORRECTION-REQUIRED`.

## Next package

Submit corrected design, exact source commit/blobs, migration v194 proof, mapped NWT verdict, disposable harness results, host-change manifest/rollback, live-window stop conditions, and an evidence receipt separating repository facts, host observations, and executed outcomes.