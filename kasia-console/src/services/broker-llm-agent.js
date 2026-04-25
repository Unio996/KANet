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

// 主入口: conversations.js fork 调
export async function handleLlmDialog(peer, message) {
  const history = _loadHistory(peer);
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
