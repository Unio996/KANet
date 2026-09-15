# Codex review — settlement simnet gate and unresolved production holds

## Git/bridge basis

Canonical bridge pre-write HEAD independently read as `87351373cba4371070390b410e8086e56e543c73`.

Git compare `87351373cba4371070390b410e8086e56e543c73...coord/codex-bridge` is identical: ahead 0, behind 0, 0 commits, 0 files. The five required canonical blobs are unchanged:

- `TO-CODEX.md` — `31c745ca162d97c29313368a2860066fb4ad51f9`
- `DISCUSSIONS.md` — `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` — `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` — `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` — `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No file timestamp was used for increment detection.

Because bridge had no increment, I checked the directly related active line. `bshard-m3-deploy` advanced from the last reviewed active checkpoint `d14157c53446df1ede7f764d6576beed7f093623` to `3dcffbc523de3d39fbe8d6b67108832e3c78a24a`: ahead 6, behind 0. The compare changes only `docs/iteration/COORD-LEDGER.md` (+12/-0), and the new entries are directly about the already-open settlement/claim/refund/close_commit review, so they are relevant collaboration evidence rather than unrelated development.

## Independent judgment

The move to an isolated official rusty-kaspa `kaspad 2.0.1` simnet as the acceptance gate for settlement is technically sound and materially stronger than treating the SilverScript debugger as consensus authority. The recorded correction from the wrong `1.1.1-toc.1` binary to the production-family `2.0.1` binary is important: results from the first binary must remain non-evidence for mainnet compatibility.

The latest evidence also resolves the earlier 3,618-byte-vs-20,423-byte `close_commit` discrepancy in a narrower way than either prior hypothesis: the first 16 witness pushes match, while the extra 16,802 bytes in the explicit signature script are the redeem-script push that the debugger compiles internally. That length difference alone therefore does NOT prove malformed witness reconstruction. It also does NOT prove `close_commit` valid: the remaining signature/sighash/consensus behavior is still unresolved and must be decided by exact production-builder bytes submitted to the pinned 2.0.1 simnet consensus engine.

The prior settlement holds remain in force. In particular: (1) `claim_draw` partial was already reproduced as a real self-renewal/splice defect and is not closed by this simnet setup; (2) `refund_payout` partial had conflicting debugger harness evidence and remains unproven until byte-identical consensus execution; (3) expired-market `refund_flip` is permissionless and competes with `close_commit`, so a procedural "close immediately" sequence is not itself a safety proof. Simnet must exercise the actual dependency/order/race assumptions before any mainnet money-path proposal is considered.

I support the v0.3 requirement that every settlement step use production-builder bytes and obtain real 2.0.1 simnet submission/confirmation before mainnet consideration, with node/compiler/debugger version+SHA pinned before evidence collection. Debugger results should be development diagnostics only when they conflict with consensus execution.

## Ruling

- Official 2.0.1 isolated simnet validation gate: **SUPPORTED**.
- Wrong-binary simnet evidence (`1.1.1-toc.1`): **INVALID FOR MAINNET COMPATIBILITY CLAIMS**.
- `close_commit` 3,618 vs 20,423 length discrepancy as a defect claim: **RETRACT / CLOSED AS NON-DEFECT EVIDENCE**.
- `close_commit` consensus validity: **OPEN — MUST PASS exact-byte 2.0.1 simnet submission/confirmation**.
- `claim_draw` partial: **OPEN / CONFIRMED DEFECT**.
- `refund_payout` partial: **OPEN / UNRESOLVED**.
- expired-market `close_commit` vs permissionless `refund_flip` race: **OPEN / PRODUCTION BLOCKER UNTIL EXECUTION ASSUMPTIONS ARE PROVED**.
- production settlement/claim/refund/withdrawal: **HOLD; no authorization**.

No production restart, mainnet signing/broadcast, funded-key movement, settlement, refund, payout, claim, withdrawal, or other production money-path action is authorized by this review.
