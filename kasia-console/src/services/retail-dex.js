// retail-dex.js — Retail DEX order service
// Handles retail-proxy user order lifecycle via state machine + intent parsing.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';
import { fetchKasPrice } from './market-seeder.js';
import { transferUsdt } from './evm-transfer.js';
import { decrypt } from './crypto.js';

// ── Broker config helpers ──────────────────────────────────────────────────

const DEFAULT_FEE_KAS = '0.1';

function getFeeKasPerOrder(brokerRelayId) {
  const row = sqlite.prepare(
    'SELECT fee_kas_per_order FROM retail_dex_broker_config WHERE broker_relay_id = ?'
  ).get(brokerRelayId || null);
  return row?.fee_kas_per_order || DEFAULT_FEE_KAS;
}

// ── Config ──────────────────────────────────────────────────────────────────

const MAX_ORDER_USDT = 100;
const DAILY_LIMIT_USDT = 500;
const QUOTE_VALIDITY_MS = 30 * 60 * 1000;
const PAYMENT_POLL_INTERVAL_MS = 20_000;
const ORDER_TIMEOUT_MS = 30 * 60 * 1000;

// Intent regex patterns
// 2026-04-23 修: 允许中文量词 (个/枚/只) 和中文后缀 "个 KAS" — 自然中文说法
// 原: "买50个kas" 不匹配, 只能说 "买50 KAS"
const INTENT_REGEX = {
  buy_limit:   [/^(?:买|buy)\s*(\d+(?:\.\d+)?)\s*[个枚只]?\s*KAS\s*@\s*(\d+(?:\.\d+)?)\s*USDT?/i],
  sell_limit:  [/^(?:卖|sell)\s*(\d+(?:\.\d+)?)\s*[个枚只]?\s*KAS\s*@\s*(\d+(?:\.\d+)?)\s*USDT?/i],
  buy_market:  [/^(?:买|buy)\s*(\d+(?:\.\d+)?)\s*[个枚只]?\s*KAS\s*$/i],
  sell_market: [/^(?:卖|sell)\s*(\d+(?:\.\d+)?)\s*[个枚只]?\s*KAS\s*$/i],
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

function createOrder({ user_kasia_address, side, order_type, qty, price, brokerRelayId }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ORDER_TIMEOUT_MS).toISOString();
  const feeKas = getFeeKasPerOrder(brokerRelayId);
  const qtyNum = parseFloat(qty);
  const brokerFeeKas = feeKas;
  const netDeliveryKas = (qtyNum - parseFloat(feeKas)).toFixed(6);

  sqlite.prepare(`
    INSERT INTO retail_dex_orders (
      id, user_kasia_address, side, order_type, qty, price,
      state, expires_at, created_at, updated_at, broker_fee_kas, net_delivery_kas
    ) VALUES (?, ?, ?, ?, ?, ?, 'aligning', ?, ?, ?, ?, ?)
  `).run(id, user_kasia_address, side, order_type, qty, price ?? null, expiresAt, now, now, brokerFeeKas, netDeliveryKas);

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
  const feeKas = parseFloat(order.broker_fee_kas || DEFAULT_FEE_KAS);
  const netDelivery = order.net_delivery_kas
    ? parseFloat(order.net_delivery_kas)
    : parseFloat(order.qty) - feeKas;

  if (isBuy && isMarket) {
    return [
      `=== 订单确认 ${id8} (非托管) ===`,
      `动作: 买 ${order.qty} KAS (市价)`,
      `汇率: ${parseFloat(order.mid_price_at_quote || 0).toFixed(6)} USDT/KAS`,
      `你付: ${order.quoted_usdt} USDT (${chain}) → Maker 直收`,
      `扣 ${feeKas} KAS 撮合服务费 (Broker 内部结算, 不用你单独转)`,
      `实到: ${netDelivery.toFixed(6)} KAS (到你 Kasia 地址 ...${userKasiaTail})`,
      `有效期: 30 分钟`,
      ``,
      `操作:`,
      `1. 回复 YES 确认 — Broker 会上链代你广播 accept`,
      `2. 30 min 内用自己钱包付 ${order.quoted_usdt} USDT 到上方 Maker 地址`,
      `3. 付完把 tx hash 回复给我`,
      `4. Maker 自动把 KAS 直发到你的 Kasia`,
      ``,
      `说明: 你的 USDT 直接给 Maker, Broker 全程不持有资金, 只代发链上广播。`,
      `争议: Maker 违约可走 dispute 协议由社区仲裁。`,
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
 * TASK 2.3 Phase 2 (非托管): paid → executing
 * state=paid: 只做一件事 — 广播 kanet_exchange_paid_v1(payment_tx=user's tx)
 * 验证 + Maker 交付 + offer 推进 completed 全部交给 exchange-machine.handleExchangePaid
 *
 * NO 验证 (exchange-machine 做)
 * NO accept 调用 (handleDm confirming YES 时已广播)
 * NO auto-pay (非托管 Broker 不碰 USDT)
 */
async function processPaidOrder(order) {
  try {
    if (!order.pay_tx_hash || !order.exchange_offer_id || !order._brokerRelayId) {
      console.warn(`[retail-dex] paid ${order.id.slice(0,8)}: 字段缺失 (tx_hash/offer_id/broker), skip`);
      return;
    }
    const chain = normalizeChain(order.pay_chain);
    const payload = {
      t: 'kanet_exchange_paid_v1',
      offer_id: order.exchange_offer_id,
      payment_tx: order.pay_tx_hash,
      payment_chain: chain,
    };
    const send = await _getSendCommandAsync();
    const res = await send(order._brokerRelayId, {
      type: 'send_broadcast',
      channel: 'kanet-exchange',
      message: JSON.stringify(payload),
    });
    if (!res?.txId) {
      console.warn(`[retail-dex] paid ${order.id.slice(0,8)} paid_v1 broadcast no txId, 保留 paid 下 tick 重试`);
      return;
    }
    console.log(`[retail-dex] paid ${order.id.slice(0,8)} paid_v1 上链 tx=${res.txId.slice(0,16)} → executing`);
    updateState(order.id, 'executing');
  } catch (err) {
    console.error(`[retail-dex] processPaidOrder ${order.id.slice(0,8)} error: ${err.message}`);
  }
}

/**
 * TASK 2.3 非托管: refunding → failed (Broker 不持有 USDT, 无法主动退款)
 *
 * 非托管路径下, 用户直接把 USDT 付给 Maker, Broker 全程不碰钱.
 * 如果订单进 refunding (offer cancelled/disputed), Broker 没有能力退款.
 * 只能标 failed, reason='non_custodial_maker_refund_required'
 * 用户需走 dispute 协议或找 Maker 直接交涉.
 *
 * 原托管版的 evm-transfer.transferUsdt 退款路径已移除.
 */
async function processRefundingOrder(order) {
  try {
    console.warn(`[retail-dex] refund ${order.id.slice(0,8)}: 非托管下 Broker 无法退款 → failed (走 dispute)`);
    updateState(order.id, 'failed', {
      error_reason: 'non_custodial_maker_refund_required',
    });
  } catch (err) {
    console.error(`[retail-dex] processRefundingOrder ${order.id.slice(0,8)} error: ${err.message}`);
  }
}

/**
 * TASK 2.3 Phase 3 (非托管): executing → completed
 * state=executing: 观察 exchange_offers.protocol_status
 *   = completed → KAS 已由 Maker 直发用户 Kasia (exchange-machine.js:634 receive_address 路由),
 *     retail_dex_order 推 completed, 记录 delivery_tx (Maker 发出的那笔 Kaspa TX)
 *   = cancelled/disputed/expired → refunding (但非托管下 refunding 立刻推 failed, 见上)
 *
 * Broker 不再 sendKaspa transfer — KAS 根本不经 Broker.
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
      // Maker 已直发 KAS 给用户 (非托管 delivery 路径), 只推状态 + 记 delivery_tx
      updateState(order.id, 'completed', {
        deliver_tx_hash: offer.delivery_tx || null,
      });
      console.log(`[retail-dex] executing ${order.id.slice(0,8)} → completed, Maker delivery_tx=${(offer.delivery_tx || 'n/a').slice(0,16)}`);
    } else if (['cancelled', 'disputed', 'expired'].includes(offer.protocol_status)) {
      updateState(order.id, 'refunding');
      console.warn(`[retail-dex] executing ${order.id.slice(0,8)} → refunding (offer ${offer.protocol_status})`);
    }
    // open/matched/verifying/delivering — 继续等, 不动状态
  } catch (err) {
    console.error(`[retail-dex] processExecutingOrder ${order.id.slice(0,8)} error: ${err.message}`);
  }
}

/**
 * TASK 5 Hardening: 超时扫描
 * 未推进且 expires_at 已过的订单 → expired (或 awaiting_payment 推 refunding + cancel_v1)
 */
async function processTimeouts(brokerRelayId) {
  try {
    const nowIso = new Date().toISOString();
    const stale = sqlite.prepare(`
      SELECT * FROM retail_dex_orders
      WHERE state IN ('aligning', 'confirming', 'awaiting_payment')
        AND expires_at IS NOT NULL
        AND julianday(expires_at) < julianday('now')
      ORDER BY expires_at ASC
      LIMIT 20
    `).all();
    for (const o of stale) {
      if (o.state === 'awaiting_payment' && o.exchange_offer_id && brokerRelayId) {
        // accept 已上链 + offer 锁住. 广播 cancel_v1 释放 (让 offer 回 open 或进 expired)
        try {
          const cancelPayload = {
            t: 'kanet_exchange_cancel_v1',
            offer_id: o.exchange_offer_id,
            reason: 'taker_timeout_no_payment',
          };
          const send = await _getSendCommandAsync();
          const res = await send(brokerRelayId, {
            type: 'send_broadcast',
            channel: 'kanet-exchange',
            message: JSON.stringify(cancelPayload),
          });
          if (res?.txId) {
            console.log(`[retail-dex] order ${o.id.slice(0,8)} awaiting_payment 超时, cancel_v1 上链 tx=${res.txId.slice(0,16)}`);
          } else {
            console.warn(`[retail-dex] order ${o.id.slice(0,8)} cancel_v1 广播无 txId, 仍推 expired`);
          }
        } catch (err) {
          console.error(`[retail-dex] order ${o.id.slice(0,8)} cancel_v1 err: ${err.message}`);
        }
      }
      try {
        updateState(o.id, 'expired', { error_reason: `timeout from ${o.state}` });
      } catch (err) {
        // 状态机非法转移 (不太可能发生, 但保护)
        console.warn(`[retail-dex] order ${o.id.slice(0,8)} timeout transition fail: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[retail-dex] processTimeouts err: ${err.message}`);
  }
}

async function orderMonitorTick() {
  try {
    // 单 broker 查一次 (MVP)
    const broker = sqlite.prepare("SELECT id FROM relay_nodes WHERE is_dex_broker = 1 LIMIT 1").get();
    const brokerRelayId = broker?.id;

    // Phase 1: 超时扫描 (aligning/confirming/awaiting_payment → expired)
    await processTimeouts(brokerRelayId);

    // Phase 2: paid → executing (广播 paid_v1)
    const paidOrders = sqlite.prepare(`SELECT * FROM retail_dex_orders WHERE state = 'paid' ORDER BY updated_at ASC LIMIT 5`).all();
    for (const o of paidOrders) {
      o._brokerRelayId = brokerRelayId;
      await processPaidOrder(o);
    }
    // Phase 3: executing → completed / 或转 refunding
    // 先 executing 再 refunding, 让 executing 触发的 refunding 能同 tick 被推 failed
    const execOrders = sqlite.prepare(`SELECT * FROM retail_dex_orders WHERE state = 'executing' ORDER BY updated_at ASC LIMIT 5`).all();
    for (const o of execOrders) {
      o._brokerRelayId = brokerRelayId;
      await processExecutingOrder(o);
    }
    // Phase 4: refunding → failed (非托管直接 failed)
    const refundOrders = sqlite.prepare(`SELECT * FROM retail_dex_orders WHERE state = 'refunding' ORDER BY updated_at ASC LIMIT 5`).all();
    for (const o of refundOrders) {
      o._brokerRelayId = brokerRelayId;
      await processRefundingOrder(o);
    }
    if (paidOrders.length + refundOrders.length + execOrders.length > 0) {
      console.log(`[retail-dex] tick: ${paidOrders.length} paid / ${execOrders.length} executing / ${refundOrders.length} refunding`);
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

// ── Broadcast helpers (module-level, testable) ─────────────────────────────

// sendCommandAsync 默认走 relay-manager, smoke 可注入 mock
let _sendCommandAsyncImpl = null;
async function _getSendCommandAsync() {
  if (_sendCommandAsyncImpl) return _sendCommandAsyncImpl;
  const m = await import('./relay-manager.js');
  _sendCommandAsyncImpl = m.sendCommandAsync;
  return _sendCommandAsyncImpl;
}
function _testInjectSendCommand(fn) { _sendCommandAsyncImpl = fn; }
function _testResetSendCommand() { _sendCommandAsyncImpl = null; }

// fetchKasPrice smoke 覆盖 (preCheck.checkPriceDeviation 用)
let _midPriceOverride = null;
function _testInjectMidPrice(val) { _midPriceOverride = val; }
function _testResetMidPrice() { _midPriceOverride = null; }
async function _getMidPrice() {
  if (_midPriceOverride !== null) return _midPriceOverride;
  return await fetchKasPrice();
}

async function _broadcastAcceptV1(brokerRelayId, order) {
  const payload = {
    t: 'kanet_exchange_accept_v1',
    offer_id: order.exchange_offer_id,
    selected_chain: normalizeChain(order.pay_chain),
    payment_asset: 'usdt',
    receive_address: order.user_kasia_address,   // Maker delivery 直达用户 Kasia 地址
  };
  try {
    const send = await _getSendCommandAsync();
    const res = await send(brokerRelayId, {
      type: 'send_broadcast',
      channel: 'kanet-exchange',
      message: JSON.stringify(payload),
    });
    if (!res?.txId) return { ok: false, error: 'accept broadcast returned no txId', payload };
    console.log(`[retail-dex] order ${order.id.slice(0,8)} accept_v1 上链 tx=${res.txId.slice(0,16)} offer=${order.exchange_offer_id?.slice(0,8)}`);
    return { ok: true, txId: res.txId, payload };
  } catch (err) {
    return { ok: false, error: err.message, payload };
  }
}

// ── DM Handler ──────────────────────────────────────────────────────────────

// ── handleDm — 对齐追问主入口 ──────────────────────────────────────────────

async function _handleDmInternal(senderAddress, message, brokerRelayId) {
  // fetchKasPrice is imported at top via market-seeder.js (Opus T5 CORRECTION)
  const active = getActiveOrderForUser(senderAddress);
  if (!active) {
    // 2026-04-23 新: LLM 对话层优先, 收集齐备有效 4 字段后一次性建单
    // 直接走 parseIntent 快速路径 (老用户知道格式, 省一次 LLM 调用)
    const fastIntent = parseIntent(message);
    if (fastIntent) {
      const id = createOrder({ user_kasia_address: senderAddress, brokerRelayId, ...fastIntent });
      const fullOrder = getOrderById(id);
      const midPrice = await fetchKasPrice();
      const checkResult = preCheck(fullOrder, senderAddress, midPrice);
      if (!checkResult.ok) {
        const reasons = checkResult.fails.map(f => f.friendly).join('；');
        return `⚠️ 下单前检查不通过：${reasons}。请调整后重试。`;
      }
      // M2 limit buy → trigger seeder buy publication
      if (fastIntent.order_type === 'limit' && fastIntent.side === 'buy_kas') {
        try {
          await _triggerBuyPublication({ orderId: id, userAddr: senderAddress, qty: fastIntent.qty, price: fastIntent.price, brokerRelayId });
        } catch (err) {
          console.warn(`[retail-dex] _triggerBuyPublication failed: ${err.message}`);
        }
      }
      const missing = nextMissingField(fullOrder);
      return `订单 ${id.slice(0, 8)} 已创建。${missing ? missing.prompt : ''}`;
    }

    // 慢速路径: LLM 对话 (含用户画像 + 市场快照) 收集 4 字段
    let dialog;
    try {
      const { interpret } = await import('./retail-dex-dialog.js');
      const brokerAddr = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(brokerRelayId)?.address || null;
      dialog = await interpret(senderAddress, message, brokerAddr, brokerRelayId);
    } catch (err) {
      console.error(`[retail-dex] dialog interpret err: ${err.message}`);
      return '我这边暂时卡了。你可以直接用格式下单: 买 50 KAS';
    }

    if (dialog.cancel) return dialog.reply;
    if (!dialog.ready) return dialog.reply;

    // 齐备 + 有效 → 建单 (跳过 aligning, 直进 confirming)
    const id = createOrder({
      user_kasia_address: senderAddress,
      brokerRelayId,
      side: dialog.order.side,
      order_type: dialog.order.order_type || 'market',
      qty: dialog.order.qty,
      price: dialog.order.price || null,
    });
    setField(id, 'pay_chain', dialog.order.pay_chain);
    setField(id, 'pay_address', dialog.order.pay_address);

    // 选 offer + 报价 → confirming
    const newOrder = getOrderById(id);
    const offer = selectBestOffer(newOrder);
    if (!offer) {
      updateState(id, 'expired', { error_reason: 'no_matching_offer_at_create' });
      // 查市场实情给人话回复
      const market = sqlite.prepare(`
        SELECT SUM(CAST(give_amount AS REAL)) as total_kas, COUNT(*) as n,
          MAX(CAST(give_amount AS REAL)) as biggest
        FROM exchange_offers
        WHERE protocol_status='open' AND give_asset='KAS' AND want_asset='USDT'
          AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
      `).get();
      const qtyF = parseFloat(newOrder.qty);
      if (!market || !market.n) {
        return `市场当前没任何 KAS 卖单, Maker 暂时缺货。建议:\n1) 晚点再来 (Maker 每 5 分钟刷新挂单)\n2) 改挂限价单 等卖家主动接 (回复 "挂单 0.034" 这种, 数字是你愿付单价)\n订单 ${id.slice(0,8)} 已取消。`;
      }
      if (market.biggest < qtyF) {
        return `市场目前最大的一笔卖单只有 ${market.biggest.toFixed(2)} KAS, 你要 ${qtyF} KAS 超了当前库存 (总共 ${market.total_kas.toFixed(2)} KAS 分 ${market.n} 笔挂单)。建议:\n1) 分批: 先买 ${market.biggest.toFixed(0)} KAS 试\n2) 降低数量\n3) 挂限价单等货\n订单 ${id.slice(0,8)} 已取消。`;
      }
      // 有货但链不匹配
      return `你指定 ${newOrder.pay_chain} 链, 但现有 ${market.n} 笔卖单都不接这条链。试试改 BSC (最常见)。订单 ${id.slice(0,8)} 已取消。`;
    }
    const quote = computeQuote(newOrder, offer, brokerRelayId);
    if (!quote.ok) {
      updateState(id, 'expired', { error_reason: quote.error });
      return `订单 ${id.slice(0,8)} 建了但 ${quote.friendly}`;
    }
    setField(id, 'quoted_usdt', quote.quoted_usdt);
    setField(id, 'agent_pay_addr', quote.maker_pay_addr);
    setField(id, 'mid_price_at_quote', String(quote.mid_price));
    setField(id, 'exchange_offer_id', offer.id);

    const midPrice = (await fetchKasPrice()) || quote.mid_price;
    const fullOrder = getOrderById(id);
    const pc = preCheck(fullOrder, senderAddress, midPrice);
    if (!pc.ok) return buildOrderConfirmText(fullOrder, pc);
    updateState(id, 'confirming');
    return buildOrderConfirmText(getOrderById(id));
  }

  // Has active order — route by state
  const trimmed = message.trim();
  let current = active;

  // Re-fetch current state after transitions (handleDm can be called multiple times in tests)
  function refresh() { current = getOrderById(current.id); }

  // TASK 2.2 非托管: 字段齐 → 选 offer → 算报价 (用 offer 数据) → 预查 → 转 confirming
  async function quoteAndMaybeConfirm(orderId) {
    const order = getOrderById(orderId);
    const offer = selectBestOffer(order);
    if (!offer) {
      return '当前无匹配挂单 (链/数量不匹配或无 open 卖单), 请稍后再试或调整数量。订单保留在对齐阶段。';
    }
    const quote = computeQuote(order, offer, brokerRelayId);
    if (!quote.ok) return `⚠ ${quote.friendly}`;
    setField(orderId, 'quoted_usdt', quote.quoted_usdt);
    setField(orderId, 'agent_pay_addr', quote.maker_pay_addr);          // 字段名保留, 存 Maker 地址
    setField(orderId, 'mid_price_at_quote', String(quote.mid_price));
    setField(orderId, 'exchange_offer_id', offer.id);                   // 锁定这张挂单
    const fullOrder = getOrderById(orderId);
    // preCheck 用真实市场价 (对比 Maker 单价检查偏离), fetchKasPrice 失败降级到 offer mid_price (等同跳过 deviation 检查)
    const realMid = (await _getMidPrice()) || quote.mid_price;
    const pc = preCheck(fullOrder, senderAddress, realMid);
    if (!pc.ok) return buildOrderConfirmText(fullOrder, pc);
    updateState(orderId, 'confirming');
    return buildOrderConfirmText(fullOrder);
  }

  // TASK 2.2: 广播 kanet_exchange_accept_v1 — 用模块级 broadcastAcceptV1 (可测试注入)
  async function broadcastAcceptV1(order) {
    return _broadcastAcceptV1(brokerRelayId, order);
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
        // 再验 offer 还在 open 状态 (可能已被他人吃掉)
        const offerRow = sqlite.prepare("SELECT protocol_status FROM exchange_offers WHERE id = ?").get(current.exchange_offer_id);
        if (!offerRow || offerRow.protocol_status !== 'open') {
          updateState(current.id, 'expired');
          refresh();
          return '原挂单已失效 (被他人吃单或已过期), 订单取消。请重新 DM 下单。';
        }
        // 广播 accept_v1 先上链, 成功再转态 (NO TX NO STATE CHANGE)
        const bcast = await broadcastAcceptV1(current);
        if (!bcast.ok) {
          return `上链失败: ${bcast.error}。订单保留在 confirming, 可回 YES 重试。`;
        }
        updateState(current.id, 'awaiting_payment');
        refresh();
        return `已上链挂单 (tx=${bcast.txId.slice(0,12)})。\n请在 30 分钟内向 Maker 地址转 ${current.quoted_usdt} USDT (${current.pay_chain}) 的 BSC 链收款地址, 付完把 tx hash 发回来。\nMaker 直接把 KAS 发到你的 Kasia 地址, Broker 不持有资金。`;
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

// ── handleDm wrapper (backwards compat) ────────────────────────────────────

async function handleDm(senderAddress, message, brokerRelayId) {
  return _handleDmInternal(senderAddress, message, brokerRelayId);
}

// ── TASK 5a: Trigger BUY publication (M2 limit buy → seeder代挂单) ──────────

async function _triggerBuyPublication({ orderId, userAddr, qty, price, brokerRelayId }) {
  const expected_usdt = (parseFloat(qty) * parseFloat(price)).toFixed(6);
  const seeder_bsc_addr = sqlite.prepare(
    "SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' AND is_default = 1 LIMIT 1"
  ).get(brokerRelayId)?.address;
  if (!seeder_bsc_addr) throw new Error('seeder_bsc_addr_missing');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h expiry
  const pubId = randomUUID();
  sqlite.prepare(`
    INSERT INTO retail_dex_buy_publications (
      id, user_kasia_address, broker_relay_id, seeder_relay_id, side,
      qty, limit_price, total_usdt, pay_chain, user_usdt_deposit_tx,
      seeder_publish_offer_id, state, expires_at,
      filled_at, kas_delivery_tx, usdt_refund_tx, error_reason,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'buy_kas', ?, ?, ?, 'BSC', NULL, NULL,
      'awaiting_deposit', ?, NULL, NULL, NULL, NULL, ?, ?)
  `).run(
    pubId, userAddr, brokerRelayId, brokerRelayId,
    qty, price, expected_usdt, expiresAt, now, now
  );
  console.log(`[retail-dex] _triggerBuyPublication ${orderId.slice(0,8)} → awaiting_deposit expected_usdt=${expected_usdt}`);
  return pubId;
}

// ── Exports ─────────────────────────────────────────────────────────────────

export {
  handleDm,
  startOrderMonitor,
  stopOrderMonitor,
  orderMonitorTick,
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
  _broadcastAcceptV1,
  _testInjectSendCommand,
  _testResetSendCommand,
  _testInjectMidPrice,
  _testResetMidPrice,
  _triggerBuyPublication,
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
