# KANet 系统成熟度评估报告

> 2026-03-27 全系统评估。基于当日完成的安全底线审计、Mind 感知审计、22 文件修改后的系统状态。

---

## 逐层成熟度评估

### 基础设施层（Relay/Scout/Console/Adapter）—— 90% 收敛

| 指标 | 状态 |
|------|------|
| Relay RPC 模式 | ✅ 稳定运行，三层消息防护（Brain cooldown + Console 回复去重 + Relay 发送拦截） |
| Scout 可观测 | ✅ 36 地址基线，双路写入 relation_states + chain_events |
| Console 数据中枢 | ✅ v31 迁移完成，25+ 表 |
| Adapter 多 provider | ✅ OpenAI/Anthropic/Deepseek |
| 进程管理 | ✅ PID 文件，自动启停 |
| 共享模块 | ✅ resolveRpcUrl 提取到 shared/lib/ |

**剩余债务**：hardcoded 绝对路径（`D:/Anthropic/...`）、protocol.mjs 部分重复。不阻塞但部署时要清。

### 协议状态层 —— 95% 收敛

| 指标 | 状态 |
|------|------|
| relation_states 唯一真相源 | ✅ 所有读路径已迁移（Context Builder / Gate 1 / identities.js / Discovered / Catch-up） |
| chain_events 链上事实归档 | ✅ 成功 + 失败 + 验证 + underpayment 全覆盖 |
| 10 条安全底线 | ✅ 全部对齐（3/27 审计 + 修复） |
| account_relations 旧表 | ⚠️ 仍在双写（写入未切断），读路径已迁移 |
| interaction_records 旧表 | ⚠️ chain-data.js / events.js 仍重度读取 |

**判断**：协议核心已收敛。旧表是"技术债"不是"结构缺陷"——可以渐进清退，不影响新功能开发。

### 自由市场 —— 90% 收敛（3/27 晚更新：交易协议上链完成）

| 指标 | 状态 |
|------|------|
| 状态机完整性 | ✅ 10 状态 + escalated，POST_PAYMENT_STATUSES 保护 |
| 三模式 | ✅ auto/approval/manual 全跑通（Phase 2-4 已验证） |
| 资金保护 | ✅ 真实余额查询 + fund_lock + 三层限额 + 30% 硬约束 |
| 多链验证 | ✅ BNB/ETH/SOL/TRON 4 链自动验证 |
| 争议升级 | ✅ 15min 重验 / 30min 通知 / 60min escalated |
| 真链全流程 | ✅ 已实战验证（3/25 首笔 OTC + 3/27 全自动闭环） |
| **交易协议上链** | ✅ trade-protocol-filter.js 7 种消息处理器，链上全生命周期，问责上链 |
| **交易室 v2** | ✅ market.eta 对话即交易，链上广播发布/接单 |

**未收敛**：
- 并发保护（同一订单两个请求可能 race）
- SOL/TRON **发送** USDT（只做了验证，没做发送）
- 交易室 UI 功能完整但**不是产品级的**
- 跨节点交易（协议已实现，实际跨节点测试待做）

### Agent Mind 层 —— 70% 收敛

**这是最关键的判断。**

| 指标 | 状态 |
|------|------|
| 五核架构 | ✅ Self/Memory/Perception/Intent/Evolution 完整运行 |
| Context Builder 数据质量 | ✅ 时间维度 6 字段 + 方向 + 3 条 peerNotes + NEVER REPLIED 警告 |
| 目标执行反馈 | ✅ recordAttempt + cooldown 阶梯 + auto-retire（3/27 上线，尚未验证长期效果） |
| 反思进化 | ⚠️ 刚从 24h→12h，增强了目标执行历史输入，**没有数据证明进化质量** |
| 社交行为质量 | ⚠️ 机制到位但 Agent 只"活"了 2 周，**97% 是内部互动** |
| 幻觉/循环防护 | ✅ 三层防御纵深（Brain cooldown → Console 回复去重 → Relay 发送拦截） |
| 外部用户互动 | ❌ 仅 3% 外部流量（不是 bug，是没推广） |

**真话**：Mind 的**架构**收敛了，但**行为质量**没收敛。今天加的 cooldown/auto-retire/时间新鲜度排序都是机制——机制需要**运行数据验证**才能说有效。目前只有 2 小时的观察数据，远不够下结论。

### UI 层 —— 50%

| 页面 | 功能完整度 | 产品级 |
|------|-----------|--------|
| Agent 页面 | ✅ | ❌ 信息密度高但组织粗糙 |
| Trading 页面 | ✅ | ❌ 功能堆叠，非一页闭环 |
| Chat 页面 | ✅ | ⚠️ 基本可用 |
| Discovered 页面 | ✅ | ⚠️ 基本可用 |
| Whale Signal 页面 | ✅ | ⚠️ 基本可用 |
| 整体视觉 | — | ❌ 没有统一设计语言 |
| 移动端 | — | ❌ 未考虑 |

---

## 总体判断

**KANet 处于"后端架构收敛 → UI/产品化攻坚"的转折点。**

### 可以进 UI 攻坚的条件（已满足）：
- 数据架构稳定，不会再大改表结构
- 安全底线全对齐，不会影响 UI 逻辑
- 状态机完整，UI 可以信任后端状态
- 多链支持到位，UI 不需要等后端

### 还不能完全放开 UI 的条件（未满足）：
- **Agent 行为质量未验证** — 如果 Mind 的行为在 48h 观察后暴露新问题，可能要回头改 context-builder 或 action-executor，UI 跟着变
- **旧表双写未切断** — identities.js 已迁移读路径，但 ingest-service.js 仍双写 account_relations 和 interaction_records。如果 UI 建在旧数据上再迁移会很痛

---

## 建议路线

```
现在 ──→ 48h 观察期 ──→ UI 攻坚
         │                │
         ├ 跑行为分析脚本   ├ 交易室一页闭环
         ├ 看目标 cooldown  ├ Agent 页面重构
         ├ 看反思 12h 效果  ├ 统一设计语言
         └ 切断旧表双写     └ 三层可验证首屏
```

48h 观察期不是等，是边观察边准备——清理旧表写入路径、设计 UI 方案、准备交互原型。观察数据到了，直接进 UI 全面攻坚。

**一句话：后端 85% 收敛，可以开始 UI 了，但不是"只做 UI"——还有 15% 的后端观察和清理要并行。**

---

## 附录：3/27 修改清单（22 文件）

| 文件 | 改动 |
|------|------|
| kasia-console/src/services/order-machine.js | VALID_TRANSITIONS post-payment 保护 + POST_PAYMENT_STATUSES + escalated + disputed 同步 |
| kasia-console/src/services/trade-action.js | triggerNextStep manual guard |
| kasia-console/src/services/mind-manager.js | Gate 1 读 relation_states + dispute→escalated 升级 |
| kasia-console/src/api/trading.js | 4× chain_events + 真实余额 + 动态端口 + SOL/TRON 验证 |
| kasia-console/src/api/identities.js | 改读 relation_states 替代 account_relations |
| kasia-console/src/data/state/replies.js | @deprecated updateReplyStatus |
| kasia-console/src/db/migrate.js | v31: relation_states trust_level + is_blocked |
| kasia-console/scripts/analyze-agent-behavior.js | **新建**：行为量化分析脚本 |
| agent-mind/src/kernels/intent.mjs | recordAttempt + findGoalForAction + context 增强 |
| agent-mind/src/context-builder.mjs | 目标执行历史 + 3 notes + 反思 intent + 反思指令增强 |
| agent-mind/src/mind.mjs | proactive 反馈 + intent.save |
| agent-mind/src/skills/social-outreach.mjs | 时间新鲜度 v4 |
| kasia-relay/src/relay.mjs | shouldBlockOutbound 消息去重 + 幻觉拦截 |
| shared/lib/rpc-utils.mjs | **新建**：共享 RPC 工具 |
| kaspa-scout/src/rpc-scanner.mjs | 引用共享 resolveRpcUrl |
| kasia-relay/src/rpc-listener.mjs | 引用共享 resolveRpcUrl |
| docs/free-market-design.md | 三阶段语义 + 底线 4 更新 + SOL 确认数 |
| docs/dev-trading.md | **新建**：自由市场开发者文档 |
| docs/kanet-maturity-assessment-0327.md | **新建**：本评估报告 |
