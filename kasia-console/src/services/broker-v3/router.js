// ════════════════════════════════════════════════════════════════
// broker-v3/router.js — 主入口 dispatch (路 A 选择题 deterministic)
//
// Spec: docs/INVARIANTS-broker-dual-path-v0.4.md (v0.6 iterate per NWT r225)
//
// dispatch flow:
//   1. conversations.js POST /api/agent/reply → BROKER_V3_ENABLED check → handleMessage(peer, msg, opts)
//   2. handleMessage 调 state-machine.processInput(peer, msg, relayNodeId) → { reply, trigger flag, draft }
//   3. 按 trigger flag dispatch:
//      - triggerPublish → exchange-client.publishOffer + transition state
//      - triggerAccept → exchange-client.acceptOffer + reply payment_guide
//      - triggerCancel → exchange-client.cancelOffer
//      - triggerBrowse / triggerMyOrders / triggerOfferLookup / triggerOfferStatus → fetch + back-fill state
//   4. 自然语言 fallback (msg 非数字非 0x 非 'YES'/'NO' 等关键词) → return null (conversations.js fall 路 B matcher)
//
// 跟 broker-v2/router.js 不同: 0 LLM 依赖 (state-machine pure deterministic), 0 sqlite import (全 fetchJson HTTP API).
// ════════════════════════════════════════════════════════════════

import * as stateMachine from './state-machine.js';
import * as client from './exchange-client.js';

const MID_PRICE = 0.04;  // KAS USDT 中价 hardcode (T-J2 phase 1 占位, post-Phase-2 接入 price-oracle real-time)

/**
 * 主入口 — conversations.js BROKER_V3_ENABLED dispatch.
 * @param {string} peer - user kasia 地址 (future: canonical user_id)
 * @param {string} msg - user 当前 chat DM
 * @param {object} opts - { relayNodeId } broker (Trader-B) relay id
 * @returns {Promise<string|null>} reply text, OR null (fallback 路 B matcher)
 */
export async function handleMessage(peer, msg, opts = {}) {
  const relayNodeId = opts.relayNodeId;
  if (!relayNodeId) {
    console.warn('[broker-v3] handleMessage 缺 relayNodeId');
    return null;
  }

  // 自然语言 detect — 不进 state machine, fall 路 B matcher
  // pure 数字 (1-6) / 'back'/'取消'/'YES'/'NO'/'next' / 0x[a-f0-9]{40} / offer_id (uuid-like ≥ 8) → 路 A
  const trimmed = (msg || '').trim();
  if (!_isLanguageA(trimmed)) {
    const cur = stateMachine.getFlowState(peer);
    if (!cur) return null;  // 首发 + 自然语言 → 路 B matcher
    // 已 in flow 但发自然语言 → fall 路 B (broker-v3 user 切自由聊)
    return null;
  }

  const result = await stateMachine.processInput(peer, trimmed, relayNodeId);
  if (!result) return null;

  let reply = result.reply || '';

  // dispatch trigger flag
  try {
    if (result.triggerPublish) reply = await _doPublish(peer, result.draft, relayNodeId, reply);
    else if (result.triggerAccept) reply = await _doAccept(peer, result.draft, relayNodeId, reply);
    else if (result.triggerCancel) reply = await _doCancel(peer, result.draft, relayNodeId, reply);
    else if (result.triggerBrowse) reply = await _doBrowse(peer, reply);
    else if (result.triggerBrowseNext) reply = await _doBrowseNext(peer, reply);
    else if (result.triggerMyOrders) reply = await _doMyOrders(peer, reply);
    else if (result.triggerOfferLookup) reply = await _doOfferLookup(peer, result.draft, reply);
    else if (result.triggerOfferStatus) reply = await _doOfferStatus(peer, result.draft, reply);
  } catch (err) {
    console.error(`[broker-v3] trigger dispatch err: ${err.message}`);
    reply = `操作出错: ${err.message?.slice(0, 80) || 'unknown'}. 回 back 返回菜单.`;
  }

  return reply;
}

// 数字 / back / YES / NO / 0x... / offer_id-like → 进路 A. 其他 → 路 B fallback.
function _isLanguageA(msg) {
  if (!msg) return false;
  if (/^[1-6]$/.test(msg)) return true;  // menu number
  if (/^(back|取消|返回|menu|next)$/i.test(msg)) return true;  // 控制 keyword
  if (/^(yes|y|确认|ok|好|发布|算了|no|n|不)$/i.test(msg)) return true;  // confirm/cancel
  if (/^0x[a-fA-F0-9]{40}$/.test(msg)) return true;  // EVM addr
  if (/^[a-f0-9-]{8,}$/i.test(msg)) return true;  // offer_id / uuid
  if (/^\d+(\.\d+)?$/.test(msg)) return true;  // qty number
  return false;
}

async function _doPublish(peer, draft, relayNodeId, prevReply) {
  if (!draft) return prevReply + '\n\n(no draft, back 重来)';
  const qty = parseFloat(draft.qty);
  const isBuy = draft.side === 'buy_kas';
  const body = isBuy
    ? {
        relayNodeId,
        give_asset: 'KAS', give_amount: String(qty), give_chain: 'kaspa',
        want_asset: 'USDT', want_amount: String((qty * MID_PRICE).toFixed(4)),
        want_chain: draft.pay_chain,
        verification: 'cross_chain_tx',
        verification_meta: { expected_asset: 'USDT', receive_chain: draft.pay_chain },
        expires_minutes: 30,
        metadata: { source: 'broker-v3', user_id: peer, side: 'buy_kas' },
      }
    : {
        relayNodeId,
        give_asset: 'KAS', give_amount: String(qty), give_chain: 'kaspa',
        want_asset: 'USDT', want_amount: String((qty * MID_PRICE).toFixed(4)),
        want_chain: draft.pay_chain,
        verification: 'cross_chain_tx',
        verification_meta: { accepted_chains: [{ chain: draft.pay_chain, address: draft.pay_address }], expected_asset: 'USDT' },
        expires_minutes: 30,
        metadata: { source: 'broker-v3', user_id: peer, side: 'sell_kas' },
      };
  const r = await client.publishOffer(body);
  if (!r.ok) {
    stateMachine.clearFlowState(peer);
    return `挂单失败: ${r.error || 'unknown'}. 回 back 重来.`;
  }
  // ship 成功 — clear draft, return offer detail
  stateMachine.clearFlowState(peer);
  return [
    '✓ 挂单已上链.',
    '',
    `  offer_id: ${r.offer_id?.slice(0, 12)}`,
    `  广播 tx: ${r.broadcast_tx?.slice(0, 16)}`,
    `  到期: ${r.expires_at}`,
    '',
    '回 5 看我的订单 / back 返回菜单.',
  ].join('\n');
}

async function _doAccept(peer, draft, relayNodeId, prevReply) {
  if (!draft?.offer_id || !draft?.selected_chain) return prevReply + '\n\n(no draft, back 重来)';
  const r = await client.acceptOffer({
    relayNodeId, offer_id: draft.offer_id,
    selected_chain: draft.selected_chain,
    payment_asset: 'usdt',
  });
  if (!r.ok) {
    stateMachine.clearFlowState(peer);
    return `接单失败: ${r.error || 'unknown'}. 回 back 重来.`;
  }
  // 进 WAIT_PAYMENT, fetch offer 详情看 maker BSC addr
  const offerR = await client.getOffer(draft.offer_id);
  const meta = (() => { try { return JSON.parse(offerR.offer?.verification_meta || '{}'); } catch { return {}; } })();
  const makerAddr = meta.accepted_chains?.find(c => c.chain === draft.selected_chain)?.address || meta.receive_address || '?';
  const wantAmt = offerR.offer?.want_amount || '?';
  const wantAsset = offerR.offer?.want_asset || 'USDT';
  stateMachine.setFlowState(peer, { flow: 'WAIT_PAYMENT', step: 'PAID', draft: { offer_id: draft.offer_id, selected_chain: draft.selected_chain } });
  return [
    '✓ 接单成功!',
    '',
    `  offer_id: ${draft.offer_id.slice(0, 12)}`,
    `  接单 tx: ${r.accept_tx?.slice(0, 16)}`,
    '',
    '💸 请转 USDT 付款:',
    `  数量: ${wantAmt} ${wantAsset}`,
    `  链: ${draft.selected_chain.toUpperCase()}`,
    `  收款地址: ${makerAddr}`,
    '',
    '付完后 broker 自动验证 + 发 KAS 到你 Kasia. 回 5 查订单状态.',
    r.reputationWarning ? `\n⚠ ${r.reputationWarning.message || ''}` : '',
  ].filter(Boolean).join('\n');
}

async function _doCancel(peer, draft, relayNodeId, prevReply) {
  if (!draft?.offer_id) return prevReply + '\n\n(no draft, back 重来)';
  const r = await client.cancelOffer({ relayNodeId, offer_id: draft.offer_id });
  stateMachine.clearFlowState(peer);
  if (!r.ok) return `取消失败: ${r.error || 'unknown'}. 回 back.`;
  return `✓ 已取消 offer ${draft.offer_id.slice(0, 12)} (cancel tx: ${r.cancel_tx?.slice(0, 16)}). 回 back 返回菜单.`;
}

async function _doBrowse(peer, prevReply) {
  const r = await client.listOffers({ status: 'open', limit: 5, offset: 0 });
  if (!r.ok || !r.offers?.length) return '当前无 active 挂单. 回 back 返回菜单.';
  const cur = stateMachine.getFlowState(peer) || {};
  stateMachine.setFlowState(peer, { ...cur, flow: 'BROWSE_MARKET', step: 'LIST', offers: r.offers, page: 0 });
  return _renderBrowseList(r.offers);
}

async function _doBrowseNext(peer, prevReply) {
  const cur = stateMachine.getFlowState(peer);
  const page = (cur?.page || 0) + 1;
  const r = await client.listOffers({ status: 'open', limit: 5, offset: page * 5 });
  if (!r.ok || !r.offers?.length) return '没更多挂单. 回 back 返回菜单.';
  stateMachine.setFlowState(peer, { ...cur, page, offers: r.offers });
  return _renderBrowseList(r.offers);
}

function _renderBrowseList(offers) {
  const lines = ['📋 市场挂单 (回 1-5 选, next 翻页, back 返回菜单):', ''];
  offers.forEach((o, i) => {
    lines.push(`${i + 1}️⃣ ${o.give_amount} ${o.give_asset} → ${o.want_amount} ${o.want_asset} (${o.want_chain || '?'})`);
    lines.push(`   id: ${o.id?.slice(0, 12)} · maker: ...${o.maker?.slice(-12)}`);
  });
  return lines.join('\n');
}

async function _doMyOrders(peer, prevReply) {
  const r = await client.listOffers({ maker: peer, limit: 5, offset: 0 });
  if (!r.ok || !r.offers?.length) return '你当前没 active 订单. 回 back 返回菜单.';
  const cur = stateMachine.getFlowState(peer) || {};
  stateMachine.setFlowState(peer, { ...cur, flow: 'MY_ORDERS', step: 'LIST', orders: r.offers });
  const lines = ['📋 我的订单 (回 1-5 看详情, back 返回菜单):', ''];
  r.offers.forEach((o, i) => {
    lines.push(`${i + 1}️⃣ [${o.protocol_status}] ${o.give_amount} ${o.give_asset} → ${o.want_amount} ${o.want_asset}`);
    lines.push(`   id: ${o.id?.slice(0, 12)}`);
  });
  return lines.join('\n');
}

async function _doOfferLookup(peer, draft, prevReply) {
  if (!draft?.offer_id) return '缺 offer_id, back 重来.';
  const r = await client.getOffer(draft.offer_id);
  if (!r.ok) return `查 offer 失败: ${r.error || 'not found'}. 回 back.`;
  return [
    `📋 offer ${r.offer.id?.slice(0, 12)} 详情:`,
    `  状态: ${r.offer.protocol_status}`,
    `  give: ${r.offer.give_amount} ${r.offer.give_asset}`,
    `  want: ${r.offer.want_amount} ${r.offer.want_asset} (${r.offer.want_chain || '?'})`,
    `  maker: ...${r.offer.maker?.slice(-12)}`,
    '',
    r.offer.protocol_status === 'open' ? '回 1-4 选支付链接单, OR back 取消.' : '订单状态非 open, 不可接单. back 返回菜单.',
  ].join('\n');
}

async function _doOfferStatus(peer, draft, prevReply) {
  if (!draft?.offer_id) return '缺 offer_id, back.';
  const r = await client.getOffer(draft.offer_id);
  if (!r.ok) return `查 offer 失败: ${r.error || 'not found'}. 回 back.`;
  const status = r.offer.protocol_status;
  const stageMap = {
    open: '⏳ 等接单',
    matched: '✓ 已接单, 等付款',
    verifying: '⏳ 付款验证中 (~1-3 min)',
    delivering: '⏳ 验证通过, 正在发 KAS',
    completed: '✓ 完成! KAS 已发到你 Kasia',
    cancelled: '⊘ 已取消',
    expired: '⏰ 已过期',
    disputed: '⚠ 争议中',
  };
  const stageText = stageMap[status] || `状态: ${status}`;
  return [
    `📋 offer ${r.offer.id?.slice(0, 12)} 状态:`,
    `  ${stageText}`,
    `  give: ${r.offer.give_amount} ${r.offer.give_asset} · want: ${r.offer.want_amount} ${r.offer.want_asset}`,
    '',
    status === 'completed' ? '交易完成! back 返回菜单.' : '回 5 再查 / back 返回菜单.',
  ].join('\n');
}
