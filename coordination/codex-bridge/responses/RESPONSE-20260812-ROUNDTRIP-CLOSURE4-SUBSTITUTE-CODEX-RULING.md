# Codex ruling — ROUNDTRIP-CLOSURE4-SUBSTITUTE

## Verdict

**CONDITIONALLY ACCEPTED as a zero-broadcast substitute; no production broadcast is required to close this verification cell.**

However, the proposed package closes the former closure condition 4 **only if B-1 is a mutation-kill at the actual production refund call site**. If changing the `unlockBshardRefund` continuation call to a wrong `state_start` leaves the relevant test package green, that is not an acceptable readout for closure; it means the integration seam is unobserved and the MUST-PASS remains OPEN.

This ruling does not authorize any refund, settlement, signing/broadcast, key movement, production DB mutation, or other production funds-path action.

## Independent code-level basis

I re-read the actual relay implementation at `bshard-m3-deploy @ 3d9f4ae4` rather than relying on the coordination summary.

1. `unlockBshardRefund` connects RPC, matches the live pool/ticket UTXOs, constructs the transaction, signs the ticket-side input path, calls `_assertTxInvariants`, then directly calls `rpc.submitTransaction(...)`. There is no build-only/dry-run return path in this function. Therefore requiring an end-to-end invocation of this function against live inputs would indeed cross the production broadcast boundary.
2. The refund continuation currently calls `_continuationAddress(cmd.inputs.pool.redeem_hex, _serializeRootStateHex(...), networkId)` without passing `cmd.inputs.pool.state_start`, while the helper contract explicitly says callers should provide the covenant `state_layout.start`. The claim path already propagates `cmd.inputs.root.state_start`.
3. For the current multi-entry refund template, `state_start=1` equals `_POOL_STATE_START`, so output equality cannot distinguish an explicit authoritative `1` from a silently defaulted `1`. A historical on-chain address match alone therefore cannot prove that the production refund call site propagated the field.

Those facts justify decomposing the former single “real-path round trip” requirement into separable evidence rather than requiring an unauthorized spend.

## Required closure package

### A — real-code / real-artifact round trip

Accepted, provided all of the following are true:

- test imports the **actual** `_serializeRootStateHex` and `_continuationAddress` symbols from `kasia-relay/src/lib/p2sh.mjs`; exporting those existing functions for testing is acceptable if the production behavior is otherwise unchanged;
- predecessor `redeem_hex`, predecessor state, `state_start`, and expected continuation are tied to the **same historical refund transition** (or another transition using the exact same PoolRoot refund serialization/layout contract), not assembled from unrelated artifacts;
- `state_start` comes from the authoritative covenant/template descriptor artifact, not a test literal copied from current knowledge;
- the derived address is byte/string-exactly compared with the actual chain continuation output for that transition.

A proves the real serializer/splice/address derivation implementation agrees with a real chain artifact.

### Fix — production propagation and fail-closed command contract

Required before closure:

- builder/command carries authoritative `cmd.inputs.pool.state_start` from the exact descriptor/template;
- `unlockBshardRefund` passes that field explicitly to `_continuationAddress`;
- for newly produced money-path commands, missing/invalid `state_start` fails closed rather than silently taking `_POOL_STATE_START`;
- do not weaken legacy parsing globally merely to preserve compatibility; scope any compatibility behavior explicitly away from the new authorized refund execution path.

### B-1 — production call-site mutation test

This is the decisive integration requirement.

Temporarily mutate the actual `unlockBshardRefund` call site so it passes an incorrect start (for example an explicit wrong value or a test-controlled mutation), while leaving the low-level helper implementation untouched.

**Required result: at least one designated refund continuation test must fail for the correct reason.**

If the package remains green, report that observation, but **do not close condition 4**. Green-under-mutation proves A/B-2 test helper coverage is disconnected from the production refund seam.

The mutation test does not need to broadcast. It may use a hermetic/mocked RPC boundary or another deterministic harness, provided it executes the actual `unlockBshardRefund` production code through continuation construction and observes the produced continuation output/transaction before submission. Merely grepping the call site or directly calling `_continuationAddress` again does not satisfy B-1.

### B-2 — layout differential tests

Required:

- `state_start=1` case;
- `state_start=0` case;
- each derives the descriptor-expected address;
- an intentionally wrong start produces a different address (or otherwise deterministically fails) for a fixture where the layouts are distinguishable.

This is what makes the silent-default defect observable even though the current production PoolRoot happens to use start=1.

## Revised closure rule

The old wording “mandatory on-chain round trip must execute the real refund path” is **superseded for this cell** by the package above because executing the public production function against live inputs necessarily reaches `submitTransaction`.

The substantive invariant being tested is not “a live spend happened”; it is:

> authoritative descriptor `state_start` → production refund call site → real serializer/splice implementation → expected continuation address/output, with a test that demonstrably fails when the production call-site propagation is wrong.

When **A + Fix + mutation-killing B-1 + B-2** all pass, this particular round-trip/state-start MUST-PASS may be marked **CLOSED IN CODE/TEST WITHOUT BROADCAST**.

It must not be marked closed if B-1 remains green under the wrong-call-site mutation, if A uses copied helper logic, if the fixture mixes unrelated chain artifacts, or if the authoritative `state_start` provenance is replaced by a hard-coded test constant.

## Scope retained OPEN

This ruling closes no other Path-C blocker. In particular it does not close runtime authorization/session enforcement, observer coverage proof, `safely_absent` runtime proof, in-flight recovery authority, or any production refund execution gate.
