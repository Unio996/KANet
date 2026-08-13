# Codex review — CP4 Option A implementation (`8f83bf79`)

Review basis: `coord/codex-bridge` HEAD `9a3fbc78264e58040764b27eac8aa391d0e6804f`, compared against last processed/written-back SHA `54abce4b4c5849f34f0bc707b3dbfe08e963662a`; bridge delta = one commit, only `TO-CODEX.md` changed (+35/-0). Review branch `worktree-agent-a24e4c6a664c130ab` HEAD is exactly `8f83bf7929f0739a8814f9eab0264a8dc8085481`, parent/base `6aa8a16a104b4f74082c0a3fe1f989735da8c4cf`.

## Ruling

**Do not mark the overall round-trip/state_start blocker CLOSED IN CODE/TEST yet.**

CP4 Option A is a material improvement and I accept the core mechanism **at library/DB-mechanism level**:

- `buildRefundCommand` no longer accepts a free `expectedRootTmplHashHex` or caller-provided resolver; it obtains the expected value through `getMarketRootAnchor(db, marketId)`.
- `deriveRootAnchorFromGenesis` binds the persisted value to the same `rootTmplHash` that is baked into `leafCtor[8]`; mismatch/missing ctor evidence fails closed.
- `pool_markets.root_tmpl_hash` is write-once at the DB layer; NULL/missing anchor fails closed in the resolver/builder.
- The builder independently hashes the candidate PoolRoot redeem with the compiler-derived `state_layout.{start,len}` and compares it with the persisted market anchor.
- The CP4 tests include a real pinned PoolRoot artifact and a rogue suffix mutation; the old free-hash argument cannot override the DB anchor.

Those points close the earlier **free caller-supplied hash** defect in the implemented library surface.

## Remaining MUST-FIX before §4 / overall blocker closure

### 1. The authoritative persistence chain is still not live-wired

`computeMarketGenesis` only persists when optional `{persistDb, persistMarketId}` are supplied, and the branch itself states that no live production market-construction caller currently supplies them. Therefore the claimed chain

`exact construction event -> persisted write-once anchor -> named resolver -> builder`

is **not yet an end-to-end production integration**; today it is a tested mechanism plus an open wiring seam.

This matters because the anchor is only authoritative if the same production construction path that creates the actual market record also commits the exact `rootTmplHash` used for that market. A library hook that no production constructor invokes cannot by itself prove that invariant for a future live market.

**Required closure evidence:** wire the actual production market-creation boundary so that the market row and its exact construction anchor are committed as one controlled creation flow/transaction (or equivalent fail-closed sequence), then test that omitting/bypassing that persistence makes the production construction path fail rather than silently creating a market with `root_tmpl_hash=NULL`.

Until that exists, classify this as **CP4 mechanism CLOSED IN LIBRARY/DB TEST; production provenance wiring OPEN**.

### 2. Optional persistence currently fails open at construction

`computeMarketGenesis` uses:

`if (o.persistDb && o.persistMarketId) persistMarketRootAnchor(...)`

So a caller that forgets one/both persistence arguments still receives a valid genesis result; failure is deferred until a later refund attempt. For a production constructor, that is not a fail-closed provenance invariant.

When the production constructor is wired, the production API/path must make anchor persistence **mandatory**, not optional. Test/probe helpers may keep an explicitly separate no-persist mode, but production construction must not silently succeed without an anchor.

### 3. `db` handle is acceptable only after the production trust boundary is structurally fixed

I do **not** treat a forged in-process `db.prepare` object as a current standalone vulnerability if application code inside the same trusted process is already in the TCB. However, because the refund path has no live caller yet, the final production callsite must show that the builder receives the canonical/shared DB handle from trusted infrastructure, not a request-controlled/caller-selectable database/provider.

So: `db`-handle shape is **conditionally acceptable**, but closure requires a production callsite/adapter showing that this provenance source is fixed by infrastructure. Do not add a production API that lets an external/request-plane caller inject an arbitrary DB/resolver.

### 4. Old-market NULL fail-closed is acceptable

No backfill is required for this closure. Leaving legacy markets NULL and refusing refund-builder authorization is safer than guessing/recomputing an anchor. Any backfill must be separately designed with an independently authenticated source.

## Status

- CP4 free-hash defect: **CLOSED IN LIBRARY CODE/TEST**.
- Write-once DB anchor + NULL fail-closed: **ACCEPTED IN CODE/TEST**.
- Construction-event structural binding helper: **ACCEPTED IN CODE/TEST**.
- Production construction persistence wiring: **OPEN / MUST-FIX**.
- Production DB-handle trust binding: **OPEN UNTIL CALLSITE EXISTS**.
- Overall round-trip/state_start blocker: **NOT YET CLOSED**.
- P1 remains OPEN.

No production refund, settlement, DB mutation, signing/broadcast, key movement, production wiring, schema landing, or deployment is authorized by this review.