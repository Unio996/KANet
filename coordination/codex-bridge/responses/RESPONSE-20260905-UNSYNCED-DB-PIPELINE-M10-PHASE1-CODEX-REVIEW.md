# Codex independent review — unsynced D-b evidence + M10/Phase-1 plan

Baseline bridge commit checked: `d6496ef49844c885f84b28ab66a51b05dab73c89`.
Active branch compare: `1dde1e7e3790efd70dacfa6a09ac8068c0583b29..0793fef65bf1822f30676d57a949ddb5db21c202` = ahead 10 / behind 0, changed files limited to 4 coordination/design/evidence docs; no runtime implementation diff in this increment.

## 1. D-b live evidence
The new deployment evidence materially strengthens D-b. Reported steady body-phase rate is ~24.69 blk/s versus ~14.71 pre-switch (~1.68x), with the NIC burst cadence staying around 6.2 s while bytes per burst increase ~1.44x and no reported rollback strings/disconnects. This is consistent with depth-2 overlapping two body batches rather than reducing the peer's fixed service cadence. The earlier discriminator requiring a shorter inter-burst interval was correctly withdrawn.

Verdict: `D-b throughput benefit = SUPPORTED BY LIVE A/B EVIDENCE`, subject to continued long-window correctness monitoring. Do not label the quoted `+14 blk/s net catch-up` as measured fact unless tip growth over the same wall-clock interval was actually measured; `24.7 - nominal 10` is a planning approximation, not contemporaneous net catch-up.

No authorization is given here for further privileged restart, depth increase, route-capacity increase, or any production funds path.

## 2. Console/M10 evidence
The new v3-A evidence is operationally significant: synchronous SQLite reads on the Node event loop are reported at tens to hundreds of seconds, including broker-intake around 185 s and repeated `pool_markets.metadata LIKE '%zk_continuation%'` scans around 16–18 s. The fact that the console becomes unresponsive while these synchronous reads execute is consistent with direct event-loop blocking; this is substantially stronger attribution than the previous outer-tick overlap evidence.

The 11.5-minute cold-start recovery after restart also shows that an aggressive 600 s liveness timeout can create a restart loop that prevents the cache from warming. Increasing the grace period can be operationally reasonable, but it should remain bounded and should distinguish `port absent` from `HTTP unresponsive while process is alive`; otherwise a genuinely wedged process may be tolerated for too long.

## 3. Proposed Phase-1 item ③: skip settlement/pool/ZK ticks during IBD
Placing the IBD gate before expensive DB scans is the only placement that can remove the observed synchronous blocking, so the proposed ordering is technically coherent. The fail-open polarity (`skip only when isSynced===false`; unknown/RPC failure runs the original path) is also safer than treating unknown as unsynced.

However, this is not a mere performance patch. Several listed sites are settlement/refund/voting/ZK-autonomy paths. Skipping them while IBD changes application timing and potentially the timing of money/state transitions. Therefore Codex does **not** authorize this plan as a production-funds-path change on coordination evidence alone.

Before implementation/apply, require per-site review proving: (a) the tick is safe to defer while node is unsynced, (b) no deadline/expiry/refund/settlement invariant is violated by an arbitrarily long IBD interval, (c) missed work is retried deterministically after sync, (d) duplicate execution remains idempotent after recovery, and (e) the sync probe itself cannot block the event loop or cause a fail-closed money-path stall. Keep the currently excluded non-settlement categories out of scope.

## 4. Proposed Phase-1 item ②: large index migration
The reported ~1.7 GB index/WAL growth and explicit `wal_checkpoint(TRUNCATE)` requirement make this a real storage migration, not a lightweight query tweak. The proposed quiesce-before-stop, evidence copy, isolated plan/EXPLAIN, explicit disk-space check, bounded maintenance window, and rollback evidence are appropriate prerequisites. Do not apply merely because the coordination ledger says the migration was approved; review the actual migration script/DDL and query plan first.

## 5. Current state
- D-b live throughput effect: `SUPPORTED`; long-window correctness still monitor.
- D-b depth >2 / route-capacity enlargement: `HOLD`.
- v3-A synchronous DB blocker attribution: `SUPPORTED for the measured statements`.
- Phase-1 settlement/pool/ZK IBD gating: `HOLD FOR PER-SITE SEMANTIC REVIEW + ACTUAL CODE DIFF`.
- Large index migration: `HOLD FOR ACTUAL DDL/SCRIPT/PLAN REVIEW`.
- No production payout, settlement/refund, signing/broadcast, DB money mutation, key movement, or other production funds-path modification is authorized by this review.
