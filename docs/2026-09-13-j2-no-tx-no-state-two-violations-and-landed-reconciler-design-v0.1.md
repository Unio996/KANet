# (c) NO TX NO STATE CHANGE 两处违反修法 + submit/landed 对账器 · 设计骨架 v0.1（不落码）

> **Status**: DRAFT-FOR-REVIEW **v0.2**（2026-09-13T12:18Z · 收 Codex 8968452d ③④ + NWT 审 + Bettor 合并派单：**F1 深度门改 `check_utxo_landed` + 单一源 `REORG_SAFE_MIN_DEPTH`（`pool-shard-register.mjs:88`，不新写 20）**——Codex 实核 `cross-chain-verify.mjs` kaspa 本地索引分支命中即 `confirmations:1/required:1` 硬编码，`vr.confirmations >= 20` 不是真深度门；**F2 幂等改为广播前持久 submit-intent + 幂等键随 relay 走 + 确定性交易身份**，attempt ≥ 2 前只查 relay 侧权威来源（mempool / 最近广播记录 / 意图记录），**不查 settler 自己的 metadata**（NWT 唯一 MUST-FIX = Codex F2 HOLD）；F2-I5 向量改写；Q3 加列 / Q4 复用 G-1 readonly 按我倾向；**双付审计闭合 §9：风险面、未发生**）· v0.1（2026-09-13T11:45Z · J2 · Bettor 派工 SendMessage 11:4xZ「先 (c)，docs 一页，交 NWT 审」）· 出处：Codex 9fff92b0 #5（"A perfect G-1 gate cannot make submit-accepted equivalent to chain-landed… MUST before any value-bearing mainnet wave"）· NWT 清单 v0.1/v0.2 ③ + ④-1 · CLAUDE.md 状态注记 2026-07-29（两处违反坐标）· 🔴 **钱路 ⇒ 实现 Owner 批**；本稿只裁不变量、修法、账本列、向量。
> 行号随 HEAD `aeda63a8`。与代币无关，任何带值波（波 2 起）前 MUST。

## 1. 事实（全部 grep 可核）

| # | 事实 | 出处 |
|---|---|---|
| V1 | `exchange-machine.js` kaspa 支付路径**硬构造"已确认"**：`if (payment_chain === 'kaspa') { … vr = { confirmed: true, confirmations: 1, … } }`，注释写 "submitTransaction = verified"；随后写 `meta.verified_tx / verified_at` 并沿 BUY 路推进。**验证器本身在**：`cross-chain-verify.mjs:169 verifyCrossChainTx` 的 kaspa 分支（`:183-`，`kaspa_tx_log` 优先 + RPC 降级，`:474-492`），这条路从未调它 | `exchange-machine.js:826-829` `trusting txId … (submitTransaction = verified)`；`:831-838` |
| V2 | `bettor-prediction-settler.js`：`sendCommandAsync(escrowRelay.id, { type:'transfer', target: winnerAddr, amount })` 返回 `txId` = relay **mempool submit 即回**（`relay.mjs:504-514`：`sent = { txId }` 后 `ingestTx(... direction:'outbound')`）；拿到 `payoutTxId` 即 `transition(offer.id, 'completed', { metadata: payout_tx })` 并写 `prediction_reputation_log 'paid'`——**无任何落链核实**。三次重试循环只看 `result?.txId` 为空就重发 | `bettor-prediction-settler.js:174-181, 198-205, 216` |
| V3 | **正路已存在**：relay 命令 `check_utxo_landed(address, txid, minDepth)` → `{ landed, depth }`（`relay.mjs:1196-1207` → `p2sh.mjs checkUtxoLanded`），`pool.js:1534/1795/2018`（minDepth=20 reorg-safe）与 `bshard-close-enforce.mjs:394` 都在用 | |
| V4 | **账本没有"落链"这一列**：`tx_records.status` 永远 `'broadcasted'`（DATABASE.md 自述"已知局限"），且**无 target_address 列**；`kaspa_tx_log` 只索引 `watched_addresses` 的收款输出（`to_address / block_hash / block_time`），发出方常为 NULL | `docs/DATABASE.md` §tx_records / §kaspa_tx_log |
| V5 | 本机库两条路痕迹全 0（`payout_tx / verified_tx / payment_tx` 皆无）⇒ 缺陷没显形，不是风险低 | CLAUDE.md 状态注记 07-29 |
| V6 | 既有对账 cron 形可照抄：`broker-state-reconciler.js`（5 min tick、v1 只 detect + alert 不自愈、查 `kaspa_tx_log` 对链上真相） | 文件头注 |

## 2. 不变量（Codex #5 落地形）

- **I1** `submit accepted ≠ chain landed`。relay 回 `txId` 只证进了本机 mempool（且可能输双花竞争，`relay.mjs:1198` 注释原话）。
- **I2** 代表"付款/派彩完成"的状态推进（`completed` / `verified_*`），**只能由独立的 landed+depth 证据触发**（`check_utxo_landed(minDepth ≥ N)` 或 `kaspa_tx_log` 命中 + 深度）。
- **I3** 失败/未知 = **非终态**：留在 `verifying` / `delivering`，下 tick 重核；**永不乐观写**（同 CLAUDE.md 第零条 bis）。
- **I4** 每笔递交必入账并有落链回写：`tx_records` 加 `target_address / landed_at / landed_depth / landed_checked_at`；对账器只认账本。
- **I5** 重试不得双付：重发前必先核"上一笔是否已在 mempool/已落链"（V2 的重试循环今天没有这一步——列为子发现，见 §7 Q2）。

## 3. 修法

| # | 站点 | 改什么 | 量级 |
|---|---|---|---|
| F1（**v0.2 订正·Codex ③**） | `exchange-machine.js:826-829` | 删硬构造分支。**两段**：(i) 收款人/金额核 = `verifyCrossChainTx({ chain:'kaspa', … })` 现有 kaspa 分支（`kaspa_tx_log` 命中 ⇒ `recipient/actualAmount` 可信；但它的 `confirmations:1/required:1` 是硬编码，**不当深度用**）；(ii) 深度核 = relay `check_utxo_landed(expectedTo, payment_tx, minDepth = REORG_SAFE_MIN_DEPTH)`（`import { REORG_SAFE_MIN_DEPTH } from '../lib/pool-shard-register.mjs'`，**单一源，不新写 20**）。**单一不变量**：`completion = recipient/amount valid ∧ landed(depth ≥ REORG_SAFE_MIN_DEPTH)`；任一不满足 ⇒ 不写 verified_*，留 `verifying`，交既有 `timeoutVerifying` 兜底。`expectedTo` 对 kaspa 路 = `meta.receive_address \|\| expected_address \|\| offer.maker`（原逻辑保留） | ≈30 行 |
| F2（**v0.2 订正·Codex ④ + NWT MUST-FIX**） | `bettor-prediction-settler.js:174-216` + relay `transfer` 命令 + 新表 | **广播前先有持久身份**（三件）：(a) **submit-intent 表** `payout_intents(intent_key TEXT PK, offer_id, relay_id, target_address, amount_sompi, status pending\|prepared\|submitted\|landed\|abandoned, prepared_txid, submitted_txid, created_at, updated_at)`，`intent_key = 'payout:' + offer_id`（幂等键，UNIQUE）；settler 在**任何** IPC 之前 `INSERT OR IGNORE` 一行 `pending`；(b) **幂等键随 relay 走**：`transfer` 命令新增可选 `intent_key`；relay 侧 **两阶段**：先构造交易、算出**确定性 txid**（kaspa-wasm `Transaction.id` 在 inputs/outputs 固定后即确定），经 IPC 先回 `{ phase:'prepared', txid }`（console 写 `prepared_txid`），再 `submitTransaction`，回 `{ phase:'submitted', txId }`；relay 进程内 `Map<intent_key, txid>` 拒绝同 key 二次广播（进程重启后靠 (c)）；(c) **attempt ≥ 2 的唯一前置** = 查 **relay 侧权威来源**，顺序：① `payout_intents.prepared_txid/submitted_txid` 非空 ⇒ `check_utxo_landed(target, txid, 0)` 或 relay `mempool` 查询（新增只读命令 `get_mempool_entry(txid)` 包 RPC `getMempoolEntry`）有 ⇒ **不重发**，转核实；② 都空（IPC 在 prepared 之前就断）⇒ 才允许重发。**settler 自己的 `metadata.payout_tx` 不作重试判据**（它只是 UI 展示副本）。**(ii) 核实**：`check_utxo_landed(target, submitted_txid, minDepth = REORG_SAFE_MIN_DEPTH)` ⇒ `landed` 才 `transition('completed')` + reputation `'paid'` + intent `landed`；未落链 > 30 min ⇒ events `payout_not_landed`，intent 留 `submitted`，offer 留 `delivering` | ≈120 行 + 表 + relay 命令 |
| F3 | 新 `services/tx-landed-reconciler.mjs`（5 min cron，形同 `broker-state-reconciler.js`） | 源 = `tx_records WHERE direction='outbound' AND landed_at IS NULL AND created_at < now−10min`。逐笔：① `kaspa_tx_log` 按 `tx_id` 命中 ⇒ `landed_at = block_time, landed_depth = 当前 DAA − 块 DAA`（需 block DAA；kaspa_tx_log 现只有 block_hash/time ⇒ 先用 RPC `getBlock(block_hash)` 取 daaScore，或 ② `check_utxo_landed(target_address, txid, 0)` 拿 depth）。**T+10 min 三源无**（log 无 / landed=false / mempool 无）⇒ events `tx_not_landed`（level warn，payload 带 relay/trace）+ **冻结该 relay**（NWT 1001 ④-1）——v1 只 detect + alert（同 broker-state-reconciler v1 口径），冻结 = G-1 `readonly` 态落地后接（写一个 `relay_money_freeze` 标记表由 G-1 闸读） | 新文件 ≈200 行 |
| F4 | `migrate.js` vNNN（接末尾块，自查命令见 CLAUDE.md）+ `DATABASE.md` | `tx_records` 加 `target_address TEXT / landed_at TEXT / landed_depth INTEGER / landed_checked_at TEXT`；索引 `(direction, landed_at)`；`ingestTx` 16 处调用补传 `target_address`（relay `transfer` 分支已知 `cmd.target`） | 表改 + 16 处补参 |
| F5 | `relay.mjs:504` `ingestTx` | 带 `target_address: cmd.target`；`status` 仍 `'broadcasted'`（不改语义，落链信息只在新列） | 1 行 |

**不做**：不改 relay 的 submit 语义；不把 `check_utxo_landed` 塞进 `transfer` 命令里同步等（会把 relay 卡在 IPC 上 ≥20 块）。

## 4. 向量（每条一正一反 + 弱注入；离线 = 临时 DB + 假 `sendCommandAsync` / 假 `verifyCrossChainTx`）

| # | 设置 | 期望 |
|---|---|---|
| F1-正 | kaspa 支付 `payment_tx` 在 `kaspa_tx_log`（收款人/金额对）且假 relay `check_utxo_landed` ⇒ `{landed:true, depth ≥ REORG_SAFE_MIN_DEPTH}` | `verified_tx` 写入、推进 |
| F1-反 | log 无 + `landed:false` | **不写** verified_*，offer 仍 `verifying`；30 min 后走 timeoutVerifying |
| F1-弱注入 | 同正向量，`depth = REORG_SAFE_MIN_DEPTH − 1` | 仍 `verifying`（证明门读的是 relay 深度，不是 `vr.confirmations`） |
| F1-弱注入 b | 同正向量，log 命中但 `recipient` ≠ `expectedTo` | 仍 `verifying`（证明两段都在读） |
| F2-正 | transfer 回 txId；`check_utxo_landed` ⇒ `{landed:true, depth:25}` | `completed` 恰一次；reputation `'paid'` 恰一行 |
| F2-反 | `landed:false` | 留 `delivering`，`settle_outcome_phase='submitted'`，无 reputation 行 |
| F2-幂等 | 同 offer 再跑一 tick | 不再 transfer、不再 transition |
| F2-I5（v0.2 改写） | 第一次 `transfer` 的 IPC 在 `submitted` 回执前超时，但假 relay 已回 `prepared{txid}` 且已"广播"（假 mempool 有该 txid）；settler 的 `metadata` **故意不写** | 第二次 tick：查 `payout_intents.prepared_txid` → 假 relay `get_mempool_entry` 有 ⇒ **不重发**（假 relay 广播计数仍 = 1），转核实路 |
| F2-I5-b | 同上，但 IPC 在 `prepared` 之前就断（intent 仍 `pending`、无 txid） | 允许重发一次；假 relay 广播计数 = 1（第一次从未到达） |
| F2-I5-弱注入 | 同 F2-I5，把 `payout_intents.prepared_txid` 清空、只留 `metadata.payout_tx` | 第二次**重发了**（证明判据读的是 intent/relay 侧，不是 metadata）——这是"必须为红"的臂：它证明 metadata 不是判据 |
| F3-正 | `tx_records` 一行 outbound 无 landed，`kaspa_tx_log` 有 | `landed_at/depth` 回写 |
| F3-反 | 三源无、age > 10 min | events `tx_not_landed` 一行（限频）；v1 不改 tx_records 状态 |
| F3-弱注入 | age 9 min | 不告警 |

## 5. 与 G-1 / (a) / 波次的关系

- G-1（节点可信闸）管**递交前**：节点同步、同网、本机；(c) 管**递交后**：落链核实。两者互补，缺一都不是 NO-TX。
- (a) strict local-only 保证 `check_utxo_landed` 与递交是**同一个节点**在答（否则"落链"也可能是别的节点的视图）。
- 波次：F1/F2/F4/F5 = 任何带值波（波 2）前 MUST；F3 v1（detect+alert）同批；F3 冻结 = G-1 readonly 态之后。

## 6. 工程量（估）

F1 ≈20 行 · F2 ≈60 行 + 幂等 + 3 向量 · F3 ≈200 行新文件 + cron 注册 · F4 迁移 + DATABASE.md + 16 处 `ingestTx` 补参 · F5 1 行。测试沿 `rpc-health-datacheck.test.mjs` 形（临时库 + 注入）。**全部钱路 ⇒ Owner 批**；建议一笔（F1+F2+F4+F5）+ 一笔（F3），F3 可后。

## 7. 请 NWT 判

1. **Q1 minDepth**：20（与 `pool.js` 一致）还是按 `REORG_SAFE_MIN_DEPTH`（`pool-shard-register.mjs`）单一源？我倾向引用后者。
2. **Q2 I5 双付**：settler 重试循环"超时即重发"是不是独立的既有缺陷（第一次实际已广播但 IPC 超时 ⇒ 第二次再付一次）——本稿只列，是否单开账请判。
3. **Q3 F3 的 depth 来源**：`kaspa_tx_log` 缺块 DAA，用 RPC `getBlock` 补还是给 kaspa_tx_log 加 `block_daa` 列（relay block-added 时就有）？我倾向加列（一次写，免每次 RPC）。
4. **Q4 冻结机制**：`relay_money_freeze` 标记表 vs 复用 G-1 `readonly` 态——等 G-1 设计定。

## 9. 双付审计（v0.2 · Bettor/Codex 派：TN12 全史有没有同一 bet/market >1 笔 payout · 只读 · 2026-09-13T12:0xZ 自跑）

| 源 | 查法 | 读数 | 判 |
|---|---|---|---|
| 预测派彩路（V2） | `exchange_offers` 165 行：`metadata.payout_tx` 非空 = **0**，`settle_outcome_phase` 全 NULL；`verification_meta.payment_chain='kaspa'` = **0** | 该路径全史未执行（与 NWT 直查 `prediction_reputation_log 'paid'` = 0 一致） | 未发生 |
| `tx_records` outbound 同 `trace_id` 多 txid | 21 个 trace 各 2 个 txid，全部 2026-06/07 | 逐条看：两笔 `amount` 为 0/NULL、`local_address` 互为对方、间隔 6–50 s，都在 `kaspa_tx_log` ⇒ 是 relay `traceId: msg.txId` 把"回复"与"回复的回复"记在同一 trace 下的**消息往返**（`relay.mjs:198/408`），不是派彩 | 非双付 |
| bshard claim 侧 | `pool_bettor_sides` 同 `(market, bettor)` 多个 `claim_txid`（最多 8）；同 `(market, bettor, direction)` 重复行 7454 组 | 一人多注、每注一行、各自 claim；一笔 claim 付 4–5 个 side 是批量派彩 | 非双付 |
| I5 同形风险面 | `grep attempt <=`：`bettor-prediction-settler.js:175`（未执行过）+ `api/bettor.js:1110/1413/1598`（escrow 路三处同形盲重试） | 三处 escrow 路是否执行过未核（另案） | **风险面，未发生**（在本机账本可见范围内）|
边界：`tx_records` 无 `target_address`，"同一收款地址两笔同额"这类链级证据本机表查不到——正是 F4 要补的列；主网前用 F3 对账器补跑一次全史。

## 8. 没核到的

- `verifyCrossChainTx` kaspa 分支返回的 `confirmations` 是怎么算的（`:474-492` 只看到 `kaspa_tx_log` 命中；深度可能恒 1）——F1 的深度门可能要改成直接 `check_utxo_landed`。
- `timeoutVerifying` 对 kaspa 路是否会把"未落链"误判成 dispute（30 min 内正常落链，应无；未读那段）。
- settler 重试循环是否已有 mempool 查重（只看到 `result?.txId` 判空）。
