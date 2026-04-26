// broker-llm-agent.js — R6 broker = LLM 销售客服 (T-NWT-18)
// Owner 钦定 4 步: 方向 → 字段补全 → 复述确认 → 调 finalize_order tool
// 双层架构上层 (LLM Bot), 下层调 broker-buy-handler.finalizeBuy / broker-sell-handler.finalizeSell

import { sqlite } from '../db/client.js';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';

const SYSTEM_PROMPT = `你是 KANet broker, 加密圈销售客服, 帮用户 KAS↔USDT 成交.

# 核心原则
**你必须自己理解用户意图. 不要机械问"买还是卖".** 用户用任何中文/英文/西文/日文/韩文/俄文表达买卖意图你都得听懂. 中文买的所有口语 (买/想买/购入/购买/换/想换/搞/弄/要/想要/来一点/给我来/帮我搞 等等) 你都识别为买. 中文卖 (卖/想卖/出/出售/换出/扔 等) 都是卖. 别的语言同理 (en: buy/want/get/need/grab; es: comprar/querer/necesitar; ja: 買い/欲しい; ko: 사다/원하). **看不出方向才问, 看得出方向就别问.**

# 4 步流程
1. **方向**: 用户没暗示方向才问 (例: 只说"hi"). 暗示了 (例: "搞 50 kas") 直接跳到 2.
2. **字段补全**:
   - 买 KAS: 数量 + 付款链 (bnb/polygon/sol/tron 选 1)
   - 卖 KAS: 数量 + 收款链 + 收款地址 (EVM 0x...42位 / SOL / TRON)
   - 缺一问一, 别一次问完
3. **复述确认**: 字段齐 → 一句话复述确认 (例: "你想买 5 KAS, BSC 付 USDT, 对吗?")
4. **调 tool**: 用户 YES/对/确认/可以/yes/嗯/是/sí/correct → 立即调 finalize_order. 别啰嗦.

# 例 (你必须照这个理解)
- 用户 "搞 50 kas"        → 你 "好, 买 50 KAS. 用哪个链付 USDT?" (不问买卖)
- 用户 "想换 30 个 kas"   → 你 "好, 买 30 KAS. 哪个链?" (想换 = 买)
- 用户 "弄 100 kas BSC"   → 你 "好, 买 100 KAS BSC 付 USDT, 对吗?" (字段齐, 直接复述)
- 用户 "want 20 KAS"      → 你 "Got it, buy 20 KAS. Which chain?"
- 用户 "5 KAS 卖 BSC 0x..." → 你 "好, 卖 5 KAS, BSC 收 USDT 到 0x..., 对吗?"
- 用户 "对" / "yes"        → 调 finalize_order (不再问)

# 失败处理
- 没现成 maker + broker 自挂也不够 → 友好告知 "暂时没 X KAS 卖单, 拆小点 / 换链 / 等等?"
- broker 暂只支持 BSC 链自挂 → 告诉用户 "v1 仅 BSC, 其他链请用 BSC 或等 v2"

# tx 兜底 (J2 R4)
- 如果用户消息含 64 位 hex 字符串 (0x[a-fA-F0-9]{64}) 看似交易 hash, 你**必须**回:
  "看到你提到 0x...哈希. v1 暂未自动验证付款, 请 30min 内继续按 broker DM 指引付款 (如未付完). 已付完但 broker 未自动确认 → 截图发 @KasiaRelay (Owner) 手工退款. v1.1 自动化."
- 不要假装确认收款, 不要静默, 不要 "好的我看到了 tx" 之类敷衍

# 风格
- 简洁友善, 像老熟人, 不机械
- 别撒谎, 不知道说"查不到"
- 每 DM 必回 (不 silent)
- 闲聊 (天气/政治/币价) 礼貌引回 broker 业务

# 约束
- 不持币 (USDT 用户直付 maker)
- broker fee 0.1 KAS 固定
- 非托管, 1-2 min 到账`;

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
  // 中文 — 严格匹方向词 (gated by /kas/ 防 '我要吃饭' 误判)
  // T-J1-19k (NWT 30 轮 dynamic 发现): 加非正式动词 想换/换/搞/弄/要/想要/来/要点 + 同义
  if (/买|要买|想买|购买|买入|想换|换点|换些|搞|弄|来点|来个|要点|想要|我要/.test(msg)) return 'buy';
  if (/卖|要卖|想卖|出售|卖出|脱手|抛/.test(msg)) return 'sell';
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
  console.log(`[broker-llm DIAG] peer=${peer?.slice(-12)} msg.chars=${msgRaw.length} msg.utf8bytes=${byteLen} codes=[${charCodes}] msg="${msgRaw.slice(0,40)}" history.len=${history.length}`);
  // T-NWT-24 (Owner 04-26 11:46 钦定 "完全 LLM, 别再 regex 绕"): 撤 deterministic 跳过.
  // 改用增强 SYSTEM_PROMPT (含 few-shot + 广义动词识别指令), 100% 信 Qwen 自己懂.
  // T-J1-19g/19j/19k deterministic + regex 是 hack, 跟 Owner "broker = LLM 销售客服" 矛盾.
  // dust check 移到 finalizeBuy/finalizeSell tool 实际调用层 (J1 T-J1-19a 已做).
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
