# Codex review — P1 scope contraction without semantic closure

## Git basis

- Last processed/written bridge commit: `8ca78f1fe7c00694a2c7b77086e4564d3baa6408`
- Initial `coord/codex-bridge` compare against that commit: `identical` (`ahead_by=0`, `behind_by=0`)
- Canonical bridge file path diff: none
- Active branch inspected: `bshard-m3-deploy`
- Active branch HEAD observed: `c7fc3f96ba98e62fde5dfa22eb8a62c86c43e822`
- Latest directly relevant source commit: `c7fc3f96ba98e62fde5dfa22eb8a62c86c43e822`
- Directly relevant changed object: `docs/2026-08-04-precond2a-merged-magnitude-estimate.md`

## Verdict

`P1_SCOPE_CONTRACTION_IS_ACCURATE__CALL_SITE_CLOSURE_IS_NOT_EVIDENCE_SEMANTIC_CLOSURE__THE_EXISTING_POSITIVE_CONTROL_IS_AN_ADVERSE_TEST_VECTOR_NOT_A_VALID_AUTHORIZATION_CONTROL__NO_NEW_CODE_OR_EXECUTABLE_EVIDENCE_CLOSES_THE_GAP__TYPED_AUTHORIZATION_MUST_BE_DERIVED_FROM_VERIFIED_EVIDENCE_AND_BOUND_TO_EXACT_STATE_AND_ACTION__NO_MONEY_PATH_AUTHORIZATION`

## Independent judgment

The new branch commit correctly narrows the prior P1 claim. The shared helper and two observed IPC gates support only these properties:

1. both observed refund dispatch paths call one helper;
2. missing, malformed, unknown and legacy labels are rejected;
3. a historical `bettor_refund_available` event is not sufficient by itself to dispatch a refund.

They do **not** establish that a permitted label is true. The current positive fixture remains direct counter-evidence: `M_AUTHED` carries `refund_authorization=bettors_absent` while the same fixture inserts a bettor side. A green result therefore proves that a factually contradictory label can authorize the path. It must be retained as a required red test for the replacement verifier, not described as a valid positive authorization control.

The latest commit changes documentation honesty, not the production authorization property. No new implementation, typed evidence object, authority validation, canonical-state binding, negative semantic test, signer-zero trace or broadcaster-zero trace was supplied in this increment. P1 therefore remains OPEN.

## Required closure property

A refund permission must be derived from evidence rather than trusted from a conclusion string:

```text
canonical typed evidence
+ trusted deterministic verifier or authorized signed issuer
+ exact network / market / predecessor-state binding
+ freshness, uniqueness, expiry, revocation and supersede checks
+ exact permitted action and amount/transaction scope
→ typed RefundAuthorization
→ shared transaction-level gate
```

The replacement must reject at least:

- `bettors_absent` while any canonical bettor input/side exists;
- committee conclusion without a valid quorum envelope;
- structural-invalid conclusion without reproducible structural proof;
- below-minimum conclusion when canonical value meets the threshold;
- owner authorization without valid signature, authority, scope or freshness;
- authorization copied across market, network, predecessor state or transaction;
- stale, replayed, revoked or superseded authorization;
- direct metadata insertion of a permitted label without its typed evidence.

Do not deploy the typed authorization migration while an inconclusive verifier, missing evidence or rejected authorization can still route automatically to refund, claim construction, signing or broadcast.

No production/test-asset refund, claim, signature, broadcast, settlement, migration, restart or deployment is authorized by this review.
