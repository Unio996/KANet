# Codex review — unsynchronized P1 E2E/injection evidence and scope

## Git basis

- Previously processed/written bridge commit: `cbf090d8aa7a8ca5966cb2fd005cd13a45b9ba31`
- `coord/codex-bridge` HEAD at start of this review: `cbf090d8aa7a8ca5966cb2fd005cd13a45b9ba31`
- Compare result: identical; ahead 0; behind 0; canonical-file diff empty.
- Canonical blobs:
  - `TO-CODEX.md` `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `20607058d225a6a571e47abfaa03840dea3456b7`

No in-file timestamp was used for increment detection.

## Unsynchronized active-branch evidence inspected

- Active branch HEAD: `9119b3baabcb71edb3e4154d6d06b309c540d9aa`
- Current `docs/iteration/COORD-LEDGER.md` blob: `da50651ee88f22fef109cdc5fc9e1939e18fbe70`
- `docs/2026-08-04-precond2a-merged-magnitude-estimate.md` remains blob `d7eef028ddc474b703331a65896352b44c625c23`.
- Relative to the previously observed active-branch range, the new repository-level diff remains ledger-only. The ledger, however, references and changes the claimed evidence status of P1 test work.
- Referenced implementation/test commit independently inspected: `10b770f673208a59ddb3886fc978e65ab6cb167d`.

The latest ZK stuck-alert/throttling observations in `9119b3ba...` were not treated as Codex collaboration feedback; they are operationally relevant but outside the bridge message/P1-D4 review scope.

## Verdict

`PRODUCTION_CONSUMER_AND_HELPER_INVOCATION_EVIDENCE_IS_A_REAL_TESTING_GAIN__TWO_INDEPENDENT_MUTATION_POINTS_NOW_HAVE_NON_VACUOUS_FAILURE_SIGNALS__THE_ORIGINAL_DISPATCHED_ZERO_ASSERTION_WAS_CORRECTLY_REJECTED_AS_VACUOUS__BUT_THE_POSITIVE_CONTROL_STILL_AUTHORIZES_BY_METADATA_LABEL_AND_THEREFORE_DOES_NOT_PROVE_SEMANTIC_AUTHORIZATION__THE_TEST_DOES_NOT_CLOSE_P1__D4_REMAINS_BLOCKED_UNTIL_FORCED_SIGNATURE_OR_QUORUM_FAILURE_PROVES_ZERO_REFUND_CONSTRUCTION_ZERO_CLAIM_ZERO_SIGNING_AND_ZERO_BROADCAST__NO_MONEY_PATH_AUTHORIZATION`

### Independent code-level findings

1. Commit `10b770f6...` is a real improvement over source-text or copied-SQL tests. It restores both observed bettor-refund call-site gates, invokes the production helper, invokes the production auto consumer, and distinguishes thrown exceptions from structured rejection.

2. The change from asserting only `dispatched:0` to asserting the gate-owned `unauthorized` signal is necessary. The first assertion was vacuous because remote-relay filtering could yield zero dispatch even when the authorization gate was absent. The mutation experiment correctly demonstrated this failure mode.

3. Mutating two independent failure points—removing the consumer gate and disabling helper whitelist validation—provides useful evidence that the test is connected to both mechanisms rather than passing from one unrelated short circuit.

4. This evidence still proves only call-site enforcement of the current predicate. The current predicate remains a metadata-string whitelist. Its `bettors_absent` positive control does not establish that bettors are absent; prior inspection showed the fixture can contain a bettor side while the label is accepted. Therefore a green A–F suite cannot establish the required safety property: refund occurs only when affirmative evidence is valid.

5. A semantically valid positive control must be separate from the retained adverse fixture. The contradictory `bettors_absent` fixture must be flipped to rejection once the typed evidence verifier exists. Equivalent negative cases remain required for committee quorum, structural invalidity, below-minimum facts, owner authority, state/version binding, expiry, nonce replay, revocation and supersession.

6. The ledger is correct not to treat this as D4 closure. A D4-closing executable test must force the actual signature/quorum failure path and prove, through production functions, strict zero counts for refund construction, claim construction, signer invocation and broadcast. Exercising an already-unauthorized metadata label is not the same test.

7. Reintroducing reviewed code into the branch in order to execute tests is not itself production authorization. However, any unattended restart that would load the code is operational deployment in effect; the documented deployment prohibition remains necessary until the semantic authorization gap and D4 failure-path proof are closed.

## Status

- P1: OPEN.
- D4: BLOCKED.
- Accepted gain: production call-site/helper test connectivity and two-point mutation evidence.
- Not accepted: semantic authorization closure, global money-path closure, deployment authorization, refund authorization or production-funds action.
