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
import { classifyRefundState, REFUND } from '../lib/broker-refund-classify.mjs';
import { indexerCoverage as _indexerCoverage } from '../lib/indexer-coverage.mjs';

// ════════════════════════════════════════════════════════════════
// 2026-08-29 (J2, broker-money-path 阶段 2; 设计 docs/2026-08-29-j2-broker-refund-double-pay-guard-patch-draft.md, NWT GREEN):
//   原 isOfferAlreadyRefunded 两路都以 kaspa_tx_log 有行为前提 (PRIMARY `txid IN (SELECT tx_id FROM kaspa_tx_log)` / FALLBACK 直查)
//   ⇒ 索引漏一行 = "未退" = 重退 (T4 absence-as-evidence; 用户地址默认不在 watched 集合 ⇒ 漏行是默认不是偶发)。
//   改: 判定交给 lib/broker-refund-classify.mjs —— intent 已记即拦 (chain_events 不 join kaspa_tx_log; broker_refund_intents write-ahead),
//   否定断言 NOT_REFUNDED 须 无 intent ∧ RPC 成功无匹配 ∧ coverage 无洞; 其余 UNKNOWN ⇒ 不发 + 告警。
//   本文件保留 findPriorRefundTxs (只作【肯定】证据的 S3 查询) 与 isOfferAlreadyRefunded 签名 (调用方 broker-cancel-refund.js:86 预筛 /
//   broker-state-authority.js advanceToRefunded); 语义变化: 返回多了 state/reason/mustHold。
//   分层: 预筛 (无 RPC) 只用 alreadyRefunded (肯定证据); 真闸在 advanceToRefunded (带 RPC+coverage, UNKNOWN ⇒ hold)。
// ════════════════════════════════════════════════════════════════

/**
 * 查 kaspa_tx_log 真链 TX 看 broker 是否已退过此 user 此金额. (S3 肯定证据; 不作否定证据)
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
/**
 * @param {object} offer - exchange_offers row (id, give_amount, broadcast_at, created_at, metadata)
 * @param {object} [opts]
 * @param {Function|null} [opts.rpcUtxoLookup]   同步闭包 (addr)=>[{amountKas}] (lib/kaspa-utxo-lookup.mjs makeUtxoLookup 预取后传入); 无 ⇒ 否定断言不可能 ⇒ UNKNOWN
 * @param {Function|null} [opts.indexerCoverage] ({network,address,fromIso,toIso})=>{covered,holes}; 默认接 lib/indexer-coverage.mjs (v199 账)
 * @param {string} [opts.orderId]                retail 路可给 (intent 按 order_id 也能命中)
 * @param {object} [opts.db]                     测试注入
 * @returns {{ alreadyRefunded:boolean, mustHold:boolean, state:string, reason:string, priorTxs:Array, expectedRefundAmount:number, userKasiaAddr:string|null, evidence:object }}
 *   alreadyRefunded = REFUNDED_CONFIRMED | REFUNDED_INTENT | INFLIGHT (肯定/意图证据 ⇒ 不得再发)
 *   mustHold        = UNKNOWN (否定证据不足 ⇒ 不得发, 告警) —— 只有 NOT_REFUNDED 才 both=false
 */
export function isOfferAlreadyRefunded(offer, opts = {}) {
  const db = opts.db || sqlite;
  const empty = (reason) => ({ alreadyRefunded: false, mustHold: true, state: REFUND.UNKNOWN, reason, priorTxs: [], expectedRefundAmount: 0, userKasiaAddr: null, evidence: {} });
  if (!offer) return empty('no_offer');
  let meta = {};
  try { meta = JSON.parse(offer.metadata || '{}'); } catch {}
  const userKasiaAddr = meta.user_kasia_address;
  if (!userKasiaAddr) return empty('no_user_kasia');
  // 期望 refund 金额: meta.net_kas (post-fee) 优先, fallback offer.give_amount (broker-intake 真 net=intent_qty-fee)
  const expectedRefundAmount = parseFloat(meta.net_kas || offer.give_amount || 0);
  if (!expectedRefundAmount) return { ...empty('invalid_amount'), userKasiaAddr };
  const sinceIso = offer.broadcast_at || offer.created_at || null;
  const network = String(userKasiaAddr).startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
  const indexerCoverage = opts.indexerCoverage === undefined ? ((a) => _indexerCoverage(db, a)) : opts.indexerCoverage;
  const r = classifyRefundState({
    db, offerId: offer.id, orderId: opts.orderId || null, userAddr: userKasiaAddr, amountKas: expectedRefundAmount, sinceIso, network,
    rpcUtxoLookup: opts.rpcUtxoLookup || null, indexerCoverage,
  });
  const priorTxs = r.txid ? [{ tx_id: r.txid, source: r.reason }] : (r.evidence?.chain_event?.txid ? [{ tx_id: r.evidence.chain_event.txid, source: 'chain_events_offer_id_specific' }] : (r.evidence?.intent?.txid ? [{ tx_id: r.evidence.intent.txid, source: 'refund_intent' }] : []));
  return {
    alreadyRefunded: r.state === REFUND.REFUNDED_CONFIRMED || r.state === REFUND.REFUNDED_INTENT || r.state === REFUND.INFLIGHT,
    mustHold: r.state === REFUND.UNKNOWN,
    state: r.state, reason: r.reason, priorTxs, expectedRefundAmount, userKasiaAddr, evidence: r.evidence,
  };
}
