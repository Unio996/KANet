# Codex review — unsynced D-b resource envelope / handles

Checked against canonical `coord/codex-bridge` HEAD `059eca96f1bc9de61e34658e4f9a98edeed484cb` and active `bshard-m3-deploy` checkpoint `4b57c9aa8030cc4726d4e3fb60e1568fb3019d50`.

## Git / blob basis

Canonical compare `059eca96... -> coord/codex-bridge`: identical, ahead 0, behind 0, files=[]; no bridge message delta.

Canonical five-file blobs remain:
- TO-CODEX.md `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- DISCUSSIONS.md `313bb29aabc3fe906c721beb528735400de2969c`
- STATUS.md `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- DECISIONS.md `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- FROM-CODEX.md `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Active compare `4b57c9aa... -> bshard-m3-deploy`: ahead 1, behind 0, total commits 1. Only `docs/iteration/COORD-LEDGER.md` changed (+3/-0); no runtime implementation diff. Source commit: `e70cc17c3fcc92c608258a710edef12c24152561`.

## Independent assessment

New point: kaspad WS 24.24 GB, handles 17,938 (~+70/h over the cited interval), host free 11.72 GB, commit 57.6, recent ~2 h throughput 29.05 blk/s, no reported D-b error signatures.

The prior 4 h observation of WS oscillating around 22.8–23.6 GB remains valid for that window, but the new 24.24 GB point means a durable plateau is still not demonstrated. Current evidence is better described as **non-monotonic working-set oscillation with a possibly rising upper envelope**. Therefore:

- D-b sustained throughput benefit: **SUPPORTED**.
- D-b long-run memory/resource stability: **OPEN**.
- Handle stability: **OPEN**, and must remain a separate acceptance axis even if WS later plateaus.
- Immediate D-b rollback from this point alone: **NOT INDICATED**.

The ledger's `~+0.3 GB/h` and `~19 h to 30 GB` are short-window linear extrapolations, not measured future behavior. Keep 26/30 GB as operational decision thresholds if desired, but do not present ETA-to-threshold as evidence.

The proposed **26 GB pre-rollback EXPLAIN** is directionally sound only as preparation: capture the exact current and candidate rollback query plans, index/statistics state, compile options, and representative parameters before changing anything. An EXPLAIN result by itself must not authorize a cache/index/SQL rollback, and no production money-path selector or state mutation should be coupled to this resource threshold without separate review.

For the next trend point, preserve the same wall-clock basis and record at minimum: WS, private/commit bytes if available, handles, host free/commit, throughput, compaction/DB phase, peer count/mix, and whether any process/config restart occurred. A continuously rising handle series across otherwise stable WS would warrant its own leak/resource-retention investigation.

No production payout, settlement/refund selector switch, signing/broadcast, DB money-state mutation, key movement, or other production funds-path modification is authorized by this review.
