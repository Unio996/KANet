# Exchange Page Layout Specification

> Status: AGREED by both nodes (2026-04-11 #kanet-public)
> Based on: market.eta proven interaction model + exchange-ui-design-proposal.md
> Decisions locked: split-pane, light theme, 360px left, arb/seed collapsible, mobile stacks

---

## 1. Overall Structure

```
+---------------------------------------------------------------+
|  DISCOVERY BAR (proof-of-life stats)                          |
|  47 trades | avg 2m 18s | $1,240 today | KAS $0.033 +3.1%   |
+---------------------------------------------------------------+
|         |                                                     |
|  LEFT   |  RIGHT PANE                                         |
|  PANE   |                                                     |
|  360px  |  Deal detail / Empty state                          |
|         |                                                     |
|  Offer  |  Pipeline stepper                                   |
|  list   |  Conversation flow                                  |
|         |  Approval cards                                     |
|         |  TX proof links                                     |
|         |                                                     |
+---------+-----------------------------------------------------+
|  ARB/SEED (collapsible bottom section, operator-only)         |
+---------------------------------------------------------------+
```

## 2. Discovery Bar

Top of page, always visible. Shows proof-of-life stats.

| Field | API Source | Display Rule |
|-------|-----------|--------------|
| Completed trades | `/api/exchange/overview` → `trades_24h` | Show only if >= 5 total completed ever |
| Avg settlement time | New: compute from exchange_offers (completed_at - matched_at) | Show only if >= 5 completed |
| 24h volume | `/api/exchange/overview` → `volume_24h_kas` | Always show |
| KAS price | `/api/exchange/overview` → `kas_market_price` | Always show |
| Best sell/buy | `/api/exchange/overview` → `best_sell_price` / `best_buy_price` | Show if open offers exist |

**Design:** warm-50 background, small text, no jargon. Info icon (i) tooltip explains "Powered by Kaspa broadcast protocol."

## 3. Left Pane (360px)

### 3.1 Tabs

```
[Market]  [My Deals]  [History]
```

- **Market**: All open offers, sorted by price. Default tab.
- **My Deals**: Offers where local agent is maker or taker, status not terminal.
- **History**: Completed / cancelled / expired / timed_out offers.

### 3.2 Offer List Item

```
+-------------------------------------------+
|  SELL  100 KAS  ->  $3.32 USDT            |
|  -0.3% vs market  [BNB] [ETH]            |
|  kaspa:qq...ab12  ****  (47 trades)       |
|  23m left                                  |
+-------------------------------------------+
```

| Element | Source | Helper |
|---------|--------|--------|
| Side (SELL/BUY) | `give_asset === 'KAS'` ? SELL : BUY | — |
| Amount | `give_amount` / `want_amount` | `KANet.formatKas()` |
| Price vs market | `price_vs_market` (from enriched offers API) | `KANet.priceVsMarketBadge()` |
| Accepted chains | `verification_meta.accepted_chains` | `KANet.chainName()` |
| Maker reputation | Fetch `/api/exchange/reputation/:address` (lazy, cached) | `KANet.starRating()` |
| Time remaining | `expires_at` | `KANet.countdown()` |

**Color rules for price badge:**
- <= -0.3%: green (cheaper than market, good for buyer)
- -0.3% to +2%: neutral
- \>= +2%: red (expensive)

**Click:** Select offer -> load detail in right pane.
**Selected state:** brand-50 background + brand-500 left border (like market.eta `.sel`).

### 3.3 Publish Button

Bottom of left pane, fixed position: `[+ Publish Offer]`

## 4. Right Pane

### 4.1 Empty State

When no offer is selected:
```
Select an offer to view details
or publish your own
```

### 4.2 Deal Header

```
SELL 100 KAS -> 3.32 USDT  @$0.0332  [BNB]
Maker: kaspa:qq...ab12  ****  (47 trades, 0 disputes)
```

### 4.3 Pipeline Stepper (from market.eta)

```
O----O----O----O----O
Open  Matched  Verifying  Delivering  Completed
```

Clickable nodes. Active node pulses. Done nodes green. Click expands story card showing:
- Step description
- TX hash (clickable -> block explorer via `KANet.explorerTxUrl()`)
- Agent reasoning (if available from execution_states.display_summary)
- Timestamp

### 4.4 Trust Information

Below pipeline, contextual:

**For taker viewing an open offer:**
```
Seller has locked 100 KAS in escrow.
System will verify your payment and deliver KAS automatically.
[Accept Offer] button
```

**For maker viewing their own matched offer:**
```
Your 100 KAS is locked. Buyer is paying...
If no payment in 30 minutes, your KAS will be auto-released.
```

**Lock status visualization:**
- Green padlock icon = KAS locked (fund_lock exists)
- Gray padlock = pending / not yet locked
- This is MORE powerful than star ratings for building trust

### 4.5 Conversation Flow (from market.eta)

Trade events rendered as chat-like flow:
- System cards (lock, payment, verification progress, delivery)
- Agent messages (if any DM exchange happened)
- Approval cards with countdown (for manual verification mode)

Each system card has expandable proof section with TX links.

### 4.6 Accept Modal

Triggered by [Accept Offer] button. Overlay modal (not page navigation).

```
+-------------------------------------------+
|  Accept Offer                             |
|                                           |
|  You will buy: 100 KAS                    |
|  You will pay: 3.32 USDT                  |
|  Price: $0.0332/KAS  (-0.3% vs market)   |
|                                           |
|  Pay with: [BNB] [ETH] [SOL] [TRON]      |
|  Your balance: 5.21 USDT (BNB)           |
|                                           |
|  System will auto-pay from your wallet.   |
|                                           |
|  [Cancel]  [Confirm]                      |
+-------------------------------------------+
```

Wallet balance check: if insufficient, disable Confirm + show warning.

## 5. Arb/Seed Section

Collapsible bottom section. Hidden by default. Toggle button: "Operator Tools".

Contains current Arbitrage and Seed tabs content, unchanged.

Only visible to node operator (always visible in Console, but visually separated from the trading interface).

## 6. Mobile Breakpoint (< 768px)

- Discovery bar: horizontal scroll or wrap to 2 lines
- Left pane becomes full-width list view (no right pane visible)
- Tap offer -> right pane replaces left pane (full screen detail)
- Back button returns to list
- Arb/Seed section hidden on mobile

## 7. Component Partials

| Partial | Used in | Description |
|---------|---------|-------------|
| `offer-list-item.eta` | Left pane | Single offer card with price badge + reputation |
| `deal-pipeline.eta` | Right pane | Clickable stepper with story cards |
| `deal-conversation.eta` | Right pane | Chat-like event flow |
| `accept-modal.eta` | Right pane overlay | Accept confirmation with chain selection |

## 8. API Data Contract

| UI Zone | API Endpoint | Key Fields |
|---------|-------------|------------|
| Discovery bar | `GET /api/exchange/overview` | trades_24h, volume_24h_kas, kas_market_price, best_sell_price, best_buy_price |
| Offer list | `GET /api/exchange/offers` | offers[] with unit_price, price_vs_market, kas_market_price |
| Reputation badge | `GET /api/exchange/reputation/:address` | stars, risk, completed, disputed, totalTrades |
| Deal detail | `GET /api/exchange/offers/:id` | Full offer object + verification_meta |
| Accept action | `POST /api/exchange/accept` | relayId, offer_id, taker_chain |

## 9. Design Tokens (Light Theme)

From existing design system v2 (head.eta):

| Token | Value | Usage |
|-------|-------|-------|
| `warm-50` | #faf9f7 | Page background |
| `warm-100` | #f7f6f3 | Card background |
| `warm-200` | #efeee9 | Borders |
| `ink-700` | #1a1a2e | Primary text |
| `ink-400` | #6b6d7b | Secondary text |
| `brand-500` | #3b82f6 | Accent / selected state |
| `green-600` | — | Positive price / completed / locked |
| `red-500` | — | Negative price / error / disputed |
| `yellow-600` | — | Warning / pending |
