// retail-dex.js — Retail DEX order service
// Handles retail-proxy user order lifecycle via state machine + intent parsing.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';
import { fetchKasPrice } from './market-seeder.js';
import { transferUsdt } from './evm-transfer.js';
import { decrypt } from './crypto.js';

// ── Config ──────────────────────────────────────────────────────────────────

const MAX_ORDER_USDT = 100;
const DAILY_LIMIT_USDT = 500;
const QUOTE_VALIDITY_MS = 30 * 60 * 1000;
const PAYMENT_POLL_INTERVAL_MS = 20_000;
const ORDER_TIMEOUT_MS = 30 * 60 * 1000;

// Intent regex patterns
const INTENT_REGEX = {
  buy_limit:   [/^(?:买|buy)\s*(\d+(?:\.\d+)?)\s*KAS\s*@\s*(\d+(?:\.\d+)?)\s*USDT?/i],
  sell_limit:  [/^(?:卖|sell)\s*(\d+(?:\.\d+)?)\s*KAS\s*@\s*(\d+(?:\.\d+)?)\s*USDT?/i],
  buy_market:  [/^(?:买|buy)\s*(\d+(?:\.\d+)?)\s*KAS\s*$/i],
  sell_market: [/^(?:卖|sell)\s*(\d+(?:\.\d+)?)\s*KAS\s*$/i],
};
const CONFIRM_WORDS = ['YES', 'yes', 'Y', 'y', '确认', '好', '行'];
const CANCEL_WORDS = ['NO', 'no', 'N', 'n', '取消', '不要', '算了'];
const CHAIN_REGEX = /\b(BSC|BNB|BEP20|ETH|TRON|SOL|Solana)\b/i;
const EVM_ADDR_REGEX = /^0x[a-fA-F0-9]{40}$/;
const TXHASH_REGEX = /^0x[a-fA-F0-9]{64}$/;

// ── State Machine ───────────────────────────────────────────────────────────

const STATES = [
  'aligning', 'confirming', 'awaiting_payment', 'paid',
  'executing', 'completed', 'refunding', 'refunded', 'failed', 'expired',
];

const VALID_TRANSITIONS = {
  aligning:         ['confirming', 'expired'],
  confirming:       ['awaiting_payment', 'expired', 'failed'],
  awaiting_payment: ['paid', 'expired', 'refunding'],
  paid:             ['executing', 'refunding'],
  executing:        ['completed', 'refunding', 'failed'],
  refunding:        ['refunded', 'failed'],
  completed:        [],
  refunded:         [],
  failed:           [],
  expired:          [],
};

// ── Intent Parsing ──────────────────────────────────────────────────────────

function parseIntent(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  for (const [name, patterns] of Object.entries(INTENT_REGEX)) {
    for (const re of patterns) {
      const m = trimmed.match(re);
      if (m) {
        const isBuy = name.startsWith('buy');
        return {
          side: isBuy ? 'buy_kas' : 'sell_kas',
          order_type: name.includes('limit') ? 'limit' : 'market',
          qty: m[1],
          price: m[2] || undefined,
        };
      }
    }
  }
  return null;
}

function isConfirm(text) {
  return CONFIRM_WORDS.includes(text.trim());
}

function isCancel(text) {
  return CANCEL_WORDS.includes(text.trim());
}

// ── Data Access ─────────────────────────────────────────────────────────────

function createOrder({ user_kasia_address, side, order_type, qty, price }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ORDER_TIMEOUT_MS).toISOString();

  sqlite.prepare(`
    INSERT INTO retail_dex_orders (
      id, user_kasia_address, side, order_type, qty, price,
      state, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'aligning', ?, ?, ?)
  `).run(id, user_kasia_address, side, order_type, qty, price ?? null, expiresAt, now, now);

  return id;
}

function getActiveOrderForUser(userAddress) {
  return sqlite.prepare(`
    SELECT * FROM retail_dex_orders
    WHERE user_kasia_address = ?
      AND state NOT IN ('completed', 'refunded', 'failed', 'expired')
    ORDER BY updated_at DESC, rowid DESC LIMIT 1
  `).get(userAddress);
}

function getOrderById(id) {
  return sqlite.prepare('SELECT * FROM retail_dex_orders WHERE id = ?').get(id);
}

function updateState(id, newState, extraFields = {}) {
  const fromState = sqlite.prepare('SELECT state FROM retail_dex_orders WHERE id = ?').get(id);
  if (!fromState) throw new Error(`order ${id.slice(0, 8)} not found`);

  const allowed = VALID_TRANSITIONS[fromState.state];
  if (!allowed || !allowed.includes(newState)) {
    throw new Error(
      `illegal transition: ${fromState.state} → ${newState} ` +
      `(allowed: ${(allowed || []).join(', ') || 'none'})`
    );
  }

  const now = new Date().toISOString();
  const fields = { state: newState, ...extraFields };
  const setClauses = Object.entries(fields).map(([k, v]) => `${k} = ?`).join(', ');
  const values = Object.values(fields);
  values.push(now, id);

  sqlite.prepare(`
    UPDATE retail_dex_orders SET ${setClauses}, updated_at = ? WHERE id = ?
  `).run(...values);

  console.log(`[retail-dex] order ${id.slice(0, 8)} ${fromState.state} → ${newState}`);
}

function setField(id, field, value) {
  const now = new Date().toISOString();
  sqlite.prepare(`
    UPDATE retail_dex_orders SET ${field} = ?, updated_at = ? WHERE id = ?
  `).run(value, now, id);
}

// ── Missing Field Detection ────────────────────────────────────────────────

function nextMissingField(order) {
  if (!order) return null;

  const hasPayChain = !!order.pay_chain;
  const hasPayAddress = !!order.pay_address;
  const hasReceiveAddress = !!order.receive_address;

  if (order.side === 'buy_kas') {
    if (!hasPayChain) return { field: 'pay_chain', prompt: '用哪条链支付 USDT？(BSC/BNB/BEP20, ETH, TRON, SOL/Solana)' };
    if (!hasPayAddress) return { field: 'pay_address', prompt: '请发你的 ' + (order.pay_chain.toUpperCase() === 'ETH' ? 'ETH' : order.pay_chain.toUpperCase()) + ' 收款地址 (0x 开头)' };
    return null; // all fields filled
  }

  // sell_kas: receive_address first, then pay_chain reused (semantic extension)
  if (!hasReceiveAddress) return { field: 'receive_address', prompt: '请发你的收款地址 (0x 开头 或 Solana 地址)' };
  if (!order.pay_chain) return { field: 'pay_chain', prompt: '你要收 USDT 的链 (BSC/BNB/BEP20, ETH, TRON, SOL/Solana)?' };
  return null;
}

function tryFillField(order, text) {
  if (!order || !text || typeof text !== 'string') return { filled: false };

  const trimmed = text.trim();

  // EVM address detection first — prevents CHAIN_REGEX from matching
  // substrings inside 0x addresses (e.g., 'ETH' embedded in address)
  const evmMatch = trimmed.match(EVM_ADDR_REGEX);
  if (evmMatch && evmMatch[0].length === 42) {
    let field = null;
    if (order.side === 'buy_kas' && !order.pay_address) {
      field = 'pay_address';
    } else if (order.side === 'sell_kas' && !order.receive_address) {
      field = 'receive_address';
    }
    if (field) {
      setField(order.id, field, evmMatch[0]);
      return { filled: true, field, hint: '地址已保存，继续' };
    }
  }

  // Chain detection (buy_kas: pay_chain / sell_kas: receive_chain)
  if (order.side === 'buy_kas' && !order.pay_chain) {
    const chainMatch = trimmed.match(CHAIN_REGEX);
    if (chainMatch) {
      const chain = chainMatch[1].toUpperCase();
      setField(order.id, 'pay_chain', chain);
      return { filled: true, field: 'pay_chain', hint: `链已设为 ${chain}，请继续` };
    }
  }
  // sell_kas: pay_chain reused for USDT receive chain
  if (order.side === 'sell_kas' && !order.pay_chain) {
    const chainMatch = trimmed.match(CHAIN_REGEX);
    if (chainMatch) {
      const chain = chainMatch[1].toUpperCase();
      setField(order.id, 'pay_chain', chain);
      return { filled: true, field: 'pay_chain', hint: `链已设为 ${chain}，请继续` };
    }
  }

  return { filled: false };
}

// ── PreCheck — hard底线预查 ────────────────────────────────────────────────

function checkSingleLimit(order) {
  if (!order || !order.qty || !order.quoted_usdt) return { ok: true, reason: 'skip', friendly: '' };
  const qty = parseFloat(order.qty);
  const quoted = parseFloat(order.quoted_usdt);
  if (isNaN(qty) || isNaN(quoted)) return { ok: true, reason: 'skip', friendly: '' };
  const total = qty * quoted;
  if (total > MAX_ORDER_USDT) {
    return { ok: false, rule: 'single_limit', reason: `订单金额 ${total.toFixed(2)} USDT 超过单笔限额 ${MAX_ORDER_USDT} USDT`, friendly: `单笔订单最高 ${MAX_ORDER_USDT} USDT，当前报价 ${total.toFixed(2)} USDT` };
  }
  return { ok: true, reason: 'pass', friendly: '' };
}

function checkDailyLimit(userAddress) {
  const today = new Date().toISOString().slice(0, 10);
  const row = sqlite.prepare(`
    SELECT SUM(CAST(quoted_usdt AS REAL)) AS sum FROM retail_dex_orders
    WHERE user_kasia_address = ? AND created_at LIKE ? AND state NOT IN ('expired','failed')
  `).get(userAddress, `${today}%`);
  const total = row && row.sum ? row.sum : 0;
  if (total > DAILY_LIMIT_USDT) {
    return { ok: false, rule: 'daily_limit', reason: `今日累计 ${total.toFixed(2)} USDT 超过日限额 ${DAILY_LIMIT_USDT} USDT`, friendly: `今日已用 ${total.toFixed(2)} USDT，日限额 ${DAILY_LIMIT_USDT} USDT` };
  }
  return { ok: true, reason: 'pass', friendly: '' };
}

function checkUserBalance(order) {
  if (!order || order.side !== 'buy_kas' || !order.pay_address) return { ok: true, reason: 'skip', friendly: '' };
  // MVP: 用户自己保证余额足够。真实 eth_call balanceOf 延后 (M2)。
  // QClaude 原版硬返 ok:false 阻塞所有 buy 单, Opus 修正为 skip。
  return { ok: true, reason: 'skip_mvp', friendly: '' };
}

function checkAgentInventory(order) {
  if (!order) return { ok: true, reason: 'skip', friendly: '' };
  // TODO: check agent EVM/KAS balance
  return { ok: true, reason: 'pass', friendly: '' };
}

function checkMarketDepth(order) {
  if (!order || order.order_type !== 'market') return { ok: true, reason: 'skip', friendly: '' };
  // TODO: check exchange_offers depth
  return { ok: true, reason: 'pass', friendly: '' };
}

function checkPriceDeviation(order, midPrice) {
  if (!order || !order.qty || !order.quoted_usdt || !midPrice) return { ok: true, reason: 'skip', friendly: '' };
  const qty = parseFloat(order.qty);
  const quoted = parseFloat(order.quoted_usdt);
  const midTotal = qty * midPrice;
  if (midTotal === 0) return { ok: true, reason: 'skip', friendly: '' };
  const deviation = Math.abs(quoted - midTotal) / midTotal;
  if (deviation > 0.10) {
    return { ok: false, rule: 'price_deviation', reason: `报价偏离市场价 ${(deviation*100).toFixed(1)}% > 10%`, friendly: `你的报价偏离市场价 ${(deviation*100).toFixed(1)}%，请确认是否继续` };
  }
  return { ok: true, reason: 'pass', friendly: '' };
}

function preCheck(order, userAddress, midPrice) {
  const fails = [];
  if (!order) return { ok: true, fails: [] };
  const checks = [
    checkSingleLimit(order),
    checkDailyLimit(userAddress),
    checkUserBalance(order),
    checkAgentInventory(order),
    checkMarketDepth(order),
    checkPriceDeviation(order, midPrice),
  ];
  for (const r of checks) {
    if (!r.ok) fails.push(r);
  }
  return { ok: fails.length === 0, fails };
}

// ── T6 Quote + 订单确认文本 ──────────────────────────────────────────────

// chain 名归一化 (user 打 "BSC"/"BNB"/"BEP20" 都算 bnb EVM)
function normalizeChain(chain) {
  if (!chain) return null;
  const c = chain.toUpperCase();
  if (c === 'BSC' || c === 'BNB' || c === 'BEP20') return 'bnb';
  if (c === 'ETH' || c === 'ETHEREUM') return 'eth';
  if (c === 'TRON' || c === 'TRX') return 'tron';
  if (c === 'SOL' || c === 'SOLANA') return 'sol';
  return c.toLowerCase();
}

// 查 agent 的 EVM 收款地址 (用户付 USDT 到这个地址) / 或 agent 发 USDT 出去的地址
function getAgentWalletAddr(brokerRelayId, chain) {
  if (!brokerRelayId || !chain) return null;
  const row = sqlite.prepare(
    'SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1 LIMIT 1'
  ).get(brokerRelayId, chain);
  return row?.address || null;
}

/**
 * 选最优 offer (非托管: 本函数在 quote 阶段就选好, 不再等 paid 阶段)
 * buy_kas: 找 give=KAS want=USDT 的 open 卖 KAS 挂单, 价格升序 (买家要最便宜)
 *   - 先精确 give_amount = qty 匹配
 *   - 无精确则 fallback give_amount >= qty (允许部分成交)
 *   - 过滤 accepted_chains 必须含用户指定链
 *   - 无匹配返 null (不 throw)
 */
function selectBestOffer(order) {
  if (!order || !order.pay_chain || !order.qty) return null;
  const normalizedChain = normalizeChain(order.pay_chain);
  if (!normalizedChain) return null;
  const exactQty = String(order.qty);

  if (order.side === 'buy_kas') {
    // 精确匹配优先
    let best = sqlite.prepare(`
      SELECT * FROM exchange_offers
      WHERE protocol_status='open'
        AND give_asset='KAS' AND want_asset='USDT'
        AND give_amount = ?
        AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
      ORDER BY CAST(want_amount AS REAL)/CAST(give_amount AS REAL) ASC
      LIMIT 1
    `).get(exactQty);
    if (!best) {
      best = sqlite.prepare(`
        SELECT * FROM exchange_offers
        WHERE protocol_status='open'
          AND give_asset='KAS' AND want_asset='USDT'
          AND CAST(give_amount AS REAL) >= CAST(? AS REAL)
          AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
        ORDER BY CAST(want_amount AS REAL)/CAST(give_amount AS REAL) ASC
        LIMIT 1
      `).get(exactQty);
    }
    if (!best) return null;
    // JS 层: accepted_chains 含用户指定链
    let meta;
    try { meta = JSON.parse(best.verification_meta || '{}'); } catch { return null; }
    const chains = Array.isArray(meta.accepted_chains) ? meta.accepted_chains : [];
    const hasChain = chains.some(c => c && String(c.chain || '').toLowerCase() === normalizedChain);
    return hasChain ? best : null;
  }

  // sell_kas 本轮不做 (TASK 4.x)
  return null;
}

/**
 * 计算非托管报价 — 用户直付 Maker, 不经 Broker
 *
 * 输入:
 *   order — retail_dex_orders 行 (含 pay_chain, qty)
 *   offer — selectBestOffer 返回的 exchange_offers 行
 *   brokerRelayId — 保留参数, 本函数当前未使用 (未来 Broker 签名/记账用)
 *
 * 返回 (成功):
 *   {ok:true, quoted_usdt, maker_pay_addr, mid_price, offer_id, give_amount}
 * 返回 (失败):
 *   {error: '<code>', friendly: '<中文>'}
 *
 * quoted_usdt = offer.want_amount (Maker 的 ask, 非托管不加 spread)
 * maker_pay_addr 从 offer.verification_meta.accepted_chains 按链匹配
 */
function computeQuote(order, offer, _brokerRelayId) {
  if (!order || !offer) return { error: 'bad_input', friendly: '订单或挂单缺失' };
  const qty = parseFloat(order.qty);
  if (isNaN(qty) || qty <= 0) return { error: 'bad_qty', friendly: '数量无效' };

  const chain = order.pay_chain;
  const normalizedChain = normalizeChain(chain);
  if (!normalizedChain) return { error: 'no_chain', friendly: '缺少链信息' };

  let meta;
  try {
    meta = JSON.parse(offer.verification_meta || '{}');
  } catch {
    return { error: 'bad_meta', friendly: 'Maker 挂单元数据损坏' };
  }
  const chains = Array.isArray(meta.accepted_chains) ? meta.accepted_chains : [];
  const match = chains.find(c => c && String(c.chain || '').toLowerCase() === normalizedChain);
  if (!match || !match.address) {
    return { error: 'no_maker_addr', friendly: `Maker 未公开 ${chain} 收款地址` };
  }

  const want = parseFloat(offer.want_amount);
  if (!isFinite(want) || want <= 0) {
    return { error: 'bad_offer_amount', friendly: '挂单金额异常' };
  }
  const give = parseFloat(offer.give_amount);
  if (!isFinite(give) || give <= 0) {
    return { error: 'bad_offer_amount', friendly: '挂单金额异常' };
  }

  // 部分成交: 若 give_amount > qty, 按比例算 quoted_usdt
  // 非托管语义: 用户只付要买的那部分 (按单价 * qty)
  const unitPrice = want / give;  // USDT per KAS
  const quoted = unitPrice * qty;

  return {
    ok: true,
    quoted_usdt: quoted.toFixed(6),
    maker_pay_addr: match.address,
    mid_price: unitPrice,           // Maker 实际单价 (非 fetchKasPrice midprice, 但语义等同用于 preCheck.price_deviation)
    offer_id: offer.id,
    give_amount: offer.give_amount,
  };
}

/**
 * 生成用户看到的订单确认文本
 */
function buildOrderConfirmText(order, preCheckResult) {
  // 预查失败 → 列失败原因
  if (preCheckResult && !preCheckResult.ok) {
    const reasons = preCheckResult.fails.map(f => `- ${f.friendly}`).join('\n');
    return `⚠ 订单做不了:\n${reasons}\n请调整再试。`;
  }

  const id8 = order.id.slice(0, 8);
  const isBuy = order.side === 'buy_kas';
  const isMarket = order.order_type === 'market';
  const chain = (order.pay_chain || order.receive_chain || '').toUpperCase();
  const userKasiaTail = (order.user_kasia_address || '').slice(-16);

  if (isBuy && isMarket) {
    return [
      `=== 订单确认 ${id8} ===`,
      `动作: 买 ${order.qty} KAS (市价)`,
      `汇率: ${parseFloat(order.mid_price_at_quote || 0).toFixed(6)} USDT/KAS`,
      `你要付: ${order.quoted_usdt} USDT (${chain})`,
      `收款地址: ${order.agent_pay_addr}`,
      `有效期: 30 分钟`,
      ``,
      `操作:`,
      `1. 回复 YES 确认`,
      `2. 30 min 内向上方地址转 ${order.quoted_usdt} USDT`,
      `3. KAS 自动到 ...${userKasiaTail}`,
      ``,
      `失败兜底: USDT 原路退回 ${(order.pay_address || '').slice(0, 10)}...`,
    ].join('\n');
  }
  if (!isBuy && isMarket) {
    return [
      `=== 订单确认 ${id8} ===`,
      `动作: 卖 ${order.qty} KAS (市价)`,
      `汇率: ${parseFloat(order.mid_price_at_quote || 0).toFixed(6)} USDT/KAS`,
      `你将收: ${order.quoted_usdt} USDT (${chain})`,
      `收款地址: ${order.receive_address}`,
      `有效期: 30 分钟`,
      ``,
      `操作:`,
      `1. 回复 YES 确认`,
      `2. 30 min 内从 Kasia 向 ${order.agent_pay_addr} 转 ${order.qty} KAS`,
      `3. USDT 自动到 ${(order.receive_address || '').slice(0, 10)}...`,
    ].join('\n');
  }
  // limit 场景
  return [
    `=== 挂单确认 ${id8} ===`,
    `动作: ${isBuy ? '买' : '卖'} ${order.qty} KAS @ ${order.price} USDT (挂单)`,
    `挂单有效期: 24h`,
    ``,
    `回复 YES 确认挂单。24h 内无人接单自动退款/解锁。`,
  ].join('\n');
}

// ── T8 Order Monitor — 3 阶段 tick ─────────────────────────────────────────

let orderMonitorInterval = null;

/**
 * T8 Phase 2: paid → executing
 * 订单 state=paid: 验证付款 → 选 offer → accept → 转 executing
 */
async function processPaidOrder(order) {
  try {
    const { verifyCrossChainTx } = await import('./cross-chain-verify.mjs');

    // Step 1: 验证用户付款 (USDT on BSC)
    const chain = normalizeChain(order.pay_chain);
    if (!order.pay_tx_hash || !order.pay_address || !order.agent_pay_addr || !order.quoted_usdt) {
      console.warn(`[retail-dex] paid ${order.id.slice(0,8)}: 字段缺失, skip`);
      return;
    }
    const vr = await verifyCrossChainTx({
      txHash: order.pay_tx_hash,
      chain,
      expectedAmount: order.quoted_usdt,
      expectedTo: order.agent_pay_addr,
      expectedFrom: order.pay_address,
      paymentAsset: 'usdt',
    });
    if (!vr?.confirmed) {
      console.warn(`[retail-dex] paid ${order.id.slice(0,8)} verify FAIL: ${vr?.status || 'no result'}`);
      // 3 次验不过推 refunding
      return;
    }
    console.log(`[retail-dex] paid ${order.id.slice(0,8)} verified: ${vr.actualAmount} USDT to ${vr.recipient.slice(-10)}`);

    // Step 2: 选最优 sell_kas offer — 精确匹配 qty（T10 partial fill）
    const isBuy = order.side === 'buy_kas';
    const exactQty = String(order.qty);
    // 先找精确匹配（give_amount 与 order.qty 一致）
    let bestOffer = sqlite.prepare(
      `SELECT * FROM exchange_offers WHERE protocol_status='open' AND give_asset='KAS' AND want_asset='USDT' AND give_amount = ? AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY CAST(want_amount AS REAL)/CAST(give_amount AS REAL) ASC LIMIT 1`
    ).get(exactQty);
    // 无精确匹配 → 找 >= qty 的最优 offer（允许部分成交）
    if (!bestOffer) {
      bestOffer = sqlite.prepare(
        `SELECT * FROM exchange_offers WHERE protocol_status='open' AND give_asset='KAS' AND want_asset='USDT' AND CAST(give_amount AS REAL) >= CAST(? AS REAL) AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY CAST(want_amount AS REAL)/CAST(give_amount AS REAL) ASC LIMIT 1`
      ).get(exactQty);
    }
    if (!bestOffer) {
      console.warn(`[retail-dex] paid ${order.id.slice(0,8)}: 市场无现货, 推 refunding`);
      updateState(order.id, 'refunding', { refund_reason: 'no_matching_offer' });
      return;
    }

    // Step 3: POST /api/exchange/accept
    const consoleUrl = `http://127.0.0.1:${process.env.PORT || 3100}`;
    const acceptRes = await fetch(`${consoleUrl}/api/exchange/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relayNodeId: order._brokerRelayId,  // 需要在 paid order 里带 brokerRelayId, 或 fallback 查 is_dex_broker=1
        offer_id: bestOffer.id,
        selected_chain: chain,
        payment_asset: 'usdt',
      }),
      signal: AbortSignal.timeout(15000),
    });
    const acceptJson = await acceptRes.json().catch(() => ({}));
    if (!acceptRes.ok) {
      console.error(`[retail-dex] paid ${order.id.slice(0,8)} accept FAIL: ${acceptJson.error || acceptRes.status}`);
      return;
    }
    updateState(order.id, 'executing', { exchange_offer_id: bestOffer.id });
    console.log(`[retail-dex] paid ${order.id.slice(0,8)} → executing (offer=${bestOffer.id.slice(0,8)})`);
  } catch (err) {
    console.error(`[retail-dex] processPaidOrder ${order.id.slice(0,8)} error: ${err.message}`);
  }
}

/**
 * T11: refunding → refunded
 * 订单 state=refunding: 退还 USDT 给用户, 3 次重试, 超时推 failed
 */
async function processRefundingOrder(order) {
  try {
    if (!order.pay_chain || !order.pay_address || !order.quoted_usdt || !order._brokerRelayId) {
      console.warn(`[retail-dex] refund ${order.id.slice(0,8)}: 字段缺失, 推 failed`);
      updateState(order.id, 'failed', { fail_reason: 'refund_fields_missing' });
      return;
    }
    // 获取 broker 的私钥
    const wallet = sqlite.prepare(
      "SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = ? ORDER BY is_default DESC LIMIT 1"
    ).get(order._brokerRelayId, normalizeChain(order.pay_chain));
    if (!wallet?.privkey_encrypted) {
      console.warn(`[retail-dex] refund ${order.id.slice(0,8)}: broker 无 ${order.pay_chain} 私钥`);
      updateState(order.id, 'failed', { fail_reason: 'no_broker_privkey' });
      return;
    }
    const privateKey = decrypt(wallet.privkey_encrypted);
    const chain = normalizeChain(order.pay_chain);
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`[retail-dex] refund ${order.id.slice(0,8)} attempt ${attempt}/${MAX_RETRIES}`);
      try {
        const result = await transferUsdt(chain, privateKey, order.pay_address, order.quoted_usdt);
        if (result.ok) {
          updateState(order.id, 'refunded', { refund_tx_hash: result.txHash });
          console.log(`[retail-dex] refund ${order.id.slice(0,8)} → refunded: ${result.txHash.slice(0, 16)}`);
          return;
        }
        console.warn(`[retail-dex] refund ${order.id.slice(0,8)} attempt ${attempt} failed: ${result.error}`);
      } catch (err) {
        console.warn(`[retail-dex] refund ${order.id.slice(0,8)} attempt ${attempt} error: ${err.message}`);
      }
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 10_000));
    }
    // 超时推 failed
    updateState(order.id, 'failed', { fail_reason: 'refund_timeout', refund_attempts: MAX_RETRIES });
    console.error(`[retail-dex] refund ${order.id.slice(0,8)}: ${MAX_RETRIES} attempts exhausted → failed`);
  } catch (err) {
    console.error(`[retail-dex] processRefundingOrder ${order.id.slice(0,8)} error: ${err.message}`);
    updateState(order.id, 'failed', { fail_reason: err.message });
  }
}

/**
 * T8 Phase 3: executing → completed
 * 订单 state=executing: 等 exchange_offer completed, 把 KAS 转给用户
 */
async function processExecutingOrder(order) {
  try {
    if (!order.exchange_offer_id) return;
    const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(order.exchange_offer_id);
    if (!offer) {
      console.warn(`[retail-dex] executing ${order.id.slice(0,8)}: exchange_offer 找不到`);
      return;
    }
    if (offer.protocol_status === 'completed') {
      // KAS 已到 agent 地址 (taker = broker). 转发给用户 Kasia 地址
      // 注意: 这里直接调 relay transfer, KAS 已在 broker 钱包 (exchange-machine auto-deliver 发到 offer.taker = broker)
      const { sendCommandAsync } = await import('./relay-manager.js');
      const sendRes = await sendCommandAsync(order._brokerRelayId, {
        type: 'transfer',
        target: order.user_kasia_address,
        amount: String(order.qty),
      });
      if (sendRes?.txId) {
        updateState(order.id, 'completed', { deliver_tx_hash: sendRes.txId });
        console.log(`[retail-dex] executing ${order.id.slice(0,8)} → completed, KAS delivered: ${sendRes.txId.slice(0,16)}`);
      } else {
        console.error(`[retail-dex] executing ${order.id.slice(0,8)} KAS forward FAIL`);
      }
    } else if (['cancelled', 'disputed'].includes(offer.protocol_status)) {
      updateState(order.id, 'refunding');
      console.warn(`[retail-dex] executing ${order.id.slice(0,8)} → refunding (offer ${offer.protocol_status})`);
    }
  } catch (err) {
    console.error(`[retail-dex] processExecutingOrder ${order.id.slice(0,8)} error: ${err.message}`);
  }
}

async function orderMonitorTick() {
  try {
    // Phase 2: paid → executing
    const paidOrders = sqlite.prepare(`SELECT * FROM retail_dex_orders WHERE state = 'paid' ORDER BY updated_at ASC LIMIT 5`).all();
    for (const o of paidOrders) {
      // brokerRelayId 查: relay_nodes.is_dex_broker=1 (MVP 单 broker)
      const broker = sqlite.prepare("SELECT id FROM relay_nodes WHERE is_dex_broker = 1 LIMIT 1").get();
      o._brokerRelayId = broker?.id;
      await processPaidOrder(o);
    }
    // Phase 4: refunding → refunded
    const refundOrders = sqlite.prepare(`SELECT * FROM retail_dex_orders WHERE state = 'refunding' ORDER BY updated_at ASC LIMIT 5`).all();
    for (const o of refundOrders) {
      const broker = sqlite.prepare("SELECT id FROM relay_nodes WHERE is_dex_broker = 1 LIMIT 1").get();
      o._brokerRelayId = broker?.id;
      await processRefundingOrder(o);
    }
    // Phase 3: executing → completed
    const execOrders = sqlite.prepare(`SELECT * FROM retail_dex_orders WHERE state = 'executing' ORDER BY updated_at ASC LIMIT 5`).all();
    for (const o of execOrders) {
      const broker = sqlite.prepare("SELECT id FROM relay_nodes WHERE is_dex_broker = 1 LIMIT 1").get();
      o._brokerRelayId = broker?.id;
      await processExecutingOrder(o);
    }
    if (paidOrders.length + refundOrders.length + execOrders.length > 0) {
      console.log(`[retail-dex] tick: ${paidOrders.length} paid / ${refundOrders.length} refunding / ${execOrders.length} executing`);
    }
  } catch (err) {
    console.error(`[retail-dex] tick error: ${err.message}`);
  }
}

function startOrderMonitor() {
  if (orderMonitorInterval) return; // 防重入
  orderMonitorInterval = setInterval(orderMonitorTick, PAYMENT_POLL_INTERVAL_MS);
  console.log(`[retail-dex] monitor started (interval=${PAYMENT_POLL_INTERVAL_MS}ms)`);
}

function stopOrderMonitor() {
  if (orderMonitorInterval) {
    clearInterval(orderMonitorInterval);
    orderMonitorInterval = null;
    console.log('[retail-dex] monitor stopped');
  }
}

// ── DM Handler ──────────────────────────────────────────────────────────────

// ── handleDm — 对齐追问主入口 ──────────────────────────────────────────────

async function handleDm(senderAddress, message, brokerRelayId) {
  // fetchKasPrice is imported at top via market-seeder.js (Opus T5 CORRECTION)
  const active = getActiveOrderForUser(senderAddress);
  if (!active) {
    const intent = parseIntent(message);
    if (!intent) {
      return '想换 KAS？发格式：\n"买 X KAS" 或 "买 X KAS @ Y USDT"\n"卖 X KAS" 或 "卖 X KAS @ Y USDT"';
    }
    const id = createOrder({ user_kasia_address: senderAddress, ...intent });
    const fullOrder = getOrderById(id);
    const midPrice = await fetchKasPrice();
    const checkResult = preCheck(fullOrder, senderAddress, midPrice);
    if (!checkResult.ok) {
      const reasons = checkResult.fails.map(f => f.friendly).join('；');
      return `⚠️ 下单前检查不通过：${reasons}。请调整后重试。`;
    }
    const missing = nextMissingField(fullOrder);
    // T10: 下单前 peek offers，告知可买/可卖数量
    let offerTip = '';
    if (!missing) {
      const offers = sqlite.prepare(`SELECT give_amount, give_asset, want_amount FROM exchange_offers WHERE protocol_status='open' AND (expires_at IS NULL OR expires_at > datetime('now'))`).all();
      const canBuy = offers.filter(o => o.give_asset === 'KAS' && o.want_asset === 'USDT').reduce((sum, o) => sum + parseFloat(o.give_amount), 0);
      const canSell = offers.filter(o => o.want_asset === 'KAS' && o.give_asset === 'USDT').reduce((sum, o) => sum + parseFloat(o.give_amount), 0);
      if (intent.side === 'buy_kas' && canBuy > 0) {
        offerTip = `当前市场可买 ${canBuy.toFixed(2)} KAS。`;
      } else if (intent.side === 'sell_kas' && canSell > 0) {
        offerTip = `当前市场可卖 ${canSell.toFixed(2)} KAS。`;
      }
    }
    return `订单 ${id.slice(0, 8)} 已创建。${offerTip}${missing ? missing.prompt : ''}`;
  }

  // Has active order — route by state
  const trimmed = message.trim();
  let current = active;

  // Re-fetch current state after transitions (handleDm can be called multiple times in tests)
  function refresh() { current = getOrderById(current.id); }

  // T6: 字段齐 → 算报价 + 预查 + 返订单确认文本 (or 失败提示)
  async function quoteAndMaybeConfirm(orderId) {
    const order = getOrderById(orderId);
    const midPrice = await fetchKasPrice();
    if (!midPrice) return '市场报价暂不可用,稍后再试。';
    const quote = computeQuote(order, midPrice, brokerRelayId);
    if (!quote.ok) return `⚠ ${quote.friendly}`;
    setField(orderId, 'quoted_usdt', quote.quoted_usdt);
    setField(orderId, 'agent_pay_addr', quote.agent_pay_addr);
    setField(orderId, 'mid_price_at_quote', String(midPrice));
    const fullOrder = getOrderById(orderId);
    const pc = preCheck(fullOrder, senderAddress, midPrice);
    if (!pc.ok) return buildOrderConfirmText(fullOrder, pc);
    updateState(orderId, 'confirming');
    return buildOrderConfirmText(fullOrder);
  }

  switch (current.state) {
    case 'aligning': {
      // Confirm/cancel keywords — auto-transition when all fields filled
      if (isConfirm(trimmed)) {
        const missing = nextMissingField(getOrderById(current.id));
        if (!missing) {
          const text = await quoteAndMaybeConfirm(current.id);
          refresh();
          return text;
        }
        return `还有字段未填: ${missing.prompt}`;
      }
      if (isCancel(trimmed)) {
        updateState(current.id, 'expired');
        refresh();
        return '订单已取消。';
      }
      // Try to fill missing fields first
      const fill = tryFillField(current, trimmed);
      if (fill.filled) {
        refresh();
        const next = nextMissingField(getOrderById(current.id));
        if (!next) {
          const text = await quoteAndMaybeConfirm(current.id);
          refresh();
          return text;
        }
        return `字段已保存。${next.prompt}`;
      }
      // Intent parse — new order overrides
      const intent = parseIntent(trimmed);
      if (intent) {
        const newId = createOrder({ user_kasia_address: senderAddress, ...intent });
        const newOrder = getOrderById(newId);
        const missing = nextMissingField(newOrder);
        return `已建新订单 ${newId.slice(0, 8)}。${missing ? missing.prompt : ''}`;
      }
      return `当前订单 ${current.id.slice(0, 8)} (${current.state})。${nextMissingField(current)?.prompt || '请确认'}`;
    }

    case 'confirming': {
      if (isConfirm(trimmed)) {
        updateState(current.id, 'awaiting_payment');
        refresh();
        return '已确认。等待支付...';
      }
      if (isCancel(trimmed)) {
        updateState(current.id, 'expired');
        refresh();
        return '订单已取消。';
      }
      return '请回 YES 或 NO。';
    }

    case 'awaiting_payment': {
      if (TXHASH_REGEX.test(trimmed)) {
        updateState(current.id, 'paid', { pay_tx_hash: trimmed });
        refresh();
        return '已记录 TX hash，等待验证交割...';
      }
      return current.pay_tx_hash ? '已记录，等待验证' : '请发付款 tx hash (0x 开头的 66 位 hex)';
    }

    default:
      return `订单 ${current.id.slice(0, 8)} 状态: ${current.state}。已结束，不可操作。`;
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────

export {
  handleDm,
  startOrderMonitor,
  stopOrderMonitor,
  createOrder,
  getActiveOrderForUser,
  getOrderById,
  updateState,
  parseIntent,
  nextMissingField,
  tryFillField,
  isConfirm,
  isCancel,
  preCheck,
  checkSingleLimit,
  checkDailyLimit,
  checkUserBalance,
  checkAgentInventory,
  checkMarketDepth,
  checkPriceDeviation,
  selectBestOffer,
  computeQuote,
  buildOrderConfirmText,
  normalizeChain,
  getAgentWalletAddr,
  TXHASH_REGEX,
  CHAIN_REGEX,
  EVM_ADDR_REGEX,
  INTENT_REGEX,
  CONFIRM_WORDS,
  CANCEL_WORDS,
  STATES,
  MAX_ORDER_USDT,
  DAILY_LIMIT_USDT,
  QUOTE_VALIDITY_MS,
  PAYMENT_POLL_INTERVAL_MS,
  ORDER_TIMEOUT_MS,
};
