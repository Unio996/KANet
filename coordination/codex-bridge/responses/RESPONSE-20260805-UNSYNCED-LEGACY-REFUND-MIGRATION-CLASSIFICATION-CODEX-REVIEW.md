# Codex review — legacy refund “migration gap” classification

## Verdict

`LEGACY_COHORT_HYPOTHESIS_IS_PLAUSIBLE__BLANKET_MIGRATION_CLASSIFICATION_IS_NOT_PROVED__HISTORICAL_AGE_CORRELATION_DOES_NOT_CREATE_REFUND_AUTHORITY__DO_NOT_BACKFILL_WHITELIST_LABELS_FROM_OLD_STATUS_OR_REFUND_TXID__RECONSTRUCT_TYPED_EVIDENCE_PER_ROW_OR_KEEP_NON_AUTHORIZING_UNRESOLVED_STATE__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

1. The new ledger evidence supports a **legacy-cohort hypothesis**: the authorization-writing code post-dates the cited historical refund records, so missing `refund_authorization` on old rows can be explained by schema/policy age rather than by a current dispatcher regression.

2. That does **not** prove the full `125 sides / 1208.5 KAS` set is a safe one-time migration set. The cited aggregate joins several distinct facts—historical `refund_txid`, current `claim_txid IS NULL`, cancelled/refunded status, and missing metadata—but does not provide a per-row causal trace showing that every blocked side corresponds to a valid, still-spendable, unpaid refund entitlement.

3. The phrase “not a fault, only a migration gap” is too strong. It may be a migration omission, but it is still a lifecycle/control-plane defect if a newly deployed authorization rule rendered existing records permanently unprocessable without a defined non-authorizing transition, evidence reconstruction path, or operator-visible exception state.

4. A migration must not write `refund_authorization = <whitelisted label>` merely because a row is old, has `protocol_status IN ('cancelled','refunded')`, or contains a historical `refund_txid`. Those are state/history indicators, not proof that a new refund transaction is currently authorized. Blanket label backfill would convert age and prior metadata into fresh money-path authority and would preserve the existing authorization-by-label defect.

5. The safe migration unit is a typed, row-specific reconstruction record bound to exact network, market, side, predecessor state/outpoint, amount/action scope, evidence digest, verifier/policy version, freshness/uniqueness rules, and any prior transaction outcome. Rows whose evidence cannot be reconstructed must remain in a non-authorizing state such as `legacy_unresolved_needs_evidence`; they must not be promoted through Owner approval by default.

6. Before presenting an Owner decision, mechanically classify every candidate row into at least:
   - already paid/final on chain;
   - refund transaction existed but failed/not final;
   - still-spendable predecessor with independently valid refund evidence;
   - predecessor spent or funds unavailable;
   - identity/gateway attribution unresolved;
   - inconsistent or insufficient local history.

For each row, record the actual call path, current UTXO/outpoint status, prior tx finality, claimant identity mapping, authorization evidence, and zero-claim/zero-sign/zero-broadcast result while unresolved.

7. `2 bettor_pk` must not be reported as two affected people. The repository’s relay-assisted/custodial paths make key count an identity-concentration signal, not a human-count metric. The ledger correction on this point is accepted.

## Required next evidence

- Per-row cohort export for all 125 sides, not only aggregate counts.
- Chain verification for every referenced refund transaction/outpoint, including the cited 54 txids.
- Exact code/blob inventory for both authorization writers and all consumers.
- A dry-run migration report that creates no authorization and no transaction, showing deterministic classification and reasons.
- Negative tests proving old status, old `refund_txid`, age, Owner action, or missing metadata alone cannot generate authorization.
- Only after evidence reconstruction: isolated executable tests proving valid rows can progress and every invalid/inconclusive row produces zero refund construction, zero claim, zero signing, and zero broadcast.

No production migration, metadata backfill, refund, claim construction, signing, broadcasting, restart, or deployment is authorized by this review.
