# Codex review — unsynced xnode refund assertion manifest

- review_basis_bridge_commit: `79ec8738ddbba9b7de2daf0a01071a23822f8083`
- reviewed_active_branch: `bshard-m3-deploy`
- reviewed_active_commit: `f1963558a97b417d42a250384aec6bda9e7a3252`
- reviewed_evidence_path: `docs/2026-08-01-j1tn-705-xnode-refund-request-list.md`
- reviewed_evidence_blob: `b4b16762bbadfe520d20cf3fb62e97c0900a648b`
- authority: independent technical review; no money-path authorization

## Verdict

`ASSERTION_MANIFEST_IS_A_USEFUL_JOIN_KEY_SET__705_ROW_CARDINALITY_AND_BOUNDARY_DISCIPLINE_ACCEPTED__CHAIN_LANDING_AND_PRODUCER_ACCEPTANCE_REMAIN_UNPROVEN__MONTH_BASED_NARROWING_IS_CONDITIONAL_ON_IDENTICAL_CREATED_AT_SEMANTICS__ROOT_DEFECT_IS_MISSING_PRODUCER_SIDE_PRECONDITION_VERIFICATION__NO_MONEY_PATH_AUTHORIZATION`

## Verified facts

1. The artifact contains a numbered 1..705 table, each row carrying `market_id`, a broadcast timestamp and a 64-hex-character `refund_request_txid`. The first and final rows match the stated broadcast window.
2. The artifact is correctly scoped as a sender-side assertion manifest, not as proof of damage, refund execution or producer acceptance.
3. The producer-side join proposed by the artifact is the right next read-only operation: intersect this immutable sender-side market set with producer-authoritative rows that have real bets and recorded refund outcomes.
4. The evidence currently proves that the sender database recorded 705 refund-request txids. It does not independently prove that all 705 transactions landed on chain, that each decoded to the claimed message, or that any producer accepted them.

## Independent assessment

### A. The manifest materially improves auditability

The previous state was an unjoinable aggregate claim. This commit converts it into an immutable row-level set that another machine can compare mechanically. That is a real evidence improvement.

### B. `refund_request_txid IS NOT NULL` is not yet a chain receipt

The extraction query selects metadata rows with a stored txid. A stored txid may represent successful submission, optimistic local write, an unknown-outcome submission, or a later-pruned/unqueryable transaction depending on the write ordering and recovery logic. Therefore the manifest should use the label `recorded_request_txid` until a positive-control sample and, ideally, all rows are checked against a chain-authoritative source.

Required receipt fields for the producer-side intersection artifact:

```text
market_id
sender_recorded_request_txid
sender_request_landed = yes/no/unresolved
sender_request_decoded_type
producer_market_created_at
producer_bet_count
producer_refund_txid
producer_refund_landed = yes/no/unresolved
producer_refund_reason/source_request_txid if recorded
maker_amount
bettor_amount
actual_outputs
classification
```

### C. The `<=30` narrowing is valid only under one exact join definition

The exclusion of the 161 June rows is valid only if:

- the producer's `6月161 / 7月30` split is based on the same market-creation field;
- timestamps are normalized consistently;
- market IDs are stable across replicas;
- no imported/copied market preserved a different local creation timestamp.

Until the producer publishes the exact query and field, the safe statement is:

`candidate_intersection <= 191; potentially <=30 if both datasets classify by the same canonical market-created-at value.`

### D. The deeper defect is authority placement, not just a bad local database

The sender's local `pool_bettor_sides` being empty made its zero-bet predicate structurally incapable of detecting remote bets. But the economically material failure requires the producer to accept a cross-node refund request without independently checking the producer-authoritative precondition.

The durable fix should therefore be producer-side fail-closed verification of the refund precondition against authoritative local state, plus an immutable decision receipt. Sender-side assertions may trigger evaluation, but must not be treated as truth.

At minimum, producer acceptance must bind:

```text
request_txid
market_id
requester identity/role
producer-authoritative bet_count
market state/version
refund eligibility rule/version
selected refund builder
expected inputs/outputs/value conservation
idempotency key
accept/reject reason
```

### E. Do not use the manifest to authorize remediation transactions

The artifact supports investigation and classification only. It does not establish per-market loss, refund correctness, recoverability, or a safe transaction plan. Any remediation still requires a separately reviewed immutable rowset, deployed-script provenance, conservation equations, unsigned transaction skeletons and explicit Owner money-path authorization.

## Required next evidence

1. Producer-side exact intersection query and immutable result manifest.
2. Query semantics for the `6月161 / 7月30` split.
3. At least one known-positive request tx decoded through the same chain-query path used for the 705 rows.
4. Producer decision-path code receipt showing whether bet count was rechecked before dispatch.
5. Per-intersection-row classification separating:
   - assertion emitted only;
   - assertion landed but rejected;
   - assertion accepted with no economic effect;
   - refund executed correctly;
   - refund executed incorrectly;
   - unresolved.

No deployment, signing, broadcasting, refund, settlement, faucet, migration or other production/test-asset money-path action is authorized by this review.
