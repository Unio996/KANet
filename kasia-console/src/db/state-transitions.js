// state-transitions.js — Layer 1: DB schema invariant wrapper (Owner 04:55 钦定 phase 3).
//
// "INSERT-before-confirm" 是 broker 全部 architectural defect 真因. 三方 phase 1 dig 共识:
// - broker-cancel-refund step 5 UPDATE retail_dex_orders state='cancelled_refunded' BEFORE sendKas
// - broker-intake-watcher L237-239 INSERT chain_events 'broker_kas_refunded' BEFORE await sendKas
//
// Wrapper 强校验: state advance 必含 tx_hash + tx_hash 真 chain broadcast confirmed (caller 拿 txId
// from enqueueVerified). lint-kanet 加 rule (Layer 5 NWT 接) 检 raw UPDATE retail_dex_orders SET
// state IN ('cancelled_refunded'/'completed'/'timed_out_refunded') 必经 wrapper.

import { sqlite } from './client.js';
import { randomUUID } from 'crypto';

/**
 * Layer 1 — Mark order refunded (user_cancel OR timeout_sweep).
 *
 * @param {string} orderId — retail_dex_orders.id
 * @param {string} refundTxHash — Kasia chain TX from enqueueVerified.await
 * @param {'user_cancel'|'timeout_sweep'|'manual'} source — 真**真 audit log
 * @throws Error if refundTxHash missing OR order not found
 */
export function markOrderRefunded(orderId, refundTxHash, source = 'user_cancel') {
  if (!refundTxHash) {
    throw new Error(`markOrderRefunded: refund_tx_hash required (Layer 1 invariant: state advance 必含 tx)`);
  }

  const order = sqlite.prepare(`SELECT id, state, user_kasia_address, qty, exchange_offer_id FROM retail_dex_orders WHERE id=?`).get(orderId);
  if (!order) throw new Error(`markOrderRefunded: order ${orderId} not found`);

  const targetState = source === 'timeout_sweep' ? 'timed_out_refunded' : 'cancelled_refunded';

  sqlite.prepare(`
    UPDATE retail_dex_orders
    SET state=?, refund_tx_hash=?, updated_at=?
    WHERE id=?
  `).run(targetState, refundTxHash, new Date().toISOString(), orderId);

  // Audit log: chain_events broker_kas_refunded 真**真 含 verified tx_hash, 不再 fake INSERT.
  sqlite.prepare(`
    INSERT INTO chain_events (txid, from_address, to_address, event_type, payload, observed_by, observed_at)
    VALUES (?, NULL, ?, 'broker_kas_refunded', ?, ?, datetime('now'))
  `).run(
    refundTxHash,
    order.user_kasia_address,
    JSON.stringify({
      offer_id: order.exchange_offer_id,
      order_id: order.id,
      user_kasia_address: order.user_kasia_address,
      amount: parseFloat(order.qty),
      tx: refundTxHash,
      source,
    }),
    `state-transitions:${source}`,
  );

  // events 表 audit (Brain 可见)
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'broker', 'order_refunded', 'state-transitions', 'info', ?, ?, ?)
    `).run(
      randomUUID(),
      `Order ${orderId.slice(0, 8)} → ${targetState} (${source}, ${order.qty} KAS, tx ${refundTxHash.slice(0, 12)})`,
      JSON.stringify({ orderId, source, targetState, refundTxHash, qty: order.qty }),
      new Date().toISOString(),
    );
  } catch { /* events 表 INSERT 失败不阻断主路径 */ }

  return { ok: true, orderId, state: targetState, refundTxHash, source };
}

/**
 * Layer 1 — Mark refund FAILED (sendKas chain broadcast fail).
 *
 * 不让 broker DM ack 撒谎"已退还". caller (broker-cancel-refund / intake-watcher) catch
 * enqueueVerified.reject → 调此. retail_dex_orders.state 留 'awaiting_payment' (broker 仍持 KAS),
 * 加 events critical alert 真**真 Owner / Brain 可见.
 *
 * @param {string} orderId
 * @param {string} errorMsg — sendKas error (relay return ok:false / Invalid Kaspa address / 等)
 */
export function markRefundFailed(orderId, errorMsg) {
  const order = sqlite.prepare(`SELECT id, state, user_kasia_address, qty FROM retail_dex_orders WHERE id=?`).get(orderId);
  if (!order) {
    console.warn(`[state-transitions] markRefundFailed: order ${orderId} not found`);
    return { ok: false, reason: 'order_not_found' };
  }

  // critical alert event (Brain + Owner UI 可见)
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'broker', 'refund_failed', 'state-transitions', 'error', ?, ?, ?)
    `).run(
      randomUUID(),
      `🚨 Order ${orderId.slice(0, 8)} refund FAILED: ${errorMsg?.slice(0, 80)}. broker 仍持 ${order.qty} KAS, 不退 user, 真**人工**介入`,
      JSON.stringify({ orderId, qty: order.qty, peer: order.user_kasia_address, error: errorMsg }),
      new Date().toISOString(),
    );
  } catch { /* fall */ }

  return { ok: true, orderId, alerted: true };
}
