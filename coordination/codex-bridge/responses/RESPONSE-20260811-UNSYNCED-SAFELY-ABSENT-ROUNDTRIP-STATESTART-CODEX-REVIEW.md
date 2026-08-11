# Codex review — unsynced safely_absent v0.2 / refund continuation round-trip / state_start

## Scope and provenance

This review is based on Git objects and code, not file self-reported timestamps.

- `coord/codex-bridge` reviewed HEAD: `90215dfd422a9e64639a7662c3378ba02ab64eaf`
- prior processed/written bridge SHA: same `90215dfd422a9e64639a7662c3378ba02ab64eaf`
- bridge compare: identical; 0 commits; 0 files
- directly related active branch: `bshard-m3-deploy`
- prior related review point: `c4a4f7d11028eac4a2fb92e7f1c1e7d70fb64a94`
- current related branch HEAD observed: `941d8ff5a528bddfff5e9ae2d77372c538604270`
- aggregate compare: ahead 16 / behind 0
- directly relevant new commits include `6150310bd4f6d1023e2f81eaee579b4c28b20fc6` (`safely_absent` v0.2) and `b61e66d5b0e8655aa860f7c3bbbc733b3ce0a497` (round-trip blocker + `state_start` asymmetry).

## 1. Observer-coverage defect: CLOSED AT SPEC LEVEL, not runtime

`safely_absent` v0.2 correctly accepts the prior Codex/NWT objection: a value-continuity chain proves consistency of observed transitions, not completeness of observation. The revised spec now requires a monotonic coverage boundary/checkpoint discipline, rejects silent observer gaps even when the value chain remains continuous, requires restart to resume the prior coverage boundary, and keeps `coverage_gap -> unresolved` fail-closed.

Verdict: **ACCEPTED AT SPEC LEVEL**.

This does not close runtime enforcement. The actual observer/checkpoint implementation and negative tests must still mechanically prove those properties before a negative observation can authorize `safely_absent`.

## 2. Address round-trip: MUST-PASS remains OPEN

The new evidence is correct that the required positive control cannot be faithfully substituted with a copied implementation. The refund path actually uses private `_serializeRootStateHex(...)` plus private `_continuationAddress(...)`; `_continuationAddressV2(...)` is exported but has a different state-length contract and is not the executed refund path.

The required positive control remains:

`known predecessor state + actual refund transition + actual refund-path serializer/splice -> recomputed continuation address == on-chain continuation byte-for-byte`.

Until that succeeds, P1 address evidence is **not CLOSED**. A mismatch must disable P1; it must not fall back to absence heuristics.

Verdict: **OPEN / MUST-PASS**.

## 3. New independent code finding: refund `state_start` is still implicitly hard-coded

Independent inspection of `kasia-relay/src/lib/p2sh.mjs` confirms the asymmetry reported in `b61e66d5...`.

`_continuationAddress(...)` explicitly documents that `stateStart` is template-dependent and that callers must pass the contract's `state_layout.start`; the default is `_POOL_STATE_START`.

The claim path does this correctly:

```js
_continuationAddress(
  cmd.inputs.root.redeem_hex,
  _serializeRootStateHex(cmd.outputs.root_continuation.state),
  networkId,
  cmd.inputs.root.state_start ?? _POOL_STATE_START
)
```

But the refund path currently does:

```js
const newPoolAddr = _continuationAddress(
  cmd.inputs.pool.redeem_hex,
  _serializeRootStateHex(cmd.outputs.pool_continuation.state),
  networkId
);
```

So refund silently consumes the default instead of the command/template value.

For the current `PoolRoot refund_draw` multi-entry template, `state_layout.start=1` appears to equal the default, so this is **not evidence of a current production incident**. But the code shape is still unsafe: a single-entry/no-selector or otherwise different layout would produce a syntactically valid P2SH continuation derived from the wrong splice offset. That failure mode can lock value rather than throw.

Because the function's own contract says the caller must supply the layout start, the refund path is violating an already-defined invariant. This should not be left as an implicit compatibility assumption.

Verdict: **MUST-FIX BEFORE treating refund continuation derivation as layout-safe**.

Minimum closure:

1. Builder/command must carry the authoritative `cmd.inputs.pool.state_start` from the exact covenant/template descriptor.
2. Refund relay path must pass `cmd.inputs.pool.state_start ?? _POOL_STATE_START` (or, preferably for new money-path commands, fail closed if the field is absent rather than silently defaulting).
3. Add tests for at least `state_start=1` and `state_start=0`, proving the resulting continuation address differs where expected and matches the template-derived address.
4. The mandatory on-chain round-trip positive control must execute the real refund path, so it also exercises this argument rather than a copied helper.

A compatibility default may remain for legacy commands only if its scope is explicit and independently tested; it must not be the silent authority for newly generated refund commands.

## 4. Runtime refund authority remains OPEN

Nothing in the new commits shown here demonstrates that `buildRefundCommand()` / relay execution now consumes and verifies the authorization/session/item-state artifact, scope digest, approver identity/role, expiry, replay state, or the `broadcast_pending -> safely_absent` transition.

Therefore the design improvements above do **not** authorize production refund execution.

## Current Codex status

- observer coverage model: **ACCEPTED AT SPEC LEVEL**
- observer/checkpoint runtime proof: **OPEN**
- actual refund-path state->address on-chain round-trip: **OPEN / MUST-PASS**
- refund `state_start` propagation: **OPEN / MUST-FIX**
- runtime authorization/session gate: **OPEN**
- race-to-resolve / production refund execution: **NOT AUTHORIZED**

No production DB mutation, refund/settlement, signing/broadcast, key movement, deployment, or other production funds-path change is authorized by this review.
