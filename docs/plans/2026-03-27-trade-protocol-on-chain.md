# Trade Protocol On-Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every trade lifecycle event broadcast to Kaspa chain. DB becomes index of chain data, not source of truth.

**Architecture:** New `trade-protocol-filter.js` bridges chain broadcasts to existing services (order-machine, fund-lock, execution-state, chain-event). Filter is mounted at the two `broadcast_messages` INSERT points in `chat.js`. UI (`market.eta`) calls `/api/chat/send` to broadcast protocol messages instead of directly calling trade APIs. `trading.js` appends broadcasts after successful pay/deliver operations.

**Tech Stack:** Node.js ESM, better-sqlite3, Kaspa bcast (existing `sendBroadcast()`), existing order-machine/fund-lock/execution-state/chain-event services.

**Spec:** `D:\Anthropic\docs\trade-protocol-on-chain-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `kasia-console/src/services/trade-protocol-filter.js` | **Create** | Parse `kanet_*` broadcasts → call existing services |
| `kasia-console/src/api/chat.js` | Modify | Mount filter at two INSERT points |
| `kasia-console/src/services/order-machine.js` | Modify | Add `accepted → published` revert + `published` to TIMESTAMP_FIELDS |
| `kasia-console/src/ui/market.eta` | Modify | publishOrder → broadcast; doAction(accept) → broadcast |
| `kasia-console/src/api/trading.js` | Modify | Append ks_paid/ks_delivered broadcasts after success |
| `kasia-console/src/services/mind-manager.js` | Modify | Timeout → broadcast `kanet_timeout_v1` + revert |

---

### Task 1: Order Machine — Add Revert Path

**Files:**
- Modify: `kasia-console/src/services/order-machine.js:28-58`

- [ ] **Step 1: Add `published` to accepted transitions**

In `order-machine.js`, change line 30:
```javascript
// Before:
accepted:           ['paying', 'cancelled', 'expired'],

// After:
accepted:           ['paying', 'published', 'cancelled', 'expired'],
```

Also add `published` to TIMESTAMP_FIELDS (revert clears accepted_at):
```javascript
// Add after line 57:
// In transition(), when newStatus === 'published' (revert), clear accepted_at
```

Actually, the revert should clear timestamps. Add handling in `transition()` after the timestamp assignment block (after line 117):

```javascript
  // Clear timestamps on revert to published
  if (newStatus === 'published') {
    updates.push('accepted_at = NULL');
    updates.push('peer_address = NULL');
    updates.push('counterparty_order_id = NULL');
  }
```

And add fund release on revert:
```javascript
  // In the fund_locks section (line 142-146), add:
  } else if (newStatus === 'published') {
    releaseFunds(orderId);
  }
```

- [ ] **Step 2: Verify the changes compile**

Run: `cd D:/Anthropic/kasia-console && node -e "import './src/services/order-machine.js'; console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Test revert path**

```bash
cd D:/Anthropic/kasia-console && node -e "
import { createOrder, transition, getOrder } from './src/services/order-machine.js';
const o = createOrder({ agentAddress: 'test_revert', side: 'sell', kasAmount: 10, price: 0.04, chain: 'bnb' });
console.log('created:', o.id.slice(0,8), 'status:', getOrder(o.id).status);
transition(o.id, 'accepted');
console.log('accepted:', getOrder(o.id).status);
const r = transition(o.id, 'published', { reason: 'timeout revert' });
console.log('reverted:', r.ok, getOrder(o.id).status, 'accepted_at:', getOrder(o.id).accepted_at);
// cleanup
import { sqlite } from './src/db/client.js';
sqlite.prepare('DELETE FROM mm_orders WHERE agent_address = ?').run('test_revert');
console.log('cleanup OK');
"
```
Expected: `created: ... status: published`, `accepted: accepted`, `reverted: true published accepted_at: null`

- [ ] **Step 4: Commit**

```bash
git add kasia-console/src/services/order-machine.js
git commit -m "feat(order-machine): add accepted→published revert path for trade protocol

When an acceptor times out or fails conditions, the order reverts to published
instead of going to a terminal state. This enables the next candidate accept
from the chain to be processed.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Trade Protocol Filter — Core

**Files:**
- Create: `kasia-console/src/services/trade-protocol-filter.js`

- [ ] **Step 1: Create the filter module**

```javascript
/**
 * Trade Protocol Filter
 *
 * Bridge between on-chain protocol broadcasts and existing trade services.
 * Mounted at broadcast_messages INSERT points in chat.js.
 *
 * Chain is source of truth. This filter turns chain events into local index operations.
 * All business logic uses existing services — this file only routes.
 */

import { sqlite } from '../db/client.js';
import { createOrder, transition, getOrder, linkOrders } from './order-machine.js';
import { lockFunds, releaseFunds } from './fund-lock.js';
import { quickStart } from './execution-state.js';
import { recordChainEvent } from './chain-event.js';
import { checkLimits } from './trade-limits.js';

/**
 * Called after every broadcast_messages INSERT.
 * Fast-rejects non-protocol messages via string prefix check.
 *
 * @param {object} row - { tx_hash, content, sender_address, channel_name, created_at }
 */
export async function onBroadcastWritten(row) {
  if (!row.content || !row.content.startsWith('{"t":"kanet_')) return;

  let msg;
  try {
    msg = JSON.parse(row.content);
  } catch {
    return; // malformed JSON, skip
  }

  // Attach chain metadata
  msg._tx = row.tx_hash;
  msg._from = row.sender_address;
  msg._channel = row.channel_name;
  msg._at = row.created_at;

  try {
    switch (msg.t) {
      case 'kanet_sell_v1':
      case 'kanet_buy_v1':
        await handleOrder(msg); break;
      case 'kanet_accept_v1':
        await handleAccept(msg); break;
      case 'kanet_paid_v1':
        await handlePaid(msg); break;
      case 'kanet_delivered_v1':
        await handleDelivered(msg); break;
      case 'kanet_cancel_v1':
        await handleCancel(msg); break;
      case 'kanet_timeout_v1':
        await handleTimeout(msg); break;
    }
  } catch (err) {
    console.error(`[trade-filter] Error processing ${msg.t}: ${err.message}`);
  }
}

// ── Handlers ──────────────────────────────────────────────────

async function handleOrder(msg) {
  const orderId = msg.id;
  if (!orderId) return;

  // Check if order already exists locally (we published it ourselves)
  const existing = sqlite.prepare('SELECT id, broadcast_txid FROM mm_orders WHERE id = ?').get(orderId);

  if (existing) {
    // Local order — backfill chain anchor if missing
    if (!existing.broadcast_txid && msg._tx) {
      sqlite.prepare('UPDATE mm_orders SET broadcast_txid = ? WHERE id = ?').run(msg._tx, orderId);
      console.log(`[trade-filter] Backfilled broadcast_txid for ${orderId.slice(0, 8)}`);
    }
    return;
  }

  // Remote order — create local index
  const side = msg.t === 'kanet_sell_v1' ? 'sell' : 'buy';
  const relayNodeId = _findLocalRelay(msg._from);

  createOrder({
    id: orderId,
    relayNodeId: relayNodeId || null,
    agentAddress: msg._from,
    side,
    kasAmount: msg.amt || 0,
    price: msg.price || 0,
    chain: msg.chain || 'bnb',
    broadcastTxid: msg._tx,
  });

  // Fill addresses
  const updates = [];
  const vals = [];
  if (side === 'sell' && msg.recv) {
    updates.push('mm_receive_address = ?');
    vals.push(msg.recv);
  }
  if (side === 'buy' && msg.pay_from) {
    updates.push('customer_pay_address = ?');
    vals.push(msg.pay_from);
  }
  if (updates.length) {
    vals.push(orderId);
    sqlite.prepare(`UPDATE mm_orders SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
  }

  console.log(`[trade-filter] Remote order indexed: ${orderId.slice(0, 8)} ${side} ${msg.amt} KAS @ ${msg.price}`);
}

async function handleAccept(msg) {
  const orderId = msg.ref;
  if (!orderId) return;

  const order = getOrder(orderId);
  if (!order) {
    console.log(`[trade-filter] Accept for unknown order ${orderId.slice(0, 8)}, skipping`);
    return;
  }

  if (order.status !== 'published') {
    console.log(`[trade-filter] Accept for ${orderId.slice(0, 8)} but status=${order.status}, keeping as candidate`);
    return; // Order already accepted — this accept stays on chain as candidate
  }

  // Limit check
  const usdtAmt = order.kas_amount * (order.price || 0);
  const limitCheck = checkLimits(msg._from, order.kas_amount, usdtAmt, order.mode || 'manual');
  if (!limitCheck.ok) {
    console.log(`[trade-filter] Accept rejected for ${orderId.slice(0, 8)}: ${limitCheck.error}`);
    return; // Conditions not met, order stays published for next candidate
  }

  // Transition
  const result = transition(orderId, 'accepted', { txHash: msg._tx });
  if (!result.ok) {
    console.log(`[trade-filter] Accept transition failed: ${result.error}`);
    return;
  }

  // Update peer address
  sqlite.prepare('UPDATE mm_orders SET peer_address = ? WHERE id = ?').run(msg._from, orderId);
  if (msg.kas_addr) {
    sqlite.prepare('UPDATE mm_orders SET customer_address = ? WHERE id = ?').run(msg.kas_addr, orderId);
  }

  // Execution tracking
  quickStart({
    type: 'accept_order',
    source: 'peer',
    agentAddress: order.agent_address,
    orderId,
  });

  // Create counterparty order if counter_id provided
  if (msg.counter_id) {
    const counterSide = order.side === 'sell' ? 'buy' : 'sell';
    const relayNodeId = _findLocalRelay(msg._from);

    createOrder({
      id: msg.counter_id,
      relayNodeId: relayNodeId || null,
      agentAddress: msg._from,
      side: counterSide,
      kasAmount: order.kas_amount,
      price: order.price,
      chain: msg.chain || order.chain || 'bnb',
      peerAddress: order.agent_address,
      counterpartyOrderId: orderId,
      broadcastTxid: msg._tx,
    });

    // Fill pay_from on buyer's order
    if (msg.pay_from) {
      const buyerId = counterSide === 'buy' ? msg.counter_id : orderId;
      sqlite.prepare('UPDATE mm_orders SET customer_pay_address = ? WHERE id = ?').run(msg.pay_from, buyerId);
    }

    linkOrders(orderId, msg.counter_id);

    // Accept counterparty order too
    transition(msg.counter_id, 'accepted', { txHash: msg._tx, force: true });
    quickStart({
      type: 'accept_order',
      source: 'peer',
      agentAddress: msg._from,
      orderId: msg.counter_id,
    });
  }

  console.log(`[trade-filter] Accept: ${orderId.slice(0, 8)} by ${msg._from.slice(-12)}`);
}

async function handlePaid(msg) {
  const orderId = msg.id;
  if (!orderId || !msg.tx) return;

  const order = getOrder(orderId);
  if (!order) return;

  // Only process if not already paid
  if (['paid', 'verified', 'delivering', 'completed'].includes(order.status)) return;

  transition(orderId, 'paid', { txHash: msg.tx });

  recordChainEvent({
    txid: msg.tx,
    eventType: 'payment',
    fromAddress: msg._from,
    toAddress: msg.to,
    amount: msg.amt,
    observedBy: 'protocol',
    payload: { orderId, chain: msg.chain },
  });

  console.log(`[trade-filter] Paid: ${orderId.slice(0, 8)} TX=${msg.tx.slice(0, 16)}`);
}

async function handleDelivered(msg) {
  const orderId = msg.id;
  if (!orderId || !msg.tx) return;

  const order = getOrder(orderId);
  if (!order) return;

  if (order.status === 'completed') return;

  transition(orderId, 'completed', { txHash: msg.tx });

  recordChainEvent({
    txid: msg.tx,
    eventType: 'kas_delivery',
    fromAddress: msg._from,
    toAddress: msg.to,
    amount: msg.amt,
    observedBy: 'protocol',
    payload: { orderId },
  });

  console.log(`[trade-filter] Delivered: ${orderId.slice(0, 8)} TX=${msg.tx.slice(0, 16)}`);
}

async function handleCancel(msg) {
  const orderId = msg.id;
  if (!orderId) return;

  const order = getOrder(orderId);
  if (!order) return;

  // Only the publisher can cancel their own order
  if (order.agent_address !== msg._from) {
    console.log(`[trade-filter] Cancel rejected: sender ${msg._from.slice(-12)} is not the publisher`);
    return;
  }

  const result = transition(orderId, 'cancelled', {
    reason: msg.reason || 'Cancelled via protocol broadcast',
  });
  if (result.ok) {
    releaseFunds(orderId);
    console.log(`[trade-filter] Cancelled: ${orderId.slice(0, 8)}`);
  }
}

async function handleTimeout(msg) {
  const orderId = msg.id;
  if (!orderId) return;

  const order = getOrder(orderId);
  if (!order) return;

  // Revert to published
  transition(orderId, 'published', {
    reason: `Timeout: ${msg.reason} (${msg.who})`,
    force: true,
  });
  releaseFunds(orderId);

  console.log(`[trade-filter] Timeout revert: ${orderId.slice(0, 8)} → published (was: ${msg.at_status})`);

  // Try next accept candidate from chain
  await tryNextAccept(orderId);
}

/**
 * After a timeout revert, scan the order's channel for other kanet_accept_v1
 * messages that weren't processed (because the order was already accepted).
 */
async function tryNextAccept(orderId) {
  const order = getOrder(orderId);
  if (!order || order.status !== 'published') return;

  // Find all accept broadcasts in this order's channel
  const accepts = sqlite.prepare(`
    SELECT * FROM broadcast_messages
    WHERE channel_name = ?
      AND content LIKE '%"t":"kanet_accept_v1"%'
    ORDER BY created_at ASC
  `).all(orderId);

  // Find timed-out addresses (skip them)
  const timedOut = new Set();
  const timeouts = sqlite.prepare(`
    SELECT content FROM broadcast_messages
    WHERE channel_name = ?
      AND content LIKE '%"t":"kanet_timeout_v1"%'
  `).all(orderId);
  for (const t of timeouts) {
    try {
      const p = JSON.parse(t.content);
      if (p.who) timedOut.add(p.who);
    } catch {}
  }

  for (const row of accepts) {
    if (timedOut.has(row.sender_address)) continue;

    // Try this candidate
    const msg = JSON.parse(row.content);
    msg._tx = row.tx_hash;
    msg._from = row.sender_address;
    msg._channel = row.channel_name;
    msg._at = row.created_at;

    await handleAccept(msg);

    // Check if it worked
    const updated = getOrder(orderId);
    if (updated && updated.status === 'accepted') {
      console.log(`[trade-filter] Next candidate accepted: ${row.sender_address.slice(-12)}`);
      break;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Check if a KAS address belongs to a local relay node.
 */
function _findLocalRelay(kasAddress) {
  const relay = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(kasAddress);
  return relay?.id || null;
}
```

- [ ] **Step 2: Verify the module loads**

Run: `cd D:/Anthropic/kasia-console && node -e "import './src/services/trade-protocol-filter.js'; console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add kasia-console/src/services/trade-protocol-filter.js
git commit -m "feat: add trade protocol filter — chain broadcasts → existing services

Bridge between on-chain kanet_* protocol messages and existing trade
infrastructure (order-machine, fund-lock, execution-state, chain-event).
Handles: sell/buy/accept/paid/delivered/cancel/timeout.
Includes tryNextAccept for automatic candidate rotation after timeout.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Mount Filter in chat.js

**Files:**
- Modify: `kasia-console/src/api/chat.js:1,77-80,190-195`

- [ ] **Step 1: Add import at top of chat.js**

After line 8, add:
```javascript
import { onBroadcastWritten } from '../services/trade-protocol-filter.js';
```

- [ ] **Step 2: Mount filter after /api/chat/send INSERT (line 80)**

After the INSERT statement at line 80, before the auto-reply logic, add:
```javascript
      // ── Trade protocol filter (new pipeline, does not replace Chat) ──
      try {
        await onBroadcastWritten({ tx_hash: result.txId, content, sender_address: senderAddress, channel_name: channelName, created_at: now });
      } catch (err) {
        console.error('[trade-filter] Error in send path:', err.message);
      }
```

- [ ] **Step 3: Mount filter after /api/chat/ingest INSERT (line 195)**

After the INSERT statement at line 195, before the auto-reply logic, add:
```javascript
    // ── Trade protocol filter (new pipeline, does not replace Chat) ──
    try {
      await onBroadcastWritten({ tx_hash: txHash, content, sender_address: senderAddress, channel_name: channelName, created_at: now });
    } catch (err) {
      console.error('[trade-filter] Error in ingest path:', err.message);
    }
```

- [ ] **Step 4: Verify the server starts**

Run: `cd D:/Anthropic && bash kanet-start.sh` (or manually start console)
Check: No crash on startup, filter import loads cleanly.

- [ ] **Step 5: Commit**

```bash
git add kasia-console/src/api/chat.js
git commit -m "feat(chat): mount trade protocol filter at broadcast INSERT points

Filter runs after every broadcast_messages INSERT — both from local
/api/chat/send and remote /api/chat/ingest. Does not affect existing
Chat auto-reply logic. Error-isolated with try/catch.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: market.eta — Publish via Broadcast

**Files:**
- Modify: `kasia-console/src/ui/market.eta:865-875`

- [ ] **Step 1: Rewrite publishOrder() to broadcast first**

Replace the current `publishOrder()` (lines 865-875) with:

```javascript
    async publishOrder() {
      try {
        const f = this.pubForm;
        const orderId = crypto.randomUUID().slice(0, 8) + crypto.randomUUID().slice(0, 8).replace(/-/g, '');
        const side = f.side;
        const amt = parseFloat(f.amount);
        const price = parseFloat(f.price);
        if (!amt || !price) { alert('请填写数量和价格'); return; }

        // Get agent's cross-chain wallet address for recv/pay_from
        const walletRes = await fetch('/api/relay/' + this.agentId + '/wallets').then(r => r.json());
        const chainWallet = (walletRes.wallets || walletRes || []).find(w => w.chain === f.chain);

        // Build protocol message
        const payload = side === 'sell'
          ? { t: 'kanet_sell_v1', v: 1, id: orderId, amt, price, want: 'USDT', chain: f.chain, recv: chainWallet?.address || '' }
          : { t: 'kanet_buy_v1', v: 1, id: orderId, amt, price, pay: 'USDT', chain: f.chain, pay_from: chainWallet?.address || '' };

        // Broadcast to chain (channel = orderId)
        const bcastRes = await fetch('/api/chat/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relayId: this.agentId, channel: orderId, message: JSON.stringify(payload) }),
        });
        const bcastData = await bcastRes.json();
        if (!bcastData.ok) { alert('广播失败: ' + (bcastData.error || '')); return; }

        // Optimistic: show "on-chain" immediately
        this.showPublish = false;

        // Poll for filter to index the order (max 3s)
        let found = false;
        for (let i = 0; i < 6; i++) {
          await new Promise(r => setTimeout(r, 500));
          const check = await fetch('/api/trade/mm-orders?broadcast_txid=' + bcastData.txId).then(r => r.json());
          const orders = Array.isArray(check) ? check : (check.orders || []);
          if (orders.length > 0) { found = true; break; }
        }
        if (!found) {
          alert('已上链 ✅ 索引同步中，请稍后刷新');
        }
        await this.loadOrders();
      } catch (err) { alert('发布失败: ' + err.message); }
    },
```

- [ ] **Step 2: Add broadcast_txid query support to trading.js**

In `trading.js`, find the `GET /api/trade/mm-orders` endpoint and add broadcast_txid filter support. Find the existing query and add:

```javascript
    // Add after existing query parameter handling:
    const { broadcast_txid } = request.query;
    if (broadcast_txid) {
      // Quick lookup by chain anchor
      const order = sqlite.prepare('SELECT * FROM mm_orders WHERE broadcast_txid = ?').get(broadcast_txid);
      return reply.send(order ? [order] : []);
    }
```

- [ ] **Step 3: Test publish flow manually**

1. Start system: `bash D:/Anthropic/kanet-start.sh`
2. Open `http://localhost:3100/market`
3. Click publish, enter amount + price
4. Submit — should see broadcast TX succeed
5. Check: `broadcast_messages` has the `kanet_sell_v1` message
6. Check: `mm_orders` has the order with `broadcast_txid` filled

- [ ] **Step 4: Commit**

```bash
git add kasia-console/src/ui/market.eta kasia-console/src/api/trading.js
git commit -m "feat(market): publish orders via chain broadcast

publishOrder() now broadcasts kanet_sell_v1/kanet_buy_v1 to Kaspa chain
first, then polls for filter to index the order. Includes optimistic
rendering with 3s polling fallback.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: market.eta — Accept via Broadcast

**Files:**
- Modify: `kasia-console/src/ui/market.eta:771-829`

- [ ] **Step 1: Rewrite accept flow to broadcast kanet_accept_v1**

Replace the accept block in `doAction()` (lines 771-829) with:

```javascript
      // ── Accept: broadcast kanet_accept_v1 to order's channel ──
      if (action === 'accept') {
        const order = this.deal;
        const myRelayId = this.agentId;
        const myAddr = this.agentAddr;

        if (order.relay_node_id === myRelayId) {
          // Own order — direct action (unusual case)
          return this._doActionRaw(order.id, 'accept');
        }

        try {
          const counterSide = order.side === 'sell' ? 'buy' : 'sell';
          const counterId = crypto.randomUUID();

          // Get my cross-chain wallet for pay_from
          const walletRes = await fetch('/api/relay/' + myRelayId + '/wallets').then(r => r.json());
          const chainWallet = (walletRes.wallets || walletRes || []).find(w => w.chain === (order.chain || 'bnb'));

          // Build accept protocol message
          const acceptPayload = {
            t: 'kanet_accept_v1',
            v: 1,
            ref: order.id,
            counter_id: counterId,
            chain: order.chain || 'bnb',
            pay_from: counterSide === 'buy' ? (chainWallet?.address || '') : undefined,
            kas_addr: myAddr,
          };

          // Broadcast to order's channel
          const bcastRes = await fetch('/api/chat/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ relayId: myRelayId, channel: order.id, message: JSON.stringify(acceptPayload) }),
          });
          const bcastData = await bcastRes.json();
          if (!bcastData.ok) { alert('广播失败: ' + (bcastData.error || '')); return; }

          // Poll for filter to process the accept
          let accepted = false;
          for (let i = 0; i < 6; i++) {
            await new Promise(r => setTimeout(r, 500));
            const check = await fetch('/api/trade/mm-orders?broadcast_txid=' + bcastData.txId).then(r => r.json());
            const orders = Array.isArray(check) ? check : (check.orders || []);
            if (orders.length > 0) { accepted = true; break; }
          }

          if (!accepted) {
            alert('已上链 ✅ 索引同步中，请稍后刷新');
          }

          // Switch to my counter-order view
          await this.loadOrders();
          const myOrder = this.orders.find(o => o.id === counterId);
          if (myOrder) {
            this.deal = myOrder;
            await this.loadDealFlow(counterId);
          }
          return;
        } catch (err) {
          alert('接单失败: ' + err.message);
          return;
        }
      }
```

- [ ] **Step 2: Test accept flow**

1. Publish an order with Agent A
2. Switch to Agent B
3. Click accept on Agent A's order
4. Verify: broadcast_messages has kanet_accept_v1 in the order's channel
5. Verify: both mm_orders updated to accepted with counterparty links
6. Verify: fund_locks created

- [ ] **Step 3: Commit**

```bash
git add kasia-console/src/ui/market.eta
git commit -m "feat(market): accept orders via chain broadcast

doAction('accept') now broadcasts kanet_accept_v1 to the order's channel
instead of directly calling /api/trade/action. Filter processes the
broadcast and handles order creation, linking, and fund locking.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: trading.js — Broadcast Paid & Delivered

**Files:**
- Modify: `kasia-console/src/api/trading.js:2300-2303,2220-2221`

- [ ] **Step 1: Add broadcast after pay_usdt success**

After line 2303 (the `transition(id, 'paid', { txHash: tx.hash })` call), add:

```javascript
        // ── Broadcast payment proof to order's chain channel ──
        try {
          const { sendBroadcast } = await import('../services/bcast-sender.js');
          const { getRelayMnemonic } = await import('../data/settings/relay-nodes.js');
          const relay = sqlite.prepare('SELECT * FROM relay_nodes WHERE id = ?').get(order.relay_node_id);
          const mnemonic = getRelayMnemonic(order.relay_node_id);
          if (relay && mnemonic) {
            const paidMsg = JSON.stringify({
              t: 'kanet_paid_v1', v: 1, id: order.id,
              chain, tx: tx.hash, amt: usdtAmount, to: sellerAddr,
            });
            sendBroadcast(mnemonic, relay.network, order.id, paidMsg).then(r => {
              console.log(`[trade] Broadcast kanet_paid_v1 to channel ${order.id.slice(0, 8)} TX=${r.txId.slice(0, 16)}`);
            }).catch(err => {
              console.error(`[trade] Failed to broadcast kanet_paid_v1: ${err.message}`);
            });
          }
        } catch (err) {
          console.error(`[trade] kanet_paid_v1 broadcast error: ${err.message}`);
        }
```

- [ ] **Step 2: Add broadcast after send_kas success**

After line 2221 (the `transition(id, 'completed', { txHash: result.txId })` call), add:

```javascript
        // ── Broadcast delivery proof to order's chain channel ──
        try {
          const { sendBroadcast } = await import('../services/bcast-sender.js');
          const { getRelayMnemonic } = await import('../data/settings/relay-nodes.js');
          const relay = sqlite.prepare('SELECT * FROM relay_nodes WHERE id = ?').get(order.relay_node_id);
          const mnemonic = getRelayMnemonic(order.relay_node_id);
          if (relay && mnemonic) {
            const deliveredMsg = JSON.stringify({
              t: 'kanet_delivered_v1', v: 1, id: order.id,
              tx: result.txId, amt: order.kas_amount, to: targetAddr,
            });
            sendBroadcast(mnemonic, relay.network, order.id, deliveredMsg).then(r => {
              console.log(`[trade] Broadcast kanet_delivered_v1 to channel ${order.id.slice(0, 8)} TX=${r.txId.slice(0, 16)}`);
            }).catch(err => {
              console.error(`[trade] Failed to broadcast kanet_delivered_v1: ${err.message}`);
            });
          }
        } catch (err) {
          console.error(`[trade] kanet_delivered_v1 broadcast error: ${err.message}`);
        }
```

- [ ] **Step 3: Commit**

```bash
git add kasia-console/src/api/trading.js
git commit -m "feat(trading): broadcast payment and delivery proofs to chain

After successful pay_usdt, broadcasts kanet_paid_v1 with TX hash to the
order's channel. After successful send_kas, broadcasts kanet_delivered_v1.
Both are fire-and-forget (don't block the trade response).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: mind-manager.js — Timeout Broadcasts

**Files:**
- Modify: `kasia-console/src/services/mind-manager.js:729-750`

- [ ] **Step 1: Add timeout broadcast before expiry**

In the order timeout monitor (around line 731-250 in mind-manager.js), modify the `expireTimedOut()` call area to also broadcast `kanet_timeout_v1` for accepted orders that timeout:

After the `expireTimedOut()` call (line 732), add:

```javascript
      // ── Broadcast kanet_timeout_v1 for accepted orders that timed out ──
      // expireTimedOut() handles expired/disputed transitions, but we also need
      // to broadcast accountability and revert accepted orders to published
      const acceptedTimedOut = sqlite.prepare(
        "SELECT * FROM mm_orders WHERE status = 'accepted' AND timeout_minutes > 0 AND accepted_at IS NOT NULL"
      ).all();
      for (const order of acceptedTimedOut) {
        const elapsedMin = (Date.now() - new Date(order.accepted_at).getTime()) / 60000;
        if (elapsedMin < order.timeout_minutes) continue;

        // Broadcast timeout accountability
        try {
          const { sendBroadcast } = await import('./bcast-sender.js');
          const { getRelayMnemonic } = await import('../data/settings/relay-nodes.js');
          const relay = sqlite.prepare('SELECT * FROM relay_nodes WHERE id = ?').get(order.relay_node_id);
          const mnemonic = getRelayMnemonic(order.relay_node_id);
          if (relay && mnemonic) {
            const timeoutMsg = JSON.stringify({
              t: 'kanet_timeout_v1', v: 1, id: order.id,
              who: order.peer_address || 'unknown',
              reason: `payment_timeout_${order.timeout_minutes}min`,
              at_status: 'accepted',
            });
            await sendBroadcast(mnemonic, relay.network, order.id, timeoutMsg);
            console.log(`[timeout] Broadcast kanet_timeout_v1 for ${order.id.slice(0, 8)}`);
          }
        } catch (err) {
          console.error(`[timeout] Failed to broadcast timeout for ${order.id.slice(0, 8)}: ${err.message}`);
          // Fallback: still revert locally even if broadcast fails
          transition(order.id, 'published', { reason: `Timeout: payment_timeout_${order.timeout_minutes}min`, force: true });
          const { releaseFunds } = await import('./fund-lock.js');
          releaseFunds(order.id);
        }
      }
```

Note: The broadcast will be picked up by the filter's `handleTimeout()`, which does the revert + tryNextAccept. If broadcast fails, we fallback to local revert.

- [ ] **Step 2: Commit**

```bash
git add kasia-console/src/services/mind-manager.js
git commit -m "feat(mind-manager): broadcast kanet_timeout_v1 on accepted order timeout

When an accepted order times out (acceptor didn't pay), broadcasts
accountability record to the order's chain channel. Filter handles
revert to published and tries next candidate accept.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: End-to-End Test — Full Chain Flow

**Files:** None (testing only)

- [ ] **Step 1: Start system**

```bash
bash D:/Anthropic/kanet-start.sh
```

- [ ] **Step 2: Test publish on chain**

Open `http://localhost:3100/market`, publish a sell order with Sophie.
Verify:
```bash
cd D:/Anthropic/kasia-console && node -e "
import Database from 'better-sqlite3';
const db = new Database('./data/console.db');

// Check broadcast_messages for kanet_sell_v1
const bcasts = db.prepare(\"SELECT channel_name, content, tx_hash FROM broadcast_messages WHERE content LIKE '%kanet_sell_v1%' ORDER BY created_at DESC LIMIT 3\").all();
console.log('=== kanet_sell_v1 broadcasts ===');
bcasts.forEach(b => console.log(b.channel_name, b.tx_hash?.slice(0,16), b.content.slice(0,80)));

// Check mm_orders has broadcast_txid
const orders = db.prepare('SELECT id, side, status, broadcast_txid FROM mm_orders WHERE broadcast_txid IS NOT NULL ORDER BY created_at DESC LIMIT 3').all();
console.log('\n=== Orders with chain anchor ===');
orders.forEach(o => console.log(o.id.slice(0,8), o.side, o.status, 'txid:', o.broadcast_txid?.slice(0,16)));
"
```
Expected: kanet_sell_v1 in broadcast_messages, mm_order with broadcast_txid.

- [ ] **Step 3: Test accept on chain**

Switch to Martin, accept Sophie's order.
Verify: kanet_accept_v1 in broadcast_messages with channel = orderId.
Verify: Both orders accepted, counterparty linked.

- [ ] **Step 4: Test pay + deliver on chain**

Execute pay_usdt, then send_kas.
Verify: kanet_paid_v1 and kanet_delivered_v1 in broadcast_messages.
Verify: Order channel has complete lifecycle.

```bash
cd D:/Anthropic/kasia-console && node -e "
import Database from 'better-sqlite3';
const db = new Database('./data/console.db');

// Find a completed order and check its channel
const order = db.prepare(\"SELECT id FROM mm_orders WHERE status = 'completed' AND broadcast_txid IS NOT NULL ORDER BY created_at DESC LIMIT 1\").get();
if (order) {
  const msgs = db.prepare('SELECT content, tx_hash, created_at FROM broadcast_messages WHERE channel_name = ? ORDER BY created_at').all(order.id);
  console.log('Channel', order.id.slice(0,8), ':', msgs.length, 'messages');
  msgs.forEach(m => {
    try { const p = JSON.parse(m.content); console.log(' ', p.t, m.tx_hash?.slice(0,16)); } catch { console.log('  (non-protocol)', m.content.slice(0,40)); }
  });
} else {
  console.log('No completed orders with broadcast_txid yet');
}
"
```
Expected: Channel has kanet_sell_v1 → kanet_accept_v1 → kanet_paid_v1 → kanet_delivered_v1.

- [ ] **Step 5: Verify on Kaspa explorer**

Take the tx_hash values and verify they exist on the Kaspa blockchain.
Each protocol message is a real on-chain TX.

---

### Task 9: Update dev-trading.md

**Files:**
- Modify: `D:\Anthropic\docs\dev-trading.md`

- [ ] **Step 1: Add "On-Chain Protocol" section**

Add after the Architecture Overview section:

```markdown
## On-Chain Protocol (2026-03-27)

**Chain is source, DB is index.** Every trade lifecycle event broadcasts to Kaspa chain.

### Protocol Messages

| Type | Channel | Purpose |
|------|---------|---------|
| kanet_sell_v1 | {orderId} | Publish sell order |
| kanet_buy_v1 | {orderId} | Publish buy order |
| kanet_accept_v1 | {orderId} | Accept order |
| kanet_paid_v1 | {orderId} | Payment proof (cross-chain TX hash) |
| kanet_delivered_v1 | {orderId} | KAS delivery proof |
| kanet_cancel_v1 | {orderId} | Cancel order |
| kanet_timeout_v1 | {orderId} | Timeout accountability |

### Filter

`trade-protocol-filter.js` — mounted at broadcast_messages INSERT points.
Routes chain events to existing services (order-machine, fund-lock, etc.).
One new file, zero new tables.

### Key Design Principles

1. KAS must be on one side of every trade (KAS/X model)
2. Both parties' addresses must be on-chain
3. One order = one channel (channel name = orderId)
4. Accepted orders can revert to published (timeout → next candidate)
5. Timeout records are on-chain (natural reputation system)
```

- [ ] **Step 2: Commit**

```bash
git add docs/dev-trading.md
git commit -m "docs: add on-chain protocol section to dev-trading.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
