// ════════════════════════════════════════════════════════════════
// HIGH-RISK FILE (Critical 8 per docs/COLLAB-REFORM.md 规 10/13/15)
// 改前必跑: grep -nE 'T-J[0-9]+-|T-NWT-|Bug-[A-Z][0-9]+' 本 file
// 改后 commit msg 必含: acknowledged: T-X-X (per surfaced anti-pattern)
// 关联 docs: ANTI-PATTERNS R38+ / DEVELOPER-GUIDE ch19
// 关键历史: J2 Defect A/B/C (INSERT-before-confirm 撒谎 防御) / Layer 1+2 Promise→Verify→Ack
//          / Z18 cancel intent regex / Z19 LLM hallucinate fake ack guard / Bug-Z24 verify ✓
// blast radius: cancel-refund flow / fund 退还 chain TX / Owner 88 KAS 主路径
// ════════════════════════════════════════════════════════════════
//
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

// Cancel intent detection — 用户**真**真 user-facing cancel-and-refund 表达.
//
// HOTFIX (Owner 03:37 真测撞): 之前 regex 用 ^...$ strict 整条匹配, "取消订单！我等不了了"
// 真**真**复合句**真 fail match → fall LLM → LLM hallucinate 假 ack reply '已取消, 资金退回中'
// (但**真**真**真 handleCancelAndRefund 真**真 fire, 实际 nothing happened). 严重 production bug.
//
// 修: substring 匹配 cancel 关键词 + 排除 negation ("我不想取消" / "别取消").
// 单字 'NO'/'no' 不**真**真**真 catch (歧义, _pending preview path CANCEL_WORDS 真**真 cover).
const CANCEL_KEYWORD_REGEX = /(取消(?:订单|单|报价|卖单|买单|交易)?|不卖了|不买了|不想(?:卖|买|交易)了?|不要了|算了(?:吧)?|退我(?:钱|币|KAS|USDT|USDC)?|退回(?:我的)?(?:钱|币|KAS|USDT|USDC)?|我不(?:做|玩|要|交易)了?|cancel(?:\s+(?:order|trade|sell|buy))?|refund(?:\s+me)?|give\s+(?:me\s+)?(?:my\s+)?(?:money|kas|usdt|usdc|funds?)\s+back)/i;
// negation: "不想取消" / "别取消" / "继续" / "保留" / "don't cancel" — 真**真**否定**真**真**真 cancel intent.
const CANCEL_NEGATION_REGEX = /(不想(?:取消|退)|别取消|不要(?:取消|退)|继续(?:挂单|交易)|keep\s+(?:order|going)|don'?t\s+(?:cancel|refund))/i;

export function detectCancelIntent(message) {
  if (!message) return false;
  const trimmed = message.trim();
  if (CANCEL_NEGATION_REGEX.test(trimmed)) return false;
  return CANCEL_KEYWORD_REGEX.test(trimmed);
}

/**
 * Find active refundable offers for this peer.
 * Source: exchange_offers WHERE maker=BROKER + metadata.user_kasia_address=peer + protocol_status='open' + taker IS NULL.
 * Cross-check: retail_dex_orders state='awaiting_payment' (broker holds KAS).
 */
function _findRefundableOffers(peerAddr) {
  const brokerAddr = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(BROKER_RELAY_ID)?.address;
  if (!brokerAddr) return [];

  // Bug-Z18+ status 扩 (Owner 04:33 真测撞 expired offer 真**真 catch).
  // 'open' = 还在挂单 + 'expired'/'timed_out' = TTL 到/超时 (broker 仍持 KAS, J1 Z20 timeout sweep
  // 5min tick refund, 但 user explicit cancel 立即 catch + 解释 "已挂 timeout sweep, 1 分钟内退").
  // taker IS NULL 严守 — 真**真 taker 接 → walk dispute (本 helper 不 cover).
  const offers = sqlite.prepare(`
    SELECT id, give_amount, give_asset, want_amount, want_asset, metadata, broadcast_tx_id, protocol_status, created_at
    FROM exchange_offers
    WHERE maker = ?
      AND protocol_status IN ('open', 'expired', 'timed_out')
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

  const { enqueueVerified } = await import('./broker-action-queue.js');
  const { markOrderRefunded, markRefundFailed } = await import('../db/state-transitions.js');
  const PORT = process.env.PORT || 3100;

  const ackParts = [];

  for (const offer of refundable) {
    // Step 1: cancel offer 上链 (best-effort; UI/Scout 看 protocol_status=cancelled)
    try {
      await fetch(`http://127.0.0.1:${PORT}/api/exchange/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relayNodeId: BROKER_RELAY_ID, offer_id: offer.id }),
      });
    } catch (e) {
      console.warn(`[cancel-refund] cancel API err for ${offer.id.slice(0,8)}: ${e.message}`);
    }

    // Step 1.5: race-safety. 唯一关心 = post-cancel 期间 taker accept_v1 race 抢 'matched'.
    // taker IS NULL 是 sufficient condition (broker 仍持资产, 无 claimant). 'cancelled'/'expired'/
    // 'timed_out' 都安全 (terminal, no taker can attach). 仅 'matched' AND taker 才命中 race.
    const post = sqlite.prepare(`SELECT protocol_status, taker FROM exchange_offers WHERE id=?`).get(offer.id);
    if (post?.taker || post?.protocol_status === 'matched' || post?.protocol_status === 'verifying' || post?.protocol_status === 'delivering') {
      console.warn(`[cancel-refund] post-cancel race detect ${offer.id.slice(0,8)}: status=${post?.protocol_status} taker=${post?.taker?.slice(-10)} — abort refund, route dispute`);
      ackParts.push(`订单 ${offer.id.slice(0,8)} 取消时被 taker 抢接 (状态: ${post?.protocol_status}). 不退款, 走 dispute 流程, broker 联系你确认`);
      continue;
    }

    // Find linked retail_dex_orders for Layer 1 wrapper. exchange_offer_id 真**真 都 backfill (J1 Z17
    // 修了 publish 路径, 但 intake-watcher 部分 case 仍**真 sync). fallback: meta.user_kasia + qty match.
    const meta = (() => { try { return JSON.parse(offer.metadata || '{}'); } catch { return {}; } })();
    const intentQty = parseFloat(meta.intent_qty) || (parseFloat(offer.give_amount) + FEE_KAS);
    const order = sqlite.prepare(`
      SELECT id FROM retail_dex_orders
      WHERE user_kasia_address=?
        AND (exchange_offer_id=? OR (exchange_offer_id IS NULL AND qty=? AND state='awaiting_payment'))
      ORDER BY created_at DESC LIMIT 1
    `).get(peerAddr, offer.id, String(intentQty));

    // Step 2: Layer 2 enqueueVerified — await sendKas execute confirm (拿 txId OR catch error).
    // Layer 1 + 2 (Owner 钦定 Promise→Verify→Acknowledge): 不再 INSERT-before-confirm, 不再 DM ack 撒谎.
    if (offer.give_asset === 'KAS') {
      const refundAmt = +(intentQty - FEE_KAS).toFixed(4);
      try {
        const result = await enqueueVerified({
          kind: 'sendKas',
          peer: peerAddr,
          payload: { amount_kas: refundAmt, note: `cancel_refund ${offer.id.slice(0, 8)}` },
        });
        const txId = result?.txId;
        if (!txId) throw new Error('sendKas resolved without txId');

        // Step 3: Layer 1 wrapper — verified state advance (含 tx_hash, 真 chain broadcast confirmed).
        if (order?.id) {
          try {
            markOrderRefunded(order.id, txId, 'user_cancel');
          } catch (e) {
            console.warn(`[cancel-refund] markOrderRefunded err for order ${order.id}: ${e.message}`);
          }
        } else {
          console.warn(`[cancel-refund] no retail_dex_orders link for offer ${offer.id.slice(0,8)} — chain TX 已发 (${txId.slice(0,12)}), 但 DB state 没 advance`);
        }

        ackParts.push(`订单 ${offer.id.slice(0, 8)} 已取消, ${refundAmt} KAS 已发到你 Kasia 钱包 (扣 ${FEE_KAS} broker fee). Kasia TX: ${txId.slice(0, 16)}`);
      } catch (err) {
        // Layer 1 markRefundFailed — 不撒谎. broker 仍持 KAS, alert events 表, ack 真实.
        console.error(`[cancel-refund] sendKas FAIL for offer ${offer.id.slice(0,8)}: ${err.message}`);
        if (order?.id) {
          try { markRefundFailed(order.id, err.message); } catch { /* fall */ }
        }
        ackParts.push(`订单 ${offer.id.slice(0, 8)} 取消请求收到, 但 broker 退款 chain TX 失败 (${err.message?.slice(0, 60)}). KAS 仍在 broker 钱包没动, broker 已 alert Owner 人工处理. 不会丢钱`);
      }
    } else {
      // BUY 路径 (give_asset=USDT/USDC) — broker 不持 stable, USDT 是 user 付给 maker. 不退还流程, 走 dispute.
      ackParts.push(`订单 ${offer.id.slice(0, 8)} 已取消 (${offer.give_asset} 流程: USDT 你付 maker, broker 不持. 如 USDT 已 deliver, 走 dispute 流程联系 broker)`);
    }
  }

  return `✓ ${ackParts.join('. ')}.`;
}
