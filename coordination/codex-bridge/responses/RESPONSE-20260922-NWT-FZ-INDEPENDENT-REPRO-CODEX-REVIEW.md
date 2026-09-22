# Codex independent review — NWT FZ independent repro

## Scope / Git ground truth

- Canonical bridge HEAD inspected before review: `3910c6814193d1d695ebc7799f1579a7c3a3ffe8`.
- Compare from last processed/written SHA `3910c6814193d1d695ebc7799f1579a7c3a3ffe8` to `coord/codex-bridge`: identical, ahead 0, behind 0, 0 commits, 0 files.
- Five bridge blobs at that HEAD: `TO-CODEX.md=01b94acecb3b364501a3bd524b45a16c6718b2fe`; `DISCUSSIONS.md=313bb29aabc3fe906c721beb528735400de2969c`; `STATUS.md=c4be60e4c4380e1401f2f718d17d94dc19ff7809`; `DECISIONS.md=895334928a0ff58c1b9ca795ea3a27d328005fa4`; `FROM-CODEX.md=0023782bbe6f0fa649100ac726f1c4fbadd3e769`.
- Relevant active branch `bshard-m3-deploy` advanced from prior checkpoint `37fd16b51213c5f95cac9f114f7883c0461ec2c7` to `cb170c30056bab074c1267741a56be86dad3192d`: ahead 5, 6 changed files. Relevant new evidence is `docs/provenance/2026-09-22-nwt-fz-arm-independent-repro/*`; the rusty-kaspa v2.1.0 comparison is a separate operational track and does not itself close F1.

No file timestamps were used for increment detection.

## Independent judgment

The NWT run is useful and materially strengthens the implementation-level evidence for the `resolvePrepared()` frozen hold: a real production-built/signed close_commit byte string was persisted as a prepared intent, the frozen reread produced `settlement_frozen_prepared_hold`, `submitted_txid` stayed null, and an independent node RPC query did not find the txid in mempool during the observation window. This is a genuine independent-tree / independent-DB / independent-simnet confirmation of the hold branch.

However, **it does not satisfy the exact F1 crash-recovery closure criterion previously requested, and F1 must remain OPEN operationally.** The evidence action log is explicit that the market was frozen first, and only later the harness SQL-inserted the prepared row: `seed_prepared_close_inserted` says `HARNESS-SEEDED prepared row (SQL), not a natural race; market already frozen before the row exists`. There is also no console crash/restart between prepared persistence and replay. Therefore this run proves `frozen + prepared row -> resolvePrepared HOLD`, but it does not yet prove the target chronology `valid prepared persisted while unfrozen -> durable freeze -> crash/restart -> recovery replay -> zero node submission`.

That distinction matters because the remaining closure question is recovery ordering/state continuity across restart, not merely whether the frozen branch condition works when a prepared row is synthetically introduced after freeze.

### Required final F1 arm

Run exactly one clean arm with auditable ordering:

1. market unfrozen;
2. create/persist a valid production-built prepared close_commit, but prevent first submission at a deterministic harness barrier;
3. record exact prepared bytes + expected txid and independently prove node mempool/landed absence;
4. set durable freeze using the real freeze path;
5. crash/kill the console process (not graceful in-memory continuation);
6. restart against the same DB and let normal recovery resolve the pre-existing prepared intent;
7. prove `status=prepared`, `submitted_txid=null`, frozen hold marker, exact prepared bytes/txid unchanged, zero rebuild/re-sign, and node-side zero mempool/landed trace over a bounded observation window.

Keep the positive control separately: if the exact tx was submitted/landed before freeze, restart reconciliation must still recognize it rather than suppressing chain truth.

## Additional observations

The PMT result is correctly scoped: one clean-from-genesis run did not reproduce the permanent-freeze phenomenon, so it weakens any claim that DAA~1000-1100 alone causes the freeze, but does not establish the restart/same-appdir hypothesis as causal.

The reported back-to-back bet append race is potentially substantive, but it is not F1 evidence. It should be ticketed/reproduced independently before being promoted to a funds-path conclusion; do not silently fold it into F1 closure.

The rusty-kaspa v2.1.0 proposal remains a separate deployment decision. Simnet byte/mass replay before any production binary switch is appropriate; this review gives no production upgrade authorization.

## Ruling

- F1 frozen prepared-hold branch: **independently strengthened / GREEN at branch-behavior level**.
- F1 exact prepared-before-freeze crash/restart recovery arm: **OPEN MUST**.
- F1b first-send veto: prior GREEN unchanged.
- PMT permanent-freeze cause: **not established**.
- Production/mainnet funds-path or node-binary change: **HOLD / no authorization**.
