// broker-chain-dm-classifier.js — Layer 8: chain DM payload classifier (Owner 04:55 钦定 phase 3).
//
// "broker 收 [Payment: X KAS] 是 chain DM 系统级信号, 不是 user 自然语言. 应 classifier
// 在 LLM 之前 detect 这类 payload, 路由到 ack 路径 (broker reply: '收到付款 X KAS, 验证中,
// ~1min'), 不送 LLM re-process." (NWT 56ccd7f3 phase 1 dig Layer 8 propose)
//
// Owner 真测撞 02:12: chain DM `[Payment: 88 KAS]` 进 broker → 触 SELL re-preview (broker
// 把 chain DM payload 当 user 重新下单输入). 真**真**真 error: chain TX 独立由 broker-intake-
// watcher 处理 (chain_events ingest + retail_dex_orders 推进), broker 应**真 ack 不**真**真**
// re-process.

// Chain DM payload markers — Kasia 客户端 chain DM 时插入的 system signal:
// - [Payment: X KAS] — 用户随 DM 转 KAS (Kasia 协议 payload)
// - [Card: ...] — 用户广播 card payload
// - [Handshake] — 客户端首次握手信号
// - [...] — 其他 system markers
const CHAIN_DM_PAYLOAD_REGEX = /^\s*\[(Payment|Card|Handshake|Probe|Card-update|Identity)(?::\s*[^\]]+)?\]\s*$/i;
const PAYMENT_PAYLOAD_REGEX = /\[Payment:\s*([\d.]+)\s*(KAS|USDT|USDC|BNB|ETH|SOL)\]/i;

/**
 * Classify chain DM payload — return null if normal user message, OR object describing payload.
 *
 * @param {string} message
 * @returns {null | { type: 'payment'|'card'|'handshake'|'probe'|'identity'|'other', raw: string, amount?: number, asset?: string }}
 */
export function classifyChainDmPayload(message) {
  if (!message || typeof message !== 'string') return null;
  const trimmed = message.trim();

  // Payment 优先 (最常见, 明确 amount + asset)
  const pay = trimmed.match(PAYMENT_PAYLOAD_REGEX);
  if (pay) {
    return {
      type: 'payment',
      raw: trimmed,
      amount: parseFloat(pay[1]),
      asset: pay[2].toUpperCase(),
    };
  }

  // 其他 system markers (整条 [Marker] 形式)
  const m = trimmed.match(CHAIN_DM_PAYLOAD_REGEX);
  if (m) {
    return { type: m[1].toLowerCase(), raw: trimmed };
  }

  return null;
}

/**
 * Generate broker ack reply for chain DM payload (NOT user natural language).
 * Called BEFORE handleBuyIntent / handleSellIntent / handleLlmDialog to short-circuit LLM.
 *
 * @param {object} classified — return value of classifyChainDmPayload()
 * @returns {string} ack reply
 */
export function ackChainDmPayload(classified) {
  if (!classified) return null;

  if (classified.type === 'payment') {
    return `收到链上付款信号 ${classified.amount} ${classified.asset}, broker 自动验证 chain TX 中. 1-2 分钟内 broker 会主动 DM 你确认订单状态. 这期间不用回复.`;
  }

  if (classified.type === 'handshake' || classified.type === 'probe') {
    return null; // handshake / probe — broker 不主动 ack, 让 ingest 路径处理
  }

  if (classified.type === 'card' || classified.type === 'identity') {
    return null; // card update — silent, ingest 处理
  }

  // 其他 system marker — silent
  return null;
}
