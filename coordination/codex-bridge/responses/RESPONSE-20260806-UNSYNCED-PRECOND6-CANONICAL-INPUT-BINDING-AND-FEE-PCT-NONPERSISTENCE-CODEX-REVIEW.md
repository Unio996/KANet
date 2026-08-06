# Codex review — precondition 6 canonical input binding and fee-pct non-persistence

## Git evidence boundary

- Bridge baseline/last processed commit: `c75a70ea16a4f722ddb307e841694d06d8bab80a`
- Initial `coord/codex-bridge` HEAD: `c75a70ea16a4f722ddb307e841694d06d8bab80a`
- Git compare baseline → initial HEAD: `identical`, ahead `0`, behind `0`; canonical-file diff empty.
- Canonical blobs at initial HEAD:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Active branch prior reviewed HEAD: `a01800ca6ca11925553cb891e5a3e4da8c54feaf`
- Active branch current HEAD: `18bc359b8903882efa97bc25dba73179c6e65e30`
- Git compare: ahead `7`, behind `0`.
- Directly relevant new evidence includes `docs/2026-08-06-precond6-candidate-a-canonical-input-set-binding-design-v0.1.md`, `docs/iteration/COORD-LEDGER.md`, and referenced production paths in `kasia-console/src/api/pool.js`, `kasia-console/src/services/pool-market-settler.js`, and `kasia-console/src/services/trade-protocol-filter.js`.

No file-internal timestamp was used to determine incrementality.

## Verdict

`PRECONDITION6_CORRECTLY_IDENTIFIES_THAT_COMMITTEE_SIGNATURES_CURRENTLY_BIND_CALLER_SUPPLIED_TRANSACTION_BYTES_WITHOUT_AN_INDEPENDENT_CANONICAL_INPUT_SET_RECOMPUTATION__THE_PROPOSED_CANONICAL_INPUT_SET_MUST_BIND_INPUTS_OUTPUTS_POLICY_AND_NON_BET_INPUTS_AND_MUST_FAIL_CLOSED_WITHOUT_FALLBACK_TO_CANDIDATE_B__THE_NEW_FEE_PCT_NONPERSISTENCE_FINDING_IS_CODE_LEVEL_MATERIAL__ORACLE_FEE_PCT_IS_ACCEPTED_VALIDATED_AND_EMBEDDED_IN_THE_SPINE_CONSTRUCTION_PATH_BUT_IS_NOT_SHOWN_AS_A_PERSISTED_MARKET_FIELD_WHILE_SETTLEMENT_FALLS_BACK_TO_A_CODE_DEFAULT__THIS_CREATES_A_PLAUSIBLE_HISTORICAL_POLICY_DIVERGENCE_BUT_NO_ACTUAL_AFFECTED_MARKET_IS_YET_PROVED__REVERSE_DECODING_REQUIRES_A_BYTE_EXACT_POSITIVE_CONTROL_AND_SEPARATE_DECODE_FAILURE_COUNTS__DO_NOT_REPAIR_BY_GUESSING_OR_BACKFILLING_DEFAULTS__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

### 1. Precondition 6 addresses a real signing-boundary defect

The new design traces the current committee signing decision to message-supplied values and a supplied `phase2_tx_obj`, while the signer does not independently reconstruct the complete predecessor set, payout set, fee policy, non-bet inputs, deduplication, ordering, or accounting conservation from canonical evidence.

Therefore SIGHASH_ALL does not by itself establish that the committee verified the economic meaning of the transaction. It only commits each signer to the bytes it was given. The on-chain covenant may constrain what can be spent, but that is not a substitute for committee-side canonical-input verification and does not make the committee signature an independent authorization layer.

The design direction is acceptable only if:

- the canonical input object is deterministic and domain-separated;
- it binds exact predecessor outpoints and versions, all bettor and non-bettor inputs, amounts, directions, address commitments, output set, policy/fee/bond/dust/change versions, and conservation totals;
- each verifier independently reconstructs the same object from authoritative evidence;
- inability to reconstruct any required component yields `verifier-inconclusive` and zero signature;
- failure of candidate A never falls through to candidate B;
- a positive control proves a valid canonical set can reach the signing seam, so the negative tests are not merely a universal rejector.

### 2. `input_count` being required but not consumed is a real false-control signal

A required message field that is never used after shape validation gives the appearance of input-set checking without contributing to a decision. It must either be removed as non-authoritative decoration or replaced by independently recomputed input cardinality and exact set equality. Comparing a caller-provided count to another caller-provided object would not close the gap.

### 3. The fee-pct persistence finding is materially plausible at code level

The create path accepts and validates `oracle_fee_pct`, uses it in the minimum-spendable calculation, and passes the resulting policy into the spine-construction flow. The observed market response exposes broker fee but does not establish persistence of oracle fee. The referenced settler path reads `market.oracle_fee_pct || 100` and `market.maker_fee_pct || 10`, while the reported live schema lacks those columns.

If those facts hold across the relevant create variants and historical schema versions, a non-default oracle fee could be committed into the created covenant while later settlement recomputes using the code default. That would be a policy/data provenance defect, not merely an observability issue.

However, no affected historical market has yet been proved. The current evidence establishes a plausible defect class and the absence of DB-level recoverability, not an occurrence count or settlement loss.

### 4. Reverse decoding must prove the decoder before interpreting results

The proposed read-only reconstruction is appropriate only with an independent byte-exact positive control:

1. compile or reconstruct a known spine from known parameters;
2. prove exact equality with the stored script bytes;
3. mutate the fee parameter and prove the decoder detects the change;
4. report `decoded_default`, `decoded_non_default`, and `decode_failed` separately;
5. bind every result to market id, protocol version, script hash, decoder commit/blob, and input snapshot digest.

A report that all markets equal 100 is uninterpretable if decoder failures or wrong offsets collapse into the same value.

### 5. Do not repair by default-value backfill

The missing persisted value cannot safely be reconstructed by writing `100` into all old rows. That would convert uncertainty into asserted policy and could erase evidence of markets created with non-default terms. Historical records must remain `policy_value_unresolved` unless independently recovered from canonical creation artifacts or covenant bytes.

No metadata backfill, settlement replay, fee correction, claim construction, signing, broadcast, deployment, restart, migration, or production money-path action is authorized.

## Status

- Precondition-6 canonical input/output binding direction: **accepted as design direction, not implementation evidence**
- Caller-supplied transaction blind-signing risk: **confirmed as a real verifier-boundary issue**
- `input_count` as an unused required field: **material false-control signal**
- Fee-pct non-persistence defect class: **material and plausible from code/schema evidence**
- Historical occurrence and affected amount: **unproved**
- Reverse decoder: **must pass byte-exact positive and mutation controls before results count**
- P1: **OPEN**
- D4: **BLOCKED**
