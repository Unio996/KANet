## 八、市场系统（8 数据源 + 券商 + 预测市场）

### 数据源（market-data.js，10 分钟缓存，独立失败互不影响）

| # | 数据源 | API 端点 | 提供什么 | Brain 感知 |
|---|--------|---------|---------|-----------|
| 1 | MEXC | `/api/market/crypto` | KAS/BTC/ETH 价格+涨跌 | trade_sense |
| 2 | Yahoo Finance | `/api/stocks/*` | 自选股行情 + 52周高低 | stock_tracker |
| 2b | Yahoo Finance v8 | `/api/stocks/klines` | **日 K 线（1 个月 OHLCV）** | **stock_tracker** |
| 2c | Yahoo Finance | `/api/stocks/fundamentals` | **基本面 + 财报日期 + ROE/FCF/D-E/PEG** | **stock_tracker** |
| 3 | Polymarket | `/api/predictions/markets` | 1000 个预测市场 | prediction_sense |
| 4 | Yahoo Finance | `/api/market/commodities` | 黄金/原油/白银 | stock_tracker |
| 5 | Binance | `/api/market/funding` | BTC 资金费率 | stock_tracker |
| 6 | Alternative.me | `/api/market/sentiment` | 恐贪指数 | stock_tracker |
| 7 | **CoinGecko** | `/api/market/crypto-global` | 总市值/BTC市占率/活跃币种 | **stock_tracker** |
| 8 | **Forex Factory** | `/api/market/calendar` | 经济日历/今日高影响力事件 | **stock_tracker** |
| 9 | **Yahoo RSS** | 直接 fetch（skill 内） | **自选股前 3 只新闻标题** | **stock_tracker** |

**Agent 怎么看到这些？** stock_tracker.mjs（4/8 升级为四层情报架构）在 gatherContext 中并行 fetch overview + fundamentals + klines + crypto + crypto-global + calendar + Yahoo RSS 新闻。formatForBrain 输出 7 个面板：

1. **WATCHLIST + SIGNALS**：每只股票含技术信号（SMA5/SMA20 趋势、波动率、动量、支撑/阻力）+ 财报日期 + 深度基本面（ROE/D-E/FCF）
2. **SIGNALS SUMMARY**：跨股票聚合 bullish/bearish + 7 日内财报警告
3. **STOCK NEWS**：Yahoo RSS 最新 2 条标题/股（相对时间）
4. **COMPETITOR MAP**：同行价格 + 偏离度 + **相对估值**（FwdPE vs 同行均值 premium/discount）
5. **PORTFOLIO HEALTH**：板块集中度 + avg beta + 分析师共识 + 高估警告
6. **MACRO**：异动 + 商品 + 恐贪 + 资金费率 + CoinGecko + 经济日历
7. **信号解读指引**：5 条规则（仿照 prediction-sense 模式）

示例输出（单股）：
```
AAPL $253.50 -2.1% | Consumer Electronics | FwdPE 27
  Trend: DOWN (vs SMA5) | Bias: BULLISH (SMA5 vs SMA20)
  Volatility: LOW (1.3%) | Momentum: +2.8% (5d)
  Support $245.51 (3.2%) | Resistance $262.16 (3.4%)
  Earnings: 2026-04-30 (22d) — EPS est $1.94, Rev est 109.27B
  Analysts: BUY (40) target $295 (16%) | ROE 152.0% | D/E 102.6 | FCF 106.31B
```

**对比改动前：** 之前只输出 `AAPL $253.50 -2.1% (52w: 170-260)` 一行原始数据。

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

