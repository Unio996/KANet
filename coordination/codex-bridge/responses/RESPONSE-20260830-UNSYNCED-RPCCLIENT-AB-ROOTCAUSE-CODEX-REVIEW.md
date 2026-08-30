# Codex review — unsynced RpcClient A/B / root-cause evidence

## Git/bridge baseline

- Canonical branch checked first: `coord/codex-bridge`
- Last processed / written baseline: `12f53b0cc7051bd3a6d0232f2679885198e4dd29`
- Current canonical HEAD before this response: `12f53b0cc7051bd3a6d0232f2679885198e4dd29`
- Actual Git compare: identical; ahead 0; behind 0; files `[]`.
- Canonical blobs re-read from that Git object:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No canonical bridge increment existed, so the directly related active branch was checked.

## Unsynced active-branch delta

- Branch: `bshard-m3-deploy`
- Previous relevant checkpoint: `5328b610085e542a915de891ff44b7ee56c34405`
- Current HEAD reviewed: `1ec3b1979290afcedc8491830fc68d8bb8a81505`
- Actual compare: ahead 2, behind 0.
- Load-bearing evidence commit: `014cec5a52078d653efbb7846bb6351fb04eb76e`.
- Evidence reviewed independently includes:
  - `docs/provenance/2026-08-30-console-wasm-growth/RESULTS.md` blob `eeb429eea11127fef8e2f9c2854fe3d01b97d19e`
  - `wasm_rpcclient_free.mjs` blob `37033c17d65943d6a80d012e7f6fc92d59807f06`
  - `wasm_shared_vs_percall.mjs` blob `d103a3bd25686ba538b02e17e1b9886794215e69`
  - updated singleton design and diagnosis in `014cec5a...`.

## Independent ruling

### 1. Repeated per-call `RpcClient` construction as a dominant wasm-growth trigger: ACCEPTED

The evidence is now materially stronger than the earlier correlation-only case.

- The live IBD-gated treatment instance drops from the prior ~0.39–0.55 GB/h range to ~0.042 GB/h while eliminating preprune scans, which supports preprune as the dominant high-volume carrier.
- The residual ~10 MB / ~14 min steps align in magnitude with ~602 per-tick `RpcClient` constructions.
- The isolation scripts reproduce monotonic linear-memory growth from repeated construction even without `connect()`, and `free()` / GC do not prevent the observed high-water increase.
- Most importantly, the 1000-operation direct control reports ~+17.44 MB for per-call construction versus ~+0.19 MB for one shared instance. That directly supports the engineering choice to remove per-call construction.

Therefore the earlier hypothesis can be upgraded: **per-call `RpcClient` construction is a demonstrated dominant allocation/growth pattern and shared-instance reuse is the correct mitigation direction.**

### 2. Exact claim “constructor-level permanent live-object memory leak”: NOT YET PROVEN AS STATED

The current measurements observe wasm linear-memory *high-water growth*. In wasm32, `memory.buffer.byteLength` generally does not shrink when allocator objects are freed. Therefore `disconnect()/free()/GC` failing to reduce `memory.buffer.byteLength` does not by itself prove the objects remain live or unreachable memory is permanently leaked.

Repeated +1.0–1.75 MB growth across construction cycles is strong evidence of allocator non-reuse / fragmentation / retained native state associated with construction, and it is sufficient to justify the singleton mitigation. But the narrower causal label “constructor object is permanently leaked” requires one of:

1. allocator/live-allocation instrumentation showing the allocations remain live after `free()`, or
2. a reuse/control experiment demonstrating freed constructor allocations cannot be reused by equivalent subsequent allocations while a non-constructor allocation control can reuse the same arena, or
3. upstream/runtime evidence identifying the retained allocation path.

Until then, use the mechanically supported wording: **constructor-associated wasm linear-memory growth / non-reuse**, not a fully closed live-object leak mechanism.

This distinction does not weaken the operational fix.

### 3. Shared singleton batch remains HOLD until the previously identified lifecycle invariant is fixed

The new A/B evidence strengthens the need for shared reuse, but it does not close the prior code-level timeout race in the shared implementation/design:

`Promise.race([rpc.connect(), timeout])` does not cancel the losing `rpc.connect()` promise. Clearing `connecting` on timeout can permit a second connect attempt while the original one is still pending and may resolve later.

Before merge/deployment, the shared module must prove:

- timeout cannot allow overlapping connect attempts on one instance;
- a late-resolving first connect is fully serialized/settled before another connect starts;
- the regression specifically waits past the original delayed connect resolution and asserts the final connection/resource state;
- `errCount` implements **consecutive** failures, resetting on successful reconnect/use, rather than lifetime cumulative failures.

The new constructor-growth evidence makes this lifecycle correctness requirement more important, not less: the singleton becomes a process-wide shared fault domain.

### 4. Money-path boundary unchanged

The proposed batch-2 migration includes bet acceptance, settlement, delivery/UTXO checks, oracle stake settlement and other production money-path readers. This review does **not** authorize those migrations, signing, broadcast, settlement/refund changes, deployment, restart, DB mutation, key movement, or any production funds-path modification.

## Current state

- preprune IBD gate / main-carrier finding: **SUPPORTED**.
- per-call `RpcClient` construction as dominant residual growth trigger: **SUPPORTED / upgraded**.
- shared-instance reuse as mitigation direction: **PASS direction**.
- exact “permanent live-object constructor leak” mechanism: **OPEN; wording must be narrowed unless allocator/runtime evidence closes it**.
- shared RPC late-resolve/overlapping-connect lifecycle: **OPEN / MUST-FIX before merge/deploy**.
- `errCount` consecutive-failure semantics: **OPEN / MUST-FIX**.
- autonomous SYSTEM restart authority binding: **still OPEN / MUST-FIX**; this evidence does not change it.
- READY authority after lifecycle events: **fresh real-time dual-signal only; no inherited READY**.
- gate-(a) deployed-path closure: **OPEN**.
- final-tx fee/mass post-construction invariant: **OPEN / MUST-FIX before broadcast**.
- production recovery / funds-path wiring: **HOLD**.
