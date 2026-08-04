# Codex review — unsynced precondition ②-a magnitude estimate and Oracle permission-boundary contract v0.5

- review_scope: active development branch changes after `31a873021ca79723b2b6e3df5572be331d4ce326`
- bridge_baseline: `6e62bc873dc168f2a86afee56636b6cad337dd8c`
- bridge_compare: identical; canonical five-file blobs unchanged
- authority: review only; no authorization for implementation, deployment, signing, refund, settlement, migration, restart, or any production/test-asset money-path action

## Verdict

`PRECOND2A_MAGNITUDE_ESTIMATE_IS_A_MEANINGFUL_AND_HIGH_SEVERITY_INVENTORY__PER_MARKET_KEY_LOCALITY_IS_THE_CORRECT_RISK_QUESTION__PROPOSED_ZERO_MARKET_METRIC_CONFUSES_KEY_CUSTODY_WITH_AUTHORIZED_CAPABILITY__ROLE_LABEL_PROPAGATION_ALONE_CANNOT_CREATE_A_TRUST_BOUNDARY__ECDSA_SIGN_AND_SIGN_INPUT_FOR_SETTLE_MUST_BE_REPLACED_BY_TYPED_DOMAIN_RESTRICTED_CAPABILITIES__ORACLE_CONTRACT_V05_CORRECTLY_IDENTIFIES_SUPERSEDE_AS_AN_AUTHORIZATION_ACTION__THRESHOLD_AND_SET_AUTHORITY_CANNOT_BE_PROVED_INSIDE_A_SINGLE_SIGNER_RECEIPT__POLICY_VERSION_REMAINS_MISPLACED_IN_P1__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

### 1. The per-market measurement corrects the earlier wrong question and materially raises severity

Counting `relay_nodes.is_oracle=1` is not the relevant quorum-risk predicate. The relevant predicate is, for each concrete market, how many public keys in that market's committee can be exercised by one host. The reported full-set result — 41 markets at 5/5 locality and 22 additional markets at threshold-or-more locality — is therefore the right class of measurement and is materially more severe than the earlier machine-wide flag count.

This is still an operational observation, not yet a cryptographic proof. The retained evidence must include the exact script blob/commit, database snapshot identity, committee-row selection predicate, address-to-public-key conversion, deduplication rule, threshold source, and the complete machine-key inventory used by the join. Without those, the figures are important but not reproducible.

### 2. The proposed acceptance metric "markets locally signable at threshold goes from 63 to 0" is not yet well-defined

The target property is:

> a committee-key process has no path to sign bytes that decide who receives how much.

That property can become true while the same host still physically stores four or five committee keys. If the post-change measurement merely joins committee public keys against locally present private keys, it will remain 63 even after a correct typed-capability redesign. Conversely, deleting or disabling keys could make the number zero while leaving a generic transaction-signing primitive structurally available whenever keys are reintroduced.

Therefore two independent metrics are required:

1. **custody-locality metric**: markets for which one failure domain stores keys meeting threshold;
2. **effective-authority metric**: markets for which one failure domain can cause threshold authorization over payout-determining bytes through production interfaces.

The second must execute the real IPC/API surfaces and prove that arbitrary transaction bytes, arbitrary strings, payout roots, recipient addresses, per-bettor amounts, and settlement transaction digests cannot reach signing. Reducing custody locality is desirable but is a separate key-management/topology objective; it must not be used as the sole proof of interface least authority.

### 3. Propagating a role label to the key-holding process is necessary for accounting, but insufficient for security

The estimate correctly observes that the relay currently does not know a committee role and that policy exists in callers. However, simply passing `role=committee` or migrating `is_oracle` into the relay does not establish a trust boundary if the caller can choose or influence that label.

The key-holding side must derive capability from authenticated provisioning/configuration bound to a key identity, process identity, network, and allowed object schema. The request must not be able to self-assert its role. A secure design needs:

- immutable or authenticated key-to-capability binding;
- typed request parser with strict unknown-field rejection;
- domain-separated digest construction inside the key-holding boundary;
- no caller-supplied raw digest escape hatch;
- no generic string-signing or arbitrary transaction-input signing for committee keys;
- explicit separation of operator emergency keys from committee keys and endpoints;
- audit records binding request schema, key identity, policy version of the verifier, and result.

### 4. Inventorying both generic primitives is a real design gain

Finding both `sign_input_for_settle` and `ecdsa_sign`, and showing that the latter is shared by committee, maker, coordination, and parameter-cache paths, demonstrates that this cannot be fixed by closing one endpoint or by a relay-ID allowlist. The correct migration unit is the signed object type and its authorized semantics.

The implementation plan must enumerate every production and test call site, classify the key role and signed object, assign a replacement typed capability, and fail the migration if any generic primitive remains reachable by committee keys. Operator fallback must use a separately provisioned capability and must not preserve a generic committee-key transaction signer under another route.

### 5. v0.5 correctly recognizes supersede as an authorization action, but places threshold proof at the wrong object layer

The new requirement that a correction cannot be authorized merely by a higher sequence number is correct. A supersede operation must be authorized by an eligible signer set under an explicit threshold and committee-set rule.

However, a single-signer `FactReceipt` cannot itself prove that the required threshold was met. Threshold, unique signer membership, committee-set commitment, ordering, duplicate rejection, and equivocation handling belong in a separate `QuorumEnvelope` or aggregate proof object. The verifier should evaluate:

- each individual typed receipt;
- signer membership for the bound committee epoch/set;
- unique signer count and threshold;
- conflict/equivocation rules;
- supersede relationship and authority relative to the superseded envelope.

The individual receipt may bind the committee-set identifier and supersedes target, but it must not claim that threshold authority exists by itself.

### 6. `policy_version` remains misplaced in P1

The v0.5 table still requires P1 to bind the P2 payout/interpretation policy version and describes the invariant under a fixed fact and policy version. This re-couples the fact signer to downstream economic interpretation.

The object separation should remain:

- **FactReceipt / OutcomeAttestation**: what happened, evidence anchor, market state, network, signer identity, epoch, freshness, correction linkage;
- **QuorumEnvelope**: which eligible signer set authorized that fact/correction and under what threshold;
- **ConditionReceipt / InterpretationResult**: how a named policy version maps the attested fact and canonical input set to a payout commitment;
- **SettlementAuthorization**: exact predecessor state and exact serialized transaction semantics authorized for execution.

A payout-policy upgrade should not require P1 to re-sign an unchanged historical fact. Replay safety should be achieved by binding market state/evidence/epoch/freshness in P1 and binding the selected P1 envelope plus policy version in P2/P3.

### 7. Failure ordering remains constrained by the refund-path defect

The estimate correctly notes that tightening signing authority can increase abstention or signing failure. Such failure must remain `verifier-inconclusive / unresolved-needs-authorization`, with zero automatic refund, zero claim construction, zero signing, and zero broadcast. The interface restriction must not be deployed ahead of verified closure of every timeout/committee-unformed/refund-event consumer path that could convert inability to sign into an irreversible refund.

## Required closure evidence

Before precondition ②-a can move from OPEN, provide at minimum:

1. reproducible custody-locality measurement evidence and a separately defined effective-authority test;
2. complete generic-signing call-site inventory with replacement mapping;
3. authenticated key-to-capability provisioning design that callers cannot self-assert;
4. implemented typed digest builders inside the key boundary, with fixed vectors and unknown-field rejection;
5. proof that committee keys cannot reach arbitrary-string, arbitrary-digest, or arbitrary-transaction signing;
6. separate QuorumEnvelope implementation and negative tests for weak supersede, duplicate signers, wrong epoch/set, equivocation, and stale receipts;
7. removal of payout `policy_version` from P1 and binding it at P2/P3;
8. end-to-end negative tests proving signer and broadcaster calls remain zero on every inconclusive path, including restart/replay of historical refund events.

No money-path authorization is granted by this review.
