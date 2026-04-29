// ════════════════════════════════════════════════════════════════
// HIGH-RISK FILE (Critical 8 per docs/COLLAB-REFORM.md 规 10/13/15)
// 改前必跑: grep -nE 'T-J[0-9]+-|T-NWT-|Bug-[A-Z][0-9]+' 本 file
// 改后 commit msg 必含: acknowledged: T-X-X (per surfaced anti-pattern)
// 关联 docs: ANTI-PATTERNS / DEVELOPER-GUIDE
// 关键历史: T-J2-2026-04-29 双重退款铁证 (Owner 04-28→04-29 87.9 KAS 退两次, broker 净亏 87.7)
// blast radius: 全 broker refund path (cancel-refund + intake-watcher.scanExpiredBrokerOffers)
// ════════════════════════════════════════════════════════════════
//
// broker-refund-dedup.js — chain-truth refund dedup (T-J2-2026-04-29 紧急 Track A)
//
// 真根因: broker 有 2 条独立 refund 路径 (handleCancelAndRefund + _scanExpiredBrokerOffers),
// 各自乐观写入 chain_events 'broker_kas_refunded' 但 txid='refund_<offerid>' 假占位符,
// 不是真链 TX hash. dedup SQL `txid IN (SELECT tx_id FROM kaspa_tx_log)` 永久失效.
// 同 offer 触发两次 refund → broker 真亏.
//
// 此 helper 不信 broker 自己 chain_events 的占位符记录, 只信 kaspa_tx_log 真链 TX:
// 给定 (userKasiaAddr, refundAmount, sinceTimestamp), 查 kaspa 链上是否真存在 broker→user
// 的 refund TX. 如有 → 已退过 → 拒重复退款.
//
// 这是 Track A 紧急补丁. Track B 真重塑 (统一 refund-machine + order/offer/event 强同步)
// 是 Step 2 真核心.

import { sqlite } from '../db/client.js';

/**
 * 查 kaspa_tx_log 真链 TX 看 broker 是否已退过此 user 此金额.
 *
 * 不信 broker 自己 chain_events (有占位符 txid 'refund_xxx' 不是真 hash).
 * 只信 kaspa_tx_log 真链上 TX.
 *
 * @param {string} userKasiaAddr - Owner 收 refund 的 Kasia 地址
 * @param {number} refundAmount - 应退金额 (KAS)
 * @param {string} sinceIso - 时间窗起点 (ISO 时间, e.g. offer.broadcast_at)
 * @param {number} tolerance - 金额容差 (默认 0.01 KAS, 浮点比较防进位)
 * @returns {Array<{tx_id, block_time, amount}>} 匹配的真链 refund TX 列表 (空 = 未退过)
 */
export function findPriorRefundTxs(userKasiaAddr, refundAmount, sinceIso, tolerance = 0.01) {
  if (!userKasiaAddr || refundAmount == null) return [];
  // 转 ISO → unix epoch (kaspa_tx_log.block_time 是 unix seconds)
  const sinceUnix = sinceIso ? Math.floor(new Date(sinceIso).getTime() / 1000) : 0;
  const minAmt = refundAmount - tolerance;
  const maxAmt = refundAmount + tolerance;
  try {
    return sqlite.prepare(`
      SELECT tx_id, block_time, amount
      FROM kaspa_tx_log
      WHERE to_address = ?
        AND amount BETWEEN ? AND ?
        AND block_time > ?
      ORDER BY block_time ASC
    `).all(userKasiaAddr, minAmt, maxAmt, sinceUnix);
  } catch (e) {
    console.warn(`[refund-dedup] kaspa_tx_log query err: ${e.message}`);
    return [];
  }
}

/**
 * 给定 offer + meta, 判断是否已存在真链 refund TX.
 *
 * @param {object} offer - exchange_offers row (id, give_amount, broadcast_at, metadata)
 * @returns {{ alreadyRefunded: boolean, priorTxs: Array, expectedRefundAmount: number, userKasiaAddr: string|null }}
 */
export function isOfferAlreadyRefunded(offer) {
  if (!offer) return { alreadyRefunded: false, priorTxs: [], expectedRefundAmount: 0, userKasiaAddr: null };
  let meta = {};
  try { meta = JSON.parse(offer.metadata || '{}'); } catch {}
  const userKasiaAddr = meta.user_kasia_address;
  if (!userKasiaAddr) return { alreadyRefunded: false, priorTxs: [], expectedRefundAmount: 0, userKasiaAddr: null };

  // 期望 refund 金额: meta.net_kas (post-fee) 优先, fallback offer.give_amount (broker-intake 真 net=intent_qty-fee)
  const expectedRefundAmount = parseFloat(meta.net_kas || offer.give_amount || 0);
  if (!expectedRefundAmount) return { alreadyRefunded: false, priorTxs: [], expectedRefundAmount: 0, userKasiaAddr };

  // 时间窗: offer broadcast_at 起 (覆盖整个 offer 生命周期 + post-expire refund)
  const sinceIso = offer.broadcast_at || offer.created_at || null;
  const priorTxs = findPriorRefundTxs(userKasiaAddr, expectedRefundAmount, sinceIso);

  return {
    alreadyRefunded: priorTxs.length > 0,
    priorTxs,
    expectedRefundAmount,
    userKasiaAddr,
  };
}
