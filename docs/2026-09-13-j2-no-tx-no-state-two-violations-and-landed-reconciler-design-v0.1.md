# (c) NO TX NO STATE CHANGE 两处违反修法 + submit/landed 对账器 · 设计骨架 v0.1（不落码）

> **Status**: PATCH-FOR-REVIEW **v0.4**（2026-09-13 · Bettor 终裁（NWT 29959d41）：Q5/Q6 PASS、设计收敛、进 patch 阶段 · 侧分支 `coord/j2-c-no-tx-landed`（基于 8a44568a，独立 worktree + 独立 node_modules，不落 live）· 范围 = settler 两处 V1/V2 + bettor.js 三处 V7 + `submit_intents` 表与 v202 迁移 + relay 两阶段 prepared/submitted 与同字节重播 + F3 对账器 v1 + F4 `tx_records` 四列 + 全部向量（含必红臂）+ Q6 序列化往返离线对照 · **§10 patch 实录**（结构决定、实测陷阱、证据、残余、未核）· NWT diff 审 · 🔴 钱路合入 Owner 批，落地窗波 0/1）· v0.3（2026-09-13T12:37Z · Bettor 派单（NWT 706f1cfb 审后）两条：**① `api/bettor.js:1110` escrow 锁仓重试循环与 settler 那个逐字同结构 ⇒ 并入 F2 同一套机制**（`:1413`/`:1598` 一并核入——三处都是 `for attempt 1..3 { sendCommandAsync(relay, {type:'transfer', target, amount}, undefined, 'legacy-unmigrated'); txId 空 ⇒ sleep 重发 }`，无任何查重，且都在 HTTP 处理器里 ⇒ 多一条**客户端重发**双付面；§1 V7 + §3 F2-E）；**② 边界项：settler 进程重启后 `payout_intents` 的 `prepared`-未-`submitted` 行能否捡回**（§3 F2-R + §4 F2-R 四向量：答案 = 能，但**只有在 prepared 阶段把已签名交易字节也持久化**才安全——relay 进程内 Map 与 settler 内存都不跨重启，"重发"必须是**同字节重播**而不是重建）· §7 Q2 关闭 · §9 I5 行"另案"改并入）· v0.2（2026-09-13T12:18Z · 收 Codex 8968452d ③④ + NWT 审 + Bettor 合并派单：**F1 深度门改 `check_utxo_landed` + 单一源 `REORG_SAFE_MIN_DEPTH`（`pool-shard-register.mjs:88`，不新写 20）**——Codex 实核 `cross-chain-verify.mjs` kaspa 本地索引分支命中即 `confirmations:1/required:1` 硬编码，`vr.confirmations >= 20` 不是真深度门；**F2 幂等改为广播前持久 submit-intent + 幂等键随 relay 走 + 确定性交易身份**，attempt ≥ 2 前只查 relay 侧权威来源（mempool / 最近广播记录 / 意图记录），**不查 settler 自己的 metadata**（NWT 唯一 MUST-FIX = Codex F2 HOLD）；F2-I5 向量改写；Q3 加列 / Q4 复用 G-1 readonly 按我倾向；**双付审计闭合 §9：风险面、未发生**）· v0.1（2026-09-13T11:45Z · J2 · Bettor 派工 SendMessage 11:4xZ「先 (c)，docs 一页，交 NWT 审」）· 出处：Codex 9fff92b0 #5（"A perfect G-1 gate cannot make submit-accepted equivalent to chain-landed… MUST before any value-bearing mainnet wave"）· NWT 清单 v0.1/v0.2 ③ + ④-1 · CLAUDE.md 状态注记 2026-07-29（两处违反坐标）· 🔴 **钱路 ⇒ 实现 Owner 批**；本稿只裁不变量、修法、账本列、向量。
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
| V7（**v0.3 · NWT 706f1cfb 第三站点**） | `api/bettor.js` **三处 escrow 锁仓盲重试**，与 V2 逐字同结构：`[prediction-publish]` maker 锁仓到 escrow 地址（`ESCROW_MAX_ATTEMPTS=3`，`:1110-1128`，失败 503 "offer not created"）；`[prediction-publish-v2]` maker 押金到 SS P2SH（`:1413-1431`，成功写 `escrow_lock_tx: escrowTxId`）；`[prediction-taker-stake]` taker 押金（`:1598-1623`，成功 `UPDATE exchange_offers` 写 metadata）。三处共同点：(i) `txId` 空/IPC 抛错 ⇒ `sleep(attempt×5s)` 直接重发，**不查上一笔是否已进 mempool**；(ii) 都在 **HTTP 处理器**里——客户端超时重 POST = 又一整轮 3 次；(iii) 拿到 `txId` 即写库推进（V2 同病：submit ≠ landed）。与 V2 的差别只有钱的方向（用户押金流入 escrow vs 派彩流出）——**修法同一套** | `git grep -n "attempt <= " kasia-console/src/api/bettor.js` |

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
| F2-E（**v0.3 · V7 并入**） | `api/bettor.js:1110 / :1413 / :1598` | **同一套机制，表通用化**：`payout_intents` 改名 `submit_intents`，加列 `intent_kind TEXT`（`payout` \| `escrow_lock` \| `maker_stake` \| `taker_stake`）；`intent_key` = `'payout:'+offer_id` / `'escrow:'+bet_id` / `'stake:maker:'+bet_id` / `'stake:taker:'+bet_id`（UNIQUE ⇒ HTTP 重 POST 命中同 key）。三处处理器改为：① `INSERT OR IGNORE` intent（`pending`）**先于**任何 IPC；② 若已有行且 `status ∈ {prepared, submitted, landed}` ⇒ **不重发**，直接走 F2(c) 查 relay 侧权威源（intent txid → `get_mempool_entry` / `check_utxo_landed(target, txid, 0)`），有 ⇒ 沿用该 txid 继续原处理器后半段；③ `transfer` 带 `intent_key`，两阶段回执同 F2；④ 重试循环保留但 attempt ≥ 2 的前置 = F2(c)，不再"txId 空即重发"。**推进语义不变**（这三处今天拿 txId 就写库，是 V2 同病，但押金流入方向的"未落链"后果 = offer 可能空挂——由 F3 对账器 `tx_not_landed` 兜，**不在本稿把三处也改成等落链**：那会把 HTTP 请求卡 ≥20 块；改法 = 写库时 `escrow_lock_tx` 旁加 `escrow_landed_at NULL`，F3 回填，未回填的 offer 由既有 timeout 路径处理——列 §7 Q5） | 三处各 ≈15 行 + 表加列 |
| F2-R（**v0.3 · Bettor 边界项：settler 重启捡回 `prepared`-未-`submitted`**） | `submit_intents` + relay `transfer` + settler tick | **能捡回，但 v0.2 的 F2 不够**：v0.2 只持久化 `prepared_txid`；relay 进程内 `Map<intent_key, txid>` 与 settler 内存都**不跨重启**。重启后 settler 看到 `prepared` 行、查 mempool/landed 都无（relay 在 `prepared` 回执后、`submitTransaction` 前死掉，或 relay 也重启过）⇒ v0.2 允许"重发"= 让 relay **重建**一笔交易 ⇒ 重建可能选到不同 UTXO ⇒ **不同 txid** ⇒ 若第一笔其实已进网（relay 死前刚好广播出去、只是回执没到）⇒ 双付。**修**：(a) `prepared` 回执带**已签名交易的序列化字节**（kaspa-wasm `Transaction.serializeToSafeJSON()`，`kaspa.d.ts:6060`），console 存进新列 `prepared_tx_json TEXT`；(b) 重试/重启捡回路径对 `prepared` 行**只允许同字节重播**：`transfer` 命令新增可选 `replay_tx_json`，relay 用 `Transaction.deserializeFromSafeJSON` 还原后 `submitTransaction`——txid 必等于 `prepared_txid`（relay 断言，不等 ⇒ 拒绝并告警 `intent_replay_txid_mismatch`）；(c) **重建（新 UTXO 选择）只允许在一种情形**：`prepared_txid` 的某个输入已被**别的** txid 花掉（relay 查 `getUtxosByAddresses` / mempool 都无该 outpoint 且 `check_utxo_landed(target, prepared_txid, 0)=false`）⇒ 第一笔永远上不了链 ⇒ 旧行 `status='abandoned'`（保留 txid 供审计），新建 attempt 行（`intent_key` 加后缀 `#2`，`intent_key` 前缀查询保证同 offer 最多一条非 abandoned）；(d) `prepared` 行而 `prepared_tx_json` 为空（IPC 在 txid 之后、字节之前断——两者同一条回执，理论上不可能；但表可被人手改）⇒ **不重发、不重建**，告警 `intent_prepared_without_bytes`，人工看。在 F3 对账器里加一段 `submit_intents WHERE status='prepared' AND updated_at < now−2min` 扫描做 (b)/(c)/(d)，settler tick 与 HTTP 处理器不再各自实现 | relay ≈30 行 + 列 + F3 加一段 |
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
| F2-E-正 | `[prediction-publish-v2]` 假 relay 第一次 IPC 超时但已回 `prepared{txid, tx_json}` 且假 mempool 有；客户端**重 POST 同 bet** | 第二次请求命中 intent 行 ⇒ 假 relay 广播计数 = 1；两次响应同一 `escrow_lock_tx` |
| F2-E-反 | 同上，intent 仍 `pending`（第一次 IPC 在 prepared 前断） | 第二次请求允许发一次；广播计数 = 1 |
| F2-E-弱注入 | 同 F2-E-正，删掉 intent 行只留 offer metadata 里的 txid | 第二次**重发了**（广播计数 = 2）——"必须为红"臂：证明判据是 intent 表不是 metadata；也证明 intent 行 `INSERT` 必须在 IPC 之前 |
| F2-R-1 | 重启前：intent `prepared`（有 `prepared_txid` + `prepared_tx_json`）；假 relay mempool **有**该 txid | 重启后首 tick：标 `submitted`，**不重播不重建**，转核实路 |
| F2-R-2 | 同上但假 mempool **无**、未落链、`prepared_txid` 的输入仍未花 | **同字节重播**：假 relay 收到 `replay_tx_json`，广播计数 +1，但 **distinct txid 数 = 1**（重播 txid == prepared_txid） |
| F2-R-3 | 同上且 `prepared_txid` 的某输入已被另一 txid 花掉（假 relay UTXO 集里没有它） | 旧行 `abandoned`，新行 `#2` 重建；distinct txid 数 = 2 但第一笔链上不可能存在（向量断言假链上 `prepared_txid` 永不出现） |
| F2-R-弱注入 | F2-R-2 设置，把 `prepared_tx_json` 置空 | **不重播不重建**，events `intent_prepared_without_bytes` 一行；广播计数 = 0——"必须为红"臂：证明重建路径不是默认路径 |
| F2-R-弱注入 b | F2-R-2 设置，`replay_tx_json` 被改一字节（假 relay 反序列化后 txid ≠ prepared_txid） | relay 拒绝，events `intent_replay_txid_mismatch`，广播计数 = 0 |
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
2. ~~**Q2 I5 双付**：settler 重试循环"超时即重发"是不是独立的既有缺陷……是否单开账请判。~~ **v0.3 关闭**：NWT 706f1cfb 判为同缺陷类别、不单开账，三处 escrow 站点并入 F2-E；§9 证全史未发生。
5. **Q5（v0.3 新）F2-E 三处的推进语义**：押金流入方向今天也是"拿 txId 即写库"（V7 (iii)）。本稿选择**不**把 HTTP 处理器改成等落链（会卡请求 ≥20 块），而是加 `escrow_landed_at` 由 F3 回填 + 既有 timeout 兜"空挂 offer"。请判这算不算 NO-TX 第零条 bis 的可接受形（offer 状态推进了，但对手方资金动作前 UI/taker 路径应看 `escrow_landed_at` 非空——这一步要 T4 下注入口配合，列 T4 输入）。
6. **Q6（v0.3 新）F2-R 的"同字节重播"依赖 kaspa-wasm `serializeToSafeJSON / deserializeFromSafeJSON` 往返后 `Transaction.id` 不变**——类型定义在（`kaspa.d.ts:791-792, 6043, 6060`），往返保 id 未实测；T 实现前用一笔 covenant tx（记忆：`serializeToJSON` 每 input 要 utxo）做一次离线往返对照，不等则退回"只重播不重建 + 人工"。
3. **Q3 F3 的 depth 来源**：`kaspa_tx_log` 缺块 DAA，用 RPC `getBlock` 补还是给 kaspa_tx_log 加 `block_daa` 列（relay block-added 时就有）？我倾向加列（一次写，免每次 RPC）。
4. **Q4 冻结机制**：`relay_money_freeze` 标记表 vs 复用 G-1 `readonly` 态——等 G-1 设计定。

## 9. 双付审计（v0.2 · Bettor/Codex 派：TN12 全史有没有同一 bet/market >1 笔 payout · 只读 · 2026-09-13T12:0xZ 自跑）

| 源 | 查法 | 读数 | 判 |
|---|---|---|---|
| 预测派彩路（V2） | `exchange_offers` 165 行：`metadata.payout_tx` 非空 = **0**，`settle_outcome_phase` 全 NULL；`verification_meta.payment_chain='kaspa'` = **0** | 该路径全史未执行（与 NWT 直查 `prediction_reputation_log 'paid'` = 0 一致） | 未发生 |
| `tx_records` outbound 同 `trace_id` 多 txid | 21 个 trace 各 2 个 txid，全部 2026-06/07 | 逐条看：两笔 `amount` 为 0/NULL、`local_address` 互为对方、间隔 6–50 s，都在 `kaspa_tx_log` ⇒ 是 relay `traceId: msg.txId` 把"回复"与"回复的回复"记在同一 trace 下的**消息往返**（`relay.mjs:198/408`），不是派彩 | 非双付 |
| bshard claim 侧 | `pool_bettor_sides` 同 `(market, bettor)` 多个 `claim_txid`（最多 8）；同 `(market, bettor, direction)` 重复行 7454 组 | 一人多注、每注一行、各自 claim；一笔 claim 付 4–5 个 side 是批量派彩 | 非双付 |
| I5 同形风险面 | `grep attempt <=`：`bettor-prediction-settler.js:175`（未执行过）+ `api/bettor.js:1110/1413/1598`（escrow 路三处同形盲重试） | 三处 escrow 路是否执行过未核（~~另案~~ **v0.3 并入 F2-E**，见 §1 V7） | **风险面，未发生**（在本机账本可见范围内）|
边界：`tx_records` 无 `target_address`，"同一收款地址两笔同额"这类链级证据本机表查不到——正是 F4 要补的列；主网前用 F3 对账器补跑一次全史。

## 8. 没核到的

- `verifyCrossChainTx` kaspa 分支返回的 `confirmations` 是怎么算的（`:474-492` 只看到 `kaspa_tx_log` 命中；深度可能恒 1）——F1 的深度门可能要改成直接 `check_utxo_landed`。
- `timeoutVerifying` 对 kaspa 路是否会把"未落链"误判成 dispute（30 min 内正常落链，应无；未读那段）。
- ~~settler 重试循环是否已有 mempool 查重（只看到 `result?.txId` 判空）。~~ v0.3：settler 与 bettor.js 三处都没有（V2/V7 已核）。
- **v0.3 未核**：`api/bettor.js` 三处处理器有没有外层幂等（如 `bet_id` UNIQUE 在 offer 表上让重 POST 在 INSERT 处失败）——若有，客户端重发面比 V7 (ii) 写的小；但 relay 层的盲重试面不受影响。
- **v0.3 未核**：三处 escrow 的 `sendCommandAsync` 超时值（决定"IPC 超时但 relay 已广播"窗有多宽）——未读 `sendCommandAsync` 默认 timeout。

## 10. patch 实录（v0.4 · 侧分支 `coord/j2-c-no-tx-landed` · 供 NWT diff 审）

### 10.1 结构决定（与 v0.3 的差别，都是被仓库既有闸逼出来的，不是偏好）
- **M0a 裸 import 差分门**（`scripts/m0a-lib.mjs`，relay-manager 族"不开任何通道"）⇒ 新文件一律**不** import relay-manager：`lib/submit-intent.mjs` / `services/prediction-payout-gate.mjs` 把 `sendCommandAsync` 作 `sendCmd` **注入**（顺带让全部向量离线可测，零 `_xxxForTests` 出口）；`exchange-machine.js` 的 F1 落链门复用原 KAS 交割那处的 dynamic import（上提为 `_relayCmd()`，路径+形态+计数三者与 baseline 一致）；bettor.js 三处保留各自的 import 行只换循环体。**F3 对账器因此没有 relay 通道**：链读走 console 共享 RpcClient（rpc-health + kaspa-rpc-shared 单例），只做 detect+alert+landed 回写；prepared 陈行的**解决**（mempool/landed/同字节重播）放在 prediction-settler tick（它持有 relay 通道）的 `resumeStaleIntents`。
- **settler 的 SELECT 从不选 `delivering`**（`protocol_status IN ('matched','verifying','collecting_sigs')`）⇒ 原码"留 delivering 下次 tick retry"从未成立（V2 的第三个缺陷，v0.3 没写到）。patch 加 `sweepDeliveringPayouts`：每 tick 扫 delivering 的预测 offer，submitted 的核落链、pending/prepared 的续发、无 intent 的老行只计数不动（没有幂等键就没有安全重发的依据）。
- relay 侧 prepared 回执走 **HTTP `/ingest/submit-intent` 且 await 2xx**（不走 `post()` 的 backoff 静默跳过——静默跳过 = 发了没记，正是要根治的病）；console 不可达 ⇒ **不广播**（fail-closed，NO TX）；submitted 回执失败只 warn（IPC 回执带 txId，console 侧照样落 submitted）。IPC 协议本身不改（`sendCommandAsync` 仍单回执）。
- `get_mempool_entry` 只读命令：没找到时 RPC 抛错，**不解析报错串**（记忆规则：抽报错串必须用真实串测过，本机无法测）——用独立活性探针 `getBlockDagInfo()` 区分 not-found 与 RPC 真错；真错如实回 error，console 按"未知"处理**不重发**。重播路的 submit 抛错同理：查 mempool 有它才算成功。

### 10.2 实测陷阱（离线，`kasia-relay/src/lib/serialize-roundtrip.test.mjs` 两臂钉住）
- 🔴 kaspa-wasm `Transaction.deserializeFromSafeJSON` **信 JSON 里自带的 `id` 字段，不重算**：改一个输出金额后 `tx.id` 仍是旧 id。若 relay 只比 `tx.id == prepared_txid`，断言是空的——被改过的字节顶着旧 id 过关，kaspad 自算出另一个 txid 上链 = 双付面。修 = 反序列化后逐笔 `finalize()`（实测从字节重算，改后 ≠ 旧 id，未改 == 原 id）。
- 序列化往返本身保 id：Generator → sign → `serializeToSafeJSON` → `deserializeFromSafeJSON` → `finalize()`，签名前后 id 也不变（Q6 关闭）。

### 10.3 证据（本地实跑，全部离线：真 migration 临时库 + 假 sendCmd/假 RPC）
| 文件 | 向量 | 结果 |
|---|---|---|
| `kasia-console/src/lib/submit-intent.test.mjs` | F2-正/幂等/I5/I5(prepared 半截)/I5-b/**I5-弱注入(必红)** · F2-E-正/反 · F2-R-1/2/3/**弱注入(必红)**/弱注入 b/b′ · unknown-state 不重发 · checkIntentLanded 深度门 · resumeStaleIntents · recordIntentPhase 单调 · harness 翻转 | 22/22 + 翻转臂红 |
| `kasia-console/src/services/prediction-payout-gate.test.mjs` | F2-反(depth 3 留 delivering 无 paid) · F2-正(depth 25 → completed + paid 恰 1) · 幂等 ×2 · F2-反 b(31 min 告警限频) · sweep(续发/落链/无 intent) · sweep 幂等 | 9/9 + 翻转臂红 |
| `kasia-console/src/services/exchange-machine-kaspa-gate.test.mjs` | F1-正/反/弱注入(depth 19)/弱注入 b(收款人错) · relay 兜底 · 真错不换 relay · minDepth 0 拒 | 7/7 + 翻转臂红 |
| `kasia-console/src/services/tx-landed-reconciler.test.mjs` | F3-正(索引器)/正 b(UTXO)/反(告警限频)/弱注入(9 min 不扫、mempool 不告警) · 老行无 target · intents landed/not_landed/prepared_stale + 限频 | 7/7 + 翻转臂红 |
| `kasia-relay/src/lib/serialize-roundtrip.test.mjs` | Q6 往返 + 陷阱两臂 · replay: txid 不等/改字节/mempool 已有/已落/inputs_spent/正常/submit 抛错 mempool 有/无/坏 JSON · intent relay: prepared 失败零广播/顺序/进程内幂等/replay 路/坏 JSON | 18/18 + 翻转臂红 |
`node scripts/lint-kanet.mjs <23 changed files>` ⇒ 0 errors（M0a 门过：baseline 计数未动）。顺手改 1 行：`exchange-machine.js` 原有 explorer 域名字面量被 `R-EXPLORER-URL-BYPASS` 硬阻塞（本补丁触及该文件才被闸到），改走 `explorer-url.mjs` 单源，testnet 下原来会渲染 `null` 现在渲染提示。

### 10.4 残余（如实记，不在本 patch 关）
- **双付残余窗**（F2-R (c)）：prepared 行存在（IPC 回执丢失）∧ 旧笔已落 ∧ 收款方在重试窗内又花掉它 ∧ 收款地址不在索引器 watched 集 ⇒ relay 判 `inputs_spent` ⇒ console 重建。console 侧 `resolvePrepared` 在重播前还查一次 `check_utxo_landed(minDepth 0)`，再收窄一层；剩下的窗要么靠把 escrow/winner 地址加进 watched 集（索引器有记录就不会误判），要么接受。
- `timeoutVerifying` 的 **delivering 60 min → verified 回退**对预测 offer 同样生效：派彩已 submitted 但 60 min 没落到 20 深（极端拥堵/重组）⇒ offer 被回退 → 再 60 min → `timed_out` 释放资金；此时 `submit_intents` 行仍是 submitted、对账器 `intent_not_landed` 会叫，但 offer 状态机不认识"钱已发出"。列 T4/波 1 前置：预测 offer 的 delivering 回退要看 intent 表。
- bettor.js 三处处理器仍是"拿 txId 即写库"（推进语义不变，Q5 PASS 口径）；落链由 F3 回填 `submit_intents`，**`exchange_offers` 侧没有 `escrow_landed_at` 列**（v0.3 提过，本 patch 未加——三处写库形各不相同，加列要连 UI/taker 路径一起改，列 T4 输入）。
- F3 冻结 relay（NWT 1001 ④-1）未做（等 G-1 readonly 态）。

### 10.5 未核
- 真 kaspad 上的 `getMempoolEntry` not-found 抛错形 / `submitTransaction` 重复提交抛错形——本 patch 刻意不依赖它们（活性探针 + mempool 复查），但**多笔链式交易的重播**（Generator 产出 >1 笔时 `txJson` 数组顺序提交）只到假 RPC 级，真链未跑。
- `serializeToSafeJSON` 的字节量（单笔 ≈1 KB）× 三处 escrow 高频 ⇒ `submit_intents.prepared_tx_json` 增长：v1 不清理；landed 后可清空 bytes（留 txid），列 F3 v2。
- bettor.js 三处只在 helper 级有向量（同一代码路径），HTTP 级（fastify 处理器 + 真 relay child）未跑；`sendCommandAsync` 默认 30 s 超时 vs relay `prepared`→`submitted` 的 HTTP 往返（两次 ≤5 s）在同一窗内，理论上不会因回执把 IPC 顶超时。
