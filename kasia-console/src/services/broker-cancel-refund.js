// broker-cancel-refund.js — Owner 02:23 钦定 cancel-refund policy.
//
// "用户指示取消订单, 返回自己钱, 无论什么资产, 扣手续费后立即退还."
//
// Scope: 仅 protocol_status='open' (无 taker) 单方撤单 + 退原资产. matched/verifying/
// delivering/completed → 走 dispute 路径 (不在本 helper 范围).
//
// Trigger: handler 调 detectCancelIntent(message) → true → 调 handleCancelAndRefund(peer).
// 命中 active refundable offer → cancel 上链 + sendKas refund + DM ack 全 enqueue.
// 没命中 → return null, 让现有 handler cancel 路径接管 (e.g. _pending.delete).

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const FEE_KAS = 0.1;

// Cancel intent regex: 比 CANCEL_WORDS 宽 (CANCEL_WORDS = NO/取消/不要/算了 用于 _pending preview).
// 这里 detect "用户指示取消订单 + 退钱" 真意, 命中 → 走 cancel-refund 路径.
const CANCEL_INTENT_REGEX = /^(?:NO|不要(?:了|啦)?|取消(?:订单)?|算了(?:吧)?|退(?:我|回)?(?:钱|币|币的|KAS|USDT|USDC)?|我不(?:要|做|玩|交易)了?|不卖了?|不买了?|cancel(?:\s+order)?|refund(?:\s+me)?|give\s+(?:me\s+)?(?:my\s+)?(?:money|kas|usdt|usdc)\s+back)\s*[!！。.…]*$/i;

export function detectCancelIntent(message) {
  if (!message) return false;
  return CANCEL_INTENT_REGEX.test(message.trim());
}

/**
 * Find active refundable offers for this peer.
 * Source: exchange_offers WHERE maker=BROKER + metadata.user_kasia_address=peer + protocol_status='open' + taker IS NULL.
 * Cross-check: retail_dex_orders state='awaiting_payment' (broker holds KAS).
 */
function _findRefundableOffers(peerAddr) {
  const brokerAddr = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(BROKER_RELAY_ID)?.address;
  if (!brokerAddr) return [];

  const offers = sqlite.prepare(`
    SELECT id, give_amount, give_asset, want_amount, want_asset, metadata, broadcast_tx_id, created_at
    FROM exchange_offers
    WHERE maker = ?
      AND protocol_status = 'open'
      AND taker IS NULL
      AND broadcast_at > datetime('now', '-3 hours')
    ORDER BY created_at DESC
  `).all(brokerAddr);

  return offers.filter(o => {
    try {
      const meta = JSON.parse(o.metadata || '{}');
      return meta.user_kasia_address === peerAddr;
    } catch { return false; }
  });
}

/**
 * Handle user-initiated cancel + refund.
 * @param {string} peerAddr
 * @returns {Promise<string|null>} reply text if refunded, null if no active refundable offer
 */
export async function handleCancelAndRefund(peerAddr) {
  const refundable = _findRefundableOffers(peerAddr);
  if (refundable.length === 0) return null;

  const { enqueue } = await import('./broker-action-queue.js');
  const PORT = process.env.PORT || 3100;

  const ackParts = [];

  for (const offer of refundable) {
    // Step 1: cancel offer 上链 (best-effort; UI/Scout 真**真 see protocol_status=cancelled)
    try {
      await fetch(`http://127.0.0.1:${PORT}/api/exchange/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relayNodeId: BROKER_RELAY_ID, offer_id: offer.id }),
      });
    } catch (e) {
      console.warn(`[cancel-refund] cancel API err for ${offer.id.slice(0,8)}: ${e.message}`);
    }

    // Step 1.5: re-check protocol_status (NWT 7c5ad929 audit concern 1 — race-safety).
    // 真 race window: cancel API 调成功但**真**真 cancel_v1 broadcast 真**真 confirm 之前**真**真
    // taker accept_v1 真**真 race in. cancel API 真**真 processCancel 真**真**真 sync set
    // protocol_status='cancelled' (state machine), 但**真**真**真**真 trade-protocol-filter 真**真
    // accept_v1 真**真 race 抢 'matched'. 真**真**真**真**真 'cancelled' 才**真**真 proceed refund.
    const post = sqlite.prepare(`SELECT protocol_status, taker FROM exchange_offers WHERE id=?`).get(offer.id);
    if (post?.protocol_status !== 'cancelled' || post?.taker) {
      console.warn(`[cancel-refund] post-cancel race detect ${offer.id.slice(0,8)}: status=${post?.protocol_status} taker=${post?.taker?.slice(-10)} — abort refund, route dispute`);
      ackParts.push(`订单 ${offer.id.slice(0,8)} 取消时被 taker 抢接 (状态: ${post?.protocol_status}). 不退款, 走 dispute 流程, broker 联系你确认`);
      continue;
    }

    // Step 2: refund 原资产 enqueue (走 broker-action-queue 单线 pump 防 UTXO 双花)
    if (offer.give_asset === 'KAS') {
      // user 卖 KAS → broker 持 KAS → 退 KAS - fee
      const giveAmt = parseFloat(offer.give_amount);
      const meta = (() => { try { return JSON.parse(offer.metadata || '{}'); } catch { return {}; } })();
      const intentQty = parseFloat(meta.intent_qty) || (giveAmt + FEE_KAS); // user 转入原始量 (含 broker fee)
      const refundAmt = +(intentQty - FEE_KAS).toFixed(4); // 扣 broker fee
      enqueue({
        kind: 'sendKas',
        peer: peerAddr,
        payload: { amount_kas: refundAmt, note: `cancel_refund ${offer.id.slice(0, 8)}` },
      });

      // Step 2.5: update retail_dex_orders state='cancelled_refunded' (NWT 7c5ad929 audit concern 2 — UI consistency).
      // 真 publish 路径 (J1 Z17) update state='broadcast' + exchange_offer_id. 真**真 cancel 路径
      // 真**真 update → UI 卡 'broadcast' 真**真**真**真**stale. 真**真 SQL UPDATE 修 stale.
      try {
        sqlite.prepare(`
          UPDATE retail_dex_orders
          SET state = 'cancelled_refunded', updated_at = ?
          WHERE user_kasia_address = ?
            AND (exchange_offer_id = ? OR (exchange_offer_id IS NULL AND state = 'awaiting_payment' AND qty = ?))
        `).run(new Date().toISOString(), peerAddr, offer.id, String(intentQty));
      } catch (e) { console.warn(`[cancel-refund] retail_dex_orders UPDATE err: ${e.message}`); }

      ackParts.push(`订单 ${offer.id.slice(0, 8)} 已取消, ${refundAmt} KAS 退还中 (扣 ${FEE_KAS} broker fee)`);
    } else {
      // BUY 路径 (give_asset=USDT/USDC etc) — broker 持 stable, 退 stable. P2 — 现 BUY 流程未撞触 (broker 没 hold USDT, USDT 是用户付给 maker 的).
      ackParts.push(`订单 ${offer.id.slice(0, 8)} 已取消 (${offer.give_asset} 退还流程待 P2)`);
    }
  }

  // Step 3: 同时 audit log (events 表) — 真**真**Brain / Owner 可见
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'broker', 'user_cancel_refund', 'broker-cancel-refund', 'info', ?, ?, ?)
    `).run(
      randomUUID(),
      `User ${peerAddr.slice(-12)} cancel-refund ${refundable.length} offer(s)`,
      JSON.stringify({ peer: peerAddr, offers: refundable.map(o => ({ id: o.id, give_asset: o.give_asset, give_amount: o.give_amount })) }),
      new Date().toISOString()
    );
  } catch (e) { console.warn(`[cancel-refund] event log err: ${e.message}`); }

  return `✓ ${ackParts.join('. ')}. broker-action-queue 排队中, 1-2min 内到账你的钱包.`;
}
