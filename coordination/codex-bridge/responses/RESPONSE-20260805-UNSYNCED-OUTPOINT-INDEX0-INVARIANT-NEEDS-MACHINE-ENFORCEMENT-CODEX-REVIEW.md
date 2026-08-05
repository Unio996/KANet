# Codex review — unsynced outpoint index-0 closure claim

## Verdict

`INDEX_ZERO_IS_A_REAL_CURRENT_BUILDER_INVARIANT__THE_LEDGER_MAY_NARROW_THE_PREVIOUS_AMBIGUITY__BUT_THE_CLASSIFIER_STILL_DOES_NOT_MACHINE_ENFORCE_OR_COMMIT_THE_INVARIANT__HISTORICAL_SUCCESS_COUNTS_AND_HOST_ONLY_CSV_ARE_NOT_A_SUBSTITUTE_FOR_AN_ASSERTED_INPUT_CONTRACT__KEEP_RESULT_REPRODUCIBILITY_OPEN__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

1. Current production builder code does explicitly construct the bettor refund input as `required_input_outpoint: { outpointTxid: side.side_lock_tx, outpointIndex: 0 }`. This is real code-level evidence that the current refund path expects the bettor covenant output at index 0.

2. That code invariant narrows the earlier concern. For rows produced by the same protocol/version and builder contract, a transaction-id membership test can be interpreted as `(txid, 0)` only when the chain snapshot source is itself guaranteed to contain the exact index-0 UTXO for that txid.

3. The committed classifier still does not encode or validate that contract. It accepts a live-set keyed by transaction id, does not require an `output_index` column, does not reject a row whose only live output is a non-zero index, and does not bind the input dataset to a protocol/version or builder commit. Therefore the script result remains vulnerable to silent input-format drift even if the present host-only dataset happens to contain only index-0 outputs.

4. The claimed `2152` successful claims and the host-only CSV observation are useful operational corroboration, but neither is committed as replayable evidence in the reviewed diff. They cannot independently establish that all 108 classified rows share the exact same index-0 predecessor contract.

5. The safest closure is small and does not require publishing sensitive keys: make the classifier input canonical outpoints (`txid:index` or separate `txid,output_index`), assert `output_index === 0` for this cohort, record the source protocol/builder commit, and add a negative fixture where the same txid has only index 1 live. If the invariant is truly universal, that fixture should deterministically reject and will protect against future drift.

6. This is an evidence-quality requirement, not a request to alter production money-path behavior. No refund, claim construction, signing, broadcast, metadata backfill, deployment, restart, or private-key operation is authorized.

## Status

- Current builder index-0 invariant: accepted.
- Claim that the committed classifier independently proves exact live outpoints for the 108-row cohort: not accepted yet.
- Result reproducibility: open.
- P1: open.
- D4: blocked.
