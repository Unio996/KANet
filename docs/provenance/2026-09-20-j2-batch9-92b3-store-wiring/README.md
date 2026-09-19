# 批9 9-2b (iii-1)：DB 端口 + 启动接线 + 出口闸报警去重

> **Status**: CURRENT（设计 §3 / §4 / §5 / P3 / P4 / §9 / §19；分支 `coord/j2-batch9-92b-driver-core-v0`，基于补笔 `e83df356`）

- `lib/proto-settlement-store.mjs`（新）：工作发现（seal 触发的 P3 条件逐条、close_commit / convert_to_claim / claim_draw、prepared 行排最前并去重 = 重启恢复）、依赖检查（含跨 subject_type）、landed 记账（同步事务、前态谓词、幂等；close_commit 建 win claim 行，id = `randomBytes(32).toString('hex')` 并有测试过出口 S9；convert ⇒ claim_draw 意图；claim_draw 记 claim_txid/vout/claimed_at）。
- `services/proto-settlement-driver.mjs`（新）：开关 `PROTO_SETTLEMENT_DRIVER_ENABLED`（8 态，与 PROTO_DRIVER_ENABLED 无关）、`disabled` / `started (tick…, cap…, network=…)` 日志、单飞、健康检查（不健康 ⇒ 跳过整 tick 零 IPC）、network 只取自 `configuredNetwork(env)` 且与 relay 地址整段前缀精确一致（S7）、每步预算 = tick 间隔一半、ops 不可用 / 网络不符 ⇒ LOUD 自停。`index.js` 加一处 `startProtoSettlementDriver()`（在 `startProtoDriver()` 之后）。
- `proto-settlement-driver-core.mjs`：出口分闸拒绝报警按 `(intent_key, code)` 去重（成功清零）——Bettor 追加项，否则确定性拒绝每 tick 刷 events。
- `proto-driver.mjs`：仅把 `REORG_SAFE_MIN_DEPTH` 加 `export`（接线复用同一常量）。

测试末行（`test-last-line.txt`）：core 26/0、store 10/0、wiring 10/0；变异 `mutants=26 survivors=0`（首轮 1 存活 S11 已补强，`mutation-raw-round1.txt` 只改名保留）；lint 8 文件 0 errors。

**状态坦白**：四步 builder 入参装配（`proto-settlement-ops.mjs`：prepare / build / probeRefundFlip）= (iii-2)，本笔【没有】——开关即使被写成 1，第一个 tick 装载 ops 失败会 LOUD 拒绝并自停（有测试），不会带着半截端口跑钱路。所以本笔合入后 9-4 端到端还跑不起来，要等 (iii-2)。
**超出设计条目**：`settlementTickBody` 导出（tick 体可测）；`_settlementDriverTestState` / `_resetSettlementDriverState`（lint 的 ForTests 命名规则逼出的改名）。
