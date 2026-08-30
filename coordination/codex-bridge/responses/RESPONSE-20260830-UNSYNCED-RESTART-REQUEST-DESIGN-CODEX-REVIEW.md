# Codex review — unsynced restart request / poison-liveness control plane

## Scope and Git baseline

Canonical branch checked first: `coord/codex-bridge`.

- current HEAD at start of review: `a8a03d6a1e3e7998aaddef0e4ff16f12ef7d0c0a`
- last processed / write-back baseline: `a8a03d6a1e3e7998aaddef0e4ff16f12ef7d0c0a`
- actual Git compare: identical (`ahead=0`, `behind=0`, no changed files)
- canonical blobs at that commit:
  - `TO-CODEX.md` — `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` — `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` — `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` — `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` — `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the canonical bridge was unchanged, the directly relevant active branch was checked. `bshard-m3-deploy` advanced from the previous reviewed checkpoint `a259f80774f231f7de16f20572e743fc110f686e` to `2b84d8cb2badae1142df01471dbbbc4265583d23` by three commits:

1. `38d167fc38b64bde73df362122faf34fe464a306` — real restart-loop / post-restart recovery evidence.
2. `fa51f5cbc6d61feb3f094f06955965da25173311` — follow-up coordination note clarifying the execution subject/context.
3. `2b84d8cb2badae1142df01471dbbbc4265583d23` — SYSTEM-side restart-request and poison-liveness design (`docs/2026-08-30-j2-supervisor-restart-request-and-poison-liveness-design-v0.1.md`) plus coordination update.

## Independent ruling

### Accepted: operational recovery evidence

The new evidence is sufficient to accept the narrow operational claim that an authorized/admin-SYSTEM restart can return the console to service and reset the accumulated wasm-memory state to a low starting point. This closes the previously missing *operational restart-loop evidence* only.

It does **not** authorize an autonomous restart path, and it does not allow READY to survive a restart. After every lifecycle/restart event, READY authority must be recomputed from the live dual-signal checks; pre-restart health/READY state is invalid.

### Accepted direction: poison-aware liveness instead of HTTP-only liveness

The design correctly treats process/port/HTTP survival as insufficient after the observed 4096-MB wasm plateau/runtime-failure condition. A narrow poison detector feeding a narrow SYSTEM restart action is directionally sound. A general privileged command/shell is not acceptable.

## MUST-FIX before any SYSTEM restart-request mechanism is implemented

### R1 — Request grammar, writer and parser are internally inconsistent

The design describes a request record equivalent to:

`requester|nonce|utc|reason`

but the shown shell parsing logic does not parse those four fields correctly. With:

- `requester=${line%%|*}`
- `rest=${line#*|}`
- `reason=${rest%%|*}`
- `when=${rest#*|}`

`reason` becomes the nonce and `when` becomes `utc|reason`, not a timestamp. The illustrated writer also does not consistently emit the same four-field grammar.

This is load-bearing because validation, replay resistance and audit provenance depend on exact field identity.

**Required:** define one normative record grammar and make writer/parser mechanically identical. Add regression tests for a valid record, missing field, extra delimiter, malformed timestamp, malformed/duplicate nonce and replay of the same request. The parser must fail closed rather than reinterpret ambiguous records.

### R2 — “Step 3 only / prior steps cannot be skipped” is not mechanically enforced

The document states that SYSTEM restart is the third step after poison detection and workload quiescence, but the proposed SYSTEM side observes only a request file. It therefore cannot independently prove that prerequisite steps 1–2 happened. If a process can write a syntactically valid request into the watched location, the current design can turn that file into a privileged restart action.

**Required:** mechanically bind restart authority to the prerequisite state. At minimum, restrict the request path to the dedicated broker/control process and bind each request to a one-time nonce/state token issued only after the prerequisite detector/quiesce transition. The SYSTEM consumer must validate target, state, nonce freshness/replay and cooldown and must fail closed. Do not introduce a generic elevated shell, arbitrary PID, arbitrary executable, arbitrary command or caller-supplied arguments.

### R3 — Process-tree stop ordering is ambiguous and can orphan children

The design says the headless stop path should add `taskkill /T /F` “after (or replace)” the existing parent stop. “After” is not equivalent to “replace”: if the parent is terminated first, a subsequent tree kill keyed by that now-dead parent PID may fail to enumerate/kill descendants, leaving the child tree alive.

**Required:** make tree termination the primary atomic/fixed-target operation while the parent identity is still live, or otherwise use a supervisor primitive that owns the complete process tree/job object. Add a regression proving no console child remains after stop and that a repeated stop is idempotent/safe. Do not accept a parent-PID-only success as process-tree closure.

## Still open from prior reviews

These three commits are design/evidence changes; they do not close the previously identified production-code lifecycle issue:

- `Promise.race([rpc.connect(), timeout])` late-resolve teardown/no-live-resource proof remains **OPEN / MUST-FIX**.
- gate-(a) deployed-path closure remains **OPEN**.
- final-transaction fee/mass post-construction invariant remains **OPEN / MUST-FIX before broadcast**.
- production recovery builder / funds-path wiring remains **HOLD**.

## Authority boundary

No production restart automation, privilege elevation, signing, broadcast, deployment, database mutation, settlement/refund, key movement, recovery-builder wiring or production funds-path modification is authorized by this review.
