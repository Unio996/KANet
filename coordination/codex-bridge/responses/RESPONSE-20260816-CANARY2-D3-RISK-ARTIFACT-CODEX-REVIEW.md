# Codex review — canary#2 D3 risk-acceptance artifact

Scope: independent review of `MSG-20260815-214`, `docs/2026-08-16-j2-canary2-d3-settlement-design.md` and the current `bshard-close-enforce.mjs`. This is a design ruling only. It does **not** authorize settlement, DB mutation, signing/broadcast, node action, or deployment.

## Ruling

D3 is materially better than D1/D2 because it stops pretending the missing `side_lock_daa <= deadline_daa` fact can be reconstructed deterministically. Treating that missing admissibility fact as an explicit, market-scoped risk-policy exception is the correct branch of the prior ruling.

However, the current draft is **CONDITIONALLY ACCEPTED / NOT IMPLEMENTATION-COMPLETE**. The commit-once artifact shape is acceptable only after the authority and activation edges below are made machine-binding.

### 1. Leg A activation MUST be artifact-gated — concur

I concur with Bettor's MUST-FIX. `any local row has side_lock_daa == NULL` must not activate the alternate ordering rule. That is a node-local predicate and can make two nodes select different ordering semantics.

The D3 artifact must be the sole activation source for the exception path. No valid artifact => current rules remain unchanged and fail-loud. A valid artifact => the exact exception semantics are activated. This should cover **all D3 exception behavior**, not only Leg C: Leg A ordering and Leg B's altered exclusion semantics should be in the same versioned, market-scoped policy object so that nodes cannot mix rule versions.

### 2. Hash equality against local `pool_markets.metadata` is not sufficient authority

This is an additional MUST-FIX.

The draft says the full artifact lives in git, its blake2b hash is stored in `pool_markets.metadata`, and enforce recomputes the hash. But the same draft also acknowledges that bshard metadata is per-node and is not itself cross-node synchronized/consensus committed.

Therefore `artifact bytes + matching local metadata hash` proves internal consistency, not authorization. A node that can change both local artifact selection and local metadata can still create a self-consistent alternate policy input.

For a policy exception that permits bets without consensus-time admissibility proof, the artifact needs an **independent authority binding**. Minimal acceptable shape:

- canonical bytes with domain separation, e.g. `KANET_CANARY2_ADJUDICATION_V1`;
- exact `market_id` and policy version;
- exact exception scope and disposition (`admitted` for named txids);
- immutable artifact digest;
- signature by the policy authority (Owner is structurally more appropriate than the settlement committee for this risk-acceptance act), verified by enforce against a pinned/approved public key;
- optionally a pinned git blob/commit for availability/audit, but git location alone is not the authority.

`pool_markets.metadata` may cache/reference the accepted digest, but it must not be the sole trust root unless that metadata itself is independently consensus-committed.

### 3. Leg A currently does not have an authenticated whole-market sort-key set

The artifact described in §4 lists the exact **8** exceptional txids, while Leg A switches the **entire 10-row market** to `side_lock_tx` order. The production code then computes `betsRoot`/`refundRoot` from the whole ordered bettor set.

That means the alternate ordering depends on two additional `side_lock_tx` values that are outside the described 8-row adjudication artifact. Saying that a local mutation will later cause a root mismatch is useful fail-loud behavior, but it is not the same as making the alternate canonical ordering input independently authenticated.

Before D3 can be treated as cross-node deterministic authority, the signed artifact (or another independently authenticated source referenced by it) must bind the complete set of sort keys used by Leg A for this market — at minimum all 10 exact `side_lock_tx` values and their bettor/economic row binding. Enforce should compare the loaded rows against that committed set before sorting.

The existing weak-injection artifact is good sensitivity evidence: changing one txid changes ordering/root. It does **not** close provenance of the uncommitted sort keys.

### 4. The known 11th-bettor / complete-set gap cannot disappear outside the policy decision

D3 honestly labels Leg D `PARTIAL`; that honesty is correct. But a canary settlement cannot simultaneously say "the only policy risk being accepted is Leg C" while proceeding with a known unresolved possibility that the loaded economic set omits another bettor.

There are two clean choices before any settlement authority is requested:

1. independently close the complete-set gap; or
2. make the Owner risk artifact explicitly adjudicate the exact economic bettor set for this one market (e.g. the exact 10 rows, count and aggregate commitments), and state that the residual complete-set uncertainty is also being accepted as a bounded policy exception.

If neither is done, Leg D remains a separate open settlement gate. Merely pinning the 8 exceptional rows does not prove there is no 11th bettor.

### 5. Leg B direction is acceptable for j34vb, but verify it through the real anchored committee path

Unconditional bettor exclusion is a conservative direction for conflict-of-interest control, and the reported j34vb observation that both bettor keys are absent from the pool would make it a no-op. For closure, test this through the real `reDeriveCommittee` path that first verifies the rebuilt member tree against the on-chain `poolMerkleRoot`, not only through a standalone/local `selectCommittee` fixture. The pre/post selected committee must be byte-identical for j34vb.

### 6. Required negative/positive tests before implementation can be called safe

In addition to the draft test plan, require:

- no artifact => current NULL-DAA behavior remains fail-loud; no fallback by DB predicate;
- artifact with valid hash but invalid/missing authority signature => fail-loud;
- artifact for another market/version => fail-loud;
- artifact missing or altering any whole-market sort row => fail-loud before root construction;
- local `side_lock_tx` mutation for any of the 10 rows => fail-loud against the authenticated artifact;
- local metadata digest changed to match an unauthorized artifact => still fail-loud because signature/authority check is independent;
- Leg A/C/B cannot be activated independently or under different artifact versions;
- Leg E: the adjudicated bettor rows and amounts remain identical in the economic commitments; no committee exclusion may silently remove economic entitlement;
- complete-set gap either closes independently or is explicitly included in the signed risk decision before settlement.

## Answers to MSG-214

1. **Yes, conditionally.** A commit-once, market-scoped adjudication artifact is the correct shape for the risk-policy branch, but `hash == local metadata` alone is not enough. It must carry an independently verifiable authority binding and an exact bounded scope.
2. **Yes.** Leg A activation must be artifact-gated. I recommend the same single artifact gate control every D3 exception semantic (A/B/C) to prevent mixed-rule execution.
3. **Additional MUST-FIX:** independent signed authority; authenticate the complete whole-market Leg A sort-key set; and do not leave the known complete-set/11th-bettor uncertainty outside the explicit pre-settlement risk decision.

## Current status

- D3 risk-policy framing: **ACCEPTED IN PRINCIPLE**.
- Leg A artifact-only activation: **MUST-FIX / concurred**.
- local metadata hash as sole authority: **REJECTED / MUST-FIX**.
- whole-market `side_lock_tx` provenance: **OPEN / MUST-FIX**.
- Leg B j34vb no-op: **PLAUSIBLE, MUST PASS real anchored committee-path test**.
- Leg D complete-set gap: **OPEN; must close or be explicitly risk-accepted before settlement**.
- implementation/runtime evidence: **NOT YET PRESENT**.
- canary#2 settlement: **FAIL-CLOSED / NOT AUTHORIZED**.
