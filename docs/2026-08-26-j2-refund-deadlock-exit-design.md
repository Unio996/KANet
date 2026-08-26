# 退款闭环死锁出路设计 — 95 笔 / 46 盘 / 514.82 KAS「两头堵死」的现状、出口矩阵与推荐

> **Status**: DRAFT v0.1 · J2 2026-08-26 主笔 · Bettor 派工 (6)(对等消息, ledger 626 设计轮)· **待 NWT 审**
> **性质**: 只读代码 + DB 只读 + 写稿。**零落码、零改 DB、零 TX、不动任何盘。** 本文只提出口, 每条出口都是钱路改动 ⇒ 铁律 0(报备→审核→Owner 批→测试), 本文不构成任何执行授权。
> **证据标签**: `[SRC file:line]` 代码实读 · `[DB]` console.db 只读现查(2026-08-26 14:xxZ)· `[LOG]` 活日志 · `[DESIGN]` 选择 · `[LEDGER]`/`[MEMORY]` 出处带可 grep 短语。

## §0 一句话

**8/22 报的"两头堵死"其实是【三道锁】, 而且第二道比前两道都硬**: ① P1 授权闸只认 `metadata.refund_authorization` 白名单, 而这 46 盘全是 P1 上线(8/04)之前就已 `refunded` 的存量, 字段根本不存在; ② 8/04 设计 §10.3 已拍「存量一并冻结, 走 `owner_authorized` 逐批放行」, 但落码的 `authorizeRefundByOwner` **只接受 `unresolved_needs_authorization` 状态**, 对已是 `refunded` 终态的存量**没有入口** —— 决定了的出口没被实现; ③ **这 121 笔(95 候选 + 26 非候选)只属于 2 把 bettor 钥匙, 两把都不在本机任何 relay 上** ⇒ 即便①②解了, 本机 claim-auto 也只会 `skippedRemote`, 签名必须发生在持钥的节点(J1 侧, 6 月跨节点下注者), 且本机的 `claim_txid=NULL` 对跨节点盘**可能陈旧**(在册: ko421/nb4ko 先例)。
**推荐(§3)**: 把 8/04 已拍的出口③真正做出来 —— `authorizeRefundByOwner` 扩一个「已 refunded 终态 + 未领 side」入口(状态不变, 只写授权三元组), Owner 按批签字; 执行走**持钥节点**的既有 claim 路, 广播前 `check_utxo_landed(side_p2sh, side_lock_tx)` 证 lock 仍未花, 广播后 `check_utxo_landed(output_addr, txid)` 证落链才写 `claim_txid`(现码在 :146 是乐观写, 要一并修)。**不是**回填授权(与 P1 目的冲突, 8/04 已否), **不是**重跑 settler(盘已终态、spine 已花), **不与** Owner「只 settle 不 refund」冲突(这批盘的 settle 路已被 maker 退款花掉 spine 而结构性关闭, 剩下的只有 bettor 侧自取)。

---

## §1 现状闭环(逐 file:line)

### 1.1 候选侧 `[SRC kasia-console/src/services/bettor-refund-claim-auto.mjs]`
- `:42-56` 候选 SQL:`claim_txid IS NULL ∧ side_lock_tx ∧ side_redeem_script_hex ∧ EXISTS chain_events(bettor_refund_available, market_id, bettor_pk)`。**现查 `[DB]` = 95 笔 / 46 盘 / 6 址 / 514.82 KAS**(90 笔 5 KAS + 5 笔 2.68~28.15)。
- `:74-81` **第一道锁**: `assertBettorRefundAuthorized` 放在每个 side 最前(relay 匹配之前, 注释 `:65-69` 说明就是为了让跨节点 side 也被计入 unauthorized)⇒ `unauthorized++; continue`。今日活日志 `[LOG]`:`[claim-auto] tick: 95 unclaimed, dispatched=0 skippedRemote=0 errored=0 unauthorized=95`(每 5 min 一次, 8/22 一天 9,500 条 warn)。
- `:82-97` **第二道锁(被第一道遮住, 现查才露出)**: 签名 relay = `deriveXOnlyPubkey(relay_nodes.address) == bettor_pk`。`[DB]` 121 笔未领 side 只有 **2 个 bettor_pk**(`6b39b42e…` 55 笔 / `a6b68a17…` 66 笔), 对本机 32 个 relay 逐一派生 XOnly **零命中**;`bettor_relay_id` 121/121 NULL;这两把 pk 在全库其它表零出现(只在 `pool_markets.broker_pk` 出现 1 次)。⇒ **它们是 6 月跨节点(J1 :3300 时代)下注者的钥匙**, 与在册 `reference-chain-verify-via-relay-check-utxo-landed`「ko421(26000) claim_txid=null on :3200, 但链上 claim 早 LANDED」是同一批 pk(样本行 `i7h0o`/`nb4ko`/`ko421`)。**⇒ 本机永远走不到 IPC, 且本机 DB 的 `claim_txid=NULL` 不可信。**
- `:124-147` 真花钱点:IPC `pool_side_refund_cancelled_tx`(relay.mjs:881 → `unlockPoolSideRefundCancelled`, PoolSide_v07 entry 2 `refund_market_cancelled`, bettor 单签, 1 in 1 out, `lock_time=(deadline+7200)*1000`), 成功即 `UPDATE claim_txid=txId`(`:146`)—— 🔴 **没有 `check_utxo_landed`**(grep 零命中)= 拿到 txid 就写状态, NO-TX-NO-STATE 违例, 同族在册(7/29 三处)。`:136-140` 'No UTXOs at side P2SH' ⇒ 写哨兵 `claim_txid='utxo_already_spent'`。
- 手动入口 `POST /api/pool/market/:id/bettor-refund-claim`(pool.js:4048 → `buildBettorRefundClaim` :394-548)与 settler 的 `legacyRefundBuilderTick`(pool-market-settler.js:422)**都调同一个 `assertBettorRefundAuthorized`**(pool.js:433;settler :493 用 SQL 同名单)⇒ 三个入口一把锁, 没有旁路(这正是 8/04 设计要的)。

### 1.2 闸 `[SRC kasia-console/src/lib/refund-authorization.mjs]`
- `:32-38` 白名单五值:`bettors_absent / committee_affirmative_unjudgeable / structurally_invalid_market / pool_below_minimum / owner_authorized`。`:27-28`「计时器与重试计数永远不得进本表」。
- `:74-105` `assertBettorRefundAuthorized`:只读 `pool_markets.metadata.refund_authorization`;非字符串或不在白名单 ⇒ 拒;`:66`「**不看** chain_events 的 bettor_refund_available(审计数据非授权)」。**它不看 refund_reason、不看 isCommingledSpine、不看链上。**

### 1.3 授权写入侧(全库只有两处写 `refund_authorization`)`[SRC pool-market-settler.js]`
- **写点 A** `dispatchRefund` `:2700-2760`:入参 `decision.authorization` 必在白名单(`:2718-2725`), 然后建 maker 退款 preimage、把 `{refund_tx_obj, refund_reason, refund_dispatched_at, refund_amount, refund_authorization(, _tier)}` 一起落 metadata 并置 `refunding`(`:2735-2752`)。`authorization` 的来源 = 调用方**推导**:`decideConsensusV06` `:1610-1616` 0-bet ⇒ `bettors_absent`;`:812/:1977/:2245` 同;FINDING-2 commingled 路 `:658` ⇒ `structurally_invalid_market`(接位档 (a) 那条:**它是实参不是 metadata 输入**)。🔴 `:2706-2710` bshard 盘一律拒(7/13 硬化)。
- **写点 B** `authorizeRefundByOwner` `:305-337`:白名单 + `reference ≥ 8 字符` + **`protocol_status === 'unresolved_needs_authorization'` 否则拒(`:316-319`, 白名单式"只有冻结态可放")** ⇒ 写 `{refund_authorization, _reference, _at}` 并把状态落回 `cancelled`。**全库调用者 = 0**(grep 只有注释与自身)⇒ 这条 Owner 出口**从未被任何端点/脚本接上**。
- **写点 A 对这 46 盘已经发生过, 但发生在 P1 之前**:`[DB]` 46 盘 `refund_txid` 46/46 非空(maker 退款已落链)、`refund_dispatched_at` 46/46、`refund_authorization` 46/46 ∅、`updated_at` 06-10 03:42 → 07-20 02:03;`refund_reason` 45 × `commingled_spine (FINDING-2): structural…` + 1 × `committee_unformed`。P1 首 commit `037983e6` = **2026-08-04**。⇒ 当时 dispatchRefund 还没有授权字段, 写不出来是历史事实, 不是缺陷复发。
- **8/04 设计对这批存量怎么拍的** `[docs/2026-08-04-p1-cannot-verify-is-not-refund-authorization-design.md §10.3]`:三选一(① cutoff 豁免 / ② 按 refund_reason 回填 / ③ 一并冻结走 owner_authorized 逐批放行), **v0.4 已拍 = ③**(Bettor 19:11, ledger (139)补13), 理由:② = 把纯超时退款追认为合法授权、与本卡目的正面冲突。当时量的存量 = 125 笔 / 58 盘 / 1,208.5 KAS(今 121 笔 / 54 盘 / 1,168.46, 差额 = 期间被领/沉淀)。
- 🔴 **但 ③ 只对"从此刻起会进冻结态的盘"实现了**(触发点改写 §4.3), 对**已经是 `refunded` 终态的存量**没有任何一行代码把它们"一并冻结"或给 `authorizeRefundByOwner` 开门 ⇒ **决定与实现之间的缝 = 本死锁**。

### 1.4 闭环图
```
存量 refunded 盘(P1 前, 字段∅) ──► claim-auto/端点/legacy tick 三入口 ──► assertBettorRefundAuthorized ──► 拒(unauthorized 95/tick)
        ▲                                                                                         │
        │ 唯一写授权的两处:                                                                          │
        │  A dispatchRefund —— 只在【退款决策那一刻】写, 这批盘那一刻早已过去(P1 前)                       │
        │  B authorizeRefundByOwner —— 只收 unresolved_needs_authorization, 且零调用者 ◄── 没有入口 ◄──┘
        └── 即便写上: 签名 relay 匹配(pk→本机 32 relay)零命中 ⇒ skippedRemote ⇒ 钥匙在 J1 侧节点
```

---

## §2 出口矩阵(每条:改动面 / 谁签 / 钱从哪个 UTXO 出 / NO-TX-NO-STATE / 半路失败)

| # | 出口 | 改动面 | 谁签 | 钱从哪出 | NO TX NO STATE | 半路失败 | 判 |
|---|---|---|---|---|---|---|---|
| **E1 Owner 授权路(实现 §10.3-③)** | `authorizeRefundByOwner` 加第二入口:`protocol_status ∈ {refunded, cancelled}` ∧ 存在 `claim_txid IS NULL ∧ side_lock_tx` 的 side ⇒ 写 `{refund_authorization:'owner_authorized', _reference, _at}`, **状态不动**(它已是终态);加一个 admin 端点(镜像 `admin-dedup.js`/reclaim §3.4 惯例)`POST /api/admin/authorize-legacy-refund {marketIds, reference}` 逐盘回报 | 授权:**Owner**(reference = 谁/何时/依据, `:309-311` 强制 ≥8 字符);签名:**持钥节点的 bettor relay**(J1 侧) | 每笔 side 自己的 `side_lock_tx:0`(PoolSide 单输入, fee 从 stake 扣, 输出到该 relay 地址;`inputs[0]` 必须是 side UTXO —— 在册 `project-stuck-33735…` 陷阱 2) | 广播前 `check_utxo_landed(side_p2sh, side_lock_tx)` 必 true(lock 仍未花, 兼治跨节点 stale);广播后 `check_utxo_landed(output_addr, txid, minDepth)` true 才写 `claim_txid`(修 `:146` 乐观写) | 授权写了、签没签成:字段留着不伤(它就是"可以退"这句话, 幂等);签了没落:不写 claim_txid, 下 tick 重试, 'No UTXOs' ⇒ 哨兵 `utxo_already_spent`(现有) | ✅ **推荐**。与 8/04 已拍口径逐字一致;审计三元组;不动闸 |
| E2 单源谓词实时推导 | 在 `assertBettorRefundAuthorized` 加:字段∅ 但 `isCommingledSpine(spine_p2sh)`(pool-commingle-detect.mjs:39, 白名单注释里就写着"单源 isCommingledSpine")∧ `refund_txid` 非空 ⇒ 视同 `structurally_invalid_market` | 无人签授权(结构事实);签名同 E1 | 同 E1 | 同 E1 | 同 E1 | 🟡 备选。优点零 DB 写、零 Owner 批;缺点:①把"存储的肯定式证据"改成"运行时推导", 闸的合同变了(8/04 §4.1 "证据取自白名单"是**字段**不是**函数**);②45 盘 spine 至今仍共享(`[DB]` spine_shared_now 45/46)所以推导今天成立, 但谓词依赖别的盘存不存在, 会随删盘翻转;③覆盖不了 `committee_unformed` 那 1 盘。**只在 Owner 明确不愿逐批签字时启用, 且须 NWT 审闸合同变更** |
| E3 按 refund_reason 回填字段 | migrate vN:`refund_reason LIKE 'commingled_spine%' ⇒ structurally_invalid_market` 等映射 | 迁移脚本(无人对每盘负责) | 同 E1 | 同 E1 | 回填是幂等写 | ❌ **8/04 §10.3 已否**(② = 追认, 与 P1 目的冲突)。不再提 |
| E4 补 `bettor_refund_available` 事件(给 26 笔非候选) | 往 chain_events 插事件 | — | — | — | — | ❌ 事件是审计数据非授权(`refund-authorization.mjs:18`), 补了也过不了闸;且伪造审计痕迹(在册 7/29 第四实例) |
| E5 settler 重跑 `decideConsensusV06` / 重走退款决策 | 把盘状态倒回 verifying 让 settler 再决一次 | — | — | — | — | ❌ 盘已 `refunded` 终态、maker 退款已落链(spine 花掉), `dispatchRefund` 对 refunded 盘无意义;倒状态 = 手插 DB(在册禁) |
| E6 什么都不做 | — | — | — | — | — | 🟡 可接受的下限:514.82(+653.64)测试网 KAS 小钱, 但**同形闭环会套住以后每一批 P1 前存量**, 且 `unauthorized=95` 每 5 min 一条告警是噪音源 |
| E7 本机 relay 代签 | 把那两把 pk 导入本机 | — | — | — | — | ❌ 钥匙不在本机, 不可能;若是 J1 的 agent 钥匙, 导入 = 托管链漂移(在册 threat-model 追托管链) |

**E1 的落码面(只列, 不落)**:① `pool-market-settler.js:305-337` 加第二入口(状态白名单从 `{unresolved_needs_authorization}` 扩到含 `{refunded, cancelled}` 且带 side 条件);② admin 端点 + Bettor 批字样惯例;③ `bettor-refund-claim-auto.mjs:124-147` 与 `pool.js:518-540` 两处 IPC 前后加 `check_utxo_landed`(同源 helper, 不各写);④ 计数告警 `reportUnauthorizedRefundBacklog` `:349` 加一行「已授权待持钥节点执行」, 否则授权后本机仍报 skippedRemote 会被读成"没修"。**测试**:P1 既有 `test:pbs8`/refund-authorization 用例加三臂 —— 正向(refunded+side ⇒ 授权成功)/反向(completed 盘 ⇒ 拒)/弱注入(reference 7 字符 ⇒ 拒)。

---

## §3 推荐与理由

**推荐 E1**, 顺序:
1. **先链核, 后授权**(UTXO 可用后 `scratch/_j2_postibd_chaincheck_20260826/run.cjs 3`):95 笔逐笔 `landed(side_p2sh, side_lock_tx)`。跨节点盘的本机 `claim_txid=NULL` 不可信(在册先例)—— **已花的那些根本不该进授权批次**。8/22 地址级读数 128 UTXO / 640 KAS vs DB 514.82 只说明"钱大体还在", 按笔不成立(6 址共用)。
2. **Owner 批一批 reference**(如「2026-08-2x Owner 批: 46 盘 FINDING-2 存量 bettor 自取, 依据 8/04 §10.3-③」), 经 admin 端点写授权, 状态不变。
3. **执行在持钥节点**:J1 侧节点的 claim-auto 读的是**它自己的** console.db —— 它那边这些盘/side 是否存在、`claim_txid` 是否已非空、`refund_authorization` 是否需要同样写入, **本文无法从本机核**(跨节点 DB 不同步是 (D-001 铁律 0.5) 的根因之一)。⇒ E1 的第 3 步是**跨机协调项**:先让 J1 在它的 DB 上跑同一条候选 SQL 报数, 再定授权写在哪一边(或两边)。
4. 广播后落链核实写 `claim_txid`;本机 DB 由 J1 报的 txid 回填时**也走 `check_utxo_landed`**, 不抄 txid。

**为什么不是 E2**:闸的价值在于"授权是有人肯定地说了什么"(refund-authorization.mjs:27);E2 把它变成"程序算出来", 8/04 全队为把定时器赶出授权表花了三轮, 不为 514 KAS 把门再打开一条缝。
**为什么不是 E6**:形状会复发 —— §4 说明。

---

## §4 与 (613) reclaim 设计、Owner「只 settle 不 refund」先例的关系

- **Owner 先例** `[MEMORY project-owner-settle-not-refund-orphan-permanent-loss-precedent]`:「遇到卡盘/异常, 默认往'想办法结算'解, 不默认走'退款绕过'」。**本批 46 盘不在该先例的适用域**:它们的 maker 退款**已经落链**(`refund_txid` 46/46), spine UTXO 已花, PoolSpine 三个 entrypoint(`settle_aggregate/dispute_reveal/refund_maker_unjoined`, 在册)没有任何一条能在 spine 花掉之后结算 ⇒ settle 路**结构性关闭**;剩下的 bettor 侧 `refund_market_cancelled` 是**完成一个 6-7 月已经做出的退款决定**, 不是在 settle 与 refund 之间选 refund。且 8/04 Bettor 已拍 ③ 走 owner_authorized(ledger (139)补13)。**本文不设计任何 Owner 否过的路**(E3 回填就是被否的那条, 已划 ❌)。
- **(613) maker bond reclaim** `[LEDGER (613) "Track-B 243k = maker bond(容器①)park"]` + `docs/2026-07-13-bshard-poolspine-maker-bond-reclaim-design.md`:那是**容器①(PoolSpine)maker 侧**、**bshard 盘**、复用 `refund_maker_unjoined`;本文是**容器②之外的 PoolSide(bettor 侧)**、**非 bshard 盘**(`[DB]` 46 盘 bshard=0)、`refund_market_cancelled`。**钥匙不同(maker vs bettor)、合约不同、盘集合零交集** ⇒ 两条设计并行不相扰;共享的只有纪律(三 fail-closed 闸 + `check_utxo_landed minDepth` + 幂等)。

---

## §5 适用范围:同一闭环形态套在哪些盘上、套不上哪些

| 集合 | 是否同形 | 依据 `[DB]` | 出口 |
|---|---|---|---|
| **95 笔 / 46 盘 / 514.82**(候选) | ✅ 三道锁全中 | §1 | E1 |
| **26 笔 / 8 盘 / 653.64**(refunded 未领但非候选) | ✅ 缺的是事件, 不是授权:reason = `v0.6 4-of-5 threshold unmet`(14)/`settle_submit_giveup`(5)/`watchdog-b silent timeout`(7), `refund_txid` 全非空 | 它们从没被发过 `bettor_refund_available`(那三条触发路不发事件)⇒ **E1 的候选条件必须不依赖事件**(用 `refunded ∧ claim_txid IS NULL ∧ side_lock_tx`), 否则修完只解 95 不解 26。E4 补事件 ❌ | E1(候选条件改) |
| **16 个 `refunding` 盘**(1,600 maker + 0 逻辑键注) | ❌ **不同形**:它们是**maker 侧**退款派发了从未落成, 全部 0-bet(`bettors_absent`)。10 盘 bshard ⇒ `dispatchRefund:2706` 现已拒、`handleRefunding` 不进 bshard ⇒ **正是 (613) reclaim 设计 scope 的那 11 盘**;6 盘非 bshard:2 盘 `protocol_version=null` 被 `handleRefunding:2853` 永久 skip(活日志每 tick 一行 `skip non-v0.6/v0.7 market ext-pool-178…`), 4 盘 v0.7 maker 本机(cdb1f91d)、`refund_tx_obj/amount/spine_redeem` 齐全**却在活日志零出现** ⇒ 没进 `handleRefunding`, 前置筛选原因**未核(待查, 不猜)** | 归 (613) + 一条待查 | 非本文 |
| **zombie 189 盘** | ❌ 不同形:metadata 无任何 refund 字段(keys = spine_redeem/v07_*/uma_*), 卡的是委员 attest/quarantine, 8/04 §10.3 的冻结语义也没盖到它 | (613)「先决 quarantine 处置再谈 bond」 | 非本文 |
| **未来任何 P1 前存量被翻出来** | ✅ 同形必复发 | 只要 `refunded ∧ refund_authorization ∅ ∧ 未领 side` 这个集合非空 | E1 的端点就是通用出口 |

---

## §6 本文没做 / 诚实边界
- 没读链(IBD):95 笔"钱还在"只有 8/22 地址级读数;**逐笔**要等 `run.cjs 3`。
- 没核 J1 侧 DB:两把 pk 的归属("J1 的 agent")是**推断**(pk 无本机 relay + 6 月跨节点样本 + 在册 ko421 先例), 不是实证;E1 第 3 步以 J1 报数为准。
- 4 个 v0.7 非 bshard refunding 盘为何不进 `handleRefunding` 未核。
- 不给 Owner 发菜单:出口选择由 Bettor 精炼后单点上报;本文只给推荐与理由。
