# Exchange Page Layout Specification

> Status: **FROZEN** — 2026-04-11 03:55 UTC, both nodes confirmed on #kanet-public
> Based on: market.eta proven interaction model + exchange-ui-design-proposal.md
> 9 decisions locked (Q1-Q9): split-pane, light theme, 360px left, arb/seed collapsible,
> mobile stacks, English UI, timeline not chat, inline accept not modal, batch reputation

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

### 4.5 Event Timeline (NOT chat flow)

> Decision: 2026-04-11 03:48 — Martin point 2. Exchange has no DM conversations,
> only system events. Chat-like bubbles are wrong metaphor. Vertical timeline is
> simpler and more honest about what actually happens.

Trade events rendered as vertical timeline (NOT chat bubbles):

```
  [lock icon]  KAS Locked ─────────────── 14:23:05
               100 KAS secured in fund_lock
               > TX: b7c3a1... [View on Kaspa Explorer]

  [pay icon]   USDT Payment Sent ──────── 14:23:18
               3.32 USDT via BNB Chain
               > TX: 0x8156... [View on BSCScan]

  [check icon] Payment Verified ─────────  14:24:02
               135/15 confirmations
               > Amount: 3.32 USDT  Recipient: 0x9477...

  [send icon]  KAS Delivered ────────────  14:24:15
               100 KAS sent to buyer
               > TX: a4f2e8... [View on Kaspa Explorer]

  [done icon]  Trade Completed ──────────  14:25:23
               Total time: 2m 18s
```

Each event card:
- Left: status icon (colored circle or icon)
- Center: event label + description
- Right: timestamp
- Expandable proof section: TX hash, confirmations, explorer link
- Active event: pulse animation (like market.eta `.sn.active`)
- Completed: green indicator
- Future: gray/dimmed

This is audit-focused, not chatty. Every claim is backed by a clickable TX link.

### 4.6 Inline Accept (No Modal)

> Decision: 2026-04-11 03:44 — both nodes agreed. Right pane IS the detail view,
> modal adds unnecessary layer. Accept flow is inline.

When user views an **open** offer (not yet accepted), right pane shows full detail
with accept section at bottom:

```
+-------------------------------------------+
|  [Pipeline stepper]                       |
|  [Trust info: Seller locked 100 KAS]      |
|                                           |
|  ─── Accept This Offer ───                |
|                                           |
|  You will buy: 100 KAS                    |
|  You will pay: 3.32 USDT                  |
|  Price: $0.0332/KAS  (-0.3% vs market)   |
|                                           |
|  Pay with: [BNB] [ETH] [SOL] [TRON]      |
|  Your balance: 5.21 USDT (BNB)  OK       |
|                                           |
|  System will auto-pay from your wallet.   |
|                                           |
|            [Accept Offer]                 |
+-------------------------------------------+
```

- Chain selector updates balance display in real-time
- Insufficient balance: disable button + show warning
- After accept: section transforms into live status stepper
- **Mobile**: same layout, full-width, scroll to accept section

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
| `deal-timeline.eta` | Right pane | Vertical event timeline with expandable proof cards |
| `accept-inline.eta` | Right pane bottom | Inline accept with chain selection + balance check |

## 8. API Data Contract

| UI Zone | API Endpoint | Key Fields |
|---------|-------------|------------|
| Discovery bar | `GET /api/exchange/overview` | trades_24h, volume_24h_kas, kas_market_price, best_sell_price, best_buy_price, total_completed, avg_settlement_seconds |
| Offer list | `GET /api/exchange/offers` | offers[] with unit_price, price_vs_market, kas_market_price |
| Reputation badge | `GET /api/exchange/reputation/batch?addresses=a,b,c` | Map of address → { stars, risk, completed, disputed } |
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

## 10. Additional Decisions (Q6-Q9)

### Q6: Empty State

When 0 open offers exist:
- Show last completed trade prominently: "Last trade: 10 KAS settled in 2m 18s, 3 hours ago"
- Show total completed count from overview API
- CTA button: "Be the first to post an offer"
- If total_completed == 0 (brand new node): show network stats from Scout (nodes discovered, interactions)

### Q7: Real-time Updates

- **Active deal selected**: poll `/api/exchange/offers/:id` every 5 seconds
- **Idle browsing**: poll offer list every 30 seconds
- **Implementation**: Alpine.js `setInterval` with cleanup on pane change / tab switch
- **Global notification**: sidebar Exchange icon shows red dot when any local agent offer reaches `matched` status (lightweight 30s check against `/api/exchange/offers?maker=localAgent&status=matched`)

### Q8: Error States

Three-tier color system during failures:

| State | Color | Copy |
|-------|-------|------|
| Retry in progress (attempt 2/3) | Yellow pulse | "Verifying payment (attempt 2 of 3). Your funds are safe." |
| Final failure - payment | Red border | "Payment could not complete. Your USDT was not sent. [Retry] [Cancel]" |
| Final failure - verification | Red border | "Verification inconclusive. Dispute opened. Your funds are protected." |
| Timeout | Red border | "Buyer did not pay in 30 minutes. Your KAS has been released. [Relist]" |

Key principle: **red but reassuring.** The system is protecting you, not broken.

### Q9: Language

- English UI labels throughout
- Strings should be i18n-ready (centralizable, not hardcoded in HTML)
- market.eta (Chinese) is legacy; new pages use English
