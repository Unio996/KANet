/**
 * Order State Machine — Free Market core logic
 *
 * One state machine, three modes (auto/approval/manual).
 * Mode only changes WHO triggers the next step, not the logic.
 *
 * State flow:
 *   published → accepted → paying → paid → verified → delivering → completed
 *                                                                ↘ disputed
 *   Any state → cancelled / expired (timeout)
 *
 * Each transition:
 *   1. Validate: is this transition legal from current state?
 *   2. Execute: do the work (send payment, verify, deliver)
 *   3. Record: update DB + timestamps
 *   4. Link: sync counterparty order if exists
 *   5. Next: in auto mode, trigger next step; in approval, notify owner
 */

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';
import { releaseFunds, spendFunds } from './fund-lock.js';
import { createExecution } from './execution-state.js';
import { recordChainEvent } from './chain-event.js';

// ── State definitions ──────────────────────────────────────────

const VALID_TRANSITIONS = {
  published:          ['accepted', 'cancelled', 'expired'],
  // Bug NWT-N5 fix 5/18: accepted → paid direct allowed (paid_v1 是 already-paid proof, 不是 intent).
  // paying state 是 maker-side intent (内部 attempt), OTC taker paid_v1 直跳 paid 合理 — chain TX 已 broadcast 证明.
  accepted:           ['paying', 'paid', 'published', 'cancelled', 'expired'],
  paying:             ['paid', 'accepted', 'cancelled', 'expired'],     // can revert to accepted on failure
  // ── POST-PAYMENT: 已付款后只能 → disputed，不能 expired/cancelled（保护付款方）──
  paid:               ['verified', 'disputed'],
  verified:           ['delivering', 'disputed'],
  delivering:         ['completed', 'verified', 'disputed'],            // can revert to verified on failure
  completed:          [],
  cancelled:          [],
  expired:            [],
  disputed:           ['resolved', 'cancelled', 'completed', 'escalated'],
  escalated:          ['resolved', 'cancelled'],   // 冻结等待人工介入
  resolved:           [],   // dispute 查实后 → 完结
};

const TERMINAL_STATES = ['completed', 'cancelled', 'expired', 'resolved', 'escalated'];

const TIMESTAMP_FIELDS = {
  accepted: 'accepted_at',
  paying: 'paid_at',      // start of payment process
  paid: 'paid_at',
  verified: 'verified_at',
  delivering: 'delivered_at',
  completed: 'completed_at',
  cancelled: 'completed_at',
  expired: 'completed_at',
  resolved: 'completed_at',
  disputed: 'completed_at',
  escalated: 'completed_at',
};

// ── Core API ───────────────────────────────────────────────────

/**
 * Create a new order (from broadcast accept or manual publish).
 */
const _createOrderTx = sqlite.transaction(({
  id, relayNodeId, agentAddress, side, kasAmount, price, chain,
  peerAddress, counterpartyOrderId, broadcastTxid, mode, timeoutMinutes,
}) => {
  const usdtAmount = kasAmount * price;
  const now = new Date().toISOString();

  sqlite.prepare(`
    INSERT INTO mm_orders (
      id, relay_node_id, agent_address, side, kas_amount, usdt_amount, price, chain,
      peer_address, counterparty_order_id, broadcast_txid,
      mode, status, timeout_minutes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
  `).run(
    id, relayNodeId, agentAddress, side, kasAmount, usdtAmount, price, chain,
    peerAddress, counterpartyOrderId, broadcastTxid,
    mode, timeoutMinutes, now,
  );

  console.log(`[order-machine] Created: ${id.slice(0, 8)} ${side} ${kasAmount} KAS @ ${price} (${mode})`);
  return { id, status: 'published', created_at: now };
});

export function createOrder({
  id = null, relayNodeId, agentAddress, side, kasAmount, price, chain,
  peerAddress = null, counterpartyOrderId = null,
  broadcastTxid = null, mode = '', timeoutMinutes = 30,
}) {
  return _createOrderTx({
    id: id || randomUUID(), relayNodeId, agentAddress, side, kasAmount, price, chain,
    peerAddress, counterpartyOrderId, broadcastTxid, mode, timeoutMinutes,
  });
}

/**
 * Transition an order to a new state.
 * Returns { ok, order, error }.
 *
 * All DB mutations (status change + fund_locks + chain_events + counterparty sync)
 * run inside a single SQLite transaction with optimistic locking.
 * _autoAdvance runs AFTER the transaction commits (async, non-blocking).
 */
const _transitionTx = sqlite.transaction((orderId, newStatus, { txHash = null, reason = null, force = false } = {}) => {
  const order = sqlite.prepare('SELECT * FROM mm_orders WHERE id = ?').get(orderId);
  if (!order) return { ok: false, error: 'Order not found' };

  const currentStatus = order.status;

  // Validate transition
  if (!force) {
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(newStatus)) {
      return { ok: false, error: `Cannot transition from "${currentStatus}" to "${newStatus}"` };
    }
  }

  // Build update
  const updates = ['status = ?'];
  const values = [newStatus];

  // Timestamp
  const tsField = TIMESTAMP_FIELDS[newStatus];
  if (tsField) {
    updates.push(`${tsField} = ?`);
    values.push(new Date().toISOString());
  }

  // Clear timestamps and links on revert to published
  if (newStatus === 'published') {
    updates.push('accepted_at = NULL');
    updates.push('peer_address = NULL');
    updates.push('counterparty_order_id = NULL');
  }

  // TX hashes
  if (txHash) {
    if (newStatus === 'paid' || newStatus === 'paying') {
      updates.push('payment_txhash = ?');
      values.push(txHash);
    } else if (newStatus === 'delivering' || newStatus === 'completed') {
      updates.push('kas_txhash = ?');
      values.push(txHash);
    }
  }

  // Cancel reason
  if (reason && (newStatus === 'cancelled' || newStatus === 'expired' || newStatus === 'disputed')) {
    updates.push('cancel_reason = ?');
    values.push(reason);
  }

  // ── Optimistic lock: ensure status hasn't changed between SELECT and UPDATE ──
  values.push(orderId, currentStatus);
  const result = sqlite.prepare(`UPDATE mm_orders SET ${updates.join(', ')} WHERE id = ? AND status = ?`).run(...values);
  if (result.changes === 0) {
    return { ok: false, error: `Optimistic lock failed: order ${orderId.slice(0, 8)} status changed concurrently` };
  }

  console.log(`[order-machine] ${orderId.slice(0, 8)}: ${currentStatus} → ${newStatus}${reason ? ' (' + reason + ')' : ''}`);

  // ── fund_locks 自动联动 ──
  if (newStatus === 'completed' || newStatus === 'resolved') {
    spendFunds(orderId);
  } else if (newStatus === 'cancelled' || newStatus === 'expired' || newStatus === 'published') {
    releaseFunds(orderId);
  }

  // ── chain_events 归档（有 txHash 的状态变化）──
  if (txHash) {
    recordChainEvent({
      txid: txHash,
      eventType: newStatus === 'paying' || newStatus === 'paid' ? 'payment' : 'kas_delivery',
      fromAddress: order.agent_address,
      toAddress: order.peer_address,
      observedBy: 'system',
      payload: { orderId, side: order.side, kasAmount: order.kas_amount, status: newStatus },
    });
  }

  // Sync counterparty order status (inside same transaction — atomic)
  _syncCounterparty(order, newStatus, txHash);

  const updated = sqlite.prepare('SELECT * FROM mm_orders WHERE id = ?').get(orderId);
  return { ok: true, order: updated };
});

export function transition(orderId, newStatus, opts = {}) {
  const result = _transitionTx(orderId, newStatus, opts);

  // ── Auto-advance runs AFTER transaction commits (async, non-blocking) ──
  if (result.ok) {
    _autoAdvance(result.order);
  }

  return result;
}

/**
 * Link two orders as counterparties (buyer ↔ seller).
 */
const _linkOrdersTx = sqlite.transaction((orderId1, orderId2) => {
  sqlite.prepare('UPDATE mm_orders SET counterparty_order_id = ? WHERE id = ?').run(orderId2, orderId1);
  sqlite.prepare('UPDATE mm_orders SET counterparty_order_id = ? WHERE id = ?').run(orderId1, orderId2);
  console.log(`[order-machine] Linked: ${orderId1.slice(0, 8)} ↔ ${orderId2.slice(0, 8)}`);
});

export function linkOrders(orderId1, orderId2) {
  _linkOrdersTx(orderId1, orderId2);
}

/**
 * Get order by ID with counterparty info.
 */
export function getOrder(orderId) {
  const order = sqlite.prepare('SELECT * FROM mm_orders WHERE id = ?').get(orderId);
  if (!order) return null;

  if (order.counterparty_order_id) {
    order._counterparty = sqlite.prepare('SELECT id, side, status, agent_address, peer_address FROM mm_orders WHERE id = ?')
      .get(order.counterparty_order_id) || null;
  }

  return order;
}

/**
 * List active orders for an agent.
 */
export function listOrders({ agentAddress = null, relayNodeId = null, status = null, limit = 50 } = {}) {
  const conditions = [];
  const params = [];

  if (agentAddress) { conditions.push('agent_address = ?'); params.push(agentAddress); }
  if (relayNodeId) { conditions.push('relay_node_id = ?'); params.push(relayNodeId); }
  if (status) {
    if (status === 'active') {
      conditions.push('status NOT IN (?, ?, ?)');
      params.push('completed', 'cancelled', 'expired');
    } else {
      conditions.push('status = ?');
      params.push(status);
    }
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(limit);

  return sqlite.prepare(`SELECT * FROM mm_orders ${where} ORDER BY created_at DESC LIMIT ?`).all(...params);
}

/**
 * Check and expire timed-out orders.
 * Called periodically (e.g., every minute).
 */
// Post-payment statuses: 资金已流出，超时只能 → disputed（保护付款方）
const POST_PAYMENT_STATUSES = new Set(['paid', 'verified', 'delivering']);

export function expireTimedOut() {
  const now = Date.now();
  // Read outside transaction — snapshot of candidates
  const active = sqlite.prepare(
    "SELECT id, status, created_at, accepted_at, timeout_minutes FROM mm_orders WHERE status NOT IN ('completed', 'cancelled', 'expired', 'resolved', 'disputed') AND timeout_minutes > 0"
  ).all();

  let expired = 0;
  let disputed = 0;
  for (const order of active) {
    const startTime = new Date(order.accepted_at || order.created_at).getTime();
    const elapsedMin = (now - startTime) / 60000;
    if (elapsedMin >= order.timeout_minutes) {
      // Each transition() is already individually atomic (wrapped in _transitionTx)
      // Optimistic lock inside transition() prevents double-expiry
      if (POST_PAYMENT_STATUSES.has(order.status)) {
        const r = transition(order.id, 'disputed', { reason: `Timeout after ${order.timeout_minutes} minutes (post-payment protection)` });
        if (r.ok) disputed++;
      } else {
        const r = transition(order.id, 'expired', { reason: `Timeout after ${order.timeout_minutes} minutes` });
        if (r.ok) expired++;
      }
    }
  }

  if (expired > 0 || disputed > 0) {
    console.log(`[order-machine] Timeout: ${expired} expired, ${disputed} disputed (post-payment)`);
  }
  return expired + disputed;
}

// ── Internal ───────────────────────────────────────────────────

/**
 * When one side of a trade changes state, sync the counterparty.
 * E.g., when buyer's order goes to "paid", seller's order should also update.
 */
function _syncCounterparty(order, newStatus, txHash) {
  if (!order.counterparty_order_id) return;

  const counter = sqlite.prepare('SELECT id, status FROM mm_orders WHERE id = ?').get(order.counterparty_order_id);
  if (!counter) return;

  // Don't sync if counterparty is already in a terminal state
  if (TERMINAL_STATES.includes(counter.status)) return;

  // Sync rules (buyer action → seller state, and vice versa)
  const syncMap = {
    // When buyer pays, seller should see "paid"
    paid: 'paid',
    // When payment is verified, both should be "verified"
    verified: 'verified',
    // When KAS is delivered, both complete
    completed: 'completed',
    // Cancellation cascades
    cancelled: 'cancelled',
    expired: 'expired',
    // Dispute cascades — 一方 disputed，对手方也必须知道
    disputed: 'disputed',
  };

  const counterNewStatus = syncMap[newStatus];
  if (counterNewStatus && counter.status !== counterNewStatus) {
    // 对手方同步用 force — 买方 paying→paid 时卖方从 accepted 直接到 paid 是合理的
    // 卖方不需要经过 paying（付钱的不是卖方）
    transition(counter.id, counterNewStatus, { txHash, reason: `Synced from counterparty ${order.id.slice(0, 8)}`, force: true });
  }
}

/**
 * Phase 3: Auto-advance after state transition.
 * In auto mode, each state change triggers the next step automatically.
 * Uses internal HTTP to reuse existing /action logic (already tested).
 * Async, non-blocking — transition() returns immediately.
 */
function _autoAdvance(order) {
  if (!order) return;

  // 读全局 mode（order.mode 为空时 fallback）
  const mode = order.mode || (() => {
    try {
      const row = sqlite.prepare("SELECT value_encrypted as val FROM config_entries WHERE key = 'agent_trade_mode'").get();
      return row?.val || 'manual';
    } catch { return 'manual'; }
  })();

  if (mode === 'manual') return; // manual 不自动推进

  const port = process.env.PORT || 3100;
  const baseUrl = `http://localhost:${port}`;

  // 确定下一步操作
  let nextAction = null;
  if (order.status === 'accepted' && order.side === 'buy') nextAction = 'pay_usdt';
  if (order.status === 'verified' && order.side === 'sell') nextAction = 'send_kas';
  if (!nextAction) return;

  // ── Circuit breaker: 连续失败 3 次后停止自动推进 ──
  // 防止 pay_usdt 失败→回退 accepted→auto-advance→再 pay_usdt 的死循环
  const MAX_AUTO_FAILURES = 3;
  try {
    const recentFailures = sqlite.prepare(
      "SELECT COUNT(*) as cnt FROM chain_events WHERE payload LIKE ? AND event_type = 'payment_failed' AND observed_at > datetime('now', '-1 hour')"
    ).get(`%${order.id}%`);
    if (recentFailures.cnt >= MAX_AUTO_FAILURES) {
      console.log(`[auto-advance] ${order.id.slice(0, 8)}: CIRCUIT BREAKER — ${recentFailures.cnt} failures in 1h, stopping auto-advance`);
      return;
    }
  } catch { /* DB error — proceed cautiously */ }

  if (mode === 'auto') {
    // Auto 模式：直接执行
    console.log(`[auto-advance] ${order.id.slice(0, 8)}: ${order.status} → auto ${nextAction}`);
    setTimeout(async () => {
      try {
        const res = await fetch(`${baseUrl}/api/trade/mm-orders/${order.id}/action`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: nextAction }),
        });
        const data = await res.json();
        console.log(`[auto-advance] ${nextAction}: ${data.ok ? 'OK' : 'FAIL ' + (data.error || '').slice(0, 50)}`);
      } catch (err) {
        console.log(`[auto-advance] ${nextAction} error: ${err.message}`);
      }
    }, 2000);
  } else if (mode === 'approval') {
    // Approval 模式：创建 pending execution_state，等 owner 确认
    try {
      // createExecution imported at top
      const usdtAmt = order.usdt_amount || order.kas_amount * (order.price || 0);
      const summary = nextAction === 'pay_usdt'
        ? `支付 ${usdtAmt.toFixed(2)} USDT（${(order.chain || 'bnb').toUpperCase()} 链），换取 ${order.kas_amount} KAS`
        : `发送 ${order.kas_amount} KAS 给对手方，完成交割`;
      const exec = createExecution({
        orderId: order.id, type: nextAction, source: 'system', agentAddress: order.agent_address,
        amount: nextAction === 'send_kas' ? order.kas_amount : usdtAmt,
        asset: nextAction === 'send_kas' ? 'kas' : 'usdt_' + (order.chain || 'bnb'),
        approvalTimeout: 15,
        displaySummary: summary,
      });
      console.log(`[auto-advance] ${order.id.slice(0, 8)}: ${order.status} → PENDING approval for ${nextAction} (exec: ${exec.id.slice(0, 8)})`);
    } catch (err) {
      console.log(`[auto-advance] approval pending error: ${err.message}`);
    }
  }

  // paid → auto-verify 已由 trading.js pay_usdt 成功后安排（60s 延迟），不需要在这里重复
}
