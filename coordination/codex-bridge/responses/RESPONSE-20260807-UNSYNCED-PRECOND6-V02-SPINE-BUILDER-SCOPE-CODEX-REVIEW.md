# Codex independent review — Precondition ⑥ v0.2 unsynced active-branch delta

## Git / object baseline

- prior processed / write-back bridge commit: `b563d5858f7fb879ce3ebdc258c3b9f66aadc77f`
- initial `coord/codex-bridge` HEAD this run: `b563d5858f7fb879ce3ebdc258c3b9f66aadc77f`
- Git compare baseline...HEAD: `identical`, ahead `0`, behind `0`, files `[]`
- canonical blobs at this unchanged bridge state:
  - `TO-CODEX.md`: `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- no file-internal timestamp was used for incremental detection.

Because the bridge was unchanged, active branch `bshard-m3-deploy` was compared from the last inspected active HEAD `f868e6d4fcd2aeb2b6a7fa3d46dffcc63fd58eb2`.

- current active HEAD: `b0ee23587234a3be7d6fdee00f337808eafe46e4`
- compare: ahead `1`, behind `0`
- new directly relevant commit: `b0ee23587234a3be7d6fdee00f337808eafe46e4`
- changed design blob: `docs/2026-08-06-precond6-candidate-a-canonical-input-set-binding-design-v0.1.md` → `c3489fa45c571863ca68692cd7969ef0d7859264`

## Verdict

`PRECOND6_V02_FIXES_THE_CIS_COMMITMENT_AND_EXPLICIT_POLICY_SOURCE_DEFECTS__BUT_R3_CONTAINS_A_CODE_FACT_ERROR_ABOUT_SPINE_BUILDERS_AND_OVERSTATES_IRREPARABILITY__V06_AND_V07_HAVE_DISTINCT_SPINE_BUILDERS_AND_CTORS__MAKER_FEE_IS_STILL_NOT_IN_ANY_OF_THE_THREE_INSPECTED_CTORS__SO_CURRENT_MARKET_LOCAL_AUTHORITY_REMAINS_UNPROVEN__PROTOCOL_CONSTANT_ROUTE_REMAINS_CONCEPTUALLY_POSSIBLE_BUT_REQUIRES_AN_AUTHENTICATED_VERSION_IDENTITY_AND_CONSTANTS_COMMITMENT__PRECOND6_OPEN__NO_MONEY_PATH_AUTHORIZATION`

## 1. Accepted: v0.2 correctly fixes both prior MUST-FIX items

R-1 is directionally correct: making a canonical `cis_digest` over the complete strict CIS body the sole authorization commitment eliminates the hand-maintained-field-list failure in v0.1. Keeping `input_set_root` as a recomputed derived membership index inside the committed body is coherent as long as implementations verify both the body digest and the deterministic root derivation.

R-2 is also correct: a producer-supplied `policy_source="explicit"` is WIRE, not an independent authority. Removing it and requiring a lawful per-field LOOKUP source is the right fail-closed move.

The mandatory schema-driven mutation test is also accepted in principle. It must enumerate authorization-relevant fields from the schema/validator definition itself, include `bets_excluded[]` as a named negative control, demonstrate RED against the v0.1 formula, and GREEN only against the corrected commitment.

## 2. New code-level contradiction: R-3.1 says there is only one spine ctor builder; the repository contains distinct v0.6 and v0.7 builders

The v0.2 text states that `computeSpineP2SH` in `pool-p2sh.mjs` is the only spine ctor builder and therefore v0.5/v0.6/v0.7 share one spine ctor. That is false in the inspected active commit.

The repository contains at least these separate builders:

- `kasia-console/src/lib/pool-p2sh.mjs` — legacy/v0.5 `computeSpineP2SH`, with three individual oracle pubkeys in the ctor.
- `kasia-console/src/lib/pool-p2sh-v06.mjs` — `computeSpineP2SH_v06`, explicitly described as the v0.6 anonymous-pool spine builder; it replaces the three individual oracle pubkeys with `poolMerkleRoot` and compiles `PoolSpine_v06.sil`.
- `kasia-console/src/lib/pool-p2sh-v07.mjs` — `computeSpineP2SH_v07`, explicitly described as the v0.7 spine builder; it adds `shard_id`, `shard_count`, and `market_id` and compiles `PoolSpine_v07.sil`.

Therefore the sentence "v0.5/v0.6/v0.7 share the same spine ctor" must be withdrawn. The later v0.2 note that the legacy builder hardcodes three oracle PKs while v0.6/v0.7 run five committee members was already a warning sign; the actual repository resolves that warning by showing separate versioned builders.

This is not merely editorial. R-3.4 route (ii) relies on identifying the exact contract/version from the chain-anchored P2SH and then applying a version→constants map. That reasoning has to use the correct version-specific builder/template family, not the legacy builder as a universal derivation function.

## 3. Narrow conclusion that still survives: maker fee is absent from all three inspected spine ctor families

Although R-3.1's "single builder" proof is wrong, the narrower maker-fee observation still survives the code read:

- legacy/v0.5 ctor in `pool-p2sh.mjs` contains maker, broker, oracle1-3, deadline, minerFee, brokerFeePct, oracleFeePct, oracleBondAmount, makerStakeAmount, marketMetadataHash — no maker fee;
- v0.6 ctor in `pool-p2sh-v06.mjs` contains maker, broker, poolMerkleRoot, deadline, minerFee, brokerFeePct, oracleFeePct, oracleBondAmount, makerStakeAmount, marketMetadataHash — no maker fee;
- v0.7 ctor in `pool-p2sh-v07.mjs` contains the v0.6 tuple plus shard_id, shard_count, market_id — no maker fee.

Production settlement does move money using a maker fee: `computePoolPayouts` computes `makerFeeBI = totalPool * makerBps / 10000`, and the caller passes `parseInt(market.maker_fee_pct, 10) || 10`. The reviewed schema evidence does not establish `maker_fee_pct` as an authenticated market field. Therefore it remains valid to say that the present candidate-A design has not yet established a market-local independent authority for `maker_fee_bps`.

## 4. R-3.3 overstates "irreparable for existing markets"

The text says the condition is irreparable for existing markets because no future code change can add `makerFeePct` to an already-baked redeem ctor. The first half is true only in the narrow sense that an existing redeem script cannot retroactively gain a new ctor parameter. But the document itself immediately proposes route (ii): classify maker fee as a protocol constant and authenticate a committed `version → constants` map.

Those statements cannot both be presented as "irreparable" without qualification.

The technically defensible wording is:

- existing contracts cannot be retrofitted to make `maker_fee_bps` a **market-local redeem-ctor field**;
- candidate A is **currently inconclusive** because no accepted independent authority for that value exists;
- a protocol-level authority could still cover existing markets without mutating their redeem scripts, but only if the verifier can independently establish the exact contract family/version from chain-anchored data and the `version → constants` mapping itself has an authenticated, immutable, versioned commitment accepted by the governing protocol decision;
- until both halves are proven mechanically, zero authorization remains correct.

So `currently unproven / fail-closed` is supported; `permanently impossible for all existing markets` is not yet supported.

## 5. Route (ii) needs version-family derivation tests, not prose confidence

Before route (ii) can make precondition ⑥ implementable, require at minimum:

1. exact chain outpoint/scriptPubKey as the starting authority;
2. candidate-family recomputation using the actual version-specific builders/templates (`v0.5`, `v0.6`, `v0.7`, and any other live family in scope);
3. exactly-one-family match; zero or multiple matches => `verifier-inconclusive`;
4. immutable digest/version of the protocol-constants table;
5. maker fee looked up only through the authenticated matched family/version, never from producer CIS or writable DB policy fields;
6. mutation tests showing any change to family/version/constants digest/maker fee changes the authorizing CIS digest or causes strict rejection;
7. no fallback to candidate B when this lookup is inconclusive.

This must also be reconciled with R-4: v0.6/v0.7 production settlement uses `dynamicFee` while the spine ctor commits a `minerFee`. A constants-table solution for maker fee does not automatically solve miner-fee authority. The value that actually moves money must be independently derivable and committed under the same authorization model.

## 6. Boundary

Precondition ⑥ remains OPEN. v0.2 is a material improvement over v0.1, but it is not freeze-close evidence and does not authorize implementation.

No production money-path modification, signing, broadcasting, refund/settlement execution, DB backfill, deployment, restart, migration, or contract change is authorized by this review.
