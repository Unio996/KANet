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

// Bug H 5/14 candidate A v2 (Owner 12:05 钦定): broker-escrow custody mode.
// Owner OK γ (env flag) — 默认 false (legacy broker-as-maker behavior, 60/60 regression 不退).
// 全 escrow ship + 测试 done 后 Owner enable → flip to true → 真启 escrow flow.
// 不 sweep legacy _doPublish code 直 escrow stable + Owner ack post-Phase-3 真测.
const ESCROW_MODE = process.env.BROKER_V3_ESCROW_MODE === 'true';

// P1 fix 5/14 (J2 + NWT Tier 4 C1.6 双 host UX gap 实证): broker publishes offers with
// maker = broker_addr (Trader-B addr) per broker-as-maker pattern. user_id 在 metadata.user_id
// 里. listOffers({ maker: user_addr }) 0 row → user 看不见自己挂的单. 修: state-machine 内
// 记 user → [offer_id] (in-memory, 30min TTL align offer expiry), MY_ORDERS 走此 list + getOffer
// 拉详情, 不动 broker-as-maker DB schema, 不破协议层.
const _publishedByUser = new Map();  // user_id → Map<offer_id, expires_at_ms>
const _USER_OFFER_TTL_MS = 35 * 60 * 1000;  // 30min offer TTL + 5min reconciliation buffer

export function addUserOffer(user_id, offer_id) {
  if (!user_id || !offer_id) return;
  let m = _publishedByUser.get(user_id);
  if (!m) { m = new Map(); _publishedByUser.set(user_id, m); }
  m.set(offer_id, Date.now() + _USER_OFFER_TTL_MS);
  // Prune expired entries (cheap O(N) per call, N ≤ ~50 typical)
  const now = Date.now();
  for (const [oid, exp] of m) { if (exp < now) m.delete(oid); }
}
export function getUserOffers(user_id) {
  const m = _publishedByUser.get(user_id);
  if (!m) return [];
  const now = Date.now();
  const live = [];
  for (const [oid, exp] of m) {
    if (exp < now) m.delete(oid);
    else live.push(oid);
  }
  return live;
}
export function _testResetUserOffers() { _publishedByUser.clear(); }

// Phase B P0 fix (J2 #338 per NWT spec 4324dccc): chain menu 6 chain (跟 Phase 2 β prefund align).
// 5/13 broker BSC + polygon (13.99 USDT + 0.05 MATIC) + arbitrum (13.99 + 0.0005 ETH) +
// optimism (13.99 + 0.0001 ETH) + base (13.99 USDC + 0.0002 ETH) 全 funded.
// 老 menu 漏 op + base, user 用不到 prefund. 现 6 chain 全暴露.
export const SUPPORTED_CHAINS = ['bsc', 'eth', 'polygon', 'arbitrum', 'optimism', 'base'];
const MIN_QTY_KAS = 1;
const MAX_QTY_KAS = 5000;
const EVM_ADDR_REGEX = /^0x[a-fA-F0-9]{40}$/;

// Bug BI 5/17 fix (Owner UAT 真测残留 WAIT_PREPAY 跨 session): flow_state 加 TTL 30min 兜底.
// 主路径: exchange-machine.js _refundEscrow + _settleEscrowToUser lifecycle hook clearFlowState.
// 兜底: getFlowState 检 ts > 30min 旧 → auto clear + log (防 lifecycle 漏一处 OR 进程重启后 stale).
const FLOW_STATE_TTL_MS = 30 * 60 * 1000;
export function getFlowState(user_id) {
  const s = _state.get(user_id);
  if (!s) return null;
  if (s._ts && (Date.now() - s._ts) > FLOW_STATE_TTL_MS) {
    console.log(`[broker-v3] stale flow_state 30min TTL cleared for ${user_id.slice(-12)}`);
    _state.delete(user_id);
    return null;
  }
  return s;
}
export function setFlowState(user_id, state) { _state.set(user_id, { ...state, _ts: Date.now() }); }
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
    return { reply: await _menuTopText() };
  }

  // Bug BJ 5/17 fix (Owner UAT 真测 "status" 撞 fall to MENU_TOP):
  // 任意 state 'status'/'查询'/'我的订单'/'orders' → 直接走 MY_ORDERS query.
  // 不 reset flow_state (preserve current sub-step), 只 read 当前订单 status.
  if (/^(status|查询|我的订单|订单|orders?)$/i.test(head)) {
    setFlowState(user_id, { flow: 'MY_ORDERS', step: 'LIST' });
    return { reply: '正在加载你的订单...', triggerMyOrders: true };
  }

  // Bug BG 5/17 fix (Owner UAT 真测 "价格?" 撞 QTY parseFloat reject):
  // 任意 input step "价"/"价格"/"price"/"多少"/"现价"/"查价"/"?" → 显 live price + 不打断 flow.
  // 不 setFlowState, preserve current step, user 再发数字/选项 driver 继续.
  if (/^(价|价格|price|多少|多少钱|现价|查价|[?？])$/i.test(head)) {
    let priceLine;
    try {
      const { getKasPrice } = await import('./exchange-client.js');
      const p = await getKasPrice();
      priceLine = (p && p > 0) ? `📊 KAS 现价 ${p} USDT (live)` : '⚠ oracle 暂不可用';
    } catch { priceLine = '⚠ oracle 暂不可用'; }
    return { reply: `${priceLine}\n\n(继续上一步操作, OR back 返回菜单)` };
  }

  const cur = getFlowState(user_id);
  // 首次 OR MENU_TOP — show menu
  if (!cur || cur.flow === 'MENU_TOP') {
    return await _handleMenuTop(user_id, head);
  }

  switch (cur.flow) {
    // Bug H 5/14 candidate A v2 (Owner 12:05 钦定): BUY/SELL 不再 直 publish, 走 WAIT_PREPAY 中间 state.
    // _handleTradeFlow 处理 CHAIN_SELECT / QTY_SELECT / ADDR_INPUT / CONFIRM / WAIT_PREPAY 全 sub-step.
    case 'BUY_FLOW': return await _handleTradeFlow(user_id, head, cur, 'buy', relayNodeId);
    case 'SELL_FLOW': return await _handleTradeFlow(user_id, head, cur, 'sell', relayNodeId);
    case 'BROWSE_MARKET': return await _handleBrowse(user_id, head, cur);
    case 'ACCEPT_OFFER': return await _handleAccept(user_id, head, cur, relayNodeId);
    case 'MY_ORDERS': return await _handleMyOrders(user_id, head, cur, relayNodeId);
    case 'CANCEL_ORDER': return await _handleCancel(user_id, head, cur, relayNodeId);
    case 'WAIT_PAYMENT': return await _handleWaitPayment(user_id, head, cur, relayNodeId);
    default:
      clearFlowState(user_id);
      return { reply: await _menuTopText() };
  }
}

// Owner 19:30+ UX 严训 (无数次 reiterated): 首屏必带 live KAS 现价, 用户不看 5 步才知道值不值得.
// mid 即撮合价 (不假 spread, 跟 _previewText 字面一致 — 不欺骗 user). 出价 step user 可自定 limit.
const FALLBACK_MID_PRICE_MENU = 0.04;
// Bug BE 5/17 fix: exported so conversations.js fallback canned reply 也能用 priceline,
// 避免 broker fallback message 跟 menu 价格信息不一致 (Owner UAT 真测 "买kas" 自然语言 fallback 撞此).
export async function getMenuTopText() { return await _menuTopText(); }
async function _menuTopText() {
  let priceLine;
  try {
    const { getKasPrice } = await import('./exchange-client.js');
    const p = await getKasPrice();
    priceLine = (p && p > 0)
      ? `📊 KAS 现价 ${p} USDT (live)`
      : `📊 KAS 现价 ${FALLBACK_MID_PRICE_MENU} USDT (⚠ oracle down, fallback)`;
  } catch {
    priceLine = `📊 KAS 现价 ${FALLBACK_MID_PRICE_MENU} USDT (⚠ oracle down, fallback)`;
  }
  return [
    priceLine,
    '',
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

async function _handleMenuTop(user_id, msg) {
  const num = parseInt(msg, 10);
  switch (num) {
    case 1: setFlowState(user_id, { flow: 'BUY_FLOW', step: 'CHAIN_SELECT', draft: { side: 'buy_kas' } }); return { reply: await _chainSelectText('买') };
    case 2: setFlowState(user_id, { flow: 'SELL_FLOW', step: 'CHAIN_SELECT', draft: { side: 'sell_kas' } }); return { reply: await _chainSelectText('卖') };
    case 3: setFlowState(user_id, { flow: 'BROWSE_MARKET', step: 'LIST', page: 0 }); return { reply: '正在加载市场挂单, 稍等...', triggerBrowse: true };
    case 4: setFlowState(user_id, { flow: 'ACCEPT_OFFER', step: 'OFFER_ID_INPUT' }); return { reply: '请输入要接的 offer_id (来 BROWSE_MARKET 选 OR 直接粘贴 8-32 字符 ID), 或回 back 返回菜单.' };
    case 5: setFlowState(user_id, { flow: 'MY_ORDERS', step: 'LIST' }); return { reply: '正在加载你的订单...', triggerMyOrders: true };
    case 6: setFlowState(user_id, { flow: 'CANCEL_ORDER', step: 'ORDER_ID_INPUT' }); return { reply: '请输入要取消的 offer_id, 或回 back 返回菜单.' };
    default: return { reply: await _menuTopText() };  // unknown (含 'kas'/'价'/'price' 自然语言) → re-show menu with live price
  }
}

// Bug BF 5/17 fix (Owner UAT 真测 sub-step 无 priceline): 各 input step prompt 前置 KAS 现价行.
async function _priceLine() {
  try {
    const { getKasPrice } = await import('./exchange-client.js');
    const p = await getKasPrice();
    return (p && p > 0) ? `📊 KAS 现价 ${p} USDT (live)` : null;
  } catch { return null; }
}

async function _chainSelectText(verb) {
  const pl = await _priceLine();
  const lines = [];
  if (pl) { lines.push(pl); lines.push(''); }
  lines.push(`${verb} KAS — 选支付链:`,
    '  1️⃣ BSC (BNB Chain, USDT)',
    '  2️⃣ ETH (Ethereum, USDT)',
    '  3️⃣ Polygon (USDT)',
    '  4️⃣ Arbitrum (USDT)',
    '  5️⃣ Optimism (USDT)',
    '  6️⃣ Base (USDC)',
    '  回数字 1-6 选, back 返回菜单.');
  return lines.join('\n');
}

async function _handleTradeFlow(user_id, msg, cur, side, relayNodeId) {
  const draft = cur.draft || { side: side === 'buy' ? 'buy_kas' : 'sell_kas' };
  if (cur.step === 'CHAIN_SELECT') {
    const num = parseInt(msg, 10);
    const chains = ['bsc', 'eth', 'polygon', 'arbitrum', 'optimism', 'base'];
    if (num < 1 || num > chains.length) return { reply: `数字超范围, 回 1-${SUPPORTED_CHAINS.length} 选链.` };
    draft.pay_chain = chains[num - 1];
    setFlowState(user_id, { ...cur, step: 'QTY_SELECT', draft });
    const _pl1 = await _priceLine();
    return { reply: `${_pl1 ? _pl1 + '\n\n' : ''}已选 ${draft.pay_chain.toUpperCase()}. 数量 (KAS, ${MIN_QTY_KAS}-${MAX_QTY_KAS})?` };
  }
  if (cur.step === 'QTY_SELECT') {
    const qty = parseFloat(msg);
    if (!Number.isFinite(qty) || qty < MIN_QTY_KAS || qty > MAX_QTY_KAS) {
      return { reply: `数量需 ${MIN_QTY_KAS}-${MAX_QTY_KAS} KAS, 重新输.` };
    }
    draft.qty = qty;
    // Bug BF supp 5/17 fix: 补全 sub-step prompts priceline (NWT push back commit 3 partial)
    const _plQty = await _priceLine();
    const _plPfx = _plQty ? _plQty + '\n\n' : '';
    // SELL 路径必 EVM 收款 addr (broker 代发 USDT 到 user); BUY KAS 不需 (broker 给 maker addr 收 USDT, user 收 KAS 到 Kasia)
    if (side === 'sell') {
      setFlowState(user_id, { ...cur, step: 'ADDR_INPUT', draft });
      return { reply: `${_plPfx}${qty} KAS. 请输你自己的 ${draft.pay_chain.toUpperCase()} EVM 钱包 (0x... 42 位) — broker 代发 USDT 到这. 严禁给 broker 或别人 addr.` };
    }
    // BUY KAS skip ADDR_INPUT — but go to PRICE_INPUT if ESCROW_MODE on (Bug H γ Step 4 #3)
    if (ESCROW_MODE) {
      setFlowState(user_id, { ...cur, step: 'PRICE_INPUT', draft });
      // 方向 B Phase 1 5/16 (Owner 04:53 严训 数字严谨 + NWT 05:06 propose): BUY pilot strict 数字 only.
      if (side === 'buy') {
        return { reply: `${_plPfx}${qty} KAS. 出价方式:\n  1️⃣ 用 live oracle 中间价 (mid)\n  2️⃣ 自定 USDT/KAS 价格\n回 1 或 2.` };
      }
      return { reply: `${_plPfx}${qty} KAS. 出价? 回 'mid' 用 live oracle 中间价 OR 自定 USDT/KAS 价格 (e.g. '0.035').` };
    }
    // Legacy non-escrow: skip price input, straight to CONFIRM
    setFlowState(user_id, { ...cur, step: 'CONFIRM', draft });
    return { reply: await _previewText(draft, side), triggerPreview: true };
  }
  if (cur.step === 'ADDR_INPUT') {
    if (!EVM_ADDR_REGEX.test(msg)) return { reply: '地址格式不对, 应是 0x 开头 42 位. 重输 OR back.' };
    draft.pay_address = msg;
    // Bug H γ Step 4 #3 (Owner 17:35): ESCROW_MODE SELL flow 加 PRICE_INPUT step
    if (ESCROW_MODE) {
      setFlowState(user_id, { ...cur, step: 'PRICE_INPUT', draft });
      const _plAddr = await _priceLine();
      return { reply: `${_plAddr ? _plAddr + '\n\n' : ''}addr ✓. 出价? 回 'mid' 用 live oracle 中间价 OR 自定 USDT/KAS 价格 (e.g. '0.040').` };
    }
    // Legacy non-escrow: skip price input
    setFlowState(user_id, { ...cur, step: 'CONFIRM', draft });
    return { reply: await _previewText(draft, side), triggerPreview: true };
  }
  if (cur.step === 'PRICE_INPUT') {
    // Bug H γ Step 4 #3 (Owner 17:35 钦定 invariant + NWT 18:26 propose): user 自定价 prompt.
    // 方向 B Phase 1 5/16 (Owner 04:53 严训 strict 数字): BUY pilot 数字 only (1=mid / 2=自定 → PRICE_VALUE_INPUT).
    // SELL flow 保留 legacy 'mid' OR numeric input behavior (NOT in BUY pilot scope).
    const txt = (msg || '').trim();
    if (side === 'buy') {
      // BUY: strict 1 OR 2
      if (txt === '1') {
        draft.user_price = null;  // mid live oracle
        setFlowState(user_id, { ...cur, step: 'CONFIRM', draft });
        return { reply: await _previewText(draft, side), triggerPreview: true };
      } else if (txt === '2') {
        setFlowState(user_id, { ...cur, step: 'PRICE_VALUE_INPUT', draft });
        const _plPv = await _priceLine();
        return { reply: `${_plPv ? _plPv + '\n\n' : ''}请输自定 USDT/KAS 价格 (e.g. 0.035, 合理范围 0-10).` };
      } else {
        return { reply: `❓ 请输 1 (mid) 或 2 (自定价格).` };
      }
    }
    // SELL flow legacy behavior (preserved)
    const txtLower = txt.toLowerCase();
    let userPrice = null;
    if (txtLower === 'mid' || txtLower === '') {
      userPrice = null;
    } else {
      const p = parseFloat(txtLower);
      if (!Number.isFinite(p) || p <= 0 || p > 10) {
        return { reply: `价格不合理 (合理范围 0-10 USDT/KAS). 重输 OR 回 'mid' 用 oracle.` };
      }
      userPrice = p;
    }
    draft.user_price = userPrice;
    setFlowState(user_id, { ...cur, step: 'CONFIRM', draft });
    return { reply: await _previewText(draft, side), triggerPreview: true };
  }
  // 方向 B Phase 1 NEW step: BUY 自定价 input value (only reachable from PRICE_INPUT via '2')
  if (cur.step === 'PRICE_VALUE_INPUT') {
    const p = parseFloat((msg || '').trim());
    if (!Number.isFinite(p) || p <= 0 || p > 10) {
      return { reply: `❓ 价格不合理 (合理范围 0-10 USDT/KAS), 重输 OR 回 back 重新选 mid/自定.` };
    }
    draft.user_price = p;
    setFlowState(user_id, { ...cur, step: 'CONFIRM', draft });
    return { reply: await _previewText(draft, side), triggerPreview: true };
  }
  if (cur.step === 'CONFIRM') {
    // 方向 B Phase 1 5/16 (Owner 04:53 严训 strict 数字): BUY pilot 1=确认 / 2=取消 only.
    // SELL flow 保留 legacy yes/no behavior.
    if (side === 'buy') {
      if (msg === '1') {
        if (ESCROW_MODE) {
          setFlowState(user_id, { ...cur, step: 'WAIT_PREPAY', draft });
          return { reply: '正在生成报价...', triggerQuote: true, draft };
        }
        return { reply: '正在挂单上链...', triggerPublish: true, draft };
      }
      if (msg === '2') {
        clearFlowState(user_id);
        return { reply: '已取消. 回菜单.\n\n' + await _menuTopText() };
      }
      return { reply: '❓ 请输 1 (确认下单) 或 2 (取消).' };
    }
    // SELL legacy
    if (/^(yes|确认|ok|好|发布)$/i.test(msg)) {
      if (ESCROW_MODE) {
        setFlowState(user_id, { ...cur, step: 'WAIT_PREPAY', draft });
        return { reply: '正在生成报价...', triggerQuote: true, draft };
      }
      return { reply: '正在挂单上链...', triggerPublish: true, draft };
    }
    if (/^(no|取消)$/i.test(msg)) {
      clearFlowState(user_id);
      return { reply: '已取消. 回菜单.\n\n' + await _menuTopText() };
    }
    return { reply: '回 YES 确认下单 / NO 取消 / back 返回菜单.' };
  }
  if (cur.step === 'WAIT_PREPAY') {
    // Bug H 5/14 escrow mode: user 在 broker quote 等 user 真链 prepay 状态.
    if (!ESCROW_MODE) { clearFlowState(user_id); return { reply: '状态错乱 (escrow mode off), 回菜单.\n\n' + await _menuTopText() }; }
    // 方向 B Phase 1 5/16: BUY pilot 1=取消 / 2=查询 only. SELL legacy.
    if (side === 'buy') {
      if (msg === '1') {
        return { reply: '正在取消报价 + 处理 refund...', triggerCancelEscrow: true, draft: cur.draft };
      }
      if (msg === '2') {
        return { reply: '正在查 prepayment status...', triggerCheckPrepayStatus: true, draft: cur.draft };
      }
      return { reply: '等你真链 transfer USDT/KAS 到 broker 地址 (见上一条 quote). 5 min 超时自动取消.\n  1️⃣ 取消 prepayment\n  2️⃣ 查询 prepayment 状态\n回 1 或 2.' };
    }
    // SELL legacy
    if (/^(no|取消|cancel)$/i.test(msg)) {
      return { reply: '正在取消报价 + 处理 refund...', triggerCancelEscrow: true, draft: cur.draft };
    }
    if (/^(status|查)$/i.test(msg)) return { reply: '正在查 prepayment status...', triggerCheckPrepayStatus: true, draft: cur.draft };
    return { reply: '等你真链 transfer USDT/KAS 到 broker 地址 (见上一条 quote). 5 min 超时自动取消. 回 cancel 立即放弃报价 / status 查状态.' };
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
  // Bug H γ Step 4 #3: user_price (limit price) overrides mid if set; else use live oracle mid.
  const effectivePrice = draft.user_price != null ? draft.user_price : (midPrice || FALLBACK_MID_PRICE_PREVIEW);
  const totalStable = (Number(draft.qty) * effectivePrice).toFixed(4);
  let priceLine;
  if (draft.user_price != null) {
    const midLabel = midPrice ? `${midPrice} live` : `${FALLBACK_MID_PRICE_PREVIEW} fallback`;
    priceLine = `  你出价: ${effectivePrice} ${stableAsset}/KAS  (mid ${midLabel})`;
  } else {
    priceLine = midPrice
      ? `  KAS 中间价: ${effectivePrice} ${stableAsset}/KAS (live, 你选 mid)`
      : `  KAS 中间价: ${effectivePrice} ${stableAsset}/KAS (⚠ oracle down, fallback)`;
  }
  const totalLine = side === 'buy'
    ? `  你付总额: ${totalStable} ${stableAsset} (${draft.qty} × ${effectivePrice})`
    : `  你收总额: ${totalStable} ${stableAsset} (${draft.qty} × ${effectivePrice})`;
  // Bug BF supp 5/17: CONFIRM step 也加 priceline header (跟其他 sub-step prompt 一致)
  const _plConfirm = midPrice && midPrice > 0 ? `📊 KAS 现价 ${midPrice} USDT (live)` : null;
  const lines = [];
  if (_plConfirm) { lines.push(_plConfirm, ''); }
  lines.push(
    `📋 订单预览 (${verb} ${draft.qty} KAS, ${draft.pay_chain.toUpperCase()})`,
    '',
    `  方向: ${verb} KAS`,
    `  数量: ${draft.qty} KAS`,
    `  付款链: ${draft.pay_chain.toUpperCase()}`,
    '  ───── 报价 ─────',
    priceLine,
    totalLine,
    '  ─────────────────',
  );
  if (side === 'sell') lines.push(`  你的 ${stableAsset} 收款: ${draft.pay_address}`);
  // Bug AU 5/16 fix (NWT 07:28 Tier 4 surface): prompt 文本同步 strict 数字 for BUY pilot.
  // SELL flow preserve legacy YES/NO 字面 (per "先跑通一个" pilot scope).
  lines.push('', side === 'buy' ? '回 1 确认下单 / 2 取消' : '回 YES 确认下单 / NO 取消');
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
    // Bug D 5/14 fix (NWT 10:43 v3 §C12 surface): ACCEPT flow chain list 旧 4 chain 漏 op + base.
    // BUY/SELL flow L154 已 6 chain (Phase B P0 6f1626059), ACCEPT flow 漏一片 — align 6 chain.
    const chains = SUPPORTED_CHAINS;
    if (num < 1 || num > chains.length) return { reply: `回 1-${SUPPORTED_CHAINS.length} 选链.` };
    cur.draft.selected_chain = chains[num - 1];
    setFlowState(user_id, { ...cur, step: 'CONFIRM', draft: cur.draft });
    return { reply: `选 ${chains[num - 1].toUpperCase()} 支付. 回 YES 确认接单 / NO 取消.` };
  }
  if (cur.step === 'CONFIRM') {
    if (/^(yes|确认|ok|好)$/i.test(msg)) return { reply: '正在 accept...', triggerAccept: true, draft: cur.draft };
    if (/^(no|取消)$/i.test(msg)) { clearFlowState(user_id); return { reply: '已取消.\n\n' + await _menuTopText() }; }
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
    if (/^(no|算了)$/i.test(msg)) { clearFlowState(user_id); return { reply: '不取消. 回菜单.\n\n' + await _menuTopText() }; }
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
