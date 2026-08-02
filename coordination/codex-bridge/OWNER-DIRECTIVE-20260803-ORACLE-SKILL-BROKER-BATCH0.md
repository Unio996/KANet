# 任务卡 · Oracle Skill / Broker 叙事重定位（纸面 artifact 阶段）v0.3

> **状态**: OWNER C-SIGNED — 已授权进入 docs-only 执行；不得据此启动任何代码、部署或 money-path 动作
> **T-authorize**: 2026-08-03T03:50:00+07:00
> **batch**: BATCH-0-DOCS-SIDECAR（文档侧批；不是新路线批次，不改变已冻结 KANet trunk roadmap v1.2 的依赖顺序与第一波优先级）
> **授权来源**: Owner 指令“盘点一下，直接给到开发团队”
> **supersedes**: 2026-08-03 task-card v0.1 与 v0.2 DRAFT；两版保留作审计历史，不得继续作为执行稿
> **来源**: 2026-08-02 v0.1 重定位文档 + 架构师评审（08-03）+ 红队退回意见（08-03）+ Owner 签发前盘点（08-03）

## v0.3 签发前最小修正

1. **批次边界**：批零改为 `BATCH-0-DOCS-SIDECAR`，仅做纸面冻结，不得挤占、暂停或重排既有 must-not-slip 与 v1.2 第一波任务。
2. **Diff 边界**：零代码 Diff 扩展为零非文档 Diff。除 `docs/`、`coordination/` 内本批获准 Markdown 外，`src/`、scripts、tests、migrations、config、数据库、运行态、部署文件一律不得改。
3. **Oracle 三层边界**：FactReceipt / ConditionReceipt / SettlementAuthorization 不仅要分对象，还必须用父对象 digest 串联；禁止复制字段后重新解释而不绑定原凭证。
4. **FactReceipt 语义纠正**：Policy 解释不属于 FactReceipt。`policy_binding` 移入 ConditionReceipt；FactReceipt 只陈述事实、证据、验证方式、时效与用途边界。
5. **Broker 身份诚实边界**：v0 的“地址即身份”是简化预览，不具备跨地址连续身份。未完成链上 lineage/rotation 前，禁止对外声称 Broker 身份“可持续迁移”。
6. **证据钉死纪律**：本卡中的短 hash、标签或简称只作定位线索。任何 `VERIFIED` 交付必须展开为完整 txid / commit SHA / blob SHA / test path / fixture 与复现命令；无法展开则降为 `PARTIAL` 或 `OPEN`。

## 总纪律

本批次全部为纸面 artifact，**零代码、零 schema、零配置、零测试、零数据库、零部署 Diff**。任何 agent 在本批次内改动获准 Markdown 之外的路径，立即停止并报告。

本批次：

- 不启动 Property Vault 代码；
- 不确认 H2 立项；
- 不抽取 Kernel；
- 不授权 mainnet、真实资产、生产部署、签名、广播、退款、claim、grant、wallet 或 relay 动作；
- 不改变 `claim-complete` 与 41 个 `pool_bettor_sides` shard-blind 站点迁移的优先级。

---

## 前置共识（必须先接受再动笔）

### 共识 1 · 委员路径的信任分层（三分证据表，全体新文档统一采用）

| 层 | 内容 | 状态 | 当前证据指针 |
|---|---|---|---|
| **VERIFIED NOW（活性约束）** | 4-of-5 / 5-of-5 签名门限；委员 bond + 失联静默自动罚没 | 链证，但最终文档须补全完整证据 ID | D12 自然失联 forfeit `3a71c12d`；D7 预先-kill `0d87693d`（2026-06-06~07） |
| **TARGET（正确性约束）** | 可归责的“签错 outcome”作恶证明 + slash 闭环 | 未实现 | 无。签错票当前仅受治理/声誉约束，禁止写成“已生效的经济约束” |
| **COVENANT GUARANTEE（数学约束）** | 给定有效 attestation 后：谁能领、领多少、余额如何演化、守恒 | 链证（必须逐路径、逐版本说明） | ZK 路径 `a4343` 全自治 e2e 指针（Σ=520,000,000）；委员路径 settle 多笔，最终文档须补完整索引 |

**措辞禁令**：任何文档禁止无分层地写“没有人拥有自由裁量权”或“委员受经济约束”。委员门限决定系统**接受哪个 outcome**；covenant 只保证**被接受的 outcome 如何映射为合法输出**。当前并无可归责“签错 outcome”自动 slash 闭环。

### 共识 2 · Oracle Skill 现阶段 = 接口冻结文档

不是代码重构。低 Diff 复用验证载体 = EK-H1-INSTANCE-2（covenant-native digital asset receipt），不另开赛道。

### 共识 3 · Track 强制隔离

开放 Broker = Track B 角色规范（第三方 fork 运营）；Owner 的 Trader-B broker = Track A 个人工具。任何文档不得合并叙述。

### 共识 4 · 文档侧批不得重排主路线

本批可与主路线并行，但只可占用明确指派的文档产能。任何主路线 DRI 因本批发生延期，Bettor 必须立即记录冲突并优先恢复原任务；不得以“Owner 已签发新叙事”为理由降级旧 Gate。

---

## TC-01 · DECISIONS.md 候选条目 + 统一术语冻结

- **指派**: Bettor（起草）→ NWT（红队）→ Owner（批准）
- **batch**: BATCH-0-DOCS-SIDECAR
- **ACK**: Bettor 须在 T-authorize 后 1h 内具名 ACK，或记录精确阻塞原因
- **截止**: 2026-08-05T03:50:00+07:00 前出 DRAFT
- **交付物**:
  1. DECISIONS.md 候选条目一条（DRAFT）：KANet 定位 = Agent 应用；显式 supersedes 旧对抗文档三处定性（escrow 降格 / “条件放钱尚未实现”误写 / Broker 角色抹除）；
  2. **统一术语冻结页**（TC-02/03 并行起草的前提），一处定义、全批引用：
     - FactReceipt = 对外部事实与其证据/验证方式的不可歧义陈述；
     - ConditionReceipt = 对指定 FactReceipt digest 按指定 policy id/version/hash 得出的条件判断；
     - SettlementAuthorization = 对指定 ConditionReceipt digest、输入状态与允许输出/状态迁移的授权；
     - broker 身份 v0 定义与其不可持续迁移边界；
     - 共识 1 三分证据表措辞；
  3. 先列明欠账的 ZK / rolling-shard D-number、时间与来源，再按时间顺序补齐；本条目不得插队，也不得自行猜测新 D-number。
- **禁止**:
  - 禁止删除或改写旧对抗文档正文（supersede 走 D-number，原文留档）；
  - 禁止 J2 参与条目改写（J2 仅限状态核实）；
  - 禁止在 Owner 批准术语页前启动 TC-02/03 正文写作。

## TC-02 · Oracle Skill 接口冻结文档 v0（FactReceipt 信封 + 三层分离）

- **指派**: J1（主笔）+ NWT（对抗审）；与 TC-03 并行，以 TC-01 Owner 批准的术语页为前提
- **batch**: BATCH-0-DOCS-SIDECAR
- **截止**: TC-01 术语页获 Owner 批准后 72h
- **交付物**: `docs/` 下接口冻结文档一份，至少包含：

### 1. FactReceipt 通用凭证信封冻结（字段级）

```text
FactReceipt
- version / schema_id
- domain / context_id / subject
- claim_type / claim_value
- evidence_ref:
  - digest_alg / digest
  - evidence_type / availability_class
- verifier_binding:
  - mode
  - verifier_or_issuer_set_ref
  - threshold_or_acceptance_rule_ref
- observed_at:
  - time_basis / value / anchor_ref
- valid_until (optional; same time basis)
- nonce / intended_use
- correction_ref (optional; corrections create a new receipt and point to the old receipt)
```

字段冻结必须同时定义：

- required / optional / null 语义；
- canonical serialization；
- digest domain separation；
- 网络、命名空间与 context 防串用；
- wall-clock、DAA、block anchor 等 time basis 的允许集合与比较规则；
- nonce、防重放、过期、纠正与撤销语义；
- evidence 不可再取回或被 pruning 后，digest 仍能证明什么、不能证明什么。

**不得把 `issuer_set / threshold` 强塞给所有路径。** 单签、委员会门限、链上交易验证、manual、oracle 与 ZK proof 必须通过 `verifier_binding.mode` 区分。

### 2. 三层产物强制分离并以 digest 串联

- **FactReceipt**：外部发生了什么；不包含 Policy 对事实的解释。
- **ConditionReceipt**：必须绑定 `fact_receipt_digest` + `policy_id/version/hash`，说明 Policy 如何解释该事实及判断结果。
- **SettlementAuthorization**：必须绑定 `condition_receipt_digest` + 输入状态引用 + 允许的状态迁移/输出结构/守恒约束/时效与重放边界。

禁止三层共用一个可变对象；禁止只复制上层字段、不绑定父对象 digest；禁止 `marketMetadataHash` 被表述成“解释事实的规则本身”。它是规则绑定/防换规则机制之一。

### 3. 现有实例映射表（归纳材料，非接口本体）

- Exchange verifiers：`cross_chain_tx / kaspa_tx / manual / oracle`；
- Prediction：委员 attest、Groth16 与 covenant spend path；
- 逐项映射到 FactReceipt / ConditionReceipt / SettlementAuthorization；
- 每条路径分别列明：谁产生、谁验证、绑定什么、能拦什么、拦不住什么、当前证据等级。

### 4. 信任与证据表

采用共识 1 三分证据表；所有 VERIFIED 项必须补全完整不可变引用。短 hash 或频道标签不能作为最终证据。

### 5. Property Vault 兼容条款（仅一段，不展开）

Oracle Skill v0 的命名空间、context 绑定、时效、防重放与凭证用途不得与 Prediction 或 Exchange 业务绑定；接口应允许未来由 Property Vault 作为第三异质实例做复用检验，但本批次不确认 H2 立项、不抽取 Kernel、不产生非文档 Diff。

- **禁止**:
  - 禁止代码重构、helper 抽取、schema migration；
  - 禁止封闭措辞（规则 46）；必须设置 VERIFIED / PARTIAL / OPEN 分栏；
  - 禁止因“接口冻结”而反向声称现有两个实例已经实现该统一对象模型。

## TC-03 · Broker 开放角色规范 v0（Track B spec）

- **指派**: Bettor（主笔）+ NWT（合规红队）；与 TC-02 并行，以 TC-01 Owner 批准的术语页为前提
- **batch**: BATCH-0-DOCS-SIDECAR
- **截止**: TC-01 术语页获 Owner 批准后 72h
- **交付物**: Track B 公开规范文档一份，至少包含：

### 1. Broker 五件事

找需求 / 入口 / 路由 / 佣金权预写入 / 链上分佣。

### 2. 身份 v0 定义（显式简化，不冒充终态）

- v0 身份 = Kaspa 地址；地址变化 = 新身份；
- v0 不提供跨地址连续身份，不得对外称为“可持续迁移”；
- 旧订单的佣金领取权只按各自已冻结合约字节与 spend path 判断；v0 身份表无权改写旧合约。是否“删/改小/冒领必被拒”必须以逐路径负向测试证明，未证明前不得作协议级保证；
- **硬禁令**：不得通过本地数据库、Telegram DM、人工备注或运营 flag 将两个地址认定为同一 Broker；
- v1 候选字段（列出不展开）：`broker_id / active_control_address / payout_address / previous_state / rotation_nonce / effective_from / status`；
- 只有未来链上 lineage/rotation 机制通过对抗测试后，才允许讨论“持续身份迁移”。

### 3. 证据索引表（必附）

```text
claim | enforcement_layer | full txid/test/fixture/commit/blob | positive evidence | negative test | known bypass | status: VERIFIED / PARTIAL / OPEN
```

起草时必须如实分级：

- “链上真实分佣发生过” → `a4343` 为定位指针，broker 9,880,000 sompi 与盲值吻合 → 可先列 **VERIFIED（第 4 级：某次真发生）**，但发布前必须补完整交易/输出索引；
- “佣金权被协议强制执行，删/改小/冒领会被拒” → 负向对抗测试未做 → **PARTIAL**；
- `getBrokerFeeRate/getBrokerFeeKas` → 仅证明软件计算能力，不支撑协议强制主张；
- 文档必须定义五级证明强度，明确第 4 级“某次真发生”不等于第 5 级“对抗测试证明边界被强制执行”。

### 4. 待建能力（OPEN）

- permissionless broker enrollment（身份集合只许链上派生）；
- 订单归因标准与防冒领；
- 多 Broker 并存路由；
- 链上身份 lineage/rotation（作为“可持续迁移”的前置，不得藏在 v1 注脚里）。

### 5. carrier-thesis 合规节（必有）

本规范为 Track B spec，供第三方 fork 部署；Owner 不运营面向外部用户的收佣 Broker；Owner 的 Trader-B broker 属 Track A 个人工具，运营隔离；mainnet 一律使用 “if deployed” 措辞。

- **禁止**:
  - 禁止暗示 Owner 正在或将要运营外部收佣 Broker；
  - 禁止把 Track A broker 实现细节（`C:/KANet` 侧）写入公开 spec；
  - 禁止把第 4 级证据写成第 5 级结论；
  - 禁止将地址可更换、钱包恢复或 DB 映射描述为协议身份迁移。

## TC-04 · v0.1 定位文档修订为 v0.2

- **指派**: Bettor（执笔）；仅合并已经 NWT + Owner 批准的修正，不新增叙事
- **batch**: BATCH-0-DOCS-SIDECAR
- **截止**: TC-02/03 交叉审通过后
- **交付物**: v0.2 定位文档，改动限四处：
  1. “没有人拥有自由裁量权”→ 共识 1 三分证据表；
  2. Broker 章节加 Track 标注与合规段；
  3. Broker 五件事按证据索引表分级引用（VERIFIED / PARTIAL / OPEN）；
  4. “条件放钱已经存在”补分路径、分版本限定与诚实边界。
- **禁止**: 禁止扩写新叙事；Rule 49 最小 Diff 适用于文档。

## TC-05 · Gate：must-not-slip 不降级声明

- **指派**: Bettor（在 `docs/iteration/COORD-LEDGER.md` 记录）；持续生效，作为全批发布 Gate
- **batch**: BATCH-0-DOCS-SIDECAR
- **截止**: 与 TC-01 同步落账；任何 TC-02/03 正文动笔前必须可见
- **内容**:
  1. `claim-complete`：`ok:true` 假完成根治 + claim/refund 互斥 latch + require 溯源 attested root；
  2. 41 个 `pool_bettor_sides` shard-blind 站点迁移；
  3. 上述两项优先级不因本批降低；
  4. 对外公开引用“条件放钱已存在”，必须以上述两项关闭为前提；未关闭时只能携带与 `a4343` 交卷同规格的诚实边界段，且不得把局部已证路径推广为全系统能力。

---

## 执行与发布顺序

```text
T-authorize
  ├─ Bettor 1h 内 ACK / BLOCKER
  ├─ TC-05 先落 Gate
  └─ TC-01：D-number 欠账盘点 + 术语页 + supersedes 方向
        └─ NWT 红队 → Owner 批准术语页
              ├─ TC-02（并行）
              └─ TC-03（并行）
                    └─ NWT 交叉审
                          └─ Owner 对 TC-02/03 作发布批准
                                └─ TC-04 仅合并已批修正
```

**发布 Gate**：TC-02、TC-03 即使完成 NWT 交叉审，也不得自动变成公开规范；须由 Owner 对精确文档 blob 作最终批准。TC-04 不得先于该批准合并。

## 每份交付物统一回执格式

```text
[TASK RECEIPT]
task_id:
status: DRAFT / GREEN / GREEN-WITH-NOTES / BLOCKED
branch:
base_commit:
source_commit_or_blob:
changed_paths:
non_doc_diff_count: 0
claims_verified:
evidence_full_ids:
open_claims:
known_bypasses:
NWT_verdict_ref:
Owner_action_required:
```

## 签发页

- [x] Owner 审阅 v0.2 并批准以 v0.3 最小修正签发
- [x] 共识 1 三分证据表确认
- [x] batch 调整为 `BATCH-0-DOCS-SIDECAR`
- [x] C-sign：2026-08-03T03:50:00+07:00
- [ ] Bettor 具名 ACK（截止 2026-08-03T04:50:00+07:00）
- [ ] TC-05 Gate 已写入 COORD-LEDGER
