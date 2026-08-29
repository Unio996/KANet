# broker 退款重发（双退款）守卫 · 定级 + patch 草案 v0.1 · **batch: broker-money-path, NOT maintenance-window · 优先级最高（真钱、有先例）**

> **Status**: DRAFT v0.1 · J2 2026-08-29 · 源：L2 稿 `70208425` T4#1 + NWT 审注 (a)（CONFIRMED 真险、先例 `broker-cancel-refund.js:78` 87.9 KAS）· 只读代码；候选 + 真 schema 向量 16/16 在 `docs/provenance/2026-08-29-broker-refund-dedup-v02/` · 流程：报备 → NWT → Owner（钱路）· 闸 = retail 真用户开放前。

## §0 结论
1. **正常路径没有双退款**：`advanceToRefunded`（`broker-state-authority.js:340-470`）有两道**独立于索引**的闸——offer 终态集含 `refunded/cancelled` 拒重入（:398-400）+ 订单 Phase 1 CAS `state IN (awaiting_payment,paid,expired) AND refund_tx_hash IS NULL ⇒ 'refunding'`（:421-430）。`kaspa_tx_log` dedup（`broker-refund-dedup.js`）只是**第三道**，服务于"DB drift 回填"。
2. **真险路 = 歧义失败 + 索引漏行，两层**：
   - **L-A 队列层**：`enqueueVerified`（`broker-action-queue.js:169-176, :248-250`）对 tx-producing kind **无 txId 即 throw 触发重试（RETRY_MAX）**。relay **超时/回执丢但已广播**（memory `reference-relay-timeout-message-not-dead-can-deliver-late`）⇒ 队列自己重发 sendKas ⇒ **在任何 dedup 之前就双发**。
   - **L-B 重试层**：全部重试仍失败 ⇒ Phase 1 回滚 `state='expired', error_reason='refund_send_failed'`（:455-462）⇒ reconciler（`broker-state-reconciler.js:89-99`）把它当可重试 ⇒ 再进 `advanceToRefunded` ⇒ 此时 offer 未标 refunded、订单 CAS 又能过 ⇒ **唯一闸 = `isOfferAlreadyRefunded`**，而它两路都 fail-open：PRIMARY `chain_events … AND txid IN (SELECT tx_id FROM kaspa_tx_log)`（:78-84）——refund txid 不在 log ⇒ 子查询排除 ⇒ 即便 Phase 3 已记 intent 也判"未退"；FALLBACK 直查 `kaspa_tx_log`（:45-52）——同一个漏。且退款目标 = `user_kasia_address`，**外部用户地址通常不在 watched 集合**（`/api/indexer/watched-addresses` = relay_nodes ∪ exchange_offers maker/taker ∪ identities 30 天）⇒ 对真用户，"漏行"不是偶发，是**默认**。
3. **定级：P1（retail 开放前硬前置）**，与 NWT 一致；先例 87.9 KAS 就是"占位 txid ⇒ dedup 永久失效"这一族。
   🔵 **先例坐标（Bettor 要求钉死，2026-08-29）**：commit **`39ac2b69`**（2026-04-29，"fix(broker-refund): Track A 紧急 chain-truth dedup — 防双重退款 broker 资产流失 (Owner 87.9 KAS 教训)"）= `broker-refund-dedup.js` 引入；头注 `:6` "T-J2-2026-04-29 双重退款铁证 (Owner 04-28→04-29 87.9 KAS 退两次, broker 净亏 87.7)"；回溯修 **`e9b1df33`**（2026-05-07 "加扫 no_offer stuck self-heal (Owner 30 KAS + 4/30 58 + 4/28 88 retroactive)"）。**流 = broker offer / `exchange_offers` 路（服务 retail 用户，但不是 `retail_dex_orders`/`advanceToRefunded` 路——措辞按 NWT 2026-08-29 校正）：04-28 `broker-intake-watcher` 创 offer → `_scanExpiredBrokerOffers` 退第一次 `a340fe2e` → 04-29 Owner cancel → `handleCancelAndRefund` 退第二次 `1324bfb6`（两入口 = auto-expiry + owner-cancel）；库 = 当时 live `console.db`**。**不是** 8/3 J1 实烧 9 笔那族（那是 settle/covenant 路）。机制 = 两条 refund 路径各自乐观写 `chain_events` 占位 txid `refund_<offerid>` ⇒ `IN (SELECT tx_id FROM kaspa_tx_log)` 永假 ⇒ 同 offer 退两次；Track A 改查真链行——即本稿 L-B 那道今天仍 fail-open 的闸。
   🔵 **历史核查回执（Bettor live 只读，2026-08-29）**：`refund_send_failed`/`refunding` 0 行、`refund_tx_hash` 非空 0、`broker_kas_refunded` 按 offer 重复 0 ⇒ **retail 退款路从未在本库执行过 ⇒ 潜伏零影响**（与 escrow 同：retail 开放前修）。§3 查询若涉 `chain_events` 时间列用 **`observed_at`**（表无 `created_at`）。
4. **修法四条**（候选全实现、向量 16/16）：(A) dedup PRIMARY 改 **"intent 已记即拦"**——`chain_events broker_kas_refunded(offer_id/order_id)` 存在即 `REFUNDED_CONFIRMED`，**不 require `kaspa_tx_log`**；(B) **write-ahead intent 账** `broker_refund_intents`（Phase 1 CAS 同事务插，`enqueueVerified` 一 resolve 就 UPDATE txid，早于 Phase 3）⇒ 崩在 Phase 2/3 之间也有据；(C) **队列层歧义失败不重试** tx-producing kind（`classifyQueueFailure`：timeout/empty/no-txId ⇒ ambiguous ⇒ 停 + 标 + 告警；只有明确"未广播"的拒因才重试）；(D) 否定断言 `NOT_REFUNDED` 须 **无任何 intent ∧ RPC 成功且用户地址无匹配 UTXO ∧ L2 coverage 无洞**，否则 `UNKNOWN ⇒ 不发 + 告警`（同 escrow v0.2 原则；`:48` "0 行 ∧ 未覆盖 ⇒ 拒退" NWT 已认）。

## §0-bis 覆盖面（NWT 纠正 2026-08-29：87.9 KAS 发生在 **exchange 路**，不是 retail `advanceToRefunded` 路）
| 调用方 | 坐标 | 今天怎么发钱 | dedup 在哪 | 状态落点 |
|---|---|---|---|---|
| **exchange 路** `handleCancelAndRefund(peerAddr)`（用户 DM 取消） | `broker-cancel-refund.js:123-238` | **不再 inline**：`:156-158` "替原 inline sendKas + markOrderRefunded（双重退款 root cause）→ call advanceToRefunded"，`:211 advanceToRefunded({orderId, reason:'user_cancel'})`；先 `:165` cancel offer 上链（best-effort）+ `:179-182` post-cancel 抢接检测 | `:86 isOfferAlreadyRefunded(o)` 在 `findRefundableOffers` 里只是**预筛**（决定呈现/尝试哪些 offer；helper 抛 ⇒ `:91-93` 拒退 fail-closed）；真闸在 `advanceToRefunded` | `exchange_offers.protocol_status`：cancel 上链后 Scout 写 `cancelled`；`advanceToRefunded` Phase 3 写 `refunded`（`:166`） |
| **exchange 路 · auto-expiry** `_scanExpiredBrokerOffers`（先例第一次退款入口） | `broker-intake-watcher.js:463-630`（5 min 子 tick） | **不再 inline**：`:520-521` "替原 inline sendKas + chain_event placeholder → call advanceToRefunded"，`:575 advanceToRefunded({orderId, reason:'expired_auto_refund'})`；Z20 熔断 `:530` | 预筛 `:490-499` `NOT EXISTS(chain_events broker_kas_refunded … AND EXISTS(SELECT 1 FROM kaspa_tx_log k WHERE k.tx_id = e.txid))`——**fail-open 同族**：退款 txid 不在 log ⇒ 不排除 ⇒ 再进 advanceToRefunded | `exchange_offers.protocol_status IN ('expired','cancelled','timed_out') ∨ ('open' ∧ expires_at<now)`；Phase 3 写 `refunded` |
| exchange 路 · unlinked draft | `:100-148`（T2.12） | `advanceToRefunded({orderId: draft.id, reason:'user_cancel_unlinked_draft'})` ⇒ `_advanceToRefundedNoOffer`（`broker-state-authority.js:540-`） | `:550 findPriorRefundTxs`（**同 fail-open**：只查 `kaspa_tx_log`） | `retail_dex_orders` CAS（`:556-`） |
| exchange 路 · BUY（give_asset=USDT/USDC） | `:186-190` | **不进** `advanceToRefunded`（broker 不持 stable） | — | — |
| **retail 路** `reconcileStaleOrders` / `_scanExpiredBrokerOffers` / reconciler 重试 | §0 已述 | `advanceToRefunded` | `:405 isOfferAlreadyRefunded`（Pre-check）| 同上 |
⇒ **两路在 `advanceToRefunded` 汇合**；先例 `39ac2b69`（04-29）那次是**被 Track B 替换掉的旧 inline 路**（`:156` 注）——今天 exchange 路的真险 = §0 的 L-A/L-B 同一条（队列歧义重试 + 回滚可重试 + 唯一闸 fail-open），外加 **`:86` 预筛 fail-open 会把"已退但 log 无行"的 offer 重新呈现给用户/重新尝试**（进 `advanceToRefunded` 后被 offer 终态闸挡，除非 drift）。**wiring 四处都接 `classifyRefundState`（GO-with-CONDITION 面）**：exchange 两入口先——① `broker-cancel-refund.js:86` 预筛（`alreadyRefunded = state ∈ {CONFIRMED, INTENT, INFLIGHT}`，`UNKNOWN ⇒ 不呈现 + 告警`）、② `broker-intake-watcher.js:490-499` 预筛（把 `AND EXISTS(kaspa_tx_log)` 拿掉 ⇒ 有 `broker_kas_refunded` 即排除；intent 有 txid 也排除）；然后 ③ `advanceToRefunded :405`、④ `_advanceToRefundedNoOffer :550`。**intent write-ahead 落点** = `advanceToRefunded` Phase 1 CAS 同事务（两入口都经它 ⇒ 一处落点覆盖两入口）；**队列层** = 两入口都经同一 `enqueueVerified`（`broker-action-queue.js`）⇒ ambiguous 不重试同样覆盖。**先例复现向量 X5**（auto-expiry 已退 + log 无行 → owner-cancel 再判）：旧 `:78-84` SQL 逐字作 oracle 判"未退"（**红 = 双退**），新 `classifyRefundState` ⇒ `REFUNDED_CONFIRMED` 拦。**coverage-lag 监控**（NWT (c) false-hole-sea：`/ingest/coverage-advance` 持续丢帖 ⇒ 账永追不上 tip ⇒ 全 UNKNOWN ⇒ broker stall）= `broker-hold-monitor` 第四个数：`max(end_daa) per indexer` 落 tip（`spc_tip_heartbeat.daa_score`）> X（如 3,600 DAA ≈ 6 min）⇒ 告警。**队列层同一 `enqueueVerified`**（`broker-action-queue.js`，两路共用）⇒ ambiguous 不重试同样适用。**顺序：exchange 先**（流过血那条；且它是用户 DM 实时触发，比 15 min cron 更常被按）。向量 X1–X4 = 预筛形（offer-only）/ no_offer 形（order-only）/ 双空形。
🔵 **exchange 路历史读数（Bettor live 只读，2026-08-29）**：`chain_events broker_kas_refunded` 共 **4 条**，全在 2026-07-14 03:47 – 07-17 08:15（与 7/17 `bso_` 测试批同期），按 offer 无重复 ⇒ exchange 路近期无真退款，**风险活（`:86` 今天仍在调、gap 在）但未复发**。`exchange_offers` 的状态列是 **`protocol_status`**（无 `state` 列；本稿全部按此）。

## §1 状态机（候选 `refund-dedup.v02.mjs`）
| state | 判据 | `decideRefundAction` |
|---|---|---|
| `REFUNDED_CONFIRMED` | S1 `chain_events broker_kas_refunded` 命中（不 join log）∨ S3 `kaspa_tx_log` 用户地址 amount±0.01 命中 ∨ S4 RPC 见匹配 UTXO | `backfill_refunded`（不发） |
| `REFUNDED_INTENT` | S2 intent 有 txid 但未见落链 | `verify_landing_then_backfill`（relay `check_utxo_landed(txid)`；超窗未落 ⇒ `held_for_review`）——**不重发** |
| `INFLIGHT` | S2 intent 无 txid 且 ≤30 min | `wait` |
| `NOT_REFUNDED` | 无 S1/S2/S3 ∧ RPC 成功无匹配 ∧ coverage 无洞 | `send` |
| `UNKNOWN` | 其余（RPC 缺/抛/劣化、无 coverage 账、有洞、intent 超 30 min 无 txid、查询异常、参数坏） | `hold_and_alert(broker_refund_unknown)` |
向量：V1–V6 否定断言前置逐条；**V7 intent 有 txid 而 log 无行 ⇒ 不重发（v0.1 会重退）**；V8/V9 inflight/stale；**V10 chain_events 命中而 log 无该 txid ⇒ CONFIRMED（v0.1 的 `IN` 子查询会排除 ⇒ 重退）**；V11 offer_id 精确；V12 log 肯定证据；V13 参数；**Q1–Q3 队列歧义分类**。

## §2 diff 草案（不 apply）
1. `broker-refund-dedup.js` `isOfferAlreadyRefunded` → 包装 `classifyRefundState`：`alreadyRefunded = state ∈ {REFUNDED_CONFIRMED, REFUNDED_INTENT, INFLIGHT}`；新增 `mustHold = state === UNKNOWN`。删 `:82 AND txid IN (SELECT tx_id FROM kaspa_tx_log)`。
2. `broker-state-authority.js advanceToRefunded`：Phase 1 CAS 同事务 `INSERT INTO broker_refund_intents(id, order_id, offer_id, user_addr, amount_kas, txid NULL)`；Phase 2 `enqueueVerified` resolve 后**先** `UPDATE broker_refund_intents SET txid=? WHERE id=?` 再进 Phase 3；`dedup.mustHold ⇒ return {ok:false, skipReason:'refund_unknown_hold'}` + `events(broker_refund_unknown)` 去重；`REFUNDED_INTENT ⇒ _verifyLandingThenBackfill`（relay `check_utxo_landed`；未落地超窗 ⇒ `held_for_review`，与 escrow 选项 B 同态）。
3. `broker-action-queue.js` pump：tx-producing kind 失败前先 `classifyQueueFailure(err)`；`ambiguous ⇒` 标记 item `ambiguous`、**不重试**、抛专用错 `AMBIGUOUS_BROADCAST`；`advanceToRefunded` 捕到它 ⇒ **不回滚到 expired**，订单留 `refunding`（intent 无 txid）⇒ reconciler 的 stuck-refunding 路（`:49-86`：查链真相回填或告警）接手，**不进 `refund_send_failed` 可重试路**。
4. migrate v199+：`broker_refund_intents(id PK, order_id, offer_id, user_addr NOT NULL, amount_kas NOT NULL, txid, created_at, updated_at)` + INDEX(order_id), INDEX(offer_id)；DATABASE.md 同步。
5. reconciler `:89-99` `refund_send_failed` 重试路：加前置 `classifyRefundState ∉ {NOT_REFUNDED} ⇒ 不重试`。

## §3 历史核查清单（Bettor 只读跑）
1. `SELECT id, state, error_reason, refund_tx_hash, updated_at FROM retail_dex_orders WHERE error_reason LIKE 'refund_send_failed%'` —— 歧义失败发生过几次；逐条：该单后来有没有 `refund_tx_hash`（= 重试成功）；
2. 对每条 1 的 `user_kasia_address`：`kaspa_tx_log WHERE to_address=? AND amount BETWEEN qty±0.01` 行数 **≥2** = 双退款候选；`=0` = 地址未被索引（印证 G1）；
3. `chain_events WHERE event_type='broker_kas_refunded'` 按 `payload.offer_id` 分组 `count(*) > 1` = 同 offer 多次退款记录；
4. `broker_action_queue`（若持久化）`kind='sendKas'` 且 `attempts > 1` 的项：重试过的 sendKas 有几次、对应 txid 是否多于一个。
5. 先例 87.9 KAS（04-28/29）不在本核查范围（已知、已记）。

## §4 边界
- 候选的 intents 表在测试里自建（期望迁移形），真 migrate 由报备后落；S1/S3 用真 schema（v83 trigger 下 `broker_*` 事件 txid 须 64-hex，向量用 64-hex）。
- `verify_landing` 依赖 relay IPC（`check_utxo_landed`）在线；离线 ⇒ UNKNOWN（方向安全）。
- 未核 `_scanExpiredBrokerOffers`（`broker-intake-watcher.js:463`）的排除子查询 `EXISTS(kaspa_tx_log …)`（:28-37）——它同族 fail-open（漏行 ⇒ 不排除 ⇒ 进 `advanceToRefunded`，再由 offer 终态闸挡；drift 时同 L-B），修法 = 同样改成 intent 存在即排除。
- 未跑历史核查（Bettor 只读）。
