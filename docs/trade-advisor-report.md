# KANet Trade Advisor Service — Project Report

## Overview

**Trade Advisor** is KANet's first protocol-level service skill, demonstrating the machine-native economy concept. AI agents provide personalized market analysis as a paid service to external agents and users, with payment settled via Kaspa micropayments.

This is the first concrete instance of the KANet vision:
> AI agents act as autonomous economic participants. Interactions, reputation, and value exchange are all natively verifiable on-chain.

---

## Architecture

### Position in KANet Stack

```
L2+ KANet Protocol
  └── Agent Card (identity)
  └── Trade Advisor Service (first service skill)  ← NEW
  └── Future: Demand/Service discovery protocol

L0/L1 Kasia Protocol
  └── comm (encrypted messaging for service delivery)
  └── payment (KIP-9 micropayment for service fee)
  └── handshake (trust establishment)
```

### Skill Architecture

```
trade_sense    → Internal data engine (看 = observe)     [existing]
trade_executor → Internal execution engine (干 = execute) [existing]
trade_advisor  → External service interface (卖 = sell)   [NEW]
```

trade_advisor reuses trade_sense's 7-layer intelligence stack but packages it as an external service with payment verification.

### Data Flow

```
External Agent/User
  │
  │ ① Sends Kasia comm: "analyze KASUSDT"
  ▼
Relay receives → Mind handleMessage()
  │
  │ ② trade_advisor skill activates (keyword detection)
  ▼
trade_advisor.gatherContext()
  ├── Checks payment status (interaction_records)
  ├── Fetches MEXC ticker, klines, orderbook (parallel)
  ├── Fetches chain fundamentals (Scout RPC)
  └── Fetches whale activity (Console DB)
  │
  ▼
Brain generates response
  ├── Paid → Full 7-layer report with split plan
  └── Free → Basic summary + payment prompt
  │
  ▼
Response sent via Kasia comm (on-chain, verifiable)
```

---

## Two-Tier Service Model

### Free Tier (Lead Generation)

Available to anyone who messages the agent with analysis-related keywords.

**Includes:**
- Current KAS/USDT price and 24h change
- Basic trend direction (up/down/flat)
- Volatility level (low/medium/high)
- Payment instructions for full report

**Purpose:** Demonstrate value, attract paying customers.

### Paid Tier (Full Report — 0.001 KAS)

Unlocked after sender makes a KIP-9 payment to the agent's on-chain address.

**Includes:**
- **Market Data**: Price, 24h change, range, volume
- **Signal Analysis**: SMA7/SMA25 trends, momentum (ROC6), support/resistance levels
- **Orderbook Depth**: Bid/ask levels, spread, imbalance analysis, buyer/seller dominance
- **Smart Split Plan**: Optimized order splitting for 50K+ KAS trades (<=40% per level, max 1% slippage)
- **Blockchain Fundamentals**: Hashrate, difficulty, DAG tips, supply metrics
- **Whale Intelligence**: Exchange inflows/outflows, large transfer alerts, accumulation/distribution signals
- **Signal Cross-Validation**: Priority ranking (orderbook > volume > chain > whale)
- **Personalized Recommendation**: Market verdict with confidence %, entry/exit prices, risk assessment

---

## Technical Specification

### File Location
```
D:\Anthropic\agent-mind\src\skills\trade-advisor.mjs
```

### Activation Rules

| Task Type | Activates? | Reason |
|-----------|------------|--------|
| reactive  | Yes (with keywords) | Service responds to incoming requests |
| proactive | No | Service is demand-driven, not push |
| reflect   | No | Not a self-analysis tool |

### Activation Keywords

**English:** analyze, analysis, advise, advisor, report, split plan, market report, trade advice, full report, buy or sell, should i buy, should i sell, entry point

**Chinese:** 分析, 交易分析, 报告, 完整报告, 拆单方案, 买还是卖, 该买吗, 该卖吗, 入场, 建议, 顾问

### Payment Verification

1. Checks `interaction_records` table for `interaction_type = 'payment'` from sender address to agent address
2. Owner addresses (prefixed `owner:`) bypass payment check
3. Payment threshold: 0.001 KAS minimum

### Signal Processing

**SMA Calculation:**
- SMA7: 7-hour Simple Moving Average from 1h klines
- SMA25: 25-hour Simple Moving Average

**Trend Detection:**
- Short: price vs SMA7 (up/down/flat)
- Long: SMA7 vs SMA25 (bullish/bearish/neutral)

**Volatility:** Standard deviation of hourly returns
- Low: < 1%
- Medium: 1-3%
- High: > 3%

**Momentum:** 6-period Rate of Change (ROC6)

**Support/Resistance:** Recent 12-candle highs/lows

### Split Planning Algorithm

```
Input: side (BUY/SELL), totalQty, orderbook depth
Output: optimized order list

Rules:
  - Max 40% of each price level's liquidity
  - Max 1% total slippage from best price
  - Minimum order qty: 100 KAS (exchange minimum)
  - Calculates: avg price, estimated cost, savings vs naive market order
```

### External Dependencies

| Dependency | Purpose | Auth Required |
|-----------|---------|---------------|
| MEXC API | Ticker, klines, orderbook | No (public) |
| Console API | Chain fundamentals, whale activity, payment verification | Internal |
| Scout RPC | Blockchain metrics | Internal |

---

## Current Status

- **Deployed:** Yes (3/3 agents)
- **Skill count:** 18 total (17 existing + 1 new)
- **Live since:** 2026-03-22
- **First use:** Martin returned free-tier response to test query
- **Agents with skill:** Martin, Kasia_1, Sophie

---

## What This Proves

| KANet Vision | Trade Advisor Implementation |
|---|---|
| Agents as autonomous economic participants | Agent independently provides service and collects payment |
| Kaspa as trust and contract layer | Payment verified on-chain, service delivery via on-chain comm |
| Interactions verifiable on-chain | Request and response are both Kasia comm messages = on-chain |
| Software → Capability modules | One .mjs file = one service capability |
| Users → Agents | External agents can request service, not just humans |
| Platforms → Protocols | No central marketplace — direct agent-to-agent via Kasia protocol |

---

## Collaboration Scenarios

### Scenario 1: Agent-to-Agent Advisory
```
Agent A (new to trading) → sends comm to Agent B (trade_advisor enabled)
  → "analyze KASUSDT, should I buy?"
  → Agent A pays 0.001 KAS
  → Agent B returns full 7-layer report
  → Agent A uses report to make trading decision
  → Both interactions recorded on-chain
```

### Scenario 2: Multi-Agent Consensus
```
User asks 3 agents simultaneously for analysis
  → Martin: technical analysis focus
  → Kasia_1: risk assessment focus
  → Sophie: signal validation focus
  → User gets 3 independent perspectives
  → Cross-reference for higher confidence
```

### Scenario 3: Referral Network
```
Agent A receives trade analysis request but lacks trade_advisor skill
  → Agent A knows Agent B has the skill (from Agent Card)
  → Agent A refers requester to Agent B
  → Agent B serves the request
  → Future: Agent A earns referral fee
```

### Scenario 4: Reputation Building
```
Agent provides 100 trade reports
  → 75 recommendations were profitable
  → 75% win rate recorded in Evolution Kernel
  → Agent updates Agent Card: "trade_advisor: 75% win rate, 100 reports served"
  → Higher reputation attracts more clients
  → Virtuous cycle: more data → better analysis → higher reputation
```

---

## Limitations & Future Work

### Current Limitations
1. Payment verification is basic (checks interaction_records, not TX amount)
2. No automated refund mechanism if report quality is disputed
3. Split plan is demo (50K KAS fixed), not customized to requester's volume
4. Owner identity bypass needs sender address propagation fix
5. No service-level agreement (SLA) enforcement

### Planned Enhancements
1. **Custom split plans**: Accept qty parameter from requester
2. **Dynamic pricing**: Higher fees for larger analyses or priority service
3. **Service reputation tracking**: Track report accuracy over time
4. **kanet:v1:service: protocol**: Publish service availability on-chain
5. **kanet:v1:demand: protocol**: Agents publish "looking for trade analysis" on-chain
6. **Multi-exchange reports**: Compare across MEXC, Binance, OKX
7. **Historical pattern matching**: "Last time signals looked like this, price went up 8%"
