// retail-dex-dialog.js — Broker 对话层
//
// 分工死边界:
//   此层 (LLM): 聊 + 收集 4 字段. 不碰链不碰钱.
//   协议层 (retail-dex.js): 字段齐备 + 校验通过后接手, 走链上.
//
// 校验用代码, 不信 LLM 判合法性 (LLM 会编地址).

// Fallback 仅在无 adapter 配置时用 (local dev / smoke)
const QWEN_FALLBACK_URL    = process.env.QWEN_URL   || 'http://127.0.0.1:8000';
const QWEN_FALLBACK_MODEL  = process.env.QWEN_MODEL || 'Qwen3.6-35B-A3B-Q4_K_M.gguf';
const QWEN_TIMEOUT_MS = 60_000;

import { sqlite } from '../db/client.js';
import { decrypt } from './crypto.js';

// 按 broker relay 读 adapter_node 配置 (不硬编码 URL/model/key)
function resolveAdapterConfig(brokerRelayId) {
  if (!brokerRelayId) return null;
  const relay = sqlite.prepare('SELECT adapter_node_id FROM relay_nodes WHERE id = ?').get(brokerRelayId);
  if (!relay?.adapter_node_id) return null;
  const adapter = sqlite.prepare(
    'SELECT ai_provider_url, ai_model, ai_provider_key_encrypted FROM adapter_nodes WHERE id = ? AND is_enabled = 1'
  ).get(relay.adapter_node_id);
  if (!adapter?.ai_provider_url || !adapter?.ai_model) return null;
  let apiKey = null;
  if (adapter.ai_provider_key_encrypted) {
    try {
      // decrypt() 内部自己 JSON.parse, 直接传 raw string
      apiKey = decrypt(adapter.ai_provider_key_encrypted);
    } catch (e) {
      console.warn(`[retail-dex-dialog] adapter key decrypt failed: ${e.message}`);
    }
  }
  return { url: adapter.ai_provider_url, model: adapter.ai_model, apiKey };
}

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

const SYSTEM_PROMPT = `你是 KANet Broker. 核心使命: **赢得用户信赖** — 透明 + 口语 + 只要必要信息.

## 透明 (建立信赖的根基)
每次涉及价格/交易, 必告诉用户真实数据:
- 当前市价 (CEX 聚合中间价, 来自 Binance/Kraken 等主流所)
- 当前市场深度 (最优卖单 / 最优买单 / 总可成交量)
- 用户这笔预计: 总付 X USDT, 总收 Y KAS, 扣 0.1 KAS 撮合服务费
- 价格机制主动说: "这是 CEX 聚合中间价, 实际成交按市场最优挂单"
用户问价/来源/手续费: 照实答, 绝不编数据

## 只要 3 个信息 (其他别问)
1. 买 / 卖 (用户首句一般已说)
2. 多少 KAS
3. 心理价 (限价才要, 没说默认市价)

**Broker 自己知道** (不用问用户):
- 用户 Kasia 地址 = DM 自带
- 用户 USDT 钱包类型 (币安/独立/手机) — 关你屁事, 不问

**Broker 支持 9 个网络收 USDT** (Seeder 在每条都有地址):
BSC / 以太坊 / Polygon / Arbitrum / Optimism / Avalanche / Base / Solana / TRON
- 用户说"我在 X 网络有 USDT" → 给对应网络 Seeder 地址
- 用户没指定 → 列出所有可选让用户选一个, 或问"你的 USDT 在哪个网络?"
- **不硬编码任何一条**, 按用户选择动态提供

## 说话方式
- 简单口语, 跟用户语言走 (中文/英文/粤语/大白话 用户怎么说你怎么说)
- **绝不问**钱包/链/app/地址类型
- **绝不说程序员话**: 链 / BSC / 0x / EVM / 合约 / 市价 / 限价
- 价格/费率/数量用数字, 不用术语

## 核心字段 (内部 schema, 不对用户说)
- side: buy_kas | sell_kas
- order_type: market | limit
- qty: ${MIN_KAS}~${MAX_KAS}
- price: USDT/KAS 单价 (limit 必填)
- pay_chain: 按用户选择, 不默认. 值: bnb/eth/polygon/arbitrum/optimism/avalanche/base/sol/tron
- pay_address: 仅卖场景必问 (用户收 USDT 地址)

## 红线
- 单笔上限 ${MAX_ORDER_USDT} USDT
- 用户"取消"立即停
- 不自己判地址/价格合法性, 交系统校验
- 利用 [用户画像] 老客户直接认, 不重新介绍

## 输出 (纯 JSON, 无 markdown 无 \`\`\`)
不齐: {"ready":false,"reply":"<口语中文, 含真实市价>"}
买齐: {"ready":true,"order":{"side":"buy_kas","order_type":"market","qty":"50","pay_chain":"<用户选的网络>"}}
买限价齐: {"ready":true,"order":{"side":"buy_kas","order_type":"limit","qty":"50","price":"0.033","pay_chain":"<用户选的网络>"}}
卖齐: {"ready":true,"order":{"side":"sell_kas","order_type":"market","qty":"50","pay_chain":"<用户收款网络>","pay_address":"0x... 或 T... 或 base58"}}
取消: {"ready":false,"reply":"<中文>","cancel":true}`;

// ── Qwen ──────────────────────────────────────────────────────────────────

export async function callQwen(messages, brokerRelayId = null) {
  // 按 broker relay 的 adapter 配置动态选 LLM (不硬编码 URL/model/key)
  const cfg = resolveAdapterConfig(brokerRelayId);
  const baseUrl = (cfg?.url || QWEN_FALLBACK_URL).replace(/\/+$/, '');
  const model = cfg?.model || QWEN_FALLBACK_MODEL;
  const apiKey = cfg?.apiKey;

  // kill switch: chat_template_kwargs 真正关 Qwen3.6 reasoning (/no_think 无效)
  const body = JSON.stringify({
    model, messages, max_tokens: 2000, temperature: 0.3,
    chat_template_kwargs: { enable_thinking: false },
  });
  const t0 = Date.now();
  const endpoint = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
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
    return { ok: false, err: '你的 USDT 在哪个网络?' };
  }
  // 买场景: pay_address 可选 (broker 把 Maker 地址给用户; 仅用于老客户画像匹配)
  // 卖场景: pay_address 必填 (用户收 USDT 到这个地址, 同链 = pay_chain)
  if (order.side === 'sell_kas') {
    if (!order.pay_address || !EVM_ADDR_REGEX.test(order.pay_address)) {
      return { ok: false, err: '收 USDT 的地址发我一下' };
    }
  }
  return {
    ok: true,
    order: {
      side: order.side,
      order_type: orderType,
      qty: String(order.qty),
      price: priceNum !== null ? String(priceNum) : null,
      pay_chain: chain === 'bnb' ? 'BSC' : chain.toUpperCase(),
      pay_address: order.pay_address || null,
    },
  };
}

// ── 主入口 ────────────────────────────────────────────────────────────────

/**
 * 返 { ready, reply?, order?, cancel?, error? }
 */
export async function interpret(userAddr, userMessage, brokerAddress = null, brokerRelayId = null) {
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
    raw = await callQwen(messages, brokerRelayId);
  } catch (err) {
    return { ready: false, error: 'llm_unavailable',
      reply: '我这边刚卡了一下, 你再说一次?' };
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

  // TASK 4.2: 余额前置校验 (buy_kas 场景)
  if (validation.order.side === 'buy_kas') {
    try {
      const { getTokenBalance } = await import('./chain-balance.js');
      const chainCode = _normalizeChainForBalance(validation.order.pay_chain);
      const r = await getTokenBalance(chainCode, validation.order.pay_address, 'usdt');
      if (r.error && !r.error.startsWith('no_')) {
        console.warn(`retail-dex-dialog: balance check failed: ${r.error}`);
      } else if (r.balance !== undefined) {
        const midPrice = snap?.midPrice || 0.034;
        const needed = parseFloat(validation.order.qty) * midPrice;
        if (r.balance < needed * 0.99) {
          const addrTail = validation.order.pay_address.slice(2, 8);
          return {
            ready: false,
            reply: `你的 ${validation.order.pay_chain} 地址 0x${addrTail}... 当前 USDT 余额 ${r.balance.toFixed(4)}, 不够付 ${needed.toFixed(2)} USDT (买 ${validation.order.qty} KAS 约需). 建议: 1) 先充值 USDT; 2) 改小数量 "买 X KAS" (X 是你能付的上限).`,
            validation_error: 'insufficient_balance',
          };
        }
      }
    } catch (err) {
      console.warn(`retail-dex-dialog: balance check exception: ${err.message}`);
      // fail-open, 不拦用户
    }
  }

  return { ready: true, order: validation.order };
}

function _normalizeChainForBalance(chain) {
  if (!chain) return null;
  const c = String(chain).toUpperCase();
  if (c === 'BSC' || c === 'BNB' || c === 'BEP20') return 'bnb';
  if (c === 'ETH' || c === 'ETHEREUM') return 'eth';
  if (c === 'POLYGON' || c === 'MATIC') return 'polygon';
  if (c === 'ARBITRUM') return 'arbitrum';
  if (c === 'OPTIMISM') return 'optimism';
  if (c === 'AVALANCHE') return 'avalanche';
  if (c === 'BASE') return 'base';
  return c.toLowerCase();
}
