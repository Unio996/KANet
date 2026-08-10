# Codex review — versioned watchdog scheduler installer

- reviewer: Codex
- bridge_baseline: `474e08bb3129c26272b5a446467a5e680eefae5c`
- active_branch_reviewed: `bshard-m3-deploy`
- active_compare: `879e0fde5c088983c334606ac052cd898bd6737c..6149277b71f9cb8ce54dbf8f629eb96e7834ffaa`
- authority: independent technical review only; no production money-path authorization

## Verified bridge baseline

Git compare baseline -> `coord/codex-bridge` is identical: ahead 0 / behind 0 / total commits 0 / files []. Canonical blobs were re-fetched from Git, not inferred from file timestamps:

- `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
- `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

## Independent judgment

Commit `6149277b71f9cb8ce54dbf8f629eb96e7834ffaa` is directly relevant to the prior OPEN item. It adds a versioned Windows Task Scheduler install/verify/uninstall unit and a committed cron wrapper. This is real progress: the scheduler definition is no longer only an out-of-repo operator loop/comment.

The measured deployment result, however, correctly does **not** close recurring supervision. The task was installed and force-run, but in Task Scheduler context the underlying SSH probe either returned `UNREACHABLE:spawnSync ssh ETIMEDOUT` or remained running beyond 60s. The task was then uninstalled. Therefore current deployed state is still **UNARMED**, and the scheduler-context reachability issue remains OPEN.

There is also a concrete verification semantics defect in the new code that should be fixed before treating `-Verify` as an acceptance gate:

1. `j1-watchdog-sentinel-cron.sh` always executes `exit 0`, even when `j1-watchdog-sentinel-once.sh` returns nonzero. It records the real sentinel rc only inside `$LOG.alive`.
2. `Show-State` in `j1-watchdog-sentinel-task.ps1` does not read `$LOG.alive`, does not check its freshness, and does not check the recorded sentinel rc. It returns success whenever the task exists and is not Disabled.
3. Consequently a task that is repeatedly executing but whose sentinel is continuously `rc=2 UNREACHABLE` can still make `-Verify` succeed. `LastTaskResult=0` is expected in that case because the wrapper intentionally swallows the sentinel rc.

This is a different failure mode from the already observed wrapper syntax failure (`LastTaskResult=2`). The latter is visible to Task Scheduler; the former is semantically blind while looking operationally healthy.

**Verdict:**

- versioned scheduler/install unit: **LANDED IN CODE**;
- scheduler-context SSH/Tailscale/ASKPASS reachability: **OPEN**;
- currently armed recurring supervision: **NO — task was intentionally uninstalled**;
- `-Verify` as a functional-health acceptance gate: **RED / MUST-FIX**, because it currently verifies registration/enabled state, not successful/fresh sentinel execution;
- end-to-end notification/escalation delivery: **OPEN**.

Minimum closure for the verification layer: `-Verify` (or a separate versioned health verifier) must require a fresh `.alive` record, parse its rc, reject stale/missing/malformed records, and reject nonzero sentinel rc. Tests should include: registered-but-never-ran, fresh rc=0, fresh rc=1, fresh rc=2, stale alive, malformed alive, Disabled task, and wrapper-level nonzero `LastTaskResult`. Only after scheduler-context probe reachability is fixed should the task be re-armed and an unattended-cycle receipt be used to close deployment continuity.

No watchdog/miner deployment, daemon restart, DB mutation, refund/settlement, signing/broadcast, key movement, or production money-path action is authorized by this review.
