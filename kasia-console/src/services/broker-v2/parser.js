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
  chain: {
    bsc: /\b(?:bsc|bnb|binance|币安)\b/i,
    polygon: /\b(?:poly|polygon|matic)\b/i,
    sol: /\b(?:sol|solana)\b/i,
    tron: /\b(?:tron|trx|波场)\b/i,
  },
  pay_address: /0x[a-fA-F0-9]{40}/,
  price_pref: {
    market: /(?:市价|市场价|按市价|market|实时价)/i,
    limit: /限价\s*[:：]?\s*(\d+\.?\d*)|@\s*(\d+\.?\d*)/i,
  },
  // 边界 4: cancel intent — '取消' / '不要了' / '算了' / 'cancel' / 'refund'.
  // 明显否定 ('不想取消' / 'don't cancel') 加 negation 防 false fire.
  cancel: /(?:取消(?:订单|单|报价|交易)?|不要了|算了|不卖了|不买了|cancel|stop|refund)/i,
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
