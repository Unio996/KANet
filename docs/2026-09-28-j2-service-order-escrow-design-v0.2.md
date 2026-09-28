> **Status**: CURRENT

# D-034 §9 服务订单托管 — 设计稿 v0.2（只设计不写码，供审后再施工）

出处：Bettor 2026-09-28 二次派工，Owner 审 v0.1 后追加 2 MUST + 3 建议 + 2 条新测试。**结构不推翻**——
仍是 v0.1 §① 的结论(新文件 `ServiceEscrow.sil`，不在 `CommissionSplit.sil` 上加入口)，本稿只记录
五点修订 + 两条追加测试。v0.1 全文见 `docs/2026-09-28-j2-service-order-escrow-design-v0.1.md`(已标
SUPERSEDED，保留对照)。

## 施工现状(如实说明，v0.2 批准前不再往前推)

v0.1 阶段已经真实编译过一版 `ServiceEscrow.sil`(7 角色分支照抄 `CommissionSplit.split()`)+ SDK
`createServiceEscrowProtocol()`，用真实 `silverc-v100-3ed9733.exe` 编译通过、`entries` ABI/
`dispatch_tag` 真实核对过；simnet 真共识测试(三出口+4 个负向用例)脚本已经写好，起了一台独立
simnet 节点在挖矿，**测试尚未跑完**就收到本轮追加指示——按 Bettor"先改设计稿 v0.2 交我，再施工"的
明确要求，代码停在这里等 v0.2 批准，不带着旧形状继续测。下面五点逐条会导致合约结构**变小**(建议-3)
且部分字段语义改变(MUST-1/建议-4)，v0.1 那版合约/SDK 需要重写，不是小改，所以先定稿再动手。

## MUST-1：timeout_default 的买家/服务方份额改 ctor 参数，不写死 99/1

`ServiceEscrow` ctor 新增 `int timeout_buyer_bps`(默认 9900)——`timeout_default()`里
`providerCut = remainder * (10000 - timeout_buyer_bps) / 10000; buyerAmt = remainder -
providerCut`(1% 算法本身不变，见建议-5，只是比例从字面量 100 改成 ctor 变量)。报价 JSON 里
`canonical_rules`旁边加一个`timeout_buyer_bps`字段，商家签报价时定死这个数，不是运行时可改。

**已知局限(必须写进最终稿，不是补充说明——是这个机制的结构性边界)**：到期默认分法无论偏向谁，
都给"故意拖到期"一方留出可占便宜的空间——KANet 的身份 = 链上地址，换一个地址历史记录清零，
`chain_events`/`reputation_summary`那套"客观记录不打分"的信用事件挡不住"用新地址重新来"这种最简单
的规避。V1 只在我们自己的测试身份之间使用(同 Bettor 派工原话"V1 仅限我们自己的测试身份")，**开放
给外部真实用户之前必须先补一条独立的争议仲裁腿(Oracle/委员，同 D-034 §9 决策文本"纠纷裁决留 V2"
那句)**——本设计不在 V1 假装解决这个问题，如实标注边界。

## MUST-2：最小订单额改按 KIP-9 storage mass 实测，不是公式

v0.1 §③ 提的`minOrderSompiForChannels`下限反推公式**作废**——理由(Bettor 原话+真实源码坐实)：
`mempool`按`mempool_block_mass_limits.storage`拒交易(`rusty-kaspa mining/src/mempool/
check_transaction_limits.rs`)，storage mass 是"`10^12/输出金额(sompi)`的调和和"这类跟金额倒数
相关的量，**不是网络费/固定手续费能近似的东西**——网络费公式在这里是错的抽象层。真实撞过的证据：
主网 1 KAS 拆 0.8/0.1/0.1 已落地能广播，但 KANet-UI 结账付款时"近清空找零"(极小额找零输出)被节点
真实拒绝"Storage mass exceeds maximum"——同一个"多小算太小"问题在两个不同的即时分账场景里已经
出现过两次不同的答案，说明这事必须**实测**，不能套公式。

**施工时怎么定**：在 simnet(接主网参数，非 simnet 自己的宽松默认)上对`timeout_default`(两输出：
provider 1%/buyer 99%)与`buyer_confirm`(见建议-3，改成单输出后)各自跑二分法，找真实可广播的最小
订单额，**把这个实测出来的数字登记进设计稿终稿与代码常量**(不是这一版 v0.2 里现在就给数字——本
v0.2 阶段目的是把"方法从公式改成实测"这个决定写清楚，实测本身是"合约+SDK+simnet 真共识测"那一步
的工作，届时把结果回填)。storage mass 上限本身以我们主网节点 v2.0.1 实际版本为准，不假设 Toccata
前后哪个数字(500,000 还是 100,000)，施工时直接读当前跑的这份二进制的真实拒绝阈值。

## 建议-3：buyer_confirm 不再照抄 N 角色 require，改为整笔转给该订单的 CommissionSplit 地址

v0.1 里 `buyer_confirm`逐字复用了 `CommissionSplit.split()`的 7 分支 N 角色输出校验——**这一步现在
撤回**，改成：`ServiceEscrow`的 ctor 只烤一个 `commission_split_spk`(该服务订单对应的、已经用
现成 `createCommissionSplitProtocol()`单独算好的 CommissionSplit 实例地址)，`buyer_confirm`的
require 序列收窄成跟 `provider_cancel`几乎一样的**单输出**校验：

```
entry buyer_confirm(sig buyerSig) {
    require(checkSig(buyerSig, pubkey(buyer_pk)));
    require(tx.inputs.length == 1);
    require(tx.outputs.length == 1);
    require(tx.outputs[0].scriptPubKey == commission_split_spk.slice(0, commission_split_spk_len));
    require(tx.outputs[0].value >= tx.inputs[this.activeInputIndex].value - max_s_fee);
}
```

角色分账逻辑(provider/broker/channel_1..5、渠道签名链)**完全不进 ServiceEscrow 合约本体**——托管
只负责"买家确认后把钱原样转给下游那份已经审过的 CommissionSplit 合约"，分钱这件事继续交给
`CommissionSplit.split()`自己(零签名，任何人可再触发一次，包括服务方自己，因为服务方显然想尽快
拿到钱)。这是**两跳结算**：① `buyer_confirm`把钱从 `ServiceEscrow`地址搬到 `CommissionSplit`地址
(需要买家签名)；② 该 `CommissionSplit`地址上的 `split()`把钱分给各角色(零签名，谁想推进都能触发，
同现有即时分账机制)。第②跳沿用结账页/relay 已有的"付款到账后任何人可触发分账"基础设施(同 D-034
§8 后续票⑥的浏览器直连节点触发机制)，不新造。

**代价如实说明**：多一跳 = 多一笔手续费、多一段"钱已经确认但还没到具体角色手上"的中间态。换来的是
`ServiceEscrow.sil`本体从 7 分支~300 行收缩到 3 个近似单输出的入口(预计 <100 行)，且 N 角色分账的
正确性完全不需要在新合约里重新证明一次——那部分正确性已经由 `CommissionSplit.sil`自己的审计与我
上周修完的 channelSpks 主网复测背书。

## 建议-4：截止时间改用 DAA 分数，不用墙钟/PMT

**真实约束核实(不是假设)**：`docs/DECL.md`/`TUTORIAL.md`未见 `temporal()`专门文档，改查
KB `architecture/invariants/2026-06-21-bshard-deadline-gate-cltv-and-settle-enforce.md`(bshard
deadline-gate 不变量，链上 teeth 实证)确认：`tx.locktime`(交易自身的 lockTime 字段，广播时由构造
方设置)按数值域自动判定语义——`< 5×10^11` = DAA-score 模式，`>= 5×10^11` = 毫秒 epoch 模式(CLTV
opcode 按这个阈值分诊，不匹配报"mismatched locktime types")。`CommissionSplit.refund()`现在的
`temporal(dl_ms)`走的是毫秒 epoch 分支(`dl_ms`永远是 1.7×10^12 量级的墙钟毫秒值，天然落在
`>=5e11`区)。

**改法**：`ServiceEscrow`的 ctor 字段从 `deadline_ms`改成 `deadline_daa`(DAA 分数，天然
`<5e11`——按 Bettor 给的主网 10 BPS，72 小时 = 259200 秒 × 10 = 2,592,000，跟任何合理 DAA 高度加总
都远低于 5×10^11 门槛，不用担心域混淆)。合约里 `require(tx.time >= temporal(dl_daa))`这行**不用
改字面写法**(`temporal()`本身按传入数值的量级分诊，不是两个不同函数)——变的是调用方传的是 DAA
分数不是毫秒。报价 JSON 层面商家仍然写"小时"(人类可读)，SDK 负责换算：`deadlineDaa = currentDaa +
hoursToDeadline * 3600 * MAINNET_BPS`(`MAINNET_BPS=10`，命名常量不是魔法数字)。广播方(SDK/relay)
在 `timeout_default`/`refund`系交易上设置 `tx.lockTime = <某个 >= deadline_daa 的 DAA 分数>`(现查
节点 `getBlockDagInfo().virtualDaaScore`，不是本地算的——同现有 `buildCommissionRefundTx`要求调用方
现查 PMT 的纪律，只是这次查的量换成 DAA 分数，**反而比 PMT 简单**：不需要"PMT 滞后墙钟"这类额外
安全边际推导，DAA 分数是单调递增的整数，直接查、直接比)。

**连带影响**：`buildCommissionRefundTx`的 `PMT_LAG_GUIDANCE`那套推导对 `ServiceEscrow`不再适用——
`timeout_default`/(如果 `provider_cancel`要考虑截止时间的话，本设计目前 provider_cancel 仍然
"随时可用不看截止时间"不受影响)不需要现查 PMT，只需要现查 DAA 分数，代码更简单，这是这条建议的
额外收益，不只是"改个字段名"。

## 建议-5：1% 取整公式先登记，合约/SDK/结账页三处同式

**先登记，再写测试**(Bettor 原话)：
```
providerCut = floor(amountAfterFee * timeoutProviderBps / 10000)
buyerAmt    = amountAfterFee - providerCut
```
`amountAfterFee = totalIn - max_r_fee`(先扣网络费上限，见 v0.1 §③ 已定的顺序，这条不变)。
`timeoutProviderBps = 10000 - timeout_buyer_bps`(MUST-1 新 ctor 字段，默认 100 = 1%)。**三处必须
逐字同一个公式**：① `ServiceEscrow.sil`的 `timeout_default()`(合约用整数除法`*`/`/`，SilverScript
`int`本身是整数语义，`floor`即整数除法截断，不用额外函数)；② SDK 侧任何预览/校验这笔金额的地方
(结账页展示"到期后你会收到多少"之类的预览数字)；③ 结账页(纯 JS `Math.floor`或直接照抄同一整数
表达式，不能用浮点近似)。**登记完成 = 本条完成**，用这个公式写 simnet 测试断言(负向④"1% 金额错一
sompi 被拒"就是断言这个公式算出来的精确值，多 1 少 1 都要被合约拒)。

## 追加测试 ⑥⑦(并入原有 3 出口成功 + 4 负向，共 9 项)

- **⑥到期后路人触发**：`timeout_default`到期后由**第三方**(既不是 buyer_pk 也不是 provider_pk 对应
  的地址)广播 — 应该成功(零签名入口，"任何人可触发"这条性质必须在真实第三方场景下验证过，不能只
  用测试脚本自己控制的两个身份广播就当验过"任何人")。
- **⑦三出口互斥**：已经 `buyer_confirm`过的订单，其对应的 escrow UTXO 已被消耗——再对同一个订单尝试
  `provider_cancel`/`timeout_default`应该失败，且失败原因应该是"UTXO 不存在/已花"(结构性互斥，
  UTXO 模型本身防重放，不需要额外的状态位)，反过来 `provider_cancel`/`timeout_default`先触发后
  `buyer_confirm`同理。测试方法同 D-035/checkout 那批已经用过的"duplicate-trigger-rejected"手法
  (查地址 UTXO 状态 = `unfunded`，不是构造第二笔花费再等节点拒绝——UTXO 已经不存在，连尝试的对象
  都没有，这本身就是最直接的证据)。

## 签名默认——V1 范围如实标注

维持 Bettor 拍的默认(控制台自带钱包/relay 签，复用 D-035 `unlockKttV2Transfer`那条"relay 用自己的
key 签 covenant 输入"IPC 路径，页面不碰私钥)，**但设计稿必须写这一句，不能含糊**：**V1 这道
`buyer_confirm`签名门证明的是"控制台(某个 relay 身份)同意放款"，不是"真实买家本人同意"——只有 V2
真正接入外部钱包(浏览器插件/手机签名)之后，这道门才对应"买家本人"这个语义**。V1 阶段的"买家"和
"服务方"都是 KANet 自己在控制台里注册的 relay 身份，这套机制现在验证的是"合约结构对不对、签名门
挡不挡得住错误签名人"，不是"防真实外部买家抵赖"——跟 MUST-1 的已知局限是同一件事的两个面，都要
如实标注、不过度宣称。

## 其余四点(§②④⑤)——沿用 v0.1，未受本轮追加影响

- ②放款复用 §8 分账规则：结构调整为建议-3 描述的"两跳"，但"角色表/渠道签名链完全不在 ServiceEscrow
  里重新实现"这条核心结论不变（现在甚至更彻底——连角色输出校验的 require 序列都不复制了，直接把
  钱交给已经跑通的 CommissionSplit 地址）。
- ④信用事件写在哪：不变，`recordChainEvent()`+`_SETTLEMENT_EVENTS`一行新增，`timeout_default`
  成交事件的 payload 需要补上 `timeout_buyer_bps`(MUST-1 新增字段，回答"这笔到期退款当时约定的
  分法是多少"，留痕更完整)。
- ⑤结账页改动：不变，唯一要补的是"报价新增 `timeout_buyer_bps`/`deadline_hours`两个字段"以及
  签名 UX 的最终确认(见下)。

## 施工顺序(不变，Bettor 原话)

合约(按本 v0.2 五点重写)+ SDK(`createServiceEscrowProtocol`改 ctor 字段、去掉 v0.1 的公式化最小额
函数换成实测常量占位) + simnet 真共识测(3 出口各一次真实成功 + 原有 4 项负向 + 追加⑥第三方触发
timeout 成功 + ⑦互斥负向, 具体断言条数施工时视合约最终形状定, 不在设计稿里预先钉死) → 控制台签名
路径(relay IPC，复用 D-035 模式) → 结账页。v0.1 阶段已经起好的 simnet 节点
(`scratch/_j2_service_escrow_simnet`)继续可用，不用重新搭。
