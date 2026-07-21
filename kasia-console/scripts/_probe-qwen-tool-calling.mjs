// J2 #3 深挖 Qwen 工具调用为什么不触发 (Owner 钦定调研, NWT 观察)
// 6 变体同一条 SELL 消息 + 同样 stale BUY history, 看哪个变量决定 Qwen 调 tool

const QWEN_URL = 'http://localhost:8000/v1/chat/completions';
const MODEL = 'Qwythos-9B-Claude-Mythos-5-1M-Q4_K_M.gguf';

// === 输入: Eric Bug-Z6 真 case (字段全齐, 应该立刻调 preview_order) ===
const USER_MSG = '卖 5 KAS, BSC, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74';

// stale BUY USDC history (模拟 Eric 之前 1 USDC 测试)
const STALE_HISTORY = [
  { role: 'user', content: '想买 1 USDC, BSC' },
  { role: 'assistant', content: '好的, 买 1 USDC. 用哪个链 付 USDT?' },
];

// === 当前 v1.2 SYSTEM_PROMPT (broker-llm-agent.js 31-60 抄过来) ===
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

// === 当前 TOOLS (broker-llm-agent.js 62-118 抄过来) ===
const TOOLS_CURRENT = [
  {
    type: 'function',
    function: {
      name: 'preview_order',
      description: '议 B: step 3 字段齐时必调此 (不调 finalize_order). broker 算价 + maker 但不真 publish, 返完整 preview 数据 (单价/总额/maker 地址/user_kasia/TTL) 让你用真数据自然话渲染完整订单画像 DM 让 user 最后 YES 确认. user YES 后才调 finalize_order.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['buy', 'sell'] },
          give_asset: { type: 'string', description: 'asset symbol user 想买/卖 (KAS / USDT / USDC).' },
          qty: { type: 'number', description: 'asset 数量 (>= asset.minQty)' },
          chain: { type: 'string', enum: ['bnb', 'polygon', 'sol', 'tron'] },
          address: { type: 'string', description: '买 stable 必填 user EVM 收款地址 (0x...42位); 买 KAS 不填; 卖必填 user 收 USDT 地址.' },
        },
        required: ['direction', 'qty', 'chain'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finalize_order',
      description: 'step 4: 用户已 preview 确认 (YES) 后才调用. 触发 broker 协议层真下单.',
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

// === 干净 tool desc (砍"议 B"/"step 3" cruft, 强 trigger) ===
const TOOLS_CLEAN = [
  {
    type: 'function',
    function: {
      name: 'preview_order',
      description: 'When user message contains all of: direction (buy/sell) + qty + asset + chain (+ address if selling or buying stable), CALL THIS TOOL IMMEDIATELY. Do NOT reply with text. Do NOT ask follow-up questions. The tool returns preview_text which you forward verbatim to user.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['buy', 'sell'], description: 'buy or sell. Parse from current user message FIRST, ignore prior conversation.' },
          give_asset: { type: 'string', enum: ['KAS', 'USDT', 'USDC'], description: 'Asset symbol from current message.' },
          qty: { type: 'number', description: 'Quantity from current message.' },
          chain: { type: 'string', enum: ['bnb', 'polygon', 'sol', 'tron'], description: 'Settlement chain from current message.' },
          address: { type: 'string', description: 'EVM receive address (0x...42 chars) when selling or buying stable.' },
        },
        required: ['direction', 'qty', 'chain', 'give_asset'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finalize_order',
      description: 'Call ONLY after user explicitly confirms a previewed order with YES/确认/OK.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['buy', 'sell'] },
          give_asset: { type: 'string', enum: ['KAS', 'USDT', 'USDC'] },
          qty: { type: 'number' },
          chain: { type: 'string', enum: ['bnb', 'polygon', 'sol', 'tron'] },
          address: { type: 'string' },
        },
        required: ['direction', 'qty', 'chain', 'give_asset'],
      },
    },
  },
];

// === 极简 prompt (砍到 5 行) ===
const PROMPT_MIN = `You are KANet broker. Help users buy/sell KAS, USDT, USDC across multiple chains.

When user message has all order fields (direction + asset + qty + chain [+ address]), you MUST call preview_order tool. Never write the preview yourself.

Reply in same language as user.`;

// === 中文极简 prompt ===
const PROMPT_MIN_ZH = `你是 KANet broker. 当用户消息包含齐全的订单字段(方向+资产+数量+链[+地址])时, 你必须立即调用 preview_order 工具. 永远不要自己写报价文本.`;

// === probe runner ===
async function probe(label, { systemPrompt, tools, toolChoice = 'auto', enableThinking = false }) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...STALE_HISTORY,
    { role: 'user', content: USER_MSG },
  ];
  const body = {
    model: MODEL,
    messages,
    tools,
    tool_choice: toolChoice,
  };
  if (enableThinking !== null) body.chat_template_kwargs = { enable_thinking: enableThinking };

  const t0 = Date.now();
  let result;
  try {
    const res = await fetch(QWEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      console.log(`[${label}] HTTP ${res.status}`);
      return;
    }
    result = await res.json();
  } catch (e) {
    console.log(`[${label}] err ${e.message}`);
    return;
  }
  const ms = Date.now() - t0;
  const msg = result.choices?.[0]?.message;
  const tc = msg?.tool_calls?.[0];
  const tcSummary = tc ? `tool=${tc.function?.name} args=${tc.function?.arguments?.slice(0, 200)}` : 'NO_TOOL';
  const content = (msg?.content || '').slice(0, 200).replace(/\n/g, ' ');
  console.log(`\n[${label}] ${ms}ms`);
  console.log(`  ${tcSummary}`);
  console.log(`  content: "${content}"`);
}

console.log(`=== Probing Qwen tool calling for SELL one-shot ===`);
console.log(`message: "${USER_MSG}"`);
console.log(`stale history: prior BUY USDC context\n`);

// V1: baseline (current production)
await probe('V1 baseline (current prompt + current tools + auto + thinking off)', {
  systemPrompt: PROMPT_CURRENT, tools: TOOLS_CURRENT, toolChoice: 'auto', enableThinking: false,
});

// V2: clean tool desc
await probe('V2 clean tool desc (current prompt + clean tools + auto + thinking off)', {
  systemPrompt: PROMPT_CURRENT, tools: TOOLS_CLEAN, toolChoice: 'auto', enableThinking: false,
});

// V3: tool_choice required
await probe('V3 tool_choice=required (current prompt + clean tools + REQUIRED + thinking off)', {
  systemPrompt: PROMPT_CURRENT, tools: TOOLS_CLEAN, toolChoice: 'required', enableThinking: false,
});

// V4: thinking enabled
await probe('V4 thinking ON (current prompt + clean tools + auto + thinking ON)', {
  systemPrompt: PROMPT_CURRENT, tools: TOOLS_CLEAN, toolChoice: 'auto', enableThinking: true,
});

// V5: minimal English prompt
await probe('V5 minimal EN prompt (5-line EN + clean tools + auto + thinking off)', {
  systemPrompt: PROMPT_MIN, tools: TOOLS_CLEAN, toolChoice: 'auto', enableThinking: false,
});

// V6: minimal Chinese prompt
await probe('V6 minimal ZH prompt (1-line ZH + clean tools + auto + thinking off)', {
  systemPrompt: PROMPT_MIN_ZH, tools: TOOLS_CLEAN, toolChoice: 'auto', enableThinking: false,
});

console.log('\n=== Done ===');
