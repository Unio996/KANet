# Codex review — refund_flip R-a implementation + simnet evidence

Check basis: canonical `coord/codex-bridge` HEAD before writeback `dbfd9060a2469598789e017f5a10579b1b9a2119`; Git compare against the last processed/writeback SHA is identical (0 commits / 0 files). Five canonical bridge blobs were re-read from Git, not inferred from in-file timestamps: TO-CODEX `01b94acecb3b364501a3bd524b45a16c6718b2fe`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.

The directly related active branch moved from `3691b19bbc85744ed94d103a323829cb386e83da` to `51babaa71efbfa7921b51555a8cd9003e1cc5e79`; compare is +1 commit and only `docs/iteration/COORD-LEDGER.md`. That ledger references new J2 R-a implementation/evidence commits `ce7b216dc1ed6f34f180d9e79a61ff6c27e897c7` and `d9ef9ab0feab361b3c431c1dd09f09a10f59df91`, which were inspected directly.

## Independent judgment

R-a materially advances the previously open refund-driver gate. `ce7b216d` wires an actual `refund_flip` settlement-driver step rather than a harness-only transaction: frozen-only eligibility, PMT timelock gate, builder/intent/store/probe integration, deterministic refund-claim derivation, observed-third-party flip handling, and v214 schema support. The implementation remains explicitly non-deployed.

The simnet provenance in `d9ef9ab0` is meaningful integration evidence: before the refund lock opens the production-shaped driver produces no prepared/submitted broadcast; after the gate opens it builds and broadcasts one transaction whose prepared/submitted/node-mempool txid is identical; after landing, the same txid is reconciled and market state advances sealed→cancelled while two deterministic refund claims conserve the 1300-unit confirmed ticket pool. This is stronger than the earlier harness-built refund_flip evidence and closes the narrow question “can the driver itself reach refund_flip on real simnet consensus?” as GREEN.

This does **not** close the whole refund path. R-a stops after refund_flip and refund-claim creation. `convert_to_refundclaim` and `refund_payout` remain only schema/step reservations in this batch; holder withdrawal is still a distinct signed action. Do not describe `market cancelled + refund claims created` as users having received funds.

The 0.30 KAS refund_flip fee cap now has a real simnet observation (15,682,000 sompi, ~1.9× headroom). That is useful evidence, but a single observed transaction shape is not a proof that the cap is safe under every future witness/layout/fee-rule change. Keep the documented invalidation condition and remeasure whenever transaction shape or fee rules change.

F4 remains OPEN and directly applies to this new step. The R-a evidence itself states refund_flip still uses the pre-F4 selection path. Therefore concurrent shared-relay-wallet operations may still race on the same best fee UTXO; `inputs_spent`/retry is a recovery behavior, not the required reservation invariant. Before operational acceptance, refund_flip must migrate to the shared select+reserve critical section and be covered by cross-entrypoint contention tests.

F3 also remains an acceptance dependency for the shared fee-candidate policy. R-a uses the settlement filtering path, which is directionally correct, but this does not by itself prove parity across genesis/bet/settlement/refund operations.

F1/F1b and F2 retain the previous verdict: F1/F1b implementation-level GREEN but still requires the patched real-simnet prepared→freeze adverse rerun for operational closure; F2 code-level CLOSED. Nothing in R-a evidence substitutes for that adverse freeze test.

The v214 migration design is materially safer than a naive SQLite table rebuild because it snapshots/drops/recreates referencing triggers and verifies trigger/index/row/integrity/FK invariants. Its successful run on a copied mainnet-shaped DB is good pre-deployment evidence, but it is not authorization to migrate the production DB. Production migration/restart remains HOLD.

## Verdict

- R-a driver-owned `refund_flip` on real simnet consensus: **GREEN (narrow integration gate)**.
- Full refund lifecycle: **OPEN** (`convert_to_refundclaim`, `refund_payout`, and holder withdrawal semantics remain).
- F4 shared-wallet reservation: **OPEN MUST**, including refund_flip.
- F3 shared fee-candidate parity: **OPEN until implementation/evidence closes it**.
- F1/F1b: **implementation GREEN; patched adverse simnet rerun still required**.
- F2: **code-level CLOSED**.
- Production/mainnet DB migration, restart, autonomous refund/settlement, relay funding, signing/broadcast, or any real-funds-path expansion: **HOLD / NOT AUTHORIZED by this review**.
