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
import { releaseFunds } from './fund-lock.js';
import { quickStart } from './execution-state.js';
import { recordChainEvent } from './chain-event.js';
import { checkLimits } from './trade-limits.js';
import { placeOrder } from './exchange-orders.js';
import { decrypt } from './crypto.js';
// exchange-machine imports merged below at line ~352

/**
 * Called after every broadcast_messages INSERT.
 * Fast-rejects non-protocol messages via string prefix check.
 *
 * @param {object} row - { tx_hash, content, sender_address, channel_name, created_at }
 */
export { _executeHedge as executeHedge };
export { _autoPayExchange as triggerAutoPay, _autoSettleAsset, _autoSettleAsset as _autoSendKas };

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
      case 'kanet_exchange_v1':
        await handleExchange(msg); break;
      case 'kanet_exchange_accept_v1':
        await handleExchangeAccept(msg); break;
      case 'kanet_exchange_cancel_v1':
        await handleExchangeCancel(msg); break;
      case 'kanet_confirm_v1':
        await handleManualConfirm(msg); break;
      case EXCHANGE_MSG.PAID:
        await handleExchangePaid(msg); break;
      case EXCHANGE_MSG.DELIVERED:
        await handleExchangeDelivered(msg); break;
      case EXCHANGE_MSG.TIMEOUT:
        await handleExchangeTimeout(msg); break;
      case EXCHANGE_MSG.DISPUTE:
        await handleExchangeDispute(msg); break;
      case EXCHANGE_MSG.RESOLVE:
        await handleExchangeResolve(msg); break;
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
    relayNodeId: relayNodeId || '__remote__',
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
      relayNodeId: relayNodeId || '__remote__',
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

  // Bug NWT-N5 fix 5/18 (KI-12 第 15 次 silent skip): transition result 必 check.
  // 旧 logic 直接 fire transition 不读返回, 失败时 chain_event 仍 record → false-positive audit.
  const tResult = transition(orderId, 'paid', { txHash: msg.tx });
  if (!tResult?.ok) {
    console.warn(`[trade-filter] handlePaid transition fail order=${orderId.slice(0,8)} status=${order.status} → 'paid': ${tResult?.error || 'unknown'}`);
    return; // 不记 false-positive payment event
  }

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

// ── Exchange Protocol (v1.1 自由市场) ────────────────────────

import { randomUUID } from 'crypto';
import { processAccept as machineAccept, processManualConfirm, processCancel as machineCancel, processPaymentSubmit, transition as exchangeTransition } from './exchange-machine.js';

// Exchange protocol v2 message type constants
const EXCHANGE_MSG = {
  PUBLISH:   'kanet_exchange_v1',
  ACCEPT:    'kanet_exchange_accept_v1',
  CANCEL:    'kanet_exchange_cancel_v1',
  CONFIRM:   'kanet_confirm_v1',
  PAID:      'kanet_exchange_paid_v1',
  DELIVERED: 'kanet_exchange_delivered_v1',
  TIMEOUT:   'kanet_exchange_timeout_v1',
  DISPUTE:   'kanet_exchange_dispute_v1',
  RESOLVE:   'kanet_exchange_resolve_v1',
};

/**
 * Derive market_key: alphabetical sort ensures KAS|USDT === USDT|KAS
 */
function _deriveMarketKey(giveAsset, wantAsset) {
  return [giveAsset, wantAsset].sort().join('|');
}

/**
 * kanet_exchange_v1 — new offer broadcast
 *
 * msg: { t, id?, give_asset, give_amount, give_chain?,
 *         want_asset, want_amount, want_chain?,
 *         expires_at?, verification?, verification_meta?,
 *         _tx, _from, _channel, _at }
 */
async function handleExchange(msg) {
  if (!msg.give_asset || !msg.want_asset) return;

  const offerId = msg.id || randomUUID();
  const msgIndex = msg.message_index || 0;

  // Idempotent: skip if already indexed
  const existing = sqlite.prepare(
    'SELECT id FROM exchange_offers WHERE broadcast_tx_id = ? AND message_index = ?'
  ).get(msg._tx, msgIndex);
  if (existing) return;

  const marketKey = _deriveMarketKey(msg.give_asset, msg.want_asset);
  const now = msg._at || new Date().toISOString();

  sqlite.prepare(`
    INSERT INTO exchange_offers (
      id, broadcast_tx_id, message_index,
      give_asset, give_amount, give_chain,
      want_asset, want_amount, want_chain,
      maker, broadcast_at, expires_at,
      verification, verification_meta,
      protocol_status, is_fully_observed, market_key,
      observed_by_node,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, ?, ?, ?, ?)
  `).run(
    offerId, msg._tx, msgIndex,
    msg.give_asset, String(msg.give_amount || '0'), msg.give_chain || null,
    msg.want_asset, String(msg.want_amount || '0'), msg.want_chain || null,
    msg._from, now, msg.expires_at || null,
    msg.verification || 'manual', JSON.stringify(msg.verification_meta || {}),
    marketKey, null,
    now, now
  );

  console.log(`[exchange] Offer indexed: ${offerId.slice(0, 8)} ${msg.give_amount} ${msg.give_asset} → ${msg.want_amount} ${msg.want_asset} by ${msg._from.slice(-12)}`);

  // 2026-04-14 Q5 audit fix: replay orphan accepts that arrived before publish
  // (Kaspa DAG 内 block TX order 不保证, accept 可能早于 publish 到达 ingest)
  const pending = sqlite.prepare(
    'SELECT id, msg_json FROM pending_exchange_accepts WHERE offer_id = ? ORDER BY received_at ASC'
  ).all(offerId);
  for (const p of pending) {
    try {
      const pmsg = JSON.parse(p.msg_json);
      sqlite.prepare('DELETE FROM pending_exchange_accepts WHERE id = ?').run(p.id);
      console.log(`[exchange] replay orphan accept for offer ${offerId.slice(0,8)} from ${(pmsg._from || '').slice(-8)}`);
      await handleExchangeAccept(pmsg);
    } catch (e) {
      console.error(`[exchange] orphan accept replay failed: ${e.message}`);
    }
  }

  // AutoTaker: evaluate incoming offer for automatic acceptance
  setImmediate(() => _evaluateAutoTake(offerId, msg).catch(e =>
    console.error(`[autoTaker] evaluate error: ${e.message}`)
  ));
}

// ── AutoTaker — auto-accept profitable incoming offers ──────────────────

let _lastAutoTakeAt = 0;
let _autoTakeLock = false;

/**
 * Evaluate an incoming offer for automatic acceptance.
 * Single-side first: only accept BUY offers (maker gives KAS, wants USDT → we pay USDT, get KAS).
 * Default mode is 'approval' — creates a proposal in execution_states for Owner to confirm.
 */
async function _evaluateAutoTake(offerId, msg) {
  if (_autoTakeLock) return;

  // 1. Check enabled
  const { getConfig } = await import('../data/settings/configs.js');
  const enabled = await getConfig('autotake_enabled');
  if (enabled !== 'true') return;

  // 2. Skip own offers (trap #53)
  const localAddrs = sqlite.prepare('SELECT address FROM relay_nodes').all().map(r => r.address);
  if (localAddrs.includes(msg._from)) return;

  // 3. Only auto-verifiable offers
  if (msg.verification === 'manual') return;

  // 4. Skip expired
  if (msg.expires_at && new Date(msg.expires_at) < new Date()) return;

  // 5. Direction: only BUY (maker gives KAS, wants USDT)
  if (msg.give_asset?.toUpperCase() !== 'KAS' || msg.want_asset?.toUpperCase() !== 'USDT') return;

  // 5b. Check accepted_chains includes a chain we can pay on (bnb default)
  // Bug NWT-13:47 真因 confirmed: acceptedChains 是 [{chain, address}] 对象 array, 旧 includes(c) 检 c 整对象
  // 永远 false → payChain null → silent return → autoTaker 30+ day production silent dead from day 1.
  // KI-12 第 13 次复刻 silent skip pattern.
  // 修法: c.chain access, normalize case.
  const meta = msg.verification_meta || {};
  const acceptedChains = meta.accepted_chains || [];
  const supported = ['bnb', 'eth', 'sol', 'tron'];
  const match = acceptedChains.find(c => c && supported.includes(String(c.chain || c).toLowerCase()));
  const payChain = (match && (match.chain || match)) || (acceptedChains.length === 0 ? 'bnb' : null);
  if (!payChain) return;

  // 6. Price evaluation
  // Bug NWT-13:30 A1 fix (Owner production autoTaker 真测 silent disabled):
  // getCachedKasPrice 单 source 返 0 当 cache cold/idle/TTL 超 → autoTaker silent dead.
  // broker quote 用 exchange-client.getKasPrice() (live oracle), autoTaker 应同源.
  // 修法: try cache first (fast path), fallback live oracle (cold cache 也能 evaluate).
  const { getCachedKasPrice } = await import('./market-data.js');
  let marketPrice = getCachedKasPrice();
  if (!marketPrice) {
    try {
      const { getKasPrice } = await import('./broker-v3/exchange-client.js');
      marketPrice = await getKasPrice();
    } catch (err) { console.warn(`[autoTaker] getKasPrice fallback err: ${err.message}`); }
  }
  if (!marketPrice) return; // 真 oracle down → skip (not silent disable)

  const giveAmt = parseFloat(msg.give_amount);
  const wantAmt = parseFloat(msg.want_amount);
  if (!giveAmt || !wantAmt) return;

  const offerPrice = wantAmt / giveAmt; // USDT per KAS
  const discount = (marketPrice - offerPrice) / marketPrice;
  const minDiscount = parseFloat(await getConfig('autotake_min_discount_pct') || '0.5') / 100;
  if (discount < minDiscount) return; // not cheap enough

  // 7. Amount cap
  const maxUsdt = parseFloat(await getConfig('autotake_max_amount_usdt') || '50');
  if (wantAmt > maxUsdt) return;

  // 8. Daily limit
  const today = new Date().toISOString().slice(0, 10);
  const dailyCount = sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM chain_events WHERE event_type = 'autotake_accepted' AND observed_at >= ?"
  ).get(today + 'T00:00:00Z')?.cnt || 0;
  const dailyLimit = parseInt(await getConfig('autotake_daily_limit') || '3');
  if (dailyCount >= dailyLimit) return;

  // 9. Cooldown (configurable, default 30s, UTXO conflict prevention)
  const cooldownMs = (parseInt(await getConfig('autotake_cooldown_sec') || '30')) * 1000;
  if (_lastAutoTakeAt && Date.now() - _lastAutoTakeAt < cooldownMs) return;

  // 10. Find best local agent (has BNB wallet with most USDT)
  let bestRelay = null;
  for (const addr of localAddrs) {
    const relay = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(addr);
    if (!relay) continue;
    const wallet = sqlite.prepare(
      "SELECT * FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' AND is_default = 1"
    ).get(relay.id);
    if (!wallet) continue;
    // No cached_balance column — accept first wallet with privkey, actual balance checked at pay time
    bestRelay = relay.id;
    break;
  }
  if (!bestRelay) return;

  console.log(`[autoTaker] opportunity: ${giveAmt} KAS @ ${offerPrice.toFixed(6)} (${(discount * 100).toFixed(2)}% below market ${marketPrice})`);

  // 10b. ── Reputation gate ──
  // Wire existing reputation.js into the autoTaker decision path.
  // Previously isAutoTradeAllowed() existed but was never called.
  try {
    const { assessReputation, isAutoTradeAllowed } = await import('./reputation.js');
    const myAddr = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(bestRelay)?.address;
    if (myAddr) {
      const rep = assessReputation(myAddr, msg._from);
      const gate = isAutoTradeAllowed(rep);
      if (!gate.allowed) {
        console.log(`[autoTaker] REPUTATION BLOCK: ${gate.reason} (peer risk=${rep.risk}) — skipping offer ${offerId.slice(0, 8)}`);
        // Record a chain event so this decision is audit-visible
        // Bug NWT-N4 fix 5/18 (KI-12 第 14 次 silent skip): 旧 offerId.slice(0,12) → extexch-1779062837238-X
        // 12 char 截 "autotake_rep_block_extexch-1779" 所有 extexch- 前缀 offer 共享 txid →
        // UNIQUE(txid, event_type) silent ignore 后续 → audit trail 丢. Use full offerId.
        try {
          const { recordChainEvent } = await import('./chain-event.js');
          recordChainEvent({
            txid: `autotake_rep_block_${offerId}`,
            eventType: 'autotake_reputation_block',
            payload: JSON.stringify({ offer_id: offerId, peer: msg._from, risk: rep.risk, reason: gate.reason, warnings: rep.warnings }),
          });
        } catch (err) { console.warn(`[autoTaker] rep_block audit recordChainEvent err: ${err.message}`); }
        return;
      }
      // Medium risk: halve the effective size cap for this trade
      if (gate.limitMultiplier && gate.limitMultiplier < 1) {
        const reducedCap = maxUsdt * gate.limitMultiplier;
        if (wantAmt > reducedCap) {
          console.log(`[autoTaker] REPUTATION CAP: peer risk=${rep.risk}, effective cap $${reducedCap.toFixed(2)} < wantAmt $${wantAmt} — skipping`);
          return;
        }
        console.log(`[autoTaker] reputation=${rep.risk} — proceeding with ${(gate.limitMultiplier * 100).toFixed(0)}% limit multiplier`);
      }
    }
  } catch (e) {
    console.error(`[autoTaker] reputation check failed: ${e.message} — proceeding conservatively (block)`);
    return;  // fail-closed: if rep check errors, don't auto-trade
  }

  // 11. Mode: approval (default) or auto
  const mode = await getConfig('autotake_mode') || 'approval';
  if (mode === 'auto') {
    _autoTakeLock = true;
    try {
      await _executeAutoTake(offerId, bestRelay, payChain);
    } finally {
      _autoTakeLock = false;
    }
  } else {
    // Approval mode: create proposal in execution_states
    const { createExecution } = await import('./execution-state.js');
    createExecution({
      orderId: offerId,
      type: 'autotake_proposal',
      source: 'auto-taker',
      agentAddress: localAddrs[0],
      displaySummary: `AutoTake: BUY ${giveAmt} KAS @ ${offerPrice.toFixed(6)} (${(discount * 100).toFixed(2)}% below market $${marketPrice})`,
      actionDetails: JSON.stringify({ offerId, offerPrice, marketPrice, discount, chain: 'bnb', relayId: bestRelay }),
    });
    console.log(`[autoTaker] proposal created for offer ${offerId.slice(0, 8)}`);
  }
}

/**
 * Execute auto-take by calling the internal accept API endpoint.
 * Reuses the full exchange.js accept path — broadcast, meta writes, auto-pay trigger.
 */
async function _executeAutoTake(offerId, relayId, selectedChain = 'bnb') {
  // Verify offer still open
  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ? AND protocol_status = ?').get(offerId, 'open');
  if (!offer) {
    console.log(`[autoTaker] offer ${offerId.slice(0, 8)} no longer open, skipping`);
    return;
  }

  // Internal HTTP to POST /api/exchange/accept — reuse full validated path (trap #51 compliant)
  const http = await import('node:http');
  const body = JSON.stringify({
    relayNodeId: relayId,
    offer_id: offerId,
    selected_chain: selectedChain,
    channel: 'kanet-exchange',
  });

  const result = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port: 3100, path: '/api/exchange/accept', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, data: d }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });

  if (result.status !== 200) {
    console.error(`[autoTaker] accept failed for ${offerId.slice(0, 8)}: ${JSON.stringify(result.data)}`);
    return;
  }

  // Record chain_event for audit + Brain awareness
  recordChainEvent({
    txid: result.data?.txId || offerId,
    eventType: 'autotake_accepted',
    fromAddress: sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relayId)?.address || '',
    toAddress: offer.maker,
    payload: JSON.stringify({
      offer_id: offerId,
      give: offer.give_amount + ' ' + offer.give_asset,
      want: offer.want_amount + ' ' + offer.want_asset,
    }),
  });

  _lastAutoTakeAt = Date.now();
  console.log(`[autoTaker] accepted offer ${offerId.slice(0, 8)} — auto-pay will trigger via handleExchangeAccept`);
}

/**
 * kanet_exchange_accept_v1 — someone accepts an offer.
 * Delegates to exchange-machine.js: first-valid-accept → matched → verification routing.
 * After matching, triggers CEX hedge if maker is a local agent with hedge config.
 */
async function handleExchangeAccept(msg) {
  if (!msg.offer_id) return;
  const result = machineAccept(msg);
  if (!result) return;
  if (result.protocol_status !== 'awaiting_manual_confirm' &&
      result.protocol_status !== 'verifying') return;

  // Record chain_event for Brain awareness + audit trail
  recordChainEvent({
    txid: msg._tx || null,
    eventType: 'exchange_matched',
    fromAddress: result.taker,
    toAddress: result.maker,
    payload: JSON.stringify({
      offer_id: result.id,
      give_asset: result.give_asset, give_amount: result.give_amount,
      want_asset: result.want_asset, want_amount: result.want_amount,
      taker: result.taker, taker_chain: result.taker_chain,
      verification: result.verification,
    }),
  });

  // manual 验证：等待手动确认，不触发对冲
  if (result.protocol_status === 'awaiting_manual_confirm') {
    console.log(`[exchange] manual confirm pending offer=${result.id.slice(0,8)} maker=${result.maker.slice(-8)} taker=${result.taker?.slice(-8)}`);
    return;
  }

  // verifying（cross_chain_tx / kaspa_tx）：不在此阶段触发对冲
  // Hedge 必须等 completed（交割确认后）才触发，否则 Taker 不履约 = 裸空仓

  // === Auto-pay: if taker is a local Agent, automatically pay USDT (cross_chain_tx) ===
  // TASK 2.4 非托管门控: is_dex_broker=1 的 relay 只代发广播不碰钱, 跳过 auto-pay
  if (result.taker && result.taker_chain && result.verification === 'cross_chain_tx') {
    const localRelay = sqlite.prepare('SELECT id, is_dex_broker FROM relay_nodes WHERE address = ?').get(result.taker);
    if (localRelay && !localRelay.is_dex_broker) {
      console.log(`[exchange] local taker detected, triggering auto-pay for offer ${result.id.slice(0,8)}`);
      setImmediate(() => _autoPayExchange(result, localRelay.id).catch(e =>
        console.error(`[exchange] auto-pay error: ${e.message}`)
      ));
    } else if (localRelay?.is_dex_broker) {
      console.log(`[exchange] DEX broker taker — skip auto-pay (non-custodial) offer=${result.id.slice(0,8)}`);
    }
  }

  // === Auto-settle-asset: if taker is a local Agent and offer wants any registered asset ===
  // T-J1-2026-04-27 v1.1 Phase A 协议层 step 3 (Owner 23:05 钦定 '全自动推进 真人能用'):
  // trigger condition KAS-only → 任意 isSupported(want_asset, want_chain). _autoSettleAsset
  // 内部 isSupported guard 真二次 verify, 不 over-trigger non-asset offer.
  // TASK 2.4 同样门控: DEX broker 也不做 auto-settle (非托管)
  // verification 类型分流: 'kaspa_tx' = native chain (KAS) / 'cross_chain_tx' = USDT 已 _autoPayExchange
  // 处理 — 此处只接 native chain transfer (跟原 _autoSendKas 同语义, 但 generic 任意 native asset).
  if (result.taker && result.verification === 'kaspa_tx' && result.want_asset && result.want_chain) {
    const { isSupported } = await import('./asset-registry.js');
    if (isSupported(result.want_asset, result.want_chain)) {
      const localRelay = sqlite.prepare('SELECT id, is_dex_broker FROM relay_nodes WHERE address = ?').get(result.taker);
      if (localRelay && !localRelay.is_dex_broker) {
        console.log(`[exchange] local taker detected, triggering auto-settle-asset (${result.want_asset}/${result.want_chain}) for offer ${result.id.slice(0,8)}`);
        setImmediate(() => _autoSettleAsset(result, localRelay.id).catch(e =>
          console.error(`[exchange] auto-settle-asset error: ${e.message}`)
        ));
      } else if (localRelay?.is_dex_broker) {
        console.log(`[exchange] DEX broker taker — skip auto-settle (non-custodial) offer=${result.id.slice(0,8)}`);
      }
    } else {
      console.log(`[exchange] auto-settle skip: ${result.want_asset}/${result.want_chain} not in asset-registry, offer=${result.id.slice(0,8)}`);
    }
  }
  console.log(`[exchange] offer ${result.id.slice(0,8)} entered verifying — hedge deferred to completed`);
}

/**
 * kanet_exchange_cancel_v1 — maker cancels their offer.
 * Delegates to exchange-machine.js: only valid from 'open' status.
 */
async function handleExchangeCancel(msg) {
  if (!msg.offer_id) return;
  machineCancel(msg);
}

/**
 * kanet_confirm_v1 — manual verification confirmation (maker or taker).
 * Delegates to exchange-machine.js.
 */
async function handleManualConfirm(msg) {
  if (!msg.offer_id) return;
  processManualConfirm(msg);
}

// ── CEX Hedge ────────────────────────────────────────────────

const EXCHANGE_REGISTRY = [
  { id: 'mexc',    authStyle: 'binance-like', headerName: 'X-MEXC-APIKEY', kasPair: 'KASUSDT', baseUrl: 'https://api.mexc.com/api/v3' },
  { id: 'gateio',  authStyle: 'gateio',       kasPair: 'KAS_USDT',         baseUrl: 'https://api.gateio.ws/api/v4' },
  { id: 'kucoin',  authStyle: 'kucoin',       kasPair: 'KAS-USDT',         baseUrl: 'https://api.kucoin.com' },
  { id: 'bybit',   authStyle: 'bybit',        kasPair: 'KASUSDT',          baseUrl: 'https://api.bybit.com' },
  { id: 'bitget',  authStyle: 'bitget',       kasPair: 'KASUSDT',          baseUrl: 'https://api.bitget.com' },
  { id: 'htx',     authStyle: 'htx',          kasPair: 'kasusdt',          baseUrl: 'https://api.huobi.pro' },
  { id: 'kraken',  authStyle: 'kraken',       kasPair: 'KASUSDT',          baseUrl: 'https://api.kraken.com' },
];

// Circuit breaker: 1h window, ≥3 failures → stop hedging
let _hedgeFailures = [];
const HEDGE_CIRCUIT_WINDOW_MS = 60 * 60 * 1000;
const HEDGE_CIRCUIT_THRESHOLD = 3;

function _isHedgeCircuitOpen() {
  const cutoff = Date.now() - HEDGE_CIRCUIT_WINDOW_MS;
  _hedgeFailures = _hedgeFailures.filter(t => t > cutoff);
  return _hedgeFailures.length >= HEDGE_CIRCUIT_THRESHOLD;
}

// hedge_cex 名称映射（scanner 显示名 → DB exchange 字段）
const HEDGE_CEX_MAP = {
  'gate': 'gateio', 'gateio': 'gateio',
  'mexc': 'mexc', 'bybit': 'bybit', 'kucoin': 'kucoin',
  'bitget': 'bitget', 'htx': 'htx', 'huobi': 'htx',
  'binance': 'binance', 'kraken': 'kraken',
};

/**
 * Fetch best bid/ask from the target exchange's public ticker API.
 * Returns aggressive limit price (BUY → ask*1.002, SELL → bid*0.998) or null on failure.
 */
async function _fetchHedgePrice(exchange, side) {
  const TICKER_MAP = {
    mexc:    { url: 'https://api.mexc.com/api/v3/ticker/bookTicker?symbol=KASUSDT',                   parse: d => ({ ask: d.askPrice, bid: d.bidPrice }) },
    gateio:  { url: 'https://api.gateio.ws/api/v4/spot/tickers?currency_pair=KAS_USDT',               parse: d => ({ ask: (Array.isArray(d) ? d[0] : d).lowest_ask, bid: (Array.isArray(d) ? d[0] : d).highest_bid }) },
    bybit:   { url: 'https://api.bybit.com/v5/market/tickers?category=spot&symbol=KASUSDT',            parse: d => ({ ask: d.result.list[0].ask1Price, bid: d.result.list[0].bid1Price }) },
    kucoin:  { url: 'https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=KAS-USDT',           parse: d => ({ ask: d.data.bestAsk, bid: d.data.bestBid }) },
    bitget:  { url: 'https://api.bitget.com/api/v2/spot/market/tickers?symbol=KASUSDT',                parse: d => ({ ask: d.data[0].askPr, bid: d.data[0].bidPr }) },
    htx:     { url: 'https://api.huobi.pro/market/detail/merged?symbol=kasusdt',                       parse: d => ({ ask: d.tick.ask[0], bid: d.tick.bid[0] }) },
    binance: { url: 'https://api.binance.com/api/v3/ticker/bookTicker?symbol=KASUSDT',                 parse: d => ({ ask: d.askPrice, bid: d.bidPrice }) },
  };

  const entry = TICKER_MAP[exchange];
  if (!entry) {
    console.log(`[exchange-hedge] No ticker for ${exchange}, fallback to MEXC`);
    const fb = TICKER_MAP.mexc;
    try {
      const data = await fetch(fb.url, { signal: AbortSignal.timeout(3000) }).then(r => r.json());
      const { ask, bid } = fb.parse(data);
      const price = side === 'BUY' ? parseFloat(ask) * 1.002 : parseFloat(bid) * 0.998;
      console.log(`[exchange-hedge] price from mexc (fallback): ask=${ask} bid=${bid}`);
      return price;
    } catch {
      console.log(`[exchange-hedge] Price fetch failed (fallback MEXC) — aborting hedge`);
      return null;
    }
  }

  try {
    const data = await fetch(entry.url, { signal: AbortSignal.timeout(3000) }).then(r => r.json());
    const { ask, bid } = entry.parse(data);
    const price = side === 'BUY' ? parseFloat(ask) * 1.002 : parseFloat(bid) * 0.998;
    console.log(`[exchange-hedge] price from ${exchange}: ask=${ask} bid=${bid}`);
    return price;
  } catch (err) {
    console.log(`[exchange-hedge] Price fetch failed from ${exchange}: ${err.message} — aborting hedge`);
    return null;
  }
}

/**
 * Execute a hedge order on the best available CEX.
 * If preferredCex specified, try that first; otherwise use default account.
 */
async function _executeHedge(offerId, agentName, side, qty, preferredCex = null) {
  // T-22-05 Step G — Opt-in hedge gate（安全门控）
  // 默认不对冲。只有 offer.meta.hedge_enabled === true 才触发对冲。
  // 防止 retail-proxy / bounty / auction 等 non-hedgeable offer 类型误触发 CEX 反向下单。
  // 3 个调用点（api/exchange.js / exchange-machine.js x2）全部自动受保护。
  const _hedgeGateOffer = sqlite.prepare(
    "SELECT meta FROM exchange_offers WHERE id = ? LIMIT 1"
  ).get(offerId);
  if (!_hedgeGateOffer) {
    console.log(`[exchange-hedge] offer ${offerId.slice(0, 8)} not found — skip`);
    return;
  }
  let _hedgeGateMeta = {};
  try { _hedgeGateMeta = JSON.parse(_hedgeGateOffer.meta || '{}'); } catch {}
  if (_hedgeGateMeta.hedge_enabled !== true) {
    console.log(`[exchange-hedge] offer ${offerId.slice(0, 8)} hedge_enabled!=true → skip (default opt-in safety)`);
    return;
  }

  // Idempotency guard — prevent double-hedge if both API and chain paths fire
  const _existingHedge = sqlite.prepare(
    "SELECT id FROM chain_events WHERE txid = ? AND event_type LIKE 'hedge%' LIMIT 1"
  ).get(offerId);
  if (_existingHedge) {
    console.log(`[exchange-hedge] Duplicate suppressed for offer ${offerId.slice(0, 8)}`);
    return;
  }

  if (_isHedgeCircuitOpen()) {
    console.log(`[exchange-hedge] CIRCUIT OPEN — ${_hedgeFailures.length} failures in 1h, skipping hedge for ${offerId.slice(0, 8)}`);
    recordChainEvent({
      txid: offerId, eventType: 'hedge_skipped',
      fromAddress: null, toAddress: null, observedBy: 'system',
      payload: { reason: 'circuit_breaker', failures: _hedgeFailures.length },
    });
    return;
  }

  // Get best available exchange account (prefer specified CEX, fallback to default)
  let account = null;
  if (preferredCex) {
    const normalized = HEDGE_CEX_MAP[preferredCex.toLowerCase()] || preferredCex.toLowerCase();
    account = sqlite.prepare('SELECT * FROM exchange_accounts WHERE exchange = ?').get(normalized);
  }
  if (!account) {
    account = sqlite.prepare(
      'SELECT * FROM exchange_accounts WHERE is_default = 1 LIMIT 1'
    ).get() || sqlite.prepare('SELECT * FROM exchange_accounts LIMIT 1').get();
  }

  if (!account) {
    console.log(`[exchange-hedge] No exchange account configured — cannot hedge ${offerId.slice(0, 8)}`);
    return;
  }

  const def = EXCHANGE_REGISTRY.find(e => e.id === account.exchange);
  if (!def) {
    console.log(`[exchange-hedge] Unknown exchange: ${account.exchange}`);
    return;
  }

  let apiKey, apiSecret, extra;
  try {
    apiKey = account.api_key_encrypted ? decrypt(account.api_key_encrypted) : null;
    apiSecret = account.api_secret_encrypted ? decrypt(account.api_secret_encrypted) : null;
    extra = account.extra_encrypted ? JSON.parse(decrypt(account.extra_encrypted)) : {};
  } catch (err) {
    console.log(`[exchange-hedge] Credential decrypt failed: ${err.message}`);
    return;
  }

  // Fetch current market price from the target exchange (not hardcoded MEXC)
  const hedgePrice = await _fetchHedgePrice(account.exchange, side);
  if (!hedgePrice) {
    _hedgeFailures.push(Date.now());
    return;
  }
  const price = hedgePrice;

  console.log(`[exchange-hedge] ${agentName} ${side} ${qty} KAS @ ${price.toFixed(5)} on ${account.exchange} (hedge for offer ${offerId.slice(0, 8)})`);

  const result = await placeOrder({
    authStyle: def.authStyle,
    baseUrl: account.base_url || def.baseUrl,
    headerName: def.headerName,
    apiKey, apiSecret, extra,
    symbol: def.kasPair, kasPair: def.kasPair,
    side, price, qty,
  });

  if (result.ok) {
    console.log(`[exchange-hedge] SUCCESS orderId=${result.orderId} for offer ${offerId.slice(0, 8)}`);
    recordChainEvent({
      txid: offerId, eventType: 'hedge_placed',
      fromAddress: null, toAddress: null, observedBy: 'system',
      payload: { exchange: account.exchange, side, qty, price, orderId: result.orderId },
    });
    // T-J2-2026-05-09 r203 T2.5b (Reading D P2P path): poll fill + user_ledger + DM user.
    // KANet taker 接 SELL offer + paid + delivered + completed → _executeHedge fire (hedge_placed line 924).
    // 加: 30s inline poll cex-bridge.getCexOrder until filled OR timeout. filled → ledger entry + DM via
    // broker-action-queue dm_completion. timeout → chain_event hedge_pending_fill, reconciler 5min retry.
    // user_kasia_address 来自 metadata (broker-intake-watcher.js:255 + broker-v3/router.js:109/119 写).
    // ref: NWT r270 PASS Reading D ship sequence.
    const userKasia = (() => {
      try { return JSON.parse(_hedgeGateOffer.meta || '{}').user_kasia_address || null; } catch { return null; }
    })();
    if (userKasia && typeof userKasia === 'string' && userKasia.startsWith('kaspa:')) {
      setImmediate(async () => {
        try {
          const { getCexOrder } = await import('./cex-bridge.js');
          const POLL_TIMEOUT_MS = 30_000;
          const POLL_INTERVAL_MS = 3_000;
          const start = Date.now();
          let filled = null;
          while (Date.now() - start < POLL_TIMEOUT_MS) {
            const orderState = await getCexOrder({ cex: account.exchange, orderId: result.orderId });
            if (orderState.filled) { filled = orderState; break; }
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
          }
          if (filled) {
            const proceedsUsdt = parseFloat((filled.executedQty * price).toFixed(4));
            const cur = sqlite.prepare(
              `SELECT COALESCE(SUM(balance_change), 0) AS balance FROM user_ledger
               WHERE user_kasia_address = ? AND asset = 'USDT'`
            ).get(userKasia);
            const balanceAfter = parseFloat(((cur?.balance || 0) + proceedsUsdt).toFixed(4));
            const ledgerId = `ledger_hedge_${offerId.slice(0, 12)}_${Date.now()}`;
            sqlite.prepare(`
              INSERT INTO user_ledger (id, user_kasia_address, asset, chain, balance_change, balance_after, reason, ref_order_id, ref_tx_hash, created_at)
              VALUES (?, ?, 'USDT', NULL, ?, ?, ?, ?, NULL, datetime('now'))
            `).run(ledgerId, userKasia, proceedsUsdt, balanceAfter, `hedge_filled:${result.orderId}`, offerId);
            recordChainEvent({
              txid: offerId, eventType: 'hedge_completed',
              fromAddress: null, toAddress: null, observedBy: 'system',
              payload: { exchange: account.exchange, side, qty: filled.executedQty, proceeds_usdt: proceedsUsdt, cex_order_id: result.orderId, balance_after: balanceAfter },
            });
            const { enqueue } = await import('./broker-action-queue.js');
            enqueue({ kind: 'dm_completion', peer: userKasia, payload: {
              message: `KAS 卖出成交 ${filled.executedQty} KAS → ${proceedsUsdt} USDT 入账\n账户余额: ${balanceAfter} USDT (broker IOU)\n回 "余额" 查账户 / "提 N USDT TRC20" 提币`,
            } });
            console.log(`[exchange-hedge] T2.5b ledger ${userKasia.slice(-12)} +${proceedsUsdt} USDT (offer ${offerId.slice(0,8)})`);
          } else {
            recordChainEvent({
              txid: offerId, eventType: 'hedge_pending_fill',
              fromAddress: null, toAddress: null, observedBy: 'system',
              payload: { exchange: account.exchange, cex_order_id: result.orderId, side, qty, price, polled_ms: POLL_TIMEOUT_MS },
            });
            console.log(`[exchange-hedge] T2.5b poll timeout offer=${offerId.slice(0,8)} cex_order=${result.orderId} → reconciler retry`);
          }
        } catch (err) {
          console.error(`[exchange-hedge] T2.5b ledger err: ${err.message}`);
        }
      });
    }
  } else {
    console.log(`[exchange-hedge] FAILED: ${result.error} for offer ${offerId.slice(0, 8)}`);
    _hedgeFailures.push(Date.now());
    recordChainEvent({
      txid: offerId, eventType: 'hedge_failed',
      fromAddress: null, toAddress: null, observedBy: 'system',
      payload: { exchange: account.exchange, side, qty, price, error: result.error },
    });
  }
}

// ── Exchange v2 protocol handlers ─────────────────────────────

/**
 * kanet_exchange_paid_v1 — taker broadcasts payment proof.
 * Transitions matched → verifying → triggers _verifyAndComplete.
 */
async function handleExchangePaid(msg) {
  if (!msg.offer_id || !msg.payment_tx) return;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  if (!offer) { console.log(`[exchange] paid: offer ${msg.offer_id} not found`); return; }

  // Gate 1: payment_tx already set → duplicate, skip
  if (offer.payment_tx) { console.log(`[exchange] paid: offer ${msg.offer_id.slice(0,8)} already has payment_tx, skip`); return; }

  // Gate 1.5 (2026-04-14 Q3 audit fix): payment_tx 已被别的 offer 用过 → reuse 攻击
  // 防止攻击者拿一笔真实付款的 txHash 去 "兑换" 多个 offer 的交割.
  // DB 层也有 UNIQUE index 作为 belt-and-suspenders, 但应用层先挡省一次 DB error.
  if (msg.payment_tx) {
    const existingUse = sqlite.prepare(
      'SELECT id, maker, taker FROM exchange_offers WHERE payment_tx = ? AND id != ?'
    ).get(msg.payment_tx, msg.offer_id);
    if (existingUse) {
      console.log(`[exchange] paid: REUSE BLOCKED — ${msg.payment_tx.slice(0,16)} already used by offer ${existingUse.id.slice(0,8)}`);
      recordChainEvent({
        txid: msg._tx || null,
        eventType: 'exchange_paid_reuse_rejected',
        fromAddress: msg._from || null,
        toAddress: offer.maker,
        payload: JSON.stringify({
          offer_id: msg.offer_id,
          reused_tx: msg.payment_tx,
          original_offer: existingUse.id,
          original_taker: existingUse.taker,
          attacker: msg._from || null,
        }),
      });
      return;
    }
  }

  // Gate 2: must be in matched or verifying (cross_chain_tx routes to verifying on accept)
  if (!['matched', 'verifying'].includes(offer.protocol_status)) {
    console.log(`[exchange] paid: offer ${msg.offer_id.slice(0,8)} status=${offer.protocol_status}, expected matched/verifying`);
    return;
  }

  // Write payment_tx (UNIQUE index 作为 fail-safe; 若并发插入冲突此处会抛, try 捕获降级)
  try {
    sqlite.prepare('UPDATE exchange_offers SET payment_tx = ? WHERE id = ?').run(msg.payment_tx, msg.offer_id);
  } catch (dbErr) {
    // UNIQUE constraint violation — 并发 reuse 从 DB 层被拦
    console.log(`[exchange] paid: DB UNIQUE conflict on payment_tx ${msg.payment_tx.slice(0,16)} for offer ${msg.offer_id.slice(0,8)}: ${dbErr.message}`);
    recordChainEvent({
      txid: msg._tx || null,
      eventType: 'exchange_paid_reuse_rejected',
      fromAddress: msg._from || null,
      toAddress: offer.maker,
      payload: JSON.stringify({
        offer_id: msg.offer_id,
        reused_tx: msg.payment_tx,
        source: 'db_unique_constraint',
      }),
    });
    return;
  }
  if (msg.payment_chain && !offer.taker_chain) {
    sqlite.prepare('UPDATE exchange_offers SET taker_chain = ? WHERE id = ?').run(msg.payment_chain, msg.offer_id);
  }

  // Transition to verifying if still matched; already verifying = skip transition
  let verifyingOffer;
  if (offer.protocol_status === 'matched') {
    verifyingOffer = exchangeTransition(msg.offer_id, 'verifying', {});
    if (!verifyingOffer || verifyingOffer.protocol_status !== 'verifying') {
      console.log(`[exchange] paid: transition to verifying failed for ${msg.offer_id.slice(0,8)}`);
      return;
    }
  } else {
    verifyingOffer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  }

  recordChainEvent({
    txid: msg._tx || null,
    eventType: 'exchange_paid',
    fromAddress: msg.payer || offer.taker,
    toAddress: offer.maker,
    payload: JSON.stringify({ offer_id: msg.offer_id, payment_tx: msg.payment_tx, chain: msg.payment_chain }),
  });

  // Trigger verification via existing processPaymentSubmit (it handles _verifyAndComplete)
  // Sub #4.b hotfix: forward payment_asset so verifyCrossChainTx routes to correct STABLECOINS[chain][asset]
  // (base chain USDC route, was defaulting to 'usdt' → "Underpayment 0" → auto-dispute).
  const chain = offer.taker_chain || msg.payment_chain;
  processPaymentSubmit({ offer_id: msg.offer_id, payment_tx: msg.payment_tx, payment_chain: chain, payment_asset: msg.payment_asset });

  console.log(`[exchange] paid: offer ${msg.offer_id.slice(0,8)} → verifying, TX=${msg.payment_tx.slice(0,16)}`);
}

/**
 * kanet_exchange_delivered_v1 — maker broadcasts KAS delivery proof.
 * Taker node updates local state to completed.
 */
async function handleExchangeDelivered(msg) {
  if (!msg.offer_id || !msg.delivery_tx) return;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  if (!offer) return;

  // Idempotent: already completed/disputed/etc → skip
  if (['completed', 'disputed', 'cancelled', 'expired'].includes(offer.protocol_status)) return;

  // T-J2-2026-05-11 Phase 2 A.5 (NWT #18 ABE audit) — bypass 保留 + comment 更新:
  // BYPASS reason: buyer node receiving delivery_v1 真 protocol_status 可能 matched/verifying/delivering 任一
  // (cross-node sync 异步)。VALID_TRANSITIONS 'matched' targets [verifying/awaiting_manual_confirm/awaiting_oracle/refunded] 不含
  // 'completed' — transition('matched', 'completed') 真 reject。direct UPDATE with status IN (..) guard 是 buyer-state-
  // agnostic 唯一路径。A.6 lint rule 真 whitelist 此 site (注释 marker 'lint-allow-protocol-status-direct: ABE-A.5')。
  // lint-allow-protocol-status-direct: ABE-A.5-buyer-state-agnostic-completion
  // TIMEZONE FIX: bind JS toISOString() instead of SQLite datetime('now') to ensure Z suffix.
  // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" (naive) which JS Date() parses as LOCAL,
  // causing "completed 7h ago" bug on P2-01 for Owner in +7 timezone. Phase 2 first finding.
  const nowIso = new Date().toISOString();
  // Round 1 真测发现 Bug 5: 漏 UPDATE delivery_tx → 买家端 offer.delivery_tx 永远 null →
  // broker-buy-completion-watcher fallback 取 taker_tx_id (= accept_v1 broadcast tx) →
  // DM 给用户的"Maker 发的 tx"引错. msg.delivery_tx 是 maker 真发 KAS 的 tx.
  const result = sqlite.prepare(`
    UPDATE exchange_offers SET delivery_tx = ?, protocol_status = 'completed', completed_at = ?, is_fully_observed = 1, updated_at = ?
    WHERE id = ? AND protocol_status IN ('matched', 'verifying', 'delivering')
  `).run(msg.delivery_tx, nowIso, nowIso, msg.offer_id);

  // FIX: when the direct UPDATE moves offer to completed, fund_lock must also transition locked → spent.
  // Without this, Phase 1 stress test S9 showed fund_locks permanently stuck (leak).
  if (result.changes > 0) {
    try {
      const { spendFunds } = await import('./fund-lock.js');
      spendFunds(msg.offer_id);
    } catch (e) {
      console.error(`[exchange] handleExchangeDelivered spendFunds error: ${e.message}`);
    }
  }

  recordChainEvent({
    txid: msg.delivery_tx,
    eventType: 'exchange_delivered',
    fromAddress: offer.maker,
    toAddress: offer.taker,
    payload: JSON.stringify({ offer_id: msg.offer_id, delivery_tx: msg.delivery_tx, amount: msg.delivery_amount }),
  });

  console.log(`[exchange] delivered: offer ${msg.offer_id.slice(0,8)} → completed (was ${offer.protocol_status})`);
}

/**
 * kanet_exchange_timeout_v1 — maker broadcasts payment timeout.
 * Reverts matched → open, clears taker fields, releases fund lock.
 * Does NOT use transition() — timeout revert is an exceptional flow.
 */
async function handleExchangeTimeout(msg) {
  if (!msg.offer_id) return;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  if (!offer) return;
  if (offer.protocol_status !== 'matched') return;

  // Direct SQL UPDATE: matched → open, clear taker fields
  // TIMEZONE FIX: use JS toISOString() for updated_at (Phase 2 P2-01 finding)
  const nowIso = new Date().toISOString();
  sqlite.prepare(`
    UPDATE exchange_offers
    SET protocol_status = 'open',
        taker = NULL, taker_chain = NULL, taker_payment_address = NULL,
        payment_tx = NULL, matched_at = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(nowIso, msg.offer_id);

  releaseFunds(msg.offer_id);

  recordChainEvent({
    txid: msg._tx || null,
    eventType: 'exchange_timeout',
    fromAddress: offer.maker,
    payload: JSON.stringify({ offer_id: msg.offer_id, taker: msg.taker || offer.taker, reason: msg.reason }),
  });

  console.log(`[exchange] timeout: offer ${msg.offer_id.slice(0,8)} reopened (was matched with ${(offer.taker || '').slice(-8)})`);
}

/**
 * kanet_exchange_dispute_v1 — peer raised a dispute on an offer.
 *
 * 2026-04-14 Q4 audit fix: 之前 DISPUTE 消息类型定义了但没 handler, 导致跨节点状态不同步.
 * 本地节点收到其他节点广播的 dispute, 推进本地 offer 到 disputed 状态.
 *
 * 幂等: 重复处理已在 disputed 的消息不会 double-apply.
 */
async function handleExchangeDispute(msg) {
  if (!msg.offer_id) return;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  if (!offer) {
    console.log(`[exchange] dispute: unknown offer ${msg.offer_id.slice(0,8)}, skip`);
    return;
  }

  // 幂等: 已是 disputed 或更后的 terminal 状态就跳过
  if (offer.protocol_status === 'disputed') {
    console.log(`[exchange] dispute: offer ${msg.offer_id.slice(0,8)} already disputed, idempotent skip`);
    return;
  }
  const TERMINAL_AFTER_DISPUTE = ['completed', 'cancelled', 'timed_out', 'failed', 'expired'];
  if (TERMINAL_AFTER_DISPUTE.includes(offer.protocol_status)) {
    console.log(`[exchange] dispute: offer ${msg.offer_id.slice(0,8)} already terminal (${offer.protocol_status}), skip`);
    return;
  }

  // Verify disputer is party to the offer (防止随机地址广播假 dispute)
  const isParty = msg.disputer === offer.maker || msg.disputer === offer.taker;
  if (!isParty) {
    console.log(`[exchange] dispute: rejected — ${(msg.disputer || '').slice(-8)} is not maker/taker of offer ${msg.offer_id.slice(0,8)}`);
    return;
  }

  // 写入 dispute meta + transition
  const meta = JSON.parse(offer.verification_meta || '{}');
  meta.dispute_reason = msg.reason || 'no_reason_given';
  meta.dispute_by = msg.disputer;
  meta.dispute_at = msg.raised_at || new Date().toISOString();

  sqlite.prepare(
    'UPDATE exchange_offers SET verification_meta = ?, updated_at = ? WHERE id = ?'
  ).run(JSON.stringify(meta), new Date().toISOString(), msg.offer_id);

  exchangeTransition(msg.offer_id, 'disputed', {});

  recordChainEvent({
    txid: msg._tx || null,
    eventType: 'exchange_disputed',
    fromAddress: msg.disputer || null,
    toAddress: offer.maker === msg.disputer ? offer.taker : offer.maker,
    payload: JSON.stringify({
      offer_id: msg.offer_id,
      disputer: msg.disputer,
      reason: msg.reason,
      from_status: offer.protocol_status,
    }),
  });

  console.log(`[exchange] dispute: offer ${msg.offer_id.slice(0,8)} → disputed (by ${(msg.disputer || '').slice(-8)}: ${msg.reason || '-'})`);
}

/**
 * kanet_exchange_resolve_v1 — dispute resolved (concede-only).
 *
 * 2026-04-14 Q4 audit fix: resolve 消息类型之前不存在 handler. 现在支持跨节点同步 resolve 结果.
 *
 * Concede-only 语义: maker 调 resolve → outcome=taker_wins (maker 认输);
 * taker 调 → outcome=maker_wins. 接收端也校验这个约束, 防止伪造"我判对方输".
 *
 * 幂等: 已 resolve 过的 offer 不会重复应用.
 */
async function handleExchangeResolve(msg) {
  if (!msg.offer_id || !msg.outcome) return;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  if (!offer) {
    console.log(`[exchange] resolve: unknown offer ${msg.offer_id.slice(0,8)}, skip`);
    return;
  }

  // 幂等: 已 resolve 过 (non-disputed terminal) → 跳过
  if (offer.protocol_status !== 'disputed') {
    console.log(`[exchange] resolve: offer ${msg.offer_id.slice(0,8)} status=${offer.protocol_status}, not disputed, skip`);
    return;
  }

  // Verify resolver is maker or taker
  const resolver = msg.resolver;
  if (!resolver || (resolver !== offer.maker && resolver !== offer.taker)) {
    console.log(`[exchange] resolve: rejected — ${(resolver || '').slice(-8)} is not maker/taker`);
    return;
  }

  // Concede-only check: maker only concede → taker_wins; taker only → maker_wins
  const expectedOutcome = resolver === offer.maker ? 'taker_wins' : 'maker_wins';
  if (msg.outcome !== expectedOutcome) {
    console.log(`[exchange] resolve: rejected — concede-only violation: ${resolver === offer.maker ? 'maker' : 'taker'} must concede (${expectedOutcome}), got ${msg.outcome}`);
    return;
  }

  const newStatus = msg.outcome === 'maker_wins' ? 'completed' : 'cancelled';
  const now = new Date().toISOString();

  // T-J2-2026-05-11 Phase 2 A.5 (NWT #18 ABE audit) — bypass 保留 + comment verified accurate:
  // disputed 在 TERMINAL Set (exchange-machine.js:34, A.1 加 refunded 后 ['completed','disputed','timed_out',
  // 'failed','cancelled','expired','refunded'])。transition() L46-48 真 TERMINAL 时 return offer unchanged
  // 不 transition — 真 confirmed reject。dispute resolution 真必走 bypass (terminal escape)。
  // A.6 lint rule 真 whitelist 此 site (注释 marker 'lint-allow-protocol-status-direct: ABE-A.5')。
  // lint-allow-protocol-status-direct: ABE-A.5-dispute-resolution-terminal-escape
  sqlite.prepare(`
    UPDATE exchange_offers
    SET protocol_status = ?, updated_at = ?,
        verification_meta = json_patch(COALESCE(verification_meta, '{}'), ?)
    WHERE id = ?
  `).run(newStatus, now, JSON.stringify({
    resolved_at: now,
    resolve_outcome: msg.outcome,
    resolved_by: resolver,
    resolve_tx: msg._tx || null,
    resolve_source: 'remote_broadcast',
  }), msg.offer_id);

  // Fund lock resolution (同 resolve endpoint 的逻辑)
  const { releaseFunds, spendFunds } = await import('./fund-lock.js');
  if (msg.outcome === 'maker_wins') {
    try { spendFunds(msg.offer_id); } catch (e) { console.error(`[resolve-remote] spendFunds: ${e.message}`); }
  } else {
    try { releaseFunds(msg.offer_id); } catch (e) { console.error(`[resolve-remote] releaseFunds: ${e.message}`); }
  }

  recordChainEvent({
    txid: msg._tx || null,
    eventType: 'exchange_resolved',
    fromAddress: resolver,
    toAddress: resolver === offer.maker ? offer.taker : offer.maker,
    payload: JSON.stringify({
      offer_id: msg.offer_id,
      outcome: msg.outcome,
      resolver,
      from_status: 'disputed',
      to_status: newStatus,
      source: 'remote_broadcast',
    }),
  });

  console.log(`[exchange] resolve: offer ${msg.offer_id.slice(0,8)} disputed → ${newStatus} (${msg.outcome}, resolver=${resolver.slice(-8)})`);
}

// ── Auto-pay for Exchange offers ──────────────────────────────

/**
 * Local taker auto-pays USDT after accepting an exchange offer.
 * Mirrors OTC pay_usdt logic but uses shared evm-transfer.js.
 */
async function _autoPayExchange(offer, takerRelayNodeId) {
  const chain = offer.taker_chain;
  if (!chain) {
    console.log(`[exchange-autopay] No taker_chain on offer ${offer.id.slice(0,8)}, skip`);
    return;
  }

  // Check if chain is supported for auto-pay (BNB/ETH/SOL/TRON)
  const { isChainSupported, transferUsdt } = await import('./evm-transfer.js');
  if (!isChainSupported(chain)) {
    console.log(`[exchange-autopay] Chain ${chain} not supported for auto-pay, skip`);
    return;
  }

  // Get taker's wallet for this chain
  const wallet = sqlite.prepare(
    'SELECT id, address, privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1'
  ).get(takerRelayNodeId, chain);
  if (!wallet?.privkey_encrypted) {
    console.log(`[exchange-autopay] No ${chain} wallet with private key for taker ${takerRelayNodeId.slice(0,8)}, skip`);
    return;
  }

  // Receive address = maker's address for the selected chain (from verification_meta or taker_payment_address)
  const receiveAddress = offer.taker_payment_address;
  if (!receiveAddress) {
    console.log(`[exchange-autopay] No receive address on offer ${offer.id.slice(0,8)}, skip`);
    return;
  }

  const amount = parseFloat(offer.want_amount);
  if (!amount || amount <= 0) {
    console.log(`[exchange-autopay] Invalid amount ${offer.want_amount}, skip`);
    return;
  }

  console.log(`[exchange-autopay] Paying ${amount} USDT → ${receiveAddress.slice(0,12)}... on ${chain} for offer ${offer.id.slice(0,8)}`);

  const result = await transferUsdt(chain, wallet.privkey_encrypted, receiveAddress, amount, offer.want_asset || 'USDT');
  if (!result.ok) {
    console.error(`[exchange-autopay] Payment failed: ${result.error}`);
    recordChainEvent({
      eventType: 'exchange_pay_failed',
      fromAddress: offer.taker,
      payload: JSON.stringify({ offer_id: offer.id, chain, error: result.error }),
    });
    return;
  }

  console.log(`[exchange-autopay] Payment TX: ${result.txHash}`);

  // Write payment_tx to offer (USDT already sent, record the fact)
  sqlite.prepare('UPDATE exchange_offers SET payment_tx = ? WHERE id = ?').run(result.txHash, offer.id);

  // === NO TX NO STATE CHANGE ===
  // No delay needed: transaction.mjs now tracks pending spent UTXOs in memory,
  // so consecutive sendKaspa calls use different UTXOs automatically.
  // Broadcast kanet_exchange_paid_v1 — MUST succeed before advancing state.
  // If broadcast fails (UTXO conflict etc), retry with backoff.
  // Only after TX is on chain do we processPaymentSubmit.
  const { sendCommandAsync } = await import('./relay-manager.js');
  const paidMsg = JSON.stringify({
    t: 'kanet_exchange_paid_v1',
    offer_id: offer.id,
    payment_tx: result.txHash,
    payment_chain: chain,
    payment_asset: offer.want_asset || 'USDT',
    payment_amount: offer.want_amount,
    payer: offer.taker,
  });

  // Bug AN 5/16 fix (NWT 02:30 HP-01 surface): 5 retries × 200ms backoff ~2s 太短 for Kaspa
  // mempool / UTXO contention scenarios. USDT autopay path 同 KAS autosettle 同款 short retry
  // 不 robust. Increase 15 retries × 1000ms linear + 5s extra every 5 attempts.
  let paidTxId = null;
  const MAX_BCAST_RETRIES = 15;
  const BCAST_RETRY_MS = 1000;
  for (let attempt = 1; attempt <= MAX_BCAST_RETRIES; attempt++) {
    try {
      const bcastResult = await sendCommandAsync(takerRelayNodeId, {
        type: 'send_broadcast',
        channel: 'kanet-exchange',
        message: paidMsg,
      });
      if (bcastResult?.error) {
        console.error(`[exchange-autopay] Paid broadcast attempt ${attempt}/${MAX_BCAST_RETRIES}: ${bcastResult.error}`);
      } else {
        paidTxId = bcastResult?.txId;
        if (paidTxId) {
          console.log(`[exchange-autopay] Broadcast kanet_exchange_paid_v1 TX: ${paidTxId} (attempt ${attempt})`);
          break;
        }
      }
    } catch (err) {
      console.error(`[exchange-autopay] Paid broadcast attempt ${attempt}/${MAX_BCAST_RETRIES} failed: ${err.message}`);
    }
    if (attempt < MAX_BCAST_RETRIES) {
      const extraMs = attempt % 5 === 0 ? 5000 : 0;
      await new Promise(r => setTimeout(r, BCAST_RETRY_MS + extraMs));
    }
  }

  if (!paidTxId) {
    // All retries failed — DO NOT advance state. USDT was sent but paid broadcast didn't land.
    // Record the failure so system can retry later or operator can intervene.
    console.error(`[exchange-autopay] CRITICAL: paid broadcast failed after ${MAX_BCAST_RETRIES} attempts. Offer ${offer.id.slice(0,8)} stays at current state. USDT TX ${result.txHash} was sent but maker node will not know.`);
    recordChainEvent({
      txid: result.txHash,
      eventType: 'exchange_paid_broadcast_failed',
      fromAddress: offer.taker,
      payload: JSON.stringify({ offer_id: offer.id, chain, amount, payment_tx: result.txHash, error: 'broadcast_failed_all_retries' }),
    });
    return;
  }

  // Broadcast succeeded — TX is on chain. NOW advance local state.
  recordChainEvent({
    txid: result.txHash,
    eventType: 'exchange_paid',
    fromAddress: offer.taker,
    toAddress: offer.maker,
    payload: JSON.stringify({ offer_id: offer.id, chain, amount, payment_tx: result.txHash, broadcast_tx: paidTxId }),
  });

  // Sub #4.b hotfix: forward payment_asset (offer.want_asset) to processPaymentSubmit so
  // verifyCrossChainTx routes to correct STABLECOINS[chain][asset] (base USDC route fix).
  processPaymentSubmit({ offer_id: offer.id, payment_tx: result.txHash, payment_chain: chain, payment_asset: offer.want_asset });
  console.log(`[exchange-autopay] verification triggered for offer ${offer.id.slice(0,8)}`);
}

/**
 * Auto-settle asset for offers where taker is local Agent (KAS or any registered asset).
 * Mirror of _autoPayExchange but for the want_asset side (taker delivers what offer wants).
 *
 * T-J1-2026-04-27 v1.1 Phase A 协议层 step 2 (NWT 23:42 + Owner '自决, 赶紧的'):
 * rename _autoSendKas → _autoSettleAsset, guard 从 KAS-only 改 isSupported (asset-registry),
 * 调 J1 Phase B settler-router.sendAsset 真路由 (KAS 走 kasia settler / USDT/USDC 走 evm settler).
 *
 * 现行为兼容: 现 trigger condition (line 711) 仍 'kaspa_tx + want_asset==KAS', 函数被调时
 * want_asset 真就是 'KAS', isSupported('KAS', 'kaspa') = true, 调 sendAsset 经 'kasia' settler
 * 内部走 sendCommandAsync({type:'send_kas', target, amount_kas}) — relay 行为同前.
 *
 * v1.1 Phase A step 3 (后续): trigger condition (line 711) 改 isSupported(want_asset, want_chain),
 * 任意 asset_pair 都触发 _autoSettleAsset. 那时 USDT/USDC offer 真自动 settle.
 */
async function _autoSettleAsset(offer, takerRelayNodeId) {
  const { isSupported } = await import('./asset-registry.js');
  const { sendAsset } = await import('./settler-router.js');
  // Bug BA 5/16 fix (Phase 1 re-test surface): sendCommandAsync 在 _autoPayExchange L1400 imported
  // 但 _autoSettleAsset 不同 function scope, L1566 paid_v1 broadcast 用时 'sendCommandAsync is not
  // defined' 抛 30/30 retry — Bug AY 加 retry width 治标不治本, 真因 = JS scope 漏 import.
  const { sendCommandAsync } = await import('./relay-manager.js');

  const wantAsset = offer.want_asset;
  const wantChain = offer.want_chain || (wantAsset?.toUpperCase() === 'KAS' ? 'kaspa' : null);
  if (!wantAsset || !wantChain) {
    console.log(`[exchange-autosettle] Offer ${offer.id.slice(0,8)} missing want_asset/chain (${wantAsset}/${wantChain}), skip`);
    return;
  }
  if (!isSupported(wantAsset, wantChain)) {
    console.log(`[exchange-autosettle] Offer ${offer.id.slice(0,8)} ${wantAsset}/${wantChain} not in asset-registry, skip`);
    return;
  }

  const amount = parseFloat(offer.want_amount);
  if (!amount || amount <= 0) {
    console.log(`[exchange-autosettle] Invalid amount ${offer.want_amount} for ${wantAsset}, skip`);
    return;
  }

  // Recipient = maker's expected address from verification_meta
  const meta = JSON.parse(offer.verification_meta || '{}');
  const recipientAddress = meta.expected_address || offer.maker;
  if (!recipientAddress) {
    console.log(`[exchange-autosettle] No recipient address for offer ${offer.id.slice(0,8)}, skip`);
    return;
  }

  console.log(`[exchange-autosettle] Sending ${amount} ${wantAsset}/${wantChain} → ${recipientAddress.slice(-12)} for offer ${offer.id.slice(0,8)}`);

  // Wait for UTXO to settle — accept broadcast just consumed a UTXO (Kaspa) or nonce confirm (EVM)
  await new Promise(r => setTimeout(r, 5000));

  try {
    // 调 J1 Phase B settler-router (commit 6b7b35a) 真路由
    const sendResult = await sendAsset({
      asset: wantAsset, chain: wantChain, to: recipientAddress, qty: amount, relayId: takerRelayNodeId,
    });

    const txId = sendResult?.txHash || sendResult?.txId;
    if (!sendResult?.ok || !txId) {
      console.error(`[exchange-autosettle] ${wantAsset}/${wantChain} send failed: ${sendResult?.error || 'no txId'}`);
      recordChainEvent({
        eventType: 'exchange_settle_failed',
        fromAddress: offer.taker,
        payload: JSON.stringify({ offer_id: offer.id, asset: wantAsset, chain: wantChain, error: sendResult?.error || 'no txId' }),
      });
      return;
    }

    console.log(`[exchange-autosettle] ${wantAsset}/${wantChain} sent TX: ${txId}`);

    // Write payment_tx to offer
    sqlite.prepare('UPDATE exchange_offers SET payment_tx = ? WHERE id = ?').run(txId, offer.id);

    // === NO TX NO STATE CHANGE (P1-C consensus: 铁律不分场景) ===
    // Broadcast kanet_exchange_paid_v1 — must succeed before processPaymentSubmit.
    // T-J1-2026-04-27 v1.1 Phase A 协议层 step 2: payment_asset + payment_chain 全 DB 真值
    // (兼容 KAS path = offer.want_asset='KAS', want_chain='kaspa', 同前; multi-asset 后真带
    // USDT/USDC + bnb/eth 等真值 from DB).
    const paidMsg = JSON.stringify({
      t: 'kanet_exchange_paid_v1',
      offer_id: offer.id,
      payment_tx: txId,
      payment_chain: wantChain,
      payment_asset: wantAsset,
      payment_amount: offer.want_amount,
      payer: offer.taker,
    });

    // Bug AY 5/16 fix (NWT Phase 1 env 9 真测 surface, KI 第 N+10 次 retry-window-too-tight):
    // 15 retries × 1000ms (~30s) still too tight when J2 just spent UTXOs for KAS payment AND needs
    // fresh UTXO for paid_v1 broadcast (Kaspa coinbase maturity ~10s + propagation + mempool clear).
    // 真测 evidence: offer fec93476 sendKas 08:03:28 → paid_v1 broadcast 08:03:33 start →
    // 08:03:50 fail 15 attempts → offer stuck verifying. J2 UTXOs not mature within 15s window.
    // Fix: 30 retries × 2000ms base + 5s extra every 3rd = ~90s total (3x Kaspa maturity + buffer).
    let paidBroadcastOk = false;
    const MAX_BCAST_RETRIES = 30;
    for (let pa = 1; pa <= MAX_BCAST_RETRIES; pa++) {
      try {
        const pr = await sendCommandAsync(takerRelayNodeId, {
          type: 'send_broadcast',
          channel: 'kanet-exchange',
          message: paidMsg,
        });
        if (pr?.txId) { paidBroadcastOk = true; break; }
      } catch (err) {
        console.error(`[exchange-autosend] paid broadcast attempt ${pa}/${MAX_BCAST_RETRIES}: ${err.message}`);
      }
      if (pa < MAX_BCAST_RETRIES) {
        const baseMs = 2000;
        const extraMs = pa % 3 === 0 ? 5000 : 0;
        await new Promise(r => setTimeout(r, baseMs + extraMs));
      }
    }

    recordChainEvent({
      txid: txId,
      eventType: 'exchange_kas_sent',
      fromAddress: offer.taker,
      toAddress: offer.maker,
      payload: JSON.stringify({ offer_id: offer.id, amount, payment_tx: txId }),
    });

    if (!paidBroadcastOk) {
      // KAS sent but paid broadcast failed — do NOT advance state.
      // Maker node won't know about payment. Next proactive cycle or manual trigger can retry.
      console.error(`[exchange-autosend] paid broadcast failed after 5 attempts for offer ${offer.id.slice(0,8)} — state NOT advanced`);
      recordChainEvent({
        txid: txId,
        eventType: 'exchange_paid_broadcast_failed',
        fromAddress: offer.taker,
        payload: JSON.stringify({ offer_id: offer.id, payment_tx: txId, reason: 'broadcast_failed_5_attempts' }),
      });
      return;
    }

    console.log(`[exchange-autosettle] Broadcast kanet_exchange_paid_v1 for ${wantAsset}/${wantChain} payment`);

    // Broadcast succeeded — NOW safe to trigger verification
    processPaymentSubmit({ offer_id: offer.id, payment_tx: txId, payment_chain: wantChain });
    console.log(`[exchange-autosettle] verification triggered for offer ${offer.id.slice(0,8)}`);

  } catch (err) {
    console.error(`[exchange-autosend] Failed: ${err.message}`);
    recordChainEvent({
      eventType: 'exchange_kas_send_failed',
      fromAddress: offer.taker,
      payload: JSON.stringify({ offer_id: offer.id, error: err.message }),
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Check if a KAS address belongs to a local relay node.
 */
function _findLocalRelay(kasAddress) {
  if (!kasAddress) return null;
  const relay = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(kasAddress);
  return relay?.id || null;
}
