# Free Market Trading System — Developer Documentation

> **Read this before touching trading code. 3 minutes prevents 90% of mistakes.**

---

## Fatal Traps (First 30 Seconds)

1. **Post-payment orders CANNOT be expired or cancelled.** `paid`, `verified`, `delivering` can only → `disputed`. If you add an `expired` transition from these states, you break fund protection. See `order-machine.js:28-41`.

2. **Source is hardcoded, never client-declared.** `trading.js /action` always sets `source='owner'`. Mind callback sets `source='agent'`. Ingest sets `source='peer'`. Don't trust any `source` from request body.

3. **fund_lock is idempotent.** Same `(order_id, asset)` returns existing lock. Don't check-then-lock — just call `lockFunds()`.

4. **Balance check happens at accept AND at execution.** Accept checks via `lockFunds(realBalance)`. `pay_usdt` re-checks on-chain USDT balance before sending. `send_kas` relies on Relay returning error if insufficient.

5. **Auto-verify runs 60s after pay_usdt.** It calls `/action` via localhost HTTP. If `process.env.PORT` differs from 3100, update the code — it now reads `process.env.PORT`.

6. **`force: true` bypasses state machine validation.** Used by `_syncCounterparty` (buyer/seller have different paths) and error recovery. Don't use casually.

7. **pay_usdt 失败回退 accepted 会触发 auto-advance 死循环。** `transition(accepted, force:true)` → `_autoAdvance` 看到 `accepted+buy` → 2s 后再次 `pay_usdt` → 再失败 → 无限循环。Circuit breaker 已加：1h 内同一订单 ≥3 次 `payment_failed` 则停止自动推进。见 `order-machine.js _autoAdvance`。

---

## Architecture Overview

```
                     ┌─────────────────────────────────────────┐
                     │              Order State Machine         │
                     │                                         │
  published ──→ accepted ──→ paying ──→ paid ──→ verified ──→ delivering ──→ completed
                  │                                  │              │
                  └──→ cancelled/expired             └──→ disputed ──→ escalated
                       (pre-payment only)                 │              ↓
                                                          └──→ resolved / cancelled
                     │                                         │
                     │  Three modes control WHO triggers:      │
                     │    auto:     system auto-advances       │
                     │    approval: system prepares, owner OKs │
                     │    manual:   owner does everything      │
                     └─────────────────────────────────────────┘

Each transition writes: mm_orders + execution_states + fund_locks + chain_events
```

---

## On-Chain Protocol (2026-03-27)

**Chain is source, DB is index.** Every trade lifecycle event broadcasts to Kaspa chain via Kasia bcast protocol.

### Design Principles

1. **KAS must be on one side** — KAS/X model. KAS side is chain-executable, X side is chain-verifiable. Protocol is self-consistent.
2. **Both parties' addresses on chain** — seller's recv + buyer's pay_from, for refund/dispute/risk evidence.
3. **One order = one channel** — channel name = orderId. Complete lifecycle in one place.
4. **Accepted orders can revert** — `accepted → published` on timeout. Next candidate auto-processes.
5. **Timeout = on-chain accountability** — `kanet_timeout_v1` permanently records who failed.
6. **Natural reputation** — scan any address across all order channels to get completion rate, timeouts, trade volume. No separate reputation score needed.

### Protocol Messages

| Type | Channel | Purpose |
|------|---------|---------|
| `kanet_sell_v1` | {orderId} | Publish sell order (amt, price, want, chain, recv) |
| `kanet_buy_v1` | {orderId} | Publish buy order (amt, price, pay, chain, pay_from) |
| `kanet_accept_v1` | {orderId} | Accept order (ref, counter_id, chain, kas_addr, pay_from) |
| `kanet_paid_v1` | {orderId} | Payment proof (chain, tx hash, amt, to) |
| `kanet_delivered_v1` | {orderId} | KAS delivery proof (tx hash, amt, to) |
| `kanet_cancel_v1` | {orderId} | Cancel order |
| `kanet_timeout_v1` | {orderId} | Timeout accountability (who, reason, at_status) |

All messages broadcast via Kaspa bcast TX. `sender_address` from TX signature — unforgeable.

### Filter (trade-protocol-filter.js)

Mounted at `broadcast_messages` INSERT points in chat.js. Routes `kanet_*` messages to existing services:

```
handleOrder    → createOrder() / backfill broadcast_txid
handleAccept   → checkLimits → transition(accepted) → lockFunds → createCounterparty
handlePaid     → transition(paid) → recordChainEvent
handleDelivered → transition(completed) → recordChainEvent
handleCancel   → transition(cancelled) → releaseFunds
handleTimeout  → transition(published) → releaseFunds → tryNextAccept
```

Fast-reject: `content.startsWith('{"t":"kanet_')` — nanosecond string check, no JSON parse for non-protocol messages.

### Data Flow

```
Publish: UI → /api/chat/send (bcast) → chain → Scout catches → ingest → filter → mm_orders
Accept:  UI → /api/chat/send (bcast to orderId channel) → chain → filter → transition + lockFunds
Paid:    trading.js pay_usdt success → fire-and-forget bcast kanet_paid_v1
Delivered: trading.js send_kas success → fire-and-forget bcast kanet_delivered_v1
Timeout: mind-manager interval → bcast kanet_timeout_v1 → filter reverts → tryNextAccept
```

### Known Limitation

After sending KAS (send_kas), the agent's UTXO may be depleted, causing `kanet_delivered_v1` broadcast to fail. Trade still completes — the KAS TX hash is recorded in mm_orders. Solution: UTXO pre-splitting or delayed retry.

---

## 10 Safety Bottom Lines

| # | Rule | Enforcement | File |
|---|------|------------|------|
| 1 | Limits before logic | `checkLimits()` called before `lockFunds()` in accept | trading.js:1664 |
| 2 | Lock before spend | `lockFunds()` with real balance (Relay KAS / chain USDT) | trading.js:1667-1695 |
| 3 | Every op through execution_states | `quickStart()` on every action | trading.js:1674,1764,1867,1921,2018 |
| 4 | Confirmations required | BNB≥15, ETH≥12, SOL≥32slots, TRON≥19 blocks | trading.js:1790,verify blocks |
| 5 | Post-payment never expires | `POST_PAYMENT_STATUSES` check in `expireTimedOut()` | order-machine.js:245-265 |
| 6 | Disputed has exits | resolved/cancelled/completed/escalated | order-machine.js:38-39 |
| 7 | Every TX in chain_events | Success + failure + verify + underpayment | trading.js (4 recordChainEvent calls) |
| 8 | Auto ≤ 30% of manual | `validateLimitConfig()` enforces | trade-limits.js:128-133 |
| 9 | Split timeout pre/post | Pre-payment→expired, post-payment→disputed | order-machine.js:253-261 |
| 10 | Legacy states cleaned | v29 migration, no quoted/awaiting_payment/payment_verified | migrate.js:1158-1165 |

---

## State Machine

### VALID_TRANSITIONS (order-machine.js)
```
published  → accepted, cancelled, expired
accepted   → paying, cancelled, expired
paying     → paid, accepted(revert), cancelled, expired
paid       → verified, disputed                    ← NO expired/cancelled
verified   → delivering, disputed                  ← NO expired/cancelled
delivering → completed, verified(revert), disputed ← NO expired/cancelled
completed  → (terminal)
cancelled  → (terminal)
expired    → (terminal)
disputed   → resolved, cancelled, completed, escalated
escalated  → resolved, cancelled
resolved   → (terminal)
```

### POST_PAYMENT_STATUSES
```javascript
const POST_PAYMENT_STATUSES = new Set(['paid', 'verified', 'delivering']);
```
`expireTimedOut()` checks this — post-payment timeout → `disputed`, not `expired`.

### Counterparty Sync Map
```
paid → paid, verified → verified, completed → completed
cancelled → cancelled, expired → expired, disputed → disputed
```
Sync uses `force: true` because buyer/seller paths differ (seller skips `paying`).

---

## Three Modes × Actions

| Action | auto | approval | manual |
|--------|------|----------|--------|
| accept (peer) | Limit check → lock → execute | Limit check → lock → pending | Pending for owner |
| accept (owner) | Execute | Execute | Execute |
| pay_usdt | Auto-trigger after accept (2s) | Pending → owner confirms | Owner clicks |
| verify_payment | Auto-verify (60s after pay) | Pending | Owner clicks |
| send_kas | Auto-trigger after verify (2s) | Pending → owner confirms | Owner clicks |
| cancel | Always allowed | Always allowed | Always allowed |

---

## Permission Gate (trade-action.js)

```
Source Restrictions:
  peer   → only 'accept' allowed
  system → only 'verify_payment', 'send_kas', 'cancel'
  owner  → always allowed (no mode check)
  agent  → goes through mode check (auto/approval/manual)

Mode Check:
  auto     → checkLimits() → if OK: allowed, if fail: rejected execution
  approval → create pending execution → wait owner confirm (15min pre / 60min post)
  manual   → agent denied, peer accept → pending
```

---

## Fund Locks (fund-lock.js)

```
Accept order → lockFunds(agentAddr, orderId, asset, amount, realBalance)
  ├─ Seller locks KAS
  └─ Buyer locks USDT

Completed/Resolved → spendFunds(orderId)     // lock status → 'spent'
Cancelled/Expired  → releaseFunds(orderId)    // lock status → 'released'

Available = walletBalance - SUM(locked)
```

---

## Chain Events (chain-event.js)

| When | eventType | Recorded |
|------|-----------|----------|
| Pay USDT success | payment (via transition txHash) | order-machine.js:146-155 |
| Pay USDT fail | payment_failed | trading.js catch block |
| Send KAS success | kas_delivery (via transition txHash) | order-machine.js:146-155 |
| Send KAS fail | kas_delivery_failed | trading.js catch block |
| Verify success | payment_verified | trading.js verify block |
| Underpayment | payment_underpayment | trading.js underpayment block |
| Verify fail (SOL/TRON) | verify_failed | trading.js catch blocks |

All use `INSERT OR IGNORE` — UNIQUE(txid, event_type) dedup.

---

## Dispute Escalation (mind-manager.js)

```
disputed + 15min → auto re-verify payment TX on chain
disputed + 30min → write dispute_alert event (owner notification)
disputed + 60min → transition to 'escalated' (frozen, manual only)
```

Exits from escalated: `resolved` or `cancelled` (human decision).

---

## Auto-Verify Chains

| Chain | Confirmations | USDT Address | Method |
|-------|--------------|--------------|--------|
| BNB | 15 blocks | 0x55d3...7955 | ethers.js Transfer event |
| ETH | 12 blocks | 0xdAC1...1ec7 | ethers.js Transfer event |
| SOL | 32 slots | Es9v...EnEPs | postTokenBalances delta |
| TRON | 19 blocks | TR7N...Lj6t | TRC20 Transfer topic |
| Other | — | — | Manual fallback |

---

## Wallet System (2026-03-27)

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/relay/:id/wallets` | GET | All wallets for agent (KAS + multi-chain), **real-time on-chain balances** |
| `/api/relay/:id/wallets` | POST | Create new wallet (bnb/eth/sol/tron) |
| `/api/relay/:id/wallets/:walletId/privkey` | GET | Decrypt and return private key |
| `/api/relay/:id/wallets/:walletId/balance` | GET | Single wallet balance check |
| `/api/trade/wallet-balance` | GET | Real-time chain query (USDT + native) by chain + address |
| `/api/trade/withdraw` | POST | Withdraw USDT or native token (EVM chains) |

### Balance Query

`getEvmBalances()` in relay.js queries USDT + native in parallel:
```
provider.getBalance(address)           → BNB/ETH native
contract.balanceOf(address)            → USDT (BSC-USD/Tether)
```
5s timeout per wallet. All wallets queried in parallel via `Promise.all`.

### Withdraw Flow (trading.js /api/trade/withdraw)

```
1. Validate: walletId, chain, to, amount, asset (usdt/native)
2. Decrypt private key from agent_wallets.privkey_encrypted
3. Create signer: ethers.Wallet(privateKey, provider)
4. If USDT: contract.transfer(to, amount) — check balance first
5. If native: signer.sendTransaction({ to, value })
6. Record chain_event (eventType='withdraw')
7. Return { ok, txHash }
```

### Multi-Wallet Support

Each agent can have **multiple wallets per chain** (e.g., 2 BNB wallets). The wallets API returns ALL of them. The market UI:
- Bottom bar: aggregates by chain (shows total USDT per chain + wallet count)
- Click to expand: shows each wallet with address, USDT, native gas, actions
- Per-wallet actions: copy address, withdraw, view private key, create new

---

## Order Pagination (2026-03-27)

`GET /api/trade/mm-orders` now supports:
```
?limit=20&offset=0&status=active&page=1
```

- `page=1` enables paginated response: `{ orders, total, limit, offset, hasMore }`
- Without `page` param: returns raw array (backward compatible with old trading.eta)
- `status=active` filters out terminal states (completed/cancelled/expired/resolved)
- Max limit: 200

---

## Market UI — /market (2026-03-27)

**Design: "Conversation as Trade"** — trade lifecycle embedded in a chat-like conversation flow.

### Layout
```
Header:  Agent selector + Mode toggle (手动/审批/自动) + LIVE indicator
Banner:  "不是请相信我们，是三层可验证"
Left:    Market orders (paginated) + Publish button
Right:   Deal workspace = Pipeline bar + Conversation flow + Chat input
Bottom:  Wallet bar (click to expand management panel)
```

### Conversation Flow

Unified timeline of 6 item types:
- `cp` (checkpoint): State transition divider lines with LED indicators
- `peer`: Counterparty messages (left-aligned bubbles)
- `agent`: My agent's messages + reasoning (right-aligned + italic reasoning)
- `owner`: My messages (right-aligned, highlighted)
- `sys`: System event cards (fund lock, verification, errors) with expandable proof
- `approval`: Pending approval card with countdown + confirm/reject

Built from `execution_states` table — each execution becomes timeline items grouped by checkpoint dividers.

### Key Files
```
kasia-console/src/ui/market.eta     — 650 lines (vs old trading.eta 2823 lines)
kasia-console/src/api/trading.js    — /market route + pagination + wallet-balance + withdraw APIs
kasia-console/src/api/relay.js      — getEvmBalances() + wallets API with usdtBalance/nativeBalance
```

---

## Peer Reputation System (2026-03-27 设计，实现中)

### 核心原则

**链上数据不会说谎。** 信誉不是分数，是事实陈列。

### 查询策略：DB 优先，链上兜底

```
接单 → 查 DB（毫秒级）
    有记录 → 直接出信誉报告
    无记录 → 触发 Relay 链上探查（异步）→ 写入 DB → 下次秒出
```

第一次查慢，之后永远快。Scout 发现新地址时提前触发探查。

### 信誉事实报告（非评分）

```
对手方: kaspa:qpjjv2uh...x2ktetp (Sophie)
├─ 身份: Agent Card 已声明（3 天前）
├─ 交易: 5 笔完成 / 0 争议 — 完成率 100%
├─ 规模: 累计 1,500 KAS / 平均 300 KAS/笔
├─ 关系: active，互动 223 次
├─ 风险: 🟢 低风险
```

### Auto 模式门槛（硬性拦截）

| 条件 | 处理 |
|------|------|
| 零交易 + 无 Card | 拒绝自动接单 |
| 有争议记录 | 拒绝自动接单 |
| 中等风险 | 限额减半 |
| 对手方也是 auto Agent | 🟢 加分（机器守约） |

### Relay 链上探查（待实现）

`probe_address` 命令 → Kaspa 节点查询：
- `getUtxosByAddresses` → 余额结构
- `getTransactionsByAddresses` → 历史 TX（数量/首笔时间/金额分布）
- Kasia 协议 payload 分析 → Card/握手/广播

### 两种成熟交易模式（终态设计）

| 模式 | 谁定价 | 谁执行 | Owner 角色 |
|------|--------|--------|-----------|
| 人类定价 | 人 | Agent 全自动 | 下单、设价、设限额 |
| Agent 自主 | Agent（五核驱动） | Agent 全自动 | 只设目标和边界 |

Agent 自主模式 = Intent(目标) + Perception(市场) + Evolution(反思) → Brain 做交易决策。**这是 KANet 机器原生经济的终态。**

### Key Files

```
kasia-console/src/services/reputation.js  — DB 层信誉评估（已建）
kasia-relay/src/ (TBD)                    — probe_address 链上探查
kasia-console/src/services/trade-action.js — auto 门槛接入
```

---

## Auto-Advance Circuit Breaker (2026-03-28)

`_autoAdvance()` in `order-machine.js` triggers the next step after each state transition. **Death loop risk**: if `pay_usdt` fails (e.g., no BNB gas), order reverts to `accepted`, which triggers `_autoAdvance` again → infinite retry every 2 seconds.

**Fix**: Circuit breaker checks `chain_events` for recent `payment_failed` events:
```
if payment_failed >= 3 in last 1 hour for this order → STOP auto-advance
```

This was a real incident: Sophie's order `2e34c301` had 38 consecutive `payment_failed` events (insufficient BNB gas), all 3 seconds apart.

---

## Known Limitations

1. **Kaspa script hard lock** — fund_locks is DB-level "soft lock". Kaspa script (HTLC) maturity enables on-chain hard lock.
2. **SOL/TRON pay_usdt** — only verify implemented, not send. Sending USDT on SOL/TRON requires additional wallet integration.
3. **SOL/TRON withdraw** — not yet implemented (EVM only). Needs @solana/web3.js transfer + tronweb.trx.sendTransaction.
4. **Concurrent action protection** — no mutex on `/action` endpoint. Two simultaneous calls for same order could race.
5. **Dispute automation** — 15min re-verify is best-effort (RPC may fail). 30min/60min alerts are event-based (not push notification).
6. **USDC support** — only USDT implemented. USDC contracts need to be added per chain.
7. **TRON balance query** — tronweb initialization sometimes fails silently, returning null balances.

---

## File Reference

| File | Lines | Purpose |
|------|-------|---------|
| order-machine.js | ~350 | State machine, transitions, counterparty sync, auto-advance |
| trade-action.js | ~300 | Permission gate, mode checking, triggerNextStep |
| execution-state.js | ~185 | Execution tracking, quickStart, status transitions |
| fund-lock.js | ~128 | Lock/release/spend, available balance |
| trade-limits.js | ~143 | Three-tier limits, config validation |
| chain-event.js | ~51 | Immutable chain fact recording |
| trading.js | ~2500 | Routes: /market, /action, /publish, /withdraw, /wallet-balance, pagination |
| relay.js (wallets) | ~200 | Wallet CRUD, getEvmBalances, privkey decrypt |
| market.eta | ~650 | Market UI v2 (conversation-as-trade) |
| mind-manager.js | ~30 | Approval timeout + dispute escalation |
