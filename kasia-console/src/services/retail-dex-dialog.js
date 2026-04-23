// retail-dex-dialog.js — Broker 对话层
//
// 分工死边界:
//   此层 (LLM): 聊 + 收集 4 字段. 不碰链不碰钱.
//   协议层 (retail-dex.js): 字段齐备 + 校验通过后接手, 走链上.
//
// 校验用代码, 不信 LLM 判合法性 (LLM 会编地址).

const QWEN_URL    = process.env.QWEN_URL   || 'http://127.0.0.1:8000';
const QWEN_MODEL  = process.env.QWEN_MODEL || 'Qwen3.6-35B-A3B-Q4_K_M.gguf';
const QWEN_TIMEOUT_MS = 25_000;

const EVM_ADDR_REGEX  = /^0x[a-fA-F0-9]{40}$/;
const SUPPORTED_CHAINS = ['bnb', 'eth', 'tron', 'sol', 'polygon'];
const MAX_ORDER_USDT = 100;
const MIN_KAS = 1;
const MAX_KAS = 100_000;

// 动态注入: 市场快照 (让 LLM 能基于真实市场给建议)
async function getMarketSnapshot() {
  try {
    const { sqlite } = await import('../db/client.js');
    const { fetchKasPrice } = await import('./market-seeder.js');
    const midPrice = await fetchKasPrice();
    // 最优 sell-KAS 卖单 (用户买方视角 = 最便宜)
    const bestSell = sqlite.prepare(`
      SELECT give_amount, want_amount,
        CAST(want_amount AS REAL) / CAST(give_amount AS REAL) AS unit_price
      FROM exchange_offers
      WHERE protocol_status='open' AND give_asset='KAS' AND want_asset='USDT'
        AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
      ORDER BY unit_price ASC LIMIT 1
    `).get();
    // 总可买 KAS 量
    const totalOpen = sqlite.prepare(`
      SELECT SUM(CAST(give_amount AS REAL)) AS total_kas, COUNT(*) AS n
      FROM exchange_offers
      WHERE protocol_status='open' AND give_asset='KAS' AND want_asset='USDT'
        AND (expires_at IS NULL OR julianday(expires_at) > julianday('now'))
    `).get();
    return {
      midPrice: midPrice || null,
      bestSellPrice: bestSell?.unit_price || null,
      bestSellKas: bestSell?.give_amount || null,
      totalOpenKas: totalOpen?.total_kas || 0,
      openOfferCount: totalOpen?.n || 0,
    };
  } catch (err) {
    console.warn(`[retail-dex-dialog] market snapshot err: ${err.message}`);
    return null;
  }
}

function formatSnapshot(snap) {
  if (!snap) return '[市场快照] 暂无数据';
  const parts = [];
  if (snap.midPrice) parts.push(`市价约 ${snap.midPrice.toFixed(6)} USDT/KAS`);
  if (snap.bestSellPrice) parts.push(`最优卖单 ${snap.bestSellPrice.toFixed(6)} USDT/KAS (${snap.bestSellKas} KAS)`);
  else parts.push('当前无 KAS 卖单 (市场暂时缺货, 可建议用户限价挂单等)');
  if (snap.openOfferCount > 0) parts.push(`共 ${snap.openOfferCount} 个开放卖单 / 合计 ${parseFloat(snap.totalOpenKas).toFixed(2)} KAS 可买`);
  return '[市场快照] ' + parts.join('; ');
}

// 每用户最近 N 轮对话
const CONVO_MAX_TURNS = 10;
const _conversations = new Map();

function getHistory(addr) {
  if (!_conversations.has(addr)) _conversations.set(addr, []);
  return _conversations.get(addr);
}
function pushHistory(addr, role, content) {
  const h = getHistory(addr);
  h.push({ role, content });
  while (h.length > CONVO_MAX_TURNS) h.shift();
}
export function clearHistory(addr) { _conversations.delete(addr); }

// ── 短 System Prompt ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是 KANet Broker. 真专业, 会给建议.
目标: 帮用户完成一笔 KAS↔USDT 零售交易 (零托管 — USDT 直付 Maker, KAS 直到用户 Kasia).

## 1. 摸清用户需求
- 买 KAS (付 USDT) 还是 卖 KAS (收 USDT)?
- 要多少 (KAS 数量)?

## 2. 策略选择 (关键!)
- 市价吃单 (order_type=market): 立刻成交, 按市场最优单价
- 限价挂单 (order_type=limit): 你出价, 等人接, 需含 price (USDT/KAS)
- 新手通常市价, 有预期价位才限价. 看市场情况主动建议哪个合适.

## 3. 单子要素 (齐备 + 有效 才能下单)
- side: buy_kas | sell_kas
- order_type: market | limit
- qty: KAS 数量 (${MIN_KAS}~${MAX_KAS})
- price: USDT/KAS 单价 (仅 limit 必填, 市价单忽略)
- pay_chain: BSC | ETH | TRON | SOL | Polygon
- pay_address: 用户 EVM 地址 (0x + 40 hex)

## 4. 下单条件
- 单笔上限 ${MAX_ORDER_USDT} USDT (折算超了拒)
- 数字 / 地址 / 链 / 价格必须合法 (系统校验)
- 用户说"取消/不要了"立即停

## 对话规则
- **利用[用户画像]** (核心!): 老客户有历史链/地址的, **直接用, 不再问**. 只在用户明确说"换/改"才重问.
  例: 画像"上次 BSC + 0x1417..." → 老客户说"买 50" → 直接默认 BSC+0x1417, 在 reply 里确认一句
  "还用老地址 0x1417 付款吗? 回'是'我就下单" 给用户 1 次机会改
- 新客户才走 "自我介绍 + 4 字段全问" 流程
- 每轮最多 1 问
- **利用[市场快照]** 主动给建议 (比如"现在市价 X, 我建议市价吃" 或 "你的限价比市价便宜 5%, 可能要等挺久")
- 用户问价/收费/安全: 简短回, 不编数据
- 不自己判地址 / 数字 / 价格合法, 交系统

## 输出 (纯 JSON, 无 markdown 无 \`\`\`)
不齐: {"ready":false,"reply":"<中文>"}
齐备 (市价): {"ready":true,"order":{"side":"buy_kas","order_type":"market","qty":"50","pay_chain":"BSC","pay_address":"0x..."}}
齐备 (限价): {"ready":true,"order":{"side":"buy_kas","order_type":"limit","qty":"50","price":"0.033","pay_chain":"BSC","pay_address":"0x..."}}
取消: {"ready":false,"reply":"<中文>","cancel":true}`;

// ── Qwen ──────────────────────────────────────────────────────────────────

export async function callQwen(messages) {
  // kill switch: chat_template_kwargs 真正关 Qwen3.6 reasoning (/no_think 无效)
  const body = JSON.stringify({
    model: QWEN_MODEL, messages, max_tokens: 2000, temperature: 0.3,
    chat_template_kwargs: { enable_thinking: false },
  });
  const t0 = Date.now();
  const res = await fetch(`${QWEN_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(QWEN_TIMEOUT_MS),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Qwen ${res.status}: ${t.slice(0, 100)}`);
  }
  const data = await res.json();
  let content = data.choices?.[0]?.message?.content || '';
  if (!content && data.choices?.[0]?.message?.reasoning_content) {
    content = data.choices[0].message.reasoning_content;
  }
  content = content.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
  console.log(`[retail-dex-dialog] Qwen ${content.length}c in ${Date.now() - t0}ms`);
  return content;
}

export function extractJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch {}
  return null;
}

// ── 校验 (代码层) ──────────────────────────────────────────────────────────

function normalizeChain(chain) {
  if (!chain) return null;
  const c = String(chain).toUpperCase();
  if (c === 'BSC' || c === 'BNB' || c === 'BEP20') return 'bnb';
  if (c === 'ETH' || c === 'ETHEREUM') return 'eth';
  if (c === 'TRON' || c === 'TRX') return 'tron';
  if (c === 'SOL' || c === 'SOLANA') return 'sol';
  if (c === 'POLYGON' || c === 'MATIC') return 'polygon';
  return null;
}

export function validateOrder(order) {
  if (!order || typeof order !== 'object') return { ok: false, err: '订单结构不对' };
  if (order.side !== 'buy_kas' && order.side !== 'sell_kas') return { ok: false, err: 'side 必须是 buy_kas 或 sell_kas' };
  const orderType = order.order_type || 'market';
  if (orderType !== 'market' && orderType !== 'limit') {
    return { ok: false, err: 'order_type 必须是 market 或 limit' };
  }
  const qtyNum = parseFloat(order.qty);
  if (!isFinite(qtyNum) || qtyNum < MIN_KAS || qtyNum > MAX_KAS) {
    return { ok: false, err: `数量必须在 ${MIN_KAS} 到 ${MAX_KAS} 之间` };
  }
  let priceNum = null;
  if (orderType === 'limit') {
    priceNum = parseFloat(order.price);
    if (!isFinite(priceNum) || priceNum <= 0 || priceNum > 10) {
      return { ok: false, err: '限价必须在 0 到 10 USDT/KAS 之间' };
    }
  }
  const chain = normalizeChain(order.pay_chain);
  if (!chain || !SUPPORTED_CHAINS.includes(chain)) {
    return { ok: false, err: '付款链必须是 BSC/ETH/TRON/SOL/Polygon' };
  }
  if (!order.pay_address || !EVM_ADDR_REGEX.test(order.pay_address)) {
    return { ok: false, err: '付款地址必须是 0x 开头 40 位 hex' };
  }
  return {
    ok: true,
    order: {
      side: order.side,
      order_type: orderType,
      qty: String(order.qty),
      price: priceNum !== null ? String(priceNum) : null,
      pay_chain: chain === 'bnb' ? 'BSC' : chain.toUpperCase(),
      pay_address: order.pay_address,
    },
  };
}

// ── 主入口 ────────────────────────────────────────────────────────────────

/**
 * 返 { ready, reply?, order?, cancel?, error? }
 */
export async function interpret(userAddr, userMessage, brokerAddress = null) {
  const history = getHistory(userAddr);
  // 每轮拉最新市场快照 + 用户画像 + 蒸馏记忆, 让 LLM 能基于真实数据给建议 + 老客户免重问
  const snap = await getMarketSnapshot();
  let profileText = '';
  try {
    const { getUserProfile, formatProfileForPrompt } = await import('./retail-dex-profile.js');
    const profile = await getUserProfile(userAddr, brokerAddress);
    profileText = formatProfileForPrompt(profile);
  } catch (err) {
    console.warn(`[retail-dex-dialog] profile lookup err: ${err.message}`);
    profileText = '[用户画像] 查询失败, 当新客户处理';
  }

  // 拉蒸馏记忆
  let memoryText = '';
  let memoryTriggered = false;
  try {
    const { getMemory, distillIfNeeded } = await import('./retail-dex-memory.js');
    const mem = await getMemory(userAddr);
    if (mem?.distilled_summary) {
      const lines = ['[蒸馏记忆]'];
      lines.push(`- 摘要: ${mem.distilled_summary}`);
      if (mem.preferred_chain) lines.push(`- 偏好链: ${mem.preferred_chain}`);
      if (mem.preferred_pay_address) lines.push(`- 偏好地址: ${mem.preferred_pay_address}`);
      if (mem.tone_preference) lines.push(`- 对话风格: ${mem.tone_preference}`);
      if (mem.notable_preferences) lines.push(`- 其他偏好: ${typeof mem.notable_preferences === 'string' ? mem.notable_preferences : JSON.stringify(mem.notable_preferences)}`);
      memoryText = lines.join('\n');
    }
    // 蒸馏前置检查 (异步, 不阻塞本轮对话)
    distillIfNeeded(userAddr, brokerAddress).then(res => {
      if (res.triggered) {
        memoryTriggered = true;
        console.log(`[retail-dex-dialog] memory distill triggered for ${userAddr.slice(0, 10)}...`);
      }
    }).catch(() => {});
  } catch (err) {
    console.warn(`[retail-dex-dialog] memory lookup err: ${err.message}`);
  }

  const systemFull = [SYSTEM_PROMPT, profileText, memoryText, formatSnapshot(snap)].filter(Boolean).join('\n\n');

  const messages = [
    { role: 'system', content: systemFull },
    ...history,
    { role: 'user', content: userMessage },
  ];

  let raw;
  try {
    raw = await callQwen(messages);
  } catch (err) {
    return { ready: false, error: 'llm_unavailable',
      reply: 'Broker 后台暂时忙, 请稍后再发。或直接用格式: 买 50 KAS @ 0.04 USDT' };
  }

  const parsed = extractJson(raw);
  if (!parsed) {
    console.warn(`[retail-dex-dialog] 无 JSON: ${raw.slice(0, 200)}`);
    return { ready: false, error: 'llm_bad_output',
      reply: '我没太听明白, 能换个说法吗? 比如"我想买 50 个 KAS"' };
  }

  pushHistory(userAddr, 'user', userMessage);
  const replyForHistory = parsed.reply || (parsed.ready ? '(生成订单中)' : '');
  if (replyForHistory) pushHistory(userAddr, 'assistant', replyForHistory);

  if (parsed.cancel) {
    clearHistory(userAddr);
    return { ready: false, cancel: true, reply: parsed.reply || '好的, 随时再来' };
  }

  if (!parsed.ready) {
    return { ready: false, reply: parsed.reply || '请继续' };
  }

  const validation = validateOrder(parsed.order);
  if (!validation.ok) {
    const errReply = `我这边核对有问题: ${validation.err}。能再确认吗?`;
    pushHistory(userAddr, 'assistant', errReply);
    return { ready: false, reply: errReply, validation_error: validation.err };
  }

  clearHistory(userAddr);
  return { ready: true, order: validation.order };
}
