# I2 · prediction settler 赢家 payout 幂等 · 设计 v0.1

> **Status**: DRAFT（架构师稿 → NWT 红队 → 精炼后 Owner 批 · 钱路 · **目标：READY（~09-09）前落地·随自然重启生效**）· 不作施工依据
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
**任何钱包 transfer 前必须先对账，对账键 = 本地 `payout_tx` ∨ 链上可辨认的（收款地址, 金额, market_id payload, 时间窗）。** 超时 ≠ 失败：超时后禁止盲重试，只允许对账后决定。

## 2. 手段（同一 PR 的四个 hunk，各自负向量）
- **I2-1 payload 幂等键**：payout transfer 带 `payload = "kanet:pred:<market_id>"`（`commands.mjs` 透传 `payload` → relay `sendKaspa({to,amount,payload})`；底层已支持）。链上从此可辨认。不改金额/收款。
- **I2-2 先对账后付**（payout 入口顶部、每次 attempt 前）：① `metadata.payout_tx` 非空 ⇒ 跳过 transfer 直接 completed；② 查 `kaspa_tx_log`（relay ingestTx 落的本机锚）∧ RPC：`to=winner ∧ amount=exact ∧ (payload==key ∨ ts ≥ attempt_ts − skew)` ⇒ 命中则回填 `payout_tx`、不付；③ 未命中才 transfer。
- **I2-3 超时不重试、write-ahead attempt**：transfer 前把 `metadata.payout_attempt = {ts, n, key}` 与 delivering 标记**同一条 UPDATE** 写入，并包 `PRAGMA synchronous=FULL; UPDATE; PRAGMA synchronous=NORMAL`（E5·只此一笔）；`sendCommandAsync` 超时 ⇒ **不进 attempt 2**，本 tick 结束，留 delivering + attempt；下一 tick 由 I2-2 对账决定（迟到 txId 已被 relay ingestTx 落 `kaspa_tx_log` ⇒ 命中 ⇒ 回填 completed）。3 次重试改为"3 个 tick 内对账三次仍未命中且无 attempt 在飞 ⇒ 才允许第二次 transfer"。
- **I2-4 回退闸**：`exchange-machine.js:647-658` timeoutVerifying 对 delivering 行加两条前置：`give_asset` 为 prediction 类 ⇒ 不回退（留给 settler 对账）；任何 delivering 且 `metadata.payout_tx ∨ payout_attempt` 非空 ⇒ 不回退（改为打 `[exchange] delivering has payout evidence, skip revert` 一行）。

## 3. 负向量（缺一不落码）
- V1 超时迟到落链：mock relay 30s 超时后 ingestTx 落 `kaspa_tx_log` ⇒ 下 tick 对账命中 ⇒ **transfer 恰 1 次**、completed 回填正确 txid。
- V2 标记丢失：删 delivering 行/回滚 :146 后重跑 ⇒ I2-2 ② 查链命中 ⇒ 不付。
- V3 60 min 回退：prediction delivering 带 attempt ⇒ timeoutVerifying 不回退；无 attempt 的 exchange 行为不变。
- V4 payload 透传：链上 tx payload == key（真链向量 READY 后补·IBD 期离线 builder 字节断言）。
- V5 非空洞：I2-2 ① 命中时 `sendCommandAsync` 未被调用（突变反转必红）。
- V6 FULL 包裹：三条语句顺序与恢复 NORMAL（突变去掉恢复 ⇒ 红）。

## 4. 审批与部署
钱路 ⇒ **Owner 批**（本稿精炼后与 Phase 1 同一次报）。落码 J2 → NWT diff 审 → 我推 → **随下次自然重启生效（READY 前）**；不主动重启。DATABASE.md 补 `metadata.payout_attempt` 字段说明。

## 5. 不在本稿
I1（exchange auto-deliver 同形·载体待 READY 后入站）沿用同四手段模板另稿；I3 统一对账 helper；I4 23 处 catch 处置。
