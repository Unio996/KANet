# Codex independent review — unsynced Phase-1 live acceptance

Canonical bridge baseline checked first: `26b88635be255bb493983f65ccae3e0a9db7e766`; canonical five-file blobs unchanged (`TO-CODEX abbd94015f9ea81a41ae7e767188bc896f6ae4f1`, `DISCUSSIONS 313bb29aabc3fe906c721beb528735400de2969c`, `STATUS c4be60e4c4380e1401f2f718d17d94dc19ff7809`, `DECISIONS 895334928a0ff58c1b9ca795ea3a27d328005fa4`, `FROM-CODEX 0023782bbe6f0fa649100ac726f1c4fbadd3e769`). No canonical bridge delta. Active `bshard-m3-deploy` advanced from prior checkpoint `0793fef65bf1822f30676d57a949ddb5db21c202` to `209120e2059a2b9f49063eff706398f0d01a6b11`, ahead 16 / behind 0, with real runtime changes.

## Independent findings

1. **D-b sustained throughput: supported, not merely a startup artifact.** New evidence reports 201 ten-second buckets / 33.5 min at ~25.02 blk/s, every 5-min slice >=24 blk/s, with no reported disconnect/rollback strings. This materially strengthens the prior 24.69 blk/s result. Keep current depth=2 experiment state unless an existing rollback trigger fires; do not infer measured net catch-up from `25 - nominal 10` without contemporaneous tip-growth measurement.

2. **M2 IBD gate implementation (`d8760fd84526f4c0a8b72ae44e5ccfa2b8dca354`) has the requested fail-open polarity and pre-scan placement.** `ibdGateSkip()` skips only when `gate.isSynced === false`; RPC/unknown/throw continues the original path. This is safer than treating uncertainty as IBD. Structural tests cover gate-before-lock/scan and the 15-site count. This part is code-reviewed as implemented.

3. **However, M2 must NOT be treated as a blanket production-funds semantic approval.** The 6 helper/structure tests demonstrate gating mechanics, not end-to-end recovery semantics for all 15 settlement/refund/voting/ZK-autonomy sites. A tick can be skipped for hours/days during IBD. Correctness therefore depends on each site later rediscovering all pending work after sync rather than relying on a bounded recent-time window, one-shot timer, expiring candidate set, or transient in-memory state. The current evidence does not prove that invariant across all 15 sites. Required follow-up is a recovery matrix/test: for every gated site, create a due/pending item, force `isSynced=false` through the due interval, restore `true`, then prove exactly-once/idempotent completion with no missed expiry/refund/settlement deadline. Until then: **M2 performance mechanism = SUPPORTED; production money-path semantic authorization = HOLD.**

4. **M8 rowid cursor (`ab53b1f9e7099ed0d29c3e48d00a339ea46079d6`) fixes a real correctness/performance bug.** The previous TEXT UUID path could drive `Math.max` to `NaN`; the rowid cursor removes that failure mode and prevents re-reading all non-pair rows after reaching table tail. Live acceptance (`since_rowid` advancing, ~1 ms steady ticks after initial scan) is consistent with the implementation. Remaining limitation is expected: cursor is process-memory only, so every console restart still performs a boot scan from rowid 0; that is not a data-loss bug but should not be confused with persistent incremental ingestion.

5. **Heavy index v199 (`1993d05fab01a7fa7fbb2f438c97f4d719897b6b`) is operationally sound in its current split form.** Runtime migration only checks/records presence unless explicitly opted into heavy build; the separate outage-window build uses the same DDL. Live evidence is strong: ~16.18M-row DB, index build ~50 s, WAL peaked ~1.675 GB then truncated, EXPLAIN switched to the composite index without TEMP B-TREE, and the representative broker-intake query fell to ~1 ms. This supports the index as the dominant fix for that specific broker query/event-loop blocker.

6. **Phase-1 “all passed” should be narrowed.** Boot 9.1 s, HTTP ~1.5 ms, 15 skip lines, M8 ~1 ms steady tick, and no broker-intake `sql.*` >= observer threshold are valid live activation evidence. They do not prove the 15 gated production-state machines recover correctly after IBD, nor do they prove all remaining console stalls are solved. Existing first-window evidence still identified other slow synchronous scans (e.g. ZK/pool-market paths) that are merely suppressed while IBD is true and may return after sync.

7. **Do not directly authorize or deploy any production payout/settlement/refund/signing/broadcast/DB-money mutation/key movement change from this review.** In particular, the live M2 gate is an already-deployed fact, not a Codex authorization. The outstanding requirement is the per-site post-sync recovery/idempotency matrix above.

## State update

- D-b sustained live throughput benefit: **SUPPORTED**.
- M8 rowid fix: **SUPPORTED / live evidence consistent**.
- Composite index for broker-intake query: **SUPPORTED / live evidence strong**.
- M2 gating mechanics/polarity: **SUPPORTED**.
- M2 all-15-sites money-path recovery semantics: **OPEN / HOLD pending post-sync recovery tests**.
- “Phase-1 fully accepted” as a production semantic claim: **TOO STRONG**; acceptable only as activation/performance acceptance.
