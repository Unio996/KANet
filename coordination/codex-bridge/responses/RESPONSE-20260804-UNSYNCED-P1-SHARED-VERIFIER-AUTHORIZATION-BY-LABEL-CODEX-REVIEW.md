# Codex review — unsynced P1 shared refund verifier

## Scope and provenance

- Bridge compare baseline: `2a0170f04751977b6cd11578f7820dd86bc63017`
- Bridge ref: `coord/codex-bridge`
- Bridge compare result at review start: identical, ahead 0, behind 0
- Canonical bridge blobs:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e140f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Active branch compare: `31a873021ca79723b2b6e3df5572be331d4ce326...bshard-m3-deploy`
- Active branch result: ahead 30, behind 0
- Reviewed source blobs:
  - `kasia-console/src/lib/refund-authorization.mjs`: `c529eb7dd817b7bc3f691cee4aab6fff0ed17b11`
  - `kasia-console/src/api/pool.js`: `c6678e0ecee22eefeb8ce8660affd3dd65041bf6`
  - `kasia-console/src/services/bettor-refund-claim-auto.mjs`: `0ef9b3e97c4223de72855e41de4d344199ae3ee8`

Increment detection used Git compare, blob identity, and actual changed paths/content only. No document-authored timestamp was used.

## Verdict

`SHARED_TRANSACTION_LEVEL_REFUND_GATE_IS_A_REAL_ARCHITECTURAL_GAIN__BOTH_OBSERVED_IPC_CALL_PATHS_NOW_INVOKE_ONE_FUNCTION_BODY__HISTORICAL_EVENT_REPLAY_IS_NO_LONGER_SUFFICIENT_BY_ITSELF__BUT_CURRENT_VERIFIER_AUTHORIZES_BY_UNTRUSTED_METADATA_LABEL_NOT_BY_PROVED_EVIDENCE__POSITIVE_CONTROL_ITSELF_DEMONSTRATES_BETTORS_ABSENT_CAN_PASS_WHILE_A_BETTOR_SIDE_EXISTS__OWNER_AUTHORIZED_HAS_NO_SIGNED_REFERENCE_OR_AUTHORITY_VALIDATION__STRUCTURALLY_INVALID_AND_COMMITTEE_AFFIRMATIVE_VALUES_ARE_NOT_RECOMPUTED_OR_BOUND_TO_CANONICAL_EVIDENCE__P1_BYPASS_NOT_CLOSED__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

### 1. One shared verifier at both observed money-moving call paths is a material improvement

`buildBettorRefundClaim()` invokes `assertBettorRefundAuthorized()` immediately after loading the market and before relay resolution or the `pool_side_refund_cancelled_tx` IPC. The auto-claim consumer invokes the same exported function at the start of each side loop before relay matching and before its direct IPC call.

This closes the previously identified structural defect in which a persistent `bettor_refund_available` audit event could by itself regain effective authority after restart or replay. The authorization decision is now re-evaluated at each observed transaction-construction/dispatch path rather than inherited from the event.

This is an architecture-level gain. It is not yet proof that refund authorization itself is sound.

### 2. The verifier currently proves only that a metadata string is whitelisted

The production verifier reads `pool_markets.metadata.refund_authorization`, checks that it is a string, and accepts it when the string belongs to a fixed enum. It does not verify the evidence claimed by that label.

Therefore the current security property is effectively:

```text
someone or some code wrote an accepted word into mutable market metadata
→ refund authorized
```

That is authorization by label, not authorization by independently validated evidence.

The real boundary must instead be:

```text
canonical evidence object
+ trusted issuer / deterministic verifier
+ market and predecessor-state binding
+ freshness / non-revocation / uniqueness rules
→ typed RefundAuthorization
→ transaction-level gate
```

A whitelist is useful only after the evidence-producing path for every enum member is itself authenticated, typed, and independently verified.

### 3. The positive-control fixture directly exposes the `bettors_absent` contradiction

The test market `M_AUTHED` is assigned `refund_authorization="bettors_absent"`, and the same setup then inserts a `pool_bettor_sides` row for every test market, including `M_AUTHED`. The helper is expected to return `ok:true` solely because the label is present.

Thus the positive control demonstrates that the production verifier accepts `bettors_absent` while a bettor side exists in the same database fixture. This is not merely missing test depth; it proves the helper does not validate the semantic truth of the authorization it accepts.

`bettors_absent` must not be a bare enum value. At minimum it needs a versioned evidence object and deterministic checks over the canonical market state. Because the current design itself marks the evidence as local-only, it must not authorize irreversible movement until the required chain/state completeness proof exists.

### 4. Other whitelist members have the same unproven-label problem

- `committee_affirmative_unjudgeable` must bind a threshold-valid, unique-signer quorum envelope over typed ABSTAIN attestations for the exact market state/version. A string in metadata proves none of those properties.
- `structurally_invalid_market` must be produced by a deterministic structural verifier over canonical chain objects and bind its exact findings and verifier version. A label does not prove commingling or any other defect.
- `pool_below_minimum` must bind the canonical stake/input set, the applicable threshold policy/version, and the exact measured value. A mutable label does not prove the pool was below minimum.
- `owner_authorized` must carry a signed authorization reference, authorized owner identity/key, scope, market/state binding, action, amount or transaction commitment, expiry, nonce, and revocation/supersession semantics. The current helper validates none of these.

Until each member has a typed evidence schema and a trusted production writer/verifier, any process with write access to `pool_markets.metadata` can mint refund authority by inserting an allowed word.

### 5. `protocol_status` is loaded but not used as an authorization constraint

The verifier selects `protocol_status` but never evaluates it. This is not necessarily wrong by itself, because status must not substitute for evidence. However it means a valid-looking metadata label can remain effective across later state transitions unless a separate revocation or exact-state binding is enforced.

Authorization must bind an exact predecessor state/version or outpoint and be consumed or invalidated deterministically. It must not float indefinitely on a market row.

### 6. Current regression meaning must be narrowed

The production-consumer regression can support the following claim:

> Both observed standalone PoolSide refund IPC paths call the same helper; missing, malformed, unknown, old-field, and frozen-without-label cases are rejected, and historical refund events alone do not authorize dispatch.

It cannot support:

> Refunds occur only when affirmative refund evidence is valid.

The latter remains unproved because the helper never validates the evidence behind accepted labels. Required negative tests include at least:

- `bettors_absent` label with one or more canonical bettor inputs/sides present → reject;
- committee label without a valid threshold envelope, with duplicate signers, wrong market/state, stale epoch, or equivocation → reject;
- structurally-invalid label without reproducible structural proof → reject;
- below-minimum label with canonical value at/above threshold or wrong policy version → reject;
- owner label without a valid signed scoped authorization, or with wrong market/state/expiry/nonce → reject;
- accepted authorization copied to another market or state version → reject;
- authorization revoked or superseded before IPC → reject;
- DB writer directly inserts a whitelisted label without the typed evidence object → reject.

### 7. Required architecture correction

Replace the free-form metadata string with a typed, versioned authorization record whose evidence is verified in the same transaction-level helper. A minimal shape should bind:

```text
authorization_id
schema_version
authorization_type
network/genesis
market_id
predecessor_state_version or outpoint
evidence_digest + typed evidence reference
issuer/verifier identity and capability
policy/verifier version
created/finality anchor
expiry
nonce
supersedes/revocation state
permitted action
exact value scope or transaction commitment
```

The helper must reject a label without its required evidence and must derive the authorization result from the evidence, not trust a caller-written conclusion field.

## Status

The shared-gate placement and replay defense are accepted as real progress. P1 remains **OPEN** because accepted authorization values are presently self-asserted metadata labels rather than independently proven capabilities.

No refund, claim construction, signing, broadcasting, settlement, migration, deployment, restart, or production/test asset money-path action is authorized by this review.