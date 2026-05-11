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
// bug 1 fix (J2 r6 standalone test 暴 hallucinate fake price $0.0525 vs $0.032 real):
// fetchKasPrice 注入 SYSTEM_PROMPT 让 LLM 见 actual market price, 不 hallucinate.
import { fetchKasPrice } from '../market-seeder.js';

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
- 资产 phase 1 默认 KAS (不需 set_asset tool)

# 严禁
- 不调 set_qty 设 user 没说的数量 (e.g. 默认 100)
- 不在用户回 'YES, X?' (复合 intent) 时把 confirm 当 hello
- 不重复问 user 已经说过的字段
- 不 hallucinate fake address / fake price / fake tx hash

# 询问地址措辞铁律 (T-J2-2026-04-30 L5a — Owner 真测撞 self-deal 误用)
当 user 缺 EVM 地址 (sell_kas/buy USDT/buy USDC 时), 询问必显式:
// lint-allow-r29: PZ-R29-T3 ask-addr 措辞 → ask_recv_address(side, chain) generator tool refactor
- '请回**你自己的** EVM 钱包地址 (0x... 42 位)' — 强调 '你自己的'
- 如 SELL: 加 '我代发 USDT 到这里. **不要给 broker 或别人的地址** (确保是你自己的钱包)'
- 如 BUY stable: 加 '收 USDT/USDC 到这里. **必须是你自己的**, 不是 maker/broker 的'
// lint-allow-r29: PZ-R29-T3 ask-addr 措辞 → ask_recv_address(side, chain) generator tool refactor
- 严禁仅说 '收款地址' 或 '请回 EVM 地址' (Owner 真测困惑 'Kas 哪里有 EVM' + 误 copy broker 自己 BSC addr)
- R4 self-deal SQL guard: SELL path post-publish 兜底 (broker-intake-watcher.js:158-176 KAS 已收后退回) + BUY path pre-publish 早拦 (broker-v2/router.js confirm+publish 之前 reject), 双 path consistent (T-J2-2026-05-05 r211 ship). UX 层 ask 文案显式让 user 知道差异

# KANet broker 非托管说明 (用户问 broker 怎 custody / 安全 / 持币 / 拿钱 等)
broker-v2 SELL 路径: user 转 KAS 给 broker (Kaspa 链上 escrow, 30min TTL), broker 帮 user 挂限价卖单, taker 来接 partial fill 付 USDT 直接到 user EVM addr (broker 不碰 USDT).
broker-v2 BUY 路径: user 直接付 USDT 到 maker EVM addr (broker 自挂 maker 也是同 logic — broker 收款后 deliver KAS 给 user). broker 永不持有 user USDT.
关键: USDT non-custodial (broker 不碰用户 USDT), KAS short-term escrow (Kaspa 没 smart contract, broker 收 user KAS 30min TTL + 5min grace + auto refund 控制 risk).
// lint-allow-r29: PZ-R29-T2 non-custodial → explain_non_custodial() generator tool refactor
回应 user 'broker 安全吗 / 怎么 custody' 必如下: "broker 不持币不托管. USDT 直付 maker, 我永远不碰你的钱. SELL 时 broker 暂收 KAS 30min, 没 taker 接自动退回."

# T-J2-2026-05-11 ABE-close B.2 (Owner 5/11 钦定 deterministic verify):
# user 问 broker 安全 / custody / 持币 / 拿钱 / 跑路 / 钱去哪 等任何 trust/safety 问题:
# - 严禁仅复读 preview (preview 不答 trust 问题)
# - 回复必字面含 '不托管' OR '不持币' OR '不碰' 任一 (LLM verbose 时不允省略 trust 核心 phrase)
# - 回复必字面含 '直付 maker' OR '直接付' OR 'maker 直收' (USDT non-custodial path explicit)
# 此 directive verbatim, 不允 paraphrase。production 用户体验 + cron test deterministic 双重保障。

# Paid 信号铁律 (NWT a3334737 Critical 1 fix)
如 user 提到付款相关 ("转了" / "付了" / "已付" / "已支付" / "paid" / "已转" / "付钱" / "钱到了" / "付款" 等):
- 严禁 hallucinate "✓ 已收到付款 / 已确认 / 已查到 / 验证成功"
- 如 user 提供 tx hash (0x... 64 hex) → 回 "好, 我立即查链上 ~30s 验证, 稍等"
- 如 user 没给 hash → 回 "麻烦发 tx hash 0x... 让我精确验证 (broker 也会自动监听 broker 钱包入账, 1-2min 内会有结果)"
真 verify 需 broker chain action (verifyPaymentForPeer / bsc-incoming-watcher) — broker LLM 不能自己 confirm.`;

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
  // set_asset tool 删除 — phase 1 hardcode KAS, retail_dex_orders 无 asset col.
  // phase 2 加 retail_dex_orders.give_asset col 后 re-add tool.
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
  // bug 1 v2 fix (NWT 接 J2 r21 092f76b7 propose, J2 r22 router 顺序确认):
  // 旧 priceBlock 双向暴露 (含 '卖价' + '收购价' + '用户买 KAS' + '用户卖 KAS') → Qwen 透传 '卖' to BUY-context reply
  // → mind_changer T1 / owner_88kas_verbatim 等 6 case FAIL.
  // 修: priceBlock 仅注当 turn direction 报价, 严禁 cross-direction 词. side 来自 router post-setField re-fetch
  // (router L178 draft = state.getActiveDraft post seedDraft+setField, 当 turn 即时 side, 不 lag).
  // direction 词选: BUY 用 '报价' (无 卖 字) / SELL 用 '收购价' (无 买 字) / 无 direction 用 'mid_price' (中性).
  // fetchKasPrice failure (8 CEX 全 down) → priceBlock empty, LLM 服 SYSTEM_PROMPT '不知道就说不知道'.
  let priceBlock = '';
  try {
    const p = await fetchKasPrice();
    if (p && p > 0) {
      const sideHint = stateSnapshot?.side;
      if (sideHint === 'sell_kas') {
        const buyPrice = (p * 0.99).toFixed(6);
        priceBlock = `# 当前 broker 收购价 (broker fetch 实时, 严禁编造)\n` +
                     `broker 收购价 = ${buyPrice} USDT/KAS\n` +
                     `如 user 问价, 仅引用此报价 (此订单 SELL 方向已锁, 不要 cross-quote 反向行情).`;
      } else if (sideHint === 'buy_kas') {
        const sellPrice = (p * 1.01).toFixed(6);
        priceBlock = `# 当前 broker 报价 (broker fetch 实时, 严禁编造)\n` +
                     `broker 报价 = ${sellPrice} USDT/KAS\n` +
                     `如 user 问价, 仅引用此报价 (此订单 BUY 方向已锁, 不要 cross-quote 反向行情).`;
      } else {
        priceBlock = `# 当前 KAS 中价 (broker fetch 实时, 严禁编造)\n` +
                     `mid_price = ${p.toFixed(6)} USDT/KAS\n` +
                     `用户尚未表态方向, 严禁帮用户决定方向.`;
      }
    }
  } catch (e) {
    console.warn(`[broker-v2 llm] fetchKasPrice err: ${e.message}`);
  }
  const systemAppend = [profileBlock, stateBlock, priceBlock].filter(Boolean).join('\n\n');

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
      // set_asset 删 — phase 1 hardcode KAS, no asset col
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
  // s.asset 删 — phase 1 hardcode KAS, no asset col (s.asset 永 undefined dead code)
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
