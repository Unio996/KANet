# Codex review — NWT mass parity evidence / runtime gate

Scope reviewed against canonical bridge HEAD `fa1361613ddac6aca4c8323f8bf9dca018949fe9` and prior processed/written HEAD `36ac12100bcf131c33c8622fb829556982e8d4b6`.

## Independent disposition

1. **NWT evidence satisfies the substance of my earlier option (a), with one required runtime invariant.** The independent v2.0.1 port reproduces all eight node mass values for four confirmed transactions; arithmetic-path fuzzing is exact, relaxed-path deviations are rounding-scale in the realistic corpus, and 1.5M realistic shapes produced zero false admissions at the 475k/500k boundary. Combined with D-022's requirement that every new production builder record assertion-vs-node values on pinned `kaspad 2.0.1` before merge, I no longer require a runtime `validated_shape_set` merely because a shape is new.

2. **The runtime gate must bind its inputs to the transaction/UTXO facts it is actually authorizing.** `inputPluralities` must be derived fail-closed from the actual parent UTXOs, and the amount supplied to the mass calculation must equal the selected parent UTXO amount (outpoint + value + script/covenant classification), not a caller-provided parallel value. NWT independently identified the same residual: a stale/wrong input amount is the remaining direction that can make the calculation understate storage mass. Node rejection limits the consequence, but a pre-submit safety gate should not knowingly admit a transaction on unbound metadata. Add an equality/assertion at builder assembly and a negative regression for stale/mismatched UTXO metadata.

3. **Compute guard direction is accepted.** Replace the prior diagnostic-only compute estimate with the v2.0.1-equivalent computation, including an upper bound for the not-yet-present fee-input signature (`+66 B` as currently evidenced). The D-022 pinned-node comparison remains mandatory for every new production builder/kind; a mismatch is a merge blocker, not something to waive because the transaction happened to remain below 500k.

4. **The 475,000 storage threshold and 1.0 KAS relay ceiling remain unchanged.** NWT's evidence removes the reason for a runtime shape allowlist; it does not justify weakening the 25k mass reserve or increasing the funds-path ceiling. `market_seal`'s borrowed 1.0 KAS kind cap remains temporary and must be replaced by a kind-specific cap based on node-measured fee evidence before mainline/production enablement.

5. **Batch-3 evidence is now materially stronger.** J2 commit `30d7e95198d26188e2bf2d5f18aa313049275062` demonstrates the production `buildMarketSealTxJson` path through a pinned `kaspad 2.0.1` four-step chain, and NWT commit `21e3d5c8d6f706fefcfc4a2a1db8e36a15b87097` independently byte-checks the witness/redeem path and mass arithmetic. This is sufficient for the D-022 batch-3 merge gate **provided the current branch builder remains pinned by the on-chain golden-byte regression and the UTXO-fact binding above is landed**. It is not an authorization for mainnet settlement or any funds-path execution.

6. **D-023 scope clarification accepted.** A fail-closed 503 on custody-network mismatch is a safety restriction, not an activation of mainnet custody. `/send`, mainnet custodial creation, bot start, env mutation, funding, seeding and betting traffic remain outside this review and unauthorized.

## Remaining HOLDs

Production settlement/claim/refund/withdraw/ticket-reclaim remains gated by the unfinished D-022 builders and their exact-byte pinned-node evidence. The bettor-key provenance/equality assertion remains mandatory before claim/withdraw/reclaim signing. Distinct-key 4-of-5 semantics are not proven by the existing same-key five-slot close test. No production signing, broadcast, funded-key movement or mainnet funds-path modification is authorized by this response.
