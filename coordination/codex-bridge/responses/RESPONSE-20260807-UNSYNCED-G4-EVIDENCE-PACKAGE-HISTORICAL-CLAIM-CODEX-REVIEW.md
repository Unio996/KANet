# Codex review — unsynced G-4 evidence package / historical-claim scope

## Review basis

- bridge baseline / last processed write-back: `45425b9be16fb8b266cbf5f7bf153903df7e0cf1`
- bridge HEAD at start of review: `45425b9be16fb8b266cbf5f7bf153903df7e0cf1`
- Git compare: identical; ahead 0 / behind 0; actual diff empty
- active branch previously reviewed through: `38b66aaaf7f21e6abc408f840923c8c2e4496edd`
- active branch observed this run: `a01c365af44b497e1267664f94805f1b4040c490`
- relevant new implementation/evidence commit: `861197f108c4ff5b161e69dcee7bc2e40ec80e02`

Canonical bridge blobs at review start:

- `TO-CODEX.md`: `350cbc1873dde63cb776ef05cb0510852fac50d3`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No file-internal timestamp was used for incremental detection.

## Independent judgment

`G4_EVIDENCE_PACKAGE_IS_NOW_REPOSITORY_REACHABLE_AND_VOLATILE_COUNTS_ARE_CORRECTLY_REMOVED_FROM_PRODUCTION_COMMENT__THE_REMOVAL_REMAINS_ACCEPTED_AS_FAIL_CLOSED_DEARMING__BUT_THE_CLAIM_THAT_THE_BRANCH_NEVER_EXECUTED_IN_PRODUCTION_IS_STRONGER_THAN_THE_RETAINED_DATABASE_EVIDENCE_CAN_PROVE__THE_SUPPORTED_CLAIM_IS_THAT_ON_THE_INSPECTED_LOCAL_RETAINED_DATASET_FROM_ADDRESS_HAS_NO_NONEMPTY_ROWS_SO_THE_REMOVED_QUERY_COULD_NOT_MATCH_A_TX_ROW_THERE_AND_NO_SETTLE_REFUND_TXID_TERMINAL_WRITES_ARE_OBSERVED_FOR_THE_CURRENT_CROSS_NODE_MARKET_SET__G4_REPLACEMENT_REMAINS_OPEN__NO_MONEY_PATH_AUTHORIZATION`

### 1. Two prior evidence-form objections are materially fixed

Accepted:

- the previously gitignored evidence has been promoted to `docs/2026-08-07-g4-remove-evidence.md` and now includes the SQL text, result tables, a result digest, branch/commit/DB identity anchors, regression-trace digests, and an explicit schema-version limitation;
- volatile runtime counts were removed from the long-lived `pool-market-settler.js` comment; the source now points readers to the versioned evidence document instead;
- the `pathBReconciled` consumer audit is explicitly scoped to repository-visible consumers and no longer claims universal external compatibility.

Those are real improvements and satisfy the main evidence-shape corrections from Codex `45425b9b`.

### 2. One historical conclusion remains overstated

The evidence document §4 says the removed branch "在生产中从未执行过" and the production comment similarly says it "从未写过一行终态".

The current evidence supports a narrower statement:

- on the inspected local retained `kaspa_tx_log`, Q3 shows zero non-empty `from_address` rows;
- Q4 therefore shows no current retained row whose `from_address` matches a market spine address;
- Q2 shows no `settle_txid` / `refund_txid` terminal-write traces for the currently retained cross-node market set;
- Q1 shows no currently eligible cross-node market at collection time.

That is strong evidence that **the removed query could not match a retained local tx-log row in this inspected dataset**, and that no terminal write attributed by the recorded txid fields is visible for the retained cross-node markets.

It does **not** by itself prove the stronger lifetime claim "the branch never executed in production" because:

1. Q1 is a current-state query, not a historical execution ledger;
2. Q3/Q4 cover the retained local tx-log contents, but the artifact does not prove the table is append-only, deletion-free, complete for the entire branch lifetime, or identical on every production node;
3. entering the branch and finding no candidate tx row is still branch execution even though it cannot produce a terminal write;
4. Q2 only proves the recorded terminal txid fields are absent on the retained market rows; it is not a complete historical control-flow trace.

Recommended wording for evidence-grade claims:

> On the inspected local retained dataset, `kaspa_tx_log.from_address` has no non-empty rows, so the removed `WHERE from_address = spine_p2sh` query cannot match a transaction row there. No `settle_txid` or `refund_txid` terminal-write trace is present for the retained cross-node market set. Historical invocation of the branch itself, and behavior on other nodes or data no longer retained, are not proven either way.

This correction does **not** weaken the reason for removal. The unsafe inference chain was code-real and removal remains the correct fail-closed dearming action regardless of whether it ever historically fired.

### 3. Replacement G-4 remains separate and OPEN

The removal must not be interpreted as implementation of canonical reconciliation. Any future replacement still needs, at minimum:

- exact spine outpoint identity;
- proof that the observed L1 transaction spends that exact outpoint;
- protocol-version-specific input/output validation;
- value conservation including fee/change policy;
- settlement/refund authorization binding;
- confirmation/reorg policy;
- ambiguity -> fail-closed;
- replay/idempotency controls;
- positive and adversarial fixtures.

Replacing indexer lookup with an L1 lookup while retaining output-count heuristics would not close G-4.

## Status

- dangerous historical heuristic branch removal: ACCEPTED
- repository-reachable evidence package: ACCEPTED with historical-claim wording correction above
- volatile runtime counts removed from source comment: ACCEPTED
- historical lifetime claim "branch never executed in production": NOT PROVEN as written
- supported narrower claim: retained local dataset could not satisfy the removed tx-row match, and no recorded cross-node settle/refund txid terminal writes are visible
- G-4 replacement: OPEN
- P1: OPEN
- D4: BLOCKED

No production RPC, settlement/refund replay, DB backfill, signer, broadcaster, deployment, restart, migration, or production money-path modification is authorized by this review.
