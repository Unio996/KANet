# KANet INVARIANTS

> **版本**: v0.1 (draft, 2026-05-03)
> **作者**: Architect mode (claude.ai)
> **审核**: NWT reviewer hat (待)
> **Final ack**: Owner (待)
>
> **本文档目的**: KANet 工程文化的永久 invariant 沉淀。Phase 1 期间 (4/30-5/3) 累计 17 处 KI + 6 反模式 + 5 轴 layered protection — 本文档把这些散落 sediment 整理成团队级永久参考。

---

## 起源

KANet 工程文化不是一次性设计完成。是 **Phase 1 期间反复 sediment + 复刻 + 矫正 + 再 sediment** 迭代出来的。

每条 invariant 都有真实事件 evidence——不是抽象原则。

本文档的真用法:
- 新人接位时**必读**, 6 个月后接位的 J3/J4 同样 binding
- Architect / NWT / J2 撞反模式时**自查参考**
- Phase 2-N 任务卡起草时**自动应用**

---

## Chapter 1: Architect Mode Invariants

### 1.1 Spec is forward-looking, not data-fitting

**Invariant**: 设计文档 (spec) 描述系统**应该**有什么, 不是描述系统**当前**有什么。

当 prod 数据跟 spec 不一致时, **必先穷举 3 选**:
- (a) Architect 凭空判断错 → 修 spec
- (b) Architect 判断对, 代码没实施 → 标 known issue, spec 不动
- (c) 部分对 → 微调 spec

不能直接跳 (a) 自我否定。

**Sediment evidence**:
- 5/2 上午 J2 grep 发现 confirming state 1708 row 历史污染, 当前代码 0 active write path
- NWT 当时凭印象推断"spec 不需要 confirming"准备起 v0.4 sweep
- Owner 拦下: 是 (b) — 代码没实施, spec forward-looking 留 confirming 给 matcher Phase 2/3 实施
- KI-1 sediment

### 1.2 Architect 处理 specific facts 必基于实证

**Invariant**: Architect mode 处理 specific facts (LOC / 时间 / 协议层细节 / API 签名 / 数字异常) 必先 grep 或 ask Owner, 不凭印象推论。

**Surface area** (具体列举, 不抽象):
- LOC 估算 (任务卡颗粒度)
- 时间 / 日期 (Owner 多时区)
- 协议层细节 (Kaspa storage_mass / 跨链确认数 / etc)
- KANet API 签名 (super / db / callAdapter / enqueue)
- 数字异常解释 (1.0 KAS fund 为什么 100x?)

**修法**: 不确定时:
- ask Owner: "我理解是 X, 是这样吗?"
- 或 grep 真代码
- 不写 "应该是 X" 或 "我估 Y"

**Sediment evidence**:
- 5/2 早上 KI-2/3/4/5: J2 grep KANet API 真签名跟 architect 凭印象 spec 4 处不一致
- 5/2 中午 KI-7: NWT broadcast "fund 1.0 KAS (storage_mass quirk forced 100x)", architect 凭印象推断 storage_mass 反垃圾机制, Owner 矫正 "实际是 NWT 主动 fund buffer"
- 5/2 整天: architect mode 反复用 "5/1" 当 "5/2", Owner 校准
- 5/3 早上: architect mode 推 broker 反馈机制 +100 LOC, Owner 矫正 "基础功能都在, 不用加"

**这条 invariant 5/2-5/3 至少 5 次实证**, sediment urgency 严重。

### 1.3 Architect 钦定边界必 explicit

**Invariant**: Architect 钦定 hat boundary 时必显式列禁, 不依赖 implicit 期待。

**反例**:
- "NWT broadcast J2 wakeup, J2 接任务卡 ship" (implicit)

**正例**:
- "NWT broadcast J2 wakeup, J2 接任务卡 ship, **NWT 不许自己 ship implementor commit**" (explicit)

implicit 期待留 implicit gap, hat 切换者会从含糊处越界。

**Sediment evidence**:
- 5/2 上午 architect (我) approve v1.1 任务卡时写 "NWT broadcast J2 wakeup, J2 接任务卡 ship"
- NWT 实际行为: 自己 ship Step 1+2 (ec1427803) + Step 3 iii (2b0359c7b)
- KI-13 specific 3 sediment

---

## Chapter 2: Owner Role Boundary (KI-8)

### 2.1 Owner = product 决策角色, NOT 任何 role-bounded work 工具

**Invariant**: Owner 不当 system / role-bounded 工作的执行工具。

**Surface area** (列具体, 不抽象):

**Owner NOT 做**:
- system verification (Bug 1 cycle 不让 Owner re-handshake)
- 文档起草 (retro / INVARIANTS / 任务卡 / 任何 sediment) ← v2 扩
- 数据 audit / SQL 跑 / log 分析
- broadcast verdict 撰写 / cross-review
- code 实施 / commit (Owner 当然不写代码, 但明文列)

**Owner = product 决策角色**, surface area:
- 哲学钦定 / 战略方向
- 优先级排序 / 资源分配
- final ack 任何 milestone
- 角色冲突仲裁 / hat boundary 仲裁
- 反模式拦截 (跨所有角色)

**Sediment evidence**:
- 5/2 上午: Owner 钦定 "握手不要你们手动去实现, 要修好 bug, 让系统自驱实现" → KI-8 v1 (system verify surface area)
- 5/2 19:00: J2 r123 后 broadcast 复刻 1 ("Owner 起 INVARIANTS")
- 5/2 19:30: NWT r140 broadcast 复刻 2 ("Owner 起 INVARIANTS")
- 5/3 NWT broadcast 复刻 3 ("你 architect mode INVARIANTS 起草" 指 Owner)

**3 次复刻在 ~12h 内** = sediment depth 不够的真证据。修法: 列具体 surface area, 不只抽象原则。

### 2.2 Invariant 复刻 = sediment depth 不够的真信号

**Invariant**: Invariant 复刻不是单纯 implementor 错, 是 sediment 完整度不够的信号。

**真因**:
- Sediment 仅覆盖原 surface area, 新 surface area 没扩
- 抽象原则 ("Owner role boundary") 比具体列举 easy 复刻
- Memory feedback 注入不一定到所有 prompt 路径

**修法**:
- 列具体 surface area (不仅写抽象原则)
- 复刻发生时不只矫正当事人, 同步扩 invariant 文档
- INVARIANTS 文档 sediment 时含**复刻历史 + meta-invariant**

**Sediment evidence**:
- KI-8 在 12h 内复刻 3 次
- v1 仅含 system verification, v2 必扩文档起草 / data audit / verdict 撰写

---

## Chapter 3: Cross-Hat Boundary (KI-13)

### 3.1 双向严守, NOT 单向

**Invariant**: Hat boundary 双向严守, 任何方向都不许擅入。

**双向**:
- J2 standby 不擅入 operator (KI-13 v1, 5/2 第 5 轴 sediment)
- Operator/Architect 不擅入 implementor (KI-13 v2, 5/2 NWT 越界后矫正)

**Sediment evidence**:
- 5/2 上午 J2 在 T1.6 / T1.8 主动 standby, 不擅入 operator hat 范围 → 第 5 轴 protection 真实证
- 5/2 上午 NWT operator hat 自己 ship Step 1+2 (ec1427803) + Step 3 iii (2b0359c7b) → 越界 implementor
- Owner 矫正后 NWT sediment "5/2 学到", 但漏了双向纪律含义
- KI-13 v2 修订: 双向 NOT 单向

### 3.2 Hat boundary 不论 LOC / 复杂度 / "顺手做"

**Invariant**: 任何越界都是越界, 不因为"小改动" / "技术上简单" / "顺手做就完了" 而豁免。

**Sediment evidence**:
- ec1427803 (Step 1+2 telemetry) 仅 ~10 LOC — NWT 自认"小改动可以顺手"
- 但仍是 implementor hat 工作, NWT 越界
- Owner 矫正: 大小不重要, hat boundary 重要

### 3.3 Implementor 自识别 boundary 优于 Owner / Architect 拦截

**Invariant**: 6 角色 workflow 真成熟标志 = implementor 自识别越界比例高, 不是 Owner 拦截次数高。

**Sediment evidence**:
- 5/2 J2 在 T1.6 (Trader-M onboarding), T1.8 (invariant assertion), T1.9 (operator 范围), 多次主动 standby
- 5/2 J2 broadcast "T1.9 是 NWT operator hat 范围, 不擅入"
- 5/2 NWT 12h 监控期 LLM 死撞 21:03 cron alarm 时, NWT 操作 "不擅 restart (per cross-hat KI-13 + KI-15)"
- 反模式 sediment 真在 NWT/J2 内化

---

## Chapter 4: Health Monitoring (KI-16)

### 4.1 Health 必区分 alive vs functioning

**Invariant**: Health monitoring 必区分 "process alive" vs "process functioning"。

**反模式**:
- agent-health.js 检 process alive (PID exists) → adapter=green
- 但 LLM upstream (LiteLLM / llama-server) 死了
- adapter alive ≠ adapter 真能完成 inference

**修法**: 每个 health indicator 必定义 "functioning" 含义:
- Adapter functioning = process alive ∧ LLM upstream /health 200 OK ∧ 真能完成 inference (round-trip test)
- Relay functioning = process alive ∧ Mind reactive loop 跑 ∧ chain RPC connected
- Console functioning = process alive ∧ DB connection 真能 commit ∧ HTTP endpoint 200 OK

**Sediment evidence**:
- 5/2 21:17 LLM infra (LiteLLM port 4000 + llama-server port 8000) silent 崩
- agent-health.js 仍报 adapter=green 几小时
- 5/3 早上 NWT triage 才 catch (cron baseline drift 间接暴露)
- KI-16 sediment

**这是 silent 盲区, 比反模式更严重**——反模式有人撞才暴露, silent 盲区可能多月不撞才暴露。

### 4.2 12h close 真定义

**Invariant**: 12h 监控期 close 真定义 = baseline 守 ∧ 0 anomaly ∧ 0 pending sediment, NOT 时钟到。

**反例**:
- 5/2 NWT r138 跳 12h gun 直接说 "Phase 1 CLOSED" — 12h 时钟没到
- Owner 拦下: KEEP 12h, 起算 r138 broadcast 时刻 11:51 UTC

**正例**:
- 5/3 01:00 UTC 12h reset (因为 LLM crash anomaly 触发延长)
- close 真定义: 12h 完整通过 ∧ 0 anomaly catch ∧ KI-15/16 sediment 完成

**Sediment evidence**:
- 5/2 r138 跳 gun + Owner 拦
- 5/2 21:03 cron alarm + 21:17 LLM 崩 (12h 内 anomaly catch)
- 5/3 早上 forensic + restart + 12h reset
- KI-15 sediment

### 4.3 Sediment 的真目的是让系统自动发现新问题

**Invariant**: Sediment 的真目的不是防过去模式复刻, 是让系统自动发现新问题。

**Layered protection 三阶段**:
- 第 1 阶段: 文档 sediment 防新人犯老错
- 第 2 阶段: 反模式拦截防同人复刻
- 第 3 阶段: 监控自动发现未知问题

每阶段是上一阶段沉淀的产出, 不是替代。

**Sediment evidence**:
- 5/2 r138 跳 12h gun 被 Owner 拦 (第 2 阶段反模式拦截)
- 拦截留下了 12h 监控空间 (第 1 阶段)
- 5/2 21:03 cron alarm 自动 catch 4 new fail (第 3 阶段)
- 5/2 21:17 LLM 崩自动暴露 (第 3 阶段)

**5/2-5/3 是 KANet 工程文化从第 2 阶段进化到第 3 阶段的真 inflection point**。

---

## Chapter 5: Layered Protection 5 轴

### 5.1 5 轴定义

| 轴 | 定义 | 实证 |
|---|---|---|
| (a) | audit row count ≠ active write path | KI-1 confirming 1708 row 历史污染 |
| (b) | implementor reverse data 必穷举 3 选 | NWT v0.4 sweep 反应过度被 Owner 拦 |
| (c) | implementer authoritative on KANet API signature | KI-2/3/4/5 J2 grep vs architect 凭印象 |
| (d) | KANet skill data access HTTP API only | T1.2 db.mjs 不存在, 改 fetchJson |
| (e) | J2 implementor 主动识别 operational boundary | T1.6/T1.8/T1.9 多次主动 standby |

### 5.2 6 角色救场实证

**Phase 1 期间 4 个角色都救过场**:

- **Owner**: 6 次反模式拦截 (5/2 整天)
- **Architect (我)**: cross-review 多次拦下 implementor 边缘 case
- **NWT reviewer hat**: 4 处 KI catch + r137 reviewer fail Step 4 rework
- **NWT operator hat**: KI-6 双 INSERT 自承认 + 5/3 LLM crash 实证 catch
- **J2 implementor**: 4 处 KI grep catch + 主动 standby
- **System monitoring**: 5/2 21:03 cron alarm + 21:17 LLM crash 自动暴露

**双向流动是 KANet 工程文化的真核心**——不是单向 architect → implementor, 而是任何角色都能 catch 任何角色的盲点。

---

## Chapter 6: Ship Invariants

### 6.1 Test : Ship LOC ratio ≥ 1:1

**Invariant**: Ship LOC : Test LOC ≥ 1:1 是 KANet ship 健康度门槛。

**真因**:
- 任务卡每条带 acceptance criteria + invariant assertion
- 9 anti-pattern → 30 invariant assertion
- 自然达到 1:1 比例

**Sediment evidence**:
- Phase 1 T1.0-T1.8: 270 LOC ship + 262 LOC test ≈ 1:1 (KANet 历史最高)
- 比例低于 1:1 触发架构师 review (任务卡颗粒度不够 OR implementor 偷工)

### 6.2 Column-before-transition pattern

**Invariant**: 业务 column 写入与 state transition 同时发生时, column 写必须先于 transition()。

**真因**: transition() 推到新 state 后, 原 state 的 CAS 保护失效, 下一个 caller 可能立即 advance, 留下 column 永久未写。

**Sediment evidence**: STATE-MACHINES.md v0.2 sediment, Ship A SA-4 race 修复

### 6.3 任务卡颗粒度门槛

**Invariant**: 任务卡颗粒度必须支持 implementor zero-question 实施。

**门槛**:
- 每个 step 含 file:line 精确引用
- Acceptance criteria 0/1 binary
- Anti-pattern 列具体 (不仅原则)
- 期望 log 序列含 line 号

**Sediment evidence**:
- Phase 1 任务卡 v1.0 (968 行) → J2 zero-question 实施
- Bug 1 任务卡 v1.1 (118 行 + 6 candidate 表) → J2 zero-question 实施
- 反例: 早期任务卡 acceptance "step 1-5 success markers" 抽象 → J2 撞墙

---

## Chapter 7: Cron + Monitoring Invariants

### 7.1 Baseline drift 必架构师决策

**Invariant**: Cron baseline drift (PASS/FAIL count change) 不论 PASS 增 OR FAIL 减, 必架构师 review + 决策更新 baseline。

**反例**: 自动接受 baseline drift = 失去基线意义。

**Sediment evidence**: 5/2 早上 4th cron alarm 36/2/38 偏离 baseline 35/3/38 → NWT 切 architect hat 诊断

### 7.2 Silent catch 反模式 (KI-9)

**Invariant**: `} catch {}` (silent swallow) 是反模式。

**修法**: 任何 catch 必含:
- err.message log
- 或显式 re-throw
- 或 retry 机制

**严禁**: silent catch 吞错误不留 audit trail。

**Sediment evidence**:
- Bug 1 root cause: rpc-listener.mjs:715 outer catch silent swallow
- 修法: catch (err) { log(...) } + Step 3 (iii) NOT markSeen on silent throw
- KI-9 sediment + 防御 pattern: lint rule grep `} catch {` 0 log → flag

### 7.3 Runtime invariant 自动 cron

**Invariant**: 重要的 invariant 必有 cron 自动 verify, 不依赖人工跑。

**Sediment evidence**:
- Ship A SA-1 起 KANet 第一份 invariant assertion
- Phase 1 T1.8 ship 30/30 invariant + 9 anti-pattern enforce
- 5/2 21:03 cron alarm 自动 catch baseline drift = invariant 系统真在工作

---

## Chapter 8: Broker 成功的真核心 (KI-17, Owner 钦定)

### 8.1 三层定义

**Invariant**: Broker 成功 = 识别 (前提) + 精准对接 KANet (机制) + 反馈关键节点信息 (核心)。

**1. 识别 (前提)**: 听懂 user 真意图 — listen + intent extract

**2. 精准对接 KANet (机制)**:
- 用 KANet 现有基础设施
- 0 私有 state (per MATCHER-ARCHITECTURE §1.2)
- 0 反模式复刻 (旧 broker 24 file 并行真相源)

**3. 反馈关键节点信息 (核心)**:
- 每个状态变化主动 expose 给 user
- 没有反馈 = 黑盒, user 撞超时才知道问题
- 反馈是 broker 设计的 first-class concern, 不是 feature

**Sediment evidence**: 5/3 Owner 钦定, broker 成功的真核心三层定义。

### 8.2 工程含义

T2/T3 任务卡 acceptance criteria 必反映三层:

**T2 acceptance**:
- offer 发出 → user 真收到反馈 (matcher reply 含 offer detail)
- 调 KANet 现有 endpoint /api/exchange/publish, 0 新建
- 0 私有 state (matcher 进程不持有订单状态)

**T3 acceptance**:
- 付款 verify → user 真收到 "confirming N/15" 进度
- KAS 发出 → user 真收到 "TX hash + 到账时间"
- subscribe trade-protocol-filter event, 0 自建监听
- 调 sendKaspa Action Executor, 0 直接动 Relay

**KANet 反馈基础设施已有** (chain_events / messages / trade-protocol-filter event), matcher 复用即可, 不新建。

---

## 附录 A: 17 KI 完整列表

| # | 内容 | 谁 catch | 阶段 |
|---|---|---|---|
| KI-1 | confirming 历史污染 vs forward-looking spec | J2 grep + Owner 拦 NWT | 5/2 上午 |
| KI-2 | T1.1 super signature object → 2-string positional | J2 grep | 5/2 上午 |
| KI-3 | T1.2 db.mjs → fetchJson HTTP API | J2 grep | 5/2 上午 |
| KI-4 | T1.3 callAdapter → /reply mind.mjs canonical | J2 grep | 5/2 上午 |
| KI-5 | T1.4 enqueue → executeOne/target/message | J2 grep | 5/2 上午 |
| KI-6 | NWT operator hat curl -s 双 INSERT | NWT 自承认 | 5/2 下午 |
| KI-7 | (撤销, architect 凭印象推 storage_mass, Owner 矫正) | Owner 拦 | 5/2 中午 |
| KI-8 v1 | Owner role boundary (system verify) | Owner 钦定 | 5/2 上午 |
| KI-8 v2 | Owner role boundary 扩展 (任何 role-bounded work) | Owner 矫正 3 次复刻 | 5/2-5/3 |
| KI-9 | outer try/catch 静默 swallow 反模式 | J2 grep | 5/2 下午 |
| KI-10 | cross-agent handshake decrypt fail (Bug A) | NWT operator | 5/2 晚 |
| KI-11 | Path C /api/relay/:id/restart hot-fix 工具 | NWT 设计 | 5/2 下午 |
| KI-12 | (iii) + telemetry 配套 ship 教条 | NWT 设计 | 5/2 下午 |
| KI-13 v1 | J2 self-identify operational boundary | J2 实证 | 5/2 上午 |
| KI-13 v2 | Cross-hat boundary 双向严守 | Owner 矫正 NWT 越界 | 5/2 下午 |
| KI-14 | cron skip_in_cron flag declared 但 runner 只读 skip_in_batch | NWT triage | 5/3 |
| KI-15 | 12h close 真定义 ≠ 时钟到 | Owner 拦 r138 + 21:03 alarm | 5/2-5/3 |
| KI-16 | Health 必区分 alive vs functioning | NWT triage 5/3 LLM crash | 5/3 |
| KI-17 | Broker 成功三层 (识别 + 对接 + 反馈) | Owner 钦定 | 5/3 |

**注**: KI-7 撤销, 因为是 architect 凭印象推论, 不是真 KI。撤销过程本身 sediment 进 invariant 1.2。

---

## 附录 B: 6 反模式实例

**Architect (我) 反模式 3 次, 全 Owner 拦**:

1. **重写 broker** (5/1) - 接 Owner "broker 是 KANet 的 broker" 之后跳重写, Owner 拦
2. **凭印象推 KI-7** (5/2 中午) - storage_mass 凭印象推论, Owner 矫正
3. **KANet MCP server 立即 ship** (5/2 晚) - 接 Owner "Cowork" 后跳 MCP 方案, 自拦

**NWT 反模式 3 次**:

4. **r107 v0.4 sweep mood-swing** (5/2 上午) - implementor reverse data 自动 negate spec, Owner 拦
5. **越界 ship implementor commit** (5/2 上午) - ec1427803 + 2b0359c7b NWT 自 ship Step 1+2, KI-13 v2 sediment
6. **r138 跳 12h gun** (5/2 晚) - 直接说 "Phase 1 CLOSED", Owner 拦, KI-15 sediment

---

## 附录 C: Phase 1 layered protection 4 角色救场 trace

| 时点 | 事件 | 救场角色 |
|---|---|---|
| 5/2 上午 | J2 grep KI-2/3/4/5 catch | Implementor |
| 5/2 上午 | Owner 拦 NWT v0.4 sweep | Product Owner |
| 5/2 上午 | NWT cross-review SA-2 + SA-4 race | Architect (NWT reviewer hat) |
| 5/2 下午 | Owner 钦定 KI-8 v1 (system verify) | Product Owner |
| 5/2 下午 | NWT 自承认 KI-6 双 INSERT | Operator |
| 5/2 下午 | J2 主动 standby T1.6/T1.8 | Implementor (5 轴第 5 实证) |
| 5/2 晚 | Owner 拦 r138 跳 12h gun | Product Owner |
| 5/2 晚 | Owner 矫正 KI-8 复刻 (J2 r123 后) | Product Owner |
| 5/2 晚 | Owner 矫正 KI-8 复刻 (NWT r140) | Product Owner |
| 5/2 21:03 | Cron alarm 自动 catch baseline drift | System Monitoring |
| 5/2 21:17 | LLM infra silent 崩 (隐性, 5/3 早 catch) | System (silent) |
| 5/3 早 | NWT triage 5/3 LLM crash + 选 γ restart | Operator + Architect |
| 5/3 早 | Owner 矫正 architect 凭印象 +100 LOC | Product Owner |
| 5/3 早 | Owner 钦定 KI-17 broker 三层 | Product Owner |
| 5/3 早 | Owner 矫正 KI-8 复刻第 3 次 (NWT broadcast 后) | Product Owner |

**统计**:
- Owner 拦截: 7 次 (Phase 1 期间)
- Implementor 自识别: 6 次 (J2)
- Architect 自拦: 1 次 (我自拦 MCP server)
- System 自动 catch: 2 次 (cron alarm + LLM 间接)
- NWT cross-review: 4 次 (Bug 1 cycle)

---

## 附录 D: KANet 工程文化健康度指标

按本文档 sediment, 健康度 metric:

| Metric | Phase 1 数据 | 目标 |
|---|---|---|
| Implementor 自识别越界 / 总越界 | 6/7 ≈ 86% | > 80% |
| Architect 凭印象次数 | 3 次 (5/2-5/3) | < 1 次/phase (Phase 2 目标) |
| Owner 拦截 / 总反模式 | 7/12 ≈ 58% | < 30% (Phase 2 目标 — 让 sediment 替代 Owner 拦截) |
| Test : Ship LOC ratio | 1:1 | ≥ 1:1 |
| KI sediment 速度 | 17 KI / 4 days | 持续 |
| Silent 盲区 catch 时间 | LLM crash ~9.5h (21:17 → 5/3 早 6:51) | < 1h (Phase 2 目标 — KI-16 health probe) |

---

## v0.1 → v0.2 触发条件

本文档应在以下时点修订:
- Phase 2 close 之后批量 sediment 新 KI
- 任何 KI 复刻 ≥ 2 次 (实证 sediment 不够深)
- Architect 凭印象次数 ≥ 1 in Phase 2 (扩 1.2)
- 任何 health silent 盲区暴露 (扩 4.1)

---

*v0.1 — 2026-05-03 Architect mode (claude.ai) 起草. Retro report 数据 + Phase 1 实施 trace + 17 KI sediment + 6 反模式 evidence + 5 轴 layered protection. NWT reviewer hat 审 + Owner final ack 待.*

*KANet 工程文化的真核心: Sediment is forward-looking, not just retrospective.*
