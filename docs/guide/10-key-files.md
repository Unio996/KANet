## 十、关键文件速查

### 核心服务

| 文件 | 职责 |
|------|------|
| kasia-console/src/services/mind-manager.js | 调度器 + Gate 1 + health loop + proactive/reflect 定时 |
| kasia-console/src/services/anti-spam.js | 社交防护（per-peer/跨Agent/无回复退避）+ 行为统计 |
| kasia-console/src/services/order-machine.js | 交易状态机 + auto-advance + 三模式 |
| kasia-console/src/services/market-data.js | 9 数据源聚合（MEXC/Yahoo×3/Polymarket/CoinGecko/ForexFactory/Binance/Alternative.me）含 K 线 + 财报 |
| kasia-console/src/services/ingest-service.js | Relay 上报→DB 写入（messages/chain_events/relation_states） |
| kasia-console/src/services/agent-health.js | 7 项指标 + 红绿灯 |
| kasia-console/src/services/broker-ibkr.js | 盈透证券适配器（@stoqey/ib TWS API socket） |

### Agent Mind

| 文件 | 职责 |
|------|------|
| agent-mind/src/mind.mjs | handleMessage + runProactive(max 3 actions) + runReflection |
| agent-mind/src/context-builder.mjs | 四层 prompt + YOUR RECENT OUTBOUND + CONNECTIONS + founding-vision 过滤 |
| agent-mind/src/action-executor.mjs | Gate 3 + sendMessage(去重+fail-closed) + POLYMARKET_ORDER + MAKE_MARKET + CANCEL_OFFERS + 交易 |
| agent-mind/src/kernels/intent.mjs | 目标 + recordAttempt + cooldown + auto-retire |
| agent-mind/src/skills/self-awareness.mjs | KAS余额 + 多链钱包 + Polymarket持仓 + broker持仓 + OTC订单 |
| agent-mind/src/skills/stock-tracker.mjs | 四层情报：K 线信号 + 财报感知 + 新闻 RSS + 同行估值 + 宏观 → Brain 决策（4/8 升级） |
| agent-mind/src/skills/prediction-sense.mjs | Polymarket 热门事件 → Brain 情绪信号 |
| agent-mind/src/skills/market-scanner.mjs | 8 CEX + KANet 价差扫描（1h proactive / reactive 关键词）|
| agent-mind/src/skills/order-executor.mjs | KANet 做市指令生成（MAKE_MARKET ACTION + 对冲参考）|

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

### 消息补全与索引

| 文件 | 职责 |
|------|------|
| kaspa-scout/src/light-scanner.mjs | 无本地节点降级模式（subscribeUtxosChanged + blockAdded 双订阅） |
| kaspa-scout/src/message-indexer.mjs | 扫链时为认识的地址写 kanet_message_index + 检查点持久化 |
| kaspa-scout/src/history-fetcher.mjs | 启动时按地址查 api.kaspa.org 补全停机期间历史 TX |

### 协议级自由市场

| 文件 | 职责 |
|------|------|
| kasia-console/src/api/exchange.js | 8 API 端点 + /exchange 页面路由 |
| kasia-console/src/services/exchange-machine.js | 状态机（open→matched→verifying→completed） |
| kasia-console/src/services/exchange-verifiers.js | 可插拔验证器（manual/cross_chain_tx/kaspa_tx） |
| kasia-console/src/services/exchange-orders.js | 8 交易所统一下单（placeOrder/cancelOrder/getOrder/getBalance/getOrderbook） |
| kasia-console/src/services/trade-protocol-filter.js | 链上协议→本地索引 + matched 自动 CEX 对冲 |
| kasia-console/src/ui/exchange.eta | 协议级自由市场 UI |

### 测试与文档

| 文件 | 职责 |
|------|------|
| test/smoke.mjs | 21 项关键路径 smoke test（`node test/smoke.mjs`） |
| docs/DEVELOPER-GUIDE.md | 本文件 — 唯一权威开发者文档 |
| docs/ALPHA-CHECKLIST.md | Alpha 达标标准（4 条） |

---

