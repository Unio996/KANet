# Codex independent review — unsynced Oracle permission boundary + PB-S8-2 Candidate B v2

## Git evidence boundary

- bridge compare base: `b09e093bba7054a4dbe77d3e59a7569f5363d13e`
- bridge observed HEAD before write: same commit; canonical five-file blobs unchanged
- active branch compare base: `c9120481055153360e709616393c237f2315d28d`
- active branch observed HEAD: `77d6699b21dca848cbcbfa5508bf5641ffd61169`
- active branch compare: ahead 6 / behind 0
- reviewed source artifacts:
  - `docs/2026-08-03-oracle-skill-interface-permission-boundary-freeze-design.md`
  - `docs/2026-08-03-pbs8-2-candidate-b-implementation-design.md`
  - `kasia-console/src/services/trade-protocol-filter.js`
  - `kasia-relay/src/relay.mjs`

## Verdict

`ORACLE_TYPED_CAPABILITY_DIRECTION_ACCEPTED__ATTESTATION_MUST_BE_A_DOMAIN_SEPARATED_RECEIPT_NOT_A_SIGHASH_ALL_TRANSACTION_SIGNATURE__VALUE_PRESERVING_SELF_OUTPUT_DOES_NOT_BY_ITSELF_PROVE_THE_SIGNED_TRANSACTION_CANNOT_MOVE_OTHER_VALUE__P1_P2_P3_ROLE_SEPARATION_REQUIRES_EXPLICIT_OBJECT_AND_AUTHORITY_SEPARATION__PBS8_CANDIDATE_B_REMAINS_PREFILTER_ONLY__ADDRESS_UTXO_ENUMERATION_IS_NOT_A_STABLE_INPUT_VALUE_OR_CANONICAL_STATE_PROOF__OUTPUT_FIELD_AND_INPUT_SET_ASSUMPTIONS_MUST_BE_VERIFIED_AGAINST_THE_ACTUAL_SERIALIZED_OBJECT__RPC_UNAVAILABILITY_MUST_FAIL_CLOSED_WITHOUT_AUTOMATIC_REFUND_TRANSITION__NO_MONEY_PATH_AUTHORIZATION`

## 1. Oracle permission boundary: direction accepted, but the signed object is still underspecified

The strongest part of the draft is the requirement that the key-holding process must not expose a generic `sign_input_for_settle(tx,input)` capability. That is the correct architectural direction.

However, the draft simultaneously defines P1 as an attestation whose bytes are unaffected by changing bettor payout, while using a transaction-signing mental model. A `SIGHASH_ALL` signature over an attest transaction still commits to the whole serialized transaction, including unrelated inputs and outputs. Therefore a value-preserving self-output clamp does not by itself prove that the oracle cannot authorize movement of other value included in the same transaction.

The durable boundary should be:

- the oracle signs a domain-separated `FactReceipt` / `OutcomeAttestation` object, not an arbitrary transaction;
- the signed object contains no transaction inputs, outputs, addresses, amounts, fees or change;
- the covenant or verifier consumes that receipt and independently checks the transaction authorization conditions;
- the key-holder rejects every request not matching the exact typed schema and domain separator.

At minimum bind: protocol/version, network/genesis, market identity, outcome namespace, evidence commitment, observation/validity bounds, oracle identity, sequence/non-equivocation field, and receipt digest. The receipt must not contain a transaction digest if the intended invariant is that payout changes do not alter P1 bytes.

## 2. The v0.7 precedent needs a narrower claim

`self output value == consolidated_pool` proves a local conservation property for that covenant output. It does not alone prove that the full transaction cannot:

- include additional inputs controlled by another party;
- move unrelated value through additional outputs;
- alter fee/change behavior outside the checked covenant output;
- bind the oracle signature to economically meaningful bytes through transaction-wide sighash semantics.

Before using v0.7 as the generic proof that “committee signatures do not move money,” the design must show the complete transaction-shape constraints and sighash domain, not only the self-output equality line. Until then, the acceptable wording is: “the cited covenant enforces preservation of its own consolidated-pool output at those entries.”

## 3. Role separation must also separate objects and authorities

P1/P2/P3 names are useful, but separation is not mechanical unless each layer has a distinct object and authority:

- P1: signed fact/outcome receipt;
- P2: deterministic condition/payout computation with a canonical input-set commitment and versioned algorithm;
- P3: transaction authorization checked by covenant against the exact P2 commitment.

The same process may calculate P2 for convenience, but it must not gain authority merely because it calculated it. Likewise, a committee membership key and an external-fact oracle key should not be silently treated as the same role because both currently sit behind `is_oracle`.

## 4. PB-S8 Candidate B v2 remains a prefilter, not a payout authorization boundary

The design correctly narrows its own claim to cross-market replacement and gross conservation. Keep that wording. It still cannot prove recipient membership, recipient amount, fee allocation, ordering, duplicate omission, state version, or payout-tree correctness.

The checks can reject obviously wrong candidates early, but successful B checks must not be represented as “safe to sign” once Candidate A is the declared authorization requirement.

## 5. `get_address_utxos` enumeration has several code-level assumptions that need proof

The proposed gross-value check queries all current UTXOs at `market.spine_p2sh` and matches transaction inputs by outpoint. This is useful negative evidence, but it is not a canonical state proof:

- it is a current-node view and can be stale, incomplete or taken after an input was consumed;
- address enumeration is broader than the exact expected predecessor state;
- all transaction inputs are implicitly required to be found under the single spine address; if legitimate phase2 transactions include another input class, the gate will false-reject;
- matching an outpoint and amount does not prove the supplied `utxo`/script data in the serialized transaction is canonical;
- the code sample assumes output amount fields `amountSompi || value`; the actual safe-json transaction object field and numeric encoding must be verified from the builder/serializer rather than guessed;
- JavaScript truthiness fallback is unsafe for legitimate zero-valued fields and heterogeneous string/BigInt representations.

A stronger implementation should query each exact expected outpoint or an authoritative predecessor-state commitment, verify script/public-key-script and amount, reject unexpected input classes, and parse one canonical amount field with strict type/range checks.

## 6. First-input spine identity is not full input-set identity

Checking only `inputs[0] == market.spine_lock_tx:0` does not prevent:

- extra unexpected inputs;
- duplicate inputs;
- reordered or substituted secondary spine inputs;
- stale state-version inputs belonging to the same market;
- an otherwise valid first input paired with malicious additional value sources.

Candidate B should define the complete allowed input-class policy and deterministic ordering. Candidate A must bind the exact input outpoint set.

## 7. RPC failure semantics must not cause an automatic money-path downgrade

The v2 threat-model correction is important: repeated inability to verify can manipulate lifecycle progression into refund. The correct safety rule is:

`verification unavailable -> verifier inconclusive -> no signature and no automatic refund authorization`

This needs a state-machine invariant, not only counters and alerts. Deadline expiry must not transform missing verifier evidence into permission to execute a different irreversible money path. Any refund transition remains separately authorized and separately proven.

## Required closure evidence

Before either design is frozen as an authorization boundary:

1. exact typed attestation schema and domain-separated digest;
2. proof that the key-holder has no generic transaction-signing entrypoint reachable by the oracle role;
3. full v0.7 transaction-shape and sighash analysis supporting the claimed precedent;
4. handler-level tests asserting zero signer calls on RPC error, missing/extra input, stale outpoint, malformed amount, excessive outputs and payout-object tampering;
5. a test proving verification outage cannot route the market into an automatic refund/broadcast path;
6. Candidate A canonical input-set and output-set recomputation/binding design.

No deployment, signing, broadcasting, settlement, refund, restart or other production/test-asset money-path action is authorized by this review.
