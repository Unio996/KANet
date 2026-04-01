# Agent Deep Stock Analysis — Design Spec

> Agent 不只看价格，而是能分析基本面、发现竞争对手、评估持仓健康度。
> KANet 的差异化：用户加一只 TSLA，Agent 自动把竞争格局摆出来。

---

## 目标

让 Agent Brain 和 UI 同时具备深度股票分析能力：
1. **基本面感知** — 每只自选股的 sector/industry/revenue/margin/PE/beta/analyst consensus
2. **竞争对手自动发现** — 按 industry 自动拉同行业 top 5 peers，对比表现偏离
3. **持仓健康度** — sector 集中度、平均 beta、分析师目标价 vs 成本价
4. **人机结合** — Brain 深度分析 + UI 同步展示，用户能看到 Agent 看到的

## 约束

- **不新增文件** — 只扩展现有 market-data.js / stock-tracker.mjs / self-awareness.mjs / stocks.js / stocks.eta
- 不改券商连接/下单流程
- 不改其他 7 个数据源
- Yahoo Finance quoteSummary 需 crumb，已验证可用

---

## 一、数据层（market-data.js）

### Crumb 管理

模块级单例，所有 Yahoo quoteSummary/screener 请求共用：

```
_yahooCrumb = { cookie, crumb, ts }
```

- 首次请求时获取：`fc.yahoo.com` → cookie → `/v1/test/getcrumb` → crumb
- 缓存 4 小时
- 任何请求返回 401 → 自动刷新（retry 一次）
- 获取失败不阻塞其他数据源

### fetchStockFundamentals(symbols[])

对每个 symbol 调 `/v10/finance/quoteSummary?modules=assetProfile,financialData,defaultKeyStatistics`。

返回字段：

| 字段 | 来源模块 | 用途 |
|------|---------|------|
| sector | assetProfile | 竞争对手分组、集中度 |
| industry | assetProfile | 竞争对手发现 |
| revenue (totalRevenue.raw) | financialData | 基本面 |
| revenueGrowth | financialData | 成长性 |
| profitMargin | financialData | 盈利能力 |
| grossMargin | financialData | 盈利能力 |
| targetMeanPrice | financialData | 分析师共识 |
| recommendationKey | financialData | 分析师评级 (buy/hold/sell) |
| numberOfAnalystOpinions | financialData | 覆盖深度 |
| forwardPE | defaultKeyStatistics | 估值 |
| trailingPE | defaultKeyStatistics | 估值 |
| beta | defaultKeyStatistics | 风险系数 |
| shortRatio | defaultKeyStatistics | 做空压力 |
| marketCap (enterpriseValue.raw) | defaultKeyStatistics | 规模 |

缓存：`cached('fundamentals:TSLA', ...)` TTL **1 小时**。

### fetchIndustryPeers(industry, excludeSymbols[])

用 Yahoo screener 按 industry 筛选 market cap 前 5，排除 excludeSymbols。

- 共用 crumb 单例（不单独维护 cookie 状态）
- **industry 为空时（ETF/REITs 等）静默返回空数组，不报错**
- 只拉基础行情（复用 `fetchYahooQuote`），不拉完整基本面
- 缓存 1 小时

### 导出常量

```javascript
export const DIVERGENCE_WARN_THRESHOLD = 3; // percent, Brain + UI 共用
```

### 导出带缓存版本

```javascript
export const cachedFundamentals = cached('fundamentals', fetchStockFundamentals);
export const cachedIndustryPeers = cached('peers', fetchIndustryPeers);
```

---

## 二、Brain 认知层（stock-tracker.mjs）

### gatherContext 扩展

新增一路并行 fetch（与现有 4 路并行）：

```javascript
const [overview, crypto, cryptoGlobal, calendar, fundamentals] = await Promise.all([
  fetchJson(`${consoleUrl}/api/stocks/overview`),
  fetchJson(`${consoleUrl}/api/market/crypto`),
  fetchJson(`${consoleUrl}/api/market/crypto-global`),
  fetchJson(`${consoleUrl}/api/market/calendar`),
  fetchJson(`${consoleUrl}/api/stocks/fundamentals`),  // 新增
]);
```

### formatForBrain 四板块

#### 板块 1: WATCHLIST + FUNDAMENTALS（替代现有纯价格列表）

```
Watchlist (5 stocks):
  TSLA $371.75 +4.6% | Auto Manufacturers | FwdPE 132 | Beta 1.93
    Revenue 94.8B (-3.1%) | Margin 4.0% | Analysts: BUY (41) target $421
  QS $6.82 -2.1% | Auto Parts | FwdPE — | Beta 2.41
    Revenue 0 | Margin — | Analysts: HOLD (8) target $5.50
```

#### 板块 2: COMPETITOR MAP（新增）

```
--- COMPETITOR MAP (auto-discovered) ---
Auto Manufacturers (your: TSLA):
  TSLA $371.75 +4.6% | RIVN $14.20 -1.2% | GM $52.30 +0.8% | F $11.05 +0.3% | BYD $67.80 +2.1%
  ⚠ TSLA +4.6% vs peers avg +0.5% → divergence +4.1% (threshold: 3%)
```

- 按 industry 分组，自选股 + auto-discovered peers 并列
- `divergence = stock.change24h - avg(peers.change24h)`
- 只在 `|divergence| > DIVERGENCE_WARN_THRESHOLD` 时标注
- industry 为空的股票不参与分组

#### 板块 3: PORTFOLIO HEALTH（新增，两种模式）

**Broker 已连接（有 avgCost/pnl）：**

```
--- PORTFOLIO HEALTH ---
Sector concentration: 80% Consumer Cyclical — HIGH RISK (single sector)
Avg beta: 2.17 — HIGH VOLATILITY (market avg 1.0)
Biggest drag: QS -87.6% ($4,838 unrealized loss)
Analyst divergence: QS target $5.50 < current $6.82 — downside risk
```

**只有自选股（无 broker）：**

```
--- PORTFOLIO HEALTH ---
Sector concentration: 80% Consumer Cyclical — HIGH RISK
Avg beta: 2.17 — HIGH VOLATILITY
Analyst consensus: 3 BUY, 1 HOLD, 1 SELL
⚠ QS: analyst target $5.50 below current $6.82 — downside risk
```

不猜不编，有什么数据说什么话。

#### 板块 4: 宏观（保留现有）

Commodities / Fear & Greed / Funding Rate / CoinGecko / Economic Calendar — 不动。

### 静态 instructions 改为动态风险提示

移除末尾的固定 bullet list，改为基于实际数据生成的提示（高 beta、sector 集中、analyst downgrade 等）。

### Brain context 大小控制

- 自选股 ≤ 20 只：全部展示两行
- Peers 每个 industry ≤ 5 只：单行紧凑格式
- Portfolio health：4-5 行
- 总增量 ~30-40 行

---

## 三、UI 层（stocks.eta + stocks.js）

### 新增 API endpoint

```
GET /api/stocks/fundamentals
```

返回：

```json
{
  "stocks": {
    "TSLA": { "sector": "Consumer Cyclical", "industry": "Auto Manufacturers", "revenue": 94830000000, ... }
  },
  "peers": {
    "Auto Manufacturers": [
      { "symbol": "RIVN", "price": 14.20, "change24h": -1.2, "name": "Rivian Automotive" },
      ...
    ]
  },
  "health": {
    "avgBeta": 2.17,
    "sectorConcentration": { "Consumer Cyclical": 0.8, "Technology": 0.2 },
    "maxSectorPct": 0.8,
    "analystSummary": { "buy": 3, "hold": 1, "sell": 1 }
  }
}
```

复用 `cachedFundamentals` + `cachedIndustryPeers`，1 小时缓存。

### stocks.eta 改动

#### 1. Stats Bar 扩展

现有：自选股数量 / 恐贪指数 / 资金费率。新增：

- **Beta 均值** — >1.5 黄色(warning)，>2.0 红色(error)
- **Sector 集中度** — >60% 黄色，>80% 红色

#### 2. 自选股卡片升级

从一行 symbol+price 变为：
- 第一行：名称 + 行情 + industry badge（复用已有 `badge` CSS class）
- 第二行：4 格 grid — FwdPE / Revenue / Margin / Analyst target
- 折叠区域：`[展开竞争对手 ▼]`

#### 3. 竞争对手折叠面板

- init() 时随 fundamentals 一起拉回（1h 缓存，不贵）
- 点击展开只是 `x-show` 切换，零延迟
- Peers 紧凑两列：symbol + price + change
- 底部偏离度：引用 `DIVERGENCE_WARN_THRESHOLD` 常量，>阈值用 warning/error 色

#### 4. Portfolio Health（有 broker 时）

在券商面板区域显示总盈亏 + 最大亏损股。

### 不改什么

- 券商连接面板、买卖下单流程、添加/删除自选股、页面布局骨架

---

## 四、测试计划

### 单元验证（手动，改完即验）

| # | 验证项 | 方法 |
|---|-------|------|
| 1 | Crumb 获取 + 缓存 + 401 自动刷新 | node -e 脚本：连续两次调用 + 手动失效验证刷新 |
| 2 | fetchStockFundamentals 完整字段 | TSLA/QS/SPY 各调一次，确认字段正确，SPY industry 为空 |
| 3 | fetchIndustryPeers 发现 + 排除 | "Auto Manufacturers" exclude=["TSLA"]，返回 ≤5 不含 TSLA |
| 4 | industry 为空静默跳过 | SPY → 返回空数组，无报错 |
| 5 | 偏离度计算 | mock: TSLA +5%, peers avg +1% → divergence=4% > 3% → 标注 |

### 集成验证（系统启动后）

| # | 验证项 | 方法 |
|---|-------|------|
| 6 | Brain context 完整性 | 触发 proactive，查 adapter 日志确认四板块出现 |
| 7 | UI 基本面渲染 | /stocks 页确认卡片显示 sector/PE/revenue/analyst |
| 8 | UI 竞争对手展开 | 点击展开，确认 peers 已加载，偏离度颜色正确 |
| 9 | Stats Bar 新指标 | Beta 均值 + 集中度数字和颜色阈值正确 |
| 10 | 无 broker 降级 | 断开券商，Portfolio Health 不显示 PnL |

### Smoke test 扩展（test/smoke.mjs +3 项）

```
✓ fundamentals API returns sector for TSLA
✓ fundamentals API skips peers for ETF (SPY)
✓ divergence threshold consistent (DIVERGENCE_WARN_THRESHOLD imported in both Brain and UI)
```

---

## 文件变更清单

| 文件 | 改动类型 | 内容 |
|------|---------|------|
| kasia-console/src/services/market-data.js | 扩展 | crumb 管理 + fetchStockFundamentals + fetchIndustryPeers + DIVERGENCE_WARN_THRESHOLD |
| agent-mind/src/skills/stock-tracker.mjs | 重构 | gatherContext 加 fundamentals fetch + formatForBrain 四板块 |
| kasia-console/src/api/stocks.js | 扩展 | GET /api/stocks/fundamentals endpoint |
| kasia-console/src/ui/stocks.eta | 扩展 | 卡片升级 + peers 折叠 + Stats Bar |
| test/smoke.mjs | 扩展 | +3 项测试 |

**不改的文件：** self-awareness.mjs（已有 broker position 数据，stock-tracker 直接通过 API 消费）、其他数据源、券商适配器、relay、mind 核心。
