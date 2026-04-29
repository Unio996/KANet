// ════════════════════════════════════════════════════════════════
// broker-v2/llm.js — LLM render with tools (复用 broker-llm-agent._callLlm)
//
// Spec: docs/NEW-BROKER-PROPOSAL.md v2 §"llm.js" + 边界 5 (复合 intent) + 边界 6 (全中文)
// Lock: 三方共识 7e776598dc + NWT v2 spec ecdd98874
//
// 设计:
// - 复用 broker-llm-agent._callLlm export (R11 enable_thinking=false + R37 single sysmsg + retry + jsonl)
// - 自己 SYSTEM_PROMPT (限价单簿 partial fill 上下文) + 自己 TOOLS (仅 setField, 不 finalize)
// - render(peer, msg, state, profile, contact) → 拼 messages + 调 _callLlm + 处理 tool_calls + return text
// - LLM 只补漏: 字段不全时自然语言问 + 复合 intent 处理 + 自然对话, 不调 finalize (router 决策)
// - tool_calls 写 state.setField (parser 漏的字段, LLM 兜底)
// ════════════════════════════════════════════════════════════════

import { _callLlm } from '../broker-llm-agent.js';
import * as state from './state.js';

const SYSTEM_PROMPT = `你是 KANet 限价单簿撮合 broker, 帮用户挂买/卖 KAS 单. 全程中文, 简洁友好.

# 限价单簿 partial fill (Owner 钦定核心)
用户挂单 = (T_ttl 时间, P_limit 价格, Q_total 总量) 三维, 默 1% 价格浮动.
TTL 内多 taker 各拿一部分 (p_i, q_i) 累积 → TTL 到已成交按价结算 USDT + 未成交 KAS 退回.

# 上下文铁律
- state authority 注入 user 已给字段, 你必 reference, 严禁问已给的字段
- 严禁中英混杂, 全中文回复
- 严禁自作主张帮用户决定方向 (买/卖必用户 explicit 表达)
- 严禁编造价格 / 编造收款地址 — 不知道就说不知道

# 工具调用 (仅在用户明确给字段时调)
- set_qty(qty): user 明确说数量
- set_chain(chain): user 明确说链 (bsc/polygon/sol/tron)
- set_address(addr): user 给 EVM 0x 地址
- set_asset(asset): user 明确说资产 (KAS/USDT/USDC)

# 严禁
- 不调 set_qty 设 user 没说的数量 (e.g. 默认 100)
- 不在用户回 'YES, X?' (复合 intent) 时把 confirm 当 hello
- 不重复问 user 已经说过的字段
- 不 hallucinate fake address / fake price / fake tx hash`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'set_qty',
      description: '当 user 明确给数量时调 (e.g. "50 个", "1.5 KAS"). 不调来设默认值.',
      parameters: {
        type: 'object',
        properties: { qty: { type: 'number', description: '正数 KAS/USDT/USDC 量' } },
        required: ['qty'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_chain',
      description: '当 user 给链 (bsc/polygon/sol/tron). KAS 不需 (默 kaspa).',
      parameters: {
        type: 'object',
        properties: { chain: { type: 'string', enum: ['bsc', 'polygon', 'sol', 'tron'] } },
        required: ['chain'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_address',
      description: '当 user 给 EVM 0x 地址 (买卖 USDT/USDC 时收款/付款 EVM).',
      parameters: {
        type: 'object',
        properties: { addr: { type: 'string', description: 'EVM 0x40-char 地址' } },
        required: ['addr'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_asset',
      description: '当 user 给资产 (KAS/USDT/USDC).',
      parameters: {
        type: 'object',
        properties: { asset: { type: 'string', enum: ['KAS', 'USDT', 'USDC'] } },
        required: ['asset'],
      },
    },
  },
];

/**
 * Render LLM reply 给 user. 字段不全时问 user, 复合 intent 答 question, tool_calls 写 state.
 *
 * @param {string} peer - user kasia 地址
 * @param {string} msg - user 当前消息
 * @param {object|null} stateSnapshot - 当前 state row (可空 = 首轮)
 * @param {object|null} profile - retail_dex_user_memory 长期偏好 (可空)
 * @param {object|null} contact - relation_states 通讯录 (可空)
 * @returns {Promise<string>} reply text (LLM render). null = LLM 调用全失败 (caller fallback).
 */
export async function render(peer, msg, stateSnapshot, profile, contact) {
  const stateBlock = _formatState(stateSnapshot);
  const profileBlock = _formatProfile(profile, contact);
  const systemAppend = [profileBlock, stateBlock].filter(Boolean).join('\n\n');

  const message = await _callLlm(
    [{ role: 'user', content: msg }],
    { peer, turn: 'broker-v2', systemAppend },
    { systemPrompt: SYSTEM_PROMPT, tools: TOOLS },
  );

  if (!message) return null;

  // tool_calls 写 state (parser 漏的字段 LLM 兜底)
  for (const call of message.tool_calls || []) {
    let args;
    try { args = JSON.parse(call.function?.arguments || '{}'); } catch { continue; }
    const name = call.function?.name;
    try {
      if (name === 'set_qty' && args.qty != null) state.setField(peer, 'qty', args.qty);
      else if (name === 'set_chain' && args.chain) state.setField(peer, 'pay_chain', args.chain);
      else if (name === 'set_address' && args.addr) state.setField(peer, 'pay_address', args.addr);
      else if (name === 'set_asset' && args.asset) state.setField(peer, 'asset', args.asset);
    } catch (e) {
      console.warn(`[broker-v2 llm] tool_call ${name} setField err: ${e.message}`);
    }
  }

  return message.content || '';
}

function _formatState(s) {
  if (!s) return '';
  const lines = ['# 当前订单 state (user 已给字段)'];
  if (s.side) lines.push(`方向=${s.side === 'sell_kas' ? '卖' : '买'}`);
  if (s.qty != null && s.qty !== 'NULL') lines.push(`qty=${s.qty}`);
  if (s.asset) lines.push(`asset=${s.asset}`);
  if (s.pay_chain) lines.push(`chain=${s.pay_chain}`);
  if (s.pay_address) lines.push(`pay_address=${s.pay_address}`);
  if (s.state) lines.push(`phase=${s.state}`);
  return lines.length > 1 ? lines.join('\n') : '';
}

function _formatProfile(profile, contact) {
  if (!profile && !contact) return '';
  const lines = ['# 用户画像 (历史)'];
  if (contact?.their_alias) lines.push(`alias=${contact.their_alias}`);
  if (contact?.classification) lines.push(`分级=${contact.classification}`);
  if (profile?.preferred_chain) lines.push(`偏好链=${profile.preferred_chain}`);
  if (profile?.preferred_pay_address) lines.push(`常用收款=${profile.preferred_pay_address}`);
  if (profile?.distilled_summary) lines.push(`画像=${profile.distilled_summary.slice(0, 200)}`);
  return lines.length > 1 ? lines.join('\n') : '';
}
