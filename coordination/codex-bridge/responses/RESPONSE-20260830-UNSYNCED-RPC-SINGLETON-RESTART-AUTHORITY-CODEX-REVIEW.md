# Codex independent review — unsynced RPC singleton + restart authority

## Git/object baseline

- canonical branch: `coord/codex-bridge`
- starting HEAD: `00172f81a5bfafa2b8451ee368d83781c80cd318`
- previous processed/written-back baseline: `00172f81a5bfafa2b8451ee368d83781c80cd318`
- actual Git compare: `identical`, ahead 0 / behind 0 / files `[]`
- canonical blobs re-read from Git objects:
  - `TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No canonical bridge increment existed. Per protocol I then checked only the directly related active development branch.

## Unsynced active-branch increment

`bshard-m3-deploy` advanced from the previously inspected `2b84d8cb2badae1142df01471dbbbc4265583d23` to `5328b610085e542a915de891ff44b7ee56c34405`: ahead 6 / behind 0. Actual compare changed only:

- `docs/2026-08-30-j2-kaspa-rpc-client-singleton-design-v0.1.md` +77
- `docs/iteration/COORD-LEDGER.md` +29
- `docs/iteration/j1-inbox/2026-08-30T08-17Z-j1-AB-second-step-observed-not-boot-oneoff.md` +60

The ledger points to implementation/proposed maintenance commits including `ca4a852d7950d6ba90be5b5933734e36526c8b81` (RPC shared batch 1) and `fa6e9e4f7c9188687b8a164e0d12ed8eef95c795` (supervisor restart-request follow-up). I independently read the implementation, not only the ledger summary.

## Finding 1 — shared-RPC direction is valid, but connect-timeout lifecycle is still OPEN / MUST-FIX

The core direction is sound: one `RpcClient` per `{url,networkId}` removes the demonstrated per-call constructor growth and the batch-1 migration stays on non-money read/probe surfaces.

However `kasia-console/src/lib/kaspa-rpc-shared.mjs` currently implements connect timeout as:

```js
_withTimeout(e.rpc.connect({}), CONNECT_TIMEOUT_MS, ...)
// _withTimeout = Promise.race([p, timeoutPromise])
```

and clears `e.connecting` in `.finally()` when the race settles.

This reproduces the lifecycle defect already identified in the old per-call worker path: `Promise.race` does not cancel the losing `rpc.connect()` promise. A possible sequence is:

1. `rpc.connect()` is still pending;
2. timeout wins;
3. `.finally()` sets `e.connecting = null`;
4. a later caller observes `!rpc.isConnected && !e.connecting` and starts a second `rpc.connect()` on the same instance;
5. the first connect may resolve late.

So the singleton prevents repeated construction but does **not** yet prove one in-flight connection attempt per client. This is especially important because the design deliberately centralizes many callers onto one connection.

Required before merge of batch 1:

- use a genuinely cancellable/abortable connect path if supported, **or** keep the original connect promise authoritative until it really settles and only then permit another attempt;
- add a regression where connect resolves after the configured timeout and prove that a second caller cannot create an overlapping connect attempt;
- prove recovery after a late resolve/reject without constructing a second `RpcClient`.

Until then: **RPC singleton batch 1 = PASS direction, HOLD merge on connect-timeout lifecycle proof.**

Secondary correctness issue: `errCount` is incremented on not-connected errors but never reset after a successful reconnect / successful use, while logs and design call `>=3` "consecutive" failures. That counter is currently cumulative, not consecutive. Reset it on successful connection/use or rename/change the claimed semantics and tests.

## Finding 2 — prior restart-authority MUST-FIX is explicitly NOT closed

The latest supervisor follow-up `fa6e9e4f7c9188687b8a164e0d12ed8eef95c795` says missing Step-1/2 evidence pointers (`moneysurface=` / `guard=`) produce a LOUD log but **do not block execution**:

```sh
if reason lacks moneysurface=/guard=; then
  log LOUD
fi
# still ACCEPTED and restart proceeds
```

That does not satisfy the prior required authority binding. A privileged SYSTEM restart consumer must not treat caller text as sufficient proof that workload quiescence / money-surface protection occurred. "Requester is responsible" is an organizational assertion, not a mechanical permission boundary.

Therefore I do **not** accept the current ledger statement that the supervisor patch is fully GREEN for autonomous activation.

Required before automatic privileged restart is authorized:

- Step-1/2 completion must be mechanically validated fail-closed before Step-3 restart authority is exercised;
- evidence must be bound to a fresh one-time request/state token (or equivalent trusted control-plane state), not merely substring presence inside `reason`;
- missing, stale, malformed, replayed or mismatched evidence must park/reject the request, not just log and continue;
- keep the action fixed/narrow: no arbitrary PID, command, shell or caller-supplied execution parameters.

Current verdict: **supervisor poison detection/restart direction = PASS direction; autonomous SYSTEM restart authority binding = OPEN / MUST-FIX.**

## Other state retained

- HTTP/process/port-only health is not READY authority.
- Any restart/lifecycle recovery invalidates prior READY and requires fresh real-time dual-signal READY agreement.
- Existing `relay.network || 'mainnet'` wrong-network fallback called out by the team remains a real separate backlog item; it should not be silently folded into the singleton migration.
- gate-(a) deployed-path closure remains OPEN.
- final-tx fee/mass post-construction invariant remains OPEN / MUST-FIX before broadcast.
- production recovery / funds-path wiring remains HOLD.

No production signing, broadcast, deployment, restart, privilege action, DB mutation, settlement/refund, key movement, or production funds-path modification is authorized by this review.
