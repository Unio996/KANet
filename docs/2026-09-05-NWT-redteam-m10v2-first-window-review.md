# NWT 红队 — M10 v2 首窗读数复核（console 停顿·施害者判据独立重跑）

> NWT · 2026-09-04T21:46Z · 输入 = J2 `scratch/_j2_m10v2_readout_preview.txt`（窗 2026-09-04T20:55:58Z→21:40Z，console 实例 20:55:52Z 起，M10 v2 patch1+2 生效）· 我方独立重跑 = `logs/console.log` 全部 `[diag:eventloop-lag]` × 全部 `.sync`/`sync=` 行，规则 = start=at−ms，|gapStart−start| ≤ 0.5 s（gapStart = lagAt − gap）· 只审不改。

## 1. 四条口径
1. 行数 p50 30/min、max 40 < 120 ⇒ 50 ms 阈值不动。
2. proc.* 9 站全表（含 0 命中写"已挂钩未触发"）；窗内仅 `proc.silverc.compile.pool-p2sh` 8 次 p50 15 ms ⇒ **同步子进程类在本窗排除**。
3. tg-bot pollSettleResults：J2 给 16.2% = onSend 墙钟上界（含排队在别人阻塞之后）；我此前 ~7% 是 CPU 口径。两尺并存，都不是施害者判据。
4. M8 证据行（`pair.scanAndIngestPairs since_id=NaN max_id=NaN hits=0` 窗内 74/74）可直接引。

## 2. 施害者（机械判据，164 个 lag 事件；≥5 s 51 个；≥30 s 12 个）
| 站 | n | p50 sync | 施害者(≤0.5 s) | 解释 gap | 同步段坐标 |
|---|---|---|---|---|---|
| **broker-intake.tick.sync** | 42 | 5.5 s（4–10 s） | **15** | 110 s | `broker-intake-watcher.js:703-717` `kaspa_tx_log … AND NOT EXISTS(broker_workflow_markers …) ORDER BY observed_at DESC LIMIT 50` 的 `.all()`，在首个 await（:720 `handleIntake`）之前；TICK_MS=60_000 |
| refund-claim-auto.tick.sync | 9 | 2.7 s | 3 | 12 s | `bettor-refund-claim-auto.mjs:43-57` `pool_bettor_sides … NOT EXISTS(chain_events …)` |
| broker-fee-emit.tick.sync | 4 | 1.0 s | 1 | 2 s | 未展开 |
| oracle-voter-health / zk-prove-worker | 1/1 | 59/109 ms | 1/1 | — | 毫秒级撞大 gap，巧合级不计 |
| **合计** | | | **21/164** | **312 s / 1410 s = 22%** | |

索引现状：`kaspa_tx_log` 只有单列 `to_address`/`from_address`/`block_time`（migrate.js:1869-1871），无 `(to_address, observed_at)`；`broker_workflow_markers(src_event_id)` 有索引（:2778）。文件注释原话：Trader-B 地址 24h 3093 行 = splitter 自循环链；全史行数**未核**（活库禁重查询，须在备份副本上 `COUNT` + `EXPLAIN QUERY PLAN`）。

## 3. 未解释 78%
≥5 s 未解释 gap 48 个（21:07:59 +63 s、21:01:37 +55 s、21:00:26 +53 s、21:03:29 +47 s…）。J2 ④ 表里"疑施害者·非起点"（zk.closeTickV2 −0.8 s、bshard-close-voter.v2Tick −0.9 s、judgePropose −48 s、preprune-capture-worker −12 s、send-command −48 s）全是 async 站：**async tick 不能堵 loop，它们能施害只有"首个 await 之后的同步段"**——起点不在 tick 起点，≤0.5 s 规则天然判不到。这是 M10 v2 的设计盲区（只包入口），不是 J2 的错。

## 4. 建议（observe-only·不改行为）
- **v3**：在上述五站内用 `stepSync` 包每段 `.all()/.get()/.run()/JSON.parse`（settle `pre` 段内的 buildPkMap/zkCloseTick 内部同理），阈 200 ms，判据不变。
- **broker-intake 修法归 Owner 批**（broker=钱路相邻）：候选 = 复合索引 `(to_address, observed_at)` / 缩窗 / 游标；先备份副本 EXPLAIN+COUNT 再定。建议进 Phase-1 清单与 M8 并列。

## 5. 未核
J2 正式页与 preview 的差异；kaspa_tx_log 全史行数；未解释 gap 里 GC/wasm 占比（需 `--trace-gc` 或 perf_hooks GC 观察，另案）。
