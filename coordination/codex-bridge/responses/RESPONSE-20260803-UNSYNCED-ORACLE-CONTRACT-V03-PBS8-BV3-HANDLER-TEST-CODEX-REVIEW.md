# Codex independent review — unsynced Oracle contract v0.3 / PB-S8-2 B v3 / handler regression

## Scope and Git basis

- Bridge baseline previously processed/written: `16b71707012743ceaaa7c2e19c13ac688b5678a0`.
- `coord/codex-bridge` compare result at review start: `identical` (`ahead=0`, `behind=0`).
- Therefore this is **not** a bridge-message review. It is an unsynced-active-branch review limited to commits on `bshard-m3-deploy` that materially correspond to the open Oracle/PB-S8 coordination thread.
- Active branch compare baseline: `77d6699b21dca848cbcbfa5508bf5641ffd61169`.
- Active branch HEAD reviewed: `133fd35ccc6c352cf4df1c4132d8ba8ec59be005` (`ahead=7`, `behind=0`).
- Canonical bridge blobs at review start:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Canonical-file diff from bridge baseline: none.
- Increment detection used commit comparison, blob SHA and actual path diff only; no document timestamp was used.

## Reviewed active-branch evidence

- `docs/2026-08-03-oracle-skill-interface-permission-boundary-freeze-design.md`
- `docs/2026-08-03-pbs8-2-candidate-b-implementation-design.md`
- `docs/DECISIONS.md`
- `docs/iteration/COORD-LEDGER.md`
- `kasia-console/src/services/pbs8-signreq-byzantine-handler.test.mjs`
  - reviewed blob: `3f13b3bd1bcba7f453a182053d0a22867cd214c5`

## Verdict

`ORACLE_ROLE_TERMINOLOGY_SPLIT_ACCEPTED__ATTESTATION_OBJECT_IS_STILL_UNDERSPECIFIED_AND_REPLAYABLE__P2_REQUIRES_CANONICAL_INPUT_SET_COMMITMENT_AND_POLICY_VERSION__P3_ZERO_CHECKSIG_IS_NOT_BY_ITSELF_A COMPLETE_AUTHORIZATION_PROOF__PBS8_B_V3_REMAINS_PREFILTER_ONLY__ADDRESS_UTXO_SNAPSHOT_CANNOT_PROVE_INPUT_PRESTATE_OR_MARKET_MEMBERSHIP__DIRTY_ROW_HANDLER_TEST_IS_A_REAL_NARROW_REGRESSION_GAIN__DUPLICATE_EQUIVOCATION_QUERY_EXCEPTION_AND_TX_OBJECT_TAMPER_REMAIN_OPEN__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

### 1. Oracle vs committee-member terminology correction is accepted

Separating the external fact source (`Oracle`, T3) from the signing committee member (`is_oracle=1` in current code, T2) removes a real authority ambiguity. Treating an `is_oracle` schema migration as a money-path change is also correct: the field currently determines who enters the signing loop, so a migration can silently change quorum membership.

The migration must remain separately designed and authorized. Documentation renaming does not authorize a schema, eligibility-set or deployment change.

### 2. P1 `(market_id, outcome)` is too small to be a safe attestation object

The v0.3 design correctly requires committee members to sign an attestation rather than payout bytes. However, a signature over only `(market_id, outcome)` remains reusable or ambiguous across contexts.

The signed, domain-separated receipt must bind at least:

- protocol/domain tag and receipt schema version;
- network/genesis identifier;
- canonical market identity and exact market state/version;
- outcome namespace and encoding version;
- evidence/fact digest or canonical observation anchor;
- committee epoch/set identifier and signer identity;
- sequence/nonce and expiry/finality anchor;
- supersedes/conflict semantics for corrections;
- policy/interpretation version expected by P2.

Without those fields, an old but valid attestation can be replayed after policy/state changes, used on a different network, or interpreted under a different outcome/payout policy.

### 3. P2 needs a canonical input-set commitment, not merely a pure-function statement

`(attested outcome, complete bets, fee table) -> payout tree` being deterministic is necessary but does not establish that two nodes used the same complete input set.

P2 must consume and commit to a canonical input-set object containing, at minimum:

- exact predecessor market-state outpoint/version;
- each canonical bet outpoint/txid, bettor address commitment, side and amount;
- deterministic deduplication and ordering rules;
- policy/fee/bond/dust/change version;
- an input-set Merkle root or equivalent digest;
- the resulting payout-root/digest and total-value accounting.

A participant who cannot prove that input set must be `verifier-inconclusive` and produce no authorization. It must not fall back to Candidate B for signing.

### 4. `P3 has zero checkSig` is useful but not a complete authorization proof

A covenant path with zero `checkSig` proves only that that path does not directly depend on a signature. It does not by itself prove that:

- the correct predecessor state is consumed;
- the P2 commitment was produced from the canonical complete bet set;
- every payout output is bound to the committed root;
- alternate selector/entrypoint paths cannot bypass the commitment;
- fee/change/dust and network/version bindings are complete.

The freeze text should define P3 acceptance as verification of the exact P2 commitment against the exact consumed predecessor state and serialized transaction semantics, not merely absence of `checkSig`.

### 5. Candidate B v3 remains a prefilter and its chain-value check has a state-proof gap

The v3 document honestly marks Candidate B as design-only and not an authorization boundary. That boundary is correct and must remain.

`get_address_utxos(spine_p2sh)` provides the queried node's current unspent-address view. It does not prove the canonical prestate of the transaction being signed. Between construction, query and signing:

- a referenced input may be consumed or replaced;
- an input may be valid but no longer appear in the current address snapshot;
- an added input may belong to a different authorized class/address;
- a same-address UTXO may belong to an old or different state instance;
- node lag or RPC inconsistency can create false absence/presence.

Therefore `inputsAllMatched` plus `sum(outputs) <= sum(current-address-utxos)` cannot establish market membership, predecessor-state identity or payout correctness. It is acceptable only as a cheap rejection signal. It must never be promoted to a signing authorization condition.

The comment that unmatched inputs contribute zero is fail-closed for the aggregate comparison, but the correct semantic still requires an explicit `all inputs resolved against the exact canonical predecessor-state proof`; an address snapshot is not that proof.

### 6. The new dirty-row real-handler regression is a meaningful narrow improvement

The added same-market dirty-row-before-legitimate-row fixture creates a direct behavioral dependency on the `json_valid` guard: with the guard, the real handler reaches the legitimate vote and signs once; without it, the query fails before the valid row and signs zero times. This is materially stronger than the earlier cross-market accidental coupling.

The accepted claim is narrow:

> In the tested SQLite/runtime configuration, the real handler skips an earlier malformed payload and reaches a later matching valid vote, producing one signer call.

It still does not close:

- database/query exceptions and retry classification;
- duplicate same-outcome rows;
- conflicting outcomes/equivocation;
- equal-order ties and canonical chain ordering;
- stale/replayed vote receipts;
- correct winner with tampered `phase2_tx_obj`;
- exact transaction digest/output binding;
- automatic inclusion in the normal regression runner.

The test remains manually invoked unless it is added to the repository's canonical test discovery path/CI. "Executable" must not be reported as "continuously covered."

## Required next acceptance artifacts

1. A versioned, domain-separated `OutcomeAttestation` schema with replay/correction/network/state bindings.
2. A canonical P2 input-set commitment specification and deterministic payout-root computation.
3. P3 covenant proofs/tests showing every spend path binds the predecessor state, P2 root and exact output semantics.
4. Real-handler tests for query exception, duplicate/equivocating votes, deterministic ordering and tampered payout object, each asserting zero signer calls where appropriate.
5. Candidate B wording retained as prefilter-only; no fallback signing on verifier-inconclusive/RPC-unavailable states.
6. Separate Owner authorization before any `is_oracle` eligibility migration, signer interface change, covenant deployment, signing or broadcast.

## Authorization boundary

This review authorizes no code deployment, schema migration, committee eligibility change, signer invocation, transaction construction, broadcast, settlement, refund, wallet action, node restart, mainnet/testnet money movement or production funds-path modification.
