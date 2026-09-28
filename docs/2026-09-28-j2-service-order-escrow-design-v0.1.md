> **Status**: CURRENT

# D-034 §9 服务订单托管 — 设计稿 v0.1（只设计不写码）

出处：Bettor 2026-09-28 派工，依据 `docs/DECISIONS.md` D-034 §9（Owner 2026-09-28 批）。第一原则
（D-031）：先答"已有什么"，能改参数/加入口就不新起。

## ① 已有什么——能不能直接改参数/加入口

现有三个候选，逐一核对能不能直接用：

| 候选 | 结构 | 能不能直接用 |
|---|---|---|
| `PredictionEscrowConsensualMid.sil` | maker/taker 二选一赢家 + broker 固定 bps 抽成；`settle_consensual` 双签 + `refund_timeout` 单签(maker) | **形态可借**（双方同意放款 + 到期默认出口），但结构对不上：赢家二选一(不是 N 角色分账)、退款是"双方各退各的 stake"(不是"退买家扣1%给服务方")、ctor 无渠道签名链概念。**不能直接改参数**。 |
| `InstantSplit.sil` | 固定 3 角色(商家/broker/引荐人)，`split`(零签名任何人可触发)+`refund`(到期任何人可触发，全退) | 已是 `CommissionSplit.sil` 的前身(D-031 记录在案："本合约是 InstantSplit.sil 的推广，不是另起设计")，现在生产走的是 CommissionSplit，这里不重复评估。 |
| `CommissionSplit.sil` | N 角色(1-7)分账，`split`(零签名任何人可触发)+`refund`(到期任何人可触发，全退买家)——**§8 分账/渠道签名链就在这份合约上跑**，我上周刚修完它的 channelSpks 主网事故 | **`split()`的 N 角色输出校验骨架(role_count 1-7 逐分支 require 序列)直接可以复用**——买家确认放款要付的钱，形状跟 `split()` 一模一样(同一套角色/金额/scriptPubKey)。**`refund()`的单输出校验骨架也可以直接复用**——服务方取消全退，形状跟 `refund()` 一模一样。 |

**结论：不新起设计，但不能只"加入口"到 `CommissionSplit.sil` 本体**——原因是 `split()`/`refund()`
在这份合约里**零签名、任何人任何时刻可触发**，这是"即时分账"(§7/§8：付款即交付)故意设计成的开放性。
服务订单的核心诉求恰恰是"先托管、别让人立刻花掉"——如果直接在同一份合约里加三个新入口，旧的
`split()`/`refund()` 两个开放入口仍然在场，等于给托管开了后门(资金一到账，任何人立刻按旧入口分掉，
买家确认形同虚设)。

**因此提案**：新文件 `ServiceEscrow.sil`，**逐字复用** `CommissionSplit.sil` 的 `split()` N 角色
require 序列(改名 `buyer_confirm`，加一条买家签名门)与 `refund()` 的单输出 require 序列(改名
`provider_cancel`，加一条服务方签名门、去掉到期检查)，只有 `timeout_default`(见③)是真正新写的
输出形状——这与 `CommissionSplit.sil` 自己当初"从 `InstantSplit.sil` 推广，不是另起"的先例是同一套
方法论，头注会写清楚"本合约复用 CommissionSplit.sil 的两段 require 序列，不是重新设计"。

SDK 层同理：新 `createServiceEscrowProtocol()`，逐字对应 `commission-plan-sdk.mjs` 现有的
`createCommissionSplitProtocol()`(同一套 ctor 构造循环，只多两个 `pubkey` 参数：`buyer_pk`/
`provider_pk`)，不重写 ctor 组装逻辑。签名怎么编码不新造——`createInputSignature` + 去掉前导
push-opcode 字节这套已经在 `PredictionEscrowConsensualMid.sil` 的 `checkSig`、D-035 KTT v2 的
`unlockKttV2Transfer` 里验证过的惯例，照抄。

## ② 放款如何复用 §8 分账规则与渠道签名链

**买家确认(exit 1)的输出校验 = `CommissionSplit.split()`的输出校验，一字不改地搬进
`buyer_confirm()`**——这意味着：报价里的 `canonical_rules.roles`(provider/broker/channel_1..5)、
`resolveRulesForOrder()`算出的角色金额表、渠道签名链验证(`verifyChain()`/`dedupAndCapChannelSpks()`，
就是我上周修的那条链路)全部原样复用，`buyer_confirm()`只是在这套现成的输出校验前面多加一条
`require(checkSig(buyerSig, pubkey(buyer_pk)))`。归因/分账逻辑完全不感知"这是即时单还是托管单"——
跟 `CommissionSplit.sil` 头注"合约不感知归因"的既有原则一致，托管只是在**谁能触发**这一层加了门槛，
不碰**给谁多少钱**这一层。

`provider_cancel()`(exit 2)不涉及分账规则(全额退买家)，直接照抄 `CommissionSplit.refund()`的
单输出校验，去掉 `require(tx.time >= temporal(dl_ms))`(服务方随时可以认输，不用等到期)，换成
`require(checkSig(providerSig, pubkey(provider_pk)))`。

## ③ 1% 精度、最小值、各出口手续费上限

**1% 算法不新造**：`amount * 100 / 10000`——跟 `PredictionEscrowConsensualMid.sil` 的
`brokerFeeAmount = spendable * brokerFeePct / 10000` 同一个整数 bps 算法，`timeout_default()`里
`providerCut = remainder * 100 / 10000; buyerAmt = remainder - providerCut`(100 bps = 1%，跟
`fee-split.mjs` 的 bps 惯例同源，不是另起一套百分比系统)。

**手续费上限**：复用 `max_refund_fee_sompi`(ctor 已有字段，`refund()`早就在用)作为
`timeout_default()`的网络费预算——`timeout_default`结构上是"`refund()`扣完网络费的余额再切一刀"，
不需要新开一个 `max_timeout_fee_sompi`字段。**扣费顺序**：先扣网络费上限，1% 算在扣费后的余额上
(不是订单总额)，避免"网络费+1%"叠加吃掉买家应得部分。

**最小订单额(小额订单的精度问题)**：真实撞过的数字(D-034 §6.1 mass 校验实测)——一笔 2 输出交易
(provider 1% + buyer 99%)的现实网络费落在 1M~2M sompi 量级(同 `CommissionSplit.refund()`已用的
`max_refund_fee_sompi` 典型档位 1.1M sompi，`unlockKttV2Transfer`同形态 2 输入交易实测过 6.5M
——`timeout_default`是单输入更简单，按 refund 同档估)。这意味着**订单价格低于约 1.5 KAS 时，1% 罚金
可能被网络费吃掉大半甚至倒贴**，起不到"补偿服务方时间"的效果——这跟 §6.1c 已有的
`minOrderSompiForChannels(n, dosagePerChannelSompi, channelBudgetBps)`要解决的是同一类问题("份额
太小、经济上没意义")，提案：新增一个同形的 `minOrderSompiForServiceEscrow(dosageSompi=2_000_000n)`
辅助函数(不是新机制，是把 §6.1c 现成的"下限反推"公式换一个分母场景)，`createServiceEscrowProtocol()`
在 ctor 前校验 `price_sompi >= minOrderSompiForServiceEscrow(...)`，太小的订单直接拒绝走托管路径
(仍可以走 §7/§8 即时分账，只是不能用"先托管后放款"这个模式——即时分账本来就不需要 1% 罚金这个概念)。

## ④ 信用事件写在哪

**复用 `chain-event.js` 的 `recordChainEvent()`**——这是全仓所有结算路径(exchange/broker/proto)
统一在用的"链上事实归档"函数，本身已经带一个"客观记录不打分"的信誉聚合钩子
(`_maybeUpdateReputationSummary`，写 `reputation_summary`表的 `completed_count`/`disputed_count`/
`timed_out_count`三个**事实计数**，不是分数——这正是 Owner 要的"公开、不打分")。

- `timeout_default`成交后调 `recordChainEvent({txid, eventType: 'service_order_timeout_refund',
  fromAddress: buyerAddr, toAddress: providerAddr, payload:{order_address, price_sompi,
  provider_cut_sompi, ...}})`。
- 提案：`chain-event.js`里的 `_SETTLEMENT_EVENTS`(现在只有 `exchange_completed`/`exchange_disputed`/
  `exchange_timed_out`三个)加一行 `'service_order_timeout_refund'`映射到同一个 `timed_out_count`
  字段——**复用同一个计数器**，不是给服务订单另开一张信誉表；"到期未确认"这件事对 exchange 交易和
  服务订单来说，语义(对手方没有正常互动收尾)是一样的。一行 `Set` 新增，零新表。
- `buyer_confirm`/`provider_cancel`两个正常出口也顺手调 `recordChainEvent`(`service_order_confirmed`/
  `service_order_cancelled`)留痕，但**不**接入 `_SETTLEMENT_EVENTS`(Owner 原话只点名"到期退款"要写
  信用事件，V1 不过度联想，按 Owner 说的做)。

## ⑤ 结账页要加什么

- 报价新增字段 `order_kind: 'instant' | 'service'`(默认 `'instant'`，向后兼容现有即时分账单，不破坏
  已合入的结账页主流程)。`checkout.js`按这个字段决定用 `CommissionSplit`/`InstantSplit`还是新的
  `ServiceEscrow`合约路径，UI 分支同理。
- **买家确认按钮**：需要买家自己签名——不引入新身份概念，复用买家已经在表单里填的 `refundAddr`
  对应的那把 key(买家本来就要持有这把 key 才能在退款场景收到钱，同一把 key 双用：退款收款方 +
  确认放款签名方)。UI 上买家需要能在页面本地签这条消息(同 checkout.js 现有"从不持有/传输私钥"的
  原则——签名发生在买家自己的浏览器/钱包里，页面只组装 sigScript，跟现有 `broadcast-commission.js`
  "零签名"两条入口不同，这条新路径**确实**需要买家在本机操作私钥，属于本设计唯一需要 Owner/Bettor
  额外确认的 UX 决策点，不是我能单方面拍的)。
- **服务方取消按钮**：签名方复用报价里已有的 `merchant_pubkey_hex`(商家/服务方本来就用这把 key 签
  报价本身)，不引入新身份。
- **到期退款按钮**：照抄现有 `triggerSplitBtn`/`triggerRefundBtn`的既有模式(零签名、PMT 判据、
  按钮 disabled/enabled 状态机)，文案改成"到期触发退款(买家 99% / 服务方 1%)"，展示预览金额。
- **订单状态展示**：现有 `monitor.js`的 `getOrderPaymentStatus()`(`unfunded`/`underfunded`/
  `funded`/`overfunded`)不用改——托管单资金到账后同样是这几个状态；额外需要的只是"已解决"的判断，
  复用现成手法(同 KANet-UI 那份 duplicate-trigger 测试用过的思路：订单地址的 UTXO 被花掉 = 已解决，
  不用新起一张状态表，查一次地址就知道)。

## 已知局限(照抄决策文本，如实列出)

买家享受了服务却故意拖到期拿回 99%，链上判不出有没有履约——1% 不足以完全阻止，V1 对策只用现成件
(到期退款写信用事件 + 服务方可对陌生买家要求分段付款 + 纠纷裁决留 V2)，本设计不额外加码，保持
Owner 要的"关键跑通，别把系统搞复杂"。

## 待 Owner/Bettor 确认的一点

⑤ 提到的"买家确认需要买家本机签名"是这次设计里**唯一**跟现有结账页"零签名两个入口"范式不一样的
地方——现有 `split`/`refund`按钮从不要求用户操作私钥；`buyer_confirm`结构上必须要。这不是我能单方面
决定"要不要做"的产品选择(涉及买家怎么保管/输入私钥的 UX)，留给你们定，设计本身已经把签名方案
(复用退款地址那把 key)定好，只是交互细节待定。
