# Codex independent review — unsynced third RPC degradation incident

## Verdict

`THIRD_INCIDENT_EVIDENCE_ACCEPTED_WITH_CORRECTIONS__UPTIME_TREND_REJECTED__RSS_CORRELATION_NOT_ROOT_CAUSE__REAL_RPC_SUPERVISOR_GATE_STILL_REQUIRED`

## Git basis

- Last processed / written bridge commit: `cc7c7afb8fe62e93bb519a288e36bf60441b0cca`
- `coord/codex-bridge` at review start: identical to that commit (`ahead=0`, `behind=0`)
- Active branch reviewed: `bshard-m3-deploy`
- Previous active cursor: `015f3de9e3b2bf9997f647349004b7a1a0e10d43`
- Current active HEAD: `897aab1fa97b7b42f81c0cf71c8cce6bebb52894`
- Compare: one commit ahead; only `docs/iteration/COORD-LEDGER.md` changed (`+78/-0`)
- Current ledger blob: `5fe446b80d81fa119694f5c13ceb31c57995d0ca`

Canonical bridge blobs at review start:

- `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`

No file-reported timestamp was used for increment detection.

## Independent judgment

### 1. The shrinking-uptime prediction is falsified

The reported sequence `8h → 5h00m → 5h00m → 4h44m → 9h03m` is incompatible with the previously proposed monotonic-shortening model. The correction is valid: future incident hypotheses must include outcomes on both sides of the predicted window, not only “earlier” and “inside window”.

### 2. Stable high RSS is a correlation and a trigger candidate, not yet “the ruler” or root cause

The three reported incident RSS values cluster around roughly 4.4–4.8 GB, while uptime varies materially. That makes RSS/heap/external-memory state a stronger discriminator than uptime, but it does **not** prove any of the following:

- a fixed memory threshold causes degradation;
- V8 old-space is at or near its effective limit;
- wasm linear-memory growth occurred immediately before failure;
- a cached `DataView` was detached or made stale;
- raising `--max-old-space-size` would prevent the incident.

Process RSS includes heap, native allocations, wasm linear memory, mapped pages and other external memory. A narrow RSS band at failure can be produced by several different mechanisms. Therefore the correct status is:

`MEMORY_DIRECTION_PLAUSIBLE__THRESHOLD_AND_MECHANISM_UNPROVEN`

The next incident must capture, before restart and on the same process epoch:

1. `rss`, `heapTotal`, `heapUsed`, `external`, `arrayBuffers`;
2. wasm `memory.buffer.byteLength` and, where technically possible, buffer identity/generation;
3. the first failing RPC call stack and operation name;
4. repeated samples spanning healthy → onset → degraded;
5. process start identity and exact code/runtime versions.

Only a time-aligned transition can distinguish a threshold mechanism from a stable consequence of the degraded state.

### 3. The “storm” is not a required property of the underlying failure

Incident #5 and #6 reportedly share `DataView` text and one kaspad connection but differ dramatically in failure rate and HTTP behavior. It is therefore reasonable to separate:

- the underlying RPC/client degradation; and
- amplification by one or more callers/retry loops.

However, “the difference is on the caller side” is still an inference. It must be demonstrated by per-call-site evidence rather than by the aggregate event rate alone.

The next instrumentation should attach at least:

- `caller_id` / operation name;
- process epoch;
- attempt number;
- elapsed time;
- error class/message;
- whether a fresh or cached RPC selection/client was used.

Then compare #5-like and #6-like periods by caller distribution.

### 4. `getWorkingRpc()` cannot itself be the supervisor GREEN criterion

Current `rpc-health.js` independently confirms several important limitations:

- a successful result is cached for five minutes and can be returned without a fresh probe;
- configured nodes are accepted by TCP reachability only;
- local validation creates a fresh client and performs `getBlockDagInfo()`, but only on cache miss;
- therefore `getWorkingRpc()` returning a URL is not equivalent to the money-path RPC being usable at that moment.

The supervisor must invoke a bounded, actual read-only RPC through the same effective client/path used by settlement, not merely call `getWorkingRpc()`, inspect sockets, or read `/health`.

Minimum state machine:

- bounded real RPC probe;
- consecutive-failure hysteresis;
- process-epoch-scoped counters and alerts;
- one restart action per incident epoch;
- immediately before kill/restart, re-read the actual port owner and run one final real RPC probe;
- cancel the stale action if the owner changed or RPC recovered.

### 5. The command-race lesson should become an execution protocol, not only a retrospective note

The reported sequence — irreversible kill initiated after an “execute without asking” instruction, followed by a correction that arrived too late — shows a control-plane race.

For destructive or restart actions, the protocol should require an atomic-looking final gate containing:

- instruction/version identifier;
- target process identity and port owner;
- last-channel-read cursor or commit/message id;
- fresh failure confirmation;
- explicit cancellation check immediately before the irreversible step.

Moving the irreversible step later is useful, but without a versioned final gate the same race can recur.

## What is accepted

- The uptime-shortening model is rejected.
- Incident #6 is materially different from #5 at the observable level.
- `/health` and connection-count checks are insufficient.
- A real RPC check after restart is the correct recovery proof.
- Changing heap limits during an emergency restart would confound recovery with experimentation and must remain separately reviewed.

## What remains open

- Exact degradation mechanism.
- Whether RSS is cause, threshold indicator or consequence.
- Whether wasm memory growth/stale view is involved.
- Which caller(s) amplified incident #5.
- Supervisor source implementation and tests.
- Process-epoch isolation for rolling alerts.

## Required next source increment

1. Real RPC supervisor probe with timeout and hysteresis.
2. Process-epoch-scoped alert accounting.
3. Final pre-action revalidation and stale-action cancellation.
4. Per-call-site RPC failure attribution.
5. Memory/wasm telemetry sufficient to test, not merely restate, the DataView hypothesis.
6. Tests for HTTP-healthy/RPC-dead, cached-URL/RPC-dead, transient failure, sustained failure, old-epoch evidence, recovered-before-action and changed-port-owner cases.

No production restart, heap-limit change, process termination, deployment, signing, broadcasting, settlement, refund or funds movement is authorized by this review.
