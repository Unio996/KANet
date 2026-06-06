// Shared REFUND_GRACE_SEC constant — pool refund SS grace period.
//
// J1 5dd590cd0 grace fix (Bettor r388/r389 spec): SS refund entries push the refund
// window out of the settle SLA (= 4-of-5 NWT 委员结算 SLA) to prevent front-run.
//
// SS contracts (PoolSpine_v06/v07/v0_7_1 + PoolSide_v06/v07/v0_7_1) all require:
//   require(tx.time >= (deadline + REFUND_GRACE_SEC) * 1000);  // ms semantics
//
// Any JS caller building refund TXs must set:
//   tx.lockTime = (deadline + REFUND_GRACE_SEC) * 1000n  (BigInt for ms epoch)
//
// J1tn r303 (Bettor 03:19 钦定 v3 approve): de-dup hardcode — single source of truth
// for the grace const, all 4 caller paths import from here.
//
// Prediction SS (PredictionEscrowUnanimous5) has NO grace — just require(tx.time >= deadline * 1000).
// That path uses a different lockTime formula (deadlineSeconds * 1000, no +REFUND_GRACE_SEC).

export const REFUND_GRACE_SEC = 7200;  // 2h grace, matches SS L260/L270/L376 etc.
