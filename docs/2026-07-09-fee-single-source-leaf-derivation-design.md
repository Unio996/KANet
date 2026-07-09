# fee 单源 leaf 派生收敛设计（P4·D-008 BLOCKING 收敛卡·J2）

> **Status**: DRAFT（Bettor 方向审 GREEN-with-notes 2026-07-09·四注已折入·NWT 红队接审中）
> 依据：D-008 拍板（pool 基数=consolidatedPool 守恒硬要求 / 费率=D-007 池×market.broker_fee_pct / FEE_CONFIG 委员 120bps 份额挂政策卡待 Owner）。7/8 门② 实弹分叉：同一市场三处三说法（propose e170e003 Σ=300M 漏 seed vs prove job#6 Σ=320M vs D-007 expected）。
> **主线**：Owner 2026-07-09 10:08 钦定"部署 ZK 不等拍窗"（D-001 增补）——P4 是正式场市场5（~104KAS）唯一技术前置，Bettor 排"今天内闭"。

## 1. 现状三侧（已实读源码）

| 侧 | 位置 | 当前 pool 基数 | 当前费率源 | 问题 |
|---|---|---|---|---|
| propose | bshard-close-transport.mjs:225/344 | `poolSompi`=Σ注（漏 seed） | `FEE_CONFIG`（broker160+委员120bps） | 双错：基数+费率都非 D-008 口径 |
| enqueue | zk-prove-enqueue.mjs:36（feeLeaves 由 caller 显式传） | caller 传 consolidatedPool 口径 | caller 传 broker_fee_pct | 口径对但靠 caller 自觉，无单源函数强制 |
| guest-input | zk-prove-worker.mjs（fee_leaves 是输入，main.rs:151-155 免重编） | 继承 enqueue | 继承 enqueue | 同上 |

既有可复用资产：`pool-shard-settle.mjs deriveFeeLeaves/deriveFeeLeavesForMarket`（BigInt bps floor/canonical 序/fee-dust→committee[0] 确定性）——**算法骨架保留，参数口径收敛**。

## 2. 方案：单源函数 + 三侧接线 + 禁旁路

新增 `deriveSettlementFeeLeaves(market, consolidatedPoolSompi)`（pool-shard-settle.mjs，紧邻 deriveFeeLeaves）：

1. **pool 基数**：形参 `consolidatedPoolSompi` 必须=链上实额，函数内断言 >0 且 ≥Σ注。**函数不管来源，但每个 caller 的读取对象必须写死（注 A，Bettor 必须钉死项）**——不同时点物理上没有同一个"链上实额"可读：
   - **propose 侧**（transport.mjs:225/356 附近）：调用时点 CloseZkV2 continuation **还不存在**（zk_handoff 是下一步）——读取对象 = `payout_shards.payout_redeem_hex` 当前活 UTXO 现读的 `consolidated_pool` 字段（即 `realConsolidatedPool`，line 356 已有的 verify-value-source 现读逻辑，= Σ注+seed）。**禁止**沿用 line 343 那个 `poolSompi = Σbettors.stake`（漏 seed，7/8 门②三说法之一的错误源头）。
   - **enqueue 侧**（zk-prove-enqueue.mjs:69 附近）：调用时点 zk_handoff 已完成——读取对象 = `readPayoutShardV2AttestedState` 对 **zk_continuation.redeemHex** 现读的 `consolidatedPool`（NWT 预审已确认：这条读取路径结构上独立于 propose 传入值，非同源）。
   - **🔴 反 vacuous 铁律（NWT 预审抓到的实弹风险，落码时最容易犯）**：enqueue 调用 `deriveSettlementFeeLeaves` 时**绝不能**复用/透传 propose 计算出的 `consolidatedPoolSompi` 参数（哪怕参数名相同、"看起来该传同一个值更整洁"）——enqueue 必须用它自己独立现读的值调用。若图省事让两侧共享同一个已算好的数字，§3 验收①的三侧 byte-exact 测试会全绿，但只验证了"传递链路没打错字"，验证不出"propose 那头链读是不是真读对了"（跟 7/8 门①"同 env 同源三处一致=vacuous"同一个坑，规则56 同族）。
   - **guest-input**：经 enqueue 传入，天然继承 enqueue 侧的独立读取，无需单独处理。
2. **费率**：`market.broker_fee_pct`（D-007 市场级口径），broker leaf = pool×pct BigInt floor。
3. **委员分成**：FEE_CONFIG 120bps **暂不并入**（注 B：函数注释必须交叉引用 **D-008** 份额政策卡编号，防 TODO 变永久遗忘）——函数显式带 `committeeShare: 'pending-D-008-owner-policy'` 注释与 TODO 钉，Owner 确认份额表后在**同一函数**内加，禁任何调用方自加。
4. 返回 `{feeLeaves, feeSompi}`，签名/canonical 序/dust 处理照抄 deriveFeeLeaves 既有实现。

**三侧接线**：propose（transport:344 改调新函数+pool 基数改为 §2.1 明确的 `realConsolidatedPool` 读取路径）/ enqueue caller（改调新函数，独立现读，不透传 propose 值）/ guest-input（经 enqueue 传入，天然收敛）。

**旁路封死（注 D，升格为落码同 commit 必做，非候选）**：`deriveFeeLeaves` 原函数收窄为内部 helper（export 保留兼容 V1 committee-settle 路径，加注释"ZK 线禁直调，走 deriveSettlementFeeLeaves"）+ **同一个 commit 内新增 lint rule（WARN 级）**：grep 全库 `FEE_CONFIG`/`deriveFeeLeaves` 消费点，ZK 线相关文件（bshard-close-transport.mjs/zk-prove-enqueue.mjs/zk-prove-worker.mjs）直调旧函数即 WARN。这张卡的病根是"口径靠自觉"，lint 是机制化的牙，不留给下一个 caller 凭记性。

## 3. 验收（四证据，注 C 已改口径）

1. **同市场三侧同值**：offline test 用 **1dv70（5R-2）+ pxvml 历史真实输入回放**，断言 propose/enqueue/guest-input 三处产出的 feeLeaves byte-exact——**不再要求"5R-2 实弹再跑一次"**（5R-2 已终结、closed 态不可复弹，注 C 措辞更正）。实弹级验收 = 正式场市场5 首市顺带证明（不为验收单独开新彩排市场）。
2. **守恒**：Σ(payoutLeaves)+Σ(feeLeaves)==consolidatedPool 精确清零（enqueueZkProveJob 既有 BLOCKING 校验直接复用为验收断言）。
3. **claimedPayoutRoot 标注 non-binding**（D-008：propose 侧字段注释+ledger 口径，防后人当权威源）。
4. **旁路封死生效**：lint-kanet 对 ZK 线文件的 `FEE_CONFIG`/`deriveFeeLeaves` 直调产出 ≥1 条 WARN（新增 lint rule 本身也要有断言证明它真的会触发，不是摆设——同今早 debugger 正则"从没被真验证过的检查逻辑"同族教训）。

## 4. 不做什么

- 不动 guest circuit（fee_leaves 是输入，image_id 不变，D-009 冻结门尊重）。
- 不替 Owner 拍委员份额（挂 TODO 钉+D-008 编号引用，单源函数留位）。
- 不动 V1 committee-settle 路径的 FEE_CONFIG 用法（非 ZK 线，另案）。
