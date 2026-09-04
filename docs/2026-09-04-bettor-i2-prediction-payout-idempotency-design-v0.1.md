# I2 · prediction settler 赢家 payout 幂等 · 设计 v0.3

> **Status**: v0.3 · **NWT GREEN-conditional（v0.2 a0922234·C1/C2 已落入本版）** · 待 NWT GREEN-final 一眼 → 精炼后 Owner 批 · 钱路 · **目标：READY（~09-09）前落地·随自然重启生效**）· 不作施工依据
> 作者 Bettor · 2026-09-04 · 输入：NWT 幂等审 `docs/2026-09-04-NWT-redteam-txid-writer-idempotency-audit.md`（e0aa8e63+458e5869）· J2 代码事实 `scratch/_j2_i2_prediction_payout_code_facts_2026-09-04T15-00Z.md` · ledger (805)(806)。

## 0. 事实（J2 file:line 亲核）
| # | 事实 |
|---|---|
| E1 | `bettor-prediction-settler.js:146` `transition('delivering')` 与 `:204` `transition('completed',{metadata})` 各自自动提交、无事务；payout txid 只存 `exchange_offers.metadata.payout_tx`（JSON，非列） |
| E2 | transfer 只传 `{type:'transfer', target, amount}`（`commands.mjs:123`）→ relay `sendKaspa({to,amount})` **无 payload ⇒ 链上无 market_id**；底层 `sendKaspaByAmount(params.payload)`（`transaction.mjs:259-268`）已支持 payload；本机唯一 txid 锚 = relay `ingestTx` → `kaspa_tx_log` |
| E3 | 3 次重试、每次 `sendCommandAsync` 30s 超时（`relay-manager.js:291`）；超时 `removeListener` 后 reject（:305-308）⇒ **迟到 txId 静默丢、relay 侧 tx 照落链 ⇒ 同 tick attempt 2 = 双付、零防护**；3 次失败留 delivering |
| E4 | 选择器 `:61-73` 只选 matched/verifying/collecting_sigs ⇒ 重启不重发；**但 `exchange-machine.js:647-658` timeoutVerifying（30s cron）把任何 delivering（含 prediction）60 min 后回退 verified、120 min timed_out（不看 give_asset）⇒ 赢家永不获付需人工**；存储层 `synchronous=NORMAL` 断电可丢 :146 commit ⇒ 回 verifying ⇒ 重选 ⇒ 双付 |
| E5 | `client.js` 无事务 helper；`synchronous` 连接级可即时切；单线程下 `FULL; UPDATE; NORMAL` 三条同步语句间无其它 tick 插入 |

**双付真路径两条**：(a) 同 tick 超时重试（不需掉电·E3）；(b) 掉电丢 NORMAL commit（E4）。**活性 bug 一条**：(c) 60 min 回退把 prediction delivering 打回 verified（E4·且回退后若 payout 已落链 = 卡死；若 payout 未落 = 重选 = 又是 (b) 形）。

## 1. 原则
**任何钱包 transfer 前必须先对账；对账的权威源 = relay 侧幂等键登记（I2-5），链读只作回填。** 三态纪律：**命中 ⇒ 回填不付；证明未发 ⇒ 付；查不到/不确定 ⇒ HOLD 不付**（"未命中"永远不等于"未发"）。超时 ≠ 失败：禁止盲重试。无 payload 的链上匹配只能触发 HOLD，不能自认。

## 2. 手段（同一 PR，各自负向量；I2-5 为承重）
- **I2-5 relay 幂等键（承重·R4·C1/C2）**：`transfer` 命令带 `idempotency_key`（= payload key）。**写前记录三态（C1）**：relay 收到 transfer **先持久化 `key → {state:'inflight', ts, relay_id}`**，`sendKaspa` 返回后改 `{state:'submitted', txId, submitted_at}`（现 `relay.mjs:502-505` 是广播先、`ingestTx` 后——广播与持久化之间崩溃 ⇒ 同 key 回 never ⇒ 二次付，**禁止**）；同 key 再来 ⇒ 直接回原 txId 不再广播；只读命令 `transfer_status(key)` ⇒ `never | inflight | submitted:{txId,submitted_at}`；**inflight ⇒ console HOLD（不是 never）**；relay 重启时对 inflight 键先用自己的 RPC/`kaspa_tx_log` 对账：能定 txId ⇒ submitted；确证未广播 ⇒ 才改 never；否则留 inflight 等人。**专用存储（C2）**：不复用 seen 文件（`state.mjs:17-27` 整文件 `writeFileSync` 覆盖、无 tmp+rename、无 fsync、`slice(-MAX_SEEN)` 淘汰最老项 ⇒ 键被淘汰 = never = 双付；撕裂写 = 全丢）⇒ 追加写或 tmp+rename+fsync 原子写，**不淘汰**（只在 console 回执 completed 后由 console 命令删除）。不依赖链读新鲜度/mempool，IBD 期成立。
- **I2-1 payload 幂等键**：payout transfer 带 `payload = "kanet:pred:<market_id>:payout"`（R6 加 phase 后缀防同市场第二类转账撞键）（`commands.mjs` 透传 `payload` → relay `sendKaspa({to,amount,payload})`；底层已支持）。链上从此可辨认。不改金额/收款。
- **I2-2 先对账后付（三态·R2/R3）**：① `metadata.payout_tx` 非空 ⇒ completed；② 问持钱包的 relay `transfer_status(key)`：`submitted` ⇒ 回填 txId 不付；`inflight` ⇒ **HOLD**；`never` ⇒ **证明未发 ⇒ 付**；relay 不可达/超时 ⇒ **HOLD**；**attempt 记录的 `relay_id` 须与当前 escrowRelay 一致，否则 HOLD**（换 relay 后新 relay 对老键答 never 的假阴性）；③ 链读只作回填与交叉核：`kaspa_tx_log`/RPC 按 payload==key 命中 ⇒ 回填；**无 payload 的 (to, amount, 窗) 匹配 = HOLD 触发器不是自认**（候选 ≥2、或候选 txid 已被任何其它 offer 的 `payout_tx` 占用 ⇒ HOLD；跨 offer 唯一性用 `json_extract` 全表查·改列加 UNIQUE 属 schema 变更另报 Owner）；时间窗下界 = attempt.ts − 本机时钟偏差、**上界开放**（sendKaspa 不可取消可迟到分钟级）；索引新鲜度断言：`kaspa_tx_log` 最新 block_time < attempt.ts + 确认余量 ⇒ 视为"查不到" ⇒ HOLD。
- **I2-3 超时不重试、write-ahead attempt**：transfer 前把 `metadata.payout_attempt = {ts, n, key}` 与 delivering 标记**同一条 UPDATE** 写入，并包 `PRAGMA synchronous=FULL; UPDATE; PRAGMA synchronous=NORMAL`（E5·只此一笔）；`sendCommandAsync` 超时 ⇒ **不进 attempt 2**，本 tick 结束，留 delivering + attempt。**第二次 transfer 的唯一许可 = relay `transfer_status(key) == never`**（R4：mempool 未落 ⇒ relay 仍是 submitted ⇒ 不二次付；"3 tick 后允许"作废）。
- **I2-6 选择器出口（R1·承重）**：settler 选择器 `:61-73` 对 prediction 类**增选 `delivering ∧ metadata.payout_attempt 非空` 的行，只进 I2-2 对账分支**（命中 ⇒ completed；never ⇒ 付；HOLD ⇒ 打一行 `[settler] payout HOLD key=… reason=…` 留 delivering）。没有它，"不回退"= 永久卡死换掉"回退"= 永不获付。
- **I2-4 回退闸**：`exchange-machine.js:647-658` timeoutVerifying 对 delivering 行加两条前置：`give_asset` 为 prediction 类 ⇒ 不回退（出口 = I2-6）；任何 delivering 且 `metadata.payout_tx ∨ payout_attempt` 非空 ⇒ 不回退（打 `[exchange] delivering has payout evidence, skip revert`）。R5：exchange 行无 attempt 照旧回退；I1 落地后 exchange 行带 attempt ⇒ I1 稿必带同一条 I2-6 形出口，**且操作员端点 `api/trading.js:2454-2468`「Send KAS」（verified 强推 delivering 再发·零检查）须过同一对账闸**。

## 3. 负向量（缺一不落码）
- V1 超时迟到落链：mock relay 30s 超时后 ingestTx 落 `kaspa_tx_log` ⇒ 下 tick 对账命中 ⇒ **transfer 恰 1 次**、completed 回填正确 txid。
- V2 标记丢失：删 delivering 行/回滚 :146 后重跑 ⇒ I2-2 ② relay `transfer_status=submitted` ⇒ 不付（链读只回填）。
- V3 60 min 回退：prediction delivering 带 attempt ⇒ timeoutVerifying 不回退；无 attempt 的 exchange 行为不变。
- V4 payload 透传：链上 tx payload == key（真链向量 READY 后补·IBD 期离线 builder 字节断言）。
- V5 非空洞：I2-2 ① 命中时 `sendCommandAsync` 未被调用（突变反转必红）。
- V6 FULL 包裹：三条语句顺序与恢复 NORMAL（突变去掉恢复 ⇒ 红）。
- V7 碰撞 HOLD：两 offer 同赢家同金额同窗 ⇒ 后者 HOLD 不自认、不付。
- V8 查不到≠未命中：`kaspa_tx_log` 陈/RPC 空/relay 不可达 ⇒ HOLD；突变"unknown ⇒ 付"必红。
- V9 mempool 未落：relay 报 submitted 无落链 ⇒ 不二次 transfer。
- V10 选择器出口：增选 delivering+attempt 行进对账；突变去掉 ⇒ 行永不再访问必红。
- V11 payout_tx 跨 offer 唯一：认领已被占用的 txid ⇒ HOLD。
- V12 relay 幂等：同 key 两次 `transfer` ⇒ 一次广播、两次同 txId；relay 重启后 key 仍在（持久化）。
- V13 写前记录：relay 在 `sendKaspa` 返回后、持久化 submitted 前被杀 ⇒ 重启后 `status=inflight` ⇒ console HOLD 不付；突变"inflight ⇒ never"必红。
- V14 专用存储：写入中途杀 relay ⇒ 重启后已记录的键仍在；写入 MAX_SEEN 量级的键后最早的 payout key 仍查得到（不淘汰）。
- V15 relay 身份：attempt.relay_id ≠ 当前 escrowRelay ⇒ HOLD。
- 迁移：I2-6 只增选 `delivering ∧ payout_attempt`；pre-I2 无 attempt 的 delivering 行现为 0（J2 暴露面页 806）⇒ 迁移期不留孤儿（落码前再核一次为 0）。

## 4. 审批与部署
钱路（console settler + **relay 命令面 I2-5**）⇒ **Owner 批**（本稿精炼后与 Phase 1 同一次报）。落码 J2（console）+ relay 侧同为 J2/KANet-UI 报备 → NWT diff 审 → 我推 → **随下次自然重启生效（READY 前）**；不主动重启。DATABASE.md 补 `metadata.payout_attempt` 字段说明。

## 5. 不在本稿
I1（exchange auto-deliver 同形·载体待 READY 后入站）沿用同四手段模板另稿；I3 统一对账 helper；I4 23 处 catch 处置。
