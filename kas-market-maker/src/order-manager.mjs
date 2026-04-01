/**
 * order-manager.mjs — Order lifecycle management
 * Parses incoming messages, creates orders, manages state transitions.
 */

import { createOrder, updateOrderStatus, getOrder, getPendingOrders } from './db.mjs';

// Parse order intent from chat message
// Examples: "buy 2755 KAS paying 100 USDT on BNB"
//           "sell 3000 KAS want USDT on SOL"
const ORDER_RE = /\b(buy|sell)\s+(\d+(?:\.\d+)?)\s*KAS\b.*?\b(\d+(?:\.\d+)?)\s*(?:USDT|usdt)\b.*?\b(?:on|via)\s*(bnb|sol|eth|tron)\b/i;

export function parseOrderMessage(message) {
  const match = message.match(ORDER_RE);
  if (!match) return null;
  return {
    side: match[1].toLowerCase(),     // 'buy' or 'sell'
    kasAmount: parseFloat(match[2]),
    usdtAmount: parseFloat(match[3]),
    chain: match[4].toLowerCase(),
  };
}

export function createNewOrder({ side, kasAmount, usdtAmount, price, chain, customerKaspaAddress, mmReceiveAddress, batchPlan }) {
  const orderIds = [];
  for (const batch of batchPlan) {
    const id = createOrder({
      side,
      kasAmount: batch.kasAmount,
      usdtAmount: batch.usdtAmount,
      price,
      chain,
      customerKaspaAddress,
      customerPayAddress: null, // filled by customer
      mmReceiveAddress,
      batchIndex: batch.index,
      batchTotal: batch.total,
    });
    orderIds.push(id);
  }
  return orderIds;
}

export function markAwaitingPayment(orderId) { updateOrderStatus(orderId, 'awaiting_payment'); }
export function markPaymentVerified(orderId, txHash) { updateOrderStatus(orderId, 'payment_verified', { paymentTxhash: txHash }); }
export function markKasSent(orderId, txHash) { updateOrderStatus(orderId, 'kas_sent', { kasTxhash: txHash }); }
export function markCompleted(orderId) { updateOrderStatus(orderId, 'completed'); }
export function markExpired(orderId) { updateOrderStatus(orderId, 'expired'); }

export function getActiveOrders() { return getPendingOrders(); }

/** Check for expired quotes (older than validMinutes) */
export function expireStaleOrders(validMinutes) {
  const cutoff = new Date(Date.now() - validMinutes * 60000).toISOString();
  const stale = getPendingOrders().filter(o => o.status === 'quoted' && o.created_at < cutoff);
  for (const o of stale) markExpired(o.id);
  return stale.length;
}
