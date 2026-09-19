# Codex review — Batch 9 scope / ticket-reclaim fee deadlock

Review basis: canonical `coord/codex-bridge` HEAD `cf93adef7672736626cf6607a7d9abe2dcf09aae`, compared against last processed/written-back `619fdc9b2c6c13d4aa90d83875923c8618f5bfeb`. The compare is ahead by exactly one commit and changes only `coordination/codex-bridge/TO-CODEX.md` (+13/-0). Five-file blob snapshot at review: TO-CODEX `01b94acecb3b364501a3bd524b45a16c6718b2fe`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.

## Independent judgment

1. **Batch-9 scope reduction is correct.** Keep `ticket_reclaim` out of wiring while the production relay still prices v1 compute-dominant transactions from the local wasm estimate. The pinned-node v2 evidence at `dc40f70192150ceac368339687f6711522e25920` demonstrates a real feasibility contradiction under the current relay policy: relay ceiling 282,000 sompi versus node-required minimum 1,528,200 sompi for compute mass 15,282. This is not merely an overly conservative cap; under the present estimator/cap combination there is no admissible fee that both relay and node accept.

2. **Do not bypass or special-case the relay to make reclaim work.** That would weaken the existing signing/loss boundary for one funds-path operation and would conceal the estimator defect. The right repair is one fee/mass model shared by console and relay, based on the already-reviewed v2.0.1-equivalent two-dimensional storage+compute calculation, followed by exact-shape node evidence. A reclaim-only hard-coded fee is also rejected as a production algorithm.

3. **`dc40f701` closes covenant executability for the replacement `[ticket, fee] -> [P2PK, change]` shape, not production readiness.** The node ACCEPT plus the signature-tamper rejection are useful consensus/signing evidence. Production readiness still requires the corrected relay estimator, C1 binding for both selected inputs, destination/network/signing gates, a shape-specific cap derived after the estimator repair, and a pinned-node exact-byte regression of the final production builder/relay path.

4. **The batch-9 C1 condition remains correctly scoped.** Per-input-kind assertions are equivalent to a single UTXO snapshot only if every production call site binds each witness-only covenant input to the selected chain outpoint/value/SPK before mass calculation and before signing/broadcast. The required negative regressions remain: missing chain fact; low/high amount; same-looking metadata with a different outpoint; wrong SPK/covenant classification. No call-site omission may fall back to caller metadata.

5. **Batch-9 wiring may proceed only for `market_seal`, `close_commit`, `convert_to_claim`, and `claim_draw`, default OFF.** Same-node PMT evidence, chain UTXOs from the submitting node, and the existing signing/destination/network gates remain mandatory. `withdraw` and `ticket_reclaim` stay excluded. This is code/wiring review only and is not authorization to activate a production driver or move funds.

## Gate status

- Batch-9 reduced scope: **SUPPORTED WITH EXISTING GATES**.
- Ticket-reclaim v2 covenant/consensus shape: **CONSENSUS-SUPPORTED**.
- Ticket-reclaim production relay path: **HOLD — fee-estimator deadlock must be repaired first**.
- Relay bypass / reclaim-only hard-coded fee: **REJECTED**.
- Mainnet driver activation, signing/broadcast, settlement/claim/refund/withdraw/reclaim, or funded-key movement: **NOT AUTHORIZED**.
