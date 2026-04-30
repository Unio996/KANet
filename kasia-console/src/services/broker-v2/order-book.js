// ════════════════════════════════════════════════════════════════
// broker-v2/order-book.js — partial fill orchestration (限价单簿核心)
//
// Spec: docs/NEW-BROKER-PROPOSAL.md v2 §"order-book.js" + 5 corner
// Lock: 三方共识 7e776598dc + NWT v2 spec ecdd98874
//
// MVP 现状: 调旧 buy/sell-handler buyPreview/finalizeBuy/sellPreview/finalizeSell export
//   - chain-side partial fill 协议改 (NWT territory) ship 后, finalize 自动 partial fill 生效
//   - phase 1 lock at preview, price_tolerance=0.01 hardcoded
//
// 提供 3 API:
// - computePreview(peer, draft): 调旧 buyPreview/sellPreview 算价 + 拼 preview_text
// - publishOrder(peer, draft): 调旧 finalizeBuy/finalizeSell publish exchange_offer (含 partial fill cols)
// - getOrderStatus(peer): SELECT retail_dex_orders + JOIN exchange_offers (filled_qty / settle_grace)
// ════════════════════════════════════════════════════════════════

import { sqlite } from '../../db/client.js';

const PHASE_1_TOLERANCE = 0.01;  // 1% phase 1 lock (cover user_spread + protocol tolerance)
const SETTLE_GRACE_MIN = 5;      // 5min in-flight chunk grace

/**
 * Compute preview (算价 + 拼 preview_text).
 * 调旧 buy-handler.buyPreview / sell-handler.sellPreview 复用 production algorithm.
 *
 * @param {string} peer - user kasia 地址
 * @param {object} draft - state.getActiveDraft 返回的 row
 * @returns {Promise<{ preview_text, mid_price_at_quote, broker_fee_kas, net_delivery_kas, ok, error }>}
 */
export async function computePreview(peer, draft) {
  if (!draft) return { ok: false, error: 'no draft' };
  const { side, qty, pay_chain, pay_address, asset } = draft;
  // bug 10 fix (J2 r25 follow-up, owner_88kas_t6_limit_retention):
  // parser captures 'price 设定 0.0336' → state.price='limit:0.0336'. order-book 之前不传给 v1 preview,
  // user limit price 静默丢弃. 修: parse draft.price 'limit:X' → numeric, pipe to v1 sellPreview/buyPreview
  // limit_price 参数, v1 已支持 limit price acknowledgment (broker-sell-handler L189-201).
  const limitPriceMatch = String(draft.price || '').match(/^limit:(\d+\.?\d*)$/);
  const limitPrice = limitPriceMatch ? parseFloat(limitPriceMatch[1]) : null;

  if (side === 'buy_kas') {
    const { buyPreview } = await import('../broker-buy-handler.js');
    const result = await buyPreview({
      user_kasia: peer,
      qty: parseFloat(qty),
      pay_chain,
      give_asset: asset || 'KAS',
      receive_address: pay_address || null,
      limit_price: limitPrice,
      // phase 1 lock: tolerance 1% hardcoded (post 1 周 gate phase 2 separate)
    });
    if (!result?.ok) return { ok: false, error: result?.error || 'buyPreview failed', message: result?.message };
    return {
      ok: true,
      preview_text: result.preview_text,
      mid_price_at_quote: result.unit_price,
      broker_fee_kas: 0,  // BUY: broker 不收 KAS fee (USDT spread 含)
      net_delivery_kas: parseFloat(qty),
    };
  }

  if (side === 'sell_kas') {
    // SELL 路径 schema 命名: retail_dex_orders.pay_chain/pay_address 在 SELL 实际是
    // user 收 USDT 的 chain + EVM addr. broker 视角 'pay' = broker 付 USDT 到 user.
    // sellPreview/finalizeSell signature 用 recv_chain/recv_address (user 收 USDT 视角).
    const { sellPreview } = await import('../broker-sell-handler.js');
    const result = await sellPreview({
      user_kasia: peer,
      qty: parseFloat(qty),
      recv_chain: pay_chain,
      recv_address: pay_address,
      limit_price: limitPrice,
    });
    if (!result?.ok) return { ok: false, error: result?.error || 'sellPreview failed', message: result?.message };
    return {
      ok: true,
      preview_text: result.preview_text,
      mid_price_at_quote: result.unit_price,
      broker_fee_kas: result.broker_fee_kas || 0.1,
      net_delivery_kas: result.net_delivery_kas || (parseFloat(qty) - 0.1),
    };
  }

  return { ok: false, error: `unknown side: ${side}` };
}

/**
 * Publish order to chain (限价单簿挂单).
 * 调旧 finalizeBuy / finalizeSell — chain-side 协议改后自动 partial fill 生效.
 *
 * @param {string} peer
 * @param {object} draft
 * @returns {Promise<{ ok, offer_id?, ack_text?, error? }>}
 */
export async function publishOrder(peer, draft) {
  if (!draft) return { ok: false, error: 'no draft' };
  const { side, qty, pay_chain, pay_address, asset } = draft;

  if (side === 'buy_kas') {
    // Phase 1 BUY 路径 = 旧 broker 多 maker 拼 (即买即得, 不 partial fill).
    // Phase 2 future: BUY 也改 user 挂买单 limit order book 等 taker 来卖 KAS.
    // finalizeBuy return shape: { ok, picks[], total_kas, total_usdt, pay_chain, n_payments, broker_dynamic_quote, note }.
    // 无单 offer_id (multi-maker 各自 picks).
    const { finalizeBuy } = await import('../broker-buy-handler.js');
    const result = await finalizeBuy({
      user_kasia: peer,
      qty: parseFloat(qty),
      pay_chain,
      give_asset: asset || 'KAS',
      receive_address: pay_address || null,
    });
    if (!result?.ok) return { ok: false, error: result?.error || 'finalizeBuy failed' };
    const ackBase = result.note || `✓ 买 ${qty} ${asset || 'KAS'} 单已建. 共 ${result.n_payments || 1} 笔付款, 总 ${result.total_usdt} USDT (${pay_chain.toUpperCase()}).`;
    return {
      ok: true,
      offer_id: null,  // phase 1 BUY multi-maker 拼, 无单 offer_id (picks 各 maker offer_id 在 result.picks[])
      buy_picks: result.picks || [],  // expose picks for advanced UX
      ack_text: ackBase,
    };
  }

  if (side === 'sell_kas') {
    // SELL 路径同 sellPreview 命名: recv_chain/recv_address (user 收 USDT 视角).
    // T-NWT-2026-04-30 L5c v1/v2 routing mutex: 传 draft.id 给 finalizeSell, UPDATE 现 'aligning' row,
    // 不再 INSERT 新 UUID row (Owner 真测 SELL 58 KAS 双 row 真因).
    const { finalizeSell } = await import('../broker-sell-handler.js');
    const result = await finalizeSell({
      user_kasia: peer,
      qty: parseFloat(qty),
      recv_chain: pay_chain,
      recv_address: pay_address,
      existing_order_id: draft.id,
    });
    if (!result?.ok) return { ok: false, error: result?.error || 'finalizeSell failed' };
    return {
      ok: true,
      offer_id: result.order_id || result.offer_id,
      ack_text: result.ack_text || `✓ 卖单已挂 ${qty} KAS, 1% 价格浮动, 等 taker 来接 (TTL 内多 taker 累积成交).`,
    };
  }

  return { ok: false, error: `unknown side: ${side}` };
}

/**
 * Get order status (partial fill 累积 + sub-chunks).
 * router 主动触发 (chain_events broker_kas_delivered) OR 被动 query (user '查单').
 *
 * @param {string} peer
 * @returns {{ ok, qty, filled_qty, unfilled_qty, expires_at, state, sub_chunks }}
 */
export function getOrderStatus(peer) {
  if (!peer) return { ok: false };
  // post NWT v84: state enum 不扩, partial fill 进度推自 filled_qty/qty 比值.
  // active state list = aligning / awaiting_payment / paid / executing / refunding (5).
  const order = sqlite.prepare(`
    SELECT id, qty, filled_qty, expires_at, state, exchange_offer_id, settle_grace_until
    FROM retail_dex_orders
    WHERE user_kasia_address = ?
      AND state IN ('aligning', 'awaiting_payment', 'paid', 'executing', 'refunding')
    ORDER BY created_at DESC LIMIT 1
  `).get(peer);
  if (!order) return { ok: false };

  const qtyN = parseFloat(order.qty || 0);
  const filledN = parseFloat(order.filled_qty || 0);

  // sub-chunks audit trail from chain_events (per-chunk fill records)
  const subChunks = sqlite.prepare(`
    SELECT txid, payload, observed_at FROM chain_events
    WHERE event_type = 'broker_chunk_filled'
      AND payload LIKE ?
    ORDER BY observed_at ASC
  `).all(`%"order_id":"${order.id}"%`);

  return {
    ok: true,
    order_id: order.id,
    qty: order.qty,
    filled_qty: order.filled_qty || 0,
    unfilled_qty: (qtyN - filledN).toFixed(6),
    expires_at: order.expires_at,
    state: order.state,
    settle_grace_until: order.settle_grace_until || null,
    exchange_offer_id: order.exchange_offer_id,
    sub_chunks: subChunks.map(c => {
      let p = {};
      try { p = JSON.parse(c.payload || '{}'); } catch {}
      return {
        chunk_qty: p.chunk_qty,
        chunk_price: p.chunk_price,
        taker_addr: p.taker_addr,
        tx_hash: c.txid,
        observed_at: c.observed_at,
      };
    }),
  };
}

// Constants for NWT chain-side partial fill 协议改 wire (price_tolerance / settle_grace_min defaults).
export const PARTIAL_FILL_DEFAULTS = {
  PHASE_1_TOLERANCE,
  SETTLE_GRACE_MIN,
};
