# broker 钱出口 race 盘点 —— "同一订单两条钱出口"成对审查（只读 · 静态 + 历史）

> **Status**: v0.1 · J2 2026-08-29 · Bettor 空档派工（NWT 提，retail 开放前待办）· 基线 = 主分支 `9fb9d686`（🔴 退款路在侧分支 `coord/broker-money-path` `cbeb0a93` 已改：intent write-ahead / classify / hold——本稿对退款对子同时写"主分支现状"与"侧分支后"）· 不动任何代码 · NWT 审后进 broker-money-path 批或下批。
> **置信度标签**：`CONFIRMED-static` = 我亲手读到两条路径与守卫缺口，逻辑上可重叠；`PLAUSIBLE` = 需要特定时序/故障才重叠；`GUARDED` = 现有守卫覆盖，写明残余；`DEFECT` = 不是 race 但顺手逮到的钱路缺陷。**没有一条是运行时复现**（本稿只读）。
> **坐标纪律**：全部 `文件:行` 出自本机 `grep/sed` 逐字（扫描代理 `Explore` 出初表，**承重坐标我逐条重核**：Z20 SQL、claim 写点、tick 无重入闸、`_makerAutoPayGive`、`executeHedge(finalOffer)`、`_autoPayExchange` 双触发、v2 withdraw 顺序、seeder 选择条件）。

## §0 两次真损的形（本稿的标尺）
| 案 | 两条出口 | 当时缺什么 | 现守卫 |
|---|---|---|---|
| **87.9 KAS 双退款 `39ac2b69`**（4/28–29）| Z20 `_scanExpiredBrokerOffers` 自动退（timer）× `handleCancelAndRefund` 用户 cancel 退（DM）| 两路互不知道；chain_event 写假占位 txid ⇒ dedup `txid IN kaspa_tx_log` 永久失效 | 单入口 `advanceToRefunded` + Phase-1 CAS `state='refunding'`（`broker-state-authority.js:425-431`）+ chain-truth dedup（`isOfferAlreadyRefunded` @405）|
| **~98 KAS CEX-hedge-vs-refund `afc63057`**（5/10，修 `12fcc48b`）| T2.5c `_scanUntakenOffersFallback` 先 cancel 再 Gate.io SELL（timer）× Z20 退款（**同一个 timer**）| Z20 不知道 hedge 在飞 | Z20 SQL `NOT EXISTS broker_fallback_claim`（`broker-intake-watcher.js:504-508`）；claim 在 `placeCexOrder` **成功后**写（`:840-846`）|

判据（两案共同）：**"钱出口"必须在动作前留下另一条路能看见的痕迹（write-ahead），且两条路要看同一张表。** 下面每对都按这条问。

## §1 出口清单（会发 KAS / 发 USDT / 下 CEX 单的代码点）
### §1.1 KAS 出（全部经 relay `transfer` ⇒ `kasia-relay/src/lib/transaction.mjs:135 sendKaspa = withSendLock(...)` 全局串行锁——**锁的是"同时广播"，不是"同一订单两次"**）
| # | 坐标 | 出口 | 键 | 触发 | 现守卫（逐字）|
|---|---|---|---|---|---|
| K1 | `broker-action-queue.js:372` `executeAction` | broker KAS 唯一花钱原语 `sendCommandAsync(BROKER_RELAY_ID,{type:TRANSFER,…})` | `item.peer`（**无 order_id**）| 内存 FIFO `pump()` | `_busy` 串行；TTL；地址不变量 `assertAddressInvariant`；`TX_PRODUCING_KINDS.has(item.kind) && !result?.txId ⇒ throw` @249 |
| K2 | `broker-state-authority.js:447-451` `advanceToRefunded` | KAS 退款（sendKas）| order_id + offer_id | 所有退款路（K4/K5/DM cancel/reconciler/self-deal）| `if (order.refund_tx_hash) return alreadyRefunded` @382；`isOfferAlreadyRefunded` @405；**CAS** `UPDATE … SET state='refunding' … WHERE id=? AND state IN ('awaiting_payment','paid','expired') AND refund_tx_hash IS NULL` @425-431；`claim.changes===0 ⇒ race_lost` @432 |
| K3 | `broker-state-authority.js:577-581` `_advanceNoOfferRefund` | KAS 退款（无 offer 的草稿单）| order_id | `advanceToRefunded` @391 分支 | `findPriorRefundTxs` @550（kaspa_tx_log 真链）；CAS @557-564 |
| K4 | `broker-intake-watcher.js:575` `_scanExpiredBrokerOffers`（Z20）| → K2 | offer→order | **timer** `_refundInterval` 5 min（`:1095`，`REFUND_TICK_MS` @20）| SQL `NOT EXISTS broker_kas_refunded∧kaspa_tx_log` @488-500；`NOT EXISTS broker_fallback_claim` @504-508；`z20CircuitGate` @530 |
| K5 | `broker-intake-watcher.js:864` `_scanUntakenOffersFallback` | → K2（CEX 永久失败时退）| offer | 同 5 min timer（`:1124`）| `NOT EXISTS broker_fallback_{fill,cancelled,cancel_failed,pending}` @792-796；`PERMANENT_FAIL_PATTERN` @853 |
| K6 | `broker-intake-watcher.js:1054` `_scanUntakenBuyOffersFallback` | **KAS 交割**（Gate.io BUY 成交后直发用户）`_send(TRANSFER)` | offer | 同 5 min timer（`:1129`）| `NOT EXISTS broker_buy_fallback_*` @960-964；claim `broker_buy_fallback_claim` @1005 **在 placeCexOrder 之前**写 ✓；🔴 但 `_send` 裹 `try/catch{console.error}` @1055-1057，失败无标记无重试 |
| K7 | `broker-intake-watcher.js:651` `_scanStaleUnsolicited` | KAS 退回 12 h 无回应的来路 | `broker_workflow_markers.id` | 同 5 min timer（`:1112`）| `NOT EXISTS marker broker_unsolicited_refunded` @637-641；🔴 marker INSERT @653 在 `_send` **之后** |
| K8 | `broker-intake-watcher.js:235` `handleIntake` | KAS 退黑名单 peer | kaspa_tx_log 事件 | **timer** `_intakeInterval` 60 s（`:1085`）| `isBlacklisted`；`markProcessed` @236 **在 send 之后** |
| K9–K12 | `broker-intake-watcher.js:308 / :321 / :327 / :361` `_publishBrokerSellOffer` | KAS 退回（self-deal 无单 fallback / 太小 / 无价 / publish 失败）`await _send(TRANSFER)` | kaspa_tx_log 事件（**不带 order_id**）| 同 60 s intake tick | 各自的 `markProcessed(eventId, …)` **在 `await _send` 之后**（@313/@323/@329/@366）|
| K13 | `exchange-machine.js:975-979` `_verifyAndComplete` | **KAS 交割** maker→taker（`sendCommandAsync(deliveryAgent.id,{type:'transfer'})`）| offer | **链 ingress** `processPaymentSubmit` @754 ← `handleExchangePaid`（`trade-protocol-filter.js:2357`）；自重试 `setTimeout` @1155 | `MAX_DELIVERY_ATTEMPTS=3` @926；`if (deliveryTxId)` 才 completed @1004；3 败回 `verified` @1110 |
| K14 | `api/trading.js:2473` `send_kas`（mm_orders 老 OTC）| KAS | mm_orders.id | HTTP | `status!=='verified' ⇒ 400` @2458；`transition(id,'delivering',{force:true})` @2468 **在 send 之前**（write-ahead ✓，但 `force:true` 绕状态机）|
| K15 | `api/relay.js:522` `/api/relay/:id/transfer`；`zk-prove-worker.mjs:101` | 裸 KAS | 无键 | HTTP / worker | 无（operator 面，非 retail 路，列出不评）|

### §1.2 USDT / 多链出
| # | 坐标 | 出口 | 键 | 触发 | 现守卫 |
|---|---|---|---|---|---|
| U1 | `exchange-machine.js:226` `_makerAutoPayGive` | USDT maker→taker `transferUsdt` | offer + `retail_dex_buy_publications.id` | `transition()` 钩子 @190-193（`newStatus==='completed' && give_asset==='USDT'`）| `SELECT … WHERE seeder_publish_offer_id=? AND state='filled'` @205-207 ⇒ `if(!pub) return`；成功后 `UPDATE … state='completed'` @242（**送后写，非 CAS**）|
| U2 | `trade-protocol-filter.js:2731` `_autoPayExchange`（导出名 `triggerAutoPay`）| USDT taker→maker `want_amount` | offer | ① 链 ingress `handleExchangeAccept` @2056 `setImmediate(_autoPayExchange)`；② **HTTP** `api/exchange.js:538` `mod.triggerAutoPay(latestOffer, localTaker.id)` | 前置只有 chain/wallet/地址/金额存在性（@2695-2727）；**无 `payment_tx` 预检、无 chain_events 幂等探针**；`UPDATE exchange_offers SET payment_tx=?` @2745 **送后写** |
| U3 | `trade-protocol-filter.js:2869-2871` `_autoSettleAsset`（导出名 `_autoSendKas`）| 任意注册资产（KAS/USDT/USDC）`sendAsset` | offer | ① 链 @2077；② HTTP `api/exchange.js:552` | 同 U2 + `setTimeout 5000` UTXO 等待 @2865；无幂等 |
| U4 | `broker-v2/router.js:183` `handleMessage` withdraw 分支 | USDT broker→user `pay_address` | `user_kasia_address` + `user_ledger` | **DM ingress** `api/conversations.js:507` | 余额 `if (balance < wAmount)` @159；`user_ledger` **借记 INSERT @187-190 在链转账之后**；`conversations.js:495-530` **无 per-peer 锁** |
| U5 | `market-seeder.js:119` `refundWorkerTick` | USDT seeder→taker 超时退 | pub.id | seeder tick | 选 `WHERE state='published' AND expires_at < datetime('now')` @85-87；先 `UPDATE … state='refunding'` @96（write-ahead ✓，但无 `AND state='published'` CAS）|
| U6 | `api/trading.js:2563` `pay_usdt`（mm）；`api/relay.js:1093/1103/1126/1136/~1068/~974` 钱包裸发 | USDT/SOL/TRX/ERC20 | mm_orders / 无 | HTTP | mm：`transition(id,'paying',{force:true})` @2559 先写 ✓；relay 裸发无键（operator 面）|
| U7 | `broker-intake-watcher.js:1016` | **BUY fallback 永久失败无自动退款路（占位 import）**：`grep -n transferUsdt kasia-console/src/services/broker-intake-watcher.js` @ `fe6ad45e` ⇒ **唯一命中 `:1016` 的 `const { transferUsdt } = await import('./evm-transfer.js')`**，本文件无调用；分支只 `recordChainEvent broker_buy_fallback_refunded {manual_refund_pending:true}` @1023-1027 + DM 用户 @1028。（v0.1 写"从未调用"是文件范围省略——`exchange-machine.js:226` maker auto-pay 确实调 `transferUsdt`，NWT 纠正，8/29）| offer | 5 min timer（`:1129`，已接线；`:939` 头注释"dormant 未 wired"是陈的）| **DEFECT（NWT 定级 P2 非 P0）**：缺一条出口 = held-pending-manual 可人工回收，不是多一条出口；retail BUY 上线前硬前置 |
| U8 | `broker-swap.js:60` ← `broker-inventory-watcher.js:60` | USDT→USDC swap（broker 自有）| — | `start()` **无人调用（未接线）** | `_ticking` 重入闸 @46 |

### §1.3 CEX 单 / 对冲
| # | 坐标 | 出口 | 键 | 触发 | 现守卫 |
|---|---|---|---|---|---|
| C1 | `trade-protocol-filter.js:2267` `_executeHedge(offerId, agentName, side, qty)` | CEX 现货单 | offer | `api/exchange.js:645`（HTTP confirm）；`exchange-machine.js:871` 与 `:1144`（链 ingress `_verifyAndComplete`）| `hedge_enabled!==true ⇒ skip` @2200；**幂等** `SELECT id FROM chain_events WHERE txid=? AND event_type LIKE 'hedge%'` @2206-2212；熔断 `_isHedgeCircuitOpen` @2214 |
| C2 | `broker-intake-watcher.js:834` `_scanUntakenOffersFallback` | Gate.io **SELL** | offer | 5 min timer | 先 `cancel_v1` @823-831；`sellRes.ok ⇒ recordChainEvent broker_fallback_claim` @840-846（**送后写**）|
| C3 | `broker-intake-watcher.js:1002` `_scanUntakenBuyOffersFallback` | Gate.io **BUY** | offer | 5 min timer | claim `broker_buy_fallback_claim` @1005 **先写** ✓ |
| C4 | `api/broker.js:227`（券商）/ `api/defi.js:451`（Hyperliquid）| 股票 / 永续单 | — | HTTP | 非 retail 钱路，列出不评 |

### §1.4 结构事实（决定"能不能重叠"的两条）
- **同一个 5 min `_refundInterval`（`broker-intake-watcher.js:1095-1130`）里顺序 `await`**：Z20（K4）→ stale（K7）→ utxo-split → reconciler-tick → T2.5c SELL fallback（K5/C2）→ BUY fallback（K6/C3）。**没有重入闸**（`grep _ticking|_busy|inFlight` 全文 0 命中）⇒ 一个 tick 若跑超 5 min（Z20 SQL 修前实测 233 s、CEX HTTP 挂起、relay 超时 90 s×N），**下一个 tick 与上一个 tick 的后半段并发**。这是 §2 里 P2/P4 的时序前提。
- **另两个 timer 独立**：`_intakeInterval` 60 s（K8–K12）；`broker-state-reconciler.js:256` 5 min（→K2）；`bsc-incoming-watcher.js:43` 30 s（→ `paid_v1`）；seeder tick（U5）。DM ingress（K2 via cancel、U4）与 HTTP ingress（U2/U3/C1）随时可插。

## §2 成对矩阵（同一 order_id / offer_id 能否在时间上重叠触发）
| 对 | 路 A | 路 B | 现守卫 | 缺口 | 最小修法 | 标签 |
|---|---|---|---|---|---|---|
| **P1** | K4 Z20 自动退（timer）| K2 via `handleCancelAndRefund`（DM `broker-cancel-refund.js:211`）| 同一入口 `advanceToRefunded` CAS `state='refunding'`；`_findRefundableOffers` chain-truth dedup **fail-closed** @91-94 | **主分支**：sendKas 歧义失败回滚到可重试 `expired`（L-B）+ 队列歧义重试（L-A）⇒ 第二次 sendKas 可能重复；`chain_events` 占位 txid 时代的老洞已由 kaspa_tx_log 真链核堵 | **侧分支 `cbeb0a93` 已修**：`claimRefundLockWithIntent` write-ahead `broker_refund_intents` + `classifyQueueFailure` 歧义不重试 + `AMBIGUOUS_BROADCAST` 留 `refunding` 进 hold | GUARDED（主分支 PLAUSIBLE→侧分支后 GUARDED）|
| **P2** | K5/C2 T2.5c：cancel_v1 → `await placeCexOrder(SELL)` → claim | K4 Z20 退款 | Z20 `NOT EXISTS broker_fallback_claim` @504-508 | 🔴 **claim 是 write-after-action**（@840 在 @834 之后）：`await placeCexOrder` 期间（CEX HTTP 秒级～挂起）claim 不存在；同 tick 内顺序执行不会撞，**但 tick 无重入闸 ⇒ 上一 tick 的 fallback 在等 CEX 时，下一 tick 的 Z20 看不到 claim 就退** = `afc63057` 原形在"tick 超时"条件下**仍可复发**。另：cancel_v1 只是广播，本地 offer 状态要等链回声才变 `cancelled`（P6）| ① claim 改 **write-ahead**：`placeCexOrder` **之前**写 `broker_fallback_intent`（同 refund intents 形：`{offer_id, cancel_tx, at}`），Z20 `NOT EXISTS` 同时看 intent 与 claim；失败则 intent 标 `failed` 且 **不删**；② `_refundInterval` 加 `_refundTicking` 重入闸：忙则跳过并 `events` 记 `refund_tick_overrun`；③ tick 各段各自计时打日志（已有 `_fireAt` 漂移诊断，补每段耗时）| **CONFIRMED-static**（需 tick 超时这个条件——而它已实际发生过：233 s 那次）|
| **P3** | K4 Z20 | `broker-state-reconciler.js:65/108/203` → K2（独立 5 min timer）| 同一入口 CAS | 主分支：reconciler 把 `refunding` 超时单回滚重试 = L-B；侧分支：`RECONCILE_MODE_ACTIVE`=B ⇒ hold 不重发 | 侧分支已修（同 P1）| GUARDED（侧分支后）|
| **P4** | K9–K12（intake tick 60 s，`_send` 直发、**不带 order_id**、`markProcessed` 在 send 之后）| K3 `_advanceNoOfferRefund`（DM cancel 的草稿单退款；键 = order_id）| K3 用 `findPriorRefundTxs`（kaspa_tx_log 真链）| 两路退**同一笔来路**给同一用户，但**键不同**（kaspa_tx_log 事件 vs 草稿 order）；K9–K12 的痕迹 = marker，且写在 send 之后；K3 只看 kaspa_tx_log ⇒ 在飞/未索引（覆盖洞，L2 phase-1 前）时看不见 ⇒ 双退 | ① K9–K12 改 **先写 marker 再 send**（`markProcessed(eventId,'refund_intent:<reason>')` 前置，成功后补 txid）；② K3 增查 `broker_workflow_markers` 里同 `src_event_id` 的 `*_refund*` marker ⇒ 有则 `UNKNOWN` hold；③ 长期：K9–K12 一律走 `enqueueVerified` + intent | **PLAUSIBLE**（需 DM cancel 与 intake 退款同分钟窗 + 覆盖洞）|
| **P5** | K6 BUY fallback KAS 交割 | K4 Z20 退款 | Z20 只查 `broker_fallback_claim`（SELL 形），不查 `broker_buy_fallback_claim` | Z20 选的是**用户付 KAS 的 SELL 侧 offer**（`all(trader.address)` @512 按 trader 地址），BUY fallback 作用于 broker 自发 BUY offer ⇒ **按 side 不相交** | 无需修；建议 Z20 SQL 注释写明 side 分区依据，防将来 BUY 侧也进 Z20 时漏加 claim | GUARDED（by side partition）|
| **P6** | K6 BUY fallback / C2 SELL fallback（先 cancel_v1 再 CEX）| K13 `_verifyAndComplete` 交割 / U2 auto-pay（taker 在 cancel 回声前 accept）| cancel_v1 广播成功才继续（@823-831）| 本地 `protocol_status` 在链回声前仍 `open`：cancel_v1 的 txid 已有（**有 TX** ⇒ 允许本地先推状态）但代码没推 ⇒ 回声延迟 + taker accept 同窗 ⇒ fallback 已 CEX 成交、taker 路也走 | cancel_v1 拿到 `cancel_tx` 后**立即** `exchangeTransition(offer,'cancelled',{txid})`（NO TX NO STATE 满足：有 txid）；accept 路见 `cancelled` 拒 | PLAUSIBLE（窗 = 回声延迟，通常秒级；IBD/console 劣化时分钟级）|
| **P7** | U2 `_autoPayExchange` 由 **HTTP accept** 触发（`api/exchange.js:538`，条件 `protocol_status ∈ {matched,verifying}`）| U2 同函数由 **链回声** 触发（`handleExchangeAccept` @2056 `setImmediate`，条件 `localRelay && !is_dex_broker`）| `_autoPayExchange` **无幂等**：无 `payment_tx` 预检（@2693-2727 只查 chain/wallet/地址/金额），`payment_tx` 送后写 @2745 | 🔴 本地非 broker taker 经 UI accept：HTTP 路等状态变 matched/verifying（`:507` 重试 5 次 200 ms×n）再 `triggerAutoPay`；而状态之所以变 = 链回声已进 `handleExchangeAccept` 并 `setImmediate` 了同一函数 ⇒ **同 offer 两次 USDT 转账**，两者都在 `payment_tx` 写入前启动 | ① `_autoPayExchange` 开头 **CAS write-ahead**：`UPDATE exchange_offers SET payment_intent_at=? WHERE id=? AND payment_tx IS NULL AND payment_intent_at IS NULL`（`changes===0 ⇒ return`）；或 `chain_events` 插 `exchange_autopay_intent`（`UNIQUE(txid,event_type)`，txid=offer_id 形）；② 二选一去掉一个触发（建议去 HTTP 的 `triggerAutoPay`，链回声是唯一真相）| **CONFIRMED-static**（UI accept 路径；broker retail 路走 action-queue 不经 `api/exchange.js`，不受此对影响——但 `is_dex_broker=0` 的本地 agent 受）|
| **P8** | U3 `_autoSettleAsset` HTTP @552 | U3 链回声 @2077 | 同 P7 + 5 s sleep | 同 P7 | 同 P7 | **CONFIRMED-static** |
| **P9** | U1 `_makerAutoPayGive`（pub.state='filled' 时付 USDT）| U5 seeder 超时退 USDT（pub.state='published'）| **按 pub.state 分区**：`filled` 才付、`published` 才退 | 分区成立；残余：U1 送后 `UPDATE state='completed'` 无 CAS（`WHERE id=?` 不带 `AND state='filled'`）、U5 `UPDATE state='refunding'` 无 `AND state='published'` ⇒ 若将来有第三条路改 pub.state，两边都不会发现 | 两处 UPDATE 加状态条件并 `changes===0 ⇒ 不发`（把 write-ahead 做成 CAS）：U1 先 `UPDATE … SET state='paying' WHERE id=? AND state='filled'` 再转账 | GUARDED（by state partition）|
| **P10** | C1 `_executeHedge` 三处调用（HTTP confirm @645；链 @871；链 @1144）| 同 | `chain_events hedge%` 幂等探针 @2206 + `hedge_enabled` opt-in | 幂等成立；但 **`exchange-machine.js:871` 传的是整行对象 `executeHedge(finalOffer)`**，签名是 `(offerId, agentName, side, qty)` ⇒ `offerId.slice` 抛 ⇒ 被 `.catch` 吞 ⇒ 该路 hedge **永远静默不跑**（`:1144` 那处传参正确）| 改 `executeHedge(finalOffer.id, localAgent.name, side, qty)`；加向量 | GUARDED（race）+ **DEFECT**（静默 no-op）|
| **P11** | U4 v2 withdraw DM | U4 同用户第二条 DM（重复/快速）| 余额检查在转账前；**借记在转账后** @187；无 per-peer 串行 | 🔴 两条 DM 在同一 RPC 窗（BSC 秒级）都读到足额余额 ⇒ 两次转账 | ① 借记 **write-ahead**：先 INSERT `user_ledger` 负项（reason `withdraw_pending`）再转账，失败则 INSERT 反向冲正；② `conversations.js` 对 `peer` 加内存串行锁（Map<peer,Promise>）| **CONFIRMED-static** |
| **P12** | K14 mm `send_kas`（HTTP）| 同端点重复请求 | `transition('delivering')` **先于** send（write-ahead）+ `status!=='verified' ⇒ 400` | 无（正例）；只是 `force:true` 绕状态机 | 保留形；去 `force` 需先补状态机边 | GUARDED（正面样板）|
| **P13** | K13 `_verifyAndComplete` 交割（链）| K13 自重试 `setTimeout` @1155 与 `handleExchangePaid` 再次到达 | `if (deliveryTxId)` 才 completed；3 次内重试 | 交割 `sendCommandAsync` 歧义超时（relay 90 s、console 重启孤儿化）时 `deliveryTxId` 空 ⇒ 重试 ⇒ 可能双发（同 L-A 形）| 交割也走 intent write-ahead + `classifyQueueFailure` 歧义不重试（与退款同一套）| PLAUSIBLE |
| **P14** | K7 stale-unsolicited 退（marker 后写）| K8–K12 intake 退同一来路 | K7 只退 `broker_intake_processed` 后 12 h 无回应者；K8–K12 处理时 `markProcessed` 其它 reason | 两者靠 marker `event_type` 分流，但 marker 都是**送后写** ⇒ `_send` 抛/超时时无痕 ⇒ 下一 tick 另一路再退 | 同 P4 ①（先写 marker）| PLAUSIBLE |

## §3 历史迹象（只读）
- **07-23 bak**（`scratch/_j2_money_exit_race_history.mjs`，默认路径）：`retail_dex_orders` 同时带 deliver+refund hash = **0**；offer 带 >1 条 refund/deliver chain_events = **0**；`broker_fallback_claim` ∧ refund 同 offer = **0**；markers 同 `src_event_id` 重复 = **0**；`chain_events broker_kas_refunded` 仅 **4** 条。
- 🔴 **这套查询看不见 §0 两案**：`39ac2b69` 时代退款 chain_event 写的是假占位 txid、`afc63057` 前没有 claim 事件 ⇒ "0 命中"是**查询盲区**，不是"没发生过"。真正强的历史核 = **kaspa_tx_log 出账去重**（broker 地址 → 同收款人同金额 24 h 内 ≥2 笔），脚本已加 `--broker <addr>` 参数，需 Bettor 在 live 只读跑。
- `events` 里已有监控告警刷了 **1,742 次**：`🔴 refund count drift: chain_events broker_kas_refunded=4 > kaspa_tx_log broker outbound=0`——本地退款账 > 真链出账，与 L2 覆盖洞/占位 txid 同族；说明"本地痕迹"本身就不可靠，§2 的修法一律要求痕迹**先于**动作且**只信真链**核销。

## §4 修法优先级（retail 开放前 vs 之后）
| 级 | 对 | 一句话 | 进批 |
|---|---|---|---|
| **P0（开放前）** | P2 | fallback claim 改 write-ahead intent + `_refundInterval` 重入闸 | broker-money-path 下批（同 intent 表形，可复用 `broker_refund_intents` 的 classify 思路）|
| **P0（开放前）** | P11 | v2 withdraw 借记先行 + per-peer 锁 | 同上 |
| **P0（若 UI accept 对外开）** | P7/P8 | `_autoPayExchange`/`_autoSettleAsset` CAS write-ahead + 去掉一个触发 | exchange 批（Owner 批：钱路）|
| P1（开放前完成核）| P4/P14 | intake 内联退款 marker 先写；K3 增 marker 核 | 下批 |
| P1 | P6 | cancel_v1 有 txid 即本地 `cancelled` | 下批 |
| P1 | P13 | 交割 intent + 歧义不重试 | 与退款同框架 |
| P2 | P10 DEFECT | `executeHedge(finalOffer)` 传参修 | 顺手 |
| P2 | U7 DEFECT / K6 bare `_send` | BUY 永久失败无退款路；BUY 交割失败无标记 | 下批 |
| 已修 | P1/P3 | 侧分支 `cbeb0a93` | 等 Owner 批 |

## §5 方法边界
- 静态读码 + 07-23 bak 只读；**无运行时复现**；主分支 `9fb9d686`，退款路以侧分支 `cbeb0a93` 为准写"侧分支后"。
- "重叠"判的是**逻辑可达**（两条路径、无共同 write-ahead 痕迹、存在 await 窗），不是概率；概率取决于 tick 超时/回声延迟/RPC 时长——三者都在本机发生过（233 s SQL、console 劣化、relay 90 s 超时）。
- 未评：operator 面裸发端点（K15/U6 relay、C4）；bshard/ZK 结算路（另有 D-013/§6-3 体系）。
- 扫描代理初表中我**未逐条重核**的行（K1 队列细节、U6、C4、K15）标为"列出不评"，坐标仍来自 grep，但守卫描述以代理转述为准——NWT 审时可抽核。

## §6 v0.2 增补（2026-08-29 晚 · 机械链复核 + patch 指针）
- **P2 → patch `9e61aeb6`**（侧分支 `coord/broker-money-path-2`）：`lib/broker-fallback-intent.mjs` write-ahead intent（回读核实未落库即 throw）+ 三态 + Z20/fallback 单一权威片段 `FALLBACK_INTENT_OR_CLAIM_NOT_EXISTS`；`lib/tick-guard.mjs` 接 `_refundInterval`（忙则跳过 + `refund_tick_overrun`/`refund_tick_stale` 告警）。向量 5/5 + 6/6（X0/X1/X4 红于 `12fcc48b` 形）。
- **P11 机械链（亲核，升 CONFIRMED-static→CONFIRMED-mechanism）**：relay live 是 rpc 模式；`kasia-relay/src/rpc-listener.mjs` `replyToMessage` 三处——catch-up 定时器 `:528 setInterval(catchUpHistory)`→`:633`（`catchUpHistory` 无重入闸）、实时 DM `:1110`、付款 `:1184`；实时路挂 `:768 _rpc.addEventListener('block-added', async …)`——**每块一个 async 回调、无队列** ⇒ 两块内的两条同 peer DM 并发到 `/api/agent/reply`；console 侧无 per-peer 串行。（indexer 模式 `relay.mjs` `poll` 有 `polling` 闸 `:294-296`，但那不是 live 模式。）**→ patch `e68a0983`**：`lib/user-ledger-withdraw.mjs`（同事务 CAS 借记先行 / finalize / 冲正只追加）+ `lib/peer-serial-lock.mjs` 接 `conversations.js` 五入口；向量 5/5 + 4/4 + 4/4。
- **DEFECT2 措辞更正**：见 §1.2 U7（"从未调用"→"本文件占位 import、BUY 永久失败无自动退款路"）；NWT 定级 P2。batch-2 内容（Bettor）：① `broker_buy_fallback_refunded/manual_refund_pending` 进 hold-monitor 第六数——🔴 hold-monitor 只在 batch-1 侧分支，依赖关系待 Bettor 定；② BUY 自动退款 wire 前先定用户 BSC 退款地址来源（`retail_dex_orders.pay_address` vs 入金 tx sender），缺 ⇒ manual + 告警不静默。
- **DEFECT1 `executeHedge :871`**：NWT CONFIRMED，中级另列（先定该路是否本该 hedge；若不该，修法是删路不是接上）。
- **P7/P8**：待 Bettor/Owner 定 UI accept 是否对外可达（网关 arming 同题）再定级；设计段（去哪个触发、CAS 位置）见 §2 P7 行"最小修法"，不动码。
