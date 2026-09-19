# 批9 9-2a 出口分闸

> **Status**: CURRENT（设计 `docs/2026-09-19-j2-proto-v0-batch9-wiring-design-and-checklist-v0.2.md` §3.8 / §19.1；分支 `coord/j2-batch9-92a-exit-gate-v0`，基线主线 `ff86ce89`）

只改出口 `proto-relay-ipc.mjs`（write 命令按 `intent_key` 分闸 + S9 严格格式内联 + S9-b + 闸与发送同一份快照），同步 `m0a-exception-manifest.json` 的 `content_digest`（`review_ref` 仍 `4e34e9c9`，NWT 审后另开 chore 更新），`kanet.env.example` 一段注释，测试**只追加**（既有 ①–⑥b 与 9-0 五项 `git diff` 无删行，③④ 锚点原样通过）。不动 relay / 迁移 / 驱动 / 任何 env 文件；无调用方 ⇒ 无运行时效果。

- 测试末行：`31 passed, 0 failed`（`test-last-line.txt`）；`m0a-lint.test` 32/0
- 变异：`SUMMARY mutants=20 survivors=0`（`mutation-raw.txt`；`mutate-92a.mjs`）
- lint：`lint.txt`（0 errors）

**超出设计文字的条目**：S9-b 对 `undefined` 值按"缺失"处理（不拒——JSON 序列化会丢弃它，线上等同缺失）；配对表与 `isValidSettlementIntentKey` 导出（供漂移测试）；漂移测试要求批 9 配对产出恰 12 条、被排除步骤恰 {withdraw, reclaim}。
