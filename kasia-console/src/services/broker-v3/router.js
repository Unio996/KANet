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
import { sqlite } from '../../db/client.js';

// T-J2-2026-05-12 Fix 2 (5/12 sediment §3.2 bsc-vs-bnb naming): chain normalize.
// BSC family 统一 'bnb' (DB-canonical, align agent_wallets.chain). 跟 api/exchange.js 同款.
// 复用候选 (future): 移 shared util, 先 duplicate 避新建 file (per feedback_no_new_build_iterate_first).
function normalizeChainKey(s) {
  if (!s) return s;
  const lower = String(s).toLowerCase();
  if (lower === 'bsc' || lower === 'bep20' || lower === 'binance-smart-chain') return 'bnb';
  if (lower === 'solana') return 'sol';
  if (lower === 'ethereum') return 'eth';
  return lower;
}

// T-J2-2026-05-07 r259 T2.1b — Layer 2 Price Oracle Gap fix.
// MID_PRICE 改 dynamic /api/trade/kas-price (跟 market-seeder 同 source) — 替 hardcode 0.04 phase 1 placeholder.
// FALLBACK_MID_PRICE 真 oracle down 时 graceful 用 (不阻 publish).
const FALLBACK_MID_PRICE = 0.04;

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

  // Phase A.2 (J2 #336 per NWT spec ffcd4778, Owner 5/13 钦定纯菜单, LLM 残留全删):
  // broker-v2 archive ✓, fall-through 到 v2 LLM path 全删. broker-v3 不识别 → return null,
  // conversations.js dispatch canned reply 提醒 user 用菜单 (NWT spec 替代 LLM fallback).
  // 自然语言 (非数字非 0x) + v3 不在 flow → return null fall canned.
  const trimmed = (msg || '').trim();
  if (!_isLanguageA(trimmed)) {
    return null;  // 自然语言 → canned reply (no LLM fallback)
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
// T-J2-2026-05-06 r230 fix: 取 leading token (split on whitespace), 接受 trailing suffix.
// production user 单发 '1' 仍 work (subset of leading match), 测试加 salt '1 #v3-xxx' 也识别. 通用 + 测试友好.
function _isLanguageA(msg) {
  if (!msg) return false;
  const head = String(msg).trim().split(/\s+/)[0] || '';
  if (/^[1-6]$/.test(head)) return true;  // menu number
  if (/^(back|取消|返回|menu|next)$/i.test(head)) return true;  // 控制 keyword
  if (/^(yes|y|确认|ok|好|发布|算了|no|n|不)$/i.test(head)) return true;  // confirm/cancel
  if (/^0x[a-fA-F0-9]{40}$/.test(head)) return true;  // EVM addr
  if (/^[a-f0-9-]{8,}$/i.test(head)) return true;  // offer_id / uuid
  if (/^\d+(\.\d+)?$/.test(head)) return true;  // qty number
  return false;
}

async function _doPublish(peer, draft, relayNodeId, prevReply) {
  if (!draft) return prevReply + '\n\n(no draft, back 重来)';
  const qty = parseFloat(draft.qty);
  const isBuy = draft.side === 'buy_kas';
  // T-J2-2026-05-07 r259 T2.1b — fetch live KAS mid price (graceful fallback to 0.04 if oracle down)
  const livePrice = await client.getKasPrice();
  const midPrice = livePrice || FALLBACK_MID_PRICE;
  const wantAmount = String((qty * midPrice).toFixed(4));

  // T-J2-2026-05-12 Fix 1 (5/12 sediment §3.1, NWT spec ea519032a §2.1):
  // BUY 分支也必含 accepted_chains. taker (买 USDT 给 broker 换 KAS 的人) 选链支付 → broker 的 USDT 收款 addr 必在 accepted_chains.
  // 跟 SELL 分支区别: SELL 的 accepted_chains[0].address = user 的 USDT 收款 addr (broker 发给 user);
  // BUY 的 accepted_chains[0].address = broker 自己 chain wallet (user 发给 broker).
  const chainKey = normalizeChainKey(draft.pay_chain);  // 'bsc' → 'bnb' 等, align DB agent_wallets.chain
  let brokerWalletAddr = null;
  if (isBuy) {
    const w = sqlite.prepare(
      'SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1 LIMIT 1'
    ).get(relayNodeId, chainKey)
      || sqlite.prepare(
        'SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = ? LIMIT 1'
      ).get(relayNodeId, chainKey);
    if (!w?.address) {
      stateMachine.clearFlowState(peer);
      return `挂单失败: broker 还没在 ${draft.pay_chain.toUpperCase()} 链配 USDT 收款地址. 联系管理员加 wallet OR 选别的链.`;
    }
    brokerWalletAddr = w.address;
  }

  // T-J2-2026-05-07 r259 T2.1c — Layer 4 Loop Closed: hedge_enabled flag 真 broker offer
  // hedge-eligible (executeHedge 真 trade-protocol-filter.js:836-848 真 opt-in gate, default skip).
  // Enable hedge 真 broker 真 fulfill via CEX (post Phase 1 cex-bridge ship).
  const body = isBuy
    ? {
        relayNodeId,
        give_asset: 'KAS', give_amount: String(qty), give_chain: 'kaspa',
        want_asset: 'USDT', want_amount: wantAmount,
        want_chain: chainKey,
        verification: 'cross_chain_tx',
        // Fix 1: accepted_chains 用 broker 自己 wallet addr (user 发 USDT 给 broker)
        verification_meta: {
          accepted_chains: [{ chain: chainKey, address: brokerWalletAddr }],
          expected_asset: 'USDT',
          receive_chain: chainKey,
        },
        expires_minutes: 30,
        metadata: { source: 'broker-v3', user_id: peer, side: 'buy_kas', hedge_enabled: true, mid_price_used: midPrice },
      }
    : {
        relayNodeId,
        give_asset: 'KAS', give_amount: String(qty), give_chain: 'kaspa',
        want_asset: 'USDT', want_amount: wantAmount,
        want_chain: chainKey,
        verification: 'cross_chain_tx',
        // SELL: accepted_chains 用 user 自己的 USDT 收款 addr (broker 发 USDT 给 user). chain normalize align.
        verification_meta: { accepted_chains: [{ chain: chainKey, address: draft.pay_address }], expected_asset: 'USDT' },
        expires_minutes: 30,
        metadata: { source: 'broker-v3', user_id: peer, side: 'sell_kas', hedge_enabled: true, mid_price_used: midPrice },
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
