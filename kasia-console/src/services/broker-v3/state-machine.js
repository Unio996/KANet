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

// Phase B P0 fix (J2 #338 per NWT spec 4324dccc): chain menu 6 chain (跟 Phase 2 β prefund align).
// 5/13 broker BSC + polygon (13.99 USDT + 0.05 MATIC) + arbitrum (13.99 + 0.0005 ETH) +
// optimism (13.99 + 0.0001 ETH) + base (13.99 USDC + 0.0002 ETH) 全 funded.
// 老 menu 漏 op + base, user 用不到 prefund. 现 6 chain 全暴露.
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
  // T-J2-2026-05-06 r230 fix: 取 leading token (split on whitespace), 接受 trailing suffix.
  // user '1 #salt-xxx' (避 anti-spam dedup) → head='1', strict regex 仍 match.
  // production '1' 单发 same (single-token trim → '1').
  const head = (msg || '').trim().split(/\s+/)[0] || '';
  if (!head) return { reply: '没收到消息. 回数字 1-6 选择.' };

  // 任意 state 'back'/'取消' → MENU_TOP
  if (/^(back|取消|返回|menu)$/i.test(head)) {
    clearFlowState(user_id);
    return { reply: _menuTopText() };
  }

  const cur = getFlowState(user_id);
  // 首次 OR MENU_TOP — show menu
  if (!cur || cur.flow === 'MENU_TOP') {
    return _handleMenuTop(user_id, head);
  }

  switch (cur.flow) {
    case 'BUY_FLOW': return await _handleTradeFlow(user_id, head, cur, 'buy', relayNodeId);
    case 'SELL_FLOW': return await _handleTradeFlow(user_id, head, cur, 'sell', relayNodeId);
    case 'BROWSE_MARKET': return await _handleBrowse(user_id, head, cur);
    case 'ACCEPT_OFFER': return await _handleAccept(user_id, head, cur, relayNodeId);
    case 'MY_ORDERS': return await _handleMyOrders(user_id, head, cur, relayNodeId);
    case 'CANCEL_ORDER': return await _handleCancel(user_id, head, cur, relayNodeId);
    case 'WAIT_PAYMENT': return await _handleWaitPayment(user_id, head, cur, relayNodeId);
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
    '回数字 1-6 选择.',
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
    '  5️⃣ Optimism (USDT)',
    '  6️⃣ Base (USDC)',
    '  回数字 1-6 选, back 返回菜单.',
  ].join('\n');
}

async function _handleTradeFlow(user_id, msg, cur, side, relayNodeId) {
  const draft = cur.draft || { side: side === 'buy' ? 'buy_kas' : 'sell_kas' };
  if (cur.step === 'CHAIN_SELECT') {
    const num = parseInt(msg, 10);
    const chains = ['bsc', 'eth', 'polygon', 'arbitrum', 'optimism', 'base'];
    if (num < 1 || num > chains.length) return { reply: '数字超范围, 回 1-6 选链.' };
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
    // T-J2-2026-05-06 r232 fix: step='PREVIEW' → 'CONFIRM' (跟 L145 CONFIRM handler align).
    // 旧版 step='PREVIEW' 但 L145 check 'CONFIRM' → mismatch fall default 'state 错乱'. NWT operator chain DM 实战暴露.
    setFlowState(user_id, { ...cur, step: 'CONFIRM', draft });
    return { reply: await _previewText(draft, side), triggerPreview: true };
  }
  if (cur.step === 'ADDR_INPUT') {
    if (!EVM_ADDR_REGEX.test(msg)) return { reply: '地址格式不对, 应是 0x 开头 42 位. 重输 OR back.' };
    draft.pay_address = msg;
    // T-J2-2026-05-06 r232 fix: step='PREVIEW' → 'CONFIRM' (同款 align L145 handler)
    setFlowState(user_id, { ...cur, step: 'CONFIRM', draft });
    return { reply: await _previewText(draft, side), triggerPreview: true };
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

// Bug B 5/14 fix — preview 加报价 (Owner 8:51 实测: 旧 preview 0 价格 = 盲下单).
// 数学跟 router.js _doPublish (L109-111) 同 source: live oracle midPrice → want_amount = qty * mid.
// 不引入 spread (publish 真 want_amount 不含 spread, preview 必跟 publish 字面一致, 不欺骗 user).
const FALLBACK_MID_PRICE_PREVIEW = 0.04;
async function _previewText(draft, side) {
  const verb = side === 'buy' ? '买' : '卖';
  const stableAsset = (draft.pay_chain || '').toLowerCase() === 'base' ? 'USDC' : 'USDT';
  let midPrice = null;
  try {
    const { getKasPrice } = await import('./exchange-client.js');
    midPrice = await getKasPrice();
  } catch {}
  const usedPrice = midPrice || FALLBACK_MID_PRICE_PREVIEW;
  const totalStable = (Number(draft.qty) * usedPrice).toFixed(4);
  const priceLine = midPrice
    ? `  KAS 中间价: ${usedPrice} ${stableAsset}/KAS (live)`
    : `  KAS 中间价: ${usedPrice} ${stableAsset}/KAS (⚠ oracle down, fallback)`;
  const totalLine = side === 'buy'
    ? `  你付总额: ${totalStable} ${stableAsset} (${draft.qty} × ${usedPrice})`
    : `  你收总额: ${totalStable} ${stableAsset} (${draft.qty} × ${usedPrice})`;
  const lines = [
    `📋 订单预览 (${verb} ${draft.qty} KAS, ${draft.pay_chain.toUpperCase()})`,
    '',
    `  方向: ${verb} KAS`,
    `  数量: ${draft.qty} KAS`,
    `  付款链: ${draft.pay_chain.toUpperCase()}`,
    '  ───── 报价 ─────',
    priceLine,
    totalLine,
    '  ─────────────────',
  ];
  if (side === 'sell') lines.push(`  你的 ${stableAsset} 收款: ${draft.pay_address}`);
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

// Phase B P1 (J2 #339 per NWT spec 4324dccc): MY_ORDERS reply translate protocol_status → readable action.
const _STATUS_ACTION = {
  open: '挂单中 (等 taker 接单). 可回 6 取消.',
  matched: '已被 taker 接单, 等 taker 真链付款.',
  verifying: 'broker 验证 taker 付款中 (cross-chain TX). 30-60s 完成.',
  delivering: 'broker 真链交付 KAS 到 taker 中. 30-60s 完成.',
  completed: '✓ 交易完成. KAS 已交付.',
  cancelled: '✗ 已取消. fund_lock 已释放.',
  refunded: '✗ 已退款 (timeout/dispute). fund 已退回.',
  failed: '✗ 失败 (verify 3 retry 后 fail OR 内部错). 走 dispute 启争议.',
  expired: '⏱ 已过期 (TTL 30min 无 taker). fund_lock 已释放.',
  disputed: '⚠ 争议中, 等 arbiter resolve. 联系 Owner.',
  timed_out: '⏱ verify 超时 (taker 未真付). 已 reopen.',
};

async function _handleMyOrders(user_id, msg, cur) {
  const num = parseInt(msg, 10);
  if (cur.step === 'LIST') {
    if (Number.isFinite(num) && num >= 1 && num <= 5 && cur.orders?.[num - 1]) {
      const order = cur.orders[num - 1];
      const action = _STATUS_ACTION[order.protocol_status] || `protocol_status=${order.protocol_status}`;
      return {
        reply: [
          `订单 ${order.id.slice(0, 12)} 详情:`,
          `  ${order.give_amount} ${order.give_asset} → ${order.want_amount} ${order.want_asset} (${order.want_chain || '?'})`,
          `  状态: ${order.protocol_status}`,
          `  ${action}`,
          '',
          '回 back 返回菜单.',
        ].join('\n'),
      };
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
  // Phase B P1 (J2 #339 per NWT spec 4324dccc): WAIT_PAYMENT 接 user payment tx 报告.
  // user "我付了 0xabc..." OR pure 0x[40hex] OR pure 0x[64hex] → 提取 tx hash, 调 submit-payment.
  // "争议" / dispute → triggerDispute.
  // 数字 OR "状态" / status → 查 offer state.
  const txMatch = msg.match(/0x[a-fA-F0-9]{40,66}/);
  if (txMatch) {
    return { reply: `正在提交付款证明 ${txMatch[0].slice(0, 12)}... 验证中.`, triggerSubmitPayment: true, draft: { ...cur.draft, payment_tx: txMatch[0] } };
  }
  if (/^(争议|dispute|纠纷)/i.test(msg)) {
    return { reply: '发起争议中... (broker 验证 paid tx 失败 OR 卡死 时启)', triggerDispute: true, draft: cur.draft };
  }
  if (/^(\d|状态|status|查)/i.test(msg)) {
    return { reply: '正在查订单状态...', triggerOfferStatus: true, draft: cur.draft };
  }
  return {
    reply: [
      '订单等待付款中. 你可以:',
      '  • 回 "我付了 0x<tx>" — 提交付款证明 (broker 自动 verify)',
      '  • 回 "状态" — 查订单状态',
      '  • 回 "争议" — 发起争议 (broker 验证 fail 卡死时启)',
      '  • 回 back — 返回菜单',
    ].join('\n'),
  };
}
