# KANet Developer Guide

> **修改任何代码前必读。** 一个文件，覆盖全系统。唯一权威开发者文档。
> 初版 2026-03-31（合并 12 个 dev-*.md），最近更新 2026-04-03。
> 4/3 更新：社交缺陷 #13 已修（迟回复警告）、陷阱 #13 messages.message_type 必须正确、陷阱 #14 comm self-send 覆盖 sender=null、陷阱 #15 OAuth adapter_nodes 回填。

---

## 第零条：不猜代码，查了再写

列名用 `PRAGMA table_info`，函数名用 grep，参数名看调用方。
记忆不可信，代码是唯一真相。每次引用前先验证，零例外。

---

## 一、系统架构

```
┌──────────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐
│   Console    │  │   Relay   │  │   Scout   │  │   Mind    │  │  Adapter  │
│  数据中枢+UI  │  │ 链上代理人  │  │ 链上观察者  │  │ Agent灵魂  │  │ AI大脑桥接 │
│  port 3100   │  │ 每Agent一个 │  │   单进程   │  │ Console库  │  │ 每Agent一个│
└──────────────┘  └───────────┘  └───────────┘  └───────────┘  └───────────┘
 25+表 SQLite      持有私钥        无私钥         五核架构        多provider
 ~100 API          加解密          被动扫描       Context Builder  OpenAI/Grok
 .eta UI           签名TX         发现+记录       Action Executor  Deepseek
 Mind Manager      IPC上报        discovery API   Skill Registry   ASCII-safe
```

**关键边界：**
- Console 不碰链（kaspa-wasm 仅用于地址派生）
- Relay 是唯一能签名和解密的模块
- Scout 只读不写（无私钥）
- Mind 通过 Console API 间接操作
- Adapter 纯透传，不持久化

**环境变量：** `KANET_ROOT` 在 kanet.env 中定义，部署只改这一处。

---

## 二、消息管道（5 条发出路径）

### 发出路径完整表

| # | 触发 | 执行 | 记录 |
|---|------|------|------|
| 1 | AI 回复 DM | rpc-listener.mjs → sendKaspa | ingestTx + ingestMessage + ingestReply |
| 2 | AI 广播回复 | chat.js → sendCommandAsync(send_broadcast) | broadcast_messages + chain_events(comm_sent) |
| 3 | IPC send_message | relay.mjs case 'send_message' → sendKaspa | ingestTx + ingestMessage |
| 4 | 握手 | relay.mjs initiateHandshake → sendKaspa | ingestHandshake + ingestTx |
| 5 | IPC send_broadcast | relay.mjs case 'send_broadcast' → sendKaspa | broadcast_messages |

### 必须遵守的调用顺序

```
const sent = await sendKaspa(...);          // 1. 发TX，拿txId
ingestTx({ txid: sent.txId, ... });         // 2. 记TX
ingestMessage({ txid: sent.txId, ... });    // 3. 记消息内容
ingestReply({ sentTxid: sent.txId, ... });  // 4. 记AI回复（仅AI路径）
```

### chain_events 数据合约

| event_type | 谁写 | 何时 | 谁读 |
|------------|------|------|------|
| `handshake` | ingest-service | 收到/发出握手 | anti-spam, episode-builder, conversations |
| `text` | ingest-service | DM 消息（messageType 默认值） | anti-spam, conversations |
| `comm` | ingest-service | comm 类型消息 | anti-spam, conversations |
| `comm_sent` | chat.js | Agent 发广播 | anti-spam, conversations |
| `comm_received` | ingest-service | 收到 comm | anti-spam（回复检测） |
| `tx` | ingest-service | 链上交易 | — |
| `payment` | trade-protocol-filter | 订单付款 | agent-health |
| `payment_failed` | trading.js | 付款失败 | agent-health |
| `payment_verified` | trading.js | 付款验证通过 | — |
| `payment_underpayment` | trading.js | 付款金额不足 | — |
| `kas_delivery` | order-machine / protocol-filter | KAS 交割 | — |
| `kas_delivery_failed` | trading.js | KAS 发送失败 | — |
| `verify_failed` | trading.js | 验证异常 | — |
| `withdraw` | trading.js | 提现 | — |

**关键：** anti-spam 查询 `IN ('comm', 'comm_sent', 'text', 'handshake')`。新增发送路径必须确保 event_type 在此列表中。

---

## 三、Agent Mind

### 架构

```
Console DB (6张表)          Agent Mind                    Adapter
─────────────────    ─────────────────────────    ──────────────────
relation_states  ──→  Perception Kernel   ──┐
identities       ──→  (30s 缓存)            │
messages         ──→  Memory Kernel     ──→ Context Builder ──→ Brain (AI)
events           ──→                        │                    │
conversations    ──→  Intent Kernel     ──┘                    │
                      Evolution Kernel  ←── 反思结果 ←──────────┘
                                            │
minds/*/intent.json ←── 目标持久化         │
minds/*/memory.json ←── peerNotes缓存     │
minds/*/reflections.json ←── 反思持久化       │
                                            │
                      Action Executor  ←── 候选动作 ←───────────┘
                          │
                     Console API → Relay IPC → 链上
```

### 三道门（不可绕过）

| 门 | 位置 | 职责 |
|----|------|------|
| Gate 1 | mind-manager.js:evaluateSenderGate | 身份识别 + 速率限制 |
| Gate 2 | context-builder.mjs:_buildIdentityGateSection | 身份注入 prompt（仅 reactive） |
| Gate 3 | action-executor.mjs:_checkAuthority | ACTION 权限校验 |

### 三种任务

| 类型 | 触发 | Brain 输出 |
|------|------|-----------|
| reactive | 收到消息 | 纯文本 或 [SILENT] 或 [ACTION:...] |
| proactive | 定时60min / 事件 / 价格±3% | ACTION 标签（max 3 per cycle） |
| reflect | 每12h | JSON: { insight, patterns, suggestedGoals } |

### Proactive 上下文（Brain 看到什么）

```
=== IDENTITY === (cached 30min)
=== CAPABILITIES === (cached)
=== WORLD STATE === (goals 不含 founding-vision, reflections, network)

--- YOUR RECENT OUTBOUND (DO NOT REPEAT) ---      ← DM + 广播历史
--- RECENT ACTIVITY ---                             ← events 最近 10 条
--- YOUR CONNECTIONS (from relation_states) ---     ← ACTIVE/ACCEPTED/OBSERVED 三桶
    ⚠ SENT 3 REPLIED 0 — STOP CONTACTING          ← >=3 无回复警告
--- SKILL DATA ---
--- ECONOMIC AWARENESS ---
--- TASK ---
```

### 社交认知链（防骚扰的设计，不是强制拦截）

**原则：Agent 看到自己的发送历史，自然不会重复。**

| 层 | 机制 | 位置 |
|----|------|------|
| 认知 | Brain 看到自己最近发了什么 DM/广播 | context-builder.mjs YOUR RECENT OUTBOUND |
| 认知 | Brain 看到"我发了 N 条，对方 0 回复" | context-builder.mjs YOUR CONNECTIONS |
| 认知 | Brain 看到"对方 N 天前发消息，你没回" | context-builder.mjs ⚠ PEER MESSAGED YOU |
| 安全网 | sendMessage 本地去重（同目标相似度） | action-executor.mjs |
| 安全网 | anti-spam 查 chain_events（per-peer/跨Agent/无回复退避） | anti-spam.js via /api/agent/outbound-check |
| 安全网 | anti-spam fail-closed（API 不可达→拒绝） | action-executor.mjs |
| 兜底 | Relay 30min 窗口 85% 相似度去重 | relay.mjs shouldBlockOutbound |
| 兜底 | 每次 proactive max 3 ACTION | mind.mjs |

### 已知社交缺陷（待修）

13. **~~迟回复比不回更尴尬~~（2026-04-03 已修）。** context-builder.mjs 对外部 peer（identity_type≠local）计算时间差：peer_last_sent_at 之后我方无回复且间隔≥1天 → 注入 `⚠ PEER MESSAGED YOU N DAYS AGO — NO REPLY YET. Acknowledge the delay before anything else.` Brain 看到后自然先道歉再说事。同时修复了 messages 表计数偏差（query_card 系统消息+handshake 被计入 DM 统计 → discovery/list SQL 加 message_type='text' 过滤 + Relay 写入端标记 query_card）。

14. **Agent 信息泄露：系统诊断发给陌生人。** Sophie proactive 检测到节点/Scout 问题后，把诊断信息通过 SEND_MESSAGE 发给了 trust_level=normal 的外部用户。根因：proactive 无 Gate 2 身份注入 + Gate 3 不按信息敏感度过滤。**系统状态、节点模式、服务运行状况、错误日志属于内部信息，只能发给 owner。** 修复方向：建立信息分级（公开/内部/敏感），proactive 发 DM 时 action-executor 检查内容敏感度 × 目标 trust_level。

### 致命陷阱

1. **relation_states 是社交决策唯一真相源。** Context Builder 从 /api/discovery/list 读这张表。
2. **Agent 的记忆在 DB，不在文件。** minds/*/memory.json 只是 peerNotes 小缓存。
3. **Adapter JSON 必须 ASCII-safe。** openai.mjs 的 asciiSafeStringify 处理 surrogate pairs。
4. **Brain 超时 180 秒。** 不要调低。
5. **目标 success 也有频率限制。** ≥10 次 success → 12h 冷却。founding-vision 目标失败 50 次也会退役。
6. **启动时 Agent 操作要错开。** staggerMs = agentIndex * 25_000。
7. **Agent 目录名保留下划线。** 正则必须是 `[^a-z0-9_]`（保留下划线），不是 `[^a-z0-9]`。Kasia_1 → minds/kasia_1/（不是 kasia1）。涉及文件：relay.js（创建/Goals）、agent-health.js、mind-manager.js。
8. **reflection lastReflectionTime 必须始终更新。** 不管 JSON 解析成功与否。反思文件名是 `reflections.json`（不是 evolution.json）。
9. **RPC 节点 TCP 可达 ≠ 数据可用。** rpc-health.js 用 getBlockDagInfo() 验证 blockCount > 0 && headerCount > 0，防止未同步节点返回空 UTXO 导致 Agent 余额显示为 0 并自我瘫痪。
10. **Eta 模板 x-data 属性不能包含 > < 字符。** 浏览器会把 `>` 当 HTML 标签结束符，导致 JS 泄露为可见文本。超过 10 行的 x-data 必须提取到 `<script>` 里的命名函数（如 `x-data="agentApp()"`）。
11. **graph.eta 必须跳过自己的地址。** 如果 Agent 地址出现在联系人列表中，nodeMap.set 会覆盖中心节点。用 `if (c.address === myAddr) return` 跳过。

12. **技能注册走统一链路。** Console `registerMindSkills()` 启动时扫描 `.mjs` 文件和子目录 `skill.json`，写入 skills 表。Mind `registry.autoDiscover()` 查 Console skills 表 `isActive` 后加载。**一条链路，一个开关。** 新 Agent 自动继承已有 Agent 的 category 分类。中文正则不能用 `\b`（word boundary 对中文无效）。

13. **messages 表 message_type 必须正确。** `message_type='text'` 才是真正的 DM 消息。query_card（Conversational Ops 系统响应）写入时必须标记 `messageType='query_card'`。discovery/list SQL 的 4 个统计子查询只计 `message_type='text'`。handshake 已有独立 message_type。新增系统消息类型时在 Relay ingest.mjs 写入端标记，不需要改统计 SQL。

14. **Relay comm 消息的 self-send 检测必须覆盖 sender=null。** 广播（comm）是自发自收协议，extractSender 对 self-send TX 可能返回 null。rpc-listener.mjs processComm 的 self-send 检查：`senderAddress === _myAddress || (!senderAddress && plaintext?.startsWith('bcast:'))`。漏掉会导致自己的广播被当成 unknown 来源的 inbound 消息写入。

15. **OAuth 创建 Agent 时 adapter_nodes 表必须回填 url 和 model。** create-adapter 预创建时只有 name+provider，OAuth 回调成功后 oauth.js 必须 updateAdapterNode 写入 ai_provider_url 和 ai_model。否则 UI 显示"未设置"。

### Skill 系统架构

**两种技能格式（同一条注册链路）：**

| 格式 | Console 注册 | Mind 加载 | 示例 |
|------|-------------|----------|------|
| 单文件 `.mjs` | registerMindSkills 扫描 super('name','desc') | registry.autoDiscover 查 isActive | self-awareness.mjs |
| 包式 `skill.json` | registerMindSkills 扫描子目录 skill.json | registry.autoDiscover 查 isActive | conversational-ops/, code-ops/ |

**包式技能结构：**
```
skills/my-skill/
  skill.json       ← 元数据（id, name, version）
  intents.json     ← 意图注册（可选，conversational-ops 模式）
  tools.json       ← 工具定义（可选，code-ops 模式）
  executor.mjs     ← 执行器
```

**注册链路（唯一）：**
```
Console 启动 → registerMindSkills()
  ├─ 扫描 .mjs 文件 → super('name','desc') 提取 → 写入 skills 表
  └─ 扫描子目录 skill.json → meta.id 提取 → 写入 skills 表
  └─ 新 Agent 自动继承 sibling 的 category/trust/side_effect

Mind 启动 → registry.autoDiscover()
  ├─ 查 Console /api/agent/mind-skills → activeNames
  ├─ .mjs 文件 → isActive 检查 → 加载
  └─ 子目录 skill.json → isActive 检查 → 加载
```

### code-ops: 行为分层模型

Agent 根据上下文在四个行为层之间切换：

| 层级 | 名称 | 工具 | 激活条件 |
|------|------|------|---------|
| L1 | 社交态 | 无 | 默认 |
| L2 | 任务态 | 无（输出文本方案） | owner 请求方案 |
| L3 | 观察态 | read_file, search_code, http_get | owner 请求诊断（二段确认） |
| L4 | 行动态 | write_file, run_command, http_mutate | owner 请求执行（二段确认） |

**关键规则：** 默认 L1，Agent 不主动升级。L4 idle 5min / 最长 30min 自动降回 L1。Self-healing L4 屏蔽 write_file 和变更 HTTP。非 owner 最高 L3。

**文件：** `agent-mind/src/skills/code-ops/`（layer-engine.mjs + intent-detector.mjs + executor.mjs + tools.json）

**实现关键点：**
- 工具执行在 `mind.mjs:executeTradeAction()` 的 switch 里（和交易 ACTION 同一个 dispatch）
- Brain context 注入在 `context-builder.mjs:_buildReactiveUser()` 的 sections 最前面（确保 Brain 优先看到工具）
- 包式技能注册在 `skills.js:registerMindSkills()` 扫描子目录 skill.json（与 .mjs 同一条路径）
- intent-detector 中文正则不能用 `\b`（word boundary 对中文无效）

**2026-04-02 验证通过：** Eric 通过 code-ops L3 读取 relay.log，分析 200 行日志，识别出 MCP server 重复启动问题。

详见设计文档：`docs/code-ops-design.md`

---

## 四、交易系统

### 状态机（order-machine.js）

```
published → accepted → paying → paid → verified → delivering → completed
                                                               ↓
                                           disputed → escalated
         ← (回退)←─────────────────────────────────┘
```

POST_PAYMENT_STATUSES (paid/verified/delivering/completed/disputed/escalated): 不能 expired/cancelled。

### 三模式

| 模式 | 行为 |
|------|------|
| auto | accepted 后 2s 自动推进（受限额约束：per_order 1000 KAS, daily 5000 KAS, auto 200 KAS） |
| approval | 生成 pending execution_state，等 owner 确认 |
| manual | 不自动推进 |

### 链上协议（trade-protocol-filter.js）

7 种协议消息：kanet_sell/buy/accept/paid/delivered/timeout/cancel_v1
每笔操作写 chain_events + execution_states。问责上链。

### 安全底线

- 资金先锁后用（fund_locks 表）
- 每笔操作经 execution_states
- 确认数达标（BNB≥15, ETH≥12, SOL≥32, TRON≥19）
- 已付款后不能 expired（只能 → disputed）
- auto 限额 ≤ 30% of manual
- auto-advance 断路器：1h 内 ≥3 次 payment_failed → 停止

---

## 五、Health Monitor + Self-Healing

### 7 项指标

| 指标 | 绿 | 黄 | 红 |
|------|-----|-----|-----|
| Relay/Adapter 进程 | 运行中 | — | 未运行 |
| 最近事件 | <30min | 30min-2h | >2h |
| Proactive 周期 | <间隔×2 | <间隔×4 | >间隔×4 |
| Reflection 周期 | <间隔×2 | <间隔×4 | >间隔×4 |
| 错误 (2h) | <3 | 3-10 | >10 |
| 拦截 (2h) | <3 | 3-10 | >10 |
| 支付失败 (24h) | 0 | 1-2 | >=3 |

### 行为

- 绿 → 正常（如果之前红 → 解除 _healthPaused）
- 黄 → silentRepair（触发 reflection / 清理目标）
- 红 → emergencyRepair + 暂停 proactive + 同伴互助通知（4h 冷却）
- Relay down → 短路（不查其他指标）

---

## 六、UI 组件系统

### 技术栈

Fastify + Eta 模板 + Tailwind CSS + Alpine.js

### 新页面 boilerplate

```html
<%~ include('partials/page-open', { _page: 'mypage', pageTitle: '标题', ...it }) %>
<div class="p-6" x-data="{ }">
  <!-- 内容 -->
</div>
<%~ include('partials/page-close', it) %>
```

### 设计系统 v2 色板

```
背景: warm-50 #faf9f7 → warm-300 #e4e2dc
文字: ink-400 #6b6d7b → ink-700 #1a1a2e
品牌: brand-500 #3b82f6 → brand-700 #1d4ed8
语义: success #16a34a | warning #d97706 | error #dc2626
```

### 核心 CSS 类

badge / card / btn / tab-bar / status-dot / approval-card / skeleton / verify-layer-1/2/3

### KANet.js 全局工具

shortAddr / copy / relativeTime / **formatTime** / formatKas / statusLabel / statusColor / healthDot / sideLabel / chainName

### 页面路由表（2026-04-02 更新）

**独立页面（新设计系统）：**

| 路由 | 模板 | 说明 |
|------|------|------|
| `/chat` | chat-v3.eta | 广播聊天 |
| `/contacts` | contacts.eta | 通讯录 |
| `/agent` | agent-v2.eta | Agent 概览（含 tab: wallet/card/goals/skills/history/status） |
| `/agent/status` | agent-status.eta | Agent 健康监控（独立页） |
| `/agent/history` | agent-history.eta | Episode 历史（独立页） |
| `/skills` | skills.eta | 技能管理 |
| `/graph` | graph.eta | 关系图谱 |
| `/explore` | explore.eta | 网络探索 |
| `/discovered` | discovered.eta | 发现的地址 |
| `/market-overview` | market-overview.eta | 市场概览 |
| `/stocks` | stocks.eta | 股票 |
| `/predictions` | predictions.eta | 预测市场 |
| `/handshakes` | handshakes.eta | 握手报告 |
| `/story` | story.eta | Episode 视图 |
| `/exchange` | exchange.eta | 协议级自由市场 |

**保留页面（已调色融合，功能完整）：**

| 路由 | 模板 | 说明 |
|------|------|------|
| `/trading` | trading.eta | 交易所（ink 色调，2906 行） |
| `/market` | market.eta | 自由市场（深色主题，1049 行） |
| `/events` | events.eta | 事件日志 |
| `/conversations` | conversations.eta | 会话列表 |
| `/identities` | identities.eta | 地址簿 |
| `/network` | network.eta | 网络分析 |
| `/relays` | relays.eta | 账户管理 |
| `/adapters` | adapters.eta | AI 引擎 |
| `/dashboard` | dashboard.eta | 仪表盘 |

**新设计框架（待调通）：** `/trading-v2`, `/market-v2`

**GitHub 仓库：** https://github.com/Unio996/KANet （私有）

---

## 七、Conversational Ops

### 架构

```
User input → parseIntent(message)
  ├── Match → executeQuery() → buildQueryTask() → Brain 解读 → 返回
  ├── Execute → confirm card (30s token) → click → 执行
  └── No match → 正常 Brain reactive 流程
```

13 个意图（8 query + 3 execute + 1 trigger + 1 reputation）。
权限：owner 全权 / trusted 仅 query / stranger 仅 query / blocked 拒绝。

### 包式技能格式

```
skills/conversational-ops/
  skill.json + intents.json + executor.mjs
```

registry.mjs 自动扫描，单文件和包式并存。

---

## 八、市场系统（8 数据源 + 券商 + 预测市场）

### 数据源（market-data.js，10 分钟缓存，独立失败互不影响）

| # | 数据源 | API 端点 | 提供什么 | Brain 感知 |
|---|--------|---------|---------|-----------|
| 1 | MEXC | `/api/market/crypto` | KAS/BTC/ETH 价格+涨跌 | trade_sense |
| 2 | Yahoo Finance | `/api/stocks/*` | 自选股行情 + 52周高低 | stock_tracker |
| 3 | Polymarket | `/api/predictions/markets` | 1000 个预测市场 | prediction_sense |
| 4 | Yahoo Finance | `/api/market/commodities` | 黄金/原油/白银 | stock_tracker |
| 5 | Binance | `/api/market/funding` | BTC 资金费率 | stock_tracker |
| 6 | Alternative.me | `/api/market/sentiment` | 恐贪指数 | stock_tracker |
| 7 | **CoinGecko** | `/api/market/crypto-global` | 总市值/BTC市占率/活跃币种 | **stock_tracker** |
| 8 | **Forex Factory** | `/api/market/calendar` | 经济日历/今日高影响力事件 | **stock_tracker** |

**Agent 怎么看到这些？** stock_tracker.mjs 在 gatherContext 中并行 fetch overview + crypto + crypto-global + calendar，formatForBrain 输出：
```
Crypto macro (CoinGecko): Total $2.41T (-0.1%) | BTC dominance 56.2%
Crypto prices: BTC $68,344 +2.5% | KAS $0.033

TODAY'S HIGH-IMPACT EVENTS (4):
  08:15 USD ADP Non-Farm Employment Change (exp 41K)
  08:30 USD Core Retail Sales m/m (exp 0.3%)
  ...
```

### 预测市场（Polymarket）

**数据流：** Gamma API → market-data.js（1000 条，两页并行拉取）→ predictions.eta（分类+分页+到期过滤）

**持仓查询：** `/api/predictions/positions` → CLOB SDK getTrades → 聚合成持仓 → 从 CLOB API 解析 market question（带缓存）→ 返回人话标题而非 hex ID

**Agent 下注：** `[ACTION:POLYMARKET_ORDER market=<conditionId> outcome=yes side=BUY price=0.15 size=50]`
- 执行在 action-executor.mjs:executePolymarketOrder
- 护栏：单笔 ≤ $50，必须有 Polygon 钱包 + CLOB Key
- 下单后写 memory event `polymarket_order`

**UI 功能：**
- 排序：热门/即将到期/争议最大/最新
- 分类标签：Crypto/Politics/Economy/Sports/Tech/Other
- 分页：每页 20 条
- 到期过滤：默认隐藏已过期，"含历史"开关
- **"问 Agent"按钮：** 每个市场卡片可请求 Agent 分析，支持多轮对话

### Agent 资产感知（self_awareness.mjs）

Brain 在每次 proactive/reactive 看到完整资产画像：
```
KAS Balance: 21.5 KAS
Multi-chain wallets: BNB 6.67 USDT | Polygon 0.84 USDC + 34.38 MATIC

Prediction market positions (2):
  "Crude Oil $105 by March" → No 38 shares @ $0.849 (cost $32.26) [CLOSED — pending settlement]
  "Iranian regime fall" → Yes 70 shares @ $0.002 (cost $0.14)

Stock positions (盈透证券):
  TSLA: 11 shares @ $413.31 → ... (-39.9%)
  QS: 88 shares @ $54.98 → ... (-87.6%)

Active OTC orders: 0
```

### 券商（broker.js）

统一 BrokerAdapter 接口：IBKR / Alpaca / Tradier / Tiger。
凭证 AES-256 加密存储。

**IBKR 特殊处理：**
- 使用 `@stoqey/ib`（TWS API socket 协议），不是 REST
- 默认端口 4001（Live），4002（Paper）
- `kanet-start.sh` 自动检测 IB Gateway 并启动（用户只需在弹出窗口登录）
- keepAlive 60s tickle 保活
- Gateway 死连接会导致 socket 满 → 需重启 Gateway 清理

---

## 九、Episode 系统

查询时聚合 chain_events + mm_orders + execution_states → Episode 列表。
不改底层表，纯视图层。

四个内 tab：故事线 / 通讯录 / 会话 / 链上凭证。
Agent 决策理由从 execution_states.display_summary 注入。

---

## 十、关键文件速查

### 核心服务

| 文件 | 职责 |
|------|------|
| kasia-console/src/services/mind-manager.js | 调度器 + Gate 1 + health loop + proactive/reflect 定时 |
| kasia-console/src/services/anti-spam.js | 社交防护（per-peer/跨Agent/无回复退避）+ 行为统计 |
| kasia-console/src/services/order-machine.js | 交易状态机 + auto-advance + 三模式 |
| kasia-console/src/services/market-data.js | 8 数据源聚合（MEXC/Yahoo/Polymarket/CoinGecko/ForexFactory/Binance/Alternative.me） |
| kasia-console/src/services/ingest-service.js | Relay 上报→DB 写入（messages/chain_events/relation_states） |
| kasia-console/src/services/agent-health.js | 7 项指标 + 红绿灯 |
| kasia-console/src/services/broker-ibkr.js | 盈透证券适配器（@stoqey/ib TWS API socket） |

### Agent Mind

| 文件 | 职责 |
|------|------|
| agent-mind/src/mind.mjs | handleMessage + runProactive(max 3 actions) + runReflection |
| agent-mind/src/context-builder.mjs | 四层 prompt + YOUR RECENT OUTBOUND + CONNECTIONS + founding-vision 过滤 |
| agent-mind/src/action-executor.mjs | Gate 3 + sendMessage(去重+fail-closed) + POLYMARKET_ORDER + 交易 |
| agent-mind/src/kernels/intent.mjs | 目标 + recordAttempt + cooldown + auto-retire |
| agent-mind/src/skills/self-awareness.mjs | KAS余额 + 多链钱包 + Polymarket持仓 + broker持仓 + OTC订单 |
| agent-mind/src/skills/stock-tracker.mjs | 自选股 + 大宗 + CoinGecko大盘 + 经济日历 + 恐贪 → Brain宏观视野 |
| agent-mind/src/skills/prediction-sense.mjs | Polymarket 热门事件 → Brain 情绪信号 |

### 链上通信

| 文件 | 职责 |
|------|------|
| kasia-relay/src/relay.mjs | IPC 命令处理 + shouldBlockOutbound(30min/85%/幻觉模式) |
| kasia-relay/src/rpc-listener.mjs | 链上事件处理 + AI 回复 + 握手 |

### 共享模块

| 文件 | 职责 |
|------|------|
| shared/lib/event-types.mjs | chain_events event_type 枚举（写入方和查询方统一引用） |
| shared/lib/rpc-utils.mjs | Relay/Scout 共用 resolveRpcUrl + backoffDelay |

### 协议级自由市场

| 文件 | 职责 |
|------|------|
| kasia-console/src/api/exchange.js | 7 API 端点 + /exchange 页面路由 |
| kasia-console/src/ui/exchange.eta | 协议级自由市场 UI |

### 测试与文档

| 文件 | 职责 |
|------|------|
| test/smoke.mjs | 21 项关键路径 smoke test（`node test/smoke.mjs`） |
| docs/DEVELOPER-GUIDE.md | 本文件 — 唯一权威开发者文档 |
| docs/ALPHA-CHECKLIST.md | Alpha 达标标准（4 条） |

---

## 十一、时间显示规范

**所有时间显示必须使用用户本地时区，不硬编码语言/时区。**

| 场景 | 正确做法 | 错误做法 |
|------|---------|---------|
| 服务端格式化 | `toLocaleString(undefined, { hour12: false })` | `toISOString()` / `toLocaleString('zh-CN')` |
| 客户端绝对时间 | `KANet.formatTime(iso)` | `.slice(5,16)` 截取 ISO 字符串 |
| 客户端相对时间 | `KANet.relativeTime(iso)` | 手写差值计算 |
| Relay 日志 | `toLocaleString(undefined, { hour12: false })` | `toISOString()` |
| DB 存储 | `toISOString()`（UTC，这是正确的） | 本地时间字符串 |

**kanet-ui.js 工具函数：**
- `KANet.formatTime(iso)` — 绝对时间，本地时区，格式 `MM/DD HH:MM:SS`
- `KANet.relativeTime(iso)` — 相对时间，"3 分钟前"、"昨天"

**致命陷阱：** `new Date(iso).toISOString()` 永远输出 UTC。如果把它显示在 UI 上，用户看到的时间会偏移。必须用 `toLocaleString()` 或 `KANet.formatTime()`。

---

## 十二、已知局限（不修，记录在案）

| # | 问题 | 原因 |
|---|------|------|
| 1 | Perception 30s 缓存 + 50 peer 上限 | 当前规模足够 |
| 2 | Gate 1 速率限制纯内存（重启重置） | 危害有限 |
| 3 | tx_records.status 永远 broadcasted | 改 Relay listener 链路长风险高 |
| 4 | catch-up 限制 100 握手 + 50 消息 | 当前规模下不触发 |
| 5 | 双重 whale alert（scanner + whale-alert.mjs） | 阈值已统一，架构重复 P3 |
| 6 | Adapter 遗留 <<SKILL:annotate:...>> 系统 | 和 Mind Skill Registry 两套并存 P3 |
| 7 | protocol.mjs Relay/Scout 各一份 | shared/ 可合并 P3 |
| 8 | kaspa-scout/package.json 硬编码 file: 路径 | npm 构建时依赖，部署时替换 |

---

## 十三、认证系统（agent_connections）

### 架构原则

> **Console 拥有凭证，Adapter 消费凭证。resolveRequestAuth 是唯一入口。**

```
Console (凭证所有者)              Adapter (凭证消费者)
─────────────────               ─────────────────
agent_connections 表             resolve-auth.mjs 本地缓存
  api_key / oauth / gateway      ↓
Connection Manager               GET /api/auth/resolve-by-adapter/:id
  resolveRequestAuth()           ↓
  refresh worker (60s)           拿到 { headers, baseUrl, model }
  OAuth callback (port 1455)     ↓
                                 发 AI 请求（401 → 重试一次）
```

### agent_connections 表

| 字段 | 说明 |
|------|------|
| auth_mode | api_key / oauth / gateway |
| status | connected / expiring / refreshing / expired / refresh_failed / reauth_required / revoked |
| credential_version | 每次 token 更新 +1，Adapter 缓存据此失效 |

### 三种连接模式

| 模式 | 用户体验 | token 生命周期 |
|------|---------|---------------|
| api_key | 填 API Key | 永久 |
| oauth | 浏览器登录授权 | access_token ~1h-10d，refresh_token 自动续期 |
| gateway | 填 gateway token | 永久（OpenClaw 管理） |

### OAuth 流程（OpenAI Codex）

1. Console 生成 PKCE code_verifier + code_challenge
2. 浏览器跳转 auth.openai.com/oauth/authorize
3. 用户登录 ChatGPT 账号授权
4. OpenAI 回调 localhost:1455/auth/callback
5. Console 用 authorization_code 换 access_token + refresh_token
6. 加密存入 agent_connections
7. Adapter 通过 resolveRequestAuth 拿到 Bearer token

**关键：** OAuth token 调的是 `chatgpt.com/backend-api/codex/responses`（Codex Responses API），不是 `api.openai.com/v1/chat/completions`。openai.mjs 自动检测 baseUrl 切换请求格式。

### Adapter 请求流程

```
1. 检查本地缓存（未过期 && >5min margin && 未 401）
2. 无缓存 → GET /api/auth/resolve-by-adapter/:adapterId
3. 用返回的 headers + baseUrl 发请求
4. 成功 → 返回
5. 401 → 清缓存 → resolve(force_refresh=true)
   status=connected → 重试一次
   其他 → 直接失败
6. 每个请求最多重试一次
```

### 关键文件

| 文件 | 职责 |
|------|------|
| kasia-console/src/services/connection-manager.js | resolveRequestAuth + CRUD + refresh worker |
| kasia-console/src/api/auth.js | resolve / connections 端点 |
| kasia-console/src/api/oauth.js | OAuth start/callback + 临时 1455 端口监听 |
| agent-adapter/src/providers/resolve-auth.mjs | 共享 auth 缓存 + 401 恢复 |

---

## 十四、协议级自由市场（/exchange）

> 2026-04-03 上线。设计文档：`自由市场设计决策文档 v1.1`，哲学文档：`kanet-free-market.md`。

### 核心哲学

**协议不是规则，协议是格式。** 规则说"你只能交易这些资产"，协议说"你要交易什么，填在这个字段里"。KANet 自由市场是 Kaspa 底层哲学（转账不可干预）在应用层的延伸：交易本身不可干预。

### 与现有交易系统的关系

```
/trading  — KAS/USDT 专用交易所接口（保留，不碰）
/market   — KAS/USDT OTC（保留，不碰）
/exchange — 协议级自由市场（新建，从这里开始长）
```

三条路线独立运行。`/exchange` 不依赖 order-machine.js 或 trading.js。

### 数据模型（exchange_offers 表，v38）

```sql
exchange_offers:
  id                  — UUID（本地生成或从广播 msg.id 取）
  broadcast_tx_id     — 链上广播 TX hash（乐观写入时为 pending_xxx）
  message_index       — 同一 TX 多条广播时的序号

  give_asset          — 我给什么（自由字符串：KAS / BTC / "代码审计10h"）
  give_amount         — 数量（字符串存储，避免跨精度炸弹）
  give_chain          — 资产所在链（kaspa / bitcoin / null）

  want_asset          — 我要什么（自由字符串）
  want_amount         — 数量（字符串存储）
  want_chain          — 期望对方用哪条链

  maker               — 挂单方地址
  broadcast_at        — 广播时间
  expires_at          — 过期时间

  verification        — 验证类型：manual / cross_chain_tx / kaspa_tx
  verification_meta   — 验证参数 JSON

  protocol_status     — open / matched / completed / cancelled / expired / timed_out
  is_fully_observed   — 本节点是否观测到完整生命周期（0/1）
  market_key          — 派生分组键（字母排序：[give,want].sort().join('|')）
```

**关键设计：**
- `give_asset` / `want_asset` 是**自由字符串**，不是枚举。协议不审判标的。
- `market_key` 不进链上协议，只是本地索引派生。
- `give_amount` / `want_amount` 用字符串存储（KAS sompi 精度、跨链精度、服务类无标准单位）。

### 协议消息（3 种）

| 消息类型 | JSON `t` 值 | 作用 |
|---------|-------------|------|
| 发布报价 | `kanet_exchange_v1` | 广播 give/want/verification 等 |
| 接单 | `kanet_exchange_accept_v1` | 引用 offer_id |
| 取消 | `kanet_exchange_cancel_v1` | 引用 offer_id，仅 maker 可取消 |

消息流经 `onBroadcastWritten()` → switch dispatch → `handleExchange()` 等处理器（trade-protocol-filter.js）。

### 乐观更新

publish/accept/cancel 操作**先写本地 DB，再异步广播到链上**。链上广播是锚定确认，不阻塞 UI 显示。广播失败（如 Relay 同步中）不影响本地操作。

### 验证器注册表（可扩展）

```
"cross_chain_tx"  → 现有 cross-chain-verify.mjs（BNB/ETH/SOL/TRON USDT）
"kaspa_tx"        → Kaspa TX 确认
"manual"          → 双方手动确认（服务类交易、无链资产）
"btc_tx"          → BTC TX 确认（待建）
"oracle"          → 第三方预言机（未来）
```

每个报价自带 `verification` 字段。新资产 = 新验证器实现，状态机代码不变。

### 节点索引机制

**参与即索引，缺席即空白。** 没有中心索引服务器。每个节点只索引自己启动后观测到的广播。节点间数据不一致是设计，不是 bug。

### API 端点

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/exchange/offers` | 报价列表（支持 market_key/status/maker 过滤） |
| GET | `/api/exchange/offers/:id` | 单个报价详情 |
| GET | `/api/exchange/markets` | 活跃市场对列表 |
| GET | `/api/exchange/agents` | 可用 Agent 列表 |
| POST | `/api/exchange/publish` | 发起报价（乐观写 DB + 异步广播） |
| POST | `/api/exchange/accept` | 接单（乐观更新 + 异步广播） |
| POST | `/api/exchange/cancel` | 取消（乐观更新 + 异步广播） |

### 关键文件

| 文件 | 职责 |
|------|------|
| kasia-console/src/api/exchange.js | 7 API 端点 + /exchange 页面路由 |
| kasia-console/src/services/trade-protocol-filter.js | handleExchange + handleExchangeAccept + handleExchangeCancel |
| kasia-console/src/ui/exchange.eta | 协议级自由市场 UI（广播流 + 分组 + 发布表单） |
| kasia-console/src/db/migrate.js | v38: exchange_offers 表 |

### 待实现（Step 6）

- matched 之后的完整交割流程（paying → paid → verified → delivering → completed）
- 验证路由（根据 verification 字段分发到不同验证器）
- dispute 处理
- 信誉系统接入
