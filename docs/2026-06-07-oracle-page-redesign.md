# /oracle 页全面重设计 (Track C) — 仲裁人中心

> 2026-06-07 Owner 钦定「/oracle 完全不能看,从方案到内容动刀」。Bettor 设计 + KANet-UI 实现。本文 = 设计方案,关1 跟 UI 对齐后实现。
> 原则:大白话(无 jargon,统一'仲裁人'=oracle)+ Owner 5 维度全覆盖 + **无数据时诚实显'暂无',不造假分数**。

## 0. 现状痛点(KANet-UI r622 扫 + Bettor 核)
oracle-home.eta 2 tab(信任系统/我的 oracle)满屏 jargon(VRF stake-weighted / t=4-of-5 / stake_locked_kas / voter_misbehave_count / top5 集中度),用户视角缺 Owner 钦定的 5 维度。

## 1. 数据底(已查实,无需新表)
| 维度 | 数据源 | 现状 |
|------|--------|------|
| 谁是仲裁人 + tier/能力 | `oracle_registry`(relay_node_id/tier/capabilities/status/frozen)| 5 个 active,全 tier1 binary_outcome |
| 可配条件 / 执照域 | `oracle_registry.licensed_domains` | 现全 null(未发执照,Phase2 硬 gate)|
| 工作状态 / 准确率 | `oracle_history`(投票数 / shadow_correct vs UMA)| 40 真票,**0 shadow 记录**(并行判定未跑,Track D 才产)|
| 盈利状态 | `oracle_history` settle 收益 / broker fee 分成 | 待聚合 |
| 质押状态 | `oracle_stake_enrollments` / `oracle_registry.bond_amount` | 6 enrollments,bond 多 null |

## 2. 页结构(3 段,弃旧 2 jargon tab)

### 段 1 — 仲裁人名册(谁在裁,observer 视角)
每个仲裁人一卡,大白话显 Owner 5 维度:
- **谁**:agent 名 + 头像 + 「N 级仲裁人」(tier 译)
- **能裁什么**:capabilities 译「二元 YES/NO 判定」+ 执照域(licensed_domains;null → 「通用·未分领域执照」)
- **工作状态**:active→「在岗」/ frozen→「已冻结」+「近 N 次裁决,准确率 X%(对照 UMA)」;**无 shadow 记录 → 显「暂无评分(并行判定攒分中)」不造假**
- **盈利状态**:「累计仲裁收益 X KAS」(无 → 「暂无收益」)
- **质押状态**:「已质押 X KAS」/「未质押」(stake_enrollments + bond)

### 段 2 — 进行中的裁决(每市场,de-jargon 旧'每市场信任表')
字段译:market→**题目** / 状态→**现在哪步**(用 statusLabel 大白话) / 委员会→**谁在裁**(仲裁人名) / bond→**抵押多少** / 链上证据→**链上 TX**(explorer link)。数据源 'chain_view canonical' → 「链上抽样」。

### 段 3 — 我注册仲裁人(operator 视角,改名旧'我的 oracle')
- 注册自家 agent 当仲裁人
- **可选可配**:接什么条件(capabilities)+ 申请/查看执照域(licensed_domains)— Owner「可选择可配置」钦定
- 自己的工作/盈利/质押(段1 同维度,operator 视角)

## 3. 诚实边界(钉死,守 G5 + 里程碑非终点)
- 准确率 vs UMA:**现 0 shadow 记录** → 全显「暂无评分」。等 Track D(并行判定实测)产出 shadow_correct 才显真分。**严禁占位假分。**
- licensed_domains:Phase2 硬 gate 未解,现全「未分领域执照」,不显「已毕业/可裁长尾」。
- 盈利:testnet 测试币,显「仲裁收益(测试币)」不报经济价值。

## 4. 关卡
关1:本方案 Bettor↔UI 对齐(术语/段落/无数据态)。关2:Bettor curl /oracle 实测 — 5 维度渲出 + 0 假分 + jargon grep 0 + explorer link 真跳。关3:NWT UI lint 守仲裁人术语 + 无数据态。
