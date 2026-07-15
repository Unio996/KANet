# KANet Economic Kernel v0.1

> **Status**: DRAFT — protocol discussion document  
> **Version**: 0.1  
> **Date**: 2026-07-15  
> **Scope**: KANet 开放经济内核；不等同于具体产品、前端、托管服务或主网承诺  
> **Reference environment**: Kaspa TN12 / SilverScript covenant / KANet agent network

## 0. 摘要

KANet Economic Kernel 定义一套开放的经济协调规则，使互不信任的人类与 Agent 可以围绕需求、生产、验证、流量和结算形成可组合的商业关系。

它不建立一个掌握入口、规则、账本与资金的平台。它把传统平台的权力拆分为彼此独立、可以替换的协议角色：

- **Requester / Consumer** 提出需求并支付价值；
- **Provider / Maker** 提供市场、服务、内容、数据或算力；
- **Broker** 组织需求、提供入口并获得预先承诺的收益；
- **Oracle / Verifier** 对结果、事实或计算提供可验证证据；
- **Executor / Infrastructure** 执行必要的链下工作；
- **Kaspa** 保存承诺、约束状态转换并执行最终结算。

用户不需要相信某个平台会诚实记账或按约付款。用户只需要验证：规则是否已承诺、状态转换是否合法、证据属于哪一种信任等级、结算是否被 Kaspa 共识接受。

KANet 的目标不是消灭服务提供者，而是消灭服务提供者对用户资产、既得收益和最终账本的单方面控制。

---

## 1. 规范语言

本文中的关键词具有以下约束含义：

- **MUST / 必须**：符合本规范不可缺少的条件；
- **MUST NOT / 禁止**：符合本规范绝不能发生的行为；
- **SHOULD / 应当**：除非有明确、可审计的理由，否则应遵守；
- **MAY / 可以**：实现者可以自由选择的能力。

任何声称兼容 KANet Economic Kernel v0.1 的实现，都必须公开其未实现、替代或扩展的条款。

---

## 2. 核心命题

### 2.1 开放经济路由

KANet 允许任意参与者在无需平台许可的情况下创建、发现、路由和履行经济协议。

Broker 是开放接口和经济角色，不是平台特权。任何人类、Agent、网站、机器人或应用，只要遵守同一协议，都可以成为 Broker。

### 2.2 原生商业化

“原生商业化”指：

> 任何促成了**可归因、可验证经济结果**的参与者，都可以依据事前承诺的规则，自动取得相应收益。

本规范不主张“任何流量天然都有价值”。流量只有在触发协议定义的 Value Event，且归因与收益规则已在事前承诺时，才形成可执行的收益权。

### 2.3 链作为最终账本

链下数据库、缓存、消息、日志和 Agent 记忆可以提高效率，但不得成为资金状态、结算结果或既得收益的最终权威来源。

协议真相必须能够由独立实现者从已确认的链上交易和已承诺数据重新推导。

### 2.4 数学不替代现实判断

密码学可以证明一套已定义规则被正确执行，但不能自动定义现实世界中什么是真实、正当或有价值。

任何外部事实来源、委员会、人工判断或可信数据源，都必须被显式写入 Trust Profile，禁止以“上链了”掩盖其主观信任来源。

### 2.5 原生结算资产

v0.1 参考实现以 KAS / sompi 作为原生结算单位，不要求发行 KANet 平台代币。

其他资产可以由独立 Domain Protocol 引入，但必须明确其发行、赎回、桥接和有效性假设。资产扩展不得削弱 KAS 原生路径，也不得把新增代币本身当作商业需求或收入来源。

---

## 3. 分层与边界

| 层 | 职责 | 不得拥有的权力 |
|---|---|---|
| Kaspa Trust Layer | 交易排序、UTXO 所有权、签名、时间约束、covenant、最终结算 | 不定义链外事实，不保证链下服务在线 |
| Economic Kernel | 经济对象、状态机、承诺、分账、claim、退款和争议出口 | 不拥有产品入口，不定义具体行业语义 |
| KANet Agent Layer | 身份、通信、发现、能力声明、策略、事实观察与执行协调 | 不得以本地数据库覆盖链上状态 |
| Domain Protocols | 预测市场、任务、数据、内容、算力、交易等具体规则 | 不得绕过 Economic Kernel 私自结算 |
| Broker Interfaces | Telegram、Web、API、Agent-to-Agent 等入口与分发 | 不托管协议资金，不修改已承诺规则，不裁决最终结果 |

每个模块必须声明以下六项边界：

1. **Input**：它消费哪些协议对象；
2. **Output**：它产生哪些可验证对象；
3. **Authority**：它能够决定什么；
4. **Evidence**：它的输出如何被验证；
5. **Failure**：它离线、作恶或分叉时会发生什么；
6. **Replacement**：另一实现如何在不请求原实现许可的情况下接替。

无法回答上述六项的代码不是独立模块，只是被隐藏的耦合。

---

## 4. 协议角色

### 4.1 Requester / Consumer

Requester 发出需求、选择规则并提供支付或抵押。

Requester 必须能够在付款前验证：

- Economic Agreement 的规范版本；
- 资金去向和退款条件；
- Fee Rules Commitment；
- Result Authority；
- Trust Profile；
- 超时与失败出口。

### 4.2 Provider / Maker

Provider 生产被交易的对象或服务，包括但不限于市场、算力、信息、内容、流动性和现实服务。

Provider 可以定义报价和履约条件，但不得在 Agreement 被承诺或资金进入后单方面改变结算规则。

### 4.3 Broker

Broker 负责发现需求、呈现报价、路由订单、绑定归因和通知收益。

Broker：

- 必须拥有稳定、可验证的收款身份；
- 必须在 Value Event 发生前完成 Attribution Commitment；
- 只能领取事前承诺且由有效结算产生的收益；
- 不得因为控制入口而控制用户资金；
- 不得成为 Agreement 状态的唯一读取来源；
- 不得在付款后替换 Broker、费率或收款地址；
- 应当向参与者提供链上交易、状态和收益的独立验证入口。

Broker 可以提供托管式测试体验，但生产价值场景不得要求用户信任 Broker 才能取回资金或领取已经获得的收益。

### 4.4 Oracle / Verifier

Oracle 对链外事实作出声明；Verifier 验证链上事实、密码学证明或确定性计算。

两者不得被混为一谈：

- Oracle 的可信度来自身份、委员会、质押、声誉或外部制度；
- Verifier 的可信度来自公开算法、承诺输入和可重放证明。

### 4.5 Executor / Infrastructure

Executor 执行证明生成、索引、消息传递、通知、批处理或交易广播等链下工作。

Executor 可以影响活性，但不得拥有不可替代的结算授权。任何关键 Executor 失效后，协议必须具有接替、超时、逃生或退款路径。

---

## 5. 最小协议对象

### 5.1 Economic Agreement

Economic Agreement 是一次经济关系的不可变规则入口，至少包含：

```json
{
  "protocol": "kanet-economic-kernel",
  "version": "0.1",
  "agreement_id": "bytes32",
  "domain": "prediction|task|data|content|compute|other",
  "creator": "kaspa-address",
  "terms_commit": "bytes32",
  "fee_rules_commit": "bytes32",
  "attribution_commit": "bytes32",
  "result_authority_commit": "bytes32",
  "trust_profile": "T0|T1|T2|T3 plus details",
  "deadline": "chain-verifiable time condition",
  "failure_policy_commit": "bytes32",
  "settlement_template_commit": "bytes32"
}
```

所有可影响资金去向的字段都必须在首次接受价值之前完成承诺。实现可以扩展字段，但不得改变已承诺字段的语义。

### 5.2 Fee Rules

Fee Rules 定义总价值如何在各经济角色之间分配，至少包括：

- 角色标识；
- 收款地址或确定性地址推导规则；
- 固定金额、比例或可验证计算方式；
- 舍入规则与余数归属；
- 上限、下限和互斥条件；
- 自我归因或角色重叠政策；
- 规则版本与 canonical serialization。

Fee Rules 必须使用唯一的 canonical representation 计算 commitment。相同语义必须产生相同 commitment；不同资金结果必须产生不同 commitment。

### 5.3 Attribution Commitment

Attribution Commitment 记录 Broker、introducer 或其他分发者对潜在收益的事前归因。

它证明的是“协议接受了这一归因规则”，而不是自动证明现实世界中的因果贡献。抗女巫、自我推荐、重复归因和多 Broker 竞争规则必须由 Domain Protocol 明确规定。

### 5.4 Value Event

Value Event 是触发结算或收益权的协议事件，例如：

- 市场产生合法结果；
- 任务被按约完成；
- 数据被交付并通过验证；
- 内容访问或购买完成；
- 算力结果通过验证；
- 退款条件被满足。

每一种 Value Event 都必须定义：输入、验证方法、Result Authority、最终性条件和失败路径。

### 5.5 Evidence

Evidence 是支持 Value Event 的链上对象、证明、签名集合或外部事实承诺。Evidence 必须绑定具体 Agreement，禁止跨 Agreement 重放。

### 5.6 Settlement Plan

Settlement Plan 是由 Agreement、已确认资金、有效 Evidence 与 Fee Rules 确定性推导的支付集合。

对同一组规范输入，所有兼容实现必须得到字节一致或语义唯一的结果。

### 5.7 Claim / Refund Ticket

Claim 或 Refund Ticket 是参与者对 Settlement Plan 中特定金额的可验证领取权。

Ticket 必须：

- 绑定 Agreement 和最终 settlement commitment；
- 防止重复领取；
- 明确领取金额和地址；
- 在最终领取时避免零值或 dust continuation；
- 不依赖单一平台数据库证明其存在。

---

## 6. 规范状态机

Economic Agreement 的规范生命周期为：

```text
PROPOSED → COMMITTED → FUNDED → ACTIVE → RESOLVING → SETTLED
                │          │         │
                └──────────┴─────────┴→ REFUNDABLE → REFUNDED
                                      └→ DISPUTED → RESOLVING | REFUNDABLE
```

Domain Protocol 可以省略不适用的中间状态，但必须公开映射关系，且不得省略资金安全和终态。

每次状态转换必须定义：

- 前置状态；
- 授权条件；
- 输入 commitment；
- 链上副作用；
- 新状态；
- 失败时的原子性；
- 可独立验证的交易或证明。

**NO TRANSITION → NO STATE CHANGE.**

任何链上付款、退款、claim、cancel、settle 或资金迁移，都必须对应一次合法状态转换。链下数据库的直接更新不得制造协议状态；链上动作也不得脱离状态机成为孤立副作用。

最终状态至少包括 `SETTLED` 与 `REFUNDED`。终态一旦被链确认，任何单方服务不得使其回退。

---

## 7. 信任等级

每个 Agreement 必须声明其 Result Authority 和 Trust Profile。最低分类如下：

| 等级 | 来源 | 可以证明什么 | 不能证明什么 |
|---|---|---|---|
| T0 — Chain-native | 已确认交易、签名、时间锁、UTXO/covenant 状态 | 链内事实与合法状态转换 | 链外事件真实性、服务活性 |
| T1 — Proof-derived | ZK proof 或其他公开可验证计算证明 | 承诺输入按照固定电路正确计算 | 输入本身是否真实、电路是否定义了正确问题、证明者是否及时工作 |
| T2 — Quorum-attested | 明确成员与阈值的委员会签名 | 达到协议规定的多数声明 | 委员会是否集体错误、受胁迫或串通 |
| T3 — Subjective external | 单一或多源 Oracle、人工判断、制度数据源 | 指定来源确实作出某项声明 | 声明必然对应客观真相 |
| T4 — Operational | daemon、索引器、API、通知和界面 | 服务在特定时刻可用 | 资金正确性和永久活性 |

“Trustless”只能用于完全由 T0，或在明确电路与输入假设下由 T1 强制的具体性质。整个系统不得因为其中一个环节使用 ZK，就被笼统描述为 trustless。

---

## 8. 强制不变量

### K-01 — No Transaction, No Truth

未被合法链上交易确认的注册、付款、结算、退款或收益，只能被视为意图、缓存或观察结果，不能被视为协议事实。

### K-02 — No Transition, No State Change

任何协议状态变化都必须通过唯一、公开、可验证的状态转换路径发生。

### K-03 — No Commitment, No Claim

未在 Value Event 之前承诺的 Broker、角色、费率、地址或规则，不得在结算时获得收益。

### K-04 — No Verifiable Value Event, No Success Fee

除非 Agreement 明确规定预付费或 retainer，否则基于成功结果的收入只能由有效 Value Event 触发。

### K-05 — Value Conservation

所有输入价值必须被完整解释：

```text
total_input = participant_payouts + role_fees + refunds + protocol_defined_costs
```

任何未解释差额都必须使结算失败。舍入余数的唯一归属必须事前写入 Fee Rules。

### K-06 — No Retroactive Policy

资金进入后，任何参与者都不得单方面修改结果权限、分账、归因、退款、截止时间或 settlement template。

规则升级必须创建新版本、新 commitment 或新 Agreement。

### K-07 — Explicit Authority

每个可能改变资金结果的判断都必须指出其最终授权来源：T0 链内事实、T1 电路、T2 委员会或 T3 Oracle。禁止把 driver、数据库或界面默认升级为隐含裁判。

### K-08 — Deterministic Derivation

Commitment、地址、payout、Merkle root、journal 和交易模板必须从公开输入确定性推导。安全关键常量应从源工件现场推导并进行跨源校验，禁止依赖人工同步记忆。

### K-09 — Confirmed State Only

最终结算不得依赖 mempool、未达到规定确认深度的交易或不稳定索引结果。

### K-10 — Failure Has an Exit

每一笔被锁定的价值都必须具有可达的正常结算或失败出口。失败出口可以是超时退款、escape path、替代证明者或替代执行者，但不得只依赖原服务恢复。

### K-11 — Off-chain Components Are Replaceable

索引器、Broker UI、证明生成器、通知服务、Mind 和 daemon 可以影响体验与活性，但不得成为永久不可替代的资金授权者。

### K-12 — Facts Are Shared; Trust Is Local

KANet 可以共享事件、交易、签名和执行记录，但不得规定一个全局信誉分数或单一可信目录。参与者依据相同事实形成自己的策略和信任判断。

### K-13 — Production Value Must Not Require Platform Custody

测试网体验可以使用明确标注的托管钱包降低门槛；真实价值场景必须允许参与者使用自己控制的地址完成付款、退款和 claim。

### K-14 — Economic Revenue Is Not Token Appreciation

协议收入必须来自 Agreement 所定义的实际价值交换。代币发行、价格上涨、补贴或循环交易不得被计入可持续商业收入。

### K-15 — No Hidden Superuser

任何暂停、升级、紧急处置或管理员权限都必须公开其地址、作用范围、触发条件和失效方式。隐藏密钥或链下管理员不得拥有重定向资金、修改既得 claim 或阻断永久退出的能力。

---

## 9. Broker Interface 最小能力

兼容 Broker 应当提供下列语义能力；具体传输协议可以不同：

| 能力 | 作用 |
|---|---|
| `discover` | 发现 Provider、报价和 Domain Protocol |
| `quote` | 返回费用、信任等级、截止时间和失败政策 |
| `createAgreement` | 构造并展示待承诺的 Economic Agreement |
| `commitAttribution` | 在付款前绑定 Broker 或 introducer 归因 |
| `fund` | 构造用户可独立验证和签名的付款交易 |
| `observe` | 从链或独立 Reader 推导规范状态 |
| `submitEvidence` | 提交其被授权提交的 Evidence；不得扩大其裁决权 |
| `claim` | 帮助构造领取交易，但不得成为领取的唯一通道 |
| `notifyRevenue` | 将已确认收益、txid、Agreement 和角色发送给收益方 |
| `exportProof` | 导出第三方验证所需的 commitment、路径、交易和证明 |

Broker 实现可以在用户体验、推荐、定价展示和服务组合上竞争，但所有实现必须面对同一套链上状态和结算规则。

---

## 10. 正确性与活性

KANet 必须分别声明 Correctness 和 Liveness，不得相互替代。

### 10.1 Correctness

Correctness 回答：如果一次转换被链接受，资金结果是否符合已承诺规则？

它由 covenant、签名、commitment、Merkle proof、ZK proof、价值守恒和确定性交易模板约束。

### 10.2 Liveness

Liveness 回答：在参与者离线、拒绝服务或系统重启时，Agreement 是否仍能走向 `SETTLED` 或 `REFUNDED`？

它由以下机制保证或改善：

- 可替代 Executor；
- 超时与 escape path；
- 多证明者或无许可证明提交；
- 独立索引器；
- 幂等重试；
- 进程隔离与启动恢复；
- 明确的最终确认深度。

“证明计算正确”不等于“证明者一定会工作”；“链不会篡改结算”也不等于“某个 Broker 界面永远在线”。

---

## 11. 开放商业闭环

KANet 所追求的经济闭环是：

```text
真实需求
  → Broker 发现并路由
  → Provider / Maker 生产
  → Value Event 被证明或裁决
  → Kaspa 强制结算
  → Provider、Broker、Oracle、Infra 等按承诺获得收入
  → 收入驱动更多供给与更好的分发
```

一个循环只有同时满足以下条件，才可以称为商业闭环：

1. 存在愿意为结果付费的真实需求；
2. 有参与者承担生产或服务成本；
3. 完成条件可以被协议验证或明确裁决；
4. 收益不依赖平台任意记账；
5. 角色收入可以独立领取和审计；
6. 循环不依赖持续增发、补贴或资产升值才能成立。

因此，KANet 不承诺自动把无价值流量变成收入；它提供的是把**已创造的价值**开放、确定、可组合地路由给贡献者的能力。

---

## 12. Prediction Market Reference Profile

当前 KANet 预测市场可以作为 Economic Kernel 的第一个参考映射：

下表描述协议概念与当前实现方向的对应关系，不构成“现有代码已满足 v0.1 全部条款”的声明。正式兼容性必须由第 13 节要求的独立证据矩阵确认。

| Economic Kernel | Prediction Market Profile |
|---|---|
| Economic Agreement | Market creation commitment / PoolSpine |
| Provider / Maker | 市场创建者与流动性提供者 |
| Broker | 投注入口、市场分发和已承诺佣金接收者 |
| Attribution | 押注前绑定的 broker / introducer 规则 |
| Funding | 下注交易与 ShardLeaf 状态 |
| Result Authority | 4-of-5 committee、Oracle 或未来明确替代机制 |
| T1 Proof | ZK guest 对 bets root、winner、payout root 的计算证明 |
| Settlement Plan | Payout Merkle tree / PayoutShard / CloseZk continuation |
| Claim Ticket | Merkle path + nullifier 防重复领取 |
| Failure Exit | cancel、refund、escape 与 isolated shard recovery |

该 Profile 证明 Economic Kernel 可以被真实协议实现，但预测市场的具体结果语义、赔率和委员会设计不属于通用内核。

---

## 13. 一致性与合规证明

声称兼容 v0.1 的实现必须至少提供：

1. 协议对象的 canonical serialization；
2. 独立 Reader 能够重建的状态与资金轨迹；
3. 正向测试：完成一次完整链上生命周期；
4. 负向测试：非法状态转换、篡改 fee rules、重复 claim 和未确认输入必须失败；
5. 守恒证明：每个终态的全部输入价值都有唯一去向；
6. Trust Profile：逐项说明哪些性质属于 T0–T4；
7. Liveness Plan：关键服务离线后的接替或退出路径；
8. Implementation Boundary：列明链上强制、proof 强制、driver 策略和仅 UI 展示的能力。

仅有 schema、文档或本地测试不足以证明生产可用。一个协议对象必须至少完成一次成功链上转换，才能声称其执行路径已经存在：

> **No successful transition, no live protocol claim.**

---

## 14. 非目标

KANet Economic Kernel v0.1 不负责：

- 建立全局信誉排名或唯一 Agent 目录；
- 保证任何 Broker、Provider 或用户盈利；
- 自动判断所有现实世界事实；
- 用 ZK 消除 Oracle 问题；
- 保证所有链下服务永远在线；
- 规定法币、交易所或银行卡桥接方案；
- 发行新的协议代币作为商业闭环替代品；
- 把当前 TN12 实现直接等同于主网安全承诺；
- 把某一个 KANet 团队维护的 UI、数据库或 daemon 设为协议权威。

现实支付桥、监管接口、行业争议机制和特定资产标准可以作为独立 Domain Protocol 或 Adapter 建设，不进入 Economic Kernel 的最小可信基。

---

## 15. 版本与升级

1. 已承诺的 Agreement 必须永久绑定其协议版本；
2. 新版本不得改变旧 Agreement 的解释；
3. circuit image、transaction template、canonical codec 和 security-critical constants 的改变必须产生新版本或新 commitment；
4. 任何迁移都必须明确旧资金如何结算、退款或继续被验证；
5. 规范、参考实现与测试向量必须分别标注版本，禁止以最新代码静默重解释历史链上对象。

---

## 16. v0.2 待解决问题

以下问题不应在 v0.1 中假装已经解决：

- 通用 Fee Rules 如何进入 ZK guest，而不造成 circuit 频繁冻结升级；
- 多 Broker 竞争归因、抗女巫和自我推荐的通用规则；
- 跨 Domain 的通用 Value Event / service receipt 格式；
- 无许可 Oracle 市场、质押和争议仲裁；
- 跨 Agreement 的可组合信誉证据，而非全局信誉分；
- 去中心化证明者、索引器和持续活性激励；
- 主网参数、安全审计和真实价值风险边界。

---

## 17. 协议宪法

KANet Economic Kernel v0.1 以以下原则作为不可被产品便利性覆盖的宪法：

> **No Transaction, No Truth.**  
> **No Transition, No State Change.**  
> **No Commitment, No Claim.**  
> **No Verifiable Value Event, No Success Fee.**  
> **Every settlement authority must be explicit.**  
> **Every off-chain component must be replaceable.**  
> **Facts are shared. Trust is local.**  
> **Users verify settlement; they do not depend on a platform's promise.**

KANet 的最终目标不是成为下一个掌握所有用户与生产者的平台，而是提供一套任何人都能使用、任何实现都能验证、任何经济角色都能公平接入的开放规则。

当规则由协议承诺，价值由真实行为产生，结果由证据约束，收益由链自动路由时，商业不再依赖一个中心承诺履约。平台仍可以存在，但平台不再拥有经济主权。
