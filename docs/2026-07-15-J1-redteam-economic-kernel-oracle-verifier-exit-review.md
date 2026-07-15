> **Status**: DRAFT — 对抗轮②交付稿，待 Bettor 终验

# J1 对抗轮②交付：§4.4 Oracle/Verifier 分离 + §7 T2/T3 信任分级 + K-10 出口矩阵 vs 现状 gap 矩阵

**作者**: J1tn · 2026-07-15 · Bettor 派工 #m3fpj3.2（对抗轮②，deadline 明日 09:3xZ）
**对象**: `docs/2026-07-15-KANet-Economic-Kernel-v0.1.md`（commit `73b95db9`）
**方法**: 挑错优先，逐条打"哪条现在就违宪"，不给缓和结论。所有代码路径经直接搜索确认（非记忆/猜测）。

---

## 结论先行（三条硬 gap）

1. **命名层面已经把 §4.4 明令"不得混为一谈"的两个角色焊在一起**：committee 抽样池被命名为 `oracle_pool_membership`/`is_oracle`/`oracle_registry`。
2. **§12 Profile 表把当前预测市场的真正 Result Authority 讲轻了**：多数市场的 binding 权威其实是外部 UMA（T3 单一机构源），KANet committee 只是非约束性 parallel judgment；Profile 表写"4-of-5 committee"掩盖了这一点。
3. **K-10（Failure Has an Exit）目前是愿望，不是强制不变量**：没有任何结构化/自动化机制验证"每笔锁定资金都有可达出口"，全靠人工红队审查偶发抓住——7/15 当天的批0 kill-switch 事故就是活证据。

---

## 一、§4.4 Oracle/Verifier 分离 vs 现状

### 文档要求（§4.4 原文）

> Oracle 对链外事实作出声明；Verifier 验证链上事实、密码学证明或确定性计算。两者不得被混为一谈：
> - Oracle 的可信度来自身份、委员会、质押、声誉或外部制度；
> - Verifier 的可信度来自公开算法、承诺输入和可重放证明。

### 代码现状（逐项核实）

- Oracle 不是独立身份，是 `relay_nodes` 表上的布尔位 `is_oracle`（`kasia-console/src/db/migrate.js:3872-3886`，v124 注释"= unified KANet user role"——oracle 跟 broker 共用同一张表结构）。
- `oracle_pool_membership` 表（`migrate.js:4742-4752`）记录质押（`stake_locked_kas`），这个池同时是 **committee 抽样的输入池**：`pool-committee-sampler.mjs` 从这个池按 VRF stake 加权抽 5 人组成 committee，签 `close_attest`（`bshard-close-voter.js`），门限 4-of-5。
- `oracle_registry.tier`（`migrate.js:4170-4181`，CHECK IN (1,2,3)）是唯一接近"信任分级"的字段，但分的是 oracle 自己内部的准入等级（tier1=KANet curated 无 bond / tier2=stake-bonded 可 slash / tier3=system fallback），跟 §7 的 T0-T4 是完全不同的坐标轴，不能互相映射。
- 委员会（committee）做的事情，按文档自己的坐标系，其实是 **T2（Quorum-attested）**——`bshard-close-voter.js:5-7` 明确写"trust = honest-majority-of-委员节点"，每个委员节点本地独立跑 `enforceCloseAttest` 验证后才签名（链下多签、链上仅验签）。
- 而真正扮演文档 §4.1 "Oracle"角色（对链外事实作声明）的，是外部 UMA/Polymarket（`polymarket_uma_mirror` 调 gamma API，见 `bettor-prediction-verifier.js:9`）——这是 **T3（Subjective external）**。

### 违宪点

代码把"committee 抽样质押池"这个 **T2 基础设施** 命名为 `oracle_pool_membership`/`is_oracle`/`oracle_registry`，而文档定义的"Oracle"角色（T3，外部事实来源）实际上是 UMA，跟这套命名毫无关系。换句话说：**现在代码里叫"oracle"的东西，按新宪法的坐标系其实是 T2 committee 的准入基础设施，不是文档意义上的 T3 Oracle**。这不是运行时逻辑混淆（`enforceCloseAttest` 的验证责任划分是清楚的），而是**命名层面的角色坍缩**——任何新读代码的人，看到 `is_oracle`/`oracle_pool_membership` 字样，第一反应会去对应文档 §4.4 的"Oracle"定义，但实际对应的是 committee（T2），这是新读者/新实现者最容易踩的第一个坑。

### 建议动作（不越权拍板，仅列选项）

- **A（推荐，命名不改代码逻辑）**：`oracle_pool_membership`/`oracle_registry` 改名为 `committee_pool_membership`/`committee_registry`（这些是 committee 的准入/质押基础设施），保留一个真正独立的"Oracle Registry"给 T3 外部事实源（当前只有 UMA 一家，硬编码在 `polymarket_uma_mirror` hook 里，没有独立注册表）。
- **B（成本更高）**：在文档层面接受"committee 抽样池复用 oracle 命名"是历史遗留，在 §12 Profile 表里显式加一行脚注说明这个命名不一致，不改代码。

两个方案都要走团队正常报备流程，这里只出选项不拍板。

---

## 二、§7 T2/T3 信任分级 vs 现有委员会/oracle 栈

### 现状分级对照表

| 现有代码机制 | 文档 T 分级 | 依据 |
|---|---|---|
| `pool_committee`（4-of-5 门限签名，`enforceCloseAttest` 本地独立验证） | **T2 — Quorum-attested** | 明确成员+阈值，honest-majority 假设，`bshard-close-voter.js:5-7` |
| UMA/Polymarket 外部结算（`polymarket_uma_mirror`） | **T3 — Subjective external** | 单一机构数据源，"钱仍走UMA 48h节奏" |
| ZK guest circuit（zkNative markets，D-001 committed 方向） | **T1 — Proof-derived** | Groth16 proof，链上验证，不属于上面两条 |
| `oracle_registry.tier`（1/2/3） | **不对应任何 T 级** | 这是 oracle 内部准入分级，坐标轴跟 T0-T4 正交，不可混用 |
| `identities.trust_level`/`relay_nodes.trust_level`（值如 'normal'/'blocked'/'owner'） | **不对应任何 T 级** | IM 联系人/技能调用 ACL，与协议 Result Authority 无关——纯粹是同名不同义，容易被新实现者误当"这就是 Trust Profile 字段"直接复用 |

### 违宪点（比 §4.4 更严重）

1. **当前系统事实上并行跑着三条独立的结算权威路径**（committee-sig / ZK guest / 外部 UMA），但 §12 Prediction Market Reference Profile 表把 Result Authority 写成单行"4-of-5 committee、Oracle 或未来明确替代机制"——这个"或"字掩盖了一个关键事实：**这三条路径不是同一个市场的三个可选实现，而是不同市场类型分别绑死其中一条，且用户/参与者事前很难从界面判断某个具体市场当前实际绑的是哪一条、对应哪个 T 级**。按文档自己 K-07 的要求（"每个可能改变资金结果的判断都必须指出其最终授权来源"），这需要逐市场显式声明，当前没有看到这个声明面（未在 UI/API 层核实到有专门字段标注单个市场的 Trust Profile，只在设计文档层面有分散记录）。
2. **UMA 依赖的 T3 属性被"委员会"的措辞事实上弱化**：多数预测市场的真正 binding 结算权威是外部单一机构（UMA），KANet 自己的委员会明确是非约束性的 parallel judgment（"独立判定不影响结算"）。如果按文档 §7 对 T3 的定义如实标注，这类市场的 Trust Profile 应该显式写"T3，单一外部机构源（UMA），委员会判定仅供参考不具约束力"——而不是让"4-of-5 committee"这个更好听的措辞出现在用户能看到的地方（本次审查没有去核实用户端 UI 实际怎么呈现，这是一个需要 KANet-UI 域补一刀现场核实的点，@KANet-UI-tn 你的 §9 Broker 能力审查里如果有空顺手查一下 UI 是否如实呈现 T3/UMA 依赖）。
3. **DECISIONS.md D-001 已经诚实地做对了一件事，值得对比参照**：D-001 明确区分"committee-sig"和"真·ZK"两种机制，禁止把 committee-sig 标为"trustless"（"非covenant验payoutRoot·委员盲签·非production-trustless"）。这说明团队内部治理文档层面已经有 §7 要求的纪律意识，只是没有沉淀成代码里的 Trust Profile 结构化字段——**gap 不在认知，在于把认知变成可机器验证/可对外展示的结构**。

---

## 三、K-10（Failure Has an Exit）出口矩阵 vs 族B/E 铁律

族B/E 铁律原文（NWT batch0 审查，`docs/2026-07-15-NWT-redteam-process-separation-batch0-review.md:23`）：

> covenant/资金收款前必验 exit-path 矩阵，不能带着已知漏洞上生产使用模式。

### 用一个刚发生的真实事故做证据，不猜

7/15 当天批0（进程分离 kill-switch 落码）设计初稿把 `DEMO_SEEDER_OFF` 一个开关同时绑住三个循环，其中两个（`startSeederDepositWatcher`/`startSeederRefundWorker`）是**真实资金状态机**（用户 seeder 买单充值/退款）。这个开关一旦在生产模式下被拉下，等于让"已锁定但正在充值/退款途中"的资金**失去可达出口**——直接撞上 K-10 的核心要求。这个问题不是被自动化机制拦下的，是 NWT 红队人工审查时钉出来的一条 MUST-FIX（`docs/2026-07-15-NWT-redteam-process-separation-batch0-review.md`），审查当天 `retail_dex_buy_publications` 表恰好是空表，"不会立刻炸雷"，但设计一旦定型、开关被反复使用，下一次有真实充值在途时切换就会踩雷。

### 违宪点

1. **K-10 目前没有任何门禁/lint 规则去强制检查**："每一笔被锁定的价值都必须具有可达的正常结算或失败出口"这句话目前完全依赖人工审查的警觉性，而族B/E铁律本身就是"从历史事故提炼出的事后经验规则"，不是写进代码/CI 的门禁。跟 K-08（"安全关键常量应从源工件现场推导"）撞过的 gate-tmplhash 半更新事故（D-009）是**同一个病灶模式**：**文档写了"MUST"，但现实执行力靠人不靠机制**。
2. **已有的 exit-path 实现是点状的，不是通用可复用组件**：`escape_trigger`（ZK track 专用，`docs/2026-07-09-pxvml-escape-refund-execution-design.md` 等）、`cancelMarketLive`/`reclaimBshardMakerBond`（bshard 专用，`bshard-auto-settler.mjs`）——每个 domain 各自发明了一套自己的"出口"逻辑，没有一个通用的"新增一个 covenant/资金收款路径时，必须声明并测试其 K-10 出口"的检查清单或 lint 规则。这跟 §3 文档自己要求的"每个模块必须声明 Failure（它离线/作恶/分叉时会发生什么）"六项边界，目前在代码组织上没有对应的可枚举清单，只能靠人工记住"这是第几个同族坑"。

### 建议动作（同样不拍板，仅列选项）

- 把族B/E铁律升级为一条 `lint-kanet.mjs` 规则：任何新增/修改的 `setInterval`/`startXxxWatcher`/`startXxxWorker` 若涉及资金收款/退款（通过关键词或文件路径 HIGH-RISK 标记识别），必须在同一 PR 里显式列出其 K-10 出口路径（超时退款/escape/替代执行者），否则 CI 拦截——把 K-10 从"MUST 但没人强制"升级到 L3（lint 半机械，按 D-002 框架迭代回路的执法阶梯）。

---

## 四、给 Owner 的诚实口径（Bettor 已先钉一条，我补一条）

Bettor 已钉：K-13（生产价值不得强制托管）与当前托管 TG 钱包主打路径的关系，需要给 Owner 诚实口径。

我这边补一条属于我域内的：**当前系统事实上有三条并行结算权威路径（committee-sig T2 / ZK guest T1 / 外部 UMA T3），而团队近期主线方向（D-001）是把 ZK 定为 committed 目标架构、committee-sig 降为过渡——但 UMA 依赖的那部分预测市场并不在 D-001 讨论范围内，它是完全独立的第三条路径，且是当前唯一真正触碰"单一外部机构信任"的 T3 依赖。如果 Owner 只看到"我们在往 ZK 迁移"的叙事，容易误以为系统信任基础在整体收敛，但 UMA 依赖这条线目前没有任何收敛计划——这条线该怎么定位（长期保留/未来也上 T1/T2 化），是一个需要显式决策而非默认延续的问题。**

---

## 待复核

1. UI 层是否如实向用户呈现 T3/UMA 依赖——本稿未核实，标记给 @KANet-UI-tn。
2. `oracle_registry.tier` 与 §7 T0-T4 坐标轴正交这一判断，需要 J2/NWT 交叉核对（我的 domain 是 SS/covenant/oracle 栈的委员会侧，UMA mirror 那条线不完全是我平时touch的代码，找的是 Explore 搜索结果，建议至少一人独立复核）。
