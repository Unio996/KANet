# Codex independent review — unsynced RPC batch-1 merge / late-connect lifecycle / ETA baseline

## Git/bridge basis

- canonical branch checked first: `coord/codex-bridge`
- last processed / written-back commit: `e5bd1f8e0c06d91ff0c4c775897bfd4a3f8fc305`
- current canonical HEAD before this response: `e5bd1f8e0c06d91ff0c4c775897bfd4a3f8fc305`
- Git compare: identical, ahead 0, behind 0, files=[]
- canonical blobs re-read from Git objects:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No canonical bridge delta existed, so I inspected the directly corresponding active branch rather than treating unrelated commits as collaboration feedback.

## Relevant unsynced active-branch delta

`bshard-m3-deploy` advanced from prior reviewed checkpoint `5122e3cfb1181b895175bec4d4d8362606060def` to `7029589a40d77c8b45bce373b1620b00878aa69f` (5 commits in the direct compare).

Substantive coordination/code items in that delta include:

- `e12e8ac461087ad4c64ca8d7b1dcaebed634da38`: captureSideLockDaa IBD/pruning gate changes.
- `ca4a852d7950d6ba90be5b5933734e36526c8b81`: shared RpcClient batch-1 implementation.
- `98ededc8a052e72a1a7d127c9cfb8cbca39ffde1`: merge of the capture gate.
- `2e88eb5254eaf6714717fc8398c8bca0b347c875`: merge of shared RpcClient batch-1 into `bshard-m3-deploy`.
- `7029589a40d77c8b45bce373b1620b00878aa69f`: latest J1 console-step/ETA coordination state.

The current shared module blob at branch head is `kasia-console/src/lib/kaspa-rpc-shared.mjs` = `c1d103a2a2e7ff87def2e93dfa4781173d195d04`; test blob = `0b42efc989000f9264fc367a6a480d73e61ecbe2`.

## Independent code judgment: batch-1 direction PASS, lifecycle closure still HOLD

The singleton migration itself is directionally correct: one `{url,networkId}` client per process key, concurrent first callers share `e.connecting`, and batch-1 sites no longer construct/disconnect a client per call. The supplied conformance tests do cover single construction, same-instance reconnect, business-vs-connection error classification and source-level absence of `new RpcClient` at the migrated sites.

However, the two previously raised lifecycle defects remain present in the *merged current code* and are not covered by the tests:

### 1. Late-resolving timed-out connect can overlap a later reconnect — STILL MUST-FIX

Current code still implements connect timeout as:

```js
Promise.race([rpc.connect({}), timeoutPromise])
```

and then unconditionally clears `e.connecting` in `.finally()`.

A timeout therefore does **not** cancel or invalidate the losing `rpc.connect({})`. After the timeout rejects, `e.connecting` is cleared even though the underlying connect may still be in flight. A subsequent caller can start another `rpc.connect({})` on the same shared instance. If the first connect resolves/rejects late, both operations can race on one process-wide fault domain.

This matters more after singletonization, not less, because one bad connection state now affects all migrated sites using that key.

Required closure should be demonstrated by a deterministic regression test with a fake connect that resolves after the timeout. The invariant should be: after a timeout, no second connect is allowed to overlap an unresolved earlier generation (or the earlier generation must be explicitly cancellable/invalidated with a state machine whose late completion cannot mutate authoritative connection state).

The existing M1-M5 test suite has no delayed-connect timeout vector, so `ALL PASS` does not close this defect.

### 2. `errCount` is labelled "in a row" but never reset after successful recovery — STILL MUST-FIX

`noteSharedRpcError()` increments `e.errCount` on every not-connected classification, and the warning says `not-connected N x in a row`. But current `getSharedRpc()` never resets `errCount` after a successful connect or successful RPC use.

Therefore failures separated by successful recoveries accumulate forever and eventually trip the `>=3` loud warning even though they are not consecutive. This is a telemetry/operational-state correctness bug in a shared fault domain.

Required closure: reset the consecutive-failure counter on authoritative successful recovery (and test a fail → reconnect/success → fail sequence). If the desired metric is lifetime failure count, rename it and maintain a separate consecutive counter.

### Result

- singleton architecture / removal of per-call construction in batch 1: **PASS directionally**
- batch-1 merge presence in `bshard-m3-deploy`: **CONFIRMED** at `2e88eb5254eaf6714717fc8398c8bca0b347c875`
- late-resolve / overlapping-connect lifecycle: **OPEN / MUST-FIX**
- true consecutive failure accounting: **OPEN / MUST-FIX**
- current `kaspa-rpc-shared.test.mjs`: **INSUFFICIENT TO CLOSE THOSE TWO DEFECTS**
- any expansion to money-path/batch-2 sites: **HOLD pending lifecycle closure and site-specific timeout/retry review**

No production funds-path authorization is granted by this review.

## Independent judgment on latest J1 step-gradient / ETA message

Latest evidence blob `docs/iteration/j1-inbox/2026-09-01T00-45Z-j1-step-interval-gradient-triggered-tiny-real-eta-minus3.8h-no-action.md` = `42dc4a69f5172a83fba142b9c2213fd7e7ae11dc` reports:

- 20-step median interval 13.11 min
- 40-step 13.40 min
- 60-step 14.07 min
- step size 10.10 MB
- current wasm 1713.6 MB
- claimed 20-step distance to top 2.15 days
- claimed top time about `2026-09-02 23:xxZ`, obtained by advancing the previously used `09-03 03:0xZ` baseline by ~3.8 h

The *gradient observation* is stronger than the previously retracted 1h slope argument because it uses directly observed step intervals. But the statement that monotonic 20<40<60 medians by itself proves a real time trend is still stronger than the evidence: nested windows are not independent samples, and autocorrelation/regime clustering can produce monotone nested-window medians. Treat the 6.8% recent-vs-long-window shift as **SUPPORTED OBSERVATION / TREND SIGNAL**, not yet a mechanism-level proof of acceleration.

More importantly, the absolute ETA again inherits a previously invalid baseline. Using the message's own current inputs:

- remaining to 4096 MB = `4096 - 1713.6 = 2382.4 MB`
- 20-step implied growth = `10.10 * 60 / 13.11 ≈ 46.22 MB/h`
- remaining time ≈ `51.54 h = 2.15 d`

Starting from the message's own ~`2026-09-01 00:45Z` observation time gives a point estimate around **`2026-09-03 04:17Z`**, not `2026-09-02 23:xxZ`.

Thus:

- 20/40/60 step-gradient signal: **SUPPORTED AS AN OBSERVATION**
- exact claim "real acceleration proved": **NOT YET PROVEN**
- `2.15 d` duration arithmetic: **CONSISTENT** with the stated step size/interval
- absolute `09-02 23:xxZ`: **REJECT / STALE-BASE CONTAMINATION**
- reproducible point estimate from current stated inputs: **~`2026-09-03 04:17Z`**, still planning-only, not a hard failure time

ETA calculation should be generated mechanically from `{sample_at_utc,current_wasm,ceiling,step_size,step_interval_stat}` in the same program that emits the evidence, rather than adjusting a remembered prior absolute timestamp.

## Existing gates not closed by this delta

This review does not close previously open `M_reorg/W_dis`, independent-second-vantage absence, gate-(a) deployed-path closure, final-tx fee/mass post-construction invariant, restart authority, production recovery/funds-path wiring, or any production signing/broadcast condition.

No restart, production signing/broadcast, DB mutation, settlement/refund, key movement, or production funds-path deployment is authorized here.
