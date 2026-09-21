# Codex review — Oracle simnet four-arm provenance

Scope: independent review of the active `bshard-m3-deploy` delta from `7bf9abf977978fdbb226a83208330958ac6228e7` through `eacc154111605edffe1b987fb78b1fc8a78a2b8b`, especially J2 provenance `178f46ee2e33329da5ad8e6e88cc67e7bd8a9a64` and NWT recheck `b804c8059f975c7566be42140f39cb0cf27c3369`. This is review only; it does not authorize production/mainnet funds-path changes.

## Independent judgment

1. **F1 prepared-freeze bypass is now evidence-confirmed RED, not merely code-suspected.** The four-arm provenance deliberately seeds a prepared close, establishes durable freeze, and observes the replay path. The evidence correctly limits the claim: the prepared row is harness-created rather than a naturally raced row, but that does not weaken the control-flow counterexample. A production-correct implementation must re-read durable freeze after landed/mempool reconciliation and before every first-send or prepared replay. If frozen and not already submitted/landed: HOLD with zero broadcast, preserve exact prepared bytes/expected txid, and do not rebuild/re-sign. A regression must exercise both first-send and crash-recovery replay.

2. **D arm proves covenant-level refund_flip validity only.** The pre-gate rejection (`input #0 is not finalized`) followed by post-gate acceptance of the same expected txid is strong consensus-path evidence that the timelock gate behaves as intended. It does not close the operational refund requirement because the transaction was harness-built and the production driver has no refund_flip step. Therefore `freeze -> refund terminal` remains OPEN until the real driver constructs/persists/replays/lands the refund path under the same persistence and C1/lineage controls as other settlement operations.

3. **H arm remains useful normal-path integration evidence, not a production timing proof.** The run used simnet grace 2m/min 1m rather than production 30m/5m, so it cannot close the full configured-grace invariant. Runtime grace compression remains unacceptable: if configured `GRACE_MS + CLOSE_PIPELINE_MARGIN` does not fit before the cutoff, fail closed to freeze/refund rather than shortening dispute policy.

4. **A arm is only partial evidence for the shared fee-policy issue.** A `net_loss_exceeded`/candidate failure demonstrates that fee-candidate quality matters, but does not by itself prove parity across genesis/bet/settlement. F3 remains MUST: one shared eligibility policy (including C1-equivalent poison/covenant/fact checks as applicable) must be used by every relay-wallet spending path, with parity regressions. F4 also remains MUST: tick-local reservation/exclusion must cover the shared relay-wallet concurrency domain, not settlement alone. Two ready operations sharing candidate #1 must force the second to another eligible outpoint or HOLD; never build/broadcast a sibling double-spend candidate.

5. **Evidence quality is materially improved.** The provenance explicitly distinguishes PASS, expected RED, and non-evidence; it carries raw actions, DB/node readbacks and independent NWT recheck. I accept the narrow factual conclusions above. I do not accept `29 PASS / 1 FAIL` as an aggregate safety score: the single FAIL is the critical funds-path F1 invariant, so production acceptance remains HOLD.

## Required closure gates

- F1 fix + regression: prepared-before-freeze, then freeze-before-first-send/replay => zero broadcast, exact prepared bytes retained, no rebuild/re-sign.
- F2: full configured grace + pipeline margin or freeze/refund; no runtime grace compression.
- F3: shared fee-candidate eligibility across all relay-wallet spend paths, with cross-path parity tests.
- F4: shared relay-wallet reservation/exclusion across sibling operations in one scheduling window.
- Refund driver: real `refund_flip` step and terminal refund/reclaim flow exercised through production-shaped persistence on simnet.

Verdict: **J2/NWT four-arm provenance = ACCEPTED AS NARROW EVIDENCE; F1 = CONFIRMED RED; D covenant refund path = CONSENSUS-PROVEN; refund driver = OPEN; F2/F3/F4 = OPEN MUST; production funds-path expansion = HOLD.**
