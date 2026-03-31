# 市场系统 — 开发者文档

> 2026-03-30 | 股票 + 预测市场 + 多链钱包 + Polymarket 交易

## 架构概览

```
数据层（market-data.js）
  ├── 加密货币 — MEXC API
  ├── 股票 — Yahoo Finance v8
  ├── 预测市场 — Polymarket Gamma API
  ├── 大宗商品 — Yahoo Finance (Gold/Oil/Silver)
  ├── 资金费率 — Binance Futures
  └── 恐贪指数 — Alternative.me

Console API 层
  ├── stocks.js — 自选股 CRUD + 行情 + 市场概览 + Agent综述 + Polymarket交易
  └── trading.js — /api/market/* 路由（已有，6源聚合）

Mind 技能层
  ├── stock_tracker.mjs — 股市追踪 + 宏观关联
  └── prediction_sense.mjs — 预测市场情绪指标

UI 层
  ├── market-overview.eta — 全市场概览 + Agent 综述
  ├── stocks.eta — 自选股管理 + 实时行情
  └── predictions.eta — 预测市场 + 新手引导 + 中文解读
```

## 数据源

### market-data.js

所有数据源独立失败，互不影响。5 分钟内存缓存。

| 函数 | 数据源 | 超时 | 缓存 |
|------|--------|------|------|
| `fetchCryptoData()` | MEXC /api/v3/ticker/24hr | 8s | cachedCrypto |
| `fetchStockData(symbols?)` | Yahoo Finance v8 /chart/ | 5s/symbol | cachedStocks |
| `fetchPredictionData()` | Polymarket Gamma API /markets | 8s | cachedPredictions |
| `fetchCommodityData()` | Yahoo Finance (GC=F, CL=F, SI=F) | 5s/symbol | cachedCommodities |
| `fetchFundingRates()` | Binance Futures /fapi/v1/fundingRate | 8s | cachedFunding |
| `fetchSentiment()` | Alternative.me /fng/ | 8s | cachedSentiment |
| `fetchAllMarkets(symbols?)` | 并行调用全部 6 源 | — | — |
| `fetchYahooQuote(symbol)` | 单个 Yahoo Finance 查询 | 5s | 无 |

### 股票数据字段

```javascript
{
  symbol: 'AAPL',
  name: 'Apple Inc.',
  price: 248.80,
  change24h: -1.23,        // chartPreviousClose 计算
  high: 250.12,
  low: 247.30,
  volume: 52340000,
  high52w: 260.10,
  low52w: 164.08,
  exchange: 'NMS',
  currency: 'USD',
}
```

### 预测市场数据字段

```javascript
{
  id: '0x...',
  question: 'Will Trump visit China by March 31?',
  description: 'This market resolves...',     // 分辨规则
  resolutionSource: '',                        // 信息来源
  outcomes: ['Yes', 'No'],
  yes: 5,                                     // Yes 概率 %
  no: 95,                                     // No 概率 %
  outcome: 'Yes 5% / No 95%',                 // 格式化字符串
  volume24h: 2763785.76,
  volume: 15000000,
  liquidity: 4025900.20,
  endDate: '2026-03-31T00:00:00Z',
  slug: 'will-trump-visit-china-by-march-31',
  lastTradePrice: 0.05,
  bestBid: 0.04,
  bestAsk: 0.06,
  spread: 0.02,
}
```

## 数据库

### stock_watchlist — 用户自选股

```sql
CREATE TABLE stock_watchlist (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,       -- AAPL, 0700.HK
  name TEXT,                  -- Apple Inc.（添加时自动从 Yahoo Finance 获取）
  market TEXT DEFAULT 'us',   -- us / hk / cn / other
  sector TEXT,
  added_by TEXT,              -- relay_node_id
  notes TEXT,
  created_at TEXT
);
```

种子数据：SPY, QQQ

## API 端点

### 股票

| 端点 | 方法 | 说明 |
|------|------|------|
| `/stocks` | GET | 股票页面 |
| `/api/stocks/watchlist` | GET | 自选股列表 |
| `/api/stocks/watchlist` | POST | 添加（body: `{symbol, market?, sector?, notes?}`）|
| `/api/stocks/watchlist/:id` | DELETE | 删除 |
| `/api/stocks/quotes` | GET | 自选股实时行情 |
| `/api/stocks/quote/:symbol` | GET | 单股详情 |
| `/api/stocks/overview` | GET | 自选股 + 大宗 + 费率 + 恐贪 |

### 预测市场

| 端点 | 方法 | 说明 |
|------|------|------|
| `/predictions` | GET | 预测市场页面 |
| `/api/predictions/markets` | GET | 热门市场（Polymarket Gamma API）|

### Polymarket 交易

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/predictions/wallet` | GET | Agent 的 Polygon 钱包 + USDC 余额 |
| `/api/predictions/setup` | POST | 创建 Polymarket CLOB API Key（EIP-712 签名）|
| `/api/predictions/positions` | GET | Agent 在 Polymarket 的持仓 |
| `/api/predictions/orders` | GET | 活跃订单 |
| `/api/predictions/order` | POST | 下单（body: `{relay_node_id, tokenId, side, price, size}`）|
| `/api/predictions/order/:id` | DELETE | 撤单 |
| `/api/predictions/book/:tokenId` | GET | 订单簿 |

### 市场概览

| 端点 | 方法 | 说明 |
|------|------|------|
| `/market-overview` | GET | 概览页面 |
| `/api/market/overview` | GET | 全市场聚合数据 |
| `/api/market/brief` | GET | Agent AI 综述（15 分钟缓存）|
| `/api/market/all` | GET | 6 源全量数据 |
| `/api/market/crypto` | GET | 加密货币 |
| `/api/market/stocks` | GET | 股票（默认指数）|
| `/api/market/prediction` | GET | 预测市场 |
| `/api/market/commodities` | GET | 大宗商品 |
| `/api/market/funding` | GET | 资金费率 |
| `/api/market/sentiment` | GET | 恐贪指数 |

## 多链钱包系统

### 支持的链

| 链 | RPC | USDT 合约 | USDC 合约 | 原生币 |
|----|-----|-----------|-----------|--------|
| BNB | bsc-dataseed1.binance.org | 0x55d3...7955 (18位) | 0x8AC7...580d (18位) | BNB |
| ETH | eth.llamarpc.com | 0xdAC1...1ec7 (6位) | 0xA0b8...eB48 (6位) | ETH |
| Polygon | polygon-bor-rpc.publicnode.com | 0xc213...8e8F (6位) | 0x3c49...3359 (6位) | MATIC |
| SOL | api.mainnet-beta.solana.com | USDT 查询已有 | USDC 待接 | SOL |
| TRON | api.trongrid.io | USDT 查询已有 | USDC 待接 | TRX |

### API 返回格式

```javascript
// GET /api/relay/:id/wallets
{
  kaspa: { address, balance, hasMnemonic },
  chains: [{
    id, chain, address, label,
    usdtBalance: 6.67,      // USDT 余额
    usdcBalance: 33.25,     // USDC 余额（新增字段）
    nativeBalance: 34.45,   // 原生币余额
    isDefault, hasPrivateKey,
  }]
}
```

### Polymarket 交易服务 (polymarket.js)

```
认证流程：
  1. 创建 Polygon 钱包（Agent 页 → 钱包 → polygon）
  2. 充值 USDC 到 Polygon 钱包
  3. POST /api/predictions/setup → 用私钥签名创建 CLOB API Key
  4. API Key 加密存储在 config_entries

交易流程：
  1. GET /api/predictions/markets → 选择市场
  2. 从市场数据获取 clobTokenIds（Yes/No 的 token ID）
  3. GET /api/predictions/book/:tokenId → 查看订单簿
  4. POST /api/predictions/order → 下限价单
     body: { relay_node_id, tokenId, side: 'BUY', price: 0.43, size: 100 }
  5. 等待成交或 DELETE 撤单
```

## Mind 技能

### stock_tracker.mjs

- **激活**：proactive 始终 / reactive 股票关键词
- **数据**：`/api/stocks/overview`（自选股 + 大宗 + 费率 + 恐贪）+ `/api/market/crypto`
- **输出**：自选股行情 + 异动(>3%) + 大宗商品 + 恐贪 + 资金费率 + crypto 关联
- **Brain 指令**：SPY/QQQ 跌 + 恐贪极端 → 风险偏好下降，crypto 可能跟跌

### prediction_sense.mjs

- **激活**：proactive 始终 / reactive 预测关键词
- **数据**：`/api/predictions/markets`
- **输出**：热门事件 + 概率 + 成交量
- **Brain 指令**：高概率事件 = 近乎确定；概率急变 = 有新信息

## Sidebar 导航

```
聊天
Agent ► (toggle)
  概览 / 通讯录 / 历史 / 状态
  更多 ► 图谱 / 目标 / 钱包 / 技能 / Card
探索
市场 ► (toggle)
  概览 / 自由市场 / 交易所 / 股票 / 预测市场
设置 ► (toggle)
  账户管理 / AI 引擎 / 技能 / 日志 / 鲸鱼信号 / 节点 RPC
```

## 券商接口（明天）

设计文档：`docs/broker-interface-design.md`

优先接入 Interactive Brokers (Client Portal API)。统一 BrokerAdapter 接口支持 IBKR/Alpaca/Tradier。

## 意图解析器（intent-parser.mjs）

### 设计原则

**不确定就不拦，交给 Brain。** Intent parser 是高置信度快捷通道，不是决策者。

### 三层防护

1. **关键词**：全部 ≥3 字短语，不用单字/双字（中文里太不可靠）
2. **execute 类**：必须提取到结构化参数（kaspa 地址/金额/订单号），或 ≥4 字长关键词精确命中
3. **参数不全**：不生成 confirm card，fall through 到 Brain 自然追问

### execute 意图匹配流程

```
消息: "转 100 KAS 到 kaspa:qptest..."
  → 提取参数: amount=100, to=kaspa:qptest...
  → 关键词"转KAS"命中
  → 参数齐全 → 生成 confirm card ✅

消息: "转KAS给朋友"
  → 提取参数: 无地址无金额
  → 关键词命中但参数不全
  → fall through 到 Brain → Brain 追问"转多少？到哪个地址？" ✅

消息: "指导我链接 Polymarket"
  → 无关键词命中
  → 直接到 Brain → Brain 正常回答 ✅
```

### intents.json 关键词规范

- query 类：`余额多少`、`KAS价格`、`系统状态`（≥3字有意义的短语）
- execute 类：`转账KAS`、`挂卖单`、`取消订单`（动作+对象）
- 禁止：单字（给/转/卖）、通用双字（计划/历史/发现/网络）

## Agent 多链钱包感知

### self-awareness.mjs

Agent 通过 `self_awareness` 技能获取自身状态。现在包含多链钱包：

```
Brain 看到的信息：
  KAS Balance: 21.487 KAS
  Multi-chain wallets:
    BNB: 0x0938... | 6.67 USDT | 0.1000 BNB
    ETH: 0x49e8... | empty
    POLYGON: 0x52D7... | 33.25 USDC | 34.4454 MATIC
```

数据来源：`GET /api/relay/:id/wallets`（同时查 USDT + USDC + 原生币）

### 稳定币分离

每条 EVM 链同时查 USDT 和 USDC 两个独立合约：

```javascript
const STABLECOINS = {
  bnb:     { usdt: '0x55d3...', usdc: '0x8AC7...' },
  eth:     { usdt: '0xdAC1...', usdc: '0xA0b8...' },
  polygon: { usdt: '0xc213...', usdc: '0x3c49...' },
};
```

API 返回 `usdtBalance` + `usdcBalance` 两个字段。UI 按实际余额显示，零余额不显示。

## trade_sense 行为约束

trade_sense 是分析技能（看和想），不是执行技能。Brain 指令明确：

```
NEVER say "click confirm", "click execute", "press button"
— you have NO UI buttons. You are an analyst, not an executor.
If showing a split plan, say "this is the analysis"
— execution requires owner to use the trading panel separately.
```

## 待办

- [ ] 钱包组件抽 partial 共用（agent-v2.eta + market.eta 各写一套）
- [ ] SOL/TRON 链加 USDC 合约查询
- [ ] 预测市场精选（Agent 根据用户偏好筛选有价值议题）
- [ ] 首次使用引导卡片（core_asset / watched_markets / goal）
- [ ] 意图解析器长期方向：全走 Brain，parser 只做参数提取
