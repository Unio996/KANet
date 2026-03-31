# KANet System Architecture — 完整梳理

> 2026-03-25 全系统审计。五大模块、25张表、~100个API端点、所有数据流。

---

## 一、五大模块职责边界

### Console (`kasia-console`, port 3100)
**定位**：数据中枢 + UI + 进程管理器

- 拥有 SQLite 数据库（25张表，唯一持久化存储）
- 托管 Relay / Adapter / Scout 子进程的生命周期
- 提供所有 API 端点（~100个）
- 提供所有 UI 页面（.eta 模板）
- 运行 Mind Manager（Mind 实例缓存 + proactive/reflection 调度器）
- **不直接接触链** — 通过 Relay 和 Scout 间接操作

### Relay (`kasia-relay`, 每个 Agent 一个进程)
**定位**：链上代理人 — 拥有私钥，代表 Agent 在链上行动

- 持有 Agent 的 mnemonic / 私钥
- 订阅 Kaspa RPC 区块，实时处理收到的握手和消息
- **解密** 收到的加密通信（ECDH + ChaCha20-Poly1305）
- **发送** 链上交易（握手回复、comm 消息、广播、转账、Agent Card）
- 调用 Console Mind 获取 AI 回复
- 通过 ingest API 向 Console 报告所有活动
- **关键边界**：Relay 是唯一能解密消息和签名交易的模块

### Scout (`kaspa-scout`, 单进程)
**定位**：链上观察者 — 无私钥，被动扫描全链

- 订阅 Kaspa RPC 区块，扫描所有 Kasia 协议活动
- 发现新地址、记录交互、解析 Agent Card、解析广播
- 监控鲸鱼转账（UTXO 订阅 + 区块扫描）
- 采集链上基础数据（区块数、算力、供应量）
- 通过 discovery API 向 Console 报告发现
- **关键边界**：Scout 不能解密任何消息，只记录"谁和谁通信了"

### Mind (`agent-mind`, 由 Console 加载为库)
**定位**：Agent 灵魂 — 五核架构，驱动 AI 大脑

- 五个 Kernel：Self / Memory / Perception / Intent / Evolution
- Context Builder：组装结构化任务给 Brain
- Action Executor：Gate 3 权限校验 + 执行动作
- Skill Registry：22个技能，自动发现 + 按需激活
- 通过 Console API 读取数据，通过 Adapter 调用 AI
- **关键边界**：Mind 不直接碰链，通过 Console API 间接操作

### Adapter (`agent-adapter`, 每个 Agent 一个进程)
**定位**：神经系统 — AI 大脑桥接层

- 接收 Mind 的结构化任务，转发给 AI Provider
- 支持 OpenAI / Anthropic / OpenClaw 三种 provider
- sanitizeForApi() 清洗转义字符（Grok 兼容）
- 纯透传，不持久化任何数据
- **关键边界**：Adapter 不写任何数据库表

---

## 二、数据流全图

### 消息接收流（链上 → Agent 回复）

```
Kaspa 链
  ↓ RPC subscribeBlockAdded
Relay (rpc-listener.mjs)          Scout (rpc-scanner.mjs)
  ↓ 解密成功（是给我的）             ↓ 只看到加密包（不解密）
  ↓                                 ↓
POST /ingest/message              POST /api/discovery/register
  → messages 表                     → identities 表
  → conversations 表               POST /api/discovery/interaction
  → identities 表（更新）             → interaction_records 表
  ↓
POST /api/agent/reply
  → mind-manager.js
  → Gate 1: evaluateSenderGate()
  → Mind.handleMessage()
    → Context Builder (5 kernels)
    → Adapter (POST /reply)
    → AI Provider (OpenAI/Grok/etc)
    → Action Loop (最多10轮)
  → recordMindEvent → events 表
  ↓
POST /ingest/reply
  → replies 表
  ↓
Relay 发送 comm 回复
  → sendKaspa() → 链上
  → POST /ingest/tx → tx_records 表
```

### 握手流（完整）

```
外部用户 → 链上发握手 TX
  ↓
Scout 扫到 → interaction_records (address_a, address_b, tx_hash)
  ↓ 如果 receiver 是 local address:
  → POST /ingest/message → messages 表（供 Relay catch-up 用）

Relay 订阅到同一个区块:
  ↓ 解密握手包成功
  → processHandshake()
  → ingestHandshake() → POST /ingest/message (inbound + outbound)
  → acceptHandshake() → 构建握手回复
  → sendKaspa() → 链上发送接受
  → ingestTx() → tx_records 表
  → _handshakeAccepted.add(address) → 去重集合
  → handleHandshakeRelation() → account_relations 表
  → Auto-greet: getAIReply() → sendMessage() → 链上发送问候
```

**⚠ 断裂点**：
- 如果 Relay 没运行时收到握手 → 只有 Scout 写 interaction_records，messages 表可能没记录
- 如果 identity_type 不是 local → Scout 不会写 /ingest/message → Relay catch-up 查不到
- 如果 account_relations 已存在 → catch-up 跳过（NOT EXISTS 查询）

### 广播流

```
Agent 发广播:
  Console API POST /api/chat/send
  → Relay sendKaspa(bcast payload) → 链上
  → 本地写 broadcast_messages 表（status=confirmed, tx_hash）
  → trade-protocol-filter.onBroadcastWritten()  ← 3/27 新增
    → 如果是 kanet_* 协议消息 → 路由到对应 handler
    → 非协议消息 → 跳过（纳秒级字符串前缀匹配）

Scout 扫到同一个广播:
  → POST /api/chat/ingest → broadcast_messages 表（dedup by tx_hash）
  → trade-protocol-filter.onBroadcastWritten()  ← 3/27 新增
    → 远程订单 → handleOrder → createOrder（本地索引）
    → 远程接单 → handleAccept → transition + lockFunds

其他 Agent 的 Relay 看到广播:
  → 不处理（comm 是 self-send，其他人解密不了 / 不是给他们的）
  → 但 Console chat.js 会触发 auto-reply → getReply() → Mind → 回复（也是广播）
```

### 交易协议流（3/27 新增）

```
订单发布:
  market.eta → POST /api/chat/send (bcast kanet_sell/buy_v1 → 频道 {orderId})
  → 链上 → broadcast_messages → filter.handleOrder() → createOrder(broadcast_txid)
  → UI 轮询确认索引写入 → 解锁操作按钮

接单:
  market.eta → POST /api/chat/send (bcast kanet_accept_v1 → 频道 {orderId})
  → 链上 → filter.handleAccept() → checkLimits → transition(accepted) → lockFunds

付款:
  trading.js pay_usdt 成功 → 现有逻辑(transition+recordChainEvent)
  → 追加广播 kanet_paid_v1 到频道 {orderId}（fire-and-forget）

交割:
  trading.js send_kas 成功 → 现有逻辑(transition+recordChainEvent)
  → 5s 延迟广播 kanet_delivered_v1 到频道 {orderId}

超时问责:
  mind-manager.js 超时检查 → 广播 kanet_timeout_v1 → 链上永久记录
  → filter.handleTimeout() → transition(accepted→published) → releaseFunds
  → tryNextAccept() → 回扫频道找候选

关键服务文件: kasia-console/src/services/trade-protocol-filter.js
```

---

## 三、数据表（3/27 更新）

### 核心协议表（唯一真相源）

| 表 | 写入方 | 读取方 | 锚点 | 说明 |
|---|---|---|---|---|
| **relation_states** | Ingest(握手双写), Discovery(Scout观测), Relay(activate) | Context Builder, Gate 1, identities.js, catch-up, discovered | agent_address + peer_address | **唯一关系状态源**，取代 account_relations |
| **chain_events** | Ingest(handshake/comm/tx), Discovery(Scout), trading.js(4处) | Console(UI) | txid + event_type UNIQUE | 链上事实归档，成功+失败+验证+underpayment |
| **execution_states** | trading.js(/action), order-machine.js(auto-advance) | Console(trading UI), market.eta | order_id + agent_address | 每笔花钱操作追踪 |
| **fund_locks** | trading.js(accept→lock), order-machine.js(complete→spend/cancel→release) | trading.js(余额计算) | order_id + asset UNIQUE | 资金锁定防并发超支 |

### 常规表

| 表 | 写入方 | 读取方 | 锚点 |
|---|---|---|---|
| **identities** | Scout(register), Relay(ingest), Console(UI/migrate/relay-manager) | 几乎所有模块 | address |
| **messages** | Relay(ingest), Scout(handshake to local) | Console(conversation/catch-up), Mind(memory) | source_txid |
| **replies** | Console(conversations/reply) | Console(conversation) | sent_txid（@deprecated） |
| **tx_records** | Relay(ingest) | Console(spending/history) | txid |
| **events** | Console(mind-manager/chain-data/skills) | Console(UI/whale-signal) | agent_address |
| **broadcast_messages** | Console(chat/send), Scout(chat/ingest) | Console(chat/stats), **trade-protocol-filter**(协议消息路由) | tx_hash |
| **conversations** | Relay(ingest) | Console(多处), Mind(memory) | identity FK |
| **mm_orders** | Console(trading/order-machine), **trade-protocol-filter**(链上订单索引) | Console(trading UI), Mind(mm_otc) | agent_address, broadcast_txid |
| **skills** | Console(skills.js/migrate) | Console(skills UI), Mind(registry) | relay_node_id |
| **relay_nodes** | Console(relay.js) | 几乎所有模块 | address |
| **adapter_nodes** | Console(adapter.js) | Console/relay-manager | http_port |
| **agent_wallets** | Console(relay.js) | Console(trading/wallet) | address, chain |
| **config_entries** | Console(settings/scanner/whale-signal/trade-limits) | 几乎所有服务 | key |
| **chain_snapshots** | Scout(chain-fundamentals) | Console(fundamentals API) | 无 |
| **address_balances** | Scout(balance-tracker) | Console(whale-activity) | address |
| **whale_watchlist** | Console(chain-data), Scout(balance-tracker) | Scout(whale-alert/balance-tracker) | address |
| **exchange_accounts** | Console(trading) | Console(trading) | 无 |
| **trade_log** | Console(trading) | Console(trading/performance) | 无 |
| **trade_baselines** | Console(trading) | Console(trading) | relay_node_id |
| **probe_logs** | Console(discovery) | Console(discovery) | target_address |

### 遗留表（读路径已迁移，待切断写入）

| 表 | 状态 | 替代 |
|---|---|---|
| **account_relations** | ⚠️ ingest-service 仍双写 | relation_states |
| **interaction_records** | ⚠️ chain-data.js 仍读取 | chain_events + relation_states |

---

## 四、已知裂缝清单（3/27 更新）

### ✅ 已修复

| # | 问题 | 修复 | 修复日期 |
|---|------|------|---------|
| 1 | Scout/Relay 双写不同步 | relation_states 统一真相源，所有读路径已迁移 | 3/25 |
| 2 | identity_type 决定链路 | relay-manager.js 确保 local + catch-up 改读 relation_states | 3/25 |
| 3 | catch-up 只看半张表 | catch-up 改读 relation_states WHERE status='observed'，15行清晰查询 | 3/25 |
| 4 | replies.sent_txid 永远空 | @deprecated 标记，不再使用 | 3/27 |
| 5 | Trade ACTION 绕过 Gate 3 | trade-action.js 权限闸门 + source/mode/limits 三重检查 | 3/26 |
| 6 | 僵尸进程 | scanner.js PID 文件 | 3/25 |
| 9 | 状态名不统一 | v29 迁移一次性清理 quoted/awaiting_payment/payment_verified | 3/25 |
| 10 | RPC URL 代码重复 | shared/lib/rpc-utils.mjs 共享模块 | 3/27 |

### ⚠️ 仍存在

| # | 问题 | 影响 | 优先级 |
|---|------|------|--------|
| 7 | 双重 whale alert | rpc-scanner Phase 1b + whale-alert.mjs 重复，阈值已统一但架构仍重复 | P3 |
| 8 | Adapter 遗留 skill 系统 | <<SKILL:annotate:...>> 和 Mind Skill Registry 两套并存 | P3 |
| 11 | Console 直接碰链 | bcast-sender.js/card-publisher.js/utxo-splitter.js 绕过 Relay | P2 |
| 12 | 并发保护缺失 | 同一订单两个请求可能 race condition | P2 |
| 13 | 参数名不匹配 | market-maker 客户端发 since，服务端读 after | P3 |
| 14 | OTC 串单风险 | 只查"最近差不多金额的转账"，无唯一订单绑定 | P2 |
| 15 | 硬编码绝对路径 | D:/Anthropic/... 部署迁移会断 | P2（部署前必修）|
| 16 | protocol.mjs 重复 | Relay 和 Scout 各一份 | P3 |

### 7. 双重 whale alert
- rpc-scanner Phase 1b + whale-alert.mjs 两条路径都产生 whale_alert 事件
- Phase 1b 扫所有区块所有交易，whale-alert.mjs 只监控 watchlist 地址
- **已部分修复**：阈值统一到 500K，但架构上仍有重复

### 8. Adapter 遗留 skill 系统
- Adapter 有 `<<SKILL:annotate:...>>` 模式
- Mind 有独立的 Skill Registry + Action Protocol
- 两套系统并存，互不知道对方

### 9. 状态名不统一
- mm_orders 旧状态：quoted / awaiting_payment / payment_verified
- mm_orders 新状态：published / accepted / paying / paid / verified / delivering
- 两套并存，UI 和代码要双向兼容

### 10. 代码重复
- protocol.mjs 在 Relay 和 Scout 各有一份
- indexer.mjs 在 Relay 和 Scout 各有一份
- RPC URL 解析逻辑三份（Relay transaction.mjs + rpc-listener.mjs + Scout rpc-scanner.mjs）
- 重连退避逻辑两份

---

## 五、已完成的合并/简化 + 待做

### ✅ 已完成

| 方案 | 内容 | 完成日期 |
|------|------|---------|
| 数据表统一 | relation_states 取代 account_relations + interaction_records 的读路径 | 3/25-3/27 |
| replies 废弃 | sent_txid @deprecated，不再使用 | 3/27 |
| identity 统一 | relay-manager.js 确保 local，catch-up 改读 relation_states | 3/25 |
| RPC 共享模块 | shared/lib/rpc-utils.mjs（Relay + Scout 共用） | 3/27 |
| 状态名统一 | v29 迁移清理旧状态，legacy 分支删除 | 3/25 |
| Trade ACTION 权限 | trade-action.js 权限闸门 + source/mode/limits 检查 | 3/26 |

### ⚠️ 待做

| 方案 | 内容 | 优先级 |
|------|------|--------|
| 旧表双写切断 | ingest-service.js 停止写 account_relations | P2 |
| 旧表读取迁移 | chain-data.js/events.js 停止读 interaction_records | P2 |
| whale alert 单一路径 | Phase 1b + whale-alert.mjs 共享报告函数 + 去重 | P3 |
| protocol.mjs 合并 | Relay/Scout 共用一份 | P3 |
| Adapter skill 清理 | 删除 <<SKILL:annotate:...>> 遗留系统 | P3 |

---

## 六、关键配置

| 配置 | 位置 | 说明 |
|------|------|------|
| CONSOLE_ENCRYPTION_KEY | 环境变量 | AES-256 加密密钥，丢失则所有加密数据不可恢复 |
| INGEST_SECRET | config_entries | PSK 鉴权，Scout/Relay/Adapter 与 Console 通信 |
| RPC URL | config_entries / 环境变量 | Kaspa 节点 WebSocket 地址 |
| Adapter 端口 | adapter_nodes.http_port | 3010 起，每个 Agent 一个 |
| Console 端口 | 环境变量 PORT | 默认 3100 |
