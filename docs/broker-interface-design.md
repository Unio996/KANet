# 券商统一接口设计

> 2026-03-30 | KANet 股票交易接入层

## 设计原则

- **统一接口，多券商实现** — 和 onboard_market（8 个交易所）同模式
- **Paper trading 先行** — 先跑模拟盘，验证逻辑后再实盘
- **Agent 能操作** — 通过技能执行买卖，和 trade_executor 同级

## 明天优先：Interactive Brokers (IBKR)

### 为什么先接盈透

- 全球 150+ 市场（美股/港股/A股/期货/期权/外汇）
- 用户要求
- Client Portal API 是 REST，可以不装 TWS

### IBKR Client Portal API

**认证**：Session-based，需要 IB Gateway 或 Client Portal Gateway 维持会话。
不是 API key 模式 —— 需要登录后保持 session。

**关键端点**：

| 操作 | 端点 | 方法 |
|------|------|------|
| 账户信息 | `/portfolio/{accountId}/summary` | GET |
| 持仓列表 | `/portfolio/{accountId}/positions/0` | GET |
| 实时报价 | `/iserver/marketdata/snapshot?conids=X` | GET |
| 搜索标的 | `/iserver/secdef/search?symbol=AAPL` | GET |
| 下单 | `/iserver/account/{accountId}/orders` | POST |
| 取消订单 | `/iserver/account/{accountId}/order/{orderId}` | DELETE |
| 订单状态 | `/iserver/account/orders` | GET |
| 保活 | `/tickle` | POST |

**注意事项**：
- 需要先调 `/iserver/auth/status` 确认认证状态
- Session 有过期时间，需要定期 `/tickle`
- 下单后可能需要确认 `/iserver/reply/{replyId}`
- Paper trading 在同一 API，不同 accountId

## 统一接口定义

```javascript
// broker-adapter.js — 统一接口，每个券商实现一个 class

class BrokerAdapter {
  constructor(config) {} // { type: 'ibkr'|'alpaca'|'tradier', credentials: {...} }

  // 认证
  async authenticate()           // → { ok, accountId, error? }
  async isAuthenticated()        // → boolean

  // 账户
  async getAccount()             // → { balance, buyingPower, currency }
  async getPositions()           // → [{ symbol, qty, avgCost, marketValue, pnl, pnlPct }]

  // 行情
  async getQuote(symbol)         // → { price, change, volume, bid, ask }
  async searchSymbol(query)      // → [{ symbol, name, exchange, type }]

  // 交易
  async placeOrder(order)        // → { orderId, status }
    // order: { symbol, side: 'buy'|'sell', qty, type: 'market'|'limit', price? }
  async cancelOrder(orderId)     // → { ok }
  async getOrders()              // → [{ orderId, symbol, side, qty, price, status, filledQty }]
  async getOrderStatus(orderId)  // → { orderId, status, filledQty, avgPrice }
}
```

## 数据模型

```sql
-- 复用 exchange_accounts 模式
CREATE TABLE broker_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,               -- "我的盈透"
  broker_type TEXT NOT NULL,        -- 'ibkr' | 'alpaca' | 'tradier'
  account_id TEXT,                  -- 券商账户 ID
  credentials_encrypted TEXT,       -- 加密存储（API key / session token）
  paper_trading INTEGER DEFAULT 1,  -- 默认模拟盘
  status TEXT DEFAULT 'pending',    -- pending | connected | error
  last_sync_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

## API 端点

```
GET  /api/broker/accounts              — 已连接的券商列表
POST /api/broker/accounts              — 添加券商
POST /api/broker/accounts/:id/test     — 测试连接
DEL  /api/broker/accounts/:id          — 删除

GET  /api/broker/:id/account           — 账户摘要
GET  /api/broker/:id/positions         — 持仓
GET  /api/broker/:id/orders            — 订单
POST /api/broker/:id/order             — 下单
DEL  /api/broker/:id/order/:orderId    — 撤单
GET  /api/broker/:id/quote/:symbol     — 报价
GET  /api/broker/:id/search?q=AAPL     — 搜索
```

## Mind 技能

**`onboard_broker.mjs`** — 复用 onboard_market 模式
- 对话引导连接券商
- 步骤：选券商 → 输入凭证 → 测试连接 → 完成
- IBKR 特殊：需要引导用户启动 IB Gateway

**`stock_executor.mjs`** — 复用 trade_executor 模式
- 通过对话或 proactive 执行股票交易
- DRY-RUN 默认（Paper trading）
- 安全检查：仓位限制、止损
- ACTION: `[ACTION:STOCK_ORDER broker=ibkr side=buy symbol=AAPL qty=10 type=limit price=248]`

## IBKR 接入步骤（明天）

1. **broker-adapters/ibkr.js** — 实现 BrokerAdapter 接口
2. **broker.js API** — 端点注册
3. **broker_accounts 表** — DB 迁移
4. **测试 Paper trading** — 搜索 → 报价 → 下单 → 查状态
5. **UI** — stocks.eta 加"连接券商"入口

## 其他券商排期

| 券商 | 优先级 | 难度 | 备注 |
|------|--------|------|------|
| IBKR | P0（明天） | 中 | Client Portal API，session 管理 |
| Alpaca | P1 | 低 | API key，最简单 |
| Tradier | P2 | 低 | OAuth，美股+期权 |
| Tiger | P3 | 中 | RSA 签名 |
| Futu | P3 | 高 | 需要 OpenD 网关 |
| Polymarket | P1 | 中 | 钱包签名，预测市场交易 |
| Kalshi | P2 | 低 | API key，受监管预测市场 |
