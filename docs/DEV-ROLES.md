# KANet 开发角色与职责标准

**版本**: v1.0 · **创建**: 2026-04-30 · **作者**: Owner 钦定 + NWT 整理 (Phase Y close 后元元反思)

---

## 这份文档为啥存在

KANet 是长期复杂系统 (5 子系统 / 34+ DB 表 / 多链 / 多 LLM / 多 Agent). 长期系统的失败不是某次 bug, 是**反反复复同样的 bug** — 因为没人主动维护系统不变量, 全在打补丁.

补丁多了, Owner 必然累. Owner 累了就只能亲自当 architect / QA / operator, 一个人撑 4 个角色, 必然出错.

**这份文档定义 6 个角色 + 闭环 workflow + 接位 SOP**. 任何新 agent (Claude / Qwen / GPT)  接位 OR Owner 换人, 一看表立知"我该干啥, 不该干啥".

不熟读这份文档不许动 KANet 任何代码 / 任何 broadcast / 任何 commit.

---

## 6 角色总览表

| # | 角色 | 中文 | 一句话定义 | 关键产出物 | KANet 现状 |
|---|---|---|---|---|---|
| 1 | Product Owner | 产品主 | 定 "用户需要什么", 排优先级 | 产品需求 + 真测痛点 | Owner ✓ |
| 2 | System Architect | 系统架构师 | 维护**不变量** (invariants), 设计状态转换 | invariants 表 + 设计文档 | **缺 — Owner 在补** |
| 3 | Implementor | 实施者 | 写代码, 把设计变 production | code commits + ship | 我 + J2 + J1 ✓ |
| 4 | QA Designer | 质检设计师 | 设计**断言** (assertions), 守 invariants 不退化 | invariant assertion tests | **缺 — 现在 36 case 全检文案** |
| 5 | Operator / SRE | 运维 | 盯生产 health, prod 不变量实时监控 | 监控 cron + alert rules | **缺 — Owner 真测才发现 bug** |
| 6 | Independent Reviewer | 独立评审 | 跨角色审, 防 implementor 自盲 | review verdict + 修订建议 | 半缺 — 我+J2 互审但同盲 |

**4 个核心角色缺位**. Owner 一人补 3 个 (architect / QA / operator). 不可持续.

---

## 全智能体沟通纪律（Owner 2026-07-04 钦定·铁律·违者退回）

**任何智能体（Claude / Qwen / GPT / 接位 / 回归的都一样）与 Owner 沟通只有一条路：**

1. **绝不给 Owner 发菜单 / 「A/B 请选择」式询问**。Owner **不在终端**，菜单式交互对他无效、且是骚扰。
2. **有事发 `dev-coord-testnet` 开发频道，先问 Bettor（协调者）**。能自判 / 自决的自己拍或 Bettor 拍；确需 Owner 拍板的，由 **Bettor 精炼成单点、给出推荐** 后上报，Owner 只回一个决策。
3. **Owner 在开发频道**。你的输出走频道，**不私戳 Owner**。Owner 只收结果 + 做少数关键决策，不当交互终端。
4. **接位 / 回归 / 卡在命令模式的 agent 尤其注意**：不确定自己该干啥，也**只走频道问 Bettor**，绝不用菜单戳 Owner。

配 CLAUDE.md 核心原则同条 + 记忆 `feedback-never-menu-owner-not-at-terminal`。

---

## 角色 1: Product Owner (产品主)

### 定义
持系统的"用户痛点" + "战略方向". 决定**做什么** + **不做什么** + **优先级**.

### 核心职责
1. 跟用户 (含自己真测) 持续接触, 收集痛点
2. 钦定 invariant 战略 (e.g. "单一状态机", "无托管=最大差异化")
3. 给 architect 题目: "这个痛点要建啥不变量"
4. 验收 ship 后是否解决用户痛点 (不是技术 done, 是用户感受)
5. 排优先级冲突 (P0 vs P1)

### 关键产出物
- 真测 trace (撞 bug 实证)
- 钦定 statement (存档进 ANTI-PATTERNS / memory)
- 优先级排序 (本周做 X 不做 Y)

### 必跑 SOP
- 每次撞 bug 必 broadcast 给 dev team (含 chain DM 上链 audit trail)
- 撞 bug 不直接修法 propose, 给 architect 题目: "本质原因是啥"
- ship 完必亲测一遍 (不让 dev 自验)

### 不该做的事 (anti-mode)
- ❌ 钦定具体技术方案 (那是 architect 的事)
- ❌ 直接审 code (没 architect 视角会被 implementor 带偏)
- ❌ 撞 bug 后忍着不报 (反复忍 = dev team 永不知)

### KANet 当前
Owner 这角色稳. 但**因 architect 缺, Owner 被迫越界做 architect 的事** (e.g. 钦定具体方案). 长期看应交还给 architect.

---

## 角色 2: System Architect (系统架构师)

### 定义
**不变量** (invariants) 的 owner. 不写 production 代码, 主动**维护系统的"应该永远成立的规则"**.

### 核心职责
1. 维护一份 **invariant 表** (markdown 文档, 每条 ≤1 句话)
2. 设计**状态机 + transition 规则** (e.g. retail_dex_orders lifecycle)
3. 任何 ship 前必审: "本次改动 violate / 强化 / 漏 哪条 invariant"
4. 周期 audit 历史 commit, 找 invariant 偏离的地方 (主动巡检, 不等撞 bug)
5. 当 implementor 接 task 时**主动 reframe**: "这 task 落实哪条 invariant"

### 关键产出物
- `docs/INVARIANTS.md` (invariant 表, 每条带 enforce 机制)
- `docs/STATE-MACHINES.md` (broker 状态机 / exchange 状态机 / 等)
- ship review verdict ("本 commit invariant audit ✓/✗")
- 每月 system audit report

### 必跑 SOP
- ship 前必跑 invariant audit (不只 lint, 是 invariant 视角全 grep)
- 每周 1 次"无 task 日": 不写功能代码, 全天 audit
- 任何 Owner 钦定先翻译成 invariant, 再交给 implementor (而不是直接交 task)
- 看到 implementor patch 模式时主动叫停: "这是补丁, 不是 invariant fix"

### 不该做的事 (anti-mode)
- ❌ 自己写 production 代码 (越界, implementor 责任)
- ❌ 接 task ship-mode 干活 (会丢 architect 视角)
- ❌ invariant 文档写一次不更新 (文档腐烂 = 没 invariant)
- ❌ 只列 anti-pattern (反向规则), 不列 invariant (正向规则)

### KANet 当前
**缺位**. 实际 Owner 在补 (钦定方案), 但 Owner 是 product owner 不是 architect — 视角不同必然漏. 应该 NWT OR J2 主接此角色.

---

## 角色 3: Implementor (实施者)

### 定义
把 architect 的设计落地成 code. 主**写**.

### 核心职责
1. 接 architect 的设计文档 (含 invariant + state machine)
2. 写 code, 按设计实现 transition
3. 跑 syntax / lint / unit test
4. commit msg 必含 "本 commit 守 invariant N, 强化 invariant M"
5. 互 cross-review (implementor → implementor)
6. ship 后跑 cron 验 baseline 不退

### 关键产出物
- code commits
- commit msg 含 invariant statement
- test cases (含 invariant assertion, 不是只检 reply 文案)

### 必跑 SOP (CLAUDE.md 4步扫描 + 加 invariant 视角)
1. ANTI-PATTERNS / QWEN-RULES grep (旧规则)
2. 现有 caller 模式 grep
3. git log 历史 grep
4. memory feedback grep
5. **新加: INVARIANTS.md grep — 本 task 影响哪条 invariant**
6. 跑 lint + syntax + ANTI-PATTERNS check
7. commit msg 写明 D vote / RFC ref / invariant ref

### 不该做的事 (anti-mode)
- ❌ task description 当 done 标准 (会漏 invariant)
- ❌ 接到 task 立马 ship 不 reframe ("这 task 守哪条 invariant")
- ❌ ship 完不 verify "post-ship 状态 = 链上真相"
- ❌ 撞 lint 用 escape hatch 而不是真修 (除非 architect ack)
- ❌ 互 cross-review 时只检 task done, 不检 invariant intact

### KANet 当前
NWT + J2 + J1 担此角色. **稳**. 但缺 architect → 没人给我们 reframe 任务 → 我们 default ship-mode 干活.

---

## 角色 4: QA Designer (质检设计师)

### 定义
设计 **assertion** (断言), 守 invariant 不退化. **不**写功能 case, **写守门 case**.

### 核心职责
1. 看 architect 的 invariant 表, 给每条 invariant 设计 1+ assertion test
2. test framework 加新 assertion 类型 (db_row_field_equals / chain_tx_exists / state_transition_valid 等)
3. cron 加 invariant assertion gate (失败立刻红, 不等 Owner 真测)
4. 持续 audit 现有 36 case, 重写 reply_contains 文案 → invariant assertion
5. 给 implementor "这 ship 要带哪条 assertion 增量" (D12 RFC 共识)

### 关键产出物
- `test-framework/cases/invariants/*.test.mjs` (按 invariant 分类)
- assertion library (`db_row_field_equals` 等)
- cron baseline gate 含 invariant 通过率
- "case rewrite plan" — 现 36 case 哪些该重写

### 必跑 SOP
- 任何 implementor ship 前 — 加 invariant assertion case (不允许 ship "无 assertion 增量"的 commit)
- 每周 audit: cron 36 case 中, 多少 case 在守 invariant vs 多少在检文案
- assertion 不许 wording-fragile (Qwen non-determ 不该破)

### 不该做的事 (anti-mode)
- ❌ 写 test 仅检 reply_contains '某词' (Qwen 不同 wording 就 flake)
- ❌ "PASS 36/3" 当 done 标准 (其实文案过, invariant 没守)
- ❌ 接 implementor "ship 完顺手补 case" (晚了, ship 前必有 case)

### KANet 当前
**缺位**. 现有 36 case 都是 reply_contains 文案断言, 全部需重写到 invariant 视角. Owner 真测撞的 bug 全是 invariant 破裂, 但 cron 全绿 — 因为 cron 的 assertion 错位.

---

## 角色 5: Operator / SRE (运维)

### 定义
**生产健康**实时守护. invariant 在 prod 持续成立 (而不只是 ship 那一刻).

### 核心职责
1. 设计**生产 invariant 监控** (e.g. "broker 钱包 balance vs retail_dex_orders 期账面差不许 > 0.5 KAS")
2. cron + monitor-service 跑监控
3. 任 invariant 破立刻 DM Owner (不等 Owner 真测撞)
4. 维护 prod metric dashboard (broker_intake_processed COUNT 增长率 / chain TX in vs state transition out 比率)
5. 撞 invariant 破时主动 trace + report root cause
6. retroactive audit: 老数据是否符合现在的 invariant (历史脏数据清理)

### 关键产出物
- `monitor-rules.js` invariant 规则集
- prod dashboard (Owner 看一眼知系统健康)
- alert rules (DM Owner / channel-broadcast)
- weekly health report

### 必跑 SOP
- 每天 1 次自动 invariant 全扫
- 每次 ship 后第 1 个 cron cycle 必 review
- 任何 user 真测撞 bug → 24h 内出 root cause + invariant break trace
- 主动 trace 数据腐烂 (e.g. 12h 前 stuck 'awaiting_payment' rows)

### 不该做的事 (anti-mode)
- ❌ 等 Owner 真测撞才发现 (operator 责任是 proactive)
- ❌ 监控 metric 只看绝对值不看趋势 (broker_intake_processed COUNT=0 持续 18h 是趋势 anomaly)
- ❌ 撞 alert 就静默 mute 而不修 root cause

### KANet 当前
**缺位**. 现有 monitor-service 主要做 channel polling, 不做 invariant monitoring. broker_intake_processed COUNT=0 持续 18h 没 alert (Phase X 实证). 急需建.

---

## 角色 6: Independent Reviewer (独立评审)

### 定义
**跨角色审**. 不当 implementor 也不当 architect, 主动**挑刺**.

### 核心职责
1. 看 architect 设计 + implementor commit + QA assertion + operator alert, 跨视角找漏
2. 主动 challenge: "这设计 invariant 真守得住? assertion 真 cover edge case? alert 真触发得了?"
3. 关注 **跨角色配合裂缝** — implementor done 但 QA 没补 case / architect 设计但 operator 没监控
4. ship 大 phase 前出 review verdict
5. 维护 review checklist (每个 ship 必过几条)

### 关键产出物
- review verdict (pass / pass with dig / push back)
- review checklist 文档
- 跨角色裂缝 report

### 必跑 SOP
- 每个 phase ship 前必 review (不只 implementor 互审)
- challenge 时不接受 "post-phase 后置" 答复, 必当下定何时何人补
- 撞 review fail 不 ship 不 retreat — 帮 architect 重新设计

### 不该做的事 (anti-mode)
- ❌ implementor 互审同盲 (我审你你审我同 mode = 没 review)
- ❌ review checklist 写一次不维护
- ❌ "ship 时间紧, review 简化" — review 是质量门, 不能省

### KANet 当前
**半缺**. 我 + J2 cross-review 是 implementor 互审, 不是真 independent. 应该有第三方 (Owner 自己, OR 新 agent J3) 担此角色.

---

## Workflow 闭环 (6 角色协作流)

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ① Product Owner                                           │
│       ↓ (痛点 + 钦定)                                       │
│   ② Architect (设计 invariant + state machine)              │
│       ↓ (设计文档 + invariant 增量)                         │
│   ③ Implementor (按设计写 code)                             │
│       ↓ (commit msg 含 invariant ref)                       │
│   ④ QA Designer (写 invariant assertion test)               │
│       ↓ (cron 加 gate)                                      │
│   ⑤ Operator (上线监控 invariant 持续成立)                  │
│       ↓ (撞 alert / 真测 bug)                               │
│   ⑥ Independent Reviewer (跨视角 challenge)                 │
│       ↓ (verdict)                                           │
│       └─→ 回 ② Architect (重新设计) OR ① Owner (重定优先级)│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**任一环 owner 缺位**, 漏的事**堆给上游**. 5 环缺 2 环, 全堆给 ① Owner. Owner 累.

---

## 单人多 hat 纪律 (KANet 实际小 team)

KANet 现实 = 2 人 dev (NWT + J2) + 偶尔 J1. 凑不齐 6 个独立人. 必**单人多 hat**, 但**纪律保 mode 不混**:

### Hat 切换纪律

**写 code 时 = implementor mode**
- 戴 implementor hat
- 默认服 architect 设计 (不质疑 invariant, 只实现 transition)
- ship 完脱 hat

**周一上午 / 每个 phase ship 前 = architect mode**
- 戴 architect hat
- 不写 code, 只审 invariant + 设计 transition
- 给 implementor 出 task

**周五 = QA + operator mode**
- 戴 QA hat 审本周 cron assertion 漏
- 戴 operator hat 跑 prod invariant 全扫

**任何时候撞 bug = independent reviewer mode**
- 暂停所有 ship
- 跨视角 challenge: 这是 implementor done 漏? architect 设计漏? QA 没 cover? operator 没 alert?
- review verdict 出后才回 implementor mode

### 切 hat 信号 (commit msg 必含)

```
mode: architect | implementor | qa | operator | reviewer
acknowledged invariant: <list>
ships invariant: <list>
breaks invariant: NONE (must be NONE)
```

无 mode 标记的 commit hard fail (lint enforce).

---

## 接位 SOP (新 Agent / 新 Owner 第一天)

### 新 Agent 接 KANet 第 1 天必跑

1. 读 `docs/DEV-ROLES.md` (本文档)
2. 读 `CLAUDE.md` (项目入口)
3. 读 `docs/INVARIANTS.md` (TBD - 待建)
4. 读 `docs/ANTI-PATTERNS.md` (反向规则)
5. 读 `docs/DEVELOPER-GUIDE.md` (技术细节)
6. 读 `~/.claude/projects/*/memory/MEMORY.md` (历史 feedback)
7. 跑 `git log --oneline -50` 看近期 commit 模式
8. 跑 `node scripts/lint-kanet.mjs` 验当前 invariant 状态
9. **明确自己当哪个 hat** — 接 task 前必声明
10. 任何 ship 前必跑 SOP 4-6 步扫描 (CLAUDE.md 已写)

### 新 Owner 接位第 1 天必跑

1. 读本文档了解 6 角色 workflow
2. 看现 KANet 缺哪几角色 (table 表)
3. 决定: 自己当几个 hat? 招新人补哪些?
4. 不让自己当 architect+QA+operator 长期 (Owner 累 → 系统坏)

### 接位 commit msg 模板

```
feat/fix(<scope>): <brief>

mode: <implementor | architect | qa | operator | reviewer>
RFC ref: <on-chain tx hash if applicable>
acknowledged invariants: <list from INVARIANTS.md>
ships invariants: <list of new invariant guards added>
breaks invariants: NONE (mandatory NONE — break = re-design)

Tests:
- <unit / integration / cron baseline / invariant assertion>

acknowledged: <Owner kindly chinese statement> + R<id> + R-NWT-<id>
Co-Authored-By: <agent-id-with-version>
```

---

## 角色 anti-mode (混角色的灾难)

### Anti-mode A: Implementor 越界当 Architect
**症状**: 接到 task 不审 invariant, 自己设计方案
**真因**: 没 architect → implementor 默认补 → 但 implementor 视角窄 → 设计漏 invariant
**修法**: 主动停手, 找 architect, 等 architect 设计

### Anti-mode B: Architect 越界写 Production Code
**症状**: architect 干 ship-mode 写 code
**真因**: 觉得"反正我懂代码, 我自己 ship 快"
**后果**: 失 architect 视角, 退化成 implementor + 1
**修法**: architect 钦定 — architect 不写 prod code (例外: 设计 spec 内 reference impl)

### Anti-mode C: QA 写 task case 不写 invariant case
**症状**: 36 case 全检 reply_contains '某词'
**真因**: QA 当 implementor mode 干活
**后果**: cron 全绿但 invariant 全破 (KANet 当前实证)
**修法**: 每个 case 必含至少 1 条 invariant assertion (db state / chain TX / state transition)

### Anti-mode D: Owner 越界当 Architect
**症状**: Owner 钦定具体技术方案 ("用 broker_workflow_markers 表")
**真因**: architect 缺, Owner 累, 自己上
**后果**: Owner 视角是产品视角不是架构视角, 必有架构漏
**修法**: Owner 钦定**只**钦定 invariant 战略 ("数据 = 链上真相"), dev team architect 翻译成方案

### Anti-mode E: Operator 反应式 (等 bug 才修)
**症状**: 出 prod bug 才知, 等 user (Owner) 报
**真因**: 没主动 invariant 监控
**修法**: 主动监控 + 趋势 alarm + 数据腐烂 retroactive audit

---

## 检查清单

### 每个 commit 必过

- [ ] mode 标记 (commit msg)
- [ ] acknowledged invariants 列出
- [ ] ships invariants 列出 (至少 0 — 但显式说 0 不是漏)
- [ ] breaks invariants = NONE
- [ ] lint 全过 (R-NWT-FRAMEWORK / R29 / R37 / R11)
- [ ] cross-review (implementor → implementor 互审)

### 每周必过 (architect hat)

- [ ] 跑 `grep` 全代码 audit invariant 偏离的地方
- [ ] 维护 `docs/INVARIANTS.md` (新加 / 修正)
- [ ] 给 implementor 下周 task 必含 invariant ref
- [ ] 维护 state machine 文档 (broker / exchange)

### 每周必过 (QA hat)

- [ ] cron assertion review — 多少检 wording vs 多少检 invariant
- [ ] 当周 cron flake 个数 (Qwen non-determ flake = wording assertion 错位实证)
- [ ] 重写 N 条 wording-fragile case 到 invariant assertion

### 每周必过 (operator hat)

- [ ] 跑 prod invariant 全扫
- [ ] 数据腐烂检测 (e.g. retail_dex_orders state vs 链上真相对账)
- [ ] alert rule 维护 (新发现的 invariant 必加监控)

### 每月必过 (independent reviewer)

- [ ] 跨角色裂缝 audit
- [ ] review checklist 维护
- [ ] phase close-out review

### 每季必过 (Owner)

- [ ] 看 6 角色 workflow 闭环健康
- [ ] 哪些角色长期被 Owner 自己补 → 加人 OR 重新分 hat
- [ ] 优先级方向校准 (跟产品战略 align)

---

## 跟现有 KANet 文档关系

| 文档 | 角色 |
|---|---|
| `CLAUDE.md` | 项目入口 + 接位 SOP (主 implementor 视角) |
| `docs/DEVELOPER-GUIDE.md` | 技术细节 (主 implementor + architect 参考) |
| `docs/ANTI-PATTERNS.md` | 反向规则 ("不要做 X") |
| `docs/DEV-ROLES.md` | **本文档** — 角色 + workflow + 单人多 hat 纪律 |
| `docs/INVARIANTS.md` | (待建) 正向规则 ("永远保证 Y") — architect 主管 |
| `docs/STATE-MACHINES.md` | (待建) 状态机文档 — architect 主管 |
| `QWEN-RULES.md` | LLM 规则 |
| `~/.claude/.../memory/` | Owner feedback 沉淀 |

**新文档优先级**: `INVARIANTS.md` 先建 (architect 上任第一件事), `STATE-MACHINES.md` 跟着建.

---

## 元教训 (Owner 2026-04-30 中午钦定)

> "我们花了那么多资源, 一直没有 '每个链上动作对应一个数据状态转换' 这条最基本原则 — 因为没人在做架构, 全在做 patches."

**真本质**: 没 architect → 没 invariant 表 → implementor 接 task 做 task → patch 越加越多 → 反反复复同样的 bug.

**修法**: 切 mode. 不光建文档, 是**实际有人戴 architect hat** + **持续戴**.

KANet 之后任何 ship: 先问 "本 ship 守 invariant N, 强化 invariant M, 不破 invariant K". 答不出 = retreat 到 architect mode.

---

*本文档自身是 architect mode 的产物 (Owner 钦定 + NWT 整理). 修订时请保持 architect 视角, 不退化成 implementor checklist.*

*版本 v1.0 — 2026-04-30. 后续修订必带版本号 + 修订人 mode + 修订理由.*
