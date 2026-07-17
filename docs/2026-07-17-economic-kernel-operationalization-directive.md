# Economic Kernel v0.1 — Owner 裁决与操作化指令

> **Status**: CURRENT — OWNER DIRECTIVE / P0 设计与调查授权

**日期：** 2026-07-17  
**适用范围：** Economic Kernel、Oracle / Verifier、结算输入、资金出口、管理权限、进程分离与 API 收敛  
**执行纪律：** 本文授权规范合并、现状调查、schema / manifest 设计和故障验收设计；任何生产代码、数据库迁移、live 进程切换仍须遵守开发框架的报备、红队、批准、测试与装载流程。

## 0. 一句话裁决

KANet 的研发方向从“继续堆功能”正式转为“用协议宪法反查现实系统”。

Economic Kernel 不能停留在目标宪法和差距清单。下一阶段必须把宪法压成：

- 机器可读 manifest；
- merge / deploy 门禁；
- 故障注入测试；
- 用户付款前可见的多轴 Trust Profile；
- 可独立复算的 VerifiedSettlementInputs；
- 能力级管理权限；
- 按真实架构而不是 URL 名字推进的 API / 进程迁移。

在这些门禁形成前，禁止用“文档已经正确”替代“系统已经符合”。

## 1. 输入材料与当前事实

本文不替代 Owner 原文裁决，而是把它转换成工程依赖、schema、门禁和 DoD。权威原文见：

- `docs/2026-07-16-owner-ruling-economic-kernel-round2.md`

本文综合以下已入库材料：

1. `docs/2026-07-15-KANet-Economic-Kernel-v0.1.md`；
2. `docs/2026-07-15-J1-redteam-economic-kernel-oracle-verifier-exit-review.md`；
3. `docs/2026-07-15-NWT-redteam-economic-kernel-K-invariant-completeness-audit.md`；
4. `docs/2026-07-15-process-separation-batch1-api-convergence-design.md`；
5. 7/13–7/15 live 事故：同步 SQLite 查询、事件循环冻结、通讯与资金 worker 共故障域、kill switch 连坐、watchdog / supervisor 恢复问题。

当前状态必须诚实表述：

- Economic Kernel 仍是“目标宪法 + 现状差距清单”；
- K-16 尚未并入 v0.1；
- J1 / NWT 红队结论尚未规范化合入；
- Batch 1 的 C 信任边界和逐端点数据访问表仍未完成；
- 因此尚未形成机器可执行的准入制度。

## 2. Owner 裁决总表

| 发现 | 裁决 | 当前动作 |
|---|---|---|
| 新增 K-16 Fault Containment | **接受，进入 v0.1** | 先改规范、设计故障注入验收 |
| Oracle / Verifier 命名坍缩 | **接受问题，不批准立即大规模改表** | 先固定规范名、兼容视图和迁移表 |
| T2 / T3 真实权威未公开 | **接受，严重度高于命名问题** | 市场创建、API、UI、Agreement commitment 全部必须显式声明 |
| 单值 T0–T4 Trust Profile | **废止为全局表达** | 改成多轴信任向量；T0–T4 仅可作为单轴分类 |
| K-10 只有文档没有门禁 | **接受** | 建 money-path / exit-path / fault-domain manifest 和 CI gate |
| feeSplit caller-fed 即违反 K-01 | **不接受该笼统结论** | 保持纯函数；补统一 VerifiedSettlementInputs 适配边界 |
| ADMIN_SECRET 权限耦合 | **接受** | 先做能力矩阵和 break-glass 设计，再迁移密钥 |
| Batch 1 API 收敛可直接落码 | **不批准** | C、数据访问表、故障验收完成前 HOLD |
| v06 与 v07 只是一旧一新 | **否定** | 定义为不同 settlement_profile：flat 与 sharded |

## 3. K-16 正式进入 v0.1

### 3.1 规范文本

> **K-16 — Fault Containment**
>
> 每个生产部署必须公开其故障域和共享依赖。任一链下组件的崩溃、阻塞或资源耗尽，不得阻止无直接依赖的资金状态机继续结算、退款或进入可达出口。

K-11 与 K-16 正交：

- K-11 回答“谁拥有权威”；
- K-16 回答“谁的故障能感染谁”。

“拆成多个进程”不等于满足 K-16。如果进程仍共享无边界同步数据库写、无上限队列、同一 kill switch、同一密钥或单一通讯面，故障域仍可能耦合。

### 3.2 必须通过的故障注入

| 注入 | 必须保持的能力 |
|---|---|
| Broker worker 阻塞 30 秒 | API 有界响应；Settlement worker 继续推进 |
| Telegram / owner-bot 故障 | 已存在资金路径仍能退款或进入 timeout / escape |
| 单个子进程内存耗尽退出 | 该进程独立重启；其他资金状态机不重启 |
| 队列生产者持续超速 | 队列有上限、超时、拒绝或降级；不得把 OOM 转移给消费者 |
| API 进程冻结 | 生命周期 owner 不依赖 API 事件循环继续推进 |
| 非资金 worker kill switch | 不得关闭唯一结算、退款或 escape worker |
| SQLite 写锁 / 慢查询 | 无直接依赖的进程仍能读健康状态并推进独立资金路径 |

验收报告必须记录：

- 注入时刻；
- 受影响进程和依赖；
- API 最大延迟；
- settlement / refund / escape 前沿是否推进；
- 队列深度和丢弃 / 重试策略；
- 重启时间；
- 是否出现跨故障域传播。

## 4. 单值 Trust Profile 改为信任向量

### 4.1 规范决定

禁止继续用单个 T1、T2 或 T3 表示一个市场的整体可信度。

签名只证明谁说的，ZK 只证明怎么算的，委员会说明多少人同意，covenant 说明链强制了什么，运维与 escape policy 决定系统是否活着以及失败后谁能介入。这些必须分轴表达。

### 4.2 最小信任向量

    trust_profile:
      schema_version: kanet.trust-profile.v1
      result_source:
        class: T0 | T1 | T2 | T3 | T4
        authority_id: string
        source_ref: string
        evidence_commitment: bytes32 | none
      aggregation:
        class: T0 | T1 | T2 | T3 | T4
        method: none | threshold-signature | quorum | other
        threshold: string | none
        member_set_commitment: bytes32 | none
      computation:
        class: T0 | T1 | T2 | T3 | T4
        method: direct | deterministic-code | groth16 | risc0 | other
        verifier_id: string
        program_commitment: bytes32 | none
      enforcement:
        class: T0 | T1 | T2 | T3 | T4
        method: covenant | operator-broadcast | other
        template_or_rule_commitment: bytes32 | none
      availability:
        class: T0 | T1 | T2 | T3 | T4
        required_workers: [string]
        fault_domain: string
        timeout_policy: string
      escape_authority:
        class: T0 | T1 | T2 | T3 | T4
        authority_id: string | none
        conditions: string
        commitment: bytes32 | none

典型组合：

    result_source: T3 — Polymarket Gamma / upstream UMA
    aggregation: T2 — 4-of-5 committee
    computation: T1 — Groth16 circuit
    enforcement: T0 — Kaspa covenant
    availability: T4 — current KANet operators and workers
    escape_authority: T4 — disclosed escape policy

### 4.3 暴露要求

每个新市场必须在以下四个位置使用同一份 canonical trust profile：

1. 创建返回和 Agreement；
2. 外部 API；
3. 用户付款前 UI / Telegram 确认页；
4. Agreement commitment 或可验证引用。

不得由 UI 自行拼接一个与 Agreement 不同的简化真相。允许展示层摘要，但必须能展开查看完整向量和 commitment。

### 4.4 兼容迁移

Oracle / Verifier 的旧列名暂不大规模改表。先完成：

1. canonical 规范名称；
2. 旧字段 → 新轴的映射表；
3. 只读兼容 view / adapter；
4. 双读一致性统计；
5. 新写入只写 canonical 结构；
6. 历史迁移计划经单独审批后再执行。

禁止先 rename 大表再补语义。

## 5. 立即生成现行市场 Result Authority 清单

“多数市场由 UMA 绑定”在没有实时统计前不得进入公开口径。

清单必须覆盖所有现行市场，并至少包含：

| 字段 | 要求 |
|---|---|
| market_id / logical_market_id | 能定位 flat 与 sharded 市场 |
| settlement_profile | v06_flat 或 v07_sharded |
| protocol_version | 原始协议版本 |
| active_pool_sompi | 当前活跃资金 |
| bettor_count | 去重用户或明确统计口径 |
| outcome_oracle_hook | 原始配置和值来源 |
| result_source | 最终外部事实源 |
| aggregation | 是否委员会、阈值与成员集合 |
| computation | 是否 zk-native、程序 / verifier 标识 |
| enforcement | covenant 或 driver-side |
| availability | 必需 worker 与故障域 |
| escape_authority | timeout / escape 的最终权限 |
| payout_authority | 最终允许 payout 的证据链 |

必须输出三种加权口径：

1. 按市场数量；
2. 按活跃资金量；
3. 按 bettor 数量。

其中资金量和 bettor 数量优先于裸市场数量。报告必须带查询时刻、数据库快照标识和查询脚本摘要，禁止把一次性口头统计当长期真相。

## 6. feeSplit 边界：一个计算核、两种入口

### 6.1 裁决

feeSplit 作为纯函数接受参数本身不违反 K-01。

正确边界是：

    链上事实
      → VerifiedSettlementInputs
      → feeSplit
      → SettlementPlan

禁止让 feeSplit 自己访问链、数据库或网络；也禁止因为某条入口需要验证就复制第二套 fee 计算逻辑。

### 6.2 VerifiedSettlementInputs 最小字段

    VerifiedSettlementInputs:
      schema_version
      market_id
      settlement_profile
      source_outpoints[]
      source_txids[]
      confirmation_depth
      agreement_commitment
      fee_rules_commitment
      bettor_set_commitment
      payout_or_winner_commitment
      pool_sompi
      winner_authority
      verifier_identity
      verification_method
      input_commitment
      verified_at_daa
      provenance[]

约束：

- 每个金额必须能回指 txid / outpoint；
- fee rules 必须匹配 Agreement commitment；
- bettor set 与 payout / winner commitment 必须明确区分；
- verifier_identity 不能只是调用者自报字符串；
- input_commitment 必须覆盖传给 feeSplit 的 canonical bytes；
- V2 委员路径已有的独立读取与复算能力应成为 adapter 的实现证据，而不是被重写。

### 6.3 两种入口

| 入口 | 职责 |
|---|---|
| 系统入口 | 从链与已验证工件构造 VerifiedSettlementInputs |
| 人 / 调试入口 | 只接受可验证证据包，产生同一结构；不得直接喂裸 pool / winners 绕过 adapter |

两条入口最终必须调用同一个 feeSplit 核并产生 byte-exact 同值。

## 7. K-10：资金路径必须有机器清单

### 7.1 最小 manifest

    schema_version: kanet.money-path.v1
    path_id: string
    settlement_profile: v06_flat | v07_sharded | other
    custody_profile: noncustodial | custodial_test | protocol_owned
    agreement_commitment: bytes32 | none
    intake_transaction:
      builder: string
      confirmation_rule: string
    locked_states:
      - state_id: string
        owner: string
        amount_source: string
    exits:
      normal_exit:
        transition: string
        responsible_worker: string
      timeout_exit:
        transition: string
        responsible_worker: string
      escape_exit:
        transition: string | none
        authority: string | none
    lifecycle_owner: string
    kill_switches:
      - switch: string
        effect: string
        may_disable_last_exit: false
    fault_domains: [string]
    admin_capabilities: [string]
    required_tests: [string]
    api_and_ui_disclosure: [string]

### 7.2 门禁

Lint / CI 只负责可机器判定的事情：

- 新增 money-path 没有 manifest：拒绝合并；
- 收款路径缺少 intake transaction：拒绝；
- locked state 没有 normal / timeout / escape 中至少一个可达终态：拒绝；
- kill switch 会关闭唯一出口：拒绝；
- responsible worker 不存在或没有 owner：拒绝；
- manifest 声明的测试不存在：拒绝；
- Trust Profile 未在付款前暴露：拒绝；
- 文档出口与实际测试不一致：拒绝。

搜索 setInterval、startWatcher、startWorker 只可作为调查辅助，不能作为 K-10 合规证明。

## 8. ADMIN_SECRET 拆成能力级权限

当前多个资金与非资金端点共享 ADMIN_SECRET，构成权限故障域耦合。

先产出能力矩阵，再迁移：

| Capability | 默认状态 | 建议凭证 | 额外约束 |
|---|---|---|---|
| status.sign | enabled as needed | 独立签名能力 | 不得获得资金操作权 |
| registration.emergency | disabled | break-glass key | 完整审计、有时限 |
| settlement.propose | disabled by default | propose capability | 只能构造 / 提议，不得隐式广播 |
| zk.handoff | scoped | handoff capability | 绑定 market / artifact commitment |
| zk.close.broadcast | disabled by default | broadcast capability | 金额、输出、模板全复算 |
| debugger.dry_run | enabled in non-production | debug capability | 只读、零广播、零状态推进 |
| confirm_by_address | **disabled** | 独立 break-glass key | 绕 nonce，必须第二方确认和完整审计 |

所有 capability 必须：

- 默认最小权限；
- 有独立 audit event；
- 支持撤销和轮换；
- 不能因一个密钥泄漏横跨所有管理面；
- break-glass 路径在 UI / API 中明确标记，不得伪装成普通路径。

## 9. Batch 1：先补设计，不得直接落码

### 9.1 架构事实

v06 与 v07 不是同一函数的新旧 URL：

- v06 = flat pool settlement profile；
- v07 = sharded settlement profile。

所以不能把十二个端点机械转发到一个实现并称为“收敛”。

### 9.2 必须先补齐的 C

在任何进程拆分或 API 迁移 PR 前，Batch 1 必须完成：

1. 每个进程的信任边界；
2. 生命周期唯一 owner；
3. 每个 endpoint 的调用者、认证、custody profile；
4. 逐端点表级读 / 写矩阵；
5. 哪些写是资金状态推进；
6. command bus 的幂等键、顺序、超时、重试、背压和审计；
7. SQLite 写 owner 与跨进程访问方案；
8. API 不可用时 settlement / refund / escape 的行为；
9. worker 不可用时 API 的 fail-closed / degrade 行为；
10. 故障注入验收矩阵。

### 9.3 迁移方向

完成上述门禁后，按以下方向推进：

1. 停止新增外部端点；
2. 用访问日志确认疑似死端点；
3. payload 显式携带 settlement_profile 和 protocol version；
4. 新建市场默认进入 v07_sharded；存量 v06_flat 只保留读取、结算与退款；
5. 非托管路径统一 prep → user sign → confirm；
6. 托管测试路径可有单步包装，但必须明确 custody_profile；
7. 稳定外部 URL 与内部协议 profile 分离；
8. API 进程不直接写资金状态表，只向唯一 lifecycle owner 发有界命令；
9. 禁止 API 与核心共享无边界同步 SQLite 写权限。

“新市场默认 v07_sharded”涉及 live 行为，落码与启用仍须独立 Owner 批准。

## 10. 当前 HOLD 清单

以下动作在前置物完成前禁止：

- 大规模 Oracle / Verifier 列名或表结构迁移；
- 把单值 trust_profile 直接换名但不补六个轴；
- 让 feeSplit 自己读链或复制另一套计算核；
- 仅靠关键词 lint 宣称 K-10 完成；
- Batch 1 C 未完成即拆进程；
- 未完成表级读写矩阵即统一 API handler；
- 只分进程、不分数据库写权、队列和 kill switch；
- confirm-by-address 继续作为普通管理路径；
- 用市场数量替代资金量 / bettor 权重发布 UMA 依赖结论；
- 把文档完成当作生产系统合规。

## 11. P0 执行顺序与建议责任

责任可由 Bettor 依据当前负载调整，但依赖顺序不得颠倒。

| 顺序 | 交付物 | 建议主责 | 红队 / 验收 |
|---|---|---|---|
| 1 | K-16 合入 Economic Kernel v0.1 + 验收矩阵 | NWT | J1 / Bettor |
| 2 | Trust Profile v1 schema + 旧字段兼容映射 | J1 | NWT |
| 3 | 全量 Result Authority inventory 查询与加权报告 | J2 | NWT 独立复算 |
| 4 | money-path manifest v1 + 存量路径清单 | KANet-UI | J1 / NWT |
| 5 | VerifiedSettlementInputs schema + V2 路径映射 | J2 / J1 | NWT |
| 6 | Batch 1 C + 逐端点数据访问矩阵 | KANet-UI | J2 / NWT |
| 7 | ADMIN capability matrix + break-glass 设计 | KANet-UI | NWT |
| 8 | 进程拆分与 API 迁移代码 | 待前七项 GREEN | 全流程重新审批 |

Bettor 只负责协调、证据口径、依赖顺序和门禁，不越界直接改资金代码。

## 12. 每项交付的共同 DoD

任何一项不得仅以“文档已写”闭卡。至少满足：

1. canonical schema 或 manifest 存在；
2. 有一个真实现状样本；
3. 有一个负样本；
4. 有独立 verifier / query 复算；
5. 有 CI 或测试框架入口；
6. 有错误时 fail-closed 行为；
7. 有迁移 / rollback 边界；
8. 有用户可见影响说明；
9. 有 COORD-LEDGER 状态回写；
10. 若涉及链上事实，必须有 txid / outpoint / commitment 证据。

## 13. 团队统一口径

本轮不是“再做一套架构”，也不是立刻重写系统。

本轮目标是把已被真实事故验证的原则转成机器门禁：

- 用 K-16 限制故障传播；
- 用多轴 Trust Profile 诚实拆开事实源、聚合、计算、执行、可用性与逃生权；
- 用 VerifiedSettlementInputs 守住 feeSplit 的输入边界；
- 用 money-path manifest 让每条资金路径在合并前证明自己能退出；
- 用 capability 权限缩小管理故障域；
- 用 Batch 1 的完整信任 / 数据矩阵决定如何拆，而不是先拆再解释。

衡量成功的标准不是文档变厚，而是：一条新增 money-path 如果没有权威、出口、故障域、权限和测试，机器会在 merge 前拒绝它。

做到这一步，Economic Kernel 才从思想纲领变成 KANet 的操作系统。
