# Codex review — unsynced RPC degradation and supervisor health evidence

## Git basis

- Last processed bridge commit: `702d5aac612b492df559418be31cc56b4865c702`
- Incoming `coord/codex-bridge`: identical to the last processed commit; no canonical-file diff.
- Incoming canonical blobs:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Active branch baseline: `81f2a53fb38c6c6c27a258f81e6d54b23e1069e3`
- Active branch current HEAD: `015f3de9e3b2bf9997f647349004b7a1a0e10d43`
- Active compare: ahead by 2 commits; actual changed path is only `docs/iteration/COORD-LEDGER.md` (+100/-0), current blob `7a8a9894bd403dd670489d59208dd705d22446d3`.

No file timestamp or self-reported update field was used for increment detection.

## Verdict

`COORDINATION_EVIDENCE_ACCEPTED_WITH_CORRECTIONS__RPC_LIVENESS_P0_OPEN__NO_RUNTIME_FIX_SUBMITTED`

This increment is coordination/incident evidence only. It contains no runtime source change, no test harness change and no deployment package.

## Independent findings

### 1. HTTP health is not an adequate money-path liveness signal

The ledger reports one failure mode in which `/health` remained fast and HTTP 200 while Console RPC functionality was unavailable, and a later failure mode in which HTTP became intermittently unavailable. These two observations are internally consistent with the conclusion that an HTTP-only supervisor is structurally blind to at least one RPC-degraded state.

A recovery acceptance test must call the actual capability being protected: make a bounded `getBlockDagInfo` or equivalent read-only RPC through the same Console-side client/path used by settlement, and require a valid result within a fixed deadline. TCP connection count, port reachability and `/health` are diagnostics only, not acceptance criteria.

### 2. `kaspad connection count > 0` is correctly withdrawn

A live socket can coexist with a broken application-level RPC session. Therefore `connections_to_kaspad > 0` must not be used as a GREEN criterion. The correct criterion is successful application-level RPC plus a fresh result.

### 3. The two observed degradations are not yet proven to share one root cause

The reported dimensions differ materially: connection counts, HTTP behavior, error text, failure frequency and RSS. A similar uptime interval is not enough to merge them into one incident class. Record each future onset with at least:

- process start/boot identity;
- exact first error class and stack/call site;
- HTTP probe series with latency;
- real RPC probe result and latency;
- active Console-to-kaspad sockets;
- process RSS/heap/external/arrayBuffers;
- kaspa-wasm version and relevant client identity.

Only merge incidents after a shared mechanism is evidenced.

### 4. The wasm detached-DataView theory remains a hypothesis

`Offset is outside the bounds of the DataView` is compatible with stale views after WebAssembly memory growth, but the ledger does not yet identify a cached `DataView`/`ArrayBuffer` owner or measure wasm memory growth. Do not promote this to root cause.

The cheapest discriminating checks are:

1. inspect the exact failing stack/call site for cached views or long-lived decoder state;
2. record `memory.buffer.byteLength` or the closest available wasm memory metric over time;
3. prove whether the view/buffer identity changes before the first failure;
4. compare against a fresh client in the same process, not only a fresh external process.

### 5. Post-restart rolling-window alert contamination is a real design defect

A new process must not inherit old-process failure rows as if they were its current failure burst. Bind alerts to a process/runtime epoch or apply `observed_at >= process_started_at` in addition to the rolling window. The event should include the process/runtime identity used for the count.

### 6. Pre-action revalidation is required

Before any restart action, re-run the real RPC probe and verify the current port owner/process epoch. If recovery already occurred or the process was replaced, stop the restart plan. This prevents a stale authorization sequence from causing a second unnecessary restart.

## Minimal next source increment

Submit one small implementation package containing only:

1. a bounded real-RPC supervisor probe using the same effective client/path as money operations;
2. consecutive-failure hysteresis and explicit reason codes;
3. process-epoch-scoped rolling-window alerts;
4. incident evidence fields listed above;
5. tests for:
   - HTTP 200 + RPC failure => unhealthy;
   - socket present + RPC failure => unhealthy;
   - transient single RPC failure => no restart;
   - threshold reached => one restart action only;
   - old-process rows after restart => no duplicate alert;
   - recovered/replaced process before action => stale restart cancelled.

A periodic preventive restart is not accepted as a root-cause fix. It may only be considered as an explicitly bounded temporary containment under separate operational authority after checking in-flight work.

## Authority boundary

This review does not authorize production restart, supervisor deployment, process termination, env/config change, database mutation, settlement, refund, signing, broadcast or funds movement.