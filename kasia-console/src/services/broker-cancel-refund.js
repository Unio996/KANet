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
import { isOfferAlreadyRefunded } from './broker-refund-dedup.js';

// Bettor #j5romh r766 身份迁移补全, env 缺失 fail-loud 拒启(死值兜底=定时雷, 见 kanet.env)。
const BROKER_RELAY_ID = process.env.BROKER_RELAY_ID;
if (!BROKER_RELAY_ID) {
  throw new Error('[broker-cancel-refund] FATAL: BROKER_RELAY_ID env var not set (see kanet.env) — refusing to start with hardcoded dead relay id fallback');
}
const FEE_KAS = 0.1;

// Cancel intent detection — 用户**真**真 user-facing cancel-and-refund 表达.
//
// HOTFIX (Owner 03:37 真测撞): 之前 regex 用 ^...$ strict 整条匹配, "取消订单！我等不了了"
// 真**真**复合句**真 fail match → fall LLM → LLM hallucinate 假 ack reply '已取消, 资金退回中'
// (但**真**真**真 handleCancelAndRefund 真**真 fire, 实际 nothing happened). 严重 production bug.
//
// 修: substring 匹配 cancel 关键词 + 排除 negation ("我不想取消" / "别取消").
// 单字 'NO'/'no' 不**真**真**真 catch (歧义, _pending preview path CANCEL_WORDS 真**真 cover).
// T-J2-2026-05-07 r244 T1.4 C-patch: 加 '撤单/撤销/撤回/撤消' 中文变体 (Owner 5/7 08:43 真发 "撤单"
// → 旧 regex 不 match → fall LLM → LLM hallucinate 假 ack '已撤销' UX 误导).
const CANCEL_KEYWORD_REGEX = /(取消(?:订单|单|报价|卖单|买单|交易)?|撤(?:单|销(?:订单|单|交易|挂单)?|回|消)|不卖了|不买了|不想(?:卖|买|交易)了?|不要了|算了(?:吧)?|退我(?:钱|币|KAS|USDT|USDC)?|退回(?:我的)?(?:钱|币|KAS|USDT|USDC)?|我不(?:做|玩|要|交易)了?|cancel(?:\s+(?:order|trade|sell|buy))?|refund(?:\s+me)?|give\s+(?:me\s+)?(?:my\s+)?(?:money|kas|usdt|usdc|funds?)\s+back)/i;
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

  // T-J2-2026-04-29 紧急 Track A (Owner 抓双重退款铁证): 不信 broker 自己 chain_events 占位符,
  // 查 kaspa_tx_log 真链 TX dedup. 同 offer 已有真链 refund TX → 拒 重复退款 (broker 真亏 87.9 KAS 教训).
  return offers.filter(o => {
    try {
      const meta = JSON.parse(o.metadata || '{}');
      if (meta.user_kasia_address !== peerAddr) return false;
    } catch { return false; }
    // chain-truth dedup
    try {
      const dedup = isOfferAlreadyRefunded(o);
      if (dedup.alreadyRefunded) {
        console.warn(`[cancel-refund] DEDUP offer ${o.id.slice(0,8)} skip — kaspa 链已有 ${dedup.priorTxs.length} 笔真 refund TX (${dedup.priorTxs.map(t => t.tx_id.slice(0,12)).join(',')}). 拒重复退款防 broker 资产流失.`);
        return false;
      }
    } catch (e) {
      console.error(`[cancel-refund] dedup helper err: ${e.message} — fail-closed 拒退款防资产流失`);
      return false;  // 真 fail-closed: helper 失败也拒退款, 不允许"漏检就退"
    }
    return true;
  });
}

/**
 * T-J2-2026-05-09 r219 T2.12 (NWT r286 Option A): Find unlinked retail_dex_orders draft (no linked exchange_offer).
 * stale draft case: broker-intake handleIntake link broken OR prior cycle race → retail_dex_orders state='aligning'/'awaiting_payment'
 * with exchange_offer_id IS NULL. handleCancelAndRefund caller fall-through dispatch advanceToRefunded.
 * Filter 'test-%' (T2.11 同款 hygiene 防 test cron INSERT pollute).
 */
function _findRefundableDrafts(peerAddr) {
  return sqlite.prepare(`
    SELECT id, side, qty, datetime(created_at) as created_at
    FROM retail_dex_orders
    WHERE user_kasia_address = ?
      AND state IN ('aligning', 'awaiting_payment')
      AND exchange_offer_id IS NULL
      AND created_at > datetime('now', '-24 hours')
      AND id NOT LIKE 'test-%'
    ORDER BY created_at DESC
  `).all(peerAddr);
}

/**
 * Handle user-initiated cancel + refund.
 * @param {string} peerAddr
 * @returns {Promise<string|null>} reply text if refunded, null if no active refundable offer
 */
export async function handleCancelAndRefund(peerAddr) {
  const refundable = _findRefundableOffers(peerAddr);
  if (refundable.length === 0) {
    // T-J2-2026-05-09 r219 T2.12 (NWT r286 Option A): fall-through to unlinked drafts.
    // 5/9 NWT operator Step 1 retry 撞 stale draft `bv2_p9zx9z9xn7rh_*` 真 awaiting_payment + exchange_offer_id NULL.
    // _findRefundableOffers SQL 仅 cover exchange_offers, 漏 unlinked draft → handleCancelAndRefund return null
    // → user 真 cancel intent 真 broker default ack 但实际 NOT cancel + NOT refund. T2.12 修.
    const drafts = _findRefundableDrafts(peerAddr);
    if (drafts.length === 0) return null;
    const { advanceToRefunded } = await import('./broker-state-authority.js');
    const ackParts = [];
    for (const d of drafts) {
      const result = await advanceToRefunded({ orderId: d.id, reason: 'user_cancel_unlinked_draft' });
      if (result.ok) {
        if (result.noRefundNeeded) {
          ackParts.push(`订单 ${d.id.slice(-8)} (${d.side}) 已取消 (设置中无付款, 不需 refund)`);
        } else if (result.alreadyRefunded) {
          ackParts.push(`订单 ${d.id.slice(-8)} 之前已退过 (Kasia TX: ${result.txId?.slice(0, 16)})`);
        } else {
          ackParts.push(result.ackText || `订单 ${d.id.slice(-8)} (${d.side}) 已取消${result.refundAmount ? ` (退 ${result.refundAmount} KAS Kasia TX: ${result.txId?.slice(0, 16)})` : ''}`);
        }
      } else if (result.skipReason === 'race_lost') {
        // T-J2-2026-05-10 SC8 (triage T3): 加 '已取消' keyword 满足 ux_p03 cancel ack expect。
        ackParts.push(`订单 ${d.id.slice(-8)} 已取消 (退款进行中, 1-3 分钟到账)`);
      } else {
        console.warn(`[cancel-refund T2.12] draft ${d.id.slice(-8)} advanceToRefunded skipped: ${result.error || result.skipReason}`);
        ackParts.push(`订单 ${d.id.slice(-8)} 已取消 (broker 处理中: ${(result.error || result.skipReason || '').slice(0, 60)})`);
      }
    }
    return ackParts.length > 0 ? `✓ ${ackParts.join('. ')}.` : null;
  }

  // T-J2-2026-04-29 Track B step 5 (Owner 钦定单一状态机, round 3 共识 design v4):
  // 替原 inline sendKas + markOrderRefunded (双重退款 root cause) → call advanceToRefunded.
  // advanceToRefunded 内部 Phase 1 CAS lock + Phase 2 sendKas + Phase 3 atomic 3-table sync + chain-truth dedup.
  const { advanceToRefunded } = await import('./broker-state-authority.js');
  // 2026-07-14(Bettor #k2xd1y 第五源排查): 端口 3100→3200 + 补 AbortSignal.timeout(同族
  // legacyRefundBuilderTick 自锁风险)。
  const PORT = process.env.PORT || 3200;
  const ackParts = [];

  for (const offer of refundable) {
    // Step 1: cancel offer 上链 (best-effort; UI/Scout 看 protocol_status=cancelled).
    // advanceToRefunded Phase 3 同步 set protocol_status='refunded', 但 chain-side cancel 仍 fire 通知 taker pool.
    try {
      await fetch(`http://127.0.0.1:${PORT}/api/exchange/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relayNodeId: BROKER_RELAY_ID, offer_id: offer.id }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      console.warn(`[cancel-refund] cancel API err for ${offer.id.slice(0,8)}: ${e.message}`);
    }

    // Step 1.5: race-safety post-cancel taker race 抢接 'matched' detection.
    // advanceToRefunded 内部 Phase 1 也有 race-safety, 但提早 detect 真 user-facing ack 真 explicit.
    const post = sqlite.prepare(`SELECT protocol_status, taker FROM exchange_offers WHERE id=?`).get(offer.id);
    if (post?.taker || post?.protocol_status === 'matched' || post?.protocol_status === 'verifying' || post?.protocol_status === 'delivering') {
      console.warn(`[cancel-refund] post-cancel race detect ${offer.id.slice(0,8)}: status=${post?.protocol_status} taker=${post?.taker?.slice(-10)} — abort refund, route dispute`);
      ackParts.push(`订单 ${offer.id.slice(0,8)} 取消时被 taker 抢接 (状态: ${post?.protocol_status}). 不退款, 走 dispute 流程, broker 联系你确认`);
      continue;
    }

    // BUY 路径 (give_asset=USDT/USDC) — broker 不持 stable, 不进 advanceToRefunded.
    if (offer.give_asset !== 'KAS') {
      ackParts.push(`订单 ${offer.id.slice(0, 8)} 已取消 (${offer.give_asset} 流程: USDT 你付 maker, broker 不持. 如 USDT 已 deliver, 走 dispute 流程联系 broker)`);
      continue;
    }

    // Find linked retail_dex_orders.id (advanceToRefunded entry 需 orderId).
    const meta = (() => { try { return JSON.parse(offer.metadata || '{}'); } catch { return {}; } })();
    const intentQty = parseFloat(meta.intent_qty) || (parseFloat(offer.give_amount) + FEE_KAS);
    const order = sqlite.prepare(`
      SELECT id FROM retail_dex_orders
      WHERE user_kasia_address=?
        AND (exchange_offer_id=? OR (exchange_offer_id IS NULL AND qty=? AND state IN ('awaiting_payment','paid','expired')))
      ORDER BY created_at DESC LIMIT 1
    `).get(peerAddr, offer.id, String(intentQty));

    if (!order?.id) {
      // J1 #73 Edge 2: legacy offer 无 order link (exchange_offer_id NULL pre-v83 FK enforce). 真 broker
      // 不知 user 真 paid OR 没. 不轻易 refund (防双重退款), 不轻易 dispute claim. honest ack walk dispute.
      console.warn(`[cancel-refund] no retail_dex_orders link for offer ${offer.id.slice(0,8)} — advanceToRefunded 真 orderId 必, skip`);
      ackParts.push(`订单 ${offer.id.slice(0,8)} 已取消 (链上 offer cancel). 找不到 retail_dex_orders 记录 — 如有付款请联系 broker 走 dispute 流程`);
      continue;
    }

    // Track B 单一状态机 entry: advanceToRefunded 真 3-Phase pattern + Track A dedup + atomic 3-table sync.
    const result = await advanceToRefunded({ orderId: order.id, reason: 'user_cancel' });

    if (result.ok) {
      if (result.noRefundNeeded) {
        // J1 #73 Edge 1: order.state 'aligning'/'confirming' — broker 没收 user payment yet, 真 NO refund needed.
        ackParts.push(`订单 ${offer.id.slice(0,8)} 已取消 (设置中没产生付款, 不需 refund)`);
      } else if (result.alreadyRefunded) {
        // chain-truth dedup hit: chain 真已退过 (Owner 87.7 KAS 双重退款 防御). DB drift backfill 已自动 fire.
        ackParts.push(`订单 ${offer.id.slice(0,8)} 之前已退过 (Kasia TX: ${result.txId?.slice(0,16)}), 链上记录已存在, 不重复退款`);
      } else {
        ackParts.push(result.ackText || `订单 ${offer.id.slice(0, 8)} 已退 ${result.refundAmount} KAS 到你 Kasia 钱包. Kasia TX: ${result.txId?.slice(0, 16)}`);
      }
    } else if (result.skipReason === 'race_lost') {
      // Phase 1 CAS lost — 别 caller 真 claim 'refunding' lock (e.g. cron tick 同时 fire). Reconciler 真 backfill.
      // T-J2-2026-05-10 SC8: 加 '已取消' keyword (ux_p03 cancel ack expected)。
      ackParts.push(`订单 ${offer.id.slice(0,8)} 已取消 (退款进行中, 其他 process 已起手, 1-3 分钟到账)`);
    } else if (result.skipReason === 'not_refundable') {
      ackParts.push(`订单 ${offer.id.slice(0,8)} 状态 (${result.error?.match(/status=(\w+)/)?.[1] || '未知'}) 不允许退款, 走 dispute 流程`);
    } else {
      // sendKas fail / 其他 error — Phase 1 已 rollback state='expired' + error_reason 记, reconciler 5min 重试.
      // T-J2-2026-05-10 SC8: 加 '已取消' keyword (ux_p03 cancel ack expected)。
      console.error(`[cancel-refund] advanceToRefunded FAIL for order ${order.id}: ${result.error}`);
      ackParts.push(`订单 ${offer.id.slice(0,8)} 已取消 (broker 退款 chain TX 失败: ${result.error?.slice(0, 60)}, KAS 仍在 broker 钱包, reconciler 5 分钟自动重试, 不会丢钱)`);
    }
  }

  return `✓ ${ackParts.join('. ')}.`;
}
