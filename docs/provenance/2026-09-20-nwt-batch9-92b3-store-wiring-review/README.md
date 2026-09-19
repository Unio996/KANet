> **Status**: CURRENT（2026-09-20，NWT；对象 = `coord/j2-batch9-92b-driver-core-v0` 的 (iii-1) `ff6953fb`（父 `e83df356`）；一轮、只报 MUST）

# 批 9 · 9-2b(iii-1) 审（DB 端口 + 启动接线）—— NWT：**1 条 MUST：意图已 landed、后效没应用的市场会被永久搁置，没有任何路径重跑 `markLanded`**

亲跑：store 10/0、core 26/0、wiring 10/0、relay-ipc 33/0。真实依赖探针（`outputs.txt`）：
- **接线依赖齐全**：wiring 文件 import 的 16 个具名依赖（`SI.alertSettlementIntent` 等、`shared/lib/kaspa-network.mjs` 三个函数、`CLAIM_DRAW_CLAIM_OUT_INDEX`…）**一个不缺**；用真实 store / 意图表 / 指针 / c1 端口 + 桩 ops，`buildProductionDriver` **能构造出驱动**（`assertDeps` 通过）。
- **network 一致性**：mainnet 地址对 `network=mainnet` ok，对 `simnet` 拒；`stepBudgetFor(60000)=30000`、`(20000)=15000`、`(15000)` 拒——与 N91-4（≥15 s 且 < tick）**不冲突**（间隔太短时拒绝启动而不是放宽）。
- **claim id**：`newClaimId()` 是 64 位小写十六进制，`convert_to_claim` / `claim_draw` 两条键都过出口 S9。
- 开关判据 `PROTO_SETTLEMENT_DRIVER_ENABLED==='1' ∧ PROTO_RELAY_ID` 与 `PROTO_DRIVER_ENABLED` 无关；关闭态只打一行 `disabled`、不建 interval（读码 + J2 的 wiring 测试）。

## MUST-1：`landed` 后效没应用 ⇒ 市场永久搁置，且只报一次警
- **机制**：`checkSettlementIntentLanded` **先**把意图行置 `landed`，核心随后才调 `markLanded` 推进市场状态 / 建 claim / 建后续意图。之后：`listWork.landedChecks` 只取 `status='submitted'`；`seal` / `close_commit` 的触发条件都带 `NOT EXISTS … status IN ('landed','ambiguous')`。所以一旦 `markLanded` 在意图转 `landed` 之后失败（抛错，或进程在两步之间死），**没有任何一条查询会再把它捞回来**。
- **实测**（真实迁移临时库 + 真核心 + 真 store + 真意图表，`check_utxo_landed` 桩回 landed）：
  - B1：`seal` 意图 `landed`、市场仍 `betting` ⇒ `listWork` 在 0 处提到它 ⇒ 搁置；
  - B2：`resolve` 意图 `landed`、市场仍 `sealed` 且无 claim 行 ⇒ 0 处 ⇒ 搁置；
  - B3 端到端：市场 `sealed` 但没有下注（`deriveCloseCommitInputs` 失败 ⇒ `markLanded` 抛错）⇒ tick1 结果 `failed`、意图已 `landed`、市场仍 `sealed`、报警**一次**；tick2 该市场的工作项 **0**——链上 `resolve` 已落定，库里永远停在 `sealed`，之后再无报警。
- 这是"链上已发生、库里没推进、也没人再管"——正是批 9 目标（市场真能结算）的反面，且同一失败第二次起完全静默。`markLanded` 本身设计成幂等（前态谓词 + 同步事务），所以补救很便宜。
- **修法**：`listWork` 增加一类"后效待应用"（如 `appliedChecks`）：batch-9 意图 `status='landed'` 且后效谓词未满足——`seal` landed ∧ 市场 `betting`；`resolve` landed ∧（市场 `sealed` ∨ 无 win 型 claim 行 ∨ 该 claim 无 `convert_to_claim` 意图）；`claim_draw` landed ∧ `claim_txid IS NULL`；核心对它们每 tick 重跑 `markLanded`（幂等），失败则**按 (intent_key) 持续报警**（不能像现在只报一次）。测试加：我的 B1–B3 原样作回归（意图 landed 而市场没变 ⇒ 下一 tick 被应用；`markLanded` 持续失败 ⇒ 持续报警）。

## 记后续票（非 MUST）
- 每个 tick 重新 `import(ops)` 与 `import('kaspa-wasm')`（有缓存，无害）；`settlementTickBody` 在 ops 装载失败时自停，直到重启才恢复——与"开关即便为 1 首 tick 装载失败 LOUD 自停"一致，接线 (iii-2) 落地后此路径应消失。
- `close_commit` 的 `markLanded` 假设 v0 恰 1 条 payout（`payouts[0]`）；多条时会静默只建一条 claim——设计文本已写"v0 恰 1 条"，(iii-2) 的 `deriveCloseCommitInputs` 若放开需同步。

## 没做
- J2 自报变异 26/26 未重跑；四步 builder 入参装配（ops）是 (iii-2)；毒化 fee 向量的 simnet 到 (iii-2) 再起（先问 Bettor 内存）。
