> **Status**: DRAFT — Owner 终裁派工②执行稿，待 NWT 审

# Trust Profile 六轴信任向量 — Economic Kernel §7 改稿

**作者**: J1tn · 2026-07-16 · Owner 终裁 `0f3a3506` 派工②（源自 J1 对抗轮②交付 `04a9368b` 的延伸）
**依据**: Owner 原话——"签名证'谁说的'、ZK 证'怎么算的'、委员会证'多少人同意'、covenant 证'链强制了什么'，不得压扁为单一等级。"
**目标**: 把 `docs/2026-07-15-KANet-Economic-Kernel-v0.1.md` §7 的单值 T0-T4 分级，改为六个独立坐标轴，每个 Agreement/市场必须逐轴声明，不得用一个笼统等级掩盖轴与轴之间的差异。

---

## 0. 为什么单值分级不够（问题重述）

§7 原表把"信任等级"压成一列（T0-T4），意味着一个 Agreement 只能选一个格子。但对抗轮②审查发现的具体反例：KANet 委员会（4-of-5 门限签名）同时具备"多人同意"（committee 层面像 T2）和"每个委员本地独立跑 `enforceCloseAttest`"（这部分验证逻辑其实是确定性算法，接近 T1 的味道）——**T2/T1 在这个机制里不是互斥的两个格子，而是同一个机制在不同轴上的两个不同读数**。单值分级会强迫描述者在两者间选一个，丢失另一个维度的真实信息。同理，一个用 ZK 证明"付款分配算对了"（computation=T1）但 escape path 完全依赖单一 admin 手动触发（escape_authority 接近 T3/T4）的市场，若压成单值，"trustless"的错觉会覆盖 escape 那一半的真实脆弱性——这正是 D-008 决策记录里已经用血的教训确认过的（`claimedPayoutRoot` 是 non-binding artifact，真正 binding 的是 guest circuit，两者若压成一个"ZK"标签会误导）。

## 1. 六轴定义

每轴独立取值，互不预设关联；一个 Agreement/市场必须给出**六轴齐全**的 Trust Profile，缺一轴视为未声明（不得用"整体 trustless"之类笼统措辞代替逐轴填写）。

### 1.1 `result_source` — 谁说的

声明结果/事实的来源身份。

| 取值 | 含义 | 现状例子 |
|---|---|---|
| `chain-native` | 链上交易/签名本身即是来源，无外部声明主体 | covenant timelock 到期自动退款 |
| `single-institution` | 单一外部机构 | UMA/Polymarket（`polymarket_uma_mirror`） |
| `committee` | 明确成员+阈值的多方 | `pool_committee`（4-of-5） |
| `self-reported` | 参与者自己声明，未经第三方核验 | （当前系统未见此类路径，标注供未来 Domain Protocol 使用）|

### 1.2 `aggregation` — 怎么汇总/多少人同意

`result_source` 若是多方（committee），如何把多个声明汇成一个结论。

| 取值 | 含义 | 现状例子 |
|---|---|---|
| `none` | 单一来源，无汇总环节 | UMA、chain-native |
| `threshold-signature` | N-of-M 门限签名 | `pool_committee` threshold=4 |
| `weighted-stake` | 按质押权重汇总 | VRF 抽样本身按 stake 加权（`pool-committee-sampler.mjs`），但抽样后的表决是等权阈值，非持续加权——**这一格要如实标注抽样加权+表决等权两段式，不能笼统写"weighted"** |

### 1.3 `computation` — 怎么算的

从输入推导结果的方法本身的可验证性。

| 取值 | 含义 | 现状例子 |
|---|---|---|
| `manual-judgment` | 人工/机构主观判断，不可重放 | UMA 的最终判定环节 |
| `deterministic-local` | 确定性算法，每个验证者本地独立可重放，但不强制统一实现 | `enforceCloseAttest`（每个委员节点本地独立验证后才签名） |
| `zk-circuit` | 电路化确定性计算，产出可链上验证的密码学证明 | ZK guest circuit（zkNative markets，D-001 committed 方向） |

### 1.4 `enforcement` — 链强制了什么

covenant/脚本实际在链上校验的范围，不是"用了 covenant"就等于"链强制了正确性"。

| 取值 | 含义 | 现状例子 |
|---|---|---|
| `none` | 链不做内容校验，只搬钱 | 普通转账 |
| `structural-only` | 链校验签名/门限/时间锁等结构条件，不校验分配内容是否正确 | committee-sig covenant（D-001 明确记录"非covenant验payoutRoot·委员盲签"）|
| `full-correctness` | 链上校验分配结果与承诺规则一致（如 Merkle root 校验、ZK proof 校验） | CloseZkV2 对 `guestPayoutRoot` 的 ZK 校验（D-008：binding authority 在 guest circuit）|

**这一轴是本轮红队发现里最容易被误读的一轴**：D-008 记录过 `claimedPayoutRoot` 是"历史遗留 artifact，非 binding"——报 `enforcement=full-correctness` 时必须核实校验的到底是哪个字段，不能因为"这条路径上有 ZK proof"就整体标 full-correctness，要标"对 guestPayoutRoot 是 full-correctness，对 claimedPayoutRoot 是 none（non-binding 展示值）"这种分字段的精确描述，六轴向量本身也可以在必要时对同一 Agreement 的不同子结果分别声明。

### 1.5 `availability` — 服务活性保证

对应 K-16（本轮同批通过、已合入 v0.1）与 §10.2 Liveness：负责产出这个结果的组件离线/阻塞时会发生什么。

| 取值 | 含义 | 现状例子 |
|---|---|---|
| `single-point` | 唯一负责组件失效则整条结果生产停摆，无替代 | 若 UMA API 不可达，`polymarket_uma_mirror` 目前无平行数据源 |
| `retryable` | 失效可自动重试恢复，无需人工，但仍是同一组件 | zk-autonomy tick（每 5 分钟自动重试 propose，本次 kr5l4/9ez2u 事故里就是这个机制在托底）|
| `replaceable` | 多个独立实现/执行者中任一个可完成同一职责 | （当前系统未见此类路径，K-11"off-chain组件必须可替代"目标状态）|

### 1.6 `escape_authority` — 谁能触发/替代退出

对应 K-10：这笔锁定价值的失败出口由谁/什么条件触发，不依赖 result_source 是否正常工作。

| 取值 | 含义 | 现状例子 |
|---|---|---|
| `timeout-automatic` | 到期条件由链上时间/DAA 自动满足，无需任何人签名触发 | covenant deadline timelock 到期退款 |
| `permissioned-manual` | 需要特定身份（admin/operator）手动触发 | 当前 `reclaimBshardMakerBond`/`cancelMarketLive` 等 container② 处置目前都走 Bettor 批字样人工触发（本轮 K-10 发现原文：现有 exit 实现是"点状", 无通用自动门禁）|
| `permissionless-anyone` | 任何人可提交有效证明触发退出 | escape_trigger（ZK track 设计目标，需核实当前落码是否已到此级或仍需白名单）|

---

## 2. §12 Prediction Market Reference Profile 六轴重写（示例，非最终裁定，供 NWT 审核校正）

原文档 §12 单行"Result Authority = 4-of-5 committee、Oracle 或未来明确替代机制"按六轴拆解为至少三条独立 Profile（对应现状并行的三条结算路径，见 J1 对抗轮②交付 `04a9368b`）：

| 路径 | result_source | aggregation | computation | enforcement | availability | escape_authority |
|---|---|---|---|---|---|---|
| Committee-sig（committee/V1） | committee | threshold-signature | deterministic-local | structural-only | retryable | permissioned-manual |
| ZK-native（zkNative markets, D-001） | chain-native（guest circuit 输入承诺后由证明约束） | none | zk-circuit | full-correctness（对 guestPayoutRoot） | retryable（zk-autonomy tick） | permissioned-manual（当前）/目标 permissionless |
| UMA-mirrored | single-institution | none | manual-judgment | structural-only（committee 判定非约束性 parallel judgment，不构成 enforcement） | single-point（待核实是否有降级路径） | 待核实 |

**待办（不在本稿范围内自行拍板）**：UMA 路径三格标"待核实"是诚实标注，不是留白——需要有代码访问权限的人（KANet-UI 或 J2）核实 `polymarket_uma_mirror` 失效时的降级行为、以及该路径下资金的 escape_authority 具体实现，本稿完成前先占位，避免我在不掌握实现细节的情况下猜测发布。

## 3. 与 K-16/K-10 的接口

- `availability` 轴 = K-16（故障隔离）在单个 Agreement 层面的具体声明；K-16 是系统级不变量（"任一链下组件崩溃不得阻止无关资金机继续"），`availability` 轴是把这条不变量落到每个具体路径上的可审计取值。
- `escape_authority` 轴 = K-10（出口必达）的具体声明；本轮同批派工④（money-path/exit-path/fault-domain manifest）里每条 `path_id` 的 `escape_exit` 字段与本轴应保持同一套取值集合，两份文档共用同一份词表（草案：`timeout-automatic` / `permissioned-manual` / `permissionless-anyone`），避免两个新机制各自发明一套命名。

## 4. 迁移路径（不要求一步到位）

1. 本稿定稿后，先在 §12 层面（Domain Protocol reference profile）完成六轴重写（§2 的示例表升级为正式裁定，需③全量市场统计完成后校正 UMA 路径的实际占比数据）。
2. 单个市场级的六轴声明是否需要落进 `pool_markets` 表的具体字段/API 暴露形式，属于 K-07"每个可能改变资金结果的判断必须指出授权来源"落地到 schema 层的问题——这一步建议跟派工④的 manifest schema 一起设计（`path_id` 级别的 manifest 与市场级别的 Trust Profile 是两个不同粒度，但共享同一词表，设计上应该一次性想清楚而不是分两次改 schema），我会在④的稿子里给出对接方案，不在本稿重复设计。
3. 用户端可见性（K-07"付款前必须能验证"）留给 KANet-UI 域评估现有下注确认页面加哪一段展示，本稿只定义规范值，不越域设计 UI。

## 5. 待 NWT 红队的点

1. §2 表格是否有遗漏的第四条并行路径（本稿只覆盖对抗轮②交付里确认过的三条，若有遗漏请指出）。
2. `aggregation` 轴的 `weighted-stake` 取值定义（"抽样加权+表决等权两段式"）是否准确描述 `pool-committee-sampler.mjs` 的实际行为，建议独立读码复核。
3. UMA 路径三个"待核实"格子，请指派或自行核实后回填，不要放着不填直接进入下一步。
