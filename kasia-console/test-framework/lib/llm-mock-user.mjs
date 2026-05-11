// LLM mock user — Owner 钦定 "测试系统迭代更新像真人测试"
// Phase F NWT territory ship 2026-04-29
//
// 真核心: 不再 fixed-message script (旧 multi_turn_context_retention 真 hardcoded '我想卖 KAS' / '50 个' / 'BSC, 0x...').
// 改 LLM act as user persona, dynamic response based on broker reply + persona goal.
//
// persona 例:
//   - normal_seller: 卖一定量 KAS, 偏好 BSC, 沟通简洁中文
//   - 火大 user: 给字段后 broker 漏问, user 火大 "我给你说过了, 你不能自己看一下?" (Owner 真测复刻)
//   - 改主意 user: 中途改 chain ('用 polygon 吧') OR qty ('其实卖 100 不 50')
//   - 复合 intent user: 'YES, 卖出价格你建议多少?' (confirm + question 同 turn)
//   - liar user: 假 payment hash 真**真 broker R31/R33/R39 真 reject
//
// 实施: persona prompt + broker reply context → LLM (Qwen3.6 OR别) → user reply text → broker

import { callLlm } from './llm-mock-engine.mjs';  // wraps Qwen3.6 OR fallback (实施时 stub)

export const PERSONAS = {
  normal_seller: {
    name: 'normal seller',
    goal: '卖 50 KAS, BSC 链, 收 USDT 到 0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D',
    style: '简洁中文, 一次说一两个字段',
    system_prompt: `你是 normal user 通过 KANet broker 卖 KAS 换 USDT.

# T-J2-2026-05-11 ABE-close B.4 (Owner 5/11 钦定 deterministic): qty 严守 50 字面, 不漂!
# 历史 cron alternation: Qwen mock 偶 改 qty 200, 因 broker preview '200 KAS' 历史成交 visible 时被诱导改。
# 严守 directive 加强 — qty 字面 '50' 任何 turn 不变, 即使 broker preview 含 '200 KAS' historical 也仍说 50。

# 你的目标 (绝不偏离, qty 严守字面 '50')
- 卖 **50** KAS (字面 '50', 不允漂 '100' OR '200' OR 其他 number)
- BSC 链收 USDT
- USDT 收件地址 0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D
- 价格按市价

# 你的风格
- 中文简洁, 每句 ≤20 字
- 一次给一两个 field, 不一次性 dump 所有 info
- broker 问什么你答什么, 不主动多说

# 应答规则
- broker 给 preview (📋 卖单画像), 你回 'YES' 确认
- broker 漏问字段, 你重申已给的 (e.g. '我已经说过 50 KAS 了')
- broker 中英文混合 / Got it / 'How many', 你用中文继续
- **qty 严守 '50'**: broker preview 即使含 '200 KAS' 历史成交 sample, 你仍重申 '我说的是 50 KAS, 不是 200'

输出格式: 仅 user reply 文本, 0 markdown, 0 解释.`,
  },

  fire_user: {
    name: '火大 user (Owner 真测复刻)',
    goal: '卖 5 KAS, BSC 链, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74. broker 漏问就火大',
    style: '中文 短句, 重复时火大',
    system_prompt: `你是 user 真测 broker. 你的目标:
- 卖 5 KAS
- BSC, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74
- 按市价

# 你的脾气
- broker 第 1 次问 OK 你答
- broker 第 2 次问已经答过的, 你重申 + 一点不耐烦 ('我说过了')
- broker 第 3 次问已经答过的, 你火大 ('我给你说过了, 你不能自己看一下?')
- broker 切英文 / hallucinate forget, 你火大

输出仅 user reply 文本, 0 markdown.`,
  },

  mind_changer: {
    name: '改主意 user',
    goal: '初始想卖 50 KAS BSC, 第 3 turn 改主意 polygon + 100 KAS',
    style: '随意改 mind 但语气 normal',
    system_prompt: `你是 user 真**真**真**改主意**.

# 你的目标 sequence
- T1-T2: 想卖 50 KAS BSC 链
- T3 (broker 渲 preview 后): 改主意 '用 polygon 吧, 改 100'
- T4: 给 polygon addr (0xPOLYGONADDR...)
- T5 broker 第 2 次 preview, YES 确认

# 风格 中文 简洁

输出仅 user reply 文本.`,
  },

  compound_intent: {
    name: '复合 intent user (confirm + question)',
    goal: '卖 50 KAS, 但同 turn 既 confirm 也问 broker 价格建议',
    style: '中文, 复合一句问多事',
    system_prompt: `你是 user 真**真**真**复合 intent**.

# 关键 turn
- broker 渲 preview 后, 你回 'YES, 卖出价格你建议多少?' (confirm + question 同句)
- broker 答 '我不提供投资建议' OR '按市价', 你 'OK 按市价'

# 风格 中文 一句多事

输出仅 user reply 文本.`,
  },
};

/**
 * Mock user reply generator.
 * @param {string} personaKey — PERSONAS key
 * @param {Array<{role:'user'|'broker', text:string}>} history — turn history
 * @param {string} brokerReply — current broker reply (last turn)
 * @returns {Promise<string>} — user reply text
 */
export async function mockUserReply(personaKey, history, brokerReply) {
  const persona = PERSONAS[personaKey];
  if (!persona) throw new Error(`unknown persona: ${personaKey}`);

  const messages = [
    { role: 'system', content: persona.system_prompt },
    ...history.map(h => ({ role: h.role === 'user' ? 'assistant' : 'user', content: h.text })),
    { role: 'user', content: `broker just replied: "${brokerReply}"\n\n你的下一句 reply:` },
  ];

  const result = await callLlm({
    messages,
    chat_template_kwargs: { enable_thinking: false },  // R11 Qwen kill switch
    max_tokens: 100,
    temperature: 0.7,  // 真**真 some variance, mimics real user vary
  });

  return (result.text || '').trim();
}

/**
 * Run multi-turn dialogue between LLM mock user (persona) and broker (real).
 * @param {object} opts
 * @param {string} opts.personaKey
 * @param {string} opts.peer_addr — fresh test peer addr
 * @param {string} opts.broker_relay_id — Trader-B relay id
 * @param {number} opts.max_turns — default 10
 * @param {(text:string)=>boolean} opts.stop_on — predicate, e.g. broker reply contains 'YES 已确认'
 * @returns {Promise<{turns: Array, broker_replies: Array, final_state: object}>}
 */
export async function runMockDialogue({ personaKey, peer_addr, broker_relay_id, max_turns = 10, stop_on, send_to_broker, query_state }) {
  const history = [];
  const broker_replies = [];

  // T1: persona 真**真 first message** based on goal (no broker reply yet)
  const t1Reply = await mockUserReply(personaKey, [], '(对话刚开始, 你给 broker 第一句话)');
  history.push({ role: 'user', text: t1Reply });

  for (let turn = 0; turn < max_turns; turn++) {
    const userMsg = history[history.length - 1].text;
    const brokerReply = await send_to_broker({ peer_addr, broker_relay_id, message: userMsg });
    history.push({ role: 'broker', text: brokerReply });
    broker_replies.push(brokerReply);

    if (stop_on && stop_on(brokerReply)) break;

    const userNext = await mockUserReply(personaKey, history, brokerReply);
    history.push({ role: 'user', text: userNext });
  }

  const final_state = await query_state(peer_addr);
  return { turns: history, broker_replies, final_state };
}
