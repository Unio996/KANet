# KANet Alpha — Definition of Done

> 达到以下 4 条标准 = Alpha Ready，可以给外部用户使用。

---

## 1. Agent 自治稳定性

**标准：4 个 Agent 连续运行 72h 无人工干预，零骚扰事件。**

| 检查项 | 当前状态 | 达标 |
|--------|---------|------|
| 4 Agent 全绿（health monitor） | 4/4 green (2026-03-31) | OK |
| 零重复 DM（同一人 48h 内 ≤3 条） | anti-spam 已修复 event_type 对齐 | Monitoring |
| 零广播循环 | 广播去重 + 回声室修复 | OK |
| Proactive 日限 50 次 | mind-manager.js 从 events 实时查 | OK |
| Sophie 正常运行 | relay 正常, proactive 执行中 | OK |
| Self-healing 生效 | 黄→silentRepair, 红→emergencyRepair | OK |

**验证方法：** 72h 后运行 `scripts/analyze-agent-behavior.js`，确认无骚扰模式。

---

## 2. 外部用户完整流程

**标准：一个外部用户能完成 发现Agent → 握手 → 对话 → OTC 交易。**

| 步骤 | 检查项 | 当前状态 |
|------|--------|---------|
| 发现 | Scout 扫到外部用户的地址 | OK（36 地址基线） |
| 握手 | 外部用户发握手 → Relay 自动接受 + 回复 | OK |
| 对话 | 外部用户发消息 → AI 回复 | OK |
| OTC 交易 | 发布订单 → 接单 → 付款 → 验证 → 交割 → 完成 | OK（实战验证过） |
| 异常处理 | 超时 → disputed → escalated | OK（框架已建） |

**验证方法：** 用新的 Kaspa 钱包从零走一遍完整流程。

---

## 3. 开发者指南

**标准：单文件开发者指南，新 AI 会话 5 分钟内上手。**

| 检查项 | 当前状态 |
|--------|---------|
| `docs/DEVELOPER-GUIDE.md` 存在 | OK (2026-03-31) |
| 覆盖全部 5 大系统 | OK（11 章） |
| 消息管道 5 条路径全部文档化 | OK |
| chain_events 数据合约 | OK（枚举表 + shared/lib/event-types.mjs） |
| 致命陷阱清单 | OK（8 项） |
| 关键文件速查表 | OK（15 个文件） |

**验证方法：** 新会话读 DEVELOPER-GUIDE.md + CLAUDE.md 后能独立做小任务。

---

## 4. Smoke Test 全绿

**标准：`node test/smoke.mjs` 全部通过。**

| 类别 | 测试数 | 当前状态 |
|------|--------|---------|
| 系统连接 | 3 | 3 pass |
| Anti-Spam | 3 | 3 pass |
| 交易系统 | 2 | 2 pass |
| Mind 系统 | 1 | 1 pass |
| 市场数据 | 2 | 2 pass |
| UI 页面 | 9 | 9 pass |
| 数据完整性 | 1 | 1 pass (1 skip) |
| **总计** | **21** | **21 pass, 0 fail** |

**验证方法：** `node test/smoke.mjs` 退出码 0。

---

## 当前综合状态

| Alpha 标准 | 达标？ | 待验证 |
|-----------|--------|--------|
| 72h 无人工干预 | **Monitoring** | 3/31 重启后开始计时 |
| 外部用户完整流程 | **Ready** | 需要实际测试 |
| 开发者指南 | **Done** | — |
| Smoke test 全绿 | **Done** | — |

**结论：2/4 已达标，1/4 监测中，1/4 待实测。预计 72h 后（2026-04-03）可宣布 Alpha。**
