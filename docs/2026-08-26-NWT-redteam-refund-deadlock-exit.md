# NWT 红队 — 退款死锁出路设计(E1)

> 作者 NWT · 2026-08-26 · 派工 Bettor · 被审 = `docs/2026-08-26-j2-refund-deadlock-exit-design.md`(4bee7cd4)
> 钱路设计。代码事实在 HEAD 逐处核。**总评:E1 方向对(实现 8/04 已拍 §10.3-③),三道锁分析扎实,但 ① 我打出一个 E1 漏掉的承重事实 —— 写授权【不是被动记录,是给自动 tick 上膛】。②③④ 各有一条须补。E1 = PASS-WITH-MUST-FIX。**

Bettor 三条前提我复核成立 `[SRC HEAD]`:`settler.js:316` 只收 `unresolved_needs_authorization`(✓ `authorizeRefundByOwner` 白名单式状态门)、`authorizeRefundByOwner` 全库零调用者(✓ grep 只有自身+注释)、`bettor-refund-claim-auto.mjs` 三入口一把锁且 `:124-147` 无 `check_utxo_landed`(✓ grep 零命中)。

---

## ① E1"只写授权三元组、状态不动"— 🔴 **不成立:refund_authorization 是自动 tick 的选择键,写它=上膛**(承重·MUST-FIX)

Bettor 问"谁读 refund_authorization、会不会被 P1 闸以外的路径消费成别的动作"。**会。全库读 `refund_authorization` 的有两处,E1 只算了第一处:**
- **读者甲 = P1 闸** `refund-authorization.mjs:91`:allow/deny 一次 claim。E1 算到了。
- 🔴 **读者乙 = settler 的 `legacyRefundBuilderTick`** `pool-market-settler.js:493`:它的候选 SQL(`:485-495`)= `protocol_status IN ('cancelled','refunded') ∧ protocol_version IN (v0.6,v0.7) ∧ deadline<=now ∧ pbs.side_lock_tx NOT NULL ∧ pbs.claim_txid IS NULL ∧ refund_attempted_at∅/>1h ∧ json_valid ∧ **refund_authorization IN 白名单**`。**这 46 盘现在满足【除最后一条外的每一条】** —— 唯一把它们挡在 tick 外的,就是 `refund_authorization ∅`。

⇒ **写 `owner_authorized` 的那一刻,46 盘立即变成 `legacyRefundBuilderTick` 的合格候选**,而这个 tick `:511-514` 直接 `buildBettorRefundClaim(market_id,{sideId})` → `if(result.refund_txid) triggered++` = **自动签名+广播**,且**全 tick 无 `check_utxo_landed`**(`:422-600` grep 零命中)。

**⇒ E1 的三处措辞被这个事实推翻/收窄:**
1. **"状态不动、只写授权三元组"** —— 字面对(状态确实没改),但**授权字段本身是自动花钱 tick 的选择键**,写它 = 给 tick 上膛。不是被动记录。
2. **"执行走持钥节点、Owner 按批签字"** —— **在持钥节点(J1)写 `owner_authorized`,J1 的 settler tick 会自动把 46 盘逐个 `buildBettorRefundClaim` 签广播**(batch 由 `LEGACY_REFUND_BATCH` 限、默认 1/可 bump 5),**不经任何"Owner 逐盘点头"**。"Owner 按批"的粒度控制是幻觉 —— 一旦字段写上,tick 自己排空。在 :3200(无钥)写则相反:tick 选中却签不了,churn "bettor-key-cannot-sign" 失败(`:520` 显式不静默)。
3. **"广播后 landed 才写 claim_txid(要修 :146 乐观写)"** —— 对,但 E1 把它列成落码面第③项之一,**没把它钉成【任何持钥节点写授权之前的硬前置】**。而按 ① 的事实:**授权一写,自动 tick 就在无 landed-verify 下签广播** ⇒ **`buildBettorRefundClaim` / legacy tick 的 `check_utxo_landed` 前后置必须【先】落码并验证,【再】写任何一盘的 `owner_authorized`**。次序反了 = 自动 tick 在跨节点 stale `claim_txid=NULL`(ko421 先例)上重签已领的盘,靠什么挡?只剩链的同输入双花(见②)——但那是最后一道,不该让它当第一道。

**MUST-FIX(E1 须补)**:
- 明写"`refund_authorization` 是 legacyRefundBuilderTick 的选择键;写它 = arming 自动签广播,不是被动授权记录"。
- **硬次序**:`buildBettorRefundClaim`(pool.js:394-548)+ legacy tick 的 `check_utxo_landed`(广播前 side_p2sh 未花 / 广播后 output 落链才写 claim_txid)**先落码验证,再写任何授权**。
- **Owner 按批**若真要逐盘控制,不能靠"手动写授权",要靠一个独立门(如授权写入后 tick 仍需第二个 per-market flag,或把这批的 `LEGACY_REFUND_BATCH` 显式控在 Owner 每批放行的粒度)。否则"按批"名不副实。

---

## ② 广播前 landed(side_p2sh) 挡跨节点 stale — 🟡 **挡得住,但真正的锁是同输入双花,pre-check 是纵深**

- J1 的 claim 路 `check_utxo_landed(side_p2sh, side_lock_tx)` 跑在**签名节点自己的 kaspad**(J1 侧)。若 J1 kaspad 已同步 ⇒ side UTXO 已被别处领走则 `getUtxosByAddresses` 找不到 → landed:false → 挡。✅
- 🔴 **但若 J1 kaspad 自己 stale**(落后没见到那笔花费)⇒ pre-check 假 true → 放行 → 第二次广播。**这时兜底 = 网络层同输入双花**:PoolSide claim 是**单输入**(`inputs[0]` = `side_lock_tx:0`,设计明写"1 in 1 out",在册 `project-stuck-33735` 陷阱2),第二次 claim 花的是**同一个** `side_lock_tx:0` ⇒ 网络拒双花 ⇒ 落不了。
- ⇒ **与 1M 转账那条不同**:1M 转账双花不自保(change 造出新可花 UTXO);**这里自保**(同输入,无 change 造新币可再花)。所以跨节点 stale 场景 **pre-check(纵深)+ 同输入双花(硬锁)双层**,挡得住。
- 🔵 **note**:pre-check 的价值不在"防双花"(那是双花本身的事),而在**省一次注定失败的广播 + 早发现盘已被领**(把 claim_txid 陈旧那批在授权前就筛掉,别进批次)。E1 用它对,但定位应写清:硬锁是同输入,pre-check 是效率+早筛。**前提**:必须确认 claim 真的是单输入 side_lock_tx:0(E1/buildBettorRefundClaim 落码时 NWT 关2 复核输入构造,别让它变成多输入)。

---

## ③ 26 笔"缺事件非缺授权"候选改写会不会捞进不该退的 — 🟡 **不会超出 legacy tick 现有集合,但会含 stale-已领,安全全靠 ② 的锁**

- `side_lock_tx` 在 `pool_bettor_sides` 表(**bettor 侧专属**,非 maker;`pool.js:456` schema 核实)⇒ 广义候选 `refunded ∧ claim_txid NULL ∧ side_lock_tx` 不会误捞 maker 侧。✅
- 🔴 **但这个广义条件 = legacyRefundBuilderTick `:485-495` 现在【已经在用】的那组条件**(减去 refund_authorization 一段)。⇒ "26 笔改候选"不是引入新风险,是**把 claim-auto 的候选对齐到 legacy tick 早就在扫的集合**。而这个集合**天然包含跨节点 stale `claim_txid=NULL` 的已领盘**(ko421 先例:本机 NULL,链上早领)。⇒ **它确实会把"其实已经退过"的 side 捞进候选** —— 安全**完全**依赖每笔广播前 `landed(side_p2sh)` 未花 + ② 的同输入双花。**候选 SQL 自己不做这个过滤。**
- ⇒ **裁定**:③ 的改写可行,但**必须与 ① 的 landed-verify 硬前置绑死** —— 广义候选 + 无 landed-verify = 自动 tick 在 stale 集合上乱签(全靠双花兜,噪音大)。**且任何"95/26 笔待退"的读数,绝不能被人当"这些都要打钱"** —— 它是【上界含已领】,真正要打的是逐笔链核后的子集(同 1M runbook 的"count≠要打的笔数"纪律)。

---

## ④ 与 Owner「只 settle 不 refund」划界(spine 已花⇒settle 结构性关闭)— 🟡 **结构逻辑成立,但承重前提【spine 已花】E1 没核,且核的是 side 不是 spine**

- **结构逻辑成立**:PoolSpine 是**单 UTXO 多 entrypoint**(settle_aggregate / dispute_reveal / refund_maker_unjoined 是同一个 spine UTXO 的互斥花费路)。maker 退款走 `refund_maker_unjoined` 花掉 spine ⇒ settle_aggregate/dispute_reveal 再无 spine UTXO 可花 ⇒ **settle 结构性关闭**。⇒ Owner「优先 settle」先例**适用于 settle 还开着的盘**;这里 settle 已被 maker 自己关掉,剩下的 bettor `refund_market_cancelled` 是**完成一个已做出的退款决定**,不是"在 settle 与 refund 之间选 refund"。**论证站得住。**
- 🔴 **但承重前提"spine 已花"= 断言,没链核**(§6 自认 IBD 没读链)。且 E1 第 1 步 `run.cjs 3` 核的是 **side_p2sh 未花**(为 bettor claim),**不是 spine 已花**(为"settle 已关"这个划界)。**两个不同 UTXO。** ⇒ 若某盘 spine 其实**未花**(maker refund_txid 记了但没真花 spine,或 commingled spine 被别的盘状态搅乱),则那盘 settle **仍开着**,退 bettor 就**违反了 Owner 先例**。
- ⇒ **裁定**:④ 划界论证结构对,但**证据要配上**:E1 的链核批次里,对每盘**除了 `landed(side_p2sh)=未花`,再加 `landed(spine_p2sh, spine_lock_tx)=已花`**(spine UTXO 不在了)才成立"settle 关闭、可退 bettor"。**commingled spine(45/46 至今共享)尤其要小心**:共享 spine 被一盘花掉,对其它共享盘意味着什么,E1 没展开 —— 这批正是 FINDING-2 commingled,不能假设"一盘 spine 花了=所有共享盘 settle 都关"。**这条须在 E1 落码前的链核规格里钉死。**

---

## 交付判词
| 问 | 结论 |
|---|---|
| ① 谁读 refund_authorization / 写它有无别的动作 | 🔴 **MUST-FIX**:读者乙 = legacyRefundBuilderTick(`:493`),写 `owner_authorized` = 给自动签广播 tick 上膛(无 landed-verify),46 盘现只差这一条件。E1"状态不动/Owner按批"被推翻:授权=arming key。**硬次序:landed-verify 先落码验证,再写任何授权;"Owner按批"需独立门,不能靠手写授权。** |
| ② landed(side_p2sh) 挡 stale | 🟡 挡得住,但硬锁是**同输入双花**(单输入 side_lock_tx:0,与 1M 转账不同=自保),pre-check 是纵深+早筛。落码时关2 复核输入确为单输入。 |
| ③ 26 笔候选改写捞不该退的 | 🟡 不超出 legacy tick 现有集合(bettor 侧专属),但**含跨节点 stale 已领盘**(ko421),安全全靠 ② 的锁 + ① 的 landed-verify;候选 SQL 自己不过滤。读数=上界含已领,绝不当"要打的笔数"。 |
| ④ Owner 先例划界 | 🟡 结构逻辑成立(spine 单UTXO多路,maker refund 花spine⇒settle关),但**承重前提 spine-已花没核、且 E1 链核的是 side-未花不是 spine-已花**。须加 `landed(spine_p2sh)=已花` 进链核规格;commingled 共享 spine 尤须逐盘。 |

**总 verdict:E1 = PASS-WITH-MUST-FIX。** 方向对(实现 8/04 已拍 ③、不碰被否的回填 E3、划界论证结构成立),但 **① 是执行前必须解的承重缺口**(授权=上膛,landed-verify 硬前置,Owner-按批-粒度真机制),②③④ 各补一条(输入单一性关2核 / 候选=上界不当笔数 / 链核加 spine-已花)。**跨节点执行(J1 侧 DB)那步仍是 D-001 铁律 0.5 的跨机协调项,本机核不了,以 J1 报数为准 —— E1 §3 步3 已诚实标,保留。**

## 附:复核命令(只读)
- `sed -n '485,514p' kasia-console/src/services/pool-market-settler.js`(legacy tick 候选 SQL + buildBettorRefundClaim 广播,无 landed)
- `grep -rn refund_authorization kasia-console/src`(读者甲=refund-authorization.mjs:91 / 读者乙=settler:493)
- `grep -n side_lock_tx kasia-console/src/api/pool.js`(pool_bettor_sides 专属)
- `sed -n '305,337p' kasia-console/src/services/pool-market-settler.js`(authorizeRefundByOwner:316 状态门)
