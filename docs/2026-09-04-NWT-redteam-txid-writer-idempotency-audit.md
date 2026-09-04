# NWT 红队 — `*_txid` 写者掉电/重跑幂等审（J2 清单 v0.1 的裁定）

> NWT · 2026-09-04 15:0xZ · 输入 = J2 `scratch/_j2_txid_writers_idempotency_inventory_2026-09-04T14-50Z-v0.1.md`（101 处·A 栏 54 / B 栏 43·四启发式标志）· Bettor 立项（设计稿 v0.3 §5 末"独立债"）· 只审不改 · 钱路 ⇒ 任何修法 Owner 批。
> 读数纪律：全部坐标我亲手 `sed/grep` HEAD 树（含 M10 两 commit 后）；日志 grep 为 `logs/console.log` + `console.log.prev`（08-18~21）。

## 0. 审尺（比四个标志硬的那把）
标志答不了"重跑会不会双付"。答得了的是一个问题：**重跑时这笔 tx 的输入从哪来？**
- **(i) covenant / escrow 指定 outpoint**（`outpointTxid: <lock tx>:0`、spine_lock_tx、side P2SH）：第一次已落链 ⇒ 重跑同一 outpoint ⇒ relay `UTXO not found for lock tx`（`kasia-relay/src/lib/p2sh.mjs:512/657/774/839/966/1223`）或节点拒双花 ⇒ **不会双付，只会卡住**。风险 = 活性（无对账入口时永卡）。
- **(ii) 钱包 `transfer`（fresh UTXO）**：重跑 = **再付一次，链上没有任何东西拦**。风险 = 资金。
- 第二问：写库前有没有 **write-ahead 标记**（先把状态改成"in-flight"再广播）——有 ⇒ 进程崩溃安全；但 `synchronous=NORMAL`（better-sqlite3 编译默认，L5 已证）下**掉电可丢最后几笔已提交事务** ⇒ 标记与结果写可能一起丢 ⇒ 只有 (i) 类才真安全。

## 1. 裁定表（J2 A 栏里 bcastBefore=Y 的 16 处 + 我补的 2 处）
| 站点 | 输入类 | write-ahead | 重跑后果 | 裁 |
|---|---|---|---|---|
| `bettor-prediction-settler.js:431 / :663` settle_consensual → `settle_txid` | (i) `outpointTxid: offer.broadcast_tx_id` | 无（status 仍 collecting_sigs/verifying） | 重跑 ⇒ relay UTXO not found ⇒ submit fail 每 tick 重试、无 giveup（文件内无 submit_fail/backoff） | 不双付·**永卡**（P2 活性）|
| 🔴 **`bettor-prediction-settler.js:174-199` 赢家 payout（J2 表未列）** | **(ii) `type:'transfer'` 从 escrow relay 钱包** | **有**：`:146 transition('delivering')` 先于 transfer；`:70` 选择器 `IN ('matched','verifying','collecting_sigs')` **不含 delivering** ⇒ 崩溃后卡在 delivering 不重付 | **掉电丢 delivering 标记**（NORMAL 下与结果写同批丢）⇒ 回 verifying ⇒ 再 `transfer` = **双付** | **P1（掉电面）**；进程崩溃面已由标记挡住 |
| 🔴 **`exchange-machine.js:1000-1066` auto-deliver KAS/EVM → `delivery_tx` / `retail_dex_orders.deliver_tx_hash`** | **(ii) `transfer` / `sendKas` 从 maker relay 钱包** | 有 `:877 transition('delivering')`，但 **无任何 `delivery_tx` 已存在的检查**（grep `.delivery_tx`/`IS NOT NULL` 0 命中） | **不需要掉电就能双付**：:1049 自述"KAS sent but delivered broadcast failed. Staying in delivering. next tick can retry" ⇒ :650-657 **60 min 后 delivering→verified "revert for retry"**（注释原话"KAS may have been sent"）⇒ `paid` 消息被重处理（trade-protocol-filter 回放 / catch-up）或人手 ⇒ `:877` 再进 delivering ⇒ **再发一次 KAS**。触发条件恰是频道 send 500 那种（IBD 期 5 次 delivered_v1 广播全败） | **P1（设计级·非掉电）** |
| `pool-market-settler.js:2952` refund → `refund_txid` | (i) spine_lock_tx | 无 | UTXO not found ⇒ fail ⇒ 留 refunding | 不双付·卡（P2）|
| `pool-market-settler.js:3503/:3512` pool_settle → `settle_txid` | (i) | 无，但有 `submit_fail_count` 退避 + `SETTLE_SUBMIT_GIVEUP` 冻结（:3482） | 重跑 fail N 次 ⇒ giveup ⇒ 冻结待人 | 不双付·可控（P3）|
| `pool-market-settler.js:1187` metadata | 记账 | — | 幂等（重写同值）| 过 |
| `bshard-auto-settler.mjs:985/:995`、`bshard-settle-daemon.mjs:698` | (i) ZK/close 路径；:698 前有 `checkLanded`（kaspa_tx_log :687） | landed 核是"我这笔落没落"不是"有没有别人已花" | (i) 兜底 | 不双付·过 |
| `exchange-machine.js:853` delivery_tx = payment_tx（BUY 路） | 记对方付款 tx，非我方广播 | — | 归 B 栏 | 过 |
| `order-machine.js:73` INSERT mm_orders | 广播 accept 后建单 | — | 写丢 ⇒ 本地无单，无 cron 重发 | 记账缺口非双付（P3）|
| `trade-protocol-filter.js:987 / :1495` | 收到对方消息的镜像写，:987 有 completed+settle_txid 幂等短路，:1495 有 `!existing.broadcast_txid` 守 | — | 幂等 | 过 |
| `api/bettor.js:1932` refund `WHERE refund_txid IS NULL` | (i) | 守卫在**广播之后**（:1911 sendCommandAsync 先、:1938 守卫 UPDATE 后）⇒ 它防的是并发双写，不防双广播；靠 (i) 兜 | 不双付 | 过·措辞改"race on write, not on broadcast" |
| `bettor-refund-claim-auto.mjs:138/:146` | (i) side P2SH | 有 **对账分支**：relay 报 `No UTXOs at side P2SH` ⇒ 写 `claim_txid='utxo_already_spent'`（:136-141） | 自愈 | **过·全仓唯一的对账样板** |

## 2. B 栏（链上观测）一个承重发现：`INSERT OR IGNORE` 在 chain_events 上是**空齿**
- `chain_events` schema：`id TEXT PRIMARY KEY`（`randomUUID()`），索引 `idx_chain_events_txid/type/from/to/offer` **全部非 UNIQUE**（migrate.js:1111-1125, :4513；grep `UNIQUE.*chain_events` = 0）。
- `services/chain-event.js:14` helper 用 `INSERT OR IGNORE`，docstring 写「重复 txid+event_type 自动跳过」——**假**：OR IGNORE 只对 PK/UNIQUE 冲突生效，PK 是随机 UUID ⇒ 永不冲突 ⇒ 每次重扫都插新行。
- ⇒ J2 §D 问的"23 处裸 INSERT 是否该走 helper"答案是：**走了也一样**。修法在 schema：`CREATE UNIQUE INDEX … ON chain_events(txid, event_type[, from_address, to_address])`（先在 cp 副本上数重复行、定去重键，别在活库直接建）。
- 受影响的读者（重复行即错数）：`/api/discovery/activity` 的 COUNT/GROUP（M10 第 9 站那条）、pool-settler 的 orphan vote re-scan（:1037/:1129，按 chain_events 找票 ⇒ 重复票行）、claim-auto 的 EXISTS（不受影响）。

## 3. 日志旁证（只报）
`console.log` + `console.log.prev`（08-18~21）：`Staying in delivering` 0 次、`delivering timeout 60min → verified` 0 次、`KAS delivery attempt` 0 次 ⇒ **两个日志窗内没发生过**；但 exchange/prediction 路径自 07-20 起结算产出为零（memory `project-settlement-output-zero-since-2026-07-20`），**没发生 ≠ 不会发生**。

## 4. 结论（给 Bettor 精炼 → Owner）
1. **P1-A（设计级·不需掉电）**：exchange auto-deliver 的 delivering→verified 60 min 回退 + 无 `delivery_tx` 已存在检查 + `paid` 重处理 = 钱包双发路径。修法方向（设计稿另出）：进 delivering 前先查 `delivery_tx`/`events.kas_delivery`/链上（relay 钱包对 deliveryTarget 的近期 outgoing）；回退不得清 KAS-已发事实；delivered 广播失败 ⇒ 只重播广播不重发币。
2. **P1-B（掉电面）**：prediction payout 的 write-ahead 标记在 NORMAL 下不保掉电。两条修法任选其一：标记写用 `PRAGMA synchronous=FULL` 包一次（同连接运行时可切，只在这一笔前后切）；或 transfer 前查链（同上）。
3. **P2（活性）**：所有 (i) 类站点缺对账入口——relay 报 `UTXO not found for lock tx` 时应按 claim-auto 样板查花费 tx（kaspa_tx_log / RPC）回填 txid 并推进状态，而不是每 tick 重试或冻结等人。全仓统一一个 helper（"already-spent ⇒ reconcile"），Owner 批后落。
4. **P2（数据）**：chain_events 无 UNIQUE ⇒ helper 的 OR IGNORE 空齿 ⇒ 重扫必重复；先在副本 cp 件上量重复率再定去重键。
5. J2 清单本身：方法与标志诚实、A/B 分栏对；**漏了 :174-199 payout（我补）**；`:853` 应移 B 栏；`bettor.js:1932` 措辞改"写并发守卫非广播守卫"。

## 5. 不做
不改码；不碰活库；不给 Owner 发菜单——以上由 Bettor 精炼后单点上报。
