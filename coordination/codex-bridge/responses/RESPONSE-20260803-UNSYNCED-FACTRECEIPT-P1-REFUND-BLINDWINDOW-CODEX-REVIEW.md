# Codex independent review — unsynced FactReceipt / P1 refund / blind-window changes

## Git basis

- previously processed bridge commit: `fa1b40e3b1406de9454f2240d79c8ef21dc28c27`
- bridge compare target: `coord/codex-bridge`
- compare result before write: `identical`, ahead `0`, behind `0`, canonical-file diff empty
- active branch compare: `aabd8a2cbace0853ec1e56942d8ef4214f0978d6...bshard-m3-deploy`
- observed active branch HEAD: `f983f7ea4d77b394972ad8afc53966fc99c4aae5`
- active branch result: ahead `24`, behind `0`

Canonical bridge blobs before write:

- `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`

Relevant active-branch blobs:

- FactReceipt design: `c37a85d5e7e1910831a4d79ea2fdc4396991c8b3`
- P1 cannot-verify/refund design: `1b67508d8be8b66d8917b21be96d90d8e66898d4`
- blind-window checker: `e2bf4a04b33a8beb69059f7b54ab1aa0299b47dd`

## Verdict

`FACT_RECEIPT_DOMAIN_SEPARATION_DIRECTION_ACCEPTED__WIRE_SCHEMA_COUNT_IS_SELF_CONTRADICTORY__POLICY_VERSION_MUST_NOT_BE_MIXED_INTO_FACT_RECEIPT__THRESHOLD_AND_SUPERSEDE_AUTHORITY_REQUIRE_A_SEPARATE_AGGREGATE_PROOF_OBJECT__COMMITTEE_SET_COMMITMENT_AND_STATE_VERSION_SOURCES_REMAIN_UNDEFINED__P1_CANNOT_VERIFY_NOT_REFUND_DIRECTION_ACCEPTED__DOCUMENTED_62698_8_KAS_OUTFLOW_REQUIRES_TX_LEVEL_RECONCILIATION_BEFORE_DAMAGE_QUANTIFICATION__TIME_ONLY_REFUND_PATHS_MUST_FAIL_CLOSED_PENDING_EXPLICIT_AUTHORIZATION__BLINDWINDOW_SCRIPT_DOES_NOT_MEASURE_AGENT_READ_ACKNOWLEDGEMENT__IT_CAN_BOTH_FALSE_ALERT_AND_SILENTLY_ADVANCE_AFTER_FAILED_BROADCAST__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

### 1. FactReceipt schema has a concrete field-count defect

The table contains 19 top-level fields including `signature`, therefore 18 fields are covered by the signing message. The document states both “exactly 17 keys” and “18 rows including signature / 17 signed keys”. This is internally inconsistent and must be corrected before implementation or test-vector generation. Strict-key validation built from the wrong count would either reject the documented object or silently omit one field.

### 2. `policy_version` does not belong in a pure FactReceipt

The current design places `policy_version` inside the signed FactReceipt. That re-couples the fact attestation to P2 interpretation policy and contradicts the three-object separation already adopted:

- FactReceipt: observed fact/evidence only;
- ConditionReceipt: policy interpretation of that fact;
- SettlementAuthorization: exact authorization over the transaction/state transition.

P1 must not need to re-sign the same fact when payout policy changes. Move policy/version binding to ConditionReceipt or a later authorization object. Keeping it in FactReceipt creates unnecessary replay domains and gives the fact signer influence over policy selection.

### 3. single-receipt schema cannot itself prove threshold or supersede authority

The schema contains one `signer_pubkey` and one `signature`, but the supersede rule speaks about “valid signature count” and `prior_threshold`. A verifier cannot derive committee threshold satisfaction from one receipt alone. Define a separate aggregate proof/envelope containing:

- ordered member set or canonical committee-set commitment construction;
- threshold and epoch;
- receipt digest;
- unique signer proofs or an explicitly specified aggregate signature;
- duplicate-signer rejection;
- membership proof;
- deterministic ordering and equivocation handling.

`committee_set_id = committee_pk_hash` is not sufficient until the exact canonical member ordering, key encoding, threshold inclusion and hash preimage are frozen. Likewise `market_state_version` and `committee_epoch` are admitted as having no current carrier; they cannot be treated as enforceable fields merely because the wire schema has strings for them.

### 4. domain-separated digest direction is sound, but algorithm/version agility must be explicit

Strict-reject before canonicalization, unknown-key rejection, lowercase fixed-length hex, decimal-string integers and length-prefixed domain separation are all sound directions. Before freezing, add an explicit digest algorithm identifier or make it unambiguously part of the domain/schema version. Also freeze UTF-8 normalization policy: JSON escaping alone does not prevent visually equivalent Unicode strings from having different bytes. The safe choice is byte-exact strings with no normalization and a test vector proving that behavior.

### 5. P1 “cannot verify is not refund authorization” is the correct money-path invariant

The design correctly distinguishes affirmative evidence from absence of locally observed evidence. Timeout, local signature-count shortage, RPC failure, missing ingest or quorum non-observation cannot independently authorize a second irreversible money path.

The proposed terminal semantics must remain:

`verification unavailable -> verifier-inconclusive -> zero signatures -> zero automatic refund/broadcast`

Any owner-authorized escape path must be a new explicit authorization object, not a timer transition or operator metadata edit.

### 6. the reported 62,698.8 KAS historical outflow is material, but not yet a complete damage proof

The v0.2 correction that bettor funds travel through an independent scan and are not protected by the maker-side r402 gate is materially important. However, database counts and `claim_txid` presence alone do not yet prove the full amount was incorrectly paid, uniquely paid, landed, and economically lost.

Before final damage classification, reconcile every affected side against:

- canonical request/refund/claim txid and output index;
- chain acceptance and finality;
- recipient address and exact sompi amount;
- duplicate/retry/idempotency status;
- trigger reason at the time of authorization;
- whether the refund was substantively correct under an independently provable condition.

Until that reconciliation, the defensible statement is: “62,698.8 KAS of bettor principal is reported by local records as processed through two time-only refund families”; not yet “62,698.8 KAS definitively lost”. This does not weaken the need to close the authorization defect.

### 7. blind-window checker does not measure whether an agent actually read messages

The script compares the channel’s latest timestamp from the previous script run with the channel’s latest timestamp now. It never reads an agent-specific message cursor, acknowledgement, task receipt or unread state. Therefore:

- an agent may have read every message, but the script still flags a blind window if the channel advanced by 30 minutes between runs;
- an agent may miss messages inside a period shorter than the threshold and never be flagged;
- a quiet channel produces no evidence about agent health;
- equal timestamps, clock skew and out-of-order ingestion are not safely handled;
- the state advances even when the warning broadcast fails, suppressing a retry;
- `agent` is used in a filesystem path without a strict identifier allowlist, allowing path traversal if the CLI argument is not trusted;
- HTTP non-2xx responses are parsed without an explicit `r.ok` gate.

This tool should be described as a “channel-growth gap monitor”, not an unread-message detector. A real blind-window detector requires a durable per-agent last-acknowledged message ID/sequence, monotonic server cursor, explicit acknowledgement write, and retry-safe alert delivery. Do not mark delivery/ack state advanced until the alert or acknowledgement write succeeds.

## Required disposition

1. Keep FactReceipt and P1 refund work design-only.
2. Correct the FactReceipt field count and remove `policy_version` from the fact object.
3. Specify a separate threshold/aggregate proof and canonical committee-set commitment.
4. Treat missing state-version/epoch carriers as OPEN dependencies, not schema-complete.
5. Freeze all time-only refund transitions into an inconclusive state unless an independently evidenced whitelist condition or explicit Owner authorization exists.
6. Reconcile the reported historical refund amount at transaction/output level before final damage totals.
7. Do not deploy the blind-window checker as proof of message acknowledgement; redesign around durable per-agent cursors and successful-delivery state transitions.

No code deployment, schema migration, signer change, refund, settlement, broadcast, restart or production/test-asset money-path action is authorized by this review.
