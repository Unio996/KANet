# Kaspa 即时分账结算模板 · Covenant 设计 v0.1

> **Status**: DRAFT · 待 NWT 攻击面审
> **作者**: J2 · **派工**: Bettor（转述 Owner，D-034 + D-034 §7 收敛方案，账本 1693）
> **范围**: 只交设计稿，不写生产代码；不做部署。
> **权威依据**: `docs/DECISIONS.md` D-034（含 §7 收敛）、D-025（含 2026-09-26 补两条）、D-031（第一原则）、D-019（silverc v1.0.0 pin）、D-018（代币守恒，本设计不涉及——不引入新代币）。

---

## 0. 一句话目标 + 验收标准（Owner 收敛稿逐字落地）

**一句话目标**：任何人都能在 Kaspa 上创建一份分润协议，任何参与者都无法单方面改变它，任何人都能独立验证并执行它。

**范围铁律（本轮只做这个，其余是 D-034 后续步骤或明确不做）**：
- 参与者固定三类：**商家 / broker / 引荐人**（引荐人可选）。
- **仅 KAS**——不做多级推广、不做长尾金库、不做 ZK 批量、不引入新代币（本条与 D-018/D-019 的 KTT 代币家族无关：本设计的价值单位是原始 KAS sompi，不是任何代币）。
- **链上强制分账**（covenant 约束输出），不是"钱包自愿按计算结果付款"。
- **"即时"只指不等外部 Oracle**——正常路径允许两笔交易：① 付款锁定（资金进入订单地址）→ ② 分账（一笔交易把钱按规则付给全部收款方）。

**三条验收（写成可执行测试，§5 逐条对应）**：
1. **规则不可篡改**：加佣金、换收款地址、改输出截留，均被共识拒绝（不是被业务代码拒绝，是被 kaspad 共识拒绝）。
2. **资金出口自主**：broker 与 KANet 服务全离线时，任一参与者（或任何人）仍能独立构造合法分账交易；超时后付款人能自己退款——不需要我们任何一台机器在线。
3. **第三方独立部署**：只凭开源组件 + 公开 JSON 配置即可建协议、分账、核验，不依赖我们的 DB 或管理员授权。本稿 §2/§3/§7 逐条写清最小输入与所需节点 RPC。

---

## ① 查现成（D-031 强制第一步）

### 1.1 kasia-console/src/services/ 全目录扫描结论

没有任何文件在这个目录里直接构建或广播 covenant 花费交易——KANet 的角色分工（Console 传导不碰链）决定了这类逻辑全部在 `kasia-relay/src/lib/p2sh.mjs`（独立进程）。`services/` 里与本设计相关的只有三类，且**全部不可直接复用**（原因见下）：

- **`fund-lock.js`**（128 行，全读）：`lockFunds`/`releaseFunds`/`spendFunds` 是纯离线 SQLite 记账（`fund_locks` 表，UNIQUE(order_id,asset)），**不可复用**——这正是 D-025 反对的模式本身（锁在数据库一行,不在链上 UTXO），复用它等于把 D-034 的第一条验收("规则不可篡改")建立在一张可被我们任意 UPDATE 的表上。
- **`escrow-landed-gate.mjs`**（69 行，全读）：`escrowGateFor`/`assertSettleEligible` 是"等链上 landed 之后才推进业务状态"的离线闸模式，**可参照其"不见链上确认不推进"的纪律**，但它管理的是老 exchange_offers 的状态列，不是本设计要建的东西。
- **`exchange-machine.js` / `evm-transfer.js` / `cross-chain-verify.mjs`**（D-034 §2 执行层，"其他币经 exchange 组件换 KAS"那部分）：
  - `exchange-machine.js`（1333 行）——**完全托管模型**：某个 agent 自己热钱包签名广播每一腿。**不可用于本 covenant 内部**——本设计的第二条验收（broker/KANet 全离线仍可分账）与"托管服务必须在线持钥"直接矛盾。它是**未来 Phase②（USDT 适配器）**的正确落点：作为一个独立的 Maker，把已换好的 KAS 打进订单地址，但那个 Maker 的托管信任是一个独立标注的信任边界，不属于 covenant 本身。
  - `evm-transfer.js` / `cross-chain-verify.mjs`——通用、可复用，但同样是 **Phase② 范围**（非 KAS 支付适配器），本轮 KAS-only 设计不触碰。

**结论**：`services/` 目录没有可直接搬的"链上强制分账"机制；本设计必须从 `.sil` 合约层与 `kasia-relay/src/lib/p2sh.mjs` 的构建工具层取材（见下）。

### 1.2 kasia-console/src/lib/*.sil 全部合约扫描（D-019 mainnet 11 合约集 + escrow 家族）

| 合约 | 复用 / 参照 / 不可用 | 理由 |
|---|---|---|
| **PayoutShard.sil / PayoutShardV2.sil** | **参照**（不可直接复用形状） | `claim` 入口是"任何人可触发、输出受约束"的**唯一现成先例**——但验证机制是**单笔领取对 merkle 根**（witness 供 `bettorPk,payout,merkle_index`+10 层证明，`require(cur==payoutRoot)`，`payoutRoot` 是委员会 4-of-5 写入的 State），是**拉取/单人领取模型**，不是**推送/一笔转 N 人模型**。本设计要的"一笔交易验 N 个输出"在这个仓库**没有先例**，是真正的新形状。可直接搬的零件：`_psInputCovId` 读自身真实 covenant_id fail-loud 模式、`_appendChange` 找零焊接、`_bshardFeeV1` 手续费公式、`validateOutputState`/`validateOutputStateWithTemplate` 声明式状态延续原语。 |
| **ShardLeaf.sil / ShardLeaf_direct.sil** | **参照** | `validateOutputState` 家族用法的范本；本设计不需要跨期延续（一次性终态合约），故不需要这层机制本身，只借鉴其"下一状态整体声明式比对"的写法思路。 |
| **RootClose.sil** | **直接复用模式**（`refund_flip` 入口） | **这是本设计"超时任何人可触发退款"的现成先例**：`require(tx.time >= temporal(deadline_ms))`（close_commit,:141）与 `require(tx.time >= temporal(deadline_ms + 7200000))`（refund_flip,:166，2 小时宽限后任何人可触发、零签名、纯超时）。`temporal()` 墙钟 CLTV 原样搬进本设计的 `refund` 入口。 |
| **RootClaim.sil / RefundClaim.sil** | 参照 | 同 PayoutShard 的单人 merkle 领取模型，同样不是本设计要的推送形状。 |
| **CloseZkV2.sil** | 不适用 | ZK 证明验证，另一套信任模型，本设计不涉及外部事实/证明。 |
| **KanetTokenClaim.sil** | **形状最接近的单收款人先例** | ctor 直接烤 `init_winner_pk,init_amount`，单入口 `spend`，一次性终态——**这正是本设计"ctor 烤死收款人+金额、一次性花掉"的最小对照物**，只是本设计要把它从 1 个收款人扩到 3 个（商家/broker/引荐人）并加一个退款分支。 |
| **sil-v1/KanetTestToken.sil** | **不适用（D-034 §7 明确排除）** | 本设计"不引入新代币"，直接移动原始 KAS sompi，不需要 `TokenState`/`scanOwnedTokenInputs` 那套代币层间接。 |
| **sil-v1/PoolSideTicket.sil** | 不适用 | 签名门控的参与凭证，不是支付机制。 |
| **PredictionEscrowUnanimous5.sil**（不在 D-019 11 合约集内）| **不可复用（信任模型不对）** | 全部靠 `checkSig`（9 处）放钱，零自执行哈希/输出条件——是"信某个签字人"模型，不是"验输出是否符合规则"模型。已验证的阴性对照（Bettor 2026-07-31 实核，memory `reference-all-three-escrows-are-signature-based-not-self-executing`）：同仓 `blake2b/sha256` 类原语在别处用了 200+ 次，"没往这个方向写过"是选择不是能力限制。D-034 明确要"链上强制"而非"需要一个受信第三方签字"，这三份 escrow 是**反例，不是可复用件**。 |
| **`escrow_states` 表**（migrate v175）| **参照表结构** | 3 方（buyer/seller/arbiter）P2SH 索引表的字段形状（p2sh_address/redeem_script_hex/amount_sompi/deadline/lock_txid/unlock_txid）是"自证回执索引"该有的样子；本设计若建自己的追踪表（纯离线索引，从不作真相源），可照抄这个形状，改成 3 收款人字段。 |

### 1.3 packages/fee-split（规则层，D-034 §2 点名必须复用）

**结论：`feeSplit`/`validateFeeRules`/`canonicalizeFeeRules`/`computeFeeRulesCommit` 成熟、被真实链上历史逐字节验证过、5 个生产调用点在用——规则层逐字复用，零改动。**

- 源头唯一：`kasia-console/src/lib/fee-split.mjs`（`packages/fee-split/fee-split.mjs` 是自动生成镜像，`R-FEE-SPLIT-PKG-DRIFT` lint 防漂移）。
- `feeSplit(feeRules, poolSompi, winners, {committeePks})` → `{degenerate, winners, feeLeaves, payoutLeaves, poolTotal, distributable, feeSompi}`，全部金额是 BigInt sompi 十进制字符串。
- **整数分配算法**（本设计 ctor 必须逐字节一致的部分）：
  - 角色费份额：`floor(pool * bps / 10000)`。
  - 赢家/收款方份额：`floor(stake * distributable / totalWinStake)`。
  - **余数归属**（两条不同规则，必须都还原对）：委员派生角色（`derive:'committee'`）的余数 → **排序后的 `committeePks[0]`**；赢家/收款方份额的余数 → **调用方传入顺序的第一个 `winners[0]`**（不排序）。
  - 0 份额角色（`bps<=0`）或缺地址的 `optional` 角色 → 从输出**整条跳过**，不产出 0 金额条目。
  - 真实链上回放验证：市场 `1dv70`，池 320,000,000 sompi，broker bps=190 → `feeSompi==='6080000'` 与真实主网已落地 claim2 值一致（`fee-split.test.mjs:14-18,102-106`）。
  - 端到端守恒：`Σ payoutLeaves === BigInt(poolTotal)`，零差额（`:108-118`）。
- `canonicalizeFeeRules`：角色按 `name` 升序排列（**这也是 `feeSplit` 自身的发射序**——序列化序=行为序，否则同一 commit 能推出不同的分配结果）；`_canonicalJson` 与 `pool-shard-settle.mjs:182` 的 `canonicalPredicate` 是同一约定（不是新造序列化格式）。
- `computeFeeRulesCommit(feeRules) = blake2b256(canonicalizeFeeRules(feeRules)).hex`——单次哈希，无域分隔前缀，无盐。
- **一个真实缺口（本设计必须在其之上补，不是模块内部的活）**：D-025 §6（2026-09-26 补）要求"先承诺后揭示"场景把 `H(条款‖盐‖提交方)` 绑定，防抢先揭示。`computeFeeRulesCommit` 今天没有盐/提交方参数。**本设计不触发这个缺口**（见 §2.6 说明：本设计不做"先承诺后揭示"，参数从 genesis 起就公开透明），但设计稿里必须明确记录这个事实，不能含糊写"已满足 D-025 §6"。

### 1.4 KIP-9 storage mass（D-034 §5 明点"小额份额触及 storage mass 上限"）

不是查旧文档就够——**本节数值直接对源码验证**（`D:\rusty-kaspa`，tag `v2.0.0`，commit `90dbf074`；主网实跑二进制 = 官方 v2.0.1，两者 mass 公式代码路径一致，仅补丁级差异，见 D-017）：

- `consensus/core/src/mass/mod.rs:83-99`：`utxo_plurality(spk,has_covenant) = ceil((63 + |spk| + (has_covenant?32:0)) / 100)`。
- `consensus/core/src/constants.rs:31`：`STORAGE_MASS_PARAMETER = SOMPI_PER_KASPA * 10_000 = 1_000_000_000_000`（即 C=10¹²）。
- `consensus/core/src/config/params.rs:698` 等：`prior_block_mass_limits = BlockMassLimits::with_shared_limit(500_000)`——storage/compute/transient 三维共享 500,000 上限（这就是"我们主网 500k 上限"的真实出处，非传言）。
- 公式（`mod.rs:439-513`，本设计场景下的化简见 §4）：`storage_mass = max(0, Σ_out C·p_o²/v_o − 输入侧项)`，且**对恰好 1 个输入**（本设计所有交易都只花 1 个订单 covenant UTXO）**输入侧项恒等于 `C·p_in²/amount_in`**（relaxed 与 general 两条分支代数上重合，见 §4 推导）。

---

## ② Covenant 规格

### 2.1 架构判断（关键设计决定，列入"待定"供 NWT/实现阶段确认）

**判断**：本合约**不使用 covenant 的 State/genesis-continuation 机制**（`OpInputCovenantId`/`populateGenesisCovenants`/`GenesisCovenantGroup`），设计为**一次性终态的纯 P2SH 脚本**（ctor 参数烤入 redeem script、无 State 字段、无自续约输出）——理由：
- 本合约的生命周期是"资金进入 → 一次花费终结"（split 或 refund 二选一，谁先满足条件谁执行），**没有"下一期状态"需要跨交易延续**，不同于 ShardLeaf（多期下注）/PayoutShard（多次领取，UTXO 持续存在）。形状上最接近 `KanetTokenClaim.sil`（ctor 烤收款人+金额、单入口终态花费），只是把 1 收款人扩到最多 3 个 + 加一个超时分支。
- **好处**（§4 会给出数值）：资金进入是**普通付款**（任何钱包发送到一个 P2SH 地址，不需要发送方调用任何 covenant JS API），资金 UTXO 的 `covenant_id` 为 `None` ⇒ `has_covenant_id=false` ⇒ `plurality=1`（而非 bshard 那类真 covenant UTXO 的 `p=2`）——**存储质量直接减半**，这对"小额份额"这条验收至关重要。
- **待定·默认值**：若 silverc v1.0.0 编译器要求任何带 ctor 参数+`require()`逻辑的合约必须声明为 `covenant`（哪怕不用 State/续约），默认退路 = 声明为 covenant 但不调用 `validateOutputState`/不设 State 字段、genesis 时也不调用 `populateGenesisCovenants`（即：资金进入仍是普通付款，只是脚本声明形式带 covenant 关键字）——**不改变本节其余所有设计与 §4 数值结论**，因为 mass 计算只看 `covenant_id.is_some()`（真正绑定过 id 与否），不看脚本源码里有没有 `covenant` 关键字。此项在 J2 实现阶段第一步用真实编译器确认，不阻塞本设计稿。

### 2.2 ctor 参数

```
ctor(
  merchant_spk:     byte[37],   // P2SH scriptPubKey，收款人 1（商家），必填
  merchant_amount:  int,        // sompi，必填，> MIN_RECIPIENT_SOMPI（见 §4）
  broker_spk:       byte[37],   // 收款人 2（broker），必填
  broker_amount:    int,
  has_referrer:     bool,       // 是否有第三收款人
  referrer_spk:     byte[37],   // has_referrer=false 时此值不参与任何 require()，仍烤入地址（占位）
  referrer_amount:  int,
  payer_refund_spk: byte[37],   // 退款去向（付款人自己的地址）
  deadline_ms:      int,        // temporal() 墙钟阈值，毫秒 unix；须 >= LOCK_TIME_THRESHOLD(500_000_000_000)
  max_refund_fee:   int,        // sompi，退款交易允许的最大手续费上限（见 §2.4 默认值）
  rule_commit:      byte[32],   // = computeFeeRulesCommit(canonical_rules)，纯审计用途，见 §2.6
  order_nonce:      byte[16],   // 随机盐，防止参数完全相同的两笔订单撞地址（见 §2.6）
)
```

**为什么是"3 个具名槽位"而不是"N 个循环"**：Bettor 收敛指令明确"参与者固定三类，不做多级推广"——SilverScript 的 `for(i,start,end,MAX)`（TUTORIAL.md:569-614，start/end 可为运行时值、第4参必须编译期常量）完全支持把本设计泛化为"最多 N 个"的循环校验（PayoutShard 的 `scanOwnedTokenInputs` 已经是这个模式的实证，`MAX_INS_SCAN=8`），**但本轮范围明确排除多级推广/长尾**，具名槽位更简单、审计面更小，符合"不做超出范围的事"。若未来要扩展到"最多 N 个收款人"，复用同一 `for` 原语，不是另起设计。

### 2.3 入口 `split`（任何人可触发，零签名）

```
entry split() {
  if (has_referrer) {
    require(tx.outputs.length == 3);
    require(tx.outputs[2].value == referrer_amount);
    require(tx.outputs[2].scriptPubKey == referrer_spk);
  } else {
    require(tx.outputs.length == 2);
  }
  require(tx.outputs[0].value == merchant_amount);
  require(tx.outputs[0].scriptPubKey == merchant_spk);
  require(tx.outputs[1].value == broker_amount);
  require(tx.outputs[1].scriptPubKey == broker_spk);
}
```

**逐条 require 与 verify-value-source**：

| require | 左值来源 | 右值来源 |
|---|---|---|
| `tx.outputs.length == 2/3` | **链**：本交易真实输出数（consensus 层已验证的交易结构，非 witness 猜测） | ctor 烤死常量（`has_referrer` 决定分支，genesis 时已固定，spender 无法在花费时选择） |
| `tx.outputs[i].value == X_amount` | **链**：本交易第 i 个输出的真实金额（consensus 验证过 Σout≤Σin） | ctor 烤死常量 |
| `tx.outputs[i].scriptPubKey == X_spk` | **链**：本交易第 i 个输出的真实脚本（决定谁能花它） | ctor 烤死常量 |

**没有任何一条 require 的"应该是什么值"来自 witness（花费者提供的可选数据）**——这是刻意的：D-019 状态注记记录的 KTT `want` 自指重言式漏洞（`want = next_states[j].owner` 由花费者自填 ⇒ 检查自己检查自己）在本设计里结构性不可能发生，因为分账金额与收款地址**全部是 ctor 常量，从 genesis 那一刻起就不可变，触发者（花费者）没有任何字段可以自己填**。

**手续费**：不显式检查。`tx.outputs.length==N` 这条锁死了"能有多少个输出"，加上每个输出金额都是烤死常量 ⇒ `资金 UTXO 金额 − Σ(N 个烤死金额)` 只有两个去处：要么变成矿工费（无法被任何一方截留，因为没有多余的输出槽位可以写），要么——如果资金不足以覆盖 Σ烤死金额——**这笔 `split` 交易根本无法构造**（`Σoutputs > Σinputs` 在 kaspad 基础校验层就被拒，连脚本都不会执行到）。这就是"少付"与"多付"两种对抗情形的天然处置（§5 逐条测试）。

### 2.4 入口 `refund`（deadline 后任何人可触发，零签名）

```
entry refund() {
  require(tx.time >= temporal(deadline_ms));
  require(tx.outputs.length == 1);
  require(tx.outputs[0].scriptPubKey == payer_refund_spk);
  require(tx.outputs[0].value >= tx.inputs[activeInputIndex].value - max_refund_fee);
}
```

**verify-value-source**：`tx.time`——链（consensus 对区块时间戳的验证规则）；`temporal(deadline_ms)`——ctor 常量，照抄 `RootClose.sil:166` 的 `deadline_ms + 7200000` 精确模式（本设计的宽限直接烤进 `deadline_ms` 本身，由调用方在构造订单时把宽限算进去，不在合约里再加一次常量偏移，避免"哪个宽限是哪个"的歧义）；`tx.inputs[activeInputIndex].value`——链（本交易花费的那个输入的真实金额，来自被引用的 UTXO,对称于输出侧的 `tx.outputs[i].value` 内省原语）。

`refund` 把**资金 UTXO 里实际有多少钱**（不是订单声明的 `order_total`）原样退回付款人（减一个有上限的手续费），天然处理"实付≠应付"——不管当初是少付还是多付，超时后付款人拿回的是**链上真实余额**，不是一个可能对不上的账面数字。

**待定·默认值**：`max_refund_fee` 具体数值——默认 **200,000 sompi**（0.002 KAS）。依据：最低中继费 100 sompi/克（memory `reference-kaspa-v201-min-relay-fee-100-sompi-per-gram...`，主网 `getFeeEstimate` 空 mempool 全档实测），单入单出交易的 compute mass 量级在几百到几千克之间（`tx-mass-ub.mjs` 可精确估），200,000 sompi 留出充分余量；实现阶段用 `kasia-relay/src/lib/tx-mass-ub.mjs`（NWT 已 GREEN 的纯 JS mass 复算器，见 D-014——**不用 kaspa-wasm 的 mass 计算，那条路径在 TN12 上已知会 panic 被吞掉**）精确核对后可下调。

### 2.5 为什么"重复触发"天然不可能

UTXO 模型本身提供防重放：`split` 或 `refund` 二者之一花掉资金 UTXO 后，这个 outpoint 就不存在了，第二次尝试花同一个 outpoint 是双花，被共识直接拒绝——**不需要 PayoutShard 那种 17×63-bit nullifier 位图**（那是因为 PayoutShard 的 UTXO 在每次部分领取后仍然存在、要防止同一个人再次领取，本设计是一次性终结，没有"部分领取"这个概念）。

### 2.6 rule_commit 与 order_nonce 的定位（回答"先承诺后揭示"是否适用）

`rule_commit` **不参与任何 `require()`**——它纯粹是烤入地址的审计字段：第三方拿到"canonical rules JSON"（角色/bps）与 `order_total`，可以自己跑 `feeSplit` 算出三笔金额、`computeFeeRulesCommit` 算出这个哈希、用同一份 silverc 编译整个 ctor，得到与链上完全一致的地址——这条链路本身就是完整验证，`rule_commit` 只是省得第三方还要反查"这些数字是不是真的从某份规则算出来的"。

**D-025 §6 的盐+提交方绑定为什么本设计不需要**：那一条防的是"先在链上贴一个哈希、后面才揭示真实条款"场景下的抢先揭示攻击。本设计**没有揭示步骤**——全部参数（收款人、金额、截止时间）从 genesis 那一刻起就是公开的、烤进地址的，不存在"别人抢先用你的哈希发布不同条款"这个攻击面（哈希是审计辅助，不是访问控制）。`order_nonce`（16 字节随机盐)的作用不同：纯粹防止两笔"收款人/金额/截止时间完全相同"的订单（业务上确实可能发生，比如两笔相同金额相同分成比例的订单前后相邻）意外撞到同一个地址——**这不是安全问题（撞地址不会导致资金被错误分配，因为分账规则也相同），是簿记问题**，加个随机盐让地址与订单一一对应，方便离线索引。

---

## ③ 地址可推导 + 自证回执

### 3.1 地址推导（D-025 第二条硬不变量）

```
address = f(ctor 参数元组, silverc_pin)
        = ScriptPubKeyP2SHFromRedeemScript(compile(instant_split.sil, ctor参数, silverc_v100_pin)).toAddress(network)
```

给定公开参数表（§7 JSON schema）与 `silverc v1.0.0`（源 commit `3ed973335b59269293564805cc2c58a14595ec03`，D-019 单源 pin），**任何第三方**在自己机器上跑同一份开源合约 + 同一个 pin 住的编译器，不问我们，就能算出与我们完全一致的地址——这是 SilverScript 的既有能力（`ScriptPubKeyP2SHFromRedeemScript`，TUTORIAL.md:1173-1205），不是新发明。

**没有任何原语能在链上直接算出 bech32 地址字符串**（fork 调查确认：合约只构造/比较原始 `scriptPubKey` 字节，可读地址永远是链下从同一份 redeem-script-hash 派生）——这与现有 ShardLeaf/PayoutShard 的 genesis 派生流程完全一致，不是限制,是既有惯例。

### 3.2 自证回执

我们（或任何第三方）的 API 响应格式（对应任务要求"txid + 输出 + 规则原文/盐"）：

```json
{
  "order_address": "kaspa:...",
  "ctor_params": { /* 见 §7 JSON schema，逐字段 */ },
  "canonical_rules": { /* fee-split 规则原文，喂 feeSplit 可复算出 ctor 里的三笔金额 */ },
  "order_nonce": "hex16",
  "funding_txid": "hex64 | null（未付款）",
  "split_txid":   "hex64 | null（未分账）",
  "refund_txid":  "hex64 | null（未退款）"
}
```

**验证方法**（不依赖我们的 DB/授权，只需一个 Kaspa 节点 RPC）：
1. 用 `canonical_rules` + `order_total`（若不在 JSON 中显式给出,可由 `merchant_amount+broker_amount+referrer_amount` 反推）跑 `feeSplit`，核对三笔金额与 `ctor_params` 里的一致。
2. 用 `ctor_params` 编译，核对算出的地址与 `order_address` 一致（§3.1）。
3. 用任意 Kaspa 节点的 `getUtxosByAddresses`/`getTransaction` RPC（官方 wRPC，不需要索引器，不需要我们的节点——D-025 第三条"验证接口写明"已满足：任何 kaspad 节点的标准 RPC 即可，不依赖 `api.kaspa.org` 这类不返回 covenant 字段的第三方网关）查 `order_address` 的交易历史，核对 `funding_txid`/`split_txid`/`refund_txid` 三者中"发生的那个"其输出确实与 §2.3/§2.4 的形状一致。

三步做完 = D-025"自证回执"验收判据（"对方拿任意 Kaspa 节点一次查询可复核"）逐字满足。

---

## ④ 小额约束（KIP-9 storage mass，具体数值推导）

### 4.1 本设计场景下公式的化简

所有交易（`split` 与 `refund`）都**恰好 1 个输入**（花费订单的资金 UTXO）。设该输入 plurality 为 `p_in`：

- 若资金 UTXO 是普通 P2SH（§2.1 判断，`covenant_id=None`）：`p_in = ceil((63+37+0)/100) = ceil(100/100) = 1`（P2SH scriptPubKey 固定 37 字节，`ScriptPubKeyP2SH` 返回类型）。
- 若实现阶段被迫声明为 covenant 但仍不绑定 id（§2.1 退路默认值）：同样 `p_in=1`（mass 公式只认 `covenant_id.is_some()`，不认脚本源码关键字）。
- 若某种原因确实绑定了 covenant_id：`p_in = ceil((63+37+32)/100) = ceil(132/100) = 2`。

**对恰好 1 个输入，`calc_storage_mass` 的两条分支（relaxed / general）代数上重合**（`mod.rs:478-512`：general 分支 `arithmetic_ins = ins_plurality·(C/mean_ins)`，单输入时 `mean_ins = amount_in/ins_plurality`，代入化简后与 relaxed 分支的 `C·p_in²/amount_in` 完全相等）——**因此输入侧贡献恒为 `C·p_in²/amount_in`，与到底走哪条分支无关**，这条对本设计是一个干净的简化：

```
storage_mass = max(0, C·Σ_{i=1}^{N} (1/amount_i) − C·p_in²/amount_in)
```

其中 `C=10¹²`，`N∈{2,3}`（是否有引荐人），`amount_i` 为各收款人烤死金额（每个输出 p=1，标准地址），`amount_in≈Σamount_i`（近似，因为手续费很小）。

### 4.2 具体数值：单笔小额输出何时单独压垮限额

$500,000$ 是**storage/compute/transient 三维共享的硬上限**（`params.rs:698` 等，`BlockMassLimits::with_shared_limit(500_000)`——本设计验证过这确实是我们主网 500k 上限传闻的真实出处）。

**单个输出项 `C/amount_i` 何时单独等于硬上限**：
```
C/amount_i = 500,000  ⟺  amount_i = C/500,000 = 10¹²/5×10⁵ = 2,000,000 sompi = 0.02 KAS
```
**任何收款人的份额低于 0.02 KAS，光是那一个输出项就能让整笔 `split` 交易的 storage mass 超过网络硬上限——不是"不划算"，是共识层直接拒绝广播，交易根本无法上链。**

### 4.3 运营安全线（含其余输出项与 compute mass 的余量）

一笔 3 输出的 `split` 交易，若把 500,000 预算平摊考虑安全边际（参照 D-025 §3 既有先例——bshard 续约交易实测线定在 475,000，即硬上限的 95%），单项预算建议控制在 ≤150,000（留给另外 2 项 + compute mass 维度）：

```
amount_i > C/150,000 = 10¹²/1.5×10⁵ ≈ 6,666,667 sompi ≈ 0.0667 KAS
```

**取整为运营下限：MIN_RECIPIENT_SOMPI = 10,000,000 sompi = 0.1 KAS**——比共识硬阈值（0.02 KAS）高 5 倍安全边际,与现有工具链的量级基本吻合（p2sh.mjs 已有的 `MIN_OUTPUT_DUST_SOMPI=1000` 是 Kaspa 通用防尘阈值,对本设计**远远不够**——1000 sompi 代入 `C/1000=10⁹`，单项直接超硬上限 2000 倍；本设计需要一个**远高于通用 dust 阈值、专属本合约**的下限,这条必须在设计稿里明写,不能沿用通用 dust 常量)。

**具体工作示例**（10 KAS 订单，80/15/5 分成）：
```
merchant=8×10⁸, broker=1.5×10⁸, referrer=5×10⁷ sompi
harmonic_outs = C·(1/8e8 + 1/1.5e8 + 1/5e7) = 10¹²·2.79×10⁻⁸ ≈ 27,917
harmonic_ins  ≈ C/10⁹ = 1,000
storage_mass  ≈ 26,917   ← 远低于 500,000，安全
```
**同一笔订单若引荐人份额压到 1%（0.1 KAS = 10⁷ sompi）**：该项单独贡献 `C/10⁷=100,000`——仍在 150,000 预算内但已吃掉大半；**若压到 0.01 KAS（10⁶ sompi）**：该项单独 `C/10⁶=1,000,000`——**单独超过硬上限一倍，交易不可能广播**。

### 4.4 合并/拒绝策略（离线，SDK 层，不在链上）

`MIN_RECIPIENT_SOMPI` 检查**不在合约里**（合约里的金额是 ctor 烤死常量，已经是终值，不需要再检查——检查应该发生在"决定烤什么值进去"之前）：

- **订单构造时**（SDK `createSplitProtocol`，见 §7）：跑 `feeSplit` 算出三笔金额后，逐项核对 `≥ MIN_RECIPIENT_SOMPI`。
- 引荐人份额 < 下限 ⇒ **默认策略：并入 broker**（`has_referrer=false`，`broker_amount += referrer_share`）——类比 `feeSplit` 自身"无地址的 optional 角色整条跳过"的既有语义,不是新发明的行为。
- 商家或 broker 份额 < 下限（正常订单金额下几乎不会发生，但极小额订单可能触发）⇒ **拒绝构造该订单**，SDK 返回错误，不生成地址——这是"运营层面拒绝",不是"共识层拒绝",两者都要在文档里说清区别（§4.2 是硬拒绝，这一条是软拒绝/策略选择）。

---

## ⑤ 对抗测试清单（simnet 真共识，任务钦定五项 + 补充）

全部在**隔离 simnet**（真实 kaspad 二进制、真实共识，非 cli-debugger 离线模拟——D-034 §5 明确要求"先在 simnet 真共识验证"）执行，每项给出**期望结果 = 广播被拒绝或被接受，二选一，不接受"看起来应该"**：

| # | 攻击/场景 | 构造方式 | 期望结果 | 对应 require |
|---|---|---|---|---|
| 1 | 篡改收款地址 | `split` 交易 `outputs[0].scriptPubKey` 换成攻击者地址,其余不变 | **拒绝**（脚本执行阶段 require 失败） | `tx.outputs[0].scriptPubKey==merchant_spk` |
| 2 | 篡改比例 | `outputs[0].value` 改大 1 sompi,`outputs[1].value` 改小 1 sompi（保持 Σ不变,企图"内部转移"） | **拒绝**（两条 require 都会各自失败,不存在"总额对就行"的漏洞——每个输出独立核对) | `tx.outputs[i].value==X_amount`（逐项） |
| 3 | 少付 | 资金 UTXO 金额 < Σ 三笔烤死金额,尝试广播 `split` | **拒绝，在 kaspad 基础校验层（Σout>Σin），脚本甚至不会被执行** | N/A（consensus 原生规则,非本合约 require） |
| 4 | 多付 + 不加输出槽 | 资金 UTXO 金额 > Σ 三笔烤死金额,`split` 按 N 个输出正常构造 | **接受，多付部分全部计入矿工费，任何一方都拿不到超额部分**（`tx.outputs.length==N` 锁死输出槽位数） | `tx.outputs.length==N` |
| 5 | 多付 + 加第 4 个输出想拿回超额 | 攻击者（触发者,不一定是付款人）构造 `split`,额外加一个第 4 输出把超额转给自己 | **拒绝**（`require(tx.outputs.length==N)` 直接失败） | `tx.outputs.length==N` |
| 6 | 重复触发 | 资金 UTXO 已被 `split`（或 `refund`）花费后,再广播另一笔尝试花同一个 outpoint | **拒绝，双花，kaspad mempool/共识原生拒绝** | UTXO 模型本身 |
| 7 | 部分输出 | `split` 只给 2 个输出但 `has_referrer=true`（本该 3 个） | **拒绝**（`require(tx.outputs.length==3)` 失败） | `tx.outputs.length==N` |
| 8 | 换序 | `outputs[0]`=broker 的地址/金额，`outputs[1]`=merchant 的 | **拒绝**（固定索引比对,`outputs[0]` 必须严格等于 `merchant_spk/amount`) | 逐项 `tx.outputs[i]==X`（按索引,非按内容搜索） |
| 9 | 伪造规则承诺 | 攻击者自己编一份不同的 `canonical_rules`,声称 `rule_commit` 对应它,尝试让第三方相信这是"真"订单 | **不产生共识层拒绝（因为 `rule_commit` 不参与 require）,但 §3.2 步骤 1 的独立复算会立刻发现 `feeSplit(伪造规则)` 算出的金额与链上 ctor 烤死金额不符** ⇒ **测试目标是验证"审计流程能识破",不是"合约会拒绝"（合约本来就不检查 rule_commit,这是设计,不是漏洞——见 §2.6）** | N/A（业务/审计层测试,非合约测试） |
| 10 | 服务离线后仍可退款 | 停掉本机全部 KANet 进程（console/relay/所有 agent）,仅用一个独立脚本 + 公开 RPC + 公开 ctor 参数,在 `deadline_ms` 后构造并广播 `refund` | **接受**——这是 D-034 §7 验收②的直接实证,必须真的关掉进程做,不能只是"理论上可以" | `tx.time>=temporal(deadline_ms)` |
| 11 | 服务离线后仍可分账 | 同上,但用另一独立脚本在 deadline 前构造并广播 `split`（资金已足额到位） | **接受** | 同 §2.3 全部 require |
| 12 | 超时前抢先退款 | deadline 前构造 `refund` 交易并广播 | **拒绝** | `tx.time>=temporal(deadline_ms)` |
| 13 | 小额份额（在硬阈值以下） | 引荐人份额烤为 1,000,000 sompi（§4.3 推导：应超硬上限）,尝试广播 `split` | **拒绝，storage mass 超过 500,000 网络硬上限,kaspad 拒绝接受该交易（不是脚本 require 失败,是 mass 校验失败——两种拒绝机制要在报告里分清）** | N/A（KIP-9 storage mass 原生规则） |
| 14 | 小额份额（在运营安全线与硬阈值之间） | 引荐人份额烤为 5,000,000 sompi（§4.3：低于 MIN_RECIPIENT_SOMPI=10,000,000 但高于硬阈值 2,000,000） | **可以广播成功（不违反共识）,但测试要确认 SDK 层在订单构造阶段本该拦截它（§4.4 策略),即"合约允许但我们的工具不应该产生这种订单"** | N/A（策略测试,非合约测试） |
| 15 | 退款手续费上限滥用 | `refund` 触发者故意把 `tx.outputs[0].value` 压到 `tx.inputs[0].value - max_refund_fee`（贴着下限,把差额全部变成矿工费,类似小额抢跑激励攻击） | **接受（这是设计允许的范围内行为，触发者对"给自己留多少手续费空间"有一定自由度,但不能低于这条线）；追加一项验证 `tx.outputs[0].value` 不可能被压到低于这条线之下** | `tx.outputs[0].value>=input.value-max_refund_fee` |

**证据要求**（同本仓一贯纪律）：每项给出 txid + kaspad 真实接受/拒绝回执（`submitTransaction` 的响应或 mempool 拒绝原文），不接受 cli-debugger 单独作为结论依据（D-019 状态注记的教训：cli-debugger 缺真实签名验证引擎，只能证明"到达某行"，不能证明"共识会接受"）。

---

## ⑥ 不做（本轮明确排除）

- 条件分账（D-034 §4 模板 B：锁定 → 事实/证明 → 分账，需要外部 Oracle/挑战窗）——D-034 §4 明确"先做 A"，B 是后续独立设计。
- SDK 的完整实现（本稿只给接口草案，§7）。
- 配置页/前端组件实现（本稿只给范围说明,§7）。
- 主网部署——本稿交付后走 NWT 攻击面审 → J2 实现 + simnet → NWT diff 审 → 合入（Owner 常设授权）→ **部署另批**（D-034 §5 流程原文）。
- 多级推广、长尾金库、ZK 批量结算、任何新代币——D-034 §7 收敛稿逐字排除。
- 非 KAS 支付（USDT 等）——Phase②，依赖 exchange 组件（§1.1 已评估：evm-transfer.js/cross-chain-verify.mjs 可直接复用，但作为独立的、显式标注信任边界的 Maker，不进本 covenant）。

---

## ⑦ 接入层第一版：SDK 接口草案 + JSON 配置 schema + 最小网页组件范围说明

> 本节只写接口签名与 schema，不实现。D-034 §2 接入层定位"SDK+标准 JSON 配置+配置页"，Owner 收敛稿要求第一版就给这三样的**范围**。

### 7.1 JSON 配置 schema（订单公开参数，= §3.1 地址推导的输入 = §3.2 自证回执的一部分）

```json
{
  "schema_v": 1,
  "network": "mainnet | testnet-12",
  "silverc_pin": "3ed973335b59269293564805cc2c58a14595ec03",
  "order_total_sompi": "1000000000",
  "canonical_rules": { "schema_v": 1, "roles": [
    { "name": "broker",   "bps": 1500, "address": "hex64pk" },
    { "name": "provider", "bps": 8000, "address": "hex64pk" },
    { "name": "referrer", "bps": 500,  "address": "hex64pk", "optional": true }
  ]},
  "recipients": {
    "merchant_spk_hex": "...", "merchant_amount_sompi": "800000000",
    "broker_spk_hex":   "...", "broker_amount_sompi":   "150000000",
    "has_referrer": true,
    "referrer_spk_hex": "...", "referrer_amount_sompi": "50000000"
  },
  "payer_refund_spk_hex": "...",
  "deadline_ms": 1790000000000,
  "max_refund_fee_sompi": "200000",
  "rule_commit_hex": "64位hex，= computeFeeRulesCommit(canonical_rules)",
  "order_nonce_hex": "32位hex（16字节）"
}
```

字段与 §2.2 ctor 参数一一对应；`canonical_rules` 字段是审计冗余（喂 `feeSplit` 可独立复算 `recipients` 里的三笔金额，验证二者一致——见 §3.2）。

### 7.2 SDK 接口草案

```
createSplitProtocol(config: OrderConfig): { ctorParams, redeemScriptHex, address }
  // 纯函数，本地编译（调用 pin 住的 silverc），不发网络请求。
  // 内部执行 §4.4 的 MIN_RECIPIENT_SOMPI 合并/拒绝策略。

computeOrderAddress(config: OrderConfig): string
  // createSplitProtocol 的地址子集，供第三方"我不需要完整编译产物，只要算个地址核对"场景。

buildSplitTx(config: OrderConfig, fundingUtxo: UtxoRef): UnsignedTransaction
  // 组装 split 交易（§2.3 形状）。无需私钥——split 入口零签名。
  // 若 fundingUtxo.amount < Σ烤死金额，本函数本地即报错（不等广播失败才知道，见对抗测试#3 的早失败版本）。

buildRefundTx(config: OrderConfig, fundingUtxo: UtxoRef, nowMs: number): UnsignedTransaction
  // 组装 refund 交易（§2.4 形状）。无需私钥。nowMs < deadline_ms 时本地报错（早失败，对应测试#12）。

verifyReceipt(receipt: { txid, config }, rpc: KaspaRpcClient): Promise<VerifyResult>
  // §3.2 验证流程的完整实现：本地复算 feeSplit → 复算地址 → 查 rpc.getTransaction(txid) →
  // 核对输出形状与 config 一致。只需标准 kaspad wRPC（getTransaction/getUtxosByAddresses），
  // 不需要索引器，不需要我们的服务器。
```

### 7.3 最小网页组件范围说明（不实现，只定范围）

一个"创建分账协议"页面需要：① 输入订单总额 + 三方地址/比例（或直接粘贴 `canonical_rules` JSON）② 本地调 `createSplitProtocol` 出地址与二维码 ③ 展示"付款到这个地址、截止时间是几号、超时后可退款"④ 一个"核验"标签页，粘贴任意 txid，调 `verifyReceipt` 显示结果。**全部逻辑跑在浏览器本地/调用公开 RPC，不需要登录、不需要我们的后端**——这是 D-034 §7 验收③"不依赖我们的 DB 或管理员授权"在 UI 层的体现，本轮不实现，留给"配置页"步骤。

---

## 附：D-025 五条 + 两条补充，逐条对照

| D-025 条款 | 本设计满足方式 |
|---|---|
| 现值即真相 | 唯一状态是"资金 UTXO 存在与否"——存在=待处理，被 split 花掉=已分账，被 refund 花掉=已退款。三态只需查当前 UTXO 集合一次，不靠回放历史。 |
| 地址可推导 | §3.1，逐字满足。 |
| 自证回执 | §3.2，逐字满足。 |
| 一步一花 | 天然满足——本设计没有"多期"概念，一次 split 或 refund 即终结，UTXO 模型本身保证不可重复领取（§2.5）。 |
| 退出写进脚本 | `refund` 入口即退出脚本，超时任何人可触发，零人工按钮（§2.4）。 |
| 状态要装得下（Bettor 补1） | 本设计无 State 字段（§2.1），ctor 参数总量远小于任何 mass 限制，不存在"state 撑大"风险。 |
| 最小信任层要隔离（Bettor 补2） | 本设计**没有外部事实源**（"即时"分账不等 Oracle）——这条不适用于模板 A，适用于 D-034 §4 的模板 B（条件分账），留给后续设计。 |
| 承诺绑定提交人（2026-09-26 补1） | §2.6 已说明：本设计无"先承诺后揭示"步骤，此条不适用，非遗漏。 |
| attest 加挑战窗（2026-09-26 补2） | 同上，本设计无 attest/委员会介入，模板 B 才需要。 |

---

## 待定 + 默认值 汇总（供 Owner/NWT 拍板，不阻塞本稿交付）

1. **合约是否声明为 covenant 关键字**——默认：能不用就不用（§2.1），退路已给出且不改变任何数值结论。
2. **引荐人份额过低时的处置**——默认：并入 broker（§4.4）。
3. **max_refund_fee 具体值**——默认：200,000 sompi，实现阶段用 `tx-mass-ub.mjs` 精确核对可下调（§2.4）。
4. **MIN_RECIPIENT_SOMPI 运营下限**——默认：10,000,000 sompi = 0.1 KAS（硬阈值 5 倍安全边际，§4.3）。
5. **deadline 时钟选型**——默认：`temporal()` 墙钟（照抄 RootClose 先例），非 DAA-score（§2.4）。
6. **order_nonce 是否必要**——默认：需要，防止相同参数订单撞地址的簿记问题（§2.6），非安全必需但强烈建议。
7. **rule_commit 是否烤入 ctor**——默认：烤入但不参与任何 require（纯审计冗余，§2.6）。
