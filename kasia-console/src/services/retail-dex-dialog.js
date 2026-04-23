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

const SYSTEM_PROMPT = `/no_think
你是 KANet Broker.
目标: 帮用户完成一笔 KAS↔USDT 零售交易 (零托管 — USDT 直付 Maker, KAS 直到用户 Kasia).

## 1. 摸清用户需求
- 买 KAS (付 USDT) 还是 卖 KAS (收 USDT)?
- 要多少 (KAS 数量)?

## 2. 单子 4 要素 (齐备 + 有效 才能下单)
- side: buy_kas | sell_kas
- qty: KAS 数量 (${MIN_KAS}~${MAX_KAS})
- pay_chain: BSC | ETH | TRON | SOL | Polygon
- pay_address: 用户 EVM 地址 (0x + 40 hex)

## 3. 下单条件
- 单笔上限 ${MAX_ORDER_USDT} USDT (折算超了拒)
- 数字 / 地址 / 链必须合法 (系统校验)
- 用户说"取消/不要了"立即停

## 对话规则
- 首次接触: 简短自我介绍 1 句, 然后问需求
- 逐个问缺的, 每轮最多 1 问
- 用户问价/收费/安全: 简短回, 不编数据
- 不自己判地址 / 数字合法, 交系统

## 输出 (纯 JSON, 无 markdown 无 \`\`\`)
不齐: {"ready":false,"reply":"<中文>"}
齐备: {"ready":true,"order":{"side":"buy_kas","qty":"50","pay_chain":"BSC","pay_address":"0x..."}}
取消: {"ready":false,"reply":"<中文>","cancel":true}`;

// ── Qwen ──────────────────────────────────────────────────────────────────

async function callQwen(messages) {
  const body = JSON.stringify({
    model: QWEN_MODEL, messages, max_tokens: 2000, temperature: 0.3,
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

function extractJson(text) {
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
  const qtyNum = parseFloat(order.qty);
  if (!isFinite(qtyNum) || qtyNum < MIN_KAS || qtyNum > MAX_KAS) {
    return { ok: false, err: `数量必须在 ${MIN_KAS} 到 ${MAX_KAS} 之间` };
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
      qty: String(order.qty),
      pay_chain: chain === 'bnb' ? 'BSC' : chain.toUpperCase(),
      pay_address: order.pay_address,
    },
  };
}

// ── 主入口 ────────────────────────────────────────────────────────────────

/**
 * 返 { ready, reply?, order?, cancel?, error? }
 */
export async function interpret(userAddr, userMessage) {
  const history = getHistory(userAddr);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
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
