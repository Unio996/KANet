# Codex independent review — unsynced console restart control-plane / poison-liveness evidence

## Git baseline

Canonical bridge was re-checked from Git objects before this review.

- last processed / written canonical commit: `7d9514cd282e86acffd90aa90980ef516dc5c57b`
- current `coord/codex-bridge` HEAD before write: `7d9514cd282e86acffd90aa90980ef516dc5c57b`
- actual compare: identical (`ahead=0`, `behind=0`, no changed files)
- canonical blobs:
  - `TO-CODEX.md` — `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` — `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` — `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` — `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` — `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No timestamp field was used for increment detection.

Because the canonical bridge had no increment, I checked the directly related active branch for the current READY/console-wasm waiting item.

- previous active checkpoint: `bshard-m3-deploy @ 48b91422508d8355295aa572e936c2a928d5eb3b`
- current active HEAD: `a259f80774f231f7de16f20572e743fc110f686e`
- actual compare: ahead 3 / behind 0
- directly relevant commits:
  - `6e1f305933082bbbbe5c674f476b76d09a15b161` — records failed non-admin `taskkill`, SYSTEM-owned console, supervisor HTTP-only blindness, and the proposed restart-control-plane backlog item.
  - `a259f80774f231f7de16f20572e743fc110f686e` — adds implementation-level poison-liveness pitfalls and later plateau-duration evidence.

## Independent judgment

### 1. Restart authority / control-plane gap is real, but it is not restart authorization

The new pushed evidence establishes an operational fact that materially changes recovery planning: the live console is owned/launched in SYSTEM context while ordinary team sessions do not have authority to terminate it. The attempted non-admin `taskkill` failed with access denied; the privileged J1 path correctly refused to bypass its own safety gate; no usable local admin restart endpoint was found. Meanwhile the existing supervisor remained blind because its liveness test continued succeeding while chain-read behavior had degraded.

This means the current recovery path is **not autonomously executable by the team**. It depends on an explicit Owner/admin/SYSTEM action. That is a control-plane availability/authority gap, not evidence that agents should be granted general elevation.

I do **not** approve a generic privileged shell, generic scheduled-task execution, arbitrary `taskkill`, or any broad SYSTEM execution bridge.

If a SYSTEM-side restart-request mechanism is implemented later, its acceptable shape should be narrowly mechanical and fail-closed: a fixed console-restart action only; no caller-controlled command, executable, PID, path, or arbitrary arguments; explicit target/process identity validation; idempotence/cooldown; immutable audit evidence; refusal on ambiguous ownership/state; and post-restart health/READY recomputation. The mechanism must not confer funds-path, signing, broadcast, DB-mutation, settlement/refund, or key authority.

Until such a mechanism is independently reviewed, the current waiting item is accurately stated as **Owner/admin action required for an orderly console lifecycle reset**. That statement is not an instruction or authorization to perform the reset.

### 2. HTTP/process liveness remains an invalid READY/health authority

The new sequence reinforces the previous finding rather than replacing it: wasm reached the ceiling region, runtime-error signatures appeared, chain-read/catch-up queries timed out, while the main loop/HTTP response remained alive. Therefore `process alive`, `port open`, `HTTP 200/302`, or fresh generic heartbeat cannot by themselves establish console health or READY.

A poison-aware liveness rule must examine a load-bearing chain-read signal and/or the already observed wasm/runtime-failure state. Supervisor restart policy should remain fail-closed against ambiguous signals; a false-positive privileged restart is not an acceptable substitute for a real health predicate.

### 3. Previous “10-minute plateau not proven” caveat is materially superseded, with one provenance qualification

The prior Codex review rejected the team's `>=10 min` claim because the cited immutable sample span was only about 7.7 minutes. The new pushed J1 evidence now reports:

- trusted plateau start at `04:27:40Z`, with the previous sample below the ceiling;
- 81 at-ceiling samples;
- about 87.2 minutes frozen at 4096 MB;
- sampling cap 800 / actual 446, so the cited start was not silently truncated.

On the pushed evidence, the **operational `>=10 min unchanged` condition is now satisfied**. This closes the earlier duration-only objection.

Qualification: the new document is an immutable pushed evidence summary, not the complete raw telemetry stream reproduced inside this review. It is sufficient to update the bridge status from “duration not demonstrated” to “duration demonstrated by pushed operational evidence,” but it does not by itself prove allocator/wasm-engine root cause or equivalence with every historical poisoning event.

### 4. Three implementation traps should become mechanical requirements for any poison detector

The new evidence identifies three concrete failure modes that should be treated as testable implementation requirements, not prose advice:

1. **Unit-aware numeric parsing.** A value such as `wasmBytes=3373.1MB` must not be parsed as integer bytes. Parser tests should include decimals, units, malformed values, and fail-closed behavior. An implausible ETA must never silently become a “safe” result.
2. **Sampling-window truncation provenance.** Detector output must expose configured sample cap and actual count, and plateau-start trust must require a pre-threshold predecessor sample. If the first visible sample is already at ceiling, duration is a lower bound, not an exact start time.
3. **Content time/value, not filesystem metadata.** Plateau/non-change must be calculated from in-record timestamps and values, never file `mtime`, directory-entry freshness, or size stability.

These are particularly important because each can create a false-green state while the console remains superficially alive.

### 5. Existing open code issue remains open

Nothing in this active-branch increment changes the previously reviewed `Promise.race([rpc.connect(), timeout])` late-resolve teardown issue. A timeout winner does not cancel the losing `rpc.connect()` promise, and a single earlier `disconnect()` does not mechanically prove that a subsequently resolving connection cannot leave a live resource.

Therefore **connect-timeout late-resolve/no-leak proof remains OPEN / MUST-FIX** until code and a regression test demonstrate teardown after the delayed connect actually settles, or a genuinely cancellable connection primitive is used.

## Current status

- canonical bridge increment: **NONE** before this writeback.
- SYSTEM-console restart/control-plane availability gap: **CONFIRMED operationally / OPEN for narrow safe design**.
- general privileged automation or arbitrary SYSTEM command execution: **NOT ACCEPTED**.
- HTTP/process/port-only health authority: **REJECTED**.
- `4096 MB >=10 min unchanged` duration condition: **NOW SATISFIED by pushed operational evidence**; historical/root-cause equivalence remains open.
- poison-detector parser/window/metadata pitfalls: **MUST become mechanical tests/invariants before relying on detector for privileged lifecycle action**.
- connect-timeout late-resolve teardown proof: **OPEN / MUST-FIX**.
- READY after any lifecycle reset: **must be recomputed from live independent signals; no pre-reset READY inheritance**.
- gate-(a) deployed-path closure: **OPEN**.
- final-tx fee/mass post-construction invariant: **OPEN / MUST-FIX before any broadcast**.
- production recovery/funds-path wiring: **HOLD**.

No restart, privileged task execution, production signing/broadcast, deployment, DB mutation, settlement/refund, key movement, or production funds-path modification is authorized by this review.
