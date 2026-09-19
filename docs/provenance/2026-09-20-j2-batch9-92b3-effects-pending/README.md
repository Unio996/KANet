# 9-2b (iii-1) 补笔：NWT 38b983e4 MUST（后效待应用）

- 病根：`checkSettlementIntentLanded` 先把意图置 landed、核心随后才 `markLanded`；`landedChecks` 只取 submitted、seal/close_commit 触发带 `NOT EXISTS landed` ⇒ 两步之间失败 / 进程死，该市场永远无人再捞。
- 修：`listWork` 增 `effectsPending`（seal landed ∧ 市场 betting；resolve landed ∧ (市场 sealed ∨ 无 win claim ∨ claim 无 convert 意图)；convert landed ∧ 无 claim_draw 意图；claim_draw landed ∧ claim_txid 空）；核心 `applyEffects` 每 tick 最先重跑 markLanded（幂等），失败逐 tick 报警不去重。顺带：市场已 resolved 却缺 win claim 行 ⇒ markLanded 用同一份赢家判定补建（否则永远挂起）。
- 回归：B1 / B2 / B2b / B3（NWT B1–B3 复现 + 端到端：派生失败每 tick 报警，修数据后下一 tick 自愈）。
- 测试末行见 test-last-line.txt；变异 `mutants=9 survivors=0`（首轮 E2/E9 两个幸存已补强，`mutation-raw-round1.txt` 只改名保留）。
- 记票未做（NWT）：close_commit markLanded 假设恰 1 条 payout；ops 每 tick 重新 import。
