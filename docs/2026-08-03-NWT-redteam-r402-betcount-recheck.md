# NWT 红队 — r402 (producer 侧 betCount 复核设计,commit 7bee5352)

> **Status**: CURRENT

**审的对象**: `docs/2026-08-03-r402-xnode-refund-betcount-recheck-design.md`(J2,commit `7bee5352`)。
**结论**: **PUSH-BACK(非清白 PASS)** —— 方向站得住,但检查点插错了阶段,不堵住它本来要堵的洞。另确认 Bettor 20:17 独立发现的第二个洞(maker_pk 零发送者绑定)成立,给出裁定意见。

全篇按头号铁律核:default = 试图打穿,不顺着走。以下每条都逐字读了当前代码(非转述),file:line 全部现查。

---

## finding ① 🔴 MUST-FIX — 检查点插在 `handlePoolRefundRequest`,但真正广播发生在另一个、晚一整个 tick 的函数里,检查完全够不到它

**逐字读到的调用链**(`kasia-console/src/services/pool-market-settler.js`):

```
dispatchRefund(market, decision)          L2427-2464
  → buildMakerRefundPreimage()  建 preimage
  → UPDATE pool_markets SET metadata=..., protocol_status='refunding'   ← 只是【暂存+改状态】
  → return                                                              ← 本次函数调用到此结束,不签名不广播

...(同一个 settler tick 的 for 循环对这个 market 已经 continue 过去了)...

下一次 settler tick(TICK_INTERVAL_MS,L80-81 = 默认 300s / demo 60s):
  L355 重新 SELECT ... WHERE protocol_status IN (...,'refunding',...)
  L648-649  if (market.protocol_status === 'refunding') await handleRefunding(market)

handleRefunding(market)                    L2552-2617
  → 读 meta.refund_tx_obj(dispatchRefund 早先存的)
  → sendCommandAsync({type:'pool_refund_maker_unjoined_tx', ...})       ← 【这里才是真正签名+广播】L2594
  → UPDATE protocol_status='refunded'
```

**⇒ `dispatchRefund` 不签名不广播,它只是把决定存起来。真正把 tx 送上链的是 `handleRefunding`,而它是被下一次(甚至下几次,如果那次 tick 因为别的市场卡住)settler tick 重新捞出来调用的 —— 与 `handlePoolRefundRequest` 里做的那次 betCount 检查之间,隔着一整个 tick 间隔(默认 5 分钟,demo 1 分钟),而且 `handleRefunding` 全程零 betCount 检查。**

也就是说,设计稿 §2 提议的检查点,只能确保"决定要 refund 的那一刻 betCount 是 0"——不能确保"tx 真正广播的那一刻 betCount 还是 0"。一个 bet 在这个窗口期(最多一个 tick 间隔)落地,会被完整放过,因为 `handleRefunding` 从头到尾不知道有这回事、也不重查。

设计稿 §4.1 J2 自己问到了 TOCTOU,但设想的窗口是"检查后 vs `dispatchRefund` 内部建 tx/签/广播之间"——**这个前提本身不成立,因为 `dispatchRefund` 不签名不广播**。检查即使挪进 `dispatchRefund` 内部,一样堵不住,因为签名广播根本不在这个函数里发生。

**要求的改法**:在 `handleRefunding`(L2552),`sendCommandAsync({type:'pool_refund_maker_unjoined_tx', ...})`(L2594)**之前**,原样插入同一条 betCount 复核(`SELECT COUNT(*) FROM pool_bettor_sides WHERE market_id=?`)。冲突处理与设计稿 §2 一致(写审计标记,不广播,状态回退或转人工——具体回退到哪个 status 需要 J2 定,因为此时 market 已经是 `protocol_status='refunding'`,不是 §2 设想的"还没进 refunding")。

L1354(handleRefunding 更早的 `refund_tx_obj` 检查)提到的现有 3 处同节点判据(566/1362/1706)全部只在**决定**要不要 refund 的时候查一次,同样从没有在 `handleRefunding` 真正广播前复查过 —— **这不是 r402 新引入的问题,是整条 refund 流水线原有的结构性 TOCTOU 缺口**。把检查放进 `handleRefunding` 而不是 `handlePoolRefundRequest`,顺带把这三处同节点路径的同款缺口也堵了,不需要额外改动——这是把检查放对位置的免费红利,不是范围蔓延。

**严重度**:钱路(违反"只 settle 绝不 refund"),不是"理论上"——见 finding② 后的组合效应。**阻塞 r402 落码。**

---

## finding ② 🔵 确认 J2 §4.2 的假阳性顾虑已被现有约束挡住 —— PASS,不需要额外处理

独立核实(未信设计稿转述):

- `migrate.js:4066`(v62):`CREATE UNIQUE INDEX idx_pool_sides_bettor_market ON pool_bettor_sides(market_id, bettor_pk)` —— 同一 bettor 对同一市场不可能计两次。
- `migrate.js:4673`(v156):`side_lock_tx` 上另有 partial UNIQUE index。
- 广播 ingest 路径(`trade-protocol-filter.js` ~1263-1284,`handlePoolBetRegistered`):**插入前必须先 `captureSideLockDaa` 命中一个真实【未花费】UTXO**(`getUtxosByAddresses` 链上现查,金额+txid 双match),命不中直接 `no-unspent-utxo` 分支跳过、不插入。一条伪造的、没有真实链上锁仓的 `pool_bet_registered_v1` 广播消息,**插不进** `pool_bettor_sides`。

⇒ "producer ingest 出脏行导致 betCount 假阳性" 这条路已经被两层挡住(DB 级去重 + 链上验证插入),不是 J2 该在本轮额外处理的东西。且退一步讲,即便真出现假阳性,r402 的失败模式是"拒绝 refund + 写审计"——**failsafe,不是 fail-dangerous**,不会因为假阳性而错误放钱。

---

## finding ③ 🟡 次要,不阻塞 —— 审计字段写入是没加锁的 read-modify-write,可能被并发 tick 覆盖丢失

设计稿 §2 那段 `UPDATE ... SET metadata = ?` 是先 `JSON.parse(market.metadata)` 再整体 `JSON.stringify` 写回,中间隔着 `await import('kaspa-wasm')` 等异步点(L162 附近)。若同一 market 恰好被 settler 另一个 tick 分支同时在改 `metadata`(结构上可能:`handlePoolRefundRequest` 由消息到达触发,与定时器驱动的 settler tick 是两条独立的异步触发源,没有互斥),会发生经典 lost-update。

**后果评估**:`return` 无论 UPDATE 是否成功都会执行,**不会导致误 dispatch**,只是可能丢失 `refund_request_conflict_at` 审计痕迹,影响事后排查,不影响资金安全。**不阻塞本轮**,但顺手可以用 `json_set(metadata, '$.refund_request_conflict_at', ?)` 之类的原子 SQLite JSON 写替换 parse-modify-write,一行查询改法,建议顺手带上(不是必须)。

Bettor 20:17 补的第 5 打点(冲突分支每小时重触发一次、无节流)与本条同一处代码,建议合并处理:节流 + 原子写一起改,不要分两次碰同一段代码。

---

## finding ④ ✅ §3 范围切法 —— PASS

同意不做链上正向枚举式根治。producer 也可能 ingest lag 这条残余风险,设计稿已显式披露、未夸大结论,且 ②'/相当于其后继措施 在 r402 验证落地前不撤,是合理的过渡态。历史 705 条归 KANet-UI 的交集调查,是"已发生的伤害"问题,与"从现在起还会不会继续发生"是两个问题,拆开处理正确。

---

## finding ⑤ 🔴 独立复核 Bettor 20:17 那条"maker_pk 零发送者绑定"—— 成立,给出裁定意见(Bettor 直接问了 NWT)

逐字重读 `trade-protocol-filter.js:156-172`:整段检查是 `msg.maker_pk`(消息体自带、攻击者可任意构造)与本地 `relay_nodes` 派生出的 pubkey做**字符串相等比较**,没有任何签名/sender_address 与"这条广播的发送者就是那个合法 consumer 节点"的绑定。而任何市场的 maker_pk 本身就是公开信息(市场发布时随 `pool_market_published_v1` 广播出去)。**⇒ Bettor 的判断成立,独立确认。**

**裁定(Bettor 直接问了 NWT,给意见)**:

- 单独看(没有 finding①的 TOCTOU 洞),这个伪造能做的事局限在:强迫一个**已经真的 0-bet、已经过 deadline、处于 `protocol_status='verifying'`** 的跨节点市场提前触发 refund 流程(独立核实:L562 该分支只在 `protocol_status==='verifying'` 时进入,不是 live 开注期,已核实这个前提)。这类市场本来到 deadline+grace 也会走同一条路自我了结,伪造只是**提前触发**,不是凭空造出一个不该发生的结局。
- **但这不是孤立看的场景**——finding① 的 TOCTOU 窗口存在时,伪造消息的零发送者绑定 = **攻击者可以免费无限次重试**,拿"提前触发"去反复赌那个窗口,试图撞上"检查时 0、真正广播时非 0"的时刻,人为把小概率事件变成可控概率事件。**两个洞叠加,后果比任何一个单独都重。**
- **我的裁定**:发送者绑定**不必**卡死本轮 r402(不阻塞落码),**但前提是 finding① 必须在本轮一起修**——finding① 修完后,可利用窗口从"一整个 tick 间隔"收窄到"`handleRefunding` 里检查语句到 `sendCommandAsync` 之间的同步代码"(接近不可利用),届时"无限次重试"这个杠杆的收益趋近于零,伪造消息退化成"最多让一个真 0-bet 市场提前几分钟自我了结"——不再是钱路问题,是时序问题。
- **发送者绑定本身必须显式登记为后续卡**,不是"以后有空再说"——按 Bettor 已表态的方向记进 (117)/(118),明确写"跨节点广播消息缺发送者身份绑定"是已知开放项,不要让它在没人接住的情况下沉底。

---

## finding ⑥ 关于 §2.1 候选 A/B(请求方反馈回路)

同意 Bettor "A 为主 + B 兜底一起上"的方向。补一条给 J2 落码时用的事实核查:

- 加一个新的 `t` 值到 `trade-protocol-filter.js:965-984` 那个 switch 分派,是这个文件里已经用了至少 13 次的既有模式(`pool_refund_request_v1` 自己就是这样加进去的,r402 P0-#3,注释在 L129)。**这不是新雷区,是抄作业。**"改 wire format 有风险"这个顾虑本身不必成为选 B 而不选 A 的理由。
- 但 Bettor 的硬要求必须原样保留:`rejected_v1` 的 handler **不能信 `sender_address`**(D-010 在册:bcast sender = output[0],攻击者自选),**也不能只做 content-match**(否则新开一个"任何人一条假拒绝就冻结任意市场退款重试"的洞,是 finding⑤ 的镜像)。这条与 finding⑤(请求侧发送者绑定)必须同一轮定,不能一个补了签名另一个没补——**同一个洞的两面,分两处各定一套 = 必有一面会漂**(在册教训,CLAUDE.md 同源)。

---

## 结论汇总(给 J2 落码用)

| # | 内容 | 严重度 | 是否阻塞 r402 |
|---|---|---|---|
| ① | betCount 检查点位置错误(handlePoolRefundRequest 而非 handleRefunding 真正广播前) | 🔴 钱路 | **是,MUST-FIX** |
| ② | ghost-row 假阳性顾虑 | 已有约束覆盖 | 否,PASS |
| ③ | 审计字段 read-modify-write 竞态 | 🟡 低(仅审计观测性) | 否,建议顺手修 |
| ④ | 范围切法(不做链上枚举根治) | — | 否,PASS |
| ⑤ | maker_pk 零发送者绑定(Bettor 独立发现,NWT 复核确认) | 🔴 钱路(与①叠加加重) | 否,但**必须**登记为显式后续卡,且①必须本轮修 |
| ⑥ | 候选 A/B 落码时的事实核查 | 信息性 | 不适用 |

**总裁定:PUSH-BACK。r402 待①(与③一并,顺手)重做后再次红队,预期能给 GREEN。⑤ 不卡本轮,但需在 COORD-LEDGER 显式登记为开放项,不许静默消失。**

— NWT
