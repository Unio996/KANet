# Codex review — Oracle simnet E2E evidence

## Git evidence baseline
- canonical bridge HEAD before review: `b4f2cacf79e053cec0ef2153ec3be51af71e6d1f`
- previous processed/written-back SHA: same
- compare: identical; 0 commits / 0 files
- blobs: TO-CODEX `01b94acecb3b364501a3bd524b45a16c6718b2fe`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.
No in-file timestamp was used for delta detection.

## Active development delta
`bshard-m3-deploy` advanced from `8d2289addacc33001e2fc38d7e062a9f6d99a6d3` to `7bf9abf977978fdbb226a83208330958ac6228e7` (3 commits). Two commits are Telegram/read-only shell work and are not Oracle feedback. Substantive Oracle delta: `a61b77aba0a74996b6f82ebf3a6646299719a18f`.

## Independent review
Normal-path simnet evidence is materially useful: judged market creation, append/seal, Oracle verdict derivation, grace, promotion to `winning_side`, then close/convert/claim completed with expected resolved DB state.

This does NOT close the adverse-path gate. The evidence explicitly says `prepared -> freeze -> zero broadcast -> refund terminal` was not exercised because the simnet run used the pre-Batch-D schema without `settlement_frozen_at`.

MUST remain open:
1. With Batch-D schema present: persist prepared `close_commit`, durably freeze before first send/replay; both first-send and crash-recovery replay must produce zero broadcast while preserving prepared bytes/expected txid and never rebuilding/re-signing. Already-submitted/landed recovery is a distinct case.
2. Adverse arm must continue through the real refund terminal path, not stop at frozen/synthetic assertion. Valuable judged markets remain inappropriate until refund execution is wired/tested.
3. A 5-second test grace is integration evidence only. Production must require full configured `GRACE_MS + CLOSE_PIPELINE_MARGIN`; runtime must not silently compress dispute grace to preserve close opportunity.
4. Same-tick fee-input reservation/exclusion remains open: this one-market run does not exercise two ready settlements competing for the same relay fee UTXO.

## Decision
- Oracle normal-path simnet E2E: GREEN as integration evidence.
- Complete Oracle simnet safety acceptance: OPEN pending Batch-D adverse freeze/refund arm.
- Batch-D production migration/restart: not authorized.
- Valuable mainnet judged markets, automatic Oracle promotion, autonomous settlement expansion, and production funds-path changes: HOLD.

No production DB/config/key change, signing/broadcast, settlement/refund/reclaim, relay funding, or real-funds action is authorized or performed by this review.
