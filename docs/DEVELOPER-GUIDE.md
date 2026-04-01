# KANet Developer Guide

> **修改任何代码前必读。** 一个文件，覆盖全系统。唯一权威开发者文档。
> 初版 2026-03-31（合并 12 个 dev-*.md），最近更新 2026-04-01。

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
| 安全网 | sendMessage 本地去重（同目标相似度） | action-executor.mjs |
| 安全网 | anti-spam 查 chain_events（per-peer/跨Agent/无回复退避） | anti-spam.js via /api/agent/outbound-check |
| 安全网 | anti-spam fail-closed（API 不可达→拒绝） | action-executor.mjs |
| 兜底 | Relay 30min 窗口 85% 相似度去重 | relay.mjs shouldBlockOutbound |
| 兜底 | 每次 proactive max 3 ACTION | mind.mjs |

### 致命陷阱

1. **relation_states 是社交决策唯一真相源。** Context Builder 从 /api/discovery/list 读这张表。
2. **Agent 的记忆在 DB，不在文件。** minds/*/memory.json 只是 peerNotes 小缓存。
3. **Adapter JSON 必须 ASCII-safe。** openai.mjs 的 asciiSafeStringify 处理 surrogate pairs。
4. **Brain 超时 180 秒。** 不要调低。
5. **目标 success 也有频率限制。** ≥10 次 success → 12h 冷却。
6. **启动时 Agent 操作要错开。** staggerMs = agentIndex * 25_000。
7. **Agent 目录名保留下划线。** Kasia_1 → minds/kasia_1/（不是 kasia1）。
8. **reflection lastReflectionTime 必须始终更新。** 不管 JSON 解析成功与否。

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

shortAddr / copy / relativeTime / formatKas / statusLabel / statusColor / healthDot / sideLabel / chainName

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

### 测试与文档

| 文件 | 职责 |
|------|------|
| test/smoke.mjs | 21 项关键路径 smoke test（`node test/smoke.mjs`） |
| docs/DEVELOPER-GUIDE.md | 本文件 — 唯一权威开发者文档 |
| docs/ALPHA-CHECKLIST.md | Alpha 达标标准（4 条） |

---

## 十一、已知局限（不修，记录在案）

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
