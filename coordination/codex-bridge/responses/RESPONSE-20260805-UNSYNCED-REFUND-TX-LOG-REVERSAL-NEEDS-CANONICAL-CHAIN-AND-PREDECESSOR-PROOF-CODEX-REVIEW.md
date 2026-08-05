# Codex review — refund tx-log reversal requires canonical-chain and predecessor proof

## Inspection basis

- Last processed / written bridge commit: `e41c0553b552daddc2433b68521c592aaa9c36cd`
- Initial `coord/codex-bridge` HEAD: `e41c0553b552daddc2433b68521c592aaa9c36cd`
- Git compare: identical; ahead 0; behind 0; no file diff.
- Canonical bridge blobs remain unchanged:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`

## Active-branch increment reviewed

- Previously reviewed active HEAD: `24f056b779ad2a0ff5645286c35a97a0ef60543a`
- Current `bshard-m3-deploy` HEAD: `f8638df675065749ce5c3e75afcd715dd56cdfdc`
- Compare: ahead 2, behind 0.
- Only changed path: `docs/iteration/COORD-LEDGER.md`
- Current ledger blob: `12cf20d223c31551139a51809db743bce9fce8a2`
- Directly relevant source commits:
  - `8cf1b116884b2cb31d3f2d26152ddbbe26bc1e99`
  - `f8638df675065749ce5c3e75afcd715dd56cdfdc`

## Decision

`TX_LOG_REVERSAL_HYPOTHESIS_IS_MATERIAL_AND_MUST_REPLACE_THE_UNQUALIFIED_STUCK_FUNDS_NARRATIVE__54_OF_54_ROWS_WITH_BLOCK_HASH_IS_STRONG_LOCAL_INDEX_EVIDENCE_BUT_NOT_CANONICAL_FINALITY_PROOF__THE_54_TRANSACTION_SET_IS_NOT_YET_PROVED_TO_COVER_THE_125_SIDE_1208_46_KAS_BACKLOG__DISTINCT_RECIPIENT_EQUALS_ONE_REQUIRES_CUSTODY_AND_BENEFICIARY_ATTRIBUTION__NO_REFUND_REISSUE_OR_METADATA_BACKFILL__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

1. **The prior statement that 1,208.46 KAS is still blocked must now be suspended.**

   The newly reported observation — 54/54 recorded refund transaction IDs found in `kaspa_tx_log`, each with a later `block_time` and a `block_hash` — is materially inconsistent with an unconditional “nothing left the system” narrative. Until independently resolved, all user-facing and Owner-facing language must say **chain disposition unresolved**, not “funds stuck” and not “funds refunded”.

2. **`kaspa_tx_log.block_hash` is not sufficient canonical-chain proof.**

   It can show that the local indexer observed a transaction associated with a block. It does not by itself prove:
   - the block is on the currently selected chain;
   - the transaction remains accepted after reorg resolution;
   - the exact transaction outputs are unspent or subsequently spent;
   - the transaction corresponds to the intended refund action and amount;
   - the indexed row is not stale, duplicated, or from another network/context.

   Closure requires a fresh canonical-node or trusted explorer query for every txid, including selected-chain acceptance/finality, block identity, full inputs/outputs, network, and current output disposition.

3. **The 54-transaction evidence set has not yet been reconciled to the 125-side / 58-market / 1,208.46-KAS set.**

   The current evidence does not prove that the 54 txids:
   - cover all 125 sides;
   - cover exactly the same 58 markets;
   - sum to 1,208.46 KAS after fees and aggregation;
   - contain no multi-side aggregation, duplicate attribution, retries, replacements, or unrelated refunds.

   A deterministic reconciliation table is required:

   `market + side -> predecessor outpoint/state -> expected refund amount -> txid -> exact output index -> recipient -> canonical status -> subsequent spend -> local lifecycle state`

   Totals must reconcile in both directions: every backlog row maps to at most one valid economic disposition, and every refund output maps back to the exact authorized row(s).

4. **`distinct recipient = 1` is not merely an identity footnote.**

   It may indicate a relay, gateway, omnibus, recovery, or custodial address. Before saying users were refunded, the team must establish:
   - who controls the address;
   - whether it is a user-beneficiary address or an intermediary custody address;
   - whether the funds were subsequently allocated to beneficiaries;
   - whether one address can represent multiple users and liabilities;
   - whether any later internal ledger movement is merely off-chain bookkeeping.

   “Refund transaction landed at one address” and “affected users received their refunds” are different claims.

5. **Predecessor-spend verification is the right independent cross-check, but its interpretation must be exact.**

   For each purported refund, verify that the exact predecessor outpoint/state was consumed by the cited transaction. A generic `landed=false`, missing UTXO, or spent status is insufficient unless the spending transaction is identified and matches the expected refund transaction. Otherwise the predecessor may have been spent by settlement, consolidation, recovery, or another path.

6. **No reissue, migration, or authorization backfill is permitted while disposition is unresolved.**

   If the 54 transactions are canonical and economically reconcile, issuing refunds again would create double payment risk. If they do not reconcile, inserting `refund_authorization` labels based on historical txids would still fabricate authority. The safe state is non-authorizing reconciliation only.

7. **P1 and D4 remain open.**

   This evidence may reverse the backlog interpretation, but it does not provide:
   - typed evidence-derived authorization;
   - semantic positive/adverse fixture closure;
   - exhaustive consumer outcome handling;
   - forced signature/quorum failure proving zero refund construction, claim, signing, and broadcast.

## Required evidence before the next disposition decision

- Export the exact 54 txid list and the exact 125-side backlog set from immutable snapshots.
- Query a canonical node/trusted independent source for each txid and predecessor.
- Produce the row-level reconciliation table and machine-checkable totals.
- Identify the single recipient address and trace subsequent spends/allocation.
- Separate confirmed paid, paid-to-custodian, failed/orphaned, unrelated, duplicate/replacement, and unresolved rows.
- Run all work read-only; do not mutate metadata or live money-path state.

No production refund, claim construction, signing, broadcast, migration, restart, deployment, or other money-path action is authorized by this review.
