# Codex review — CP4 typed/named PoolRoot identity anchor

- scope: unsynced active-branch review after canonical bridge compare showed no delta
- bridge_base_head: `311f12f8a65a46c16ca1d012f5d39d5bbf1339d9`
- active_branch_reviewed: `bshard-m3-deploy@c5ad273e68096d94b0d03f553f2498b86874d80a`
- relevant design: `docs/2026-08-13-j2-cp4-identity-anchor-typed-source-design.md` blob `4f27261a5cb79fb26ec7da57863b772c2f105862`
- current builder: `kasia-console/src/lib/pool-refund-builder.mjs` blob `7f0d1f7865ab216626e1dd7120cd93a254681903`
- authority: engineering review only; no production refund / DB migration / wiring / broadcast authorization

## Verified facts

1. Current `buildRefundCommand()` still accepts free caller-supplied `expectedRootTmplHashHex`. The builder validates its shape and compares it against `blake2b(poolRedeem minus the compiler-supplied state window)`, so a caller can still derive the expected value from the same candidate redeem and make the purported cross-boundary check circular.
2. `computeMarketGenesis()` really computes `rootTmplHash` from the exact compiled PoolRoot artifact and then bakes that value into the PoolLeaf ctor. This is the correct construction-time point at which a durable identity commitment can be captured.
3. CP4 option A proposes persisting that value in `pool_markets.root_tmpl_hash`, write-once, deleting the free hash parameter, and resolving by `marketId`; old/null markets fail closed. This is materially different from recomputing an anchor from the refund candidate.
4. The active branch has no landed CP4 schema/builder implementation yet. The new CP4 artifact is design-only; the current builder still has the free parameter.

## Assessment

**CP4 option A is ACCEPTED AS THE PREFERRED DESIGN DIRECTION, with two mandatory structural conditions before it can close §4.**

### MUST 1 — the persisted anchor must be tied to the exact construction artifact actually used for that market

The write must consume the same `rootTmplHash` produced by the exact `rootArtifact` that is used in the market's construction chain (the value baked into the PoolLeaf ctor), not a later recompilation and not a recomputation from a refund-time redeem. The persistence operation should be part of the authoritative market-creation record/transactional path so the DB row records *that construction event's commitment*, not merely "a hash somebody can write once." If the creation path cannot prove/populate that binding, leave the column NULL and fail closed.

This is why option A is sound while option C is not: temporal persistence of the construction commitment breaks the refund caller's ability to choose both sides of the comparison.

### MUST 2 — production builder must not accept an injectable provenance function from the refund caller

CP4 §3 says builder may receive `marketId + db handle (or injected anchor getter)`. The parenthetical is too permissive if implemented literally. An arbitrary caller-supplied getter can simply return a hash recomputed from the candidate redeem and recreates the same circular authority under a different type.

For the production money path, use a named/trusted resolver owned by the builder/data-access module (or an opaque typed construction-record object whose creation is not available to the refund caller). Dependency injection is fine in tests, but the production API must make `expectedRootTmplHashHex` **and any caller-selectable replacement source structurally unavailable**.

A correct production chain is therefore:

`exact PoolRoot construction artifact -> persisted write-once market commitment -> named marketId resolver -> builder identity check -> relay command`

not:

`refund caller -> arbitrary hash/getter -> builder`.

## Test / mutation acceptance

Before §4 can be marked CLOSED IN CODE/TEST, require at least:

- free `expectedRootTmplHashHex` removed from the production builder API;
- production builder has no caller-injectable anchor getter/source;
- NULL/missing anchor fails closed;
- candidate redeem whose self-derived hash is supplied through extra/legacy args still fails when the stored market anchor differs;
- mutation that replaces the named persisted-anchor resolver with a candidate-derived hash is killed;
- mutation that omits or alters the construction-time anchor persistence is killed by a DB/integration test, or explicitly remains OPEN if that seam is untested;
- write-once behavior is tested at the DB layer, not only asserted in prose;
- post-Fix B-1 is rerun over the final authority-producing chain.

## Scope / cross-node note

A local `pool_markets.root_tmpl_hash` is a local durable construction record, **not a cross-node consensus fact**. That limitation is acceptable for the currently single-node unwired builder only if missing/migrated/rebuilt DB state fails closed. Future cross-node or committee consumption must use a separately authenticated chain-carried/pinned commitment rather than assuming this local column is globally authoritative.

## Verdict

- CP4 option A direction: **ACCEPTED**.
- CP4 design as currently written: **ACCEPTED WITH THE TWO MUST CONDITIONS ABOVE**.
- Current landed code: **§4 STILL OPEN**; free caller hash remains in `buildRefundCommand()`.
- Overall round-trip/state_start blocker: **NOT CLOSED YET**.
- Owner/schema gate remains intact: this review does **not** authorize the `pool_markets` migration, production wiring, refund execution, signing, broadcast, or any other production money-path change.
