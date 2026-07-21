# NWT 红队 — /mybets explorer 链接+分页设计(e8a4fd0b)

> **Status**: CURRENT
> **对象**: docs/2026-07-12-mybets-explorer-link-and-pagination-design.md(KANet-UI)
> **verdict**: **RED→需 MUST-FIX 后重审——H1(claim_txid 对 bshard v0.7 赢家结构性恒空)是"重点①txid取值优先序有无遗漏分支"的确切答案:是,漏了 winner_details 分支;H2(多笔同方向消歧既有 bug)被本设计放大成用户可见的错误证据链接**

---

## 我查了什么(KANet-UI 点的两个重点,全部深挖到代码,非表面审)

### H1 🔴 MUST-FIX(重点①的答案): `claim_txid` 对 bshard v0.7 赢家结构性恒为 NULL

**全库 grep `pool_bettor_sides.*claim_txid` 的写入点,只有两处,全部退款专属**:
- `bettor-refund-claim-auto.mjs:118/126`——自动退款 claim 流程(含哨兵值 `'utxo_already_spent'`,连真 txid 都不是)。
- `pool.js:4023`——`pool_side_refund_cancelled_tx` 端点,手动取消退款流程。

**bshard v0.7 赢家的真实 claim txid 权威源在别处**:`bshard-settle-daemon.mjs:579` `winner_details: landedClaims.map(c => ({ pk: c.pk, amount: c.amount, txId: c.txId }))`——写进 `metadata.settle_evidence.winner_details`(JSON),从来不写 `pool_bettor_sides.claim_txid` 这个列。今晚整个 thread-walk 红队工作(桶A 27→0 全清)证实的就是这条路径。

**推论**:设计 §1 优先序"① `claim_txid`"对**所有 bshard v0.7 赢家**(今晚全部实盘,DoD#3/桶A/桶C 全走这条路)**恒为 NULL**——落到"② `settle_txid`"。但 `settle_txid` 是 `pool_markets` 列(市场级),对 V1 bshard 而言这是 close/consolidate tx(建 closed-PS covenant 的那笔),**不是**真正把钱付给这个具体赢家的那笔 claim tx(claim 是每个 winner 单独一笔,`bshard-auto-settler.mjs` claim 循环逐个提交,各自独立 txid)。**"赢单挂可点验链接"这个功能对现在活着的市场类型,会给用户一个打开后看不到自己那笔赢钱记录的链接**——这不是"没链接",是"链接指错交易",比不做还糟(§3 example 的"🎉 Won"场景恰好踩中这个洞)。

**修法**:my-positions 端点(pool.js:3240-3246)内部**已经**匹配出 `myWin`(`ev.winner_details.find(...)`)、已经用 `myWin.amount` 算 `actualPayoutKas`,**但从未把 `myWin.txId` 放进 response**(3303-3329 的 `out.push` 里没有这个字段)。需要:①my-positions 加一个字段暴露 `myWin?.txId`(比如 `bshard_claim_txid`);②设计 §1 优先序改为**四级**:`bshard_claim_txid`(v0.7 赢家权威源)→`claim_txid`(退款/legacy 场景)→`settle_txid`(v0.6 legacy)→`refund_txid`。这是**代码级前置**,非纯文案调整——设计落码前必须先补这个 my-positions 字段,否则设计基于的"后端已返回"前提对主用例不成立。

### H2 🔴 MUST-FIX(重点②的答案): 多笔同方向消歧——既有 bug,本设计会放大成可验证的错误证据

`ev.winner_details.find(w => w.pk === bettorPk)`(pool.js:3241)**按 pk 匹配,不按 amount/bet 行消歧**。若同一 bettor 在同一市场同一方向下了 **2 笔不同金额的赢单**(合法场景,非边缘情况),`positions` 循环(3205 `for (const p of positions)`,每个 `pool_bettor_sides` 行各自跑一次)会对这 2 行**各自独立调用 `.find()`**,拿到**同一个** `myWin` 条目(先匹配到的那个)——两笔不同金额的注,`actualPayoutKas` 会显示**相同**数值(取的都是第一个匹配 pk 的 amount),若接上本设计的 explorer 链接,两行会挂**同一个 txId**,但实际上链上是两笔独立 claim tx、两个不同金额。

对照:legacy v0.6 分支(3287-3296)**已经处理了这个问题**(按 stake 比例拆分"A bettor may hold multiple winning sides... Split this side's share by stake"),v0.7/bshard 分支**没有对应逻辑**——这是既有代码的家族性缺口(legacy 修过、v0.7 没跟上,同"v1/v2 双轨各说各话"家族的既有病),**本设计的"赢单挂链接"把这个此前只是"金额显示可能重复"的静默 bug,升级成"用户点开链接会看到跟自己单不符的交易"的可验证错误**——这比 H1 更隐蔽(H1 是链接指向错误交易类型,H2 是同 pk 多笔时链接张冠李戴)。

**修法**:v0.7/bshard 分支需要按 (pk, amount) 或更精确按 (pk, 该 position 行的 stake_amount 推算出的 payout) 消歧,或至少在 `winner_details` 里存的时候带上能对应回具体 `pool_bettor_sides.id` 的锚点(claimData 是按 plan.winners 顺序生成的,plan.winners 来自 `getMarketBets` 的逐行结果——理论上有办法把 winner_details 条目跟原始下注行对应上,只是当前存储形状(纯 pk+amount)丢了这个对应关系)。这个修法量级可能超出"半页接通"范围,若如此,设计 DoD 应显式收窄:**本轮先只对"该市场该方向只有 1 笔赢单"的场景挂链接,多笔同方向场景暂不挂链接(禁止显示可能错误的证据)**,比"挂错链接"安全,续卡修 H2 根因。

## 其余核点

- **分页 cap=15**:合理,复用 `/earnings` 公式逐字对,`byMarket` Map 插入序确认 = `created_at DESC`(SQL ORDER BY 已排),"最近优先"成立。
- **§5 划界**:诚实,不新造 explorer/web 跳转,不改状态判定五态——这部分我没找到反对意见。
- **i18n key**:EN/ZH 都给了,无遗漏语言。
- **lost 方向不挂链接**:设计对——lost 没有自己的 payout tx(对方 claim,非本人),不挂链接的判断正确,避免暴露误导性信息。

## 结论

**verdict = RED,需 MUST-FIX 后重审(非直接可落码)**。H1 是"重点①"问题的确切肯定答案(有遗漏分支,且是对主用例最重要的那一支);H2 是"重点②"问题的确切肯定答案(会取错,且是既有代码缺口被本设计放大成用户可见错误)。两者都不是"钱路"风险(没有资金误付),但**违反本功能自身的存在目的**(提供可验证凭证,若凭证本身有时指错/张冠李戴,损害的是用户对系统的信任,同"诚实口径铁律"精神——宁可不显示也不要显示错的)。

**建议路径**:①H1 补 my-positions 字段(小改动,不算"重造",是把已算出的值多暴露一个字段,不违反 Owner"复用接通"精神);②H2 若根因修复量级大,设计 DoD 收窄为"仅单笔赢单场景挂链接",多笔场景续卡。两点改完,重新出 v1.1,我复审。用户面文案(§3/§4)本身没找到问题,但**文案样例目前挂在错误 txid 逻辑上**,逻辑修完文案可能不用变(链接文案格式不变,只是数据源变了)。

— NWT 2026-07-12
