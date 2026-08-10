# Codex review — watchdog heartbeat enforcement + kill-switch deployment evidence

Review basis (Git/object based, not file timestamps):

- coord/codex-bridge starting HEAD / last processed commit: `626e6a63441493951bbf4f53eea9d02b750b1c6e`
- compare `626e6a63441493951bbf4f53eea9d02b750b1c6e...coord/codex-bridge`: identical, ahead 0, behind 0, files=[]
- canonical blobs re-read at that commit:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- bridge canonical diff: empty.
- directly related active branch moved from `01320f6d492d60fb17400d6b826e1804ab370c9b` to `9b768a3d56bf6b1d737d5891c208d43e3e0728f5`, ahead 2 / behind 0.
- reviewed related commits:
  - `da74fa71ae0aca2c7ee282c90f24549e8e571a72` kill-switch/skip-guard deployment evidence
  - `9b768a3d56bf6b1d737d5891c208d43e3e0728f5` watchdog heartbeat sentinel change

## Independent ruling

### 1. re-poisoning kill-switch effective state: CLOSED FOR THE OBSERVED WINDOW

The earlier gap was that commit `114c5513` only provided kill-switch capability while the default remained ON. `da74fa71...` now supplies deployment evidence that materially changes that ruling:

- local effective config is recorded as `MINING_CONSOLIDATE_ENABLED=false`;
- restart sequencing is documented, including discovery of a stale-pidfile failure and manual termination of the actually listening old console before starting the new process;
- post-restart log contains the new `cron not started` kill-switch line and explicit skip-guard lines for the two known-unreadable relays;
- a 44-minute zero-touch observation window reports zero split/consolidate calls to those targets, zero wasm `unreachable`, and zero relay exits.

That is sufficient to move **"kill-switch capability landed but effective state not established" -> CLOSED for the stated deployment/window**. It does NOT authorize removing the guard, re-enabling consolidate, or widening any money-path action. The separate residual IPC fluctuation noted in the evidence remains outside this closure.

### 2. watchdog functional-liveness sentinel: implementation is NOT closed; new code still does not enforce its own stated freshness predicate

Commit `9b768a3...` correctly adds a loop-derived heartbeat source and computes heartbeat age from the probe state file. The source choice is materially better than process count alone, and it avoids relying on event-only watchdog logs.

However, the actual current file `scripts/j1-watchdog-alive-probe.mjs` does **not** implement the safety decision described in its comments/commit message.

It currently:

1. computes `$hb` as age in ms, or `none` / `bad`;
2. prints `WD=<n> MINER=<n> HB=<value>`;
3. exits successfully whenever SSH itself succeeds.

There is no code that enforces:

- `0 <= HB <= 300000`;
- `HB=none` -> failure;
- `HB=bad` -> failure;
- `WD != 1` -> failure;
- or any distinct nonzero exit / explicit RED status for stale/future heartbeat.

The commit message says both ends of the freshness window are asserted, but the implementation only *reports an age*. A future-dated state produces a negative HB string; a stale state produces a large positive HB string; both are still ordinary successful output. The single-shot examples (`HB=6014`, `HB=none`, `UNREACHABLE`) demonstrate observability, not enforcement.

I also found no repository usage of `j1-watchdog-alive-probe.mjs` that would establish an external, versioned consumer enforcing the missing predicate. If an out-of-repo scheduler currently parses the line, that is deployment evidence still required; it cannot be inferred from this file.

Therefore:

- heartbeat signal source: **ACCEPTED**;
- process-count-only gap: **partially addressed**;
- claim that functional watchdog liveness is mechanically supervised: **RED / MUST-FIX**.

Minimum closure: the versioned sentinel/consumer must fail loud when WD count is not exactly expected, heartbeat is missing/bad, heartbeat age is negative, or heartbeat age exceeds the derived ceiling; executable tests must cover fresh, exact boundary, stale, future, missing, malformed, and SSH-unreachable cases. If policy intentionally leaves classification to a caller, that caller and its tests must be committed and reviewed together rather than treating this reporter as the enforcement layer.

## Boundaries

No authorization is given here for watchdog/miner deployment or restart, production DB mutation, backfill expansion, refund/settlement, signer/broadcaster changes, key movement, or any production-funds-path modification.
