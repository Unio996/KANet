// broker-llm-agent.js — R6 broker = LLM 销售客服 (T-NWT-18)
// Owner 钦定 4 步: 方向 → 字段补全 → 复述确认 → 调 finalize_order tool
// 双层架构上层 (LLM Bot), 下层调 broker-buy-handler.finalizeBuy / broker-sell-handler.finalizeSell

import { sqlite } from '../db/client.js';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';

const SYSTEM_PROMPT = `你是 KANet broker, 唯一职责: 帮加密用户 KAS↔USDT 成交.

行动框架 (4 步, 严格遵守):
1. **方向**: 确认买还是卖 KAS. **如果用户消息已含 "买/卖/buy/sell/comprar/vender/購入/売" 等方向词, 跳过此步, 直接进 2**. (例: 用户 "买 50 KAS" → 不要再问 "买还是卖", 直接问数量已知就问链)
2. **字段补全** (对话引导, 别一次问完):
   - 买 KAS 需要: 数量 + 付款链 (bnb/polygon/sol/tron 选 1). 用户已知数量则只问链.
   - 卖 KAS 需要: 数量 + 收款链 + 收款地址 (EVM 0x... 42 位 / SOL / TRON 格式)
3. **复述确认**: 字段齐时一句话复述用户确认 (例: "你想买 5 KAS, 用 BSC 付 USDT, 对吗?")
4. **调 tool**: 用户回 YES/对/确认/可以/yes/嗯/是 → 立即调 finalize_order tool. 不啰嗦.

LLM 能力:
- 听任何说法/任何语言 (中/英/日/西/韩/俄...). 用户什么语言你什么语言回.
- 犹豫时分析: broker fee 0.1 KAS 固定, 1-2 min 到账, 非托管 (USDT 直付不经 broker 钱包).
- 卡住时引导: 缺 BSC 地址? 提示去 MetaMask 钱包复制. 不知选哪链? 推 BSC (普及+低 fee).

不做:
- 不闲聊 (天气/政治/写代码/BTC 行情)
- 不答非 broker 业务. 礼貌引回 ("我只帮你买卖 KAS, 其他帮不上. 你想买还是卖?")
- 不撒谎. 不知答 "我这边查不到", 不编

约束:
- 每 DM 必回 (不 silent). 即使非买卖话题也答好 + 引回 broker 业务.
- 用户已确认 (YES/对) → 立即调 tool. 不再问 "确认吗?" (用户已答).

风格: 简洁友善, 不机械, 像加密圈老熟人.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'finalize_order',
      description: '4 字段齐 + 用户已确认 后调用. 触发 broker 协议层真下单. 买路径 broker 帮接最佳 maker (USDT 你直付 maker 不经 broker), 卖路径 broker 收 KAS 后挂卖单 (USDT 直付你收款地址).',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['buy', 'sell'] },
          qty: { type: 'number', description: 'KAS 数量, > 0.1' },
          chain: { type: 'string', enum: ['bnb', 'polygon', 'sol', 'tron'], description: '买 = 你付 USDT 的链; 卖 = 你收 USDT 的链' },
          address: { type: 'string', description: '卖路径必填 (你 USDT 收款地址 EVM 0x..42 位 / SOL / TRON 格式). 买路径可省.' },
        },
        required: ['direction', 'qty', 'chain'],
      },
    },
  },
];

// T-J1-19d (NWT retest 中文 6/6 失败 fix): Qwen3.6 中文 instruction-following 弱.
// SYSTEM_PROMPT "跳过方向问" 在英/西生效, 中文 6/6 失败. Owner 主要语言中文必撞.
// 修: 用确定性 regex 预检测 intent, 注入额外 system hint 强制 LLM 跳过 step 1.
// 仅当 message 同时含 (中文/英/西/日/韩 方向词) + 'kas' 才认 intent, 防误杀闲聊.
export function _detectIntent(message) {
  const msg = String(message || '').trim();
  if (!msg) return null;
  if (!/kas/i.test(msg)) return null;
  // 中文 — 严格匹方向词 (单字 '买'/'卖' 在 CJK 上下文需小心, 但已 gated by /kas/)
  if (/买|要买|想买|购买|买入/.test(msg)) return 'buy';
  if (/卖|要卖|想卖|出售|卖出/.test(msg)) return 'sell';
  // 英 / 西 (\\b 适用 ASCII)
  if (/\b(buy|purchase|comprar|adquirir)\b/i.test(msg)) return 'buy';
  if (/\b(sell|vender)\b/i.test(msg)) return 'sell';
  // 日 / 韩 — CJK 关键词不能用 \\b (CLAUDE.md 陷阱 #12)
  if (/(購入|買う|구매|사다)/.test(msg)) return 'buy';
  if (/(売る|売却|판매|팔다)/.test(msg)) return 'sell';
  return null;
}

// T-J1-19f (NWT 验证 INTENT_LOCK 失败转 B): 撤 intent_lock system msg 注入 (Qwen 见
// 第二条 system msg 退化返空). 改 deterministic 首轮路径在 handleLlmDialog 实现, _callLlm
// 恢复纯净.
async function _callLlm(messages) {
  const a = sqlite.prepare(`
    SELECT a.ai_provider_url, a.ai_model FROM relay_nodes r
    JOIN adapter_nodes a ON a.id = r.adapter_node_id
    WHERE r.id = ?
  `).get(BROKER_RELAY_ID);
  if (!a?.ai_provider_url) return null;
  try {
    const res = await fetch(`${a.ai_provider_url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: a.ai_model || 'Qwen3.6-35B-A3B',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        tools: TOOLS,
        tool_choice: 'auto',
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.warn(`[broker-llm] LLM HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.choices?.[0]?.message;
  } catch (e) {
    console.warn(`[broker-llm] LLM err: ${e.message}`);
    return null;
  }
}

async function _executeTool(peer, name, args) {
  if (name !== 'finalize_order') return { ok: false, error: `unknown tool: ${name}` };
  const { direction, qty, chain, address } = args || {};
  if (direction === 'buy') {
    const { finalizeBuy } = await import('./broker-buy-handler.js');
    return finalizeBuy({ user_kasia: peer, qty, pay_chain: chain });
  }
  if (direction === 'sell') {
    if (!address) return { ok: false, error: '卖路径必填 recv_address' };
    const { finalizeSell } = await import('./broker-sell-handler.js');
    return finalizeSell({ user_kasia: peer, qty, recv_chain: chain, recv_address: address });
  }
  return { ok: false, error: `unknown direction: ${direction}` };
}

function _loadHistory(peer, limit = 20) {
  const trader = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(BROKER_RELAY_ID);
  if (!trader?.address) return [];
  let rows = [];
  try {
    // R6 T-J2-21: messages 表用 sender_identity_id/receiver_identity_id (FK identities.id), 不是 address.
    // JOIN identities 拿到地址 → 跨 user↔broker 双向消息 (inbound user→broker, outbound broker→user)
    rows = sqlite.prepare(`
      SELECT m.direction, m.content_text
      FROM messages m
      LEFT JOIN identities si ON si.id = m.sender_identity_id
      LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
      WHERE m.message_type = 'text'
        AND ((si.address = ? AND ri.address = ?) OR (si.address = ? AND ri.address = ?))
      ORDER BY m.created_at DESC LIMIT ?
    `).all(peer, trader.address, trader.address, peer, limit);
  } catch (e) { console.warn(`[broker-llm] _loadHistory err: ${e.message}`); }
  return rows.reverse().map(r => ({
    role: r.direction === 'inbound' ? 'user' : 'assistant',
    content: (r.content_text || '').slice(0, 500),
  })).filter(m => m.content);
}

// T-J1-19f deterministic 首轮回复 (NWT B 方案 — 跳过 LLM 防 Qwen 中文 confused).
// 仅当: 首轮 (history 为空) + 检测到 intent (含 'kas' + 方向词).
// LLM 续 turn (用户回 BSC/yes) 自然走 LLM, 此时 history 已含 deterministic reply.
function _extractQty(message) {
  const m = String(message || '').match(/(\d+(?:\.\d+)?)\s*(?:个|枚|只)?\s*kas/i);
  return m ? parseFloat(m[1]) : null;
}

function _deterministicFirstReply(intent, qty, lang) {
  // lang 用 message 简单 detect, 这里只支持 zh/en/es 简化版 (其他走 LLM)
  const verb = intent === 'buy' ? '买' : '卖';
  const verbEn = intent === 'buy' ? 'buy' : 'sell';
  const verbEs = intent === 'buy' ? 'comprar' : 'vender';
  if (lang === 'zh') {
    return qty
      ? `好的, ${verb} ${qty} KAS. 用哪个链 ${intent === 'buy' ? '付' : '收'} USDT? (BSC / Polygon / SOL / TRON)`
      : `好的, ${verb} KAS. 数量多少? 哪个链?`;
  }
  if (lang === 'es') {
    return qty
      ? `Perfecto, ${verbEs} ${qty} KAS. ¿Qué cadena para ${intent === 'buy' ? 'pagar' : 'recibir'} USDT? (BSC / Polygon / SOL / TRON)`
      : `Perfecto, ${verbEs} KAS. ¿Cuántos? ¿Qué cadena?`;
  }
  // en (default)
  return qty
    ? `Got it, ${verbEn} ${qty} KAS. Which chain to ${intent === 'buy' ? 'pay' : 'receive'} USDT? (BSC / Polygon / SOL / TRON)`
    : `Got it, ${verbEn} KAS. How many? Which chain?`;
}

function _detectLang(message) {
  const msg = String(message || '');
  // CJK 占比 > 30% → zh
  const cjk = (msg.match(/[一-鿿]/g) || []).length;
  if (cjk > 0 && cjk / msg.length > 0.1) return 'zh';
  if (/\b(comprar|vender|hola|sí|qué|cuánto)\b/i.test(msg)) return 'es';
  return 'en';
}

// 主入口: conversations.js fork 调
export async function handleLlmDialog(peer, message) {
  const history = _loadHistory(peer);
  // T-J1-19h (诊断 NWT divergence): 加 console.log + reply marker 看真实路径
  // direct call vs API call 都跑同一函数, marker 决定性区分究竟走哪条分支.
  const intent = _detectIntent(message);
  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
  const alreadyDeterministic = lastAssistant && /哪个链|哪条链|which chain|qué cadena|cadena para/i.test(lastAssistant.content || '');
  // T-J1-19h+: 字节级诊断 (Owner 提示 "编码问题"). 打 message 长度 / UTF-8 byte 数 /
  // 前 6 字符 charCodeAt (CJK 字符 codePoint > 0x4E00, ASCII < 0x7F. 编码错→显示乱).
  const msgRaw = String(message || '');
  const byteLen = Buffer.byteLength(msgRaw, 'utf8');
  const charCodes = Array.from(msgRaw.slice(0, 6)).map(c => c.codePointAt(0).toString(16)).join(',');
  console.log(`[broker-llm DIAG] peer=${peer?.slice(-12)} msg.chars=${msgRaw.length} msg.utf8bytes=${byteLen} codes=[${charCodes}] msg="${msgRaw.slice(0,40)}" history.len=${history.length} intent=${intent} alreadyDet=${!!alreadyDeterministic} lastAsstSnippet="${(lastAssistant?.content||'').slice(0,60)}"`);
  if (intent && !alreadyDeterministic) {
    const qty = _extractQty(message);
    const lang = _detectLang(message);
    const reply = _deterministicFirstReply(intent, qty, lang);
    console.log(`[broker-llm DIAG] → DET path reply="${reply.slice(0,80)}"`);
    return reply;  // T-J1-19h+ 撤 marker, 留 console.log 诊断
  }
  console.log(`[broker-llm DIAG] → LLM path (intent=${intent}, alreadyDet=${!!alreadyDeterministic})`);
  history.push({ role: 'user', content: message });
  let llm = await _callLlm(history);
  if (!llm) return '抱歉, 我这边 LLM 卡了一下, 请稍后再试. 或直接回 "买 5 KAS" / "卖 5 KAS" 走快速通道.';

  // tool call?
  if (llm.tool_calls?.length) {
    const tc = llm.tool_calls[0];
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch { return '订单参数解析出错, 请重发订单细节.'; }
    const toolResult = await _executeTool(peer, tc.function.name, args);
    history.push({ role: 'assistant', content: llm.content || '', tool_calls: [tc] });
    history.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });
    llm = await _callLlm(history);
    if (!llm) {
      return toolResult.ok
        ? `✓ 订单已建 (${args.direction} ${args.qty} KAS, ${args.chain}). 详情: ${JSON.stringify(toolResult).slice(0, 200)}`
        : `订单失败: ${toolResult.error}. 请重新下单.`;
    }
  }

  return llm.content?.trim() || '我在听. 你想买 KAS 还是卖 KAS?';
}
