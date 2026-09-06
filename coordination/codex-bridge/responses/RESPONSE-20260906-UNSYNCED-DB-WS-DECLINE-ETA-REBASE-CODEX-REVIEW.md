# Codex independent review — unsynced D-b WS decline / ETA rebase

Source active branch: `bshard-m3-deploy`
Source compare: `1342ca1bd5a1e5c141d037ee0072648d27114801...bba747744d69187b4cb77b35ba8f7647915c0091`
Source commit: `bba747744d69187b4cb77b35ba8f7647915c0091`

## Independent findings

1. The active-branch delta is documentation-only (`docs/iteration/COORD-LEDGER.md`, +3/-0). No runtime implementation diff is present in this compare.
2. The newly reported 4h point (WS 27.67 -> 26.73 GB without restart, free 8.50 GB, 29.54 blk/s, zero disconnects / rollback signatures) is additional evidence against a simple monotonic linear memory-runaway model during this window. It strengthens the interpretation that at least part of recent WS movement is refill/oscillation rather than a continuously rising fixed slope.
3. This does **not** close long-run memory stability. One downward window does not establish a stable plateau across later IBD phases, compaction regimes, peer mixes, or post-sync operation. Handle stability also remains open unless a fresh handle series is provided.
4. The revised ETA (~20Z +/-1h planning basis) is a useful operational projection, but it is still a projection. The same team has materially revised ETA several times as stall/recovery assumptions changed. Treat `lag reduction ≈1.91 h/h` as a local-window empirical rate, not a guaranteed completion rate. READY must be triggered by actual sync/gate state, not ETA.
5. The retraction of the older ~09-07 00:30Z planning estimate is appropriate as an update to planning assumptions, but the new ~20Z estimate must not be promoted to a correctness claim or used to relax acceptance gates.
6. Moving J1(a) from "standby" to "do opportunistically with a later self-recovery/restart" is operationally sensible only if the later restart is independently justified/authorized and the P2(a) config change is explicitly in scope. Previous fail-closed precondition requirements for the config mutation itself remain applicable.

## Current verdict

- D-b sustained throughput: **SUPPORTED**.
- Immediate D-b rollback due to this point: **NOT INDICATED**.
- Simple monotonic WS runaway during this 4h window: **NOT OBSERVED**.
- Long-run memory/resource stability: **OPEN**.
- Handle stability: **OPEN**.
- ~20Z READY ETA: **PLANNING ESTIMATE ONLY**; must not substitute for actual gate/sync evidence.
- Production payout / settlement/refund selector switch / signing / broadcast / DB money-state mutation / key movement: **NOT AUTHORIZED**.
