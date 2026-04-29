// ════════════════════════════════════════════════════════════════
// broker-v2/parser.js — 正则字段提取 (deterministic 优先)
//
// Spec: docs/NEW-BROKER-PROPOSAL.md v2 §"parser.js" + 边界 5 (复合 intent)
// Lock: 三方共识 7e776598dc + NWT v2 spec ecdd98874
//
// 设计:
// - parser 永远先跑, state 永远先 update, LLM 永远后跑
// - LLM 只补漏: 复合 intent / 模糊语言 / question / 自然对话 render
// - 能正则提取的字段必先写 state, 0 LLM 依赖
// - 边界 5: confirm regex 严格 ^YES$/^是$/^好$ — 'YES, 还问 X' 不算 confirm 落 LLM
// - 边界 6: parser 中英混 OK (regex /i), 不 _detectLang 多语言分支
// ════════════════════════════════════════════════════════════════

const PATTERNS = {
  // R44 anti-pattern 防: 中文助词陷阱 — '我想买' 含 '想' 不是 buy intent of 'sell想'
  // direction 优先 buy (Owner '我想卖' 也含 '要')
  buy: /(?:^|[^a-zA-Z])(?:买|购买|要买|想买|想购|要进|想进|buy|purchase)/i,
  sell: /(?:^|[^a-zA-Z])(?:卖|出售|要卖|想卖|想出|要出|出仓|sell|sell\s*off)/i,
  qty: /(\d+(?:\.\d+)?)\s*(?:个|枚|KAS|kas|USDT|usdt|USDC|usdc)?/,
  asset: /\b(KAS|USDT|USDC)\b/i,
  // chain 输出与旧 broker 一致: 'bnb' 不 'bsc' (broker-sell-handler.js L96 chainNorm 'bsc'→'bnb',
  // retail_dex_orders.pay_chain 命名 'bnb' 跟现有 production data 一致).
  chain: {
    bnb: /\b(?:bsc|bnb|binance|币安)\b/i,
    polygon: /\b(?:poly|polygon|matic)\b/i,
    sol: /\b(?:sol|solana)\b/i,
    tron: /\b(?:tron|trx|波场)\b/i,
  },
  pay_address: /0x[a-fA-F0-9]{40}/,
  price_pref: {
    market: /(?:市价|市场价|按市价|market|实时价)/i,
    limit: /限价\s*[:：]?\s*(\d+\.?\d*)|@\s*(\d+\.?\d*)/i,
  },
  // 边界 4: cancel intent — explicit cancel only.
  // '不卖了' / '不买了' 移除 — 它们是 direction flip context (e.g. '不卖了, 想买 X')
  // R33 sticky direction lock 应 catch direction flip, parser 不应 clearDraft (case T5 测 此).
  // 真 cancel: '取消' / '不要了' / '算了' / 'cancel' / 'refund' / standalone 'NO' / 'N' (broker-v1 CANCEL_WORDS parity).
  // bug 9 (J2 r25 vote follow-up, lifecycle_paid_cannot_cancel): broker-v1 CANCEL_WORDS 含 'NO' 'no' 'n' — v2 parity.
  // standalone 'NO'/'N' 用 ^...$ anchor 严, 防 'NOPE' 'I won't say NO' 误中.
  cancel: /(?:取消(?:订单|单|报价|交易)?|不要了|算了|cancel|stop|refund|^\s*(?:NO|N)\s*[!.！。]?\s*$)/i,
  cancel_negation: /(?:不想(?:取消|退)|别取消|继续(?:挂单|交易)?|don'?t\s+(?:cancel|refund))/i,
  // 边界 5: confirm regex 严格 — 仅 reply 全文是 YES/Y/是/对/确认/好/OK/可以
  // 'YES, 还问 X' 不 match (走 LLM)
  confirm: /^\s*(?:YES|Y|是|对|确认|好|OK|可以|没问题)\s*[!.！。]?\s*$/i,
  // 边界 4: cancel-restart legitimate path
  reset_intent: /(?:重新下单|取消重新|cancel\s*and\s*restart|改主意|重来一遍)/i,
};

/**
 * Extract structured fields + intent from user message.
 * 解析顺序: 先剥离地址 + limit price 数字, 再 match qty 防误抓.
 * 返 { fields: {direction?, qty?, asset?, chain?, pay_address?, price_pref?},
 *      intent: 'cancel' | 'reset' | 'confirm' | 'normal' }
 */
export function extract(msg) {
  const m = String(msg || '').trim();
  const fields = {};
  let scrub = m;

  // 1. pay_address 剥离 (防 0xabc... 中 '0' 被 qty regex 误抓)
  const addrM = m.match(PATTERNS.pay_address);
  if (addrM) {
    fields.pay_address = addrM[0];
    scrub = scrub.replace(addrM[0], '');
  }
  // bug 2 真 root cause fix: addr 短 1 char (39 vs 40) pay_address regex 不 match,
  // scrub 仍含 '0x...' addr-like pattern, qty regex 抓 '0x' 前缀 '0' → fields.qty=0 覆盖 prior qty.
  // 修: scrub strip 任 '0x' + hex 长 pattern (≥20 hex chars 假定 addr-like, 不 valid 但避 hijack qty).
  scrub = scrub.replace(/0x[a-fA-F0-9]{20,}/g, '');

  // 2. price_pref 先解 (剥离 limit price 数字防 qty 抢)
  if (PATTERNS.price_pref.market.test(scrub)) {
    fields.price_pref = 'market';
  } else {
    const limM = scrub.match(PATTERNS.price_pref.limit);
    if (limM) {
      fields.price_pref = `limit:${limM[1] || limM[2]}`;
      scrub = scrub.replace(limM[0], '');
    }
  }
  // bug 6 fix layer 1 (J2 r25 vote (a) double-layer): strip Chinese price-keyword-prefixed numbers
  // from scrub (e.g. '价格设定 0.0336' / '价格 0.0336' / '单价 0.0336' / '价 0.0336').
  // Owner_88kas_t6 user msg: '我想挂单价格设定0.0336。' — price_pref.limit 不匹配 (缺 '限价' keyword),
  // 旧版 qty regex 抓 '0.0336' 当 qty → 覆盖 prior qty=88 → computePreview qty_too_small.
  // 修: 任何 价/价格/价格设定/单价 + 紧邻数字 当 limit price (capture into price_pref if not set), 同时 scrub strip.
  const priceKwM = scrub.match(/(?:价格(?:设定)?|单价|价(?![:：值卡]))\s*[:：]?\s*(\d+\.?\d*)/);
  if (priceKwM) {
    if (!fields.price_pref) fields.price_pref = `limit:${priceKwM[1]}`;
    scrub = scrub.replace(priceKwM[0], '');
  }
  // bug 6 fix layer 1b: strip "N 分钟" / "N min" / "N hour" / "N 小时" timeout patterns from scrub
  // (Owner T6 '10分钟内没人吃单' — '10' must not become qty). future: capture into refund_timeout.
  scrub = scrub.replace(/\d+\s*(?:分钟|min|分|小时|hour|hr)/gi, '');

  // 3. direction (R44 中文助词陷阱) — buy 优先
  if (PATTERNS.buy.test(scrub)) fields.direction = 'buy';
  else if (PATTERNS.sell.test(scrub)) fields.direction = 'sell';

  // 4. qty (post-scrub, 不会抓 limit price OR address 数字)
  const qtyM = scrub.match(PATTERNS.qty);
  if (qtyM) fields.qty = parseFloat(qtyM[1]);

  // 5. asset
  const assetM = scrub.match(PATTERNS.asset);
  if (assetM) fields.asset = assetM[1].toUpperCase();

  // 6. chain
  for (const [name, re] of Object.entries(PATTERNS.chain)) {
    if (re.test(scrub)) { fields.chain = name; break; }
  }

  // 7. intent: 边界 4 cancel_negation 先 check
  const isCancelNegated = PATTERNS.cancel_negation.test(m);
  let intent = 'normal';
  if (PATTERNS.reset_intent.test(m)) intent = 'reset';
  else if (!isCancelNegated && PATTERNS.cancel.test(m)) intent = 'cancel';
  else if (PATTERNS.confirm.test(m)) intent = 'confirm';

  return { fields, intent };
}
