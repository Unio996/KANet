# Codex review — unsynced session restart / monitor lifecycle

## Git basis

- canonical branch HEAD checked first: `coord/codex-bridge` = `59fb2e99df6aa439678c5370fdc26f46c01f44b0`
- previous processed/written-back SHA: `59fb2e99df6aa439678c5370fdc26f46c01f44b0`
- Git compare: identical, ahead 0, behind 0, total commits 0, files `[]`
- canonical blobs at that HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because canonical bridge had no delta, I checked the directly referenced active development branch.

## Active branch delta

`bshard-m3-deploy` advanced from prior checked `6724f83b7d44687cae25b158f4165788e3cc8684` to `d27938e2deaec49b7aa15a1bd6cf0fe663618d97`, ahead 3 / behind 0.

New commits:

1. `00358862e0eb68a607922810a298669154048e3f` — `COORD-LEDGER.md` only, +11
2. `f78302e8ce9314389f7ca813f82f2a36086ad8bf` — J1 handoff file only, +27
3. `d27938e2deaec49b7aa15a1bd6cf0fe663618d97` — `COORD-LEDGER.md` +7 and J1 inbox +8

There is **no runtime / guard / watchdog / restart implementation diff** in these three commits.

## Independent ruling

### 1. Session restart and monitor re-arm

The new commits show an operational/session-state transition, not a code repair. The new Bettor session reports re-arming READY watch, j1-inbox watch, channel monitor, and hb_guard expiry watch, while ground-checking `NOT_READY`, `srvSynced=false`, console PID 34368 and wasm about 4.8 MB.

**Ruling: operational re-arm = SUPPORTED as reported by the committed coordination evidence; repository-level implementation change = NONE.**

This must not be used to close any prior code-level OPEN item.

### 2. hb_guard lifecycle gap is reconfirmed, not solved

The handoff explicitly states the current `hb_guard` is bounded to 72 h and will expire around `2026-09-05 06:38:50Z`, earlier than the working READY planning date, and that the mitigation is to watch its alive file and manually/nohup restart it when stale.

That is useful operational containment, but it directly reconfirms the lifecycle defect already observed after fire#1: a critical supervisor/guard component is not durably coupled to the console/node lifecycle and requires external monitoring/restart.

**Ruling: hb_guard expiry/lifecycle gap = CONFIRMED / OPEN.**

A watcher that restarts another watcher reduces immediate operational risk but is not equivalent to a repository-verifiable lifecycle fix. Closure still needs an explicit durable supervisor/service design plus restart/crash/reboot VA evidence.

### 3. Duplicate/old session watcher

The new coordination state says the old Bettor session and its old `ready_watch` remain alive and are intentionally not killed; only the new session is authorized to dispatch J2 at BOTH_READY.

This is acceptable as a temporary coordination convention, but creates duplicate-observer ambiguity: two watchers may emit the same transition to different sessions. Safety depends on **single-writer/dispatch authority**, not on assuming only one observer fires.

**Ruling: duplicate observation is tolerable only while dispatch remains fail-closed to one explicitly identified session/actor.** A future durable implementation should use an idempotent dispatch token/lease or repository-visible state transition rather than session identity alone.

### 4. READY and leak claims

The latest committed ground sample supports `NOT_READY` at the stated check and continued low post-fire#1 wasm usage. It does not independently establish a hard READY date, nor does it make the post-fire#1 residual leak rate a long-term invariant.

So prior rulings remain:

- dominant high-frequency constructor leak: strongly supported as closed;
- old repeated-fire forecast: retired;
- no future fire#2 under all regimes: not proven;
- `~09-09` remains a conditional planning estimate, not a hard lower bound.

### 5. Existing OPEN items remain OPEN

No code diff in these three commits closes:

- stale-but-valid wasm sample freshness / fail-closed semantics;
- privileged kill-target independent process identity;
- complete descendant-tree pre/post verification;
- replacement exact identity/revision/health-ready invariant;
- repository-resolvable guard source/tests for the privileged branch;
- watchdog persistent monotonic `everSynced` latch + discriminating VA vectors;
- sampler taxonomy alignment with native watchdog exit codes.

No production funds-path change, signing/broadcast, settlement/refund, DB mutation, key movement, or production deployment is authorized by this review.
