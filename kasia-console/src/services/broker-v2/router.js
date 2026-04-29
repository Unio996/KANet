// ════════════════════════════════════════════════════════════════
// broker-v2/router.js — 主 path 单一不分支
//
// Spec: docs/NEW-BROKER-PROPOSAL.md v2 §"router.js"
// Lock: 三方共识 7e776598dc + NWT v2 spec ecdd98874
//
// 主 path 顺序 (硬规则):
// 1. parser.extract → fields + intent (deterministic 必中)
// 2. state.setField for each field (R31/R33 SQL guard)
// 3. read state
// 4. lifecycle decision:
//    - intent cancel/reset → clearDraft OR cancel-refund (已 publish 路径)
//    - active order 已 publish → query status / LLM 自然对话
//    - draft complete + confirm → advance + order-book.publishOrder
//    - draft complete + 'aligning' → order-book.computePreview + advance 'preview_shown'
//    - draft 不全 → llm.render (含 profile + state inject)
// 5. post-LLM check tool_calls 写 state 后 re-check complete → preview
// ════════════════════════════════════════════════════════════════

import { sqlite } from '../../db/client.js';
import { extract } from './parser.js';
import * as state from './state.js';
import * as llm from './llm.js';
import * as orderBook from './order-book.js';

// parser fields → retail_dex_orders col name 映射.
// Note: 'asset' field 解 但不 setField — phase 1 hardcode KAS (retail_dex_orders 无 asset col).
// Phase 2 backlog: 加 retail_dex_orders.give_asset col 支持 USDT/USDC 多 asset trade.
const FIELD_MAP = {
  direction: 'side',          // buy → buy_kas / sell → sell_kas
  qty: 'qty',
  chain: 'pay_chain',
  pay_address: 'pay_address',
  price_pref: 'price',
};

const STATUS_QUERY_REGEX = /(?:查单|查我的单|订单状态|进度|已成多少|剩多少|什么情况)/i;

/**
 * Main entry — broker-v2 单一 user message 处理.
 * @param {string} peer - user kasia 地址
 * @param {string} msg - user 当前消息
 * @returns {Promise<string>} reply text 给 user
 */
export async function handleMessage(peer, msg) {
  if (!peer || !msg) return '我没收到内容, 你想买还是卖 KAS?';

  // 1. parser deterministic 提字段 + intent
  const { fields, intent } = extract(msg);

  // 2. 检查是否已 publish (非 'aligning' active order) — 决定路径分支
  const activeOrder = state.getActiveOrder(peer);
  const hasPublished = activeOrder && activeOrder.state !== 'aligning';

  // 3. cancel / reset 路径
  if (intent === 'cancel' || intent === 'reset') {
    if (hasPublished && ['awaiting_payment', 'paid'].includes(activeOrder.state)) {
      // 已 publish 想 cancel — 走 advanceToRefunded refund unfilled portion (复用退款侧)
      try {
        const { handleCancelAndRefund } = await import('../broker-cancel-refund.js');
        const result = await handleCancelAndRefund(peer);
        return result || '好的, 已取消挂单, 未成交部分将退回. 想下新单的话告诉我.';
      } catch (e) {
        console.warn(`[broker-v2 router] cancel-refund err: ${e.message}`);
        return 'broker 卡了一下处理你的取消请求, 请稍后重试或联系 Owner.';
      }
    }
    // draft 阶段 cancel — 直接 clearDraft
    state.clearDraft(peer);
    return '好的, 已取消. 想下新单的话告诉我.';
  }

  // 4. 已 publish 路径 — query status / B1 PAID detect / LLM 自然对话
  if (hasPublished) {
    if (STATUS_QUERY_REGEX.test(msg)) {
      const status = orderBook.getOrderStatus(peer);
      return _formatStatus(status);
    }

    // B1 PAID detect (BUY post-publish): user '我付了 0xtxhash' OR '已付' 兜底
    // r6 共识: broker-v2 不 cover post-publish PAID 是 critical break (Q1). 加 detect → verifyPaymentForPeer.
    // D1 ride: remaining_picks=0 时 transition state='paid' (multi-maker partial paid 仍 'awaiting_payment').
    if (activeOrder.side === 'buy_kas' && ['awaiting_payment', 'paid'].includes(activeOrder.state)) {
      const { PAID_REGEX, PAID_NO_TX_REGEX, verifyPaymentForPeer } = await import('../broker-buy-handler.js');
      if (PAID_REGEX.test(msg) || PAID_NO_TX_REGEX.test(msg)) {
        try {
          const result = await verifyPaymentForPeer({ peer, chain: activeOrder.pay_chain });
          // D1: 全 paid (remaining_picks=0) → transition state='paid'
          if (result?.ok && result.remaining_picks === 0) {
            // D1 v2 fix (NWT a3334737 Medium 1): 加 created_at 时间窗防 multi row advance.
            // production grep 实证 retail_dex_orders awaiting_payment=223 rows — 同 user 历史多
            // 'awaiting_payment' row 不该一次全 advance 'paid'. 仅 advance latest active (2h 内).
            sqlite.prepare(`
              UPDATE retail_dex_orders
              SET state='paid', updated_at=datetime('now')
              WHERE user_kasia_address=? AND side='buy_kas' AND state='awaiting_payment'
                AND created_at > datetime('now', '-2 hours')
            `).run(peer);
          }
          return result?.user_msg || (result?.ok
            ? '✓ 已收到付款验证, broker 准备发 KAS'
            : `付款验证暂时失败 (${result?.reason || 'unknown'}). 请稍后重试或发 tx hash 0x...`);
        } catch (err) {
          console.warn(`[broker-v2 router B1] verifyPaymentForPeer err: ${err.message}`);
          return '付款验证暂时失败, 请稍后重试或发 tx hash 0x...';
        }
      }
    }

    // 复合 intent / question / 自然对话 → LLM (含 state inject 知 phase)
    const reply = await llm.render(peer, msg, activeOrder, _loadProfile(peer), _loadContact(peer));
    return reply || '你的挂单还在跑. 想查状态回 "查单", 想取消回 "取消".';
  }

  // 5. draft 阶段 — seedDraft if needed (NWT critical fix vote A: caller 责任 seed)
  let draft = state.getActiveDraft(peer);
  if (!draft) {
    if (fields.direction) {
      const side = fields.direction === 'sell' ? 'sell_kas' : 'buy_kas';
      state.seedDraft(peer, side);
      draft = state.getActiveDraft(peer);
    } else {
      // 没 direction 不允许 INSERT (side NOT NULL). LLM 问 user.
      const profile = _loadProfile(peer);
      const contact = _loadContact(peer);
      const reply = await llm.render(peer, msg, null, profile, contact);
      return reply || '你想买还是卖 KAS?';
    }
  }

  // bug 3 R33 cover (J2 db649ba9 cross review catch — R33 direction flip 之前 silent fallthrough):
  // existing draft + parser fields.direction 跟 draft.side 不同 → user 试 direction flip → 直接 ack lock,
  // 不 fall through (避 LLM hallucinate '已改' OR fallback empty UX).
  if (draft && fields.direction) {
    const requestedSide = fields.direction === 'sell' ? 'sell_kas' : 'buy_kas';
    if (draft.side !== requestedSide) {
      const lockedSide = draft.side === 'sell_kas' ? '卖' : '买';
      return `订单已锁定 方向 ${lockedSide} KAS. 想改请回 "取消" 重新下单.`;
    }
  }

  // post-seedDraft: 写其他 fields (direction 已 seed 到 side col, 不重写)
  let fieldsWrittenThisTurn = false;
  let lockRejectReason = null;  // bug 3 fix: R31/R33 SQL guard reject 直接 ack 不 fallthrough LLM
  for (const [pname, pvalue] of Object.entries(fields)) {
    if (pname === 'direction') continue;  // already seeded into 'side' col
    const colName = FIELD_MAP[pname];
    if (!colName) continue;
    const r = state.setField(peer, colName, pvalue);
    if (r?.set) fieldsWrittenThisTurn = true;
    // bug 3 fix (broker-v2 5 P0): SQL guard reject (LOCKED_FIELDS=['side','pay_address'])
    // 直接 ack '已锁, 不允许改' 不 fallthrough LLM (LLM 易 hallucinate '已改' OR 空 fallback).
    if (r?.ok === false && r?.reason && /_locked$/.test(r.reason)) {
      lockRejectReason = r.reason;
    }
  }
  // bug 3 fix: R31/R33 reject 直接 user-facing ack
  if (lockRejectReason && draft) {
    const lockedField = lockRejectReason.replace('_locked', '');
    const lockedValue = draft[lockedField] || '';
    const fieldDisplay = lockedField === 'pay_address'
      ? `付款/收款地址 ${lockedValue}`
      : lockedField === 'side'
        ? `方向 ${lockedValue === 'sell_kas' ? '卖' : '买'}`
        : lockedField;
    return `订单已锁定 ${fieldDisplay}. 想改请回 "取消" 重新下单.`;
  }
  // direction 也算本 turn 写字段 (seedDraft 触发)
  if (fields.direction) fieldsWrittenThisTurn = true;

  draft = state.getActiveDraft(peer);

  // 6. confirm intent + draft complete (still 'aligning') → publishOrder + advance 'awaiting_payment'
  // 注: 不用 'preview_shown'/'confirming' intermediate state (schema CHECK 不含 'preview_shown';
  //   'aligning' state 含 "字段齐等 confirm" + "字段不齐字段收集中" 两情况, 由 draft.complete 区分).
  if (intent === 'confirm' && draft?.complete) {
    try {
      const result = await orderBook.publishOrder(peer, draft);
      if (!result.ok) {
        return `挂单失败 (${result.error || 'unknown'}). 请稍后重试或回 "取消" 取消.`;
      }
      state.advance(peer, 'awaiting_payment');  // post-publish, schema CHECK OK
      return result.ack_text || `✓ 订单已挂. ${result.offer_id ? `挂单 ID: ${result.offer_id.slice(0, 8)}` : ''}`;
    } catch (e) {
      console.error(`[broker-v2 router] publishOrder err: ${e.message}`);
      return `挂单失败 (${e.message}). 请稍后重试或回 "取消" 取消.`;
    }
  }

  // 7. confirm intent + draft 不全 → 提示缺啥
  if (intent === 'confirm' && draft && !draft.complete) {
    return `还差: ${_listMissing(draft)}. 告诉我后我会展示订单画像让你最后确认.`;
  }

  // 8. complete draft + 'aligning' + 本 turn 写了字段 → render preview
  // 仅本 turn 写字段时 re-render (user 改 qty 后 re-quote). 没写字段的 turn (复合 intent 'YES, 价格建议?'
  // 或者纯 question) 落 step 9 LLM, 防 step 8 拦截 LLM 答 question.
  if (draft?.complete && draft.state === 'aligning' && fieldsWrittenThisTurn) {
    try {
      const preview = await orderBook.computePreview(peer, draft);
      if (!preview.ok) {
        return `生成报价失败 (${preview.error || 'unknown'}). 请稍后重试或调整字段.`;
      }
      return preview.preview_text || '订单画像生成中... 请稍等';
    } catch (e) {
      console.warn(`[broker-v2 router] computePreview err: ${e.message}`);
      return `生成报价失败 (${e.message}). 请稍后重试或调整字段.`;
    }
  }

  // 9. draft 不全 OR 本 turn 没写字段 → LLM render (问字段 OR 答 question / 复合 intent)
  const completeBeforeLlm = !!draft?.complete;
  const profile = _loadProfile(peer);
  const contact = _loadContact(peer);
  const reply = await llm.render(peer, msg, draft, profile, contact);

  // 10. post-LLM: 仅 LLM tool_call 补全字段 (pre-LLM 不 complete → post-LLM complete) 时 render preview
  // 不重 render 已 complete draft (复合 intent 'YES, 价格建议?' LLM 答 question 不破 preview).
  draft = state.getActiveDraft(peer);
  if (!completeBeforeLlm && draft?.complete && draft.state === 'aligning') {
    try {
      const preview = await orderBook.computePreview(peer, draft);
      if (preview.ok) return preview.preview_text;
    } catch {
      // fall through to LLM reply
    }
  }

  return reply || `还需告诉我: ${_listMissing(draft)}.`;
}

function _listMissing(draft) {
  // post 3ce77b62f: 删 FIELD_MAP['asset'], retail_dex_orders 无 asset col, draft.asset 永 undefined.
  // phase 1 hardcode KAS only — 不再列 '资产' (NWT 4cbbaf78 critical fix).
  if (!draft) return '方向 (买/卖) + 数量 + 链 + 收款地址';
  const m = [];
  if (!draft.side) m.push('方向 (买/卖)');
  if (!draft.qty) m.push('数量');
  if (!draft.pay_chain) m.push('链 (BSC/Polygon/SOL/TRON)');
  if (draft.side === 'sell_kas' && !draft.pay_address) m.push('EVM 收款地址 (0x...)');
  return m.join(' / ');
}

function _formatStatus(status) {
  if (!status || !status.ok) return '没找到你的活跃挂单. 想下新单告诉我.';
  const { qty, filled_qty, expires_at, state: phase, exchange_offer_id } = status;
  const unfilled = parseFloat(qty || 0) - parseFloat(filled_qty || 0);
  // C3 (J2 broker-v2 phase 1 r6): UI infer derived 'published' display from exchange_offer_id NOT NULL.
  // 缓 broker-intake-watcher.js L209 'broadcast' silent fail bug (schema CHECK 拒) — state 不 advance,
  // exchange_offer_id 仍 set. UI infer 'published' 不需 schema enum 加. r6 共识 C3 vote.
  const phaseDisplay = exchange_offer_id
    ? `${phase} (链上挂单 published, offer ID ${exchange_offer_id.slice(0, 8)})`
    : phase;
  return `挂单状态:\n- 总量: ${qty} KAS\n- 已成交: ${filled_qty || 0} KAS\n- 未成交: ${unfilled.toFixed(4)} KAS\n- 状态: ${phaseDisplay}\n- 到期: ${expires_at || '无'}`;
}

function _loadProfile(peer) {
  return sqlite.prepare(`
    SELECT distilled_summary, preferred_chain, preferred_pay_address, tone_preference
    FROM retail_dex_user_memory WHERE user_kasia_address = ?
  `).get(peer);
}

function _loadContact(peer) {
  return sqlite.prepare(`
    SELECT their_alias, classification, trust_level, is_blocked
    FROM relation_states WHERE peer_address = ?
  `).get(peer);
}
