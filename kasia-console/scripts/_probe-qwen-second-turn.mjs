// J2 #3 二轮探针 — 证明 sell preview 拒绝后第二轮 LLM 行为
// hypothesis: Qwen 第一轮调对 tool, 但 _executeTool sell branch 返 ok:false ('sell_preview_v1_1 没实现'),
// LLM 第二轮拿这个 result 自由发挥退化到 NLG 反问.

const QWEN_URL = 'http://localhost:8000/v1/chat/completions';
const MODEL = 'Qwythos-9B-Claude-Mythos-5-1M-Q4_K_M.gguf';
const USER_MSG = '卖 5 KAS, BSC, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74';

const PROMPT_CURRENT = `你是 KANet broker, 帮用户买卖 KAS / USDT / USDC. 跨 9 chain (BSC/ETH/Polygon/Arb/Op/Avax/Base/Sol/Tron).

# 你最重要的 3 件事 (永远不能忘)

1. **字段齐 → 必调 preview_order tool**. 字段 = 方向(买/卖) + 数量 + 资产(KAS/USDT/USDC) + 链 + 收款地址(买 stable 或 卖 时必填). 不准自己编报价, 不准自己说 '订单画像', preview 必经 tool.
2. **用户回 YES/确认/对 → 必调 finalize_order tool**. 不准自己说 '已下单'.
3. **用户说 已付/付了/check → 必调 verify_payment tool**. 不准让用户找 tx hash.

# 字段收集 (一字段一问, 别一次问全)

缺方向: 直接判定 (买/想买/想要/get/want/buy → buy; 卖/抛/sell/dump → sell). 不问 '买还是卖'.
缺资产: '买 KAS / USDC / USDT?' (默认 KAS)
缺数量: '多少?'
缺链: '哪个链? (BSC / Polygon / SOL / TRON)'
缺地址 (买 stable 或 卖): '你 EVM 收款地址 (0x... 42位)?'
**字段齐立刻调 preview_order tool.**

# tool 返 preview_text → 你 100% 原样转发 (一字不改地址不缩写)

LLM 编 0x 地址 = user 转钱到 fake 地址 = 灾难. preview_text 含真 broker 地址, 你必须整段照转.

# 用户消息处理铁律

- 多字段 one-shot ('买 0.5 USDC, BSC, 0x...') → 字段齐, **直接调 preview_order tool** (不要自己编 reply 也不要再问)
- 'YES' 无 prior preview → '抱歉, 我没找到你的 active 订单. 重新告诉我数量+链.' (绝不说 '订单争议中' '通知 Owner')
- '我付了 0xabc...' → handler 已自动 verify (你只 ack '收到 tx, 验证中, ~30-60s 发 KAS')

# 风格 + 约束

中文回中文, 英文回英文. 简洁友好不机械. 不持币非托管, broker fee 0.1 KAS 固定.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'preview_order',
      description: '议 B: step 3 字段齐时必调此 (不调 finalize_order). broker 算价 + maker 但不真 publish, 返完整 preview 数据.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['buy', 'sell'] },
          give_asset: { type: 'string' },
          qty: { type: 'number' },
          chain: { type: 'string', enum: ['bnb', 'polygon', 'sol', 'tron'] },
          address: { type: 'string' },
        },
        required: ['direction', 'qty', 'chain'],
      },
    },
  },
];

// 模拟 broker production 第二轮 — Qwen 已调 preview_order, _executeTool 返 sell_preview_v1_1 拒绝
const messages = [
  { role: 'system', content: PROMPT_CURRENT },
  { role: 'user', content: '想买 1 USDC, BSC' },
  { role: 'assistant', content: '好的, 买 1 USDC. 用哪个链 付 USDT?' },
  { role: 'user', content: USER_MSG },
  // 第一轮 tool call (Qwen 真调对了)
  {
    role: 'assistant',
    content: '',
    tool_calls: [{
      id: 'call_001',
      type: 'function',
      function: {
        name: 'preview_order',
        arguments: JSON.stringify({ direction: 'sell', qty: 5, chain: 'bnb', give_asset: 'KAS', address: '0x94053e04feE8d863cFa29DF10938a7A2E2b71D74' }),
      },
    }],
  },
  // tool result (broker-llm-agent.js 207-209 行实际行为 — sell preview 拒绝)
  {
    role: 'tool',
    tool_call_id: 'call_001',
    content: JSON.stringify({ ok: false, error: 'sell_preview_v1_1', message: '卖 preview v1.1 加, 当前直接 YES 走真下单. 你确认数量 + 链 + 收款地址后回 YES.' }),
  },
];

console.log('=== 二轮探针 — Qwen 第一轮调对 preview_order(sell), tool 返 ok:false 后 LLM 怎么办 ===');
console.log(`message: "${USER_MSG}"\n`);

const t0 = Date.now();
const res = await fetch(QWEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: MODEL,
    messages,
    tools: TOOLS,
    tool_choice: 'auto',
    chat_template_kwargs: { enable_thinking: false },
  }),
  signal: AbortSignal.timeout(120_000),
});
const data = await res.json();
const ms = Date.now() - t0;
const msg = data.choices?.[0]?.message;
console.log(`[二轮 LLM] ${ms}ms`);
console.log(`  tool_calls: ${JSON.stringify(msg?.tool_calls || null)}`);
console.log(`  content: "${msg?.content || ''}"`);
