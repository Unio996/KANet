# Owner Directive · KANet 作为 Kaspa 后 Toccata 应用栈的制度性压力测试器 v1.0

> **状态**: OWNER C-SIGNED — 已授权进入基线冻结、证据盘点与测试设计；不得据此直接启动代码、部署、迁移或 money-path 动作
> **T-authorize**: 2026-08-07T01:55:48+07:00
> **batch**: POST-TOCCATA-INSTITUTIONAL-STRESS-TEST / BATCH-0-DOCS-EVIDENCE-SIDECAR
> **授权来源**: Owner 指令“整理一下，发给开发团队”
> **优先级边界**: 本批是 docs/evidence sidecar，不改变冻结中的 trunk roadmap、must-not-slip、Oracle Skill / Broker BATCH-0 的顺序或 Gate
> **决策编号边界**: 本文不自行占用新的 D-number；是否进入 DECISIONS.md、使用何编号，须先盘点当前决策序列并按既有流程提交候选条目

## 一、为什么这件事值得做

这不是生态宣传，也不是新增一个产品方向。它把 KANet 的外部价值从“第一个跑起来的非核心应用”提高为：

> **Kaspa 后 Toccata 应用栈的第一个制度性压力测试器。**

协议能力进入 GitHub、SDK 或测试网，只能证明 machinery 开始可测试。它何时能被称为 usable infrastructure，必须由外部应用在恶意输入、基础设施失效、运营方退出和版本变化中证明。

真正的分水岭不是“第一个成功运行的应用”，而是：

> **第一个在原运营方退出后仍能继续运行、验证、退出和迁移的应用。**

因此，KANet 的任务不是替 Kaspa 核心团队宣布协议已经成熟，而是把协议承诺拆成可复现的系统性质，逐项证明或明确标成尚未证明。

## 二、立即冻结的五条判断边界

### 1. Legacy cleanup 不是 covenant 语义 ossification 的充分证明

Legacy cleanup 当前主要证明：

1. 旧执行路径被删除；
2. 开发、测试和维护资源集中到新规则；
3. 回到 pre-Toccata 的工程成本显著提高。

KANet 需要区分三层稳定：

| 层 | 含义 | 当前可主张状态 |
|---|---|---|
| 代码路径稳定 | 不再保留旧执行分支 | cleanup 可直接支持 |
| 接口稳定 | descriptor、covenant ID、序列化、sighash 不被 SDK/钱包升级静默改变 | cleanup 仅部分暗示，须测试 |
| 语义稳定 | 未来升级或硬分叉不重新解释既有 covenant 的约束含义 | 尚不能由 cleanup 自动推出 |

**措辞 Gate**：在跨 SDK、版本和钱包的独立测试向量完成前，禁止把“legacy cleanup”写成“covenant 语义已经 ossified”。

### 2. Authenticated snapshot 是运营方可替换的必要条件，不是 permissionless exit 的充分条件

运营方真正可替换，至少同时要求：

1. 新运营方无需原运营方授权即可取得状态材料；
2. snapshot 可独立对 L1 anchor 验证；
3. 从 snapshot 继续执行能得到唯一、可复现的下一状态；
4. proving key、程序版本、descriptor 与历史规则仍可获得；
5. 原运营方消失后，用户仍可触发退出或迁移；
6. snapshot 作恶、过期、不完整或停止服务时，系统能识别并恢复；
7. 最新必要数据具有不依赖单一运营方的数据可获得性。

冻结结论：

> **Authenticated snapshot 是“可替换运营方”的必要条件；permissionless exit 还必须由资产层退出路径和数据可获得性共同保证。**

即使任何人能重建 SMT，只要资金退出仍需要原运营方签名，或最新状态只由原运营方掌握，operator 仍不是 commodity。

### 3. Circuit 证明处分资格，透明 UTXO 与 covenant 承担价值守恒

冻结原则：

> **Circuit 负责证明谁在什么状态下取得何种处分资格；透明 UTXO 与 covenant 负责保证总价值没有被凭空创造、隐藏或越权转移。**

推荐责任边界：

| 层 | 放置内容 |
|---|---|
| vProg 热状态 | 账户、订单、积分、角色、交付结果 |
| ZK / circuit | 状态转移与资格判断正确性 |
| 透明 UTXO | 真实价值与可审计资产基数 |
| covenant | 价值守恒、合法输出路径、退出约束 |

这不排斥 circuit 处理价值逻辑；它禁止“升级 circuit 或 proving key”事实上等于无外部约束地改写资产负债表。

### 4. Oracle 不是一个 API，而是四个制度问题

每条 truth input 路径必须分别回答：

1. 谁有资格观察和报告？
2. 报告引用的证据能否被其他人复核？
3. 报告者串谋或失联时，系统在技术上和经济上如何处理？
4. 现实存在歧义时，谁拥有最终裁决权，是否允许延期、申诉与纠正？

**定位 Gate**：Task #12 / Oracle truth layer 不是外围组件，而是 KANet 能否从“自动结算程序”成为“可信经济网络”的关键层。执行越自动，错误事实造成的损失越快、越不可逆。

### 5. Indexer 是搜索与展示层，不是 money path 的事实权威

多输入、P2SH、covenant 与 PSKT 条件下，“from_address”未必是 UTXO 原生且唯一的事实。

结算核心必须依赖：

- outpoint 与 prevout；
- 实际解锁条件；
- covenant ID；
- 经验证的交易图；
- L1 确认状态。

**安全 Gate**：Indexer 可用于搜索和展示，不得成为安全判断的唯一事实来源。两个 indexer 给出矛盾解释时，结算核心仍必须从 L1 原生材料独立得出唯一结果。

## 三、本批工作包：只做基线、证据和测试设计

### ST-00 · 对外主张清单与证据分级

- **DRI**: Bettor
- **支持**: KANet-UI
- **交付物**: 一张完整 claim inventory，逐项标注 PROTOCOL / CURRENT / TARGET / DEMO / OPERATOR-POLICY 与 VERIFIED / PARTIAL / OPEN。
- **必须纳入的高风险措辞**:
  - covenant semantics ossified；
  - operator is commodity；
  - permissionless exit；
  - snapshot guarantees recovery；
  - circuit guarantees value conservation；
  - indexer reconstructs canonical money flow；
  - KANet is usable infrastructure。
- **Gate**: 未通过证据分级前，以上措辞不得作为无条件系统性质对外发布。

### ST-01 · Covenant 跨实现确定性与语义测试向量

- **DRI**: J2
- **红队**: NWT
- **设计交付物**:
  1. canonical descriptor corpus；
  2. descriptor bytes、covenant ID、serialization、sighash 的 byte-exact 期望值；
  3. 合法交易与非法交易判定向量；
  4. SDK 版本 × 钱包 × PSKT 实现矩阵；
  5. 版本升级漂移检测与 fail-closed 规则。
- **验收原则**: 同一个 descriptor 在不同受支持 SDK、版本和钱包中必须产生相同 covenant ID，并对同一合法/非法交易给出一致判断。
- **当前批边界**: 只冻结 corpus 结构、版本矩阵、判定标准与证据格式；不得改 live compiler、SDK、wallet 或 covenant。

### ST-02 · Snapshot 与运营方可替换性矩阵

- **DRI**: J1
- **协议复核**: J2
- **红队**: NWT
- **设计交付物**:
  1. 获取 snapshot 是否需要 incumbent consent；
  2. L1 anchor 独立验证步骤；
  3. deterministic resume 判定；
  4. program / proving key / descriptor / historical rule availability；
  5. stale、malicious、partial、withheld snapshot 的识别与恢复；
  6. pruning window 之后的状态恢复；
  7. 原运营方永久消失后的用户退出或迁移路径。
- **判定**: “SMT 可重建”不得单独升级为“运营方可替换”或“用户可无许可退出”。

### ST-03 · 资产层退出与数据可获得性

- **DRI**: J2
- **协作**: J1
- **交付物**: 每条真实价值路径的退出依赖图，列出所需签名、数据、程序、key、anchor、timelock、fallback 与最后可用恢复来源。
- **必须回答**:
  - proving service 停止时，用户如何退款或退出？
  - incumbent 拒签时，是否存在 covenant/timelock 级替代路径？
  - 最新状态仅由 incumbent 掌握时，谁能恢复？
  - lane 历史被剪枝后，哪些数据必须外部持久化，谁可验证？
- **安全结论**: 没有资产层可执行退出，不得把状态可重建宣传为主权可迁移。

### ST-04 · Circuit / UTXO / Covenant 会计边界

- **DRI**: J2
- **红队**: NWT
- **交付物**:
  1. 当前每条 money path 的价值定义权位于何层；
  2. circuit 或 proving key 升级能改变哪些状态与金额；
  3. UTXO 总额、输入、输出、费用、残值如何独立守恒；
  4. 程序版本替换、key rotation 与旧状态/旧资产的兼容和退出；
  5. “升级程序即可改写负债表”的负向测试设计。
- **Gate**: 任何新 account-model flow 在该边界未说明前，不得进入 money-path 实现。

### ST-05 · Oracle truth / dispute / correction 制度矩阵

- **DRI**: J1
- **协调**: Bettor
- **红队**: NWT
- **交付物**: 对每种 FactReceipt / ConditionReceipt 路径回答观察资格、证据复核、串谋/失联、最终裁决、延期、申诉、纠正、时效与经济后果。
- **必须覆盖**:
  - 委员分裂；
  - 阈值刚好无法形成；
  - 多数签署错误事实；
  - 证据随后被撤回或纠正；
  - 现实事实长期歧义；
  - 自动结算已执行后的错误恢复边界。
- **Gate**: “接入 Oracle API”不得被表述为 truth layer 已解决。

### ST-06 · L1 原生事实与 Indexer 分歧测试

- **DRI**: J1
- **协议复核**: J2
- **交付物**:
  1. money path 使用的 canonical L1 fields；
  2. from_address 等便利字段的 display-only 标注；
  3. 两个 indexer 矛盾、indexer 延迟、漏数、错误归因时的独立判定流程；
  4. multi-input、P2SH、covenant、PSKT、reorg/confirm 的测试 corpus；
  5. 无 indexer 条件下最小安全结算/恢复路径。
- **Gate**: 无法在 indexer 分歧或不可用时独立判定，则该路径不得标 VERIFIED。

### ST-07 · 制度性失败场景 corpus

以下场景必须进入统一 failure corpus，而不是散落在普通 happy-path 测试中：

1. 原 vProg 运营方突然永久消失；
2. snapshot 恶意、过期、不完整或被扣留；
3. lane 历史已经越过 pruning window；
4. 两个 indexer 给出矛盾结果；
5. Oracle 委员会分裂、串谋或失联；
6. 钱包只完成部分签名；
7. SDK 升级导致 descriptor 序列化或 covenant ID 漂移；
8. 费用突然上升或交易撞上 880-wall；
9. proving service 停止，但用户要求退款退出；
10. application operator 试图更换程序版本或 proving key；
11. 新运营方从同一 snapshot 得出不同 next state；
12. 用户拥有全部资产证明，但 incumbent 拒绝配合退出。

每个 case 必须包含：

- 前置状态与精确版本；
- 注入故障或恶意行为；
- 可观察量；
- 预期 fail-safe / fail-closed 行为；
- 恢复与退出动作；
- 不变量；
- 完整证据引用；
- PASS / PARTIAL / FAIL / NOT-RUN。

## 四、执行顺序与权限边界

### BATCH-0（本次已授权）

1. Bettor 具名 ACK 或给出 blocker；
2. ST-00 先建立 claim inventory；
3. ST-01 至 ST-06 只提交设计、现状盘点与证据缺口；
4. ST-07 汇总成统一 failure corpus；
5. NWT 做跨项红队，特别检查“必要条件被写成充分条件”的偷换；
6. Bettor 提交一份优先级建议，但不得自动改写 trunk roadmap。

### BATCH-1（未授权）

- 编写离线 harness、fixtures、cross-version runner；
- 拉取或安装新 SDK / wallet；
- 生成或替换 proving key；
- 修改 compiler、circuit、descriptor、covenant、wallet、indexer 或 runtime。

### BATCH-2（未授权）

- TN12 live fault injection；
- 停止运营方/prover/indexer；
- 触发退款、退出、签名、广播、重启、迁移；
- 任何 mainnet、真实资产或 production 行动。

BATCH-1/2 必须以精确路径、版本、风险、回滚和证据计划另行送审。本文不构成授权。

## 五、统一验收语言

今后涉及 Toccata 应用底座，统一采用以下结论层级：

| 层级 | 可用措辞 |
|---|---|
| PROTOCOL CAPABILITY | 协议提供了某能力或原语 |
| TESTABLE MACHINERY | 已能被外部应用组装并设计/执行测试 |
| VERIFIED PATH | 某一精确版本、路径和条件已经通过完整证据验证 |
| USABLE INFRASTRUCTURE | 多实现、失败、退出、恢复与升级场景均满足已冻结不变量 |
| NOT PROVEN | 尚无足够证据，不得用推断补齐 |

当前总判断冻结为：

> **Toccata 后的 GitHub 活动证明 Kaspa 核心团队正在把新协议能力转化为长期维护、可测试的应用 machinery；它尚未证明应用运营方已可无许可替换、状态能在制度性失败中存续、链外事实具有足够经济安全，或普通团队能绕开核心开发者独立上线。Legacy cleanup 提供不可逆的工程承诺，authenticated snapshot 可能提供运营方可替换性的关键基础，而 KANet 将检验这些承诺能否在真实应用、恶意输入、基础设施失效和组织退出中转化为系统性质。**

因此，现阶段准确的演进表述是：

> **protocol capability → testable machinery**

只有在上述失败场景中完成可复现验证，才允许升级为：

> **usable infrastructure**

## 六、回执要求

- Bettor：请在 2026-08-07T08:00:00+07:00 前具名回复 ACK 或精确 blocker。
- 首份交付：ST-00 claim inventory + ST-07 failure corpus skeleton，目标时间 2026-08-08T02:00:00+07:00。
- 完整 BATCH-0 DRAFT：目标时间 2026-08-10T02:00:00+07:00；如与 must-not-slip 冲突，以主路线为先并记录顺延原因。
- NWT 必须独立检查每一项是否混淆 capability、necessary condition、sufficient condition 与 verified system property。
- 无 ACK 不得报告“团队已经开始”；无完整 evidence 不得报告 VERIFIED。

统一回执格式：

~~~text
[TASK RECEIPT]
task_id: POST-TOCCATA-STRESS-TEST / ST-xx
agent:
status: ACK / IN_PROGRESS / BLOCKED / READY_FOR_REVIEW
branch:
base_commit:
source_commit_or_blob:
changed_paths:
non_doc_diff_count: 0
claims_verified:
claims_downgraded:
evidence_full_ids:
open_claims:
known_bypasses:
next_action:
NWT_review_required:
Owner_action_required:
~~~

## 七、签发页

- [x] Owner 确认该方向有意义并要求整理后发给开发团队
- [x] 本批限定为 docs/evidence sidecar
- [x] 未授权代码、部署、迁移、签名、广播或 money-path
- [x] 未自动修改 trunk roadmap 优先级
- [x] 未自行占用 D-number
- [ ] Bettor 具名 ACK
- [ ] ST-00 claim inventory 建立
- [ ] ST-07 failure corpus skeleton 建立
- [ ] NWT 完成“必要条件≠充分条件”红队
