# KANet 测试框架 — 设计说明书

> 自治测试体系。Owner 2026-04-27 钦定 "可复用体系，超过真人测试效果"。
> 三方（NWT/J1/J2）共同建设，落地在 `kasia-console/test-framework/`。

## 这个东西是什么

一套在 `kasia-console/test-framework/` 下的**通用测试框架**：用 JS 模块描述测试场景（叫 case），用通用 runner 执行，用 persona 模拟真实用户对话，用 adversarial 探针枚举攻击向量。

**不是**：xUnit 风格的单元测试库（那是底层 testing-library 的事）。

**是**：业务级 E2E + 用户体验 + 安全攻击 综合测试体系，专门为 Agent 系统（broker / seeker / future agents）设计。

## 为什么需要这套（不是直接用 jest/mocha）

KANet 的核心是 **Agent 之间通过 Kasia DM 自然语言协作**。这意味着：

- 测试对象不是函数，是**对话**（broker 收到自然话能否正确回应）
- 测试用户不是 mock object，是**人格化模拟**（"中文新手"问问题方式跟"恶意攻击者"完全不同）
- 通过 / 失败不是 boolean，是**多维度评估**（reply 是否自然 / 信任信号是否到位 / 安全 invariant 是否守住）
- 错误不是 stack trace，是**用户体验问题**（broker 复读 preview 不答问题这种"软错误"传统单元测试抓不到）

普通 unit test 框架解决不了这些。所以三方 2026-04-27 共同决议：自建领域专用框架。

## 架构定位

**作为 kasia-console 的 QA 子系统**，不另起独立 repo / package。

理由：
- 跟 console 同 repo deploy 同步
- 复用 console 的 DB / API / sqlite 客户端
- 加新 case 不需要 cross-repo PR

五大系统中归属：
```
kasia-console (数据中枢 + UI + 测试体系) ← 测试框架在这里
kasia-relay
kaspa-scout
agent-mind
agent-adapter
```

## 设计三原则

### 原则 1: 领域无关 vs 领域特定 严格分层

```
test-framework/
├── lib/                ← 领域无关核心，所有产品复用
│   ├── runner.mjs      ← 通用 runner: actions + assertions
│   └── peers.mjs       ← peer 地址 alias 注册
├── personas/           ← 领域无关角色库 (broker/seeker/任何 agent 复用)
├── adversarial/        ← 领域无关攻击模式 (fuzz/race/state-attack)
└── cases/              ← 领域特定测试场景
    ├── broker/         ← broker 业务测试
    ├── seeker/         ← (future) seeker 业务测试
    └── exchange/       ← (future) 自由市场测试
```

加新业务（例如 seeker）只需：写 `cases/seeker/*.test.mjs` + 复用现有 personas/lib，不动框架。

### 原则 2: must vs should 二级 severity

每个 assertion 标 `must`（硬 fail）或 `should`（warning 不 fail）。

为什么：测试不是"通过 / 失败" 的二元判断。"broker 回应正确" 是 must，"broker 回应在 5 秒内" 是 should（慢但不致命）。混在一起判会让本来 PASS 的 case 因软指标 FAIL，淹没真问题。

### 原则 3: 真链 vs 同步 HTTP 区分

- **同步 HTTP** (`/api/agent/reply`)：测 broker reply 内容、状态机逻辑、回归 case。快、便宜、可重复。
- **真链** (Kasia DM + 真钱包 USDT)：测 端到端付款、跨链验证、真用户体验。慢、贵、需要 staging。

case 用 `tags: ['real_chain']` 和 `skip_in_batch: true` 标识真链 case，batch run 默认跳过，手动 `--case=` 触发。

## 核心组件

### Runner (lib/runner.mjs)

通用 case 执行引擎。读 case → 跑 setup → 顺序跑 steps → 校验 expect → 输出 PASS/FAIL + trace。

**Actions**（领域无关，加新 action 全产品立刻能用）：
- `send_message` — sync DM via /api/agent/reply
- `inject_history` — 模拟 prior 对话历史
- `sleep` — 等 N ms
- `query_db` — 任意 SQL 查询
- `wait_for_db_row` — 轮询 DB 等行出现
- `wait_for_offer_status` — 等 exchange_offer 到指定 status
- `wait_for_broker_outbound_msg` — 等 broker 真发出 outbound DM
- `cleanup_peer` — 清测试 peer 痕迹
- `persona_turn` — 执行 persona state machine 一步

**Assertions**：
- `reply_contains` / `reply_does_not_contain` / `reply_contains_one_of`
- `reply_response_time_ms_max` / `_min`
- `reply_skip_reason_equals`
- `db_row_count` / `found` / `row_field_equals`

### Personas (personas/)

模拟真实用户人格。每个 persona 是 state machine + 自然语言 phrasing：

| persona | 模拟场景 |
|---------|----------|
| cn_newbie | 中文新手第一次买，谨慎，问 "maker 是谁?" |
| cn_newbie_sell | 同上，SELL 方向，问 "你跑了怎么办?" |
| en_neat | 英文用户简洁直接 |
| mind_changer | 中途改主意（BUY 改 SELL / 改 qty / 改 chain）|
| liar | 假声称已付，测 broker 是否真验链上 |
| fumbler | 手抖给错地址 / 错链 |
| malicious | 攻击者：注入 fake addr / swap addr / R19 bypass 试探 |

接口约定：`{ id, name, initialState(), step(state, brokerReply) → { message, nextState, done } }`

### Adversarial (adversarial/)

系统化攻击向量枚举（待 J1 主导填）：
- Fuzz: 随机 asset/chain/qty 组合扫
- Race: 同时多 user 同 broker 抢付款
- State attack: 重启后旧 _pendingPreview / 24h 后 YES / 重复 paid tx
- Hallucinate bait: 诱导 broker 编 fake addr

### Cases (cases/<domain>/<id>.test.mjs)

业务测试场景。每个 case `export default { id, description, domain, tags, steps, ... }`。

tags 用于 cron 优先级：
- `security`, `critical` — 必跑、必 PASS
- `regression` — bug 修复后的回归证据（🔴 **不是"永不退化守护"**：没有任何东西会自动跑它，见下节）
- `ux` — 体验类
- `real_chain` — 需要真钱包真上链

## 自动化层 — 🔴 **不存在。以下是实况（2026-07-28 逐条实测更正）**

**本节以前用现在时描述了三个机制，而三个都没有实现过。** 原文与实况对照：

| 原文声称 | 🔴 实况（实测） |
|---|---|
| **Pre-commit**：lint + 跑 `tags:['critical']` case，30s 内 | hook 确实在（`core.hooksPath=.githooks`），但它跑的是 **lint-kanet + check-tree-fresh + check-tests-fresh**，**一个 case 都不跑** |
| **Post-commit**：跑相关 domain 全部 case，异步 broadcast | **`.githooks/` 里只有 `pre-commit` 一个文件**，`post-commit` 不存在 |
| **Cron**：定期跑 `--all`，失败通报 dev-coord | **无 cron、无 CI**（无 `.github/workflows`，无任何 yml/ps1/sh 引用 `scripts/test.mjs`） |
| （实现进度见 issue tracker） | **本仓没有 issue tracker**（无 `.github/`） |

🔴 **⇒ 所以：用例只在【有人手敲】的时候跑。** 证据在 `logs/test-runs/<case>-latest.json`
（覆盖式：只有最后一次，没有历史）。`scripts/check-tests-fresh.mjs` 在每次 commit 时提示这些证据有多旧——
它只回答**有没有人在跑**，不回答**跑的结果对不对**。

🔵 **记这一节的形状，因为它是本仓反复出现的那一类**：一份文档用现在时写下了一个**计划**，
而读的人无法从措辞上分辨它是**已实现**还是**打算实现**——括号里那句"实现进度见 issue tracker"
是唯一的对冲，而它指向一个同样不存在的东西。

## 用法速查

详细见 `kasia-console/test-framework/README.md`。

```bash
# 跑单个 case
node scripts/test.mjs --case=test-framework/cases/broker/sell_kas_no_buy_hallucinate.test.mjs

# 跑整个 domain
node scripts/test.mjs --domain=broker

# 跑全部
node scripts/test.mjs --all
```

## 历史与决策记录

- **2026-04-27 11:25 Owner 钦定** "把测试方式方法方案更上一个台阶, 实现自主开发自治开发自我迭代"
- **11:29 NWT RFC** 6 个设计问题给三方
- **11:33 J1+J2+NWT 共识** RFC 全过, MVP ship
- **11:39 J2 ship 6 personas** 第一次跑就抓 broker bug
- **12:01 三角验证** Bug-Z9 fix（NWT framework + J2 persona + J1 真链）同时 PASS
- **12:15 malicious persona** 抓到 critical R19 bypass (Bug-Z11), 30 分钟内修+验
- **12:25 真人 DM 链路 UX 评估** 抓 6 个 P0/P1 UX 问题
- **12:50 框架固化** Owner 要求文档化为系统组件

## 长期 owner

- **Maintainer of record**: NWT（建造者，最熟）
- **lib/ 改动**: 三方 review
- **新 case / persona / adversarial**: 三方都可加，提交前跑 lint
- **架构级变更**（加新 action 类、改 case schema）: dev-coord RFC + 三方 vote

## 跟其他文档关系

- 实操教程: `kasia-console/test-framework/README.md`
- 系统级文档: `docs/guide/18-test-framework.md`（DEVELOPER-GUIDE 章节）
- Claude Code 接力指南: `CLAUDE.md` 加一段
- ANTI-PATTERNS: 测试发现的 bug → 沉淀对应 R 条目
