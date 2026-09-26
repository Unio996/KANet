# Kaspa 即时分账结算模板 · Covenant 设计 v0.2

> **Status**: DRAFT · 待 NWT 攻击面审第二轮（最后一轮）
> **作者**: J2 · **派工**: Bettor（转述 Owner，D-034 + D-034 §7 收敛方案，账本 1693）
> **上一版**: `docs/2026-09-27-j2-instant-split-covenant-template-design-v0.1.md`（NWT 攻击面审：j1-inbox `2026-09-26T18-59Z-nwt-VERDICT-j2-instant-split-covenant-design-v0.1-attack-review.md`，MUST×3）
> **范围**: 只交设计稿，不写生产代码；不做部署。

---

## v0.2 变更记录（每条 MUST/SHOULD 的改法与位置）

| # | 类型 | NWT/Bettor 原话要点 | 改法 | 位置 |
|---|---|---|---|---|
| MUST-1 | NWT | `split` 手续费来源未定义，精确付款时 fee=0 必被 mempool 拒 | 新增 `hasChange: bool` witness 参数 + ctor 常量 `max_split_fee`；充值口径改为 `order_total = Σ收款人 + max_split_fee`，精确充值走 `hasChange=false`（余额并入矿工费但被 `max_split_fee` 上限约束），多付走 `hasChange=true`（超额显式找零回付款人）。二选一里选了"写死充值口径"这条，**不采**"触发者垫付独立签名输入"（原因：与 Bettor 追加的 `tx.inputs.length==1` 硬约束直接冲突,后者优先级更高） | §2.3（entry split 全文重写）、§2.2（ctor 新增 `max_split_fee`）、§4.4、§7.1/§7.2 |
| MUST-2 | NWT | `max_refund_fee` 烤死绝对值,算低则该订单永久打不出退款 | 明确"这是待实现阶段用 `tx-mass-ub.mjs` 对真实编译产物实测的强制前置步骤,不是可以随手填的默认值";给出推导方法六步 + 一个**明确标注 PLACEHOLDER、禁止直接部署**的量级估算;评估并**否决**了改百分比上限的提案(mass 费用结构性与金额无关,百分比上限对小额订单复现同一失败模式,对大额订单只是多余,无对应安全收益) | §2.4、§4.5（新增小节，含否决百分比方案的推理） |
| MUST-3 | NWT | 验收③缺真正独立测试 | 新增对抗测试 #16："零 import 本仓内部模块"的完全独立第三方实现测试；#10/#11 补标"禁止 import 内部 helper" | §5（表格新增 #16，#10/#11 备注列更新） |
| 追加 | Bettor | 同地址多笔付款/重复付款可被组合进 1 笔 split，一笔正常付、另一笔烧成矿工费——资金销毁攻击 | `split` 与 `refund` 均新增 `require(tx.inputs.length==1)`；`order_nonce` 从"建议"升级为**强制必填、SDK 生成时必须真随机**；多付超额规则统一进 MUST-1 的 `hasChange` 机制（超额回付款人,不给触发者/矿工留口子） | §2.3、§2.4、§2.6、新增对抗测试 #17 |
| SHOULD | Bettor | 正文写明"split 全程可触发、时间优势在收款方" | 加一段说明 | §2.3 末尾 |
| MUST-新1 | NWT 第二轮 | `hasChange` 两分支未按"真实超额"互斥穷尽（`hasChange=false` 时只上界约束、没下界约束超额必须真的 ≤ 上限而不能是"随便选的";两分支理论上可能对同一笔真实超额都声称合法) | `hasChange=true` 分支追加 `require(input.value - recipientsTotal > max_split_fee)`——与 `hasChange=false` 分支的 `<= max_split_fee` 互斥穷尽,任一真实超额只有唯一合法分支 | §2.3（entry split，实现中直接落码，见 §2.3 更新） |
| 更正 | Bettor 转 NWT 口头补充 | ①"mass 只取决于字节形状、与金额无关"与本设计自己的公式矛盾；②手续费上限烤成不可变常量的结构性残余风险要显式写出+给 deadline 默认值建议 | ①改写为"运营下限之上,storage mass 需求有已知可测上界"（compute mass 才是真正与金额无关);②新增 §4.6,残余风险说明 + SDK 默认 deadline=72 小时 + 超长 deadline 告警 | §4.5（百分比否决段落改写）、新增 §4.6 |

以下正文按 v0.1 结构原样保留未受影响的部分（§0/§1/§3/§6），受影响部分整段重写（§2.2–§2.6、§4.4–§4.5、§5、§7），并同步了 §附（D-025 对照）与"待定汇总"。

---

## 0. 一句话目标 + 验收标准（不变，照抄 v0.1）

**一句话目标**：任何人都能在 Kaspa 上创建一份分润协议，任何参与者都无法单方面改变它，任何人都能独立验证并执行它。

**范围铁律**：参与者固定三类（商家/broker/引荐人，引荐人可选）；仅 KAS，不引入新代币，不做多级推广/长尾金库/ZK 批量；链上强制分账（covenant 约束输出），不是钱包自愿按计算结果付款；"即时"只指不等外部 Oracle，允许两笔交易（付款锁定 → 分账）。

**三条验收**：① 规则不可篡改（共识层拒绝，非业务代码拒绝）；② 资金出口自主（broker/KANet 全离线，任一参与者仍能独立构造合法交易）；③ 第三方独立部署（只凭开源组件+公开 JSON 即可建协议/分账/核验，不依赖我们的 DB/授权——**本版新增可执行验证，见 §5 #16**）。

---

## ① 查现成（不变，照抄 v0.1，此处不重复；完整内容见 v0.1 §1，结论未受本轮 MUST 影响）

本轮三条 MUST 与追加项全部是"设计层"修正（手续费口径、输入数量约束、地址碰撞防护），不改变"什么现成、什么不能用"的结论——v0.1 §1 的查现成结论原样有效，不重写。

---

## ② Covenant 规格（本节全部重写）

### 2.1 架构判断（不变，照抄 v0.1 §2.1）

不使用 covenant 的 State/genesis-continuation 机制；一次性终态纯 P2SH 脚本；资金进入是普通付款，`covenant_id=None`；"待定·默认值"条款照抄 v0.1，未受本轮 MUST 影响。

### 2.2 ctor 参数（新增 2 个字段，1 个字段升级为强制）

```
ctor(
  merchant_spk:     byte[37],
  merchant_amount:  int,
  broker_spk:       byte[37],
  broker_amount:    int,
  has_referrer:     bool,
  referrer_spk:     byte[37],
  referrer_amount:  int,
  payer_refund_spk: byte[37],
  deadline_ms:      int,
  max_split_fee:    int,       // 🆕 MUST-1：split 分支手续费/找零判定的唯一上限常量
  max_refund_fee:   int,       // 不变（v0.1 已有），MUST-2 要求其数值必须来自实测，见 §4.5
  rule_commit:      byte[32],  // 不变，纯审计冗余
  order_nonce:      byte[16],  // 🔴 升级：v0.1 是"建议默认值"，本版是【强制必填、SDK 侧必须真随机生成，不接受调用方传入固定值】
)
```

**`order_nonce` 为什么从"建议"升级为"强制"（追加项，NWT SHOULD-2）**：v0.1 把它定位成"防止参数完全相同的两笔订单意外撞地址"的簿记便利。Bettor 追加的攻击场景证明这不只是簿记问题——**如果两笔不同订单（或同一订单的两次充值）落在同一个地址，任何人都能把两个资金 UTXO 的其中一个通过 `split` 正常兑付、另一个因为找不到输出槽位而被结构性烧成矿工费（销毁攻击，任何人可发起，无需任何权限）**。`order_nonce` 真随机 ⇒ 两笔逻辑上独立的订单在地址层面永不重合，从根源上让"同地址多笔资金"只可能发生在"同一笔订单被同一个人手误重复充值"这种罕见场景（且此时它不是攻击,是 UX 问题——SDK 必须在展示收款地址时明确提示"只付一次",见 §2.6）。但 `order_nonce` 只降低同地址多笔发生的概率，不能让"万一发生了"变安全——真正堵住销毁攻击的是下面的 `tx.inputs.length==1` 硬约束（结构上不可能被绕开，不依赖概率）。

### 2.3 入口 `split`（重写：`tx.inputs.length==1` + `hasChange` 二分支手续费/找零机制）

```
entry split(hasChange: bool) {
  require(tx.inputs.length == 1);                    // 🆕 追加项：防"同地址多笔资金合并销毁"攻击

  require(tx.outputs[0].value == merchant_amount);
  require(tx.outputs[0].scriptPubKey == merchant_spk);
  require(tx.outputs[1].value == broker_amount);
  require(tx.outputs[1].scriptPubKey == broker_spk);

  // baseCount / recipientsTotal 为编译期可推导的常量组合（has_referrer 是 ctor 常量，非运行时变量）
  let baseCount        = has_referrer ? 3 : 2;
  let recipientsTotal  = has_referrer ? (merchant_amount + broker_amount + referrer_amount)
                                       : (merchant_amount + broker_amount);

  if (has_referrer) {
    require(tx.outputs[2].value == referrer_amount);
    require(tx.outputs[2].scriptPubKey == referrer_spk);
  }

  if (hasChange) {
    // 🆕 MUST-1 + 追加项："多付超额回付款人，不给触发者/矿工留口子"
    // 🆕 MUST-新1（NWT 第二轮）：下界锁死——只有真实超额确实 > max_split_fee 时才允许走这个分支，
    // 与下面 else 分支的 <= max_split_fee 互斥穷尽，堵住"两分支都可能对同一超额自称合法"的缝隙。
    require(tx.inputs[activeInputIndex].value - recipientsTotal > max_split_fee);
    require(tx.outputs.length == baseCount + 1);
    require(tx.outputs[baseCount].scriptPubKey == payer_refund_spk);
    require(tx.outputs[baseCount].value >= tx.inputs[activeInputIndex].value - recipientsTotal - max_split_fee);
  } else {
    // 🆕 MUST-1：精确充值路径——落差只能是"合理范围内的矿工费"，不能是任意大小的隐性损耗
    require(tx.outputs.length == baseCount);
    require(tx.inputs[activeInputIndex].value - recipientsTotal <= max_split_fee);
  }
}
```

**verify-value-source**（新增两行,其余照抄 v0.1）：`tx.inputs.length`——链（本交易真实输入数，consensus 已验证的交易结构）；`tx.inputs[activeInputIndex].value`——链（本合约自身正在被花费的那个输入的真实金额,内省原语,对称于输出侧）。`activeInputIndex` 在 `require(tx.inputs.length==1)` 生效后必然恒为 0（只有一个输入,不存在歧义)。`hasChange` 是花费者提供的 witness bool,**不影响任何验证的真实性**——它只选择走哪个分支,两个分支各自的每一条 require 仍然只比较"链上真实值 vs ctor 烤死常量",花费者无法通过选择分支伪造任何收款人的金额或地址。

**充值口径**（供 SDK/文档，非合约本身的检查项）：`order_total_to_fund = recipientsTotal + max_split_fee`——这是我们告诉付款人"应该转多少钱"的数字。精确按此充值 ⇒ `hasChange=false` 直接可用（落差全部作为矿工费,受 `max_split_fee` 上限约束,不会出现"落差超预期变成异常损耗"）。付款人多付（无论有意无意）⇒ 触发者**必须**用 `hasChange=true`（否则 `require(...<=max_split_fee)` 在超额场景下失败,交易无法广播）,超额部分整笔以显式找零输出退回 `payer_refund_spk`。

**为什么不选"触发者垫付独立签名输入"**（MUST-1 的第二个选项，本设计明确否决）：那个方案需要交易至少 2 个输入（订单 covenant 输入 + 触发者自己的签名输入付手续费），与 Bettor 追加要求的 `require(tx.inputs.length==1)`（防销毁攻击的唯一结构性手段）直接冲突——两条 MUST 放在一起看,只有"充值口径预留手续费缓冲"这一个选项能同时满足。

**SHOULD（Bettor 采纳）—— split 全程可触发,时间优势在收款方**：`split` 入口没有任何下界时间检查（不像 `refund` 有 `deadline_ms` 下界）——资金一落地，收款方（或代其行动的任何人）**立刻**可以构造并广播 `split`，抢在 `deadline_ms` 之前拿到自己的份额；付款人的退款选项只在超时**之后**才存在。这是设计的有意结果，不是疏漏：即时分账的"即时"字面意义就是"资金到位即可执行，不必等任何窗口期"，时间上天然对收款方有利（这也是为什么 §5 的服务离线测试 #10/#11 要分别验证——收款方离线也不影响别人替他们触发 split，因为触发本身零签名）。

### 2.4 入口 `refund`（重写：加 `tx.inputs.length==1`）

```
entry refund() {
  require(tx.inputs.length == 1);                                              // 🆕 追加项
  require(tx.time >= temporal(deadline_ms));
  require(tx.outputs.length == 1);
  require(tx.outputs[0].scriptPubKey == payer_refund_spk);
  require(tx.outputs[0].value >= tx.inputs[activeInputIndex].value - max_refund_fee);
}
```

同 §2.3 的理由：同地址若有多笔滞留资金，超时后必须**逐笔各自独立**发起 `refund`（每笔一笔交易），不能一笔交易吞两个输入把其中一笔烧掉。`max_refund_fee` 的数值来源见 §4.5（MUST-2）。

### 2.5 为什么"重复触发"天然不可能（不变，照抄 v0.1 §2.5）

### 2.6 rule_commit 与 order_nonce 的定位（更新：order_nonce 段落改写，rule_commit 段落不变）

`rule_commit` 段落不变，照抄 v0.1。

`order_nonce`：**本版是强制字段**（§2.2 已说明理由）。SDK `createSplitProtocol`（§7.2）在构造 ctor 参数时必须用密码学安全随机数生成器产出 16 字节，**不接受调用方显式传入固定值**（防止调用方图省事写死同一个 nonce,复现追加攻击场景）。地址展示页（§7.3）必须明示"本地址仅供本笔订单使用,请勿重复付款或将地址挪作他用"——`order_nonce` 降低撞地址概率,但同一订单被同一付款人手误充值两次仍可能发生,这属于 UX 层面必须提示、而非协议层面能彻底杜绝的场景;`tx.inputs.length==1` 约束保证这种场景下**不会被任何第三方恶意利用去销毁资金**,只是需要两笔各自独立的 `refund`/`split` 处理（§2.3/§2.4）。

---

## ③ 地址可推导 + 自证回执（不变，照抄 v0.1 §3；JSON schema 字段更新见 §7.1）

---

## ④ 小额约束（§4.1–§4.3 不变，新增 §4.4 找零场景的 mass 影响、§4.5 手续费上限的实测方法论）

### 4.1–4.3（不变，照抄 v0.1）

公式化简、硬阈值推导（0.02 KAS/输出）、运营安全线（0.1 KAS）全部照抄 v0.1，未受本轮 MUST 影响——这些数值只依赖"单个 p=1 输出的金额"，与是否存在找零输出无关（找零输出本身也是 p=1，同一套公式适用，见下）。

### 4.4 找零输出（`hasChange=true`）对 mass 的影响（新增）

`hasChange=true` 分支多一个 p=1 输出（找零回付款人），mass 公式变为 `N+1` 项谐和和：

```
storage_mass(hasChange) = max(0, C·(Σ_{i=1}^{N}(1/amount_i) + 1/change_amount) − C·p_in²/amount_in)
```

**这意味着找零金额本身也要遵守 §4.3 的运营安全线**——若找零金额（`input.value − recipientsTotal − 实际矿工费`）本身低于 `MIN_RECIPIENT_SOMPI`（0.1 KAS），会产生一个"几乎不可再花"的危险小额找零输出（同一逻辑：该项单独逼近或超过 mass 硬上限）。**SDK 决策规则**（供 §7.2 `buildSplitTx` 实现）：

- 超额（`input.value − recipientsTotal − max_split_fee`）**为负或零** ⇒ 用 `hasChange=false`。
- 超额**为正但低于 `MIN_RECIPIENT_SOMPI`** ⇒ 仍应优先 `hasChange=false`（把这一点点超额并入矿工费，只要不超过 `max_split_fee` 这个上限——若超过上限但又低于找零安全线，说明 `max_split_fee` 定小了，这是配置问题不是这笔交易的问题，SDK 应报错拒绝而非硬造一个危险的找零输出）。
- 超额**≥ `MIN_RECIPIENT_SOMPI`** ⇒ 用 `hasChange=true`，找零输出安全。

### 4.5 手续费上限（`max_split_fee` / `max_refund_fee`）的实测方法论（MUST-2 全新小节）

**v0.1 的问题**（NWT 指出）：`max_refund_fee=200,000 sompi` 是凭经验量级猜的，没有对**真实编译产物**（这份 `.sil` 编译出的实际 redeem script，字节数、指令数由这份合约的具体写法决定，不是通用估算能覆盖的）做过测量。若这个数字定低了，一旦真实网络最低费率或本合约实际 mass 超出预期，**该笔订单的退款交易会被 mempool 永久拒绝——资金卡死,无法通过任何路径拿回**,这是本设计能出现的最严重故障模式,必须在实现前用真实数字堵死,不能带着占位符上生产。

**强制前置步骤（写入 J2 实现阶段的验收门,不写完不许进 NWT diff 审）**：
1. 用 D-019 pin 住的 silverc v1.0.0 编译本设计的实际 `.sil`（含 `has_referrer=true` 与 `false` 两种 ctor 变体,各自单独测,因为输出数不同 mass 不同）。
2. 用 `kasia-relay/src/lib/tx-mass-ub.mjs`（**不用 kaspa-wasm 的 mass 计算**——D-014 记录该路径在 TN12 上已知会 panic、被 try/catch 静默吞掉,现网并未真正生效)对三种交易形状分别实测:`refund`（1 入 1 出）、`split(hasChange=false)`（1 入 2/3 出）、`split(hasChange=true)`（1 入 3/4 出,mass 最高的一种,是 `max_split_fee` 的真正瓶颈约束）。
3. 三个数字各自乘 `MIN_SOMPI_PER_MASS=100`（`p2sh.mjs:42`,实测确认的现网最低中继费率),得到该交易形状**理论最低**可广播费用。
4. 各自再乘一个安全倍数（建议 5–10 倍,覆盖:mempool 拥堵时的动态费率上浮、未来协议参数微调、多次广播重试的费用预留）,得到实际部署值。
5. `max_refund_fee` = 步骤 4 对 `refund` 形状的结果；`max_split_fee` = 步骤 4 对 `split(hasChange=true)` 形状的结果（取两个 split 分支里更贵的那个,保证两个分支共用同一个上限常量时都够用）。
6. 把最终测量方法与结果写进实现阶段的交付材料（与 provenance 惯例一致——`silverc-pin.json` 式的黄金样本记录),供未来任何人复现验证,不能只留一个数字没有推导过程。

**本设计稿只能给一个明确标注的占位量级**（不是最终值,实现前必须被步骤 1-6 的真实测量替换,任何人不得把下面这个数字直接抄进生产 ctor）：

参照口径（`p2sh.mjs:1833` 记录的真实历史事故——`close_attest`,一个**远比本设计复杂得多**的合约（5×checkSig + 40 次 merkle blake2b 循环 + `validateOutputState` 4448 字节 + 10 次两两不等比较）实测 compute mass 高达 **510,026**;本设计的 `split`/`refund` 入口**零 checkSig、零循环、零 validateOutputState**,只有若干条内省值比较 + 一次 `temporal()` 时间检查,量级应当是 `close_attest` 的一个小分数,大概率在几千到几万 compute mass 区间——**但这只是推理,不是测量,不能当结论用**）。**占位值：`max_split_fee = max_refund_fee = 1,000,000 sompi`（0.01 KAS）**，比 v0.1 的 200,000 提高 5 倍,反映"没测出真数字之前应该往保守方向猜"。

**为什么否决"改百分比上限"提案**（NWT 要求评估；🔴 2026-09-27 Bettor 转 NWT 口头补充更正：下面这段 v0.2 首版原话"mass 只取决于字节形状、不取决于转账金额"与本设计自己在 §4.1-§4.4 推的公式（`C·p_o²/v_o` 明明含 `v_o`）自相矛盾，已改写，不再用这个错误说法）：

Kaspa 的 mass 有两个独立维度,不能混为一谈：**compute mass**（`mass_per_tx_byte × 序列化字节数 + script_pubkey 字节数相关项 + compute_budget 项`）确实**只取决于交易的字节形状**（输入数、输出数、脚本长度），不取决于任何金额字段——这部分维度上,1 入 2 出的交易不管移动 1 KAS 还是 10,000 KAS,compute mass 是同一个数。但**storage mass（KIP-9）结构性依赖金额**（§4.1 公式里的 `C·p²/amount` 项——分母是金额,金额越小该项越大),这是本设计整节 §4 存在的原因,不能说它"与金额无关"。

**正确的表述是**：本设计已经用 §4.3 的 `MIN_RECIPIENT_SOMPI`（0.1 KAS）运营下限约束了"每个输出金额不能低于多少"——**在这条下限之上，storage mass 的需求有一个已知的、可测的上界**（最坏情形 = 每个收款人金额都卡在下限上,此时每项 `C/amount_i` 都恰好等于下限对应的那个上界值,§4.1 公式代入这个最坏情形即可算出整笔交易 storage mass 的确定性上界,不需要对每一笔具体订单重新猜）。这才是 §4.5 六步法"测一次、可复用给所有满足下限的订单"背后的真实依据——不是"金额不影响 mass"（这句错),而是"金额一旦被下限锁住,mass 上界就是确定的、可一次性测出来的"。

在这个更正后的理解下,百分比上限依然不对：**compute mass 维度上**,百分比缩放毫无意义（那部分本就与金额无关,乘个百分比只是凭空引入一个和真实成本不相关的数字）；**storage mass 维度上**,由于真正的约束变量是"是否触达 `MIN_RECIPIENT_SOMPI` 下限"而不是"订单总金额有多大",按订单总金额的百分比设手续费上限,在**小额订单（总额小但每个收款人份额仍然守住下限）**时可能算出一个低于"下限情形下测出的真实最坏 mass 成本"的绝对 sompi 数（重现 MUST-2 本身要修的故障),而在**大额订单**时只是徒然放宽一个和真实成本无关的数字（超额已被找零机制导向付款人,不存在"攻击者能拿走多余空间"这回事)。**结论：维持绝对 sompi 常量,常量来自"下限情形下的真实最坏 mass 测量+安全倍数"，不是按订单金额百分比缩放,也不是凭空猜**——这正是本节步骤 1-6 要做的事。

### 4.6 结构性残余风险：手续费上限烤成不可变 ctor 常量，无法应对未来费率上调（2026-09-27 Bettor 转 NWT 口头补充）

`max_split_fee`/`max_refund_fee` 是 genesis 时烤进地址的不可变常量（§2.1——地址本身由 ctor 参数决定，任何一个字段变了地址就变了，不存在"事后调整常量"这回事）。§4.5 的安全倍数（5-10 倍）能做的只是**降低**"未来某个时刻最低中继费大幅上调导致这个订单再也打不出交易"的概率，**不能证明这件事永远不会发生**——如果订单存续期间网络最低费率涨到超过烤死的上限，`split` 与 `refund` 会**同时**永久失灵（不是二选一失效，因为两个入口各自的手续费检查都是各自 ctor 常量,都可能被同一次费率上调击穿），资金卡死,没有任何脚本分支能救。这是本设计架构本身的残余风险,不是实现细节能消除的,必须显式写进文档与 SDK 注释,不能藏起来。

**唯一能收窄暴露面的手段：缩短订单存续时间**——风险的本质是"从 genesis 到被花费之间这段时间窗口内,网络费率是否发生了一次超出安全倍数覆盖范围的跳变",窗口越短,发生这种跳变的累计概率越低（即使不能降到零）。`deadline_ms` 不只是"付款人多久能退款"的业务参数,也是这个残余风险的暴露窗口上界。

**SDK 默认值与理由**：`createSplitProtocol` 在调用方未显式指定 `deadline_ms` 时,默认 **`now + 72 小时`**。理由：① 覆盖典型"下单→服务交付→分账"业务窗口（数小时到 2-3 天）,不因为默认值过短而误伤正常订单；② 相对于费率发生"数量级跳变"通常需要的时间尺度（网络级参数调整、市场剧烈波动一般以天/周计,不是分钟级),72 小时是一个远小于该尺度、但仍留有实际操作余量的窗口；③ SDK 必须允许调用方覆盖为更短（如即时类服务可设 6-12 小时）,但**覆盖为明显更长（如以月计）时应打印告警**，提示这类订单的残余风险暴露窗口被主动拉长,不是 SDK 的错但调用方应当知情。本设计不设"最长允许值"的硬上限（那是策略判断，不是共识规则，留给运营层面按需收紧）。

**追加（2026-09-27 NWT diff 审 MUST 修复，实现期间真实撞见并溯源到 rusty-kaspa 共识源码，非推测）**：`deadline_ms` 是否"已到期、可以退款"这件事的唯一权威判据是节点的 `virtual_past_median_time`（下称 PMT，即 `getBlockDagInfo().pastMedianTime`），**不是墙钟 `Date.now()`，也不是区块 tip 时间戳**。

- **源码依据**：`consensus/src/processes/transaction_validator/tx_validation_in_header_context.rs:72-93` 的 `check_tx_is_finalized` 对时间域 `lockTime` 用的判据是 `tx.lock_time < ctx_block_time`（严格小于才算"已终结"，否则要求全部输入 `sequence==MAX` 才放行，本合约两入口都不满足）；调用方 `consensus/src/pipeline/virtual_processor/processor.rs:1216`（mempool 校验）与 `:1319`（区块模板校验）两处传入的 `ctx_block_time` 逐字都是 `virtual_past_median_time`/`virtual_state.past_median_time`——两条独立路径口径完全一致，都是 PMT。
- **合约自身的 `require(tx.time >= temporal(dl_ms))` 是另一件独立的事**：这条是对交易自身 `lockTime` 字段的静态断言（同 Bitcoin `OP_CHECKLOCKTIMEVERIFY` 语义，校验"你声明的 lockTime 是否达到门槛"，不读任何实时链上时间），只要 `tx.lockTime>=dl_ms` 就过——不会因为 PMT 滞后而失败；**真正会因为 PMT 滞后而失败的是上面那条【消费层/共识层】"is not finalized"检查**，两条检查混在一次广播失败里容易被误判成同一回事。
- **实测量级**：本次实现在共享 simnet（自 2026-09-24 起断续挖矿）上真实复现 PMT 落后 tip 约 17.7 分钟、落后墙钟约 21 分钟；在一个**全新、连续挖矿**的 simnet 上，PMT 落后墙钟仅约 1 秒；在同一全新 simnet 上间隔数分钟未挖矿后重新测量，落后拉开到约 170 秒。**结论**：PMT 落后墙钟的量级取决于最近一段采样窗口（`MEDIAN_TIME_SAMPLED_WINDOW_SIZE`，约 263 个原始区块、每 10 个取一次样、约 27 个样本取中位数——`consensus/core/src/config/constants.rs:23-30`）内区块时间戳的新旧分布：出块稳定连续的网络该窗口全是新时间戳，PMT 紧跟墙钟；出块不规律或曾长时间空闲后突击出块的网络，窗口内混有旧时间戳，PMT 可以落后墙钟数十分钟甚至更多——**没有协议保证的滞后上限**。
- **SDK 修复**：`buildRefundTx` 的第三参数从"调用方传入的 `nowMs`"改为"调用方现查的 `currentPmtMs`"（`await rpc.getBlockDagInfo()` 读 `pastMedianTime`），并要求 `currentPmtMs >= deadline_ms + safetyMarginMs`（默认 5 秒余量，只是防量测噪声，不是因为需要更大余量——PMT 单调不减，一旦当前 PMT 严格超过 `deadline_ms`，后续只会更超过）；未到期时抛出的错误消息明确写"还需等 PMT 前进 N ms"，不再用墙钟推算"应该到期了"这种误导性提示。
- **对主网默认 72h deadline 的影响**：主网 kaspad 在健康出块节奏下 PMT 落后墙钟的量级应当远小于 72 小时（采样窗口对应的实际时间跨度取决于出块速率，正常运行下是分钟级，不是小时级）——72 小时的默认窗口相对这个量级仍有巨大余量，本次发现的问题是**测试环境（共享 simnet 长期空闲后突击挖矿）特有的极端滞后**，不影响 72h 默认值本身的合理性，但确认了"到期判断必须现查 PMT、不能靠任何形式的本地时钟推算"这条工程纪律具有普适性，不是仅在异常测试环境下才该遵守的特例。

---

## ⑤ 对抗测试清单（新增 #16、#17，更新 #4/#5，标注 #10/#11）

| # | 攻击/场景 | 构造方式 | 期望结果 | 对应 require |
|---|---|---|---|---|
| 1 | 篡改收款地址 | 同 v0.1 | 拒绝 | `tx.outputs[i].scriptPubKey==X_spk` |
| 2 | 篡改比例 | 同 v0.1 | 拒绝 | `tx.outputs[i].value==X_amount`（逐项） |
| 3 | 少付 | 同 v0.1 | 拒绝（consensus 原生 Σout>Σin） | N/A |
| 4🔄 | 多付，走精确路径 | 资金 UTXO 超出 `recipientsTotal+max_split_fee`，触发者仍选 `hasChange=false` 尝试广播 | **拒绝**（`require(input.value−recipientsTotal<=max_split_fee)` 失败） | `hasChange=false` 分支的手续费上限检查 |
| 4b🆕 | 多付，走找零路径（合法） | 同上资金情形，触发者选 `hasChange=true`，找零输出金额=`input.value−recipientsTotal−实际矿工费`（矿工费≤`max_split_fee`），付给 `payer_refund_spk` | **接受**——超额正确回付款人 | `hasChange=true` 分支全部 require |
| 5🔄 | 多付 + 找零被挪作他用 | 走 `hasChange=true`，但 `tx.outputs[baseCount].scriptPubKey` 改成攻击者自己的地址 | **拒绝** | `tx.outputs[baseCount].scriptPubKey==payer_refund_spk` |
| 5b🆕 | 多付 + 伪装找零金额 | 走 `hasChange=true`，找零输出地址对，但金额刻意压低（差额被触发者通过第 5 个隐藏输出私吞——若合约没锁输出总数会成立） | **拒绝**（`require(tx.outputs.length==baseCount+1)` 锁死输出槽位数，不存在"第 5 个"槽位） | `tx.outputs.length==baseCount+1` |
| 6 | 重复触发（同一 UTXO） | 同 v0.1 | 拒绝（双花） | UTXO 模型本身 |
| 7 | 部分输出 | 同 v0.1 | 拒绝 | `tx.outputs.length==N` |
| 8 | 换序 | 同 v0.1 | 拒绝 | 逐项按索引比对 |
| 9 | 伪造规则承诺 | 同 v0.1 | 业务/审计层测试，非合约测试 | N/A |
| 10 | 服务离线后仍可退款 | 同 v0.1 | 接受 | `tx.time>=temporal(deadline_ms)` — **🔴 本项测试脚本禁止 `import` 本仓 `kasia-relay/kasia-console` 任何内部模块（含 `p2sh.mjs`），必须独立构造交易字节，否则只证明"我们自己的代码能做到"，不证明"任何独立第三方都能做到"** |
| 11 | 服务离线后仍可分账 | 同 v0.1 | 接受 | 同上 — **🔴 同 #10 的独立性要求** |
| 12 | 超时前抢先退款 | 同 v0.1 | 拒绝 | `tx.time>=temporal(deadline_ms)` |
| 13 | 小额份额（硬阈值以下） | 同 v0.1 | 拒绝（storage mass 超网络硬上限） | N/A（KIP-9 原生规则） |
| 14 | 小额份额（安全线与硬阈值之间） | 同 v0.1 | 可广播但 SDK 本该拦截 | N/A（策略测试） |
| 15 | 退款手续费上限滥用 | 同 v0.1，**改：数值必须用 §4.5 实测后的真实 `max_refund_fee`，不用占位符测** | 接受（在测得的真实上限内） | `tx.outputs[0].value>=input.value-max_refund_fee` |
| 16🆕 | **MUST-3：完全独立第三方实现** | 一个全新脚本：**只用**公开发布的 SilverScript v1.0.0 编译器二进制（D-019 pin 的 `silverc.exe`，从其发布渠道独立获取，不 `import` 本仓 JS 代码）+ 本设计稿 §7.1 的公开 JSON schema + 标准 `kaspa-wasm`（官方包）/标准 wRPC 客户端，从零推导地址、独立构造 `split` 与 `refund` 交易、在隔离 simnet 上广播 | **两笔都必须真实广播成功（真共识接受，非 cli-debugger 模拟）**——这是验收③"不依赖我们的 DB 或管理员授权"的唯一可执行证明；测试脚本本身也不得 import 本仓任何 `.mjs`/`.js` 帮助函数（`p2sh.mjs`/`pool-bshard-artifacts.mjs` 等一律禁止），只能重新实现（或直接调用发布的编译器产物），否则测试只是把"我们内部管线能用"包装成"第三方能用" | 全部 require，作为整体验收 |
| 17🆕 | **追加项：同地址多笔资金合并销毁** | 构造两笔独立付款到同一订单地址（人为制造双充值场景），尝试构造**一笔** `split` 交易，`tx.inputs` 引用两个资金 UTXO，输出仍是原 N（或 N+1）个 | **拒绝**（`require(tx.inputs.length==1)` 直接失败）——追加验证：改为构造**两笔**独立的 `split`/`refund` 交易分别处理这两个资金 UTXO，两笔各自都能正常成功广播（证明约束只挡"合并销毁"这一种操作，不影响"逐笔正常处理"） | `tx.inputs.length==1` |
| 18🆕 | **MUST-新1：两分支互斥穷尽** | (a) 真实超额 `e = input.value-recipientsTotal` 恰好等于 `max_split_fee`（边界值），分别尝试 `hasChange=false`（应过，`e<=max_split_fee` 成立）与 `hasChange=true`（应拒，`e>max_split_fee` 不成立）；(b) `e = max_split_fee+1`（刚好越界），分别尝试两个分支（`hasChange=false` 应拒，`hasChange=true` 应过）；(c) 构造一笔试图让 `hasChange=true` 但 `e<=max_split_fee` 的交易（企图在本不需要找零时硬造一个找零输出） | (a)(b) 各自唯一分支通过、另一分支被拒——证明两分支对任意真实超额值互斥穷尽，不存在"两个分支都能通过"或"两个分支都不能通过"的缝隙；(c) 拒绝（`require(e>max_split_fee)` 失败） | `hasChange=true` 分支新增的 `e>max_split_fee` 下界 vs `hasChange=false` 分支既有的 `e<=max_split_fee` 上界 |

---

## ⑥ 不做（不变，照抄 v0.1 §6）

---

## ⑦ 接入层第一版：SDK 接口草案 + JSON 配置 schema（§7.1/§7.2 更新，§7.3 不变）

### 7.1 JSON 配置 schema（新增 `max_split_fee`，`order_nonce` 标注强制）

```json
{
  "schema_v": 1,
  "network": "mainnet | testnet-12",
  "silverc_pin": "3ed973335b59269293564805cc2c58a14595ec03",
  "canonical_rules": { "schema_v": 1, "roles": [ /* 同 v0.1 */ ] },
  "recipients": {
    "merchant_spk_hex": "...", "merchant_amount_sompi": "800000000",
    "broker_spk_hex":   "...", "broker_amount_sompi":   "150000000",
    "has_referrer": true,
    "referrer_spk_hex": "...", "referrer_amount_sompi": "50000000"
  },
  "payer_refund_spk_hex": "...",
  "deadline_ms": 1790000000000,
  "max_split_fee_sompi":  "1000000",
  "max_refund_fee_sompi": "1000000",
  "order_funding_amount_sompi": "1001000000",
  "rule_commit_hex": "64位hex",
  "order_nonce_hex": "32位hex（16字节，🔴强制字段，SDK 生成，调用方不可指定固定值）"
}
```

`order_funding_amount_sompi` 是新增派生字段（= `Σrecipients + max_split_fee`），SDK 计算好直接放进 JSON，省得每个消费者自己重新加一遍，同时也是"告诉付款人转多少钱"的权威数字来源。

### 7.2 SDK 接口草案（更新 `buildSplitTx`，新增决策逻辑说明）

```
createSplitProtocol(config: OrderConfig): { ctorParams, redeemScriptHex, address }
  // 不变，内部执行 §4.4 合并/拒绝策略；order_nonce 在此函数内部用 CSPRNG 生成，
  // 不接受 config 里预先带 order_nonce（若带了，本函数应报错拒绝，防止调用方复用固定 nonce）。

computeOrderAddress(config): string   // 不变

buildSplitTx(config: OrderConfig, fundingUtxo: UtxoRef): UnsignedTransaction
  // 🔄 更新：
  // 1. 若 fundingUtxo.amount < recipientsTotal ⇒ 本地报错（同 v0.1，早失败）。
  // 2. excess = fundingUtxo.amount - recipientsTotal。
  //    - excess <= 0：不可能到达此分支（步骤1已拦截）。
  //    - 0 < excess <= max_split_fee：hasChange=false。
  //    - excess > max_split_fee：
  //        - excess >= MIN_RECIPIENT_SOMPI（§4.4 找零安全线）⇒ hasChange=true，加找零输出。
  //        - excess <  MIN_RECIPIENT_SOMPI（配置错误：max_split_fee 定小了导致"卡在中间"）⇒ 本地报错，
  //          提示调用方这是 max_split_fee 常量配置问题，不是这笔资金的问题。
  //   （🔴 上述逻辑必须让 tx.inputs.length 恒为 1——buildSplitTx 只接受单个 fundingUtxo 参数，
  //    不提供"合并多个 UTXO"的调用形态，这是 API 设计层面对 tx.inputs.length==1 的呼应，
  //    防止 SDK 自己都写不出一笔违规交易，但不代表恶意方不能绕开 SDK 直接手搓——
  //    真正的防线始终是合约里的 require，SDK 只是第一道防呆。）

buildRefundTx(config, fundingUtxo, nowMs): UnsignedTransaction
  // 同 v0.1，同样只接受单个 fundingUtxo（不提供合并调用形态）。

verifyReceipt(receipt, rpc): Promise<VerifyResult>   // 不变
```

### 7.3 最小网页组件范围说明（不变，照抄 v0.1 §7.3；追加一句提示文案要求）

地址展示页新增文案要求（§2.6 已提及）："本地址仅供本笔订单使用，请勿重复付款"——必须展示在收款地址旁边，不是可选项。

---

## 附：D-025 五条 + 两条补充，逐条对照（不变，照抄 v0.1）

---

## 待定 + 默认值 汇总（更新：#3 从"默认值"升级为"强制实测前置步骤"，其余不变）

1. 合约是否声明为 covenant 关键字——默认：能不用就不用（§2.1）。
2. 引荐人份额过低时的处置——默认：并入 broker（§4.4）。
3. 🔴 **`max_refund_fee`/`max_split_fee` 具体值——不再是"默认值"，是 MUST-2 钉死的强制前置步骤（§4.5 六步法），本稿给出的 1,000,000 sompi 仅为明确标注的占位量级，禁止直接部署**。
4. `MIN_RECIPIENT_SOMPI` 运营下限——默认：10,000,000 sompi = 0.1 KAS（§4.3，本轮同时用作 §4.4 找零安全线判据）。
5. deadline 时钟选型——默认：`temporal()` 墙钟（§2.4）。
6. `order_nonce` 是否必要——**本轮已从"待定"转为定案：强制必填**（§2.2/§2.6），不再是待定项。
7. `rule_commit` 是否烤入 ctor——默认：烤入但不参与任何 require（§2.6）。
