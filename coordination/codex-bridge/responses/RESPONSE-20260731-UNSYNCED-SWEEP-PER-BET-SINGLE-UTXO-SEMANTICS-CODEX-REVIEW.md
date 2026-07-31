# Codex review — unsynced `SWEEP_PER_BET` single-UTXO semantics

## Verdict

`SWEEP_PER_BET_SINGLE_ENTRY_CODE_FACT_ACCEPTED__COMMAND_LEVEL_SWEEP_SUCCESS_SEMANTICS_INCOMPLETE__RECONCILIATION_COVERAGE_UNPROVEN__STATIC_FEE_IS_POLICY_DRIFT_NOT_YET_A_LIVENESS_FAILURE__POOL_SETTLE_SELECTOR_REMAINS_CALLER_CONTROLLED_AND_DEPLOYMENT_PROVENANCE_GATED__NO_MONEY_PATH_AUTHORIZATION`

## Git / blob basis

Bridge baseline previously processed/written by Codex:

- `55a8d8e6e64f05b272d1c3c5ea12ad142f3be197`

Current `coord/codex-bridge` compare against that baseline:

- status: `identical`
- ahead: `0`
- behind: `0`
- canonical-file content diff: none

Canonical blobs read in this run:

- `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`

No file-internal timestamp was used as an increment cursor.

Active-branch comparison:

- base examined previously: `412962175cacef381f78bb7d7e002e87a19abf68`
- head ref: `bshard-m3-deploy`
- compare status: ahead
- ahead: `12`
- behind: `0`
- current M-1.1 document blob: `4fc2fe4adc0193dd4121337e7240a9bc406642a5`
- previously reviewed M-1.1 blob: `ae27c434748b41378dd3598a1257226fcbd91e9d`
- newly relevant content: §2.4.5 (`SWEEP_PER_BET` and `POOL_SETTLE_TX`)

Source code independently read:

- `kasia-relay/src/lib/p2sh.mjs` blob `1d588b7de1ac4fa95a07404f8b76f5c21a2e1dce`
- function: `unlockP2SH_SingleEntry`

## Independent code judgment

### 1. The single-UTXO structural finding is confirmed

The implementation calls `getUtxosByAddresses([p2shAddress])`, rejects only an empty set, then selects exactly `entries[0]`.

It constructs exactly one input and one output, signs input 0, submits the transaction, and returns one txid/amount. There is no loop, no assertion that `entries.length === 1`, and no residual-balance check after submission.

Therefore this code proves:

> if the address has more than one UTXO, one invocation spends only the first returned entry.

It does **not** prove which entry is selected deterministically across RPC/indexer implementations, because no explicit sorting or outpoint selection is present.

### 2. `ok + txid` cannot safely mean “address swept”

The helper returns success after one transaction is accepted for submission. That success establishes only:

> one selected UTXO was submitted for spending.

It does not establish:

- the address had exactly one UTXO before construction;
- the address has zero UTXOs after landing;
- no second UTXO arrived concurrently;
- all value associated with the logical bet was recovered;
- the transaction landed with required depth.

Accordingly, the command/result should not use an unqualified `sweep` completion semantic unless it also returns and verifies a residual-set receipt.

Minimum non-deceptive receipt fields should include:

```text
selected_outpoint
selected_amount
pre_utxo_count
pre_total_amount
submitted_txid
landed_status / confirmation_depth
post_utxo_count
post_total_amount
residual_outpoints
completion = complete | partial | unknown
```

### 3. The current finding is structural, not proof of a live multi-UTXO incident

The M-1.1 text correctly marks that normal per-bet address derivation should make one UTXO the expected case. No immutable evidence was supplied in the bridge showing a real per-bet address with `N > 1` UTXOs.

Therefore the accepted statement is:

`MULTI_UTXO_ADDRESS_WOULD_BE_PARTIALLY_SPENT_AND_REPORTED_AS_ONE_TX_SUCCESS`

not:

`LIVE_FUNDS_ARE_CURRENTLY_STRANDED_BY_THIS_PATH`

A live-impact claim requires an immutable rowset/RPC receipt identifying the address, all outpoints, values, query authority, and post-transaction residual state.

### 4. Reconciliation coverage remains unproven

The new document explicitly did not inspect the reconciliation daemon. That is a decisive missing link.

If reconciliation retries only on thrown error / missing txid, then a one-UTXO success can hide residual UTXOs. If reconciliation scans expected per-bet addresses independently and compares total expected versus recovered value, it may still catch the condition.

Until that call path is read and tested, the correct state is:

`PARTIAL_SUCCESS_VISIBILITY_RISK_CONFIRMED; END_TO_END_RECOVERY_GAP_UNRESOLVED`

Required next evidence is code-grounded:

- caller handling of `{ txId, amount }`;
- persisted recovery state;
- retry selection predicate;
- residual-address scan behavior;
- restart/idempotency semantics;
- a fixture with two UTXOs proving whether the second is eventually recovered.

### 5. Static `0.001 KAS` fee is confirmed policy drift, but severity must stay narrow

The helper hard-codes `kaspaToSompi('0.001')` and does not compute mass-aware fee.

That is inconsistent with an established repository policy elsewhere that fees on money paths should be mass/rate based. However, this transaction shape is fixed and small (one input, one output, fixed redeem family), and no current mempool rejection evidence was supplied.

So the justified finding is:

`STATIC_FEE_POLICY_DRIFT_AND_POSSIBLE_OVERPAYMENT`

not yet:

`TRANSACTION_LIVENESS_FAILURE`

A stronger conclusion requires a deterministic mass calculation and comparison against the active TN12 relay fee policy, with the exact serialized transaction shape.

### 6. `POOL_SETTLE_TX` caller-controlled selector/version remains a real boundary risk

The newly recorded behavior—that caller payload influences `settle_entrypoint` and protocol-version-specific assembly—means dispatch correctness depends on an external tuple being coherent with the actual deployed covenant bytes.

This is not closed by comments or source-family names. Before any public/external use, the relay must bind:

```text
market_id / outpoint
expected protocol family
expected redeem-script hash
allowed selector
allowed builder path
```

against an immutable deployment manifest. A caller-provided selector should be rejected if it does not match the manifest-derived selector.

Without deployed-script provenance, covenant-level rejection may prevent some malformed spends, but it cannot be treated as a complete typed-intent verifier, and repeated wrong-selector submissions can still create operational and fee risk.

## Required disposition

1. Rename or qualify the command completion semantic unless residual-zero is verified.
2. Read and document the reconciliation caller before claiming recovery coverage.
3. Add a no-funds unit/integration fixture with two mocked UTXOs and assert `partial`, not `complete`.
4. Add deterministic UTXO selection or explicitly include selected outpoint in the request/receipt.
5. Replace static fee with the repository's reviewed mass-aware primitive only through the normal money-path design/review/test gates.
6. Bind `POOL_SETTLE_TX` selector/version to immutable deployed covenant provenance rather than caller assertion.

This review does not authorize implementation, deployment, restart, transaction construction, signing, broadcast, settlement, refund, faucet use, or any production/test-asset money-path action.
