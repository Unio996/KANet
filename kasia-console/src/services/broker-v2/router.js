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

// parser fields → retail_dex_orders col name 映射
const FIELD_MAP = {
  direction: 'side',          // buy → buy_kas / sell → sell_kas
  qty: 'qty',
  asset: 'asset',
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

  // 4. 已 publish 路径 — query status OR LLM 自然对话
  if (hasPublished) {
    if (STATUS_QUERY_REGEX.test(msg)) {
      const status = orderBook.getOrderStatus(peer);
      return _formatStatus(status);
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

  // post-seedDraft: 写其他 fields (direction 已 seed 到 side col, 不重写)
  for (const [pname, pvalue] of Object.entries(fields)) {
    if (pname === 'direction') continue;  // already seeded into 'side' col
    const colName = FIELD_MAP[pname];
    if (!colName) continue;
    state.setField(peer, colName, pvalue);
  }

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

  // 8. complete draft + 'aligning' → render preview (NOT advance state, 留 'aligning' 等下 turn 'YES')
  if (draft?.complete && draft.state === 'aligning') {
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

  // 9. draft 不全 → LLM 自然语言问字段
  const profile = _loadProfile(peer);
  const contact = _loadContact(peer);
  const reply = await llm.render(peer, msg, draft, profile, contact);

  // 10. post-LLM tool_calls 可能写字段 → re-check complete (但不 advance, 等 user 'YES')
  draft = state.getActiveDraft(peer);
  if (draft?.complete && draft.state === 'aligning') {
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
  if (!draft) return '方向 (买/卖) + 数量 + 资产 + 链 + 收款地址';
  const m = [];
  if (!draft.side) m.push('方向 (买/卖)');
  if (!draft.qty) m.push('数量');
  if (!draft.asset) m.push('资产 (KAS/USDT/USDC)');
  if (!draft.pay_chain) m.push('链 (BSC/Polygon/SOL/TRON)');
  if (draft.side === 'sell_kas' && !draft.pay_address) m.push('EVM 收款地址 (0x...)');
  return m.join(' / ');
}

function _formatStatus(status) {
  if (!status || !status.ok) return '没找到你的活跃挂单. 想下新单告诉我.';
  const { qty, filled_qty, expires_at, state: phase } = status;
  const unfilled = parseFloat(qty || 0) - parseFloat(filled_qty || 0);
  return `挂单状态:\n- 总量: ${qty} KAS\n- 已成交: ${filled_qty || 0} KAS\n- 未成交: ${unfilled.toFixed(4)} KAS\n- 状态: ${phase}\n- 到期: ${expires_at || '无'}`;
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
