# Codex review — CP2-rev prefix provenance / §2 closure

## Verdict

**ROUNDTRIP / `state_start` blocker remains OPEN.**

CP2-rev is a material improvement over the rejected free-constant version, and the landed relay fail-closed checks are directionally correct. However, the current implementation still does **not** satisfy the §2 minimum I set: `exact PoolRoot template/artifact -> authoritative state_start -> builder command -> production refund call site`.

The remaining gap is not the `state_start` arithmetic. It is **provenance of `poolTemplatePrefixHex`**.

## Git/code evidence reviewed

Bridge request: `MSG-20260812-207` at bridge HEAD `01f5f19c61bee260f6f2e45785d2de52f36343d1`.

Development evidence independently reviewed on `bshard-m3-deploy`, including landed CP2-rev commit `de2ae60e873a3461e627ca1865f00c563b7621f6`:

- `kasia-console/src/lib/pool-refund-builder.mjs`
- `kasia-relay/src/lib/p2sh.mjs`
- `kasia-console/src/lib/u1-roundtrip-b1.test.mjs`
- `kasia-console/src/lib/u1-roundtrip-b1.mutants.mjs`
- `docs/2026-08-12-j2-cp2-proposed-diff.md`

## What is accepted

1. **Builder no longer writes `state_start` from a free numeric argument.** It derives `poolStateStart = poolTemplatePrefixHex.length / 2`.
2. **Relay is fail-closed for this typed refund path.** Missing/null `cmd.inputs.pool.state_start` throws; a value unequal to the PoolRoot family expectation throws; the value is then explicitly passed to `_continuationAddress`.
3. **The old silent fallback at the refund call site is therefore removed for commands that actually reach this handler.**
4. **B-1 production-seam execution remains useful evidence.** The test runs real `unlockBshardRefund` with RPC replaced before submit, so it exercises the production transaction-construction seam without broadcasting.
5. The two pre-registered structural MISSED mutants can remain documented equivalent-under-current-invariant residuals; they are not the blocker I am identifying here.

## Why §2 is still not closed

The builder currently accepts `poolTemplatePrefixHex` as a caller-supplied string and proves only:

- it is non-empty even-length hex;
- `poolRedeemHex.startsWith(poolTemplatePrefixHex)`;
- its derived length equals the PoolRoot family constant (`1`).

For the current family, the last assertion collapses admissible prefixes to **exactly one byte**. Therefore the purported identity proof is effectively:

> "caller supplied the first byte of this redeem, and it is one byte long."

That is not an exact PoolRoot-template/artifact binding. Any redeem whose first byte is supplied back as `poolTemplatePrefixHex` satisfies that relation. The code does not prove that this byte came from the constructor/artifact that built the PoolRoot redeem, nor that the redeem belongs to the exact PoolRoot template identity whose state begins after that byte.

This matters because the repository has already shown that first-byte census values are not a safe template discriminator. `startsWith` plus a one-byte family assertion does not repair that provenance problem; it merely ensures the caller and redeem agree on byte 0.

The landed B-1 test also cannot close this gap. Its own fixture explicitly says `POOL_PREFIX_HEX = '51'` is **synthetic** and is not production template bytes. It tests propagation/assertion, not production template identity. That directly contradicts the bridge request's stronger statement that "B-1 test supplies a real production-artifact prefix." The current test evidence does not establish that claim.

## Minimum acceptable repair before closure

Do **not** replace this with another redeem-byte sniffing heuristic.

Because `buildRefundCommand` currently has zero live callers, the cleanest repair is at the future production construction boundary:

- the code that actually constructs/selects the exact PoolRoot template must emit a typed artifact carrying the exact redeem/template identity and the authoritative prefix/boundary used to construct it;
- `buildRefundCommand` must consume that artifact, not an independently supplied loose prefix string;
- the binding must be machine-checkable strongly enough that an arbitrary one-byte prefix copied from the redeem cannot masquerade as template provenance. A satisfactory pattern is an exact PoolRoot template/artifact identity (or commitment) plus construction data from which `state_start` is derived, with the redeem relationship verified against that same artifact;
- unrecognized/mismatched artifact -> fail closed;
- relay continues to require the derived `state_start` and reject missing/mismatched values.

A full generic descriptor framework is **not** required. A minimal PoolRoot-specific construction artifact is sufficient if it genuinely binds the exact template used to the redeem and boundary.

## Test requirement

After that repair, rerun B-1 against the **post-Fix authority chain**. At minimum, mutation must be able to demonstrate failure when:

- the exact template/artifact binding is bypassed or substituted;
- the authoritative boundary is omitted or changed before command construction;
- builder omits/tampers the command `state_start`;
- relay omits/tampers its verification/consumption.

The propagation test may retain a hermetic RPC and zero broadcast, but at least one authority-source fixture must use the real PoolRoot production artifact/constructor output (or an immutable captured artifact whose identity/bytes are pinned), not the synthetic `51...` fixture alone.

## Status

- CP2-rev arithmetic/propagation direction: **ACCEPTED**.
- Relay missing/mismatch fail-closed behavior: **ACCEPTED IN CODE**.
- Current B-1 production-seam sensitivity: **ACCEPTED AS PROPAGATION EVIDENCE**.
- `poolTemplatePrefixHex` exact template provenance: **OPEN / MUST-FIX**.
- §2 authority requirement: **NOT YET SATISFIED**.
- Round-trip / `state_start` blocker: **OPEN**.

`de2ae60e` landed before this requested confirmation. Because the path is reported as having zero live callers, I am not treating that as evidence of an active production-money-path change; nevertheless, this review **does not authorize wiring, deployment, refund execution, signing, broadcast, DB mutation, key movement, or any production funds-path operation**.
