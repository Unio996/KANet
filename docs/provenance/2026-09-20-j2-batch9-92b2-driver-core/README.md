# 批9 9-2b (ii)：结算驱动核心（编排层）+ S5

> **Status**: CURRENT（设计 §3–§12 / §19.3–§19.4；分支 `coord/j2-batch9-92b-driver-core-v0`，基于 (i) `77bb80fe`）

- `kasia-console/src/lib/proto-settlement-driver-core.mjs`（新，纯编排）：通用顺序（建 pending 意图先于任何 IPC → 依赖 landed → 指针 → C1 → close_commit 的 pmt 门 → builder → `covenant_broadcast` → landed 检查 → landed 记账端口）、失败分类与报警闭集 `SETTLEMENT_ALERTS`、prepared 只同字节重播、pmt 门（读 relay `get_past_median_time`，不用本地时钟）+ SLA + 读失败计数、refund_flip 探测、`prepared_stale`、runTick（cap / 单条失败不拖垮）。**所有外部依赖经 deps 端口注入**：不 import DB / relay-manager / kaspa-wasm，不碰私钥，无调用方 ⇒ 无运行时效果。
- S5：`buildCloseCommitTxJson` 只接受 `source==='relay'` 且 `readAtMs` 距今 ≤ 60 s 的 `pmtEvidence`，否则忽略回退 300 s 墙钟守卫（既有 ⑥a/⑥c 测试补新形状；新增 ⑥d 六种被忽略形态 + 新鲜放行）。

- 测试末行：见 `test-last-line.txt`（core 23/0、assembly 44/0）；变异 `mutants=25 survivors=0`（`mutation-raw.txt`；首轮 2 存活 Z5/Z8 已补强测试，原始输出 `mutation-raw-round1.txt` 保留）；lint `lint.txt`。
- **不在本笔**（(iii)）：真实端口（DB 查询 / 四步 builder 入参装配 / landed 记账的 SQL / claim 行创建 = `randomBytes(32).toString('hex')` 并过出口 S9）+ 启动接线 + 开关 8 态 + 启动日志。
- **超出设计条目**：`checkPmtGate` 导出；`settlement_step_unexpected_error` 登记；`driveIntent` 把 `buildAndBroadcast` 的错误包成新错误（丢类型 / code）——核心在闭包里留原始错误 + 阶段再分类（假 driveIntent 忠实复现这一点）。
