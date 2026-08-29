# 钱路静默缺陷两条 · 定级页 v0.1 —— ① `broker-fee-emit` pendingIndex 重扫是否双花 / ② `checkBrokerEscrow` 硬编主网地址在 TN12 喂的是哪条路

> **Status**: DRAFT v0.1 · J2 2026-08-29 · Bettor 优先级重排 ①②（源自 eventloop 调查稿 `77b1efde` §4 顺手缺陷）· 只读代码 + 只读日志，未动进程/库 · NWT 定级。坐标 J2 亲读 2026-08-29。

## ① `broker-fee-emit` —— **不是双花；降级为"浪费 + 通知可能永远发不出"**
**它做什么**（`kasia-console/src/services/broker-fee-emit.mjs:1-12`）：broker 佣金**链上 LANDED 后**写一条 `chain_events(event_type='broker_fee_landed')` 供 tg-bot 发 DM。**它不广播、不转账、不写任何余额**——emit 侧只读 `kaspa_tx_log.outputs_json` 取真金额（:6 "禁 DB 估算"）。⇒ 重扫的最坏后果是**重复 DM**，不是重复付费。
**幂等（双守）**：
- `chain_events` 写入用 `INSERT OR IGNORE` + 表上 `UNIQUE(txid, event_type)`（:235-239 与 :253-256；索引 `sqlite_autoindex_chain_events_2`，离线 audit 核过）⇒ 同一 landedTxid 第二次插入静默丢。
- `markEmitted()`（:319-326）在 emit 或终态跳过（`no_broker_output` / `no_broker_output_zk` / `zero_fee`）时把 `pool_markets.metadata.$.broker_fee_landed_emitted_at` 写上 ⇒ 候选查询（:107-116）下次不再选中。
- 启动一次性 backfill-suppress（:70-88，sentinel `fee_emit_backfill_done`）把部署前的 completed 盘全标记，不发历史 DM。
**"pendingIndex 永不标记"是有意的**（:133 注释 "NO TX NO STATE: 没 index 就不 emit·下 tick 重试"）：settle/claim tx 还没进 `kaspa_tx_log` ⇒ 不标记、等索引。代价：这些盘每 5 min 被候选查询重新拉出（:107-116 = `pool_markets` 全表 + 两次 `json_extract`，42 MB/7.9K 行 ⇒ 百 ms 级，见调查稿 §3 #6），每盘再做一次 `getIndexedTxOutputs` PK 查（µs）。
🟡 **真正的缺口不是钱，是"永远 pending"**：若该 tx **永远不会**进 `kaspa_tx_log`（broker 地址当时不在任何 relay 的 watched 集合 / 索引 relay 当时离线 / tx 早于索引器上线），这盘就永远 pendingIndex——broker **永远收不到到账 DM**，且没有任何告警（tick 汇总行只在 `emitted||noBrokerOutput||backfillSuppressed` 时打，:313）。**修法（非阻塞）**：pendingIndex 超 N 天（如 3 天）⇒ 走 RPC 回读兜底（`cross-chain-verify` 已有 kaspa 分支 "本地优先 RPC 降级"）或标记 `stale_unindexed` + 告警一次；同时把候选查询改成有索引的形（调查稿 L1 `pool_markets(broker_pk)`）。
**定级建议**：非钱路 bug；P3（性能 + 可观测性）。

## ② `checkBrokerEscrow` 硬编主网地址 —— **条件性静默钱路缺口：安全网在 TN12 结构性失效（方向反）**
**坐标**：`kasia-console/src/services/broker-state-machine.js:249` `TRADER_B_KAS_ADDR = 'kaspa:qrxw764…'`（**主网前缀**）；`checkBrokerEscrow` :251-274 查 `kaspa_tx_log WHERE to_address = <主网地址>` ⇒ TN12 库里恒 0 行 ⇒ `inAmt === 0` ⇒ **恒返回 `false`**（:260 "真没入金"）。
**谁消费**：`reconcileStaleOrders` :287-320（15 min cron，`index.js:826-829` 接线；每次 ≤10 单）：`retail_dex_orders.state='awaiting_payment'` ∧ 创建 >30 min ∧ `broker_workflow_markers` 无 `%paid%` 标记 ∧ 过 1 h 启动宽限 ⇒ 调 `checkBrokerEscrow` ⇒ **false ⇒ `transition(awaiting_payment → failed, {no_escrow:true, reason:'reconcile_no_escrow'})`**。
**`failed` 的入场条件**（:64-71）：`refundTxHash_or_no_escrow` —— 要么带退款 txid，要么断言 `no_escrow`（"broker 从未持有该用户资金，故无需退款"）。`no_escrow:true` 是**免退款的终态断言**。
**设计本意**（:236-241 注释）：escrow 检查是第二道网——若 `paid` 标记漏了但 broker 确实收到钱（链上可见入金），就**别** force-fail，留给人工/重试。作者也写了方向判断："false neg（broker 真已退但仍判 escrow → 不 force-fail）比 false pos（broker 没退但判已退 → force-fail 误退 active row）安全得多"。
🔴 **在 TN12 上这道网的方向反了**：地址错 ⇒ 永远"没入金" ⇒ 永远 force-fail。⇒ **场景**：用户已向 broker 付款，但 intake 漏记 `paid`（intake-watcher 漏抓、relay 当时离线、或付款在 30 min 窗后才被索引）⇒ 15 min 内该单被标 `failed + no_escrow`，**用户的钱在 broker 地址里，订单却声称"从未持币、无需退款"**——没有任何退款路径会再碰它（`failed` 是终态，`broker-state-reconciler` 的 refund 修补只看 `expired`/`refund_send_failed`）。
**触发概率**：需要 "已付款 ∧ paid 标记缺" 同时成立——intake 的 `paid` 是主闸，通常能记上；但主闸本来就是"可能漏"才配第二道网，而第二道网在 TN12 从未工作过。**历史是否已发生**：只读可核——`SELECT count(*) FROM retail_dex_orders WHERE state='failed' AND json_extract(metadata,'$.reason')='reconcile_no_escrow'`（列名按实际 schema 调；**须在离线副本或 Bettor 授权的只读句柄上跑**，本稿未跑）；每一条再对 `kaspa_tx_log` 用 **TN12 broker 地址**回查是否有入金 ⇒ 有 = 真受害单。
**最小修法（报备，不动码）**：
1. `TRADER_B_KAS_ADDR` 改为运行时来源：`process.env.BROKER_KAS_ADDR`（kanet.env）或 broker relay 的 `relay_nodes.address`，并 **校验前缀与 `KASPA_NETWORK` 一致**（`kaspa:` vs `kaspatest:`）。
2. **fail-safe 方向**：地址缺失/网络不匹配/查询异常 ⇒ `checkBrokerEscrow` 返回 **`true`**（"当作已持币，不 force-fail"）+ 一次 loud 告警；绝不在信息缺失时断言 `no_escrow`。这与作者自己写的方向判断一致。
3. `reconcileStaleOrders` 在 `no_escrow` 之前多一道：`kaspa_tx_log WHERE to_address=<broker> AND amount≈qty AND block_time≥created_at`（与 :253-258 同形，只是地址对）——地址修好后自动成立。
4. 回归 case：`state-machine` 测试里加 "TN12 网络 + 主网地址配置 ⇒ 返回 true 且告警" 与 "地址正确 + 有入金 ⇒ true" 两向量。
**同族坐标**：`retail_dex_orders` 无 `created_at` 索引（调查稿 §3 #3）；`kaspa_tx_log.from_address` 100% NULL（:239 注 T-NWT-07）⇒ 出金匹配本就全 miss，说明这函数在主网也只有"入金"半边在工作。
**定级建议**：**P2 钱路静默缺陷**（条件触发、影响用户资金可退性、无告警）；修法 ≤ 20 行 + 2 向量；先跑历史核查确定有无受害单。

## ③ 附：Bettor ⑥ `bettor-auto-valve:172`（NWT 已确认）—— 审计可见性缺口
`chain_events` INSERT 缺 `txid`/`observed_by`（双 NOT NULL）⇒ 每次抛、被 :176 吞 ⇒ valve 触发从未落库。操作对象是 `sim_position`（非链上）⇒ 不是钱，但 valve "为什么动了仓位"从此不可审计（silent-defect 族）。修：补 `txid` 用内部标记形（同 fee-emit sentinel 的做法：非 `broker_` 前缀事件不受 v83 trigger 约束）+ `observed_by='bettor-auto-valve'`；真修不急。

## §边界
- 未跑任何库查询；②的"历史受害单"核查是下一步（离线副本或授权只读）。
- `retail_dex_orders` 的 metadata/reason 列名未核（写在查询里的是示意）。
- 未核 tg-bot 侧对重复 `broker_fee_landed` 的处理（① 的 UNIQUE 已在写侧挡住，消费侧不需要）。
