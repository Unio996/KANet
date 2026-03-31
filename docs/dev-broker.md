# 券商系统 — 开发者文档

> **Read this before touching broker code. 3 minutes prevents 90% of mistakes.**

---

## Fatal Traps (First 30 Seconds)

1. **IBKR 需要本地 Gateway 保持运行。** Session 几分钟不活动就过期。`startKeepAlive()` 每 60s 发 tickle。session 断了 → broker_accounts.status 自动标 'disconnected'。不要假设 IBKR 永远在线。

2. **Alpaca 的 Paper vs Live 是不同的 base URL。** `paper-api.alpaca.markets` vs `api.alpaca.markets`。由 `paper_trading` 字段控制。配错了不是报错，是操作真钱。

3. **Tiger 用 RSA 签名，不是 API Key。** 每个请求都要用私钥签名 payload。私钥是 PEM 格式（多行字符串），存 DB 时 JSON.stringify 会转义换行符。decrypt 后必须 JSON.parse 拿回原始 PEM。

4. **凭证加密存储在 credentials_encrypted。** 不同券商存不同结构：
   - Alpaca: `{ apiKey, apiSecret }`
   - Tradier: `{ accessToken }`
   - Tiger: `{ tigerId, privateKey }`
   - IBKR: 无 credentials（只存 gateway_url_encrypted + account_id）

5. **_getAdapter 有内存缓存。** 同一 account ID 只创建一次 adapter。如果用户更新了凭证，旧 adapter 不会刷新。删除再创建是安全路径。

---

## Architecture

```
broker.js (API 层)
  ├── BROKER_REGISTRY — 券商元数据（名称/字段/市场/注册链接）
  ├── _getAdapter(accountId) — 按 broker_type 分发到对应 adapter
  │     ├── 'alpaca'  → createAlpacaAdapter
  │     ├── 'tradier' → createTradierAdapter
  │     ├── 'tiger'   → createTigerAdapter
  │     └── 'ibkr'    → createIbkrAdapter
  └── 10 个 API 端点
        ├── CRUD: accounts / accounts/:id / accounts/:id/test
        ├── 交易: account / positions / orders / order / search / quote
        └── 元数据: registry

broker-{type}.js (适配器层)
  统一接口：
    authenticate()     → { ok, accountId }
    startKeepAlive()   → IBKR 专用，其他空实现
    getAccount()       → { balance, buyingPower, netLiquidation, currency }
    getPositions()     → [{ symbol, qty, avgCost, marketValue, pnl, pnlPct }]
    getQuote(symbol)   → { price, bid, ask }
    searchSymbol(q)    → [{ conid, symbol, name, exchange, type }]
    placeOrder(order)  → { ok, orderId, status }
    cancelOrder(id)    → { ok }
    getOrders()        → [{ orderId, symbol, side, qty, price, status }]
    destroy()          → 清理 keepAlive
```

## Files

| File | Role |
|------|------|
| `kasia-console/src/api/broker.js` | API 端点 + 多券商分发 + BROKER_REGISTRY |
| `kasia-console/src/services/broker-ibkr.js` | IBKR Client Portal API 适配器 |
| `kasia-console/src/services/broker-alpaca.js` | Alpaca REST API 适配器 |
| `kasia-console/src/services/broker-tradier.js` | Tradier REST API 适配器 |
| `kasia-console/src/services/broker-tiger.js` | Tiger Open API 适配器（RSA 签名）|
| `kasia-console/src/db/migrate.js` | v35 技能注册 + v36 broker_accounts 表 |
| `kasia-console/src/ui/stocks.eta` | 券商连接 UI（多券商选择器 + 动态字段）|
| `agent-mind/src/skills/onboard-broker.mjs` | Agent 技能：多券商引导（知识库 + 匹配 + 分步引导）|

## Database

```sql
CREATE TABLE broker_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,              -- "我的 Alpaca"
  broker_type TEXT NOT NULL,       -- 'ibkr' | 'alpaca' | 'tradier' | 'tiger'
  account_id TEXT,                 -- 券商账户号（IBKR/Tiger 用）
  gateway_url_encrypted TEXT,      -- IBKR Gateway 地址（AES 加密）
  credentials_encrypted TEXT,      -- API 凭证 JSON（AES 加密）
  paper_trading INTEGER DEFAULT 1, -- 1=模拟盘 0=实盘
  status TEXT DEFAULT 'pending',   -- pending | connected | disconnected | error
  last_sync_at TEXT,
  created_at TEXT
);
```

## API

### 元数据

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/broker/registry` | GET | 返回 BROKER_REGISTRY（前端渲染券商选择器）|

### 账户管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/broker/accounts` | GET | 所有券商账户（不含凭证） |
| `/api/broker/accounts` | POST | 添加券商（按 broker_type 验证字段）|
| `/api/broker/accounts/:id/test` | POST | 测试连接（调 authenticate + startKeepAlive）|
| `/api/broker/accounts/:id` | DELETE | 删除（destroy adapter + 删 DB） |

### 交易操作

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/broker/:id/account` | GET | 账户摘要（余额/购买力/净值）|
| `/api/broker/:id/positions` | GET | 持仓列表 |
| `/api/broker/:id/orders` | GET | 活跃订单 |
| `/api/broker/:id/order` | POST | 下单（body: `{ conid, side, qty, type, price }`）|
| `/api/broker/:id/order/:orderId` | DELETE | 撤单 |
| `/api/broker/:id/search?q=AAPL` | GET | 搜索标的 |
| `/api/broker/:id/quote/:conid` | GET | 报价 |

## Agent Skill: onboard_broker

### 触发条件

**Reactive**（owner 问）：关键词匹配 `券商|盈透|ibkr|alpaca|tradier|tiger|老虎|怎么买股票|美股|港股`

**Proactive**：Agent 发现 owner 有股票相关目标但无券商连接

### 知识库

4 家券商完整指南：`BROKER_GUIDES` 对象，每家包含：
- `aliases` — 关键词匹配用
- `registerUrl` — 注册链接
- `steps` — 分步操作说明
- `notes` — 特殊注意事项
- `commonIssues` — 常见问题 Q&A

### 流程

```
用户: "我想买股票"
  → matchBroker() 未命中具体券商
  → Brain 推荐: Alpaca(最简单) / IBKR(最全) / Tradier(期权) / Tiger(港A股)
  → 用户选择
  → 输出对应券商的 steps + commonIssues
  → 用户完成后引导测试连接
```

## Adding a New Broker

1. **新建适配器**: `kasia-console/src/services/broker-{name}.js`
   - 导出 `createXxxAdapter(config)` 函数
   - 实现统一接口（authenticate / getAccount / getPositions / placeOrder 等）
   - 返回对象（不是 class），方便测试

2. **broker.js 注册**:
   - import 新适配器
   - `BROKER_REGISTRY` 加入元数据
   - `_getAdapter` switch 加 case

3. **Agent 技能**: `onboard-broker.mjs`
   - `BROKER_GUIDES` 加入新券商知识
   - `aliases` 加中英文匹配词

4. **stocks.eta**: 
   - `<select>` 加 option
   - 加对应字段模板 `<template x-if="...">`
   - 加对应的设置说明

5. **测试**: 注册 Paper Trading 账户 → 添加 → 测试连接 → 查持仓 → 下单

## Polymarket (Related)

Polymarket 不走 broker 体系，有独立的服务和端点：

| File | Role |
|------|------|
| `kasia-console/src/services/polymarket.js` | CLOB API 客户端 + USDC approve + allowance |
| `kasia-console/src/api/stocks.js` | Polymarket 端点（在 stocks 路由里）|
| `kasia-console/src/ui/predictions.eta` | 交易面板（钱包 + 授权 + 下单 + 订单簿 + 持仓）|
| `agent-mind/src/skills/onboard-polymarket.mjs` | 5 步引导（钱包→充值→授权→Key→就绪）|

### Polymarket 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/polymarket/:id/status` | GET | 钱包 + USDC + 授权 + CLOB 状态 |
| `/api/polymarket/:id/approve` | POST | Approve USDC 给 CTF Exchange |
| `/api/polymarket/:id/approve-status` | GET | 查 Approve TX 确认状态（需 txHash 参数）|
| `/api/predictions/setup` | POST | 创建 CLOB API Key（EIP-712 签名）|
| `/api/predictions/wallet` | GET | Polygon 钱包 + USDC 余额 |
| `/api/predictions/positions` | GET | 持仓 |
| `/api/predictions/orders` | GET | 活跃订单 |
| `/api/predictions/order` | POST | 下单 |
| `/api/predictions/order/:id` | DELETE | 撤单 |
| `/api/predictions/book/:tokenId` | GET | 订单簿 |
