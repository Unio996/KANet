# Codex review — B0-O1 / B0-O2 first evidence snapshot and live-fix design

## Verdict

`DESIGN_PARTIAL_ACCEPTANCE__CORRECTIONS_REQUIRED__NO_LIVE_LOAD_YET`

This review does not authorize process stop/start, restart, migration v194, env changes, Task Scheduler changes, relay stop/restart, or any money-path action.

## Git basis

- previous processed bridge commit: `b6465a836811428f3e614a4765d6ae248361bb88`
- incoming bridge HEAD: `INCOMING_HEAD_TO_BE_RESOLVED_FROM_RESPONSE_PARENT`
- compare: one commit ahead, zero behind
- actual diff: two new draft files only:
  - `drafts/2026-07-25-B0-O1-O2-first-evidence-snapshot.md`
  - `drafts/2026-07-26-B0-O1-O2-live-fix-package-design.md`
- incoming draft blobs:
  - evidence snapshot: `38c2da0b8e41c4eb9022cf6619d2d18f5748a6a8`
  - live-fix design: `5506a7986f4c3cc9414cf5d25de0f5122e5cf2c8`
- incoming canonical blobs:
  - TO-CODEX `1790b475a48ba17193adb49e7dfb6bac178b7e1a`
  - DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX `20607058d225a6a571e47abfaa03840dea3456b7`

No document timestamp was used for increment detection.

## Accepted findings

1. The PID files are not generally stale; the core defect is mixed MSYS/Win32 namespaces plus wrapper-versus-service ambiguity. The evidence snapshot correctly withdraws the earlier “7/8 stale” claim.
2. `kanet-stop.sh` can silently miss MSYS PIDs while deleting their records; `kanet-start-headless.sh` can delete a live Win32 scout PID record. A bare integer pidfile is not a sufficient process identity.
3. `kanet-start-headless.sh` can kill/remove the supervisor that invoked it and then start a replacement. The log sequence and code path strongly support the conclusion that supervisor-local restart-storm state and durable restart recording can be reset by the recovery path itself.
4. Relay auto-recovery currently has no durable intentional-stop state, scans all key-backed relays, and counts only successful starts in an in-memory budget. The proposed durable intent and persistent attempt ledger are directionally correct.
5. `scripts/health-monitor.mjs` is currently unmounted/dead and has wrong root/port/relay/adapter assumptions. Treating code changes separately from host Task Scheduler installation is correct.

## Required corrections before implementation approval

### C1 — Remove the `reason:'operator'` bypass from the central relay gate

The design proposes that `startRelay(id,{reason:'operator'})` bypasses `desired_state='stopped'`. This weakens the single convergence gate and allows any future internal caller to self-label as operator.

Required design:

- `/restart` or a future `/start` endpoint must first persist `desired_state='running'`;
- then call ordinary `startRelay(id)` with no privileged bypass string;
- `startRelay` must always enforce the persisted desired state.

The existing restart route already performs `stopRelay` then `startRelay`; the new design should alter persisted intent before that sequence, not create an alternate bypass channel.

### C2 — Do not charge `blocked_intentional` or `blocked_budget` rows against the restart budget

The design says every outcome, including `blocked_intentional`, enters the hourly count. With a 30-second tick, one intentionally stopped relay would create about 120 blocked rows/hour. When an operator later changes it to running, those non-start events could keep the relay budget-blocked for another hour.

Required split:

- audit log may retain all outcomes;
- budget count must include only events that actually attempted process recovery (`started`, `failed`, and possibly `already_running` after an explicit policy decision);
- `blocked_intentional` and `blocked_budget` must not consume the restart-attempt quota;
- avoid writing the same `blocked_intentional` row every 30 seconds. Either filter `desired_state='running'` in the monitor query while retaining the central gate as defense in depth, or deduplicate/rate-limit the audit row.

### C3 — `already_running` must not be treated as a normal restart attempt without resolving the stale-child contradiction

The current code returns `already_running` before loading account state. The monitor can simultaneously decide `isRelayAlive=false` while `startRelay` sees a child object and refuses recovery. Logging this is useful, but counting it forever does not restore the relay.

Before implementation, define a bounded state machine:

- classify stale telemetry versus dead child versus live child;
- after N consecutive `already_running` contradictions, raise a loud operator-required condition;
- do not let the monitor automatically kill a child in this package unless separately designed and reviewed.

The draft’s “tripwire only” boundary is accepted; the acceptance test must prove it does not create unlimited 30-second database/log growth.

### C4 — The stop sentinel must not live only under an operationally disposable logs tree

`logs/pids/console-supervisor.stop` is better than memory, but the repository already has cleanup and pid-record deletion behavior around `logs/pids`. A durable operator intent should be placed in a dedicated state directory or DB/config authority with explicit retention and permissions.

At minimum:

- choose a path not covered by wildcard pid/log cleanup;
- use atomic write and restrictive permissions;
- validate record schema (`epoch`, actor, reason, optional expiry/change reference);
- `arm` must archive or explicitly remove the exact current sentinel and produce a receipt;
- stale-sentinel alerting must not auto-clear it.

### C5 — N10 is not a valid direct test as currently written

The draft says: manually run `kanet-start-headless.sh`, then require a new line in `console-supervisor-restarts.log`. But `record_restart` belongs to the supervisor path after the supervisor itself detects console death and invokes headless. A manually invoked headless run is not guaranteed to traverse that caller-side recording code.

Replace N10 with either:

- a controlled supervisor-driven death-detection test in the authorized live window; or
- a deterministic harness that starts a disposable supervisor/headless pair and proves the parent survives, resumes after the child, and records the restart.

Do not treat absence of a restart-log line after a manually invoked headless run as falsification of the root-cause model.

### C6 — Health-monitor ownership needs Task Scheduler failure/restart semantics, not only “At startup”

The design must pin:

- execution account and credential policy;
- “run whether user is logged on or not”;
- restart-on-failure count/delay;
- overlap policy (single instance only);
- start-in working directory;
- environment and secret source;
- task-definition export/hash as host evidence;
- behavior when network/DB is unavailable during early boot.

The monitor must fail loud on missing `KANET_ROOT`, but Task Scheduler must retry rather than leave a permanent silent dead state after one early-boot failure.

### C7 — Cross-host beacon protocol must bind identity, sequence and freshness

A free-form channel message every 15 minutes is not sufficient proof of liveness. Define at least:

- stable monitor/host identity;
- monotonically increasing sequence or boot/session id plus epoch;
- sender relay/address binding;
- receiver-side durable last-seen state;
- duplicate/out-of-order handling;
- exact 45-minute missing threshold and recovery notification;
- behavior when Console is down but the independent monitor is alive.

The cross-host receiver implementation and negative test remain a separate deliverable; the local host cannot self-attest N16.

### C8 — Separate evidence claims from implementation claims

The two drafts are useful and materially improve the truth model, but they are not code, migration, host configuration, or executed live tests. `NEEDS-LIVE-FIX` is accepted as the current O1/O2 state. No PASS or deployment-ready status exists yet.

## Next review package

Submit one immutable package containing:

1. corrected design incorporating C1-C8;
2. exact source commit and per-file blobs;
3. migration v194 and rollback/forward-compatibility proof;
4. NWT verdict with each correction mapped;
5. offline/disposable harness results for relay-intent, persistent budget, sentinel and supervisor-parent survival;
6. exact host-change manifest for Task Scheduler and rollback;
7. live-window runbook with in-flight money-path/cron inventory and stop conditions;
8. evidence receipt separating repository facts, host observations and executed live outcomes.

Until that package passes review, B0-O1 and B0-O2 remain `NEEDS-LIVE-FIX / DESIGN-CORRECTION-REQUIRED`.