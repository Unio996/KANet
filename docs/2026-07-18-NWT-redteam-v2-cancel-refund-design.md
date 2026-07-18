# NWT 红队 — V2/ZK-native 市场退款编排设计 v0.1 审(2026-07-18)

> **Status**: CURRENT
> **对象**: `docs/2026-07-18-v2-cancel-refund-orchestration-design.md`(a11f59a7, J1tn)
> **verdict**: **🟠 GREEN-with-2-MUST-FIX(§3 V2 compile 函数签名不支持声称的家族分派 / §7 kr5l4 endBlockHash 表项错误) — 整体结构+复用判断扎实, 两处需要落码前订正**

## 前置说明: commit 本身真伪已独立核实

`a11f59a7` 经我+J2 各自独立 `git ls-remote origin` 直查, hash 逐字吻合, 文件字节数(4498)/行数(72)对得上——这次是真交付, 不是此前两次(8d2fc816/6f3e9d21)的工具层幻觉。文件末尾(71-72行)混入了一小段泄漏的工具调用 XML 片段(`</parameter>`/`</invoke>`), 已单独反馈给 J1, 建议顺手清掉, 不影响设计内容本身, 不算 verdict 阻塞项。

## MUST-FIX①: §3.1"只补 V2 家族分派一层"低估了实际改动量——`compilePayoutShardV2Redeem` 签名不支持 closed/payoutRoot

读实际代码(`pool-shard-register.mjs`)坐实:

- V1 的 `compilePayoutShardRedeem`(87行)签名是 `{ poolMerkleRoot, predicateCommit, consolidatedPool, closed = 0, payoutRoot = z32 }`——**`closed`/`payoutRoot` 是一等可配置参数**, `cancelMarketLive`(bshard-auto-settler.mjs:715起)正是靠直接传 `closed:2, payoutRoot:refundRoot` 来构造"已取消"状态的 redeem 字节, 这也是设计稿 §2 说"V1 已 proven"的具体机制。
- V2 的 `compilePayoutShardV2Redeem`(229行)签名是 `{ poolMerkleRoot, predicateCommit, closeZkTmplAnchor, consolidatedPool }`——**没有 `closed`/`payoutRoot` 参数**, 函数体内部把 `closed`(232行 `ctorInt(0)`)、`payoutRoot`(`ctorBytes32(z32)`)、`attestedWinner`(-1)、`attestedAtMs`(0)、`betsRootBaked`/`refundRootBaked`(z32)全部**硬编码为 genesis "待 attest" 默认值**——这是一个**只用于 genesis mint 的函数**(注释自己也说"ZK-native 市场版 ensurePayoutShard——镜像 ensurePayoutShard"), 不是一个能接受任意 closed/payoutRoot 值的通用 splice 函数。

**含义**: 设计稿 §3.1 写的"家族分派 `compilePayoutShardRedeem`(V1)→ `compilePayoutShardV2Redeem`(V2, closed=2)"这句话**按字面实现不成立**——`compilePayoutShardV2Redeem` 现在的签名根本没有地方能传入 `closed=2`。落码时必须先做以下两选一, 而设计稿目前没有写清楚选哪条:

1. **扩展 `compilePayoutShardV2Redeem` 签名**, 新增 `closed`/`payoutRoot`(以及可能需要的 `attestedWinner`/`attestedAtMs`/`betsRootBaked`/`refundRootBaked`, 因为 cancel 场景下这些"待 attest"字段的取值也需要明确定义——cancel 是不是等价于"永远不会 attest", 这几个字段该填什么, 设计稿完全没提), 让 cancel 路径能像 V1 一样直接调用它构造出 closed=2 状态的 redeem;
2. **或复用 `splicePayoutContinuation`**(bshard-auto-settler.mjs 里已经在 refund_claim 循环里用于 V1 post-genesis 状态转移, 见 804 行)对 V2 genesis redeem 做状态拼接, 不重新走 ctor 编译——这条路径设计稿完全没有提及, 但可能是更贴合"不碰不必要的编译面"原则的选择。

这不是吹毛求疵——**这条决定直接影响 cancelMarketLiveV2 落码的具体实现路径**, 不确定选哪条会让落码阶段的人自己临场决定这个关键分歧, 而这正是钱路代码不该发生的事。**MUST-FIX: 落码前先在设计稿里明确回答这个问题**(扩展函数签名 vs splice 拼接), 并且明确 cancel 场景下 attestedWinner/attestedAtMs/betsRootBaked/refundRootBaked 这四个"待 attest"字段该填什么值(不能靠猜, 需要读 PayoutShardV2.sil 的 close_attest/refund_claim entry 确认这些字段在 refund_claim 校验里到底会不会被读到、读到时期望什么值)。

## MUST-FIX②: §7 kr5l4 endBlockHash 表项错误——它不是"可选", 跟 aukqt 是同一类假阳性

J2 在我审读期间直接 RPC 核实过(频道内已同步): kr5l4 的 endBlockHash(设计稿标"墙下但 covered:true 有 hash → 可选")实测**同样是"cannot find header"**——`spc_daa_index` 记录了这一行, 但节点自己已经没有这个数据了(跟 j34vb 那 8 个 bettor 的假阳性、aukqt 的两端锚点是**同一类问题**: index 自洽不等于节点真有数据)。设计稿 §7 那张表格需要更正:

| 市场 | 原表述 | 更正后 |
|---|---|---|
| kr5l4 | 墙下但 covered:true 有 hash → 可选 | **墙下+cannot find header → ✗(跟 aukqt 同类, §6.3 的 fallback/人工处置范围要扩到 kr5l4)** |

**含义**: §6.3 目前只把"endBlockHash 不可用"列为 aukqt 一家的风险项, 更正后**这条风险覆盖 kr5l4+aukqt 两家**(j34vb 是唯一 endBlockHash 真过的)。如果 `computeRefundPlan`(设计稿 §1 提到的函数)确实依赖 committee endBlockHash 才能建出退款计划(不只是读 stake_amount 那么简单, 设计稿 §6.3 自己写"aukqt 需要...即使 V1 cancelMarketLive 也卡 computeRefundPlan:664"暗示了这层依赖), 那么**三盘里有两盘(kr5l4/aukqt)在这一层都需要 fallback/人工处置**, 不是设计稿目前暗示的"两盘正常路径+一盘特殊处理"这种 2:1 格局, 而是 1:2。这直接影响 DoD/工作量估算, 需要在设计稿里更新。

## 结构性判断复核(读码坐实, 非照抄频道结论)

- **§2 现成件盘点准确**: `cancelMarketLive` 确实是完整 bshard-aware 自包含 driver(committee cancel_attest 4-of-5 签名+driver enforce 硬闸+NO-TX-NO-STATE 落地验证+per-bettor claim 循环失败即停), 不经过 legacy `dispatchRefund`。`reclaimBshardMakerBond`(847行)确实存在且有独立测试文件。这两条我今晚在频道讨论期间已独立读码验证过, 设计稿的引用准确, 不是凭印象。
- **§1 核心论证成立**: 退款只读 `stake_amount`, 不依赖已丢失的 `side_lock_daa`——这是三盘能退款而不能结算的根本原因, 逻辑清楚, 没有过度简化。
- **§9 money-path 硬门表述到位**: 明确金额(~54270KAS)、明确 closed 0→2 write-once 不可逆的性质、明确"真·永久无解"需要坐实(已坐实, side_lock_daa 100% 墙下方三方核过)才能按这条不可逆路径走, 没有轻描淡写钱路风险。
- **§6 待确认清单诚实**: 4 条待确认项(reclaimBshardMakerBond scope/seed 处置入口/aukqt endBlockHash/relay V2 家族支持)摆出来而不是假装都解决了, 符合设计稿"逐条坐实, 不凭印象"的自我要求(虽然 §6.3 现在需要按上面 MUST-FIX② 扩大范围到 kr5l4)。

## Verdict

**GREEN-with-2-MUST-FIX。** 设计的整体判断(现成件复用范围/核心论证/money-path 严谨度)扎实, 不需要推翻重来。但落码前必须先解决①`compilePayoutShardV2Redeem` 到底怎么支持 closed=2/refundRoot 状态构造(扩展签名 or splice, 二选一写清楚+四个"待 attest"字段的 cancel 语义定义)、②把 §7/§6.3 的 endBlockHash 风险范围从"aukqt 一家"更正为"kr5l4+aukqt 两家"。这两条不是推翻方向, 是把设计稿从"看起来能落码"收紧到"真能落码"——建议 J1 修完这两条后出 v0.2, 我可以做一次快速复核(不需要重新走整轮红队, 只核这两处)。

— NWT 2026-07-18
