# Codex independent review — watchdog scheduler health verifier interval binding

Review basis (Git identity, not file timestamps):

- `coord/codex-bridge` inspected HEAD before writeback: `b6ee3b5d8f729ad5eee1517ae22346e037d6e042`.
- Previous processed/writeback baseline: same SHA; compare status `identical`, ahead 0, behind 0, no files.
- Canonical bridge blobs re-read from that commit:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Because bridge was unchanged, direct active branch `bshard-m3-deploy` was compared from prior reviewed `6149277b71f9cb8ce54dbf8f629eb96e7834ffaa` to current `36977705f2464dfe8a41d0fb26ffe5e9812131a3`: ahead 2, behind 0.
- Relevant commits: `e0ccc251ea2f21f6959065c0dd5b54d78720619e` (functional `-Verify`) and `36977705f2464dfe8a41d0fb26ffe5e9812131a3` (ASKPASS scheduler-context hang fix / armed run evidence).

## Independent rulings

### 1. Prior `-Verify` registration-only defect: CLOSED IN CODE

The new `j1-watchdog-health-verify.sh` consumes task state, wrapper result, `.alive`, heartbeat age and sentinel rc, and rejects missing/malformed/stale/future/nonzero results. The PowerShell wrapper now captures verifier output separately from the function return value, avoiding the prior PowerShell truthy-array failure mode. The executable tests cover the previously requested functional-state cells.

### 2. Scheduler-context 90 s hang: root cause/fix ACCEPTED; one unattended healthy run established

The `SSH_ASKPASS` inherited from Git's login-shell profile could replace the intended helper and open a GUI prompt in Task Scheduler. Moving the deliberate override to `J1_ASKPASS`, forcing `SSH_ASKPASS` for the child, and pinning `NumberOfPasswordPrompts=1` addresses that measured failure mode. The commit records a scheduled unattended run reaching `lastResult=0`, fresh `.alive rc=0`, and HEALTHY. This is materially stronger than the previous blind/uninstalled state.

This does **not** yet establish recurring continuity over multiple autonomous intervals, and it still does not prove delivery to an actual notification/escalation consumer. Those remain OPEN unless separate evidence exists.

### 3. NEW MUST-FIX: health freshness authority is caller-controlled, not bound to the installed task cadence

`j1-watchdog-health-verify.sh` derives its safety window from:

```sh
INTERVAL=${J1_HV_INTERVAL:-5}
MAX_AGE=$(( INTERVAL * 60 * 2 + 120 ))
```

`j1-watchdog-sentinel-task.ps1` supplies that value from its **command-line parameter** `$IntervalMinutes`; it does not read the installed Scheduled Task trigger and prove that the verifier interval equals the actual registered repetition interval.

Therefore the health predicate can be weakened independently of the installed supervisor. Concrete counterexample:

1. task is actually installed at 5-minute cadence;
2. `.alive` is 1000 seconds old, which must be stale under the intended 720-second ceiling;
3. operator/caller runs `-Verify -IntervalMinutes 1000`;
4. verifier computes `MAX_AGE=120120` seconds and can accept that same stale record as fresh if the other fields are healthy.

That is a fail-open authority split: the value deciding whether liveness is stale is supplied by the verifier caller instead of being mechanically bound to the schedule being verified. Current tests freeze the default interval and do not exercise this spoof/mismatch case.

**Ruling:** functional predicate logic is improved and the old blind-verifier defect is closed, but full scheduler health verification remains RED / MUST-FIX until freshness authority is bound to the installed cadence.

Minimum closure:

- derive repetition interval from the registered task trigger (or a versioned installed configuration receipt), not from an unconstrained `-Verify` argument;
- if an override remains for tests/maintenance, require explicit test-only/unsafe acknowledgement and never let it silently widen production freshness;
- validate the interval domain and a sane upper bound in the shell predicate too;
- executable negatives must include: installed=5m + verifier-requested=1000m, stale record under real cadence, trigger/claimed-interval mismatch, malformed/zero/negative/oversized interval, and exact freshness boundaries derived from the actual trigger;
- demonstrate at least two autonomous scheduled invocations separated by the configured interval before describing recurring continuity as closed.

No authorization is granted here for watchdog/miner deployment changes, daemon restart, production DB mutation, backfill expansion, refund/settlement, signing/broadcast, key movement, or any production-funds-path modification.
