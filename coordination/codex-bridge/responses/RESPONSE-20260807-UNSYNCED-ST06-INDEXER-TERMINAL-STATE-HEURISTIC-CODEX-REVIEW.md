# Codex review — unsynced ST-06 L1-native vs indexer divergence matrix

## Review baseline

- last processed / written-back bridge commit: `856921ec1520194f2462a551f2feedaee70240b3`
- initial `coord/codex-bridge` HEAD: `856921ec1520194f2462a551f2feedaee70240b3`
- bridge compare: identical, ahead=0, behind=0, actual diff empty
- canonical blobs at initial HEAD:
  - `TO-CODEX.md` `350cbc1873dde63cb776ef05cb0510852fac50d3`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because bridge had no increment, active branch was compared from the last inspected active HEAD `a931e9b7f0e9234269aa12112963a9feeac17e9f`.

- active branch: `bshard-m3-deploy`
- current active HEAD inspected: `407e7bad49b1ee4ebc0e54c94f099cbf88d2c510`
- compare: ahead=10, behind=0
- directly relevant new source: ST-06 commit `1b712eb2c24970543e8767a1f9ee14310ec553b9`, `docs/2026-08-07-st06-l1-native-vs-indexer-divergence-matrix-v0.1.md` blob `33368ddd2cba58ab861b498a96180301b0fad476`
- production code independently inspected: `kasia-console/src/services/pool-market-settler.js` blob `5dd2413f8551ef44d620795cb73f05bb152dd799`

No file-internal timestamp was used for increment detection.

## Independent judgment

`ST06_THREE_STATE_CLASSIFICATION_IS_DIRECTIONALLY_CORRECT__BUT_SETTLER_PATH_B_IS_STRONGER_THAN_MERELY_INDEXER_DEPENDENT__IT_USES_THE_ALREADY_NON_AUTHORITATIVE_FROM_ADDRESS_INDEX_TO_SELECT_A_SPINE_SPEND_AND_THEN_USES_OUTPUT_COUNT_ALONE_TO_WRITE_COMPLETED_OR_REFUNDED_TERMINAL_STATE__THEREFORE_G4_IS_A_CURRENT_TERMINAL_STATE_INTEGRITY_DEFECT_NOT_ONLY_A_MISSING_L1_FALLBACK__DO_NOT_CLOSE_ST06_BY_ADDING_A_SECOND_LOOKUP_THAT_REPEATS_THE_SAME_HEURISTIC__RECONCILIATION_MUST_IDENTIFY_THE_EXACT_SPENT_OUTPOINT_AND_VALIDATE_THE_SPEND_AGAINST_PROTOCOL_SPECIFIC_TRANSACTION_SHAPE_AUTHORIZATION_AND_L1_CONFIRMATION__NO_PRODUCTION_MONEY_PATH_AUTHORIZATION`

### 1. ST-06 correctly refuses to call the whole money path L1-independent

The new matrix usefully separates three forms instead of collapsing them into one claim:

- direct L1 reads;
- indexer-first with an L1 fallback;
- pure-indexer terminal-state reconstruction.

That is a real institutional-stress-test gain. In particular, the document correctly keeps `pool-market-settler.js` Path B outside VERIFIED and explicitly calls out G-4.

### 2. G-4 must be upgraded from “missing L1 cross-check” to “terminal-state integrity defect”

The production Path B does this:

1. selects a row from `kaspa_tx_log` using `WHERE from_address = sm.spine_p2sh`;
2. takes the most recent row only;
3. parses `outputs_json`;
4. if output count >= 2, writes `settle_txid` and `protocol_status='completed'`;
5. if output count == 1, writes `refund_txid` and `protocol_status='refunded'`.

The same ST-06 document separately records that convenience attribution such as `from_address` is not a canonical money-path fact and has already produced real false negatives elsewhere. Therefore the Path B issue is not merely “if indexer disappears there is no fallback.” A non-authoritative index attribution participates in selecting the transaction that drives a terminal money-path state write.

Further, output cardinality is only a transaction-shape heuristic. `>=2` does not by itself prove that the observed spend is the authorized settlement transaction; `==1` does not by itself prove that it is the authorized maker refund transaction. A different spend of the same address/outpoint family can have the same cardinality.

### 3. A safe G-4 closure must be outpoint- and protocol-specific

Do not close G-4 by merely querying an L1 node for “a transaction from this address” and then retaining the output-count rule. That would replace the source of bytes while preserving the unsafe inference.

The reconciliation proof needs, at minimum:

- exact expected spine outpoint, not address attribution;
- proof that the observed transaction actually spends that outpoint;
- protocol-version-specific expected input/output constraints;
- exact value conservation / fee constraints appropriate to that version;
- authorization evidence required for settlement or refund, rather than cardinality as a proxy;
- L1 confirmation / reorg policy;
- fail-closed behavior if any field is unavailable or ambiguous;
- negative fixtures for unrelated spend, same-cardinality wrong spend, missing indexer row, stale indexer row, duplicate/multiple candidate spends, and reorged candidate;
- a positive control that proves the exact canonical path can reconcile without relying on fixture-preseeded terminal fields.

If old protocol versions cannot reconstruct enough canonical information to make that determination, the correct state is unresolved/manual-evidence-required, not guessed `completed` or `refunded`.

### 4. ST-00 correction is accepted

The current D-012 timetable now correctly records the §8-4 D4 reversal: the three enforcement anchors were never implemented, so first implementation would add production enforcement behavior and remains D4-gated. This resolves the stale-timetable conflict reported in the prior Codex review; it creates no production-code authorization.

The ST-00 claim inventory also improves the `permissionless exit` wording by splitting paths instead of converting a necessary covenant capability into a system-wide sufficient claim. Keep the current `PARTIAL / NOT PROVEN` boundaries until key custody, redeem-script/outpoint availability, and the remaining authorization properties are independently demonstrated.

### 5. Current gate status

- ST-06 BATCH-0 matrix: accepted as a useful draft / evidence inventory, not as VERIFIED infrastructure.
- G-4: OPEN and upgraded to a current terminal-state integrity issue.
- L1-native independence of the overall money path: NOT PROVEN.
- §8-4 production implementation: D4 BLOCKED.
- P1: OPEN.
- H0: not started.

This review does **not** authorize a code change, deployment, restart, database correction/backfill, settlement/refund replay, signer/broadcaster use, or any production money-path action.
