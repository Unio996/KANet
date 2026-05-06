// ════════════════════════════════════════════════════════════════
// broker-v3/state-machine.js — 选择题 state 流转图 (deterministic 0 LLM)
//
// Spec: docs/INVARIANTS-broker-dual-path-v0.4.md (v0.6 iterate per NWT r225)
//
// state 流转图 (per v0.6 §4):
//   START → MENU_TOP
//   MENU_TOP: '1'→BUY_FLOW '2'→SELL_FLOW '3'→BROWSE_MARKET '4'→ACCEPT_OFFER '5'→MY_ORDERS '6'→CANCEL_ORDER
//   BUY_FLOW / SELL_FLOW: CHAIN_SELECT → QTY_SELECT → ADDR_INPUT → PREVIEW → CONFIRM
//   ACCEPT_OFFER: OFFER_ID_INPUT → CHAIN_SELECT → POST accept → reply PAYMENT_GUIDE → state 'WAIT_PAYMENT'
//   任何 state user reply '取消'/'back' → 回 MENU_TOP
//   user 自然语言 (非数字非 0x) → 路 B fallback (router.js handle, NOT 此 state-machine)
//
// chain events 监听: broker-v3 是 sync dispatch (per user msg), 不主动 daemon 监听.
//   user 下次 chat (MY_ORDERS / '查单') → broker fetch /api/exchange/offers 看 state → reply update.
//   NWT r223 实证 path align: accept → user 真付 USDT → bsc-watcher 自动 detect + paid_v1 → exchange-machine
//   transition → broker auto sendKas → completed. broker-v3 不参与 settlement 中段, 仅 reply payment guide.
//
// state storage: in-memory Map per user_id (console restart 丢, 选择题 user session 短 ~1-5 min, 可接受).
// ════════════════════════════════════════════════════════════════

const _state = new Map();  // user_id → { flow, step, draft }

const SUPPORTED_CHAINS = ['bsc', 'eth', 'polygon', 'arbitrum', 'optimism', 'base'];
const MIN_QTY_KAS = 1;
const MAX_QTY_KAS = 5000;
const EVM_ADDR_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function getFlowState(user_id) { return _state.get(user_id) || null; }
export function setFlowState(user_id, state) { _state.set(user_id, state); }
export function clearFlowState(user_id) { _state.delete(user_id); }
export function _testReset() { _state.clear(); }

/**
 * 主入口: dispatch by flow + step. user 输入 → 状态机推进 → return reply text + nextState.
 * @param {string} user_id - peer kasia 地址 (or future canonical user_id)
 * @param {string} msg - user 当前消息
 * @param {string} relayNodeId - broker (Trader-B) relay id
 * @returns {Promise<{ reply, nextState? }>}
 */
export async function processInput(user_id, msg, relayNodeId) {
  const trimmed = (msg || '').trim();
  if (!trimmed) return { reply: '没收到消息. 回数字 1-6 选择.' };

  // 任意 state 'back'/'取消' → MENU_TOP
  if (/^(back|取消|返回|menu)$/i.test(trimmed)) {
    clearFlowState(user_id);
    return { reply: _menuTopText() };
  }

  const cur = getFlowState(user_id);
  // 首次 OR MENU_TOP — show menu
  if (!cur || cur.flow === 'MENU_TOP') {
    return _handleMenuTop(user_id, trimmed);
  }

  switch (cur.flow) {
    case 'BUY_FLOW': return _handleTradeFlow(user_id, trimmed, cur, 'buy', relayNodeId);
    case 'SELL_FLOW': return _handleTradeFlow(user_id, trimmed, cur, 'sell', relayNodeId);
    case 'BROWSE_MARKET': return await _handleBrowse(user_id, trimmed, cur);
    case 'ACCEPT_OFFER': return await _handleAccept(user_id, trimmed, cur, relayNodeId);
    case 'MY_ORDERS': return await _handleMyOrders(user_id, trimmed, cur, relayNodeId);
    case 'CANCEL_ORDER': return await _handleCancel(user_id, trimmed, cur, relayNodeId);
    case 'WAIT_PAYMENT': return await _handleWaitPayment(user_id, trimmed, cur, relayNodeId);
    default:
      clearFlowState(user_id);
      return { reply: _menuTopText() };
  }
}

function _menuTopText() {
  return [
    '你好! 我是 Trader-B, KAS 撮合 broker.',
    '你想做什么?',
    '',
    '  1️⃣ 买 KAS (我帮你挂限价买单)',
    '  2️⃣ 卖 KAS (我帮你挂限价卖单)',
    '  3️⃣ 看市场挂单',
    '  4️⃣ 接挂单 (taker 接 maker offer)',
    '  5️⃣ 我的订单 (查 status)',
    '  6️⃣ 取消挂单',
    '',
    '回数字 1-6 选择. (也可以打字描述意图, 我有 LLM 助手识别)',
  ].join('\n');
}

function _handleMenuTop(user_id, msg) {
  const num = parseInt(msg, 10);
  switch (num) {
    case 1: setFlowState(user_id, { flow: 'BUY_FLOW', step: 'CHAIN_SELECT', draft: { side: 'buy_kas' } }); return { reply: _chainSelectText('买') };
    case 2: setFlowState(user_id, { flow: 'SELL_FLOW', step: 'CHAIN_SELECT', draft: { side: 'sell_kas' } }); return { reply: _chainSelectText('卖') };
    case 3: setFlowState(user_id, { flow: 'BROWSE_MARKET', step: 'LIST', page: 0 }); return { reply: '正在加载市场挂单, 稍等...', triggerBrowse: true };
    case 4: setFlowState(user_id, { flow: 'ACCEPT_OFFER', step: 'OFFER_ID_INPUT' }); return { reply: '请输入要接的 offer_id (来 BROWSE_MARKET 选 OR 直接粘贴 8-32 字符 ID), 或回 back 返回菜单.' };
    case 5: setFlowState(user_id, { flow: 'MY_ORDERS', step: 'LIST' }); return { reply: '正在加载你的订单...', triggerMyOrders: true };
    case 6: setFlowState(user_id, { flow: 'CANCEL_ORDER', step: 'ORDER_ID_INPUT' }); return { reply: '请输入要取消的 offer_id, 或回 back 返回菜单.' };
    default: return { reply: _menuTopText() };  // unknown → re-show menu
  }
}

function _chainSelectText(verb) {
  return [
    `${verb} KAS — 选支付链:`,
    '  1️⃣ BSC (BNB Chain, USDT)',
    '  2️⃣ ETH (Ethereum, USDT)',
    '  3️⃣ Polygon (USDT)',
    '  4️⃣ Arbitrum (USDT)',
    '  回数字 1-4 选, back 返回菜单.',
  ].join('\n');
}

function _handleTradeFlow(user_id, msg, cur, side, relayNodeId) {
  const draft = cur.draft || { side: side === 'buy' ? 'buy_kas' : 'sell_kas' };
  if (cur.step === 'CHAIN_SELECT') {
    const num = parseInt(msg, 10);
    const chains = ['bsc', 'eth', 'polygon', 'arbitrum'];
    if (num < 1 || num > chains.length) return { reply: '数字超范围, 回 1-4 选链.' };
    draft.pay_chain = chains[num - 1];
    setFlowState(user_id, { ...cur, step: 'QTY_SELECT', draft });
    return { reply: `已选 ${draft.pay_chain.toUpperCase()}. 数量 (KAS, ${MIN_QTY_KAS}-${MAX_QTY_KAS})?` };
  }
  if (cur.step === 'QTY_SELECT') {
    const qty = parseFloat(msg);
    if (!Number.isFinite(qty) || qty < MIN_QTY_KAS || qty > MAX_QTY_KAS) {
      return { reply: `数量需 ${MIN_QTY_KAS}-${MAX_QTY_KAS} KAS, 重新输.` };
    }
    draft.qty = qty;
    // SELL 路径必 EVM 收款 addr (broker 代发 USDT 到 user); BUY KAS 不需 (broker 给 maker addr 收 USDT, user 收 KAS 到 Kasia)
    if (side === 'sell') {
      setFlowState(user_id, { ...cur, step: 'ADDR_INPUT', draft });
      return { reply: `${qty} KAS. 请输你自己的 ${draft.pay_chain.toUpperCase()} EVM 钱包 (0x... 42 位) — broker 代发 USDT 到这. 严禁给 broker 或别人 addr.` };
    }
    // BUY KAS skip ADDR_INPUT
    setFlowState(user_id, { ...cur, step: 'PREVIEW', draft });
    return { reply: _previewText(draft, side), triggerPreview: true };
  }
  if (cur.step === 'ADDR_INPUT') {
    if (!EVM_ADDR_REGEX.test(msg)) return { reply: '地址格式不对, 应是 0x 开头 42 位. 重输 OR back.' };
    draft.pay_address = msg;
    setFlowState(user_id, { ...cur, step: 'PREVIEW', draft });
    return { reply: _previewText(draft, side), triggerPreview: true };
  }
  if (cur.step === 'CONFIRM') {
    if (/^(yes|确认|ok|好|发布)$/i.test(msg)) {
      // router.js 调 publishOffer + transition state → WAIT_PAYMENT
      return { reply: '正在挂单上链...', triggerPublish: true, draft };
    }
    if (/^(no|取消)$/i.test(msg)) {
      clearFlowState(user_id);
      return { reply: '已取消. 回菜单.\n\n' + _menuTopText() };
    }
    return { reply: '回 YES 确认下单 / NO 取消 / back 返回菜单.' };
  }
  return { reply: '状态错乱, 回 back 返回菜单重来.' };
}

function _previewText(draft, side) {
  const verb = side === 'buy' ? '买' : '卖';
  const lines = [
    `📋 订单预览 (${verb} ${draft.qty} KAS, ${draft.pay_chain.toUpperCase()})`,
    '',
    `  方向: ${verb} KAS`,
    `  数量: ${draft.qty} KAS`,
    `  付款链: ${draft.pay_chain.toUpperCase()}`,
  ];
  if (side === 'sell') lines.push(`  你的 USDT 收款: ${draft.pay_address}`);
  lines.push('', '回 YES 确认下单 / NO 取消');
  return lines.join('\n');
}

async function _handleBrowse(user_id, msg, cur) {
  const num = parseInt(msg, 10);
  if (cur.step === 'LIST') {
    if (Number.isFinite(num) && num >= 1 && num <= 5 && cur.offers?.[num - 1]) {
      const offer = cur.offers[num - 1];
      setFlowState(user_id, { flow: 'ACCEPT_OFFER', step: 'CHAIN_SELECT', draft: { offer_id: offer.id } });
      return { reply: `已选 offer ${offer.id.slice(0, 12)}. 选支付链:\n${_chainSelectText('支付')}` };
    }
    if (msg === 'next') return { reply: '加载下一页...', triggerBrowseNext: true };
  }
  return { reply: '回 1-5 选 offer / next 翻页 / back 返回菜单.' };
}

async function _handleAccept(user_id, msg, cur, relayNodeId) {
  if (cur.step === 'OFFER_ID_INPUT') {
    if (msg.length < 8) return { reply: 'offer_id 太短 (至少 8 字符), 重输 OR back.' };
    const draft = { offer_id: msg };
    setFlowState(user_id, { ...cur, step: 'CHAIN_SELECT', draft });
    return { reply: `查 offer ${msg.slice(0, 12)} 中...`, triggerOfferLookup: true, draft };
  }
  if (cur.step === 'CHAIN_SELECT') {
    const num = parseInt(msg, 10);
    const chains = ['bsc', 'eth', 'polygon', 'arbitrum'];
    if (num < 1 || num > chains.length) return { reply: '回 1-4 选链.' };
    cur.draft.selected_chain = chains[num - 1];
    setFlowState(user_id, { ...cur, step: 'CONFIRM', draft: cur.draft });
    return { reply: `选 ${chains[num - 1].toUpperCase()} 支付. 回 YES 确认接单 / NO 取消.` };
  }
  if (cur.step === 'CONFIRM') {
    if (/^(yes|确认|ok|好)$/i.test(msg)) return { reply: '正在 accept...', triggerAccept: true, draft: cur.draft };
    if (/^(no|取消)$/i.test(msg)) { clearFlowState(user_id); return { reply: '已取消.\n\n' + _menuTopText() }; }
    return { reply: '回 YES / NO / back.' };
  }
  return { reply: '状态错乱, back 重来.' };
}

async function _handleMyOrders(user_id, msg, cur) {
  const num = parseInt(msg, 10);
  if (cur.step === 'LIST') {
    if (Number.isFinite(num) && num >= 1 && num <= 5 && cur.orders?.[num - 1]) {
      const order = cur.orders[num - 1];
      return { reply: `订单 ${order.id.slice(0, 12)} 详情:\n  状态: ${order.protocol_status}\n  give: ${order.give_amount} ${order.give_asset}\n  want: ${order.want_amount} ${order.want_asset}\n\n回 back 返回菜单.` };
    }
  }
  return { reply: '回 1-5 看详情 / back 返回菜单.' };
}

async function _handleCancel(user_id, msg, cur) {
  if (cur.step === 'ORDER_ID_INPUT') {
    if (msg.length < 8) return { reply: 'offer_id 太短, 重输 OR back.' };
    setFlowState(user_id, { ...cur, step: 'CONFIRM_CANCEL', draft: { offer_id: msg } });
    return { reply: `确认取消 offer ${msg.slice(0, 12)}? 回 YES 确认 / NO 算了.` };
  }
  if (cur.step === 'CONFIRM_CANCEL') {
    if (/^(yes|确认|ok|好)$/i.test(msg)) return { reply: '正在 cancel...', triggerCancel: true, draft: cur.draft };
    if (/^(no|算了)$/i.test(msg)) { clearFlowState(user_id); return { reply: '不取消. 回菜单.\n\n' + _menuTopText() }; }
  }
  return { reply: '回 YES / NO / back.' };
}

async function _handleWaitPayment(user_id, msg, cur, relayNodeId) {
  // user 已 accept, 等真付款. 主动查 offer state.
  return { reply: '正在查订单状态...', triggerOfferStatus: true, draft: cur.draft };
}
