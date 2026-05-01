// agent-mind/src/skills/matcher.mjs
//
// 撮合官 (matcher) — KANet 上的 KAS / USDT 跨链撮合 Agent.
// class-based Skill, 走 registry.mjs:47-73 reactive free-form 路径 + base.mjs Skill base.
// LLM-driven intent extraction, 不走 keyword-based parseIntent (per MATCHER-ARCHITECTURE §4 + r109 verdict).
// HTTP API only data access via fetchJson(consoleUrl), 0 import sqlite (per r112 verdict, KANet skill convention 4 轴).
//
// T1 范围: listen + intent extract + 跟 user 对话, 不发 offer 不动钱.
// (T1.2 ship gatherContext / T1.3 extractIntent / T1.4 replyToUser / T1.5 装配)

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

export class MatcherSkill extends Skill {
  constructor() {
    super('matcher', '撮合官 — KANet 上的 KAS / USDT 跨链撮合 Agent (T1 仅 listen + intent extract, 不发 offer 不动钱)');
    this._senderAddress = '';
    this._inputMessage = '';
  }

  // 每 reactive message 命中 (LLM-driven free-form, keywords=[] 默认 _keywordsMatch pass-through)
  // 存 sender + input 给 gatherContext 用 (per mm-otc.mjs:51,62 convention)
  canActivate(taskType, context) {
    if (taskType !== 'reactive') return false;
    this._senderAddress = context?._senderAddress || '';
    this._inputMessage = context?._inputMessage || '';
    return true;
  }

  // T1.2 ship: KANet skill HTTP API convention (per r112 verdict, fetchJson via consoleUrl).
  // /api/agent/peer-context (conversations.js:524-598) 已 cover peer + chatHistory + recentBroadcasts + connectionStatus.
  // activeOrders defer T2 PZ-MATCHER-shipT2 (per MATCHER §C #5).
  async gatherContext(kernels, config) {
    if (!this._senderAddress) {
      return { peer: null, history: [], broadcasts: [], connectionStatus: null, metadata: { historyCount: 0, degraded: false } };
    }
    const consoleUrl = config?.consoleUrl || 'http://localhost:3100';
    const myAddress = config?.address || '';
    const url = `${consoleUrl}/api/agent/peer-context?my_address=${encodeURIComponent(myAddress)}&peer_address=${encodeURIComponent(this._senderAddress)}&limit=50`;
    try {
      const ctx = await fetchJson(url);
      const fullHistory = ctx.chatHistory || [];
      // safety net: > 6000 tokens trim 30 (per MATCHER §4.2 + audit-2 informed top peer 24h 44 dm = 1056 tokens)
      const totalChars = fullHistory.reduce((s, m) => s + (m.text || '').length, 0);
      const estimatedTokens = totalChars / 3;
      let history = fullHistory;
      let degraded = false;
      if (estimatedTokens > 6000) {
        history = fullHistory.slice(-30);
        degraded = true;
        console.warn(`[matcher] gatherContext degraded: peer=${this._senderAddress.slice(-12)} tokens=${estimatedTokens.toFixed(0)} trimmed_to=30`);
      }
      return {
        peer: ctx.peer || null,
        history,
        broadcasts: ctx.recentBroadcasts || [],
        connectionStatus: ctx.peer?.connectionStatus || null,
        metadata: { historyCount: history.length, degraded, estimatedTokens },
      };
    } catch (err) {
      console.warn(`[matcher] gatherContext fetchJson failed: ${err.message}`);
      return { peer: null, history: [], broadcasts: [], connectionStatus: null, metadata: { historyCount: 0, degraded: false, error: err.message } };
    }
  }

  // T1.3 ship: 调 KANet Adapter LLM (POST /reply) 提炼结构化 intent.
  // adapter pattern 同 mind.mjs:301-310 (mindSystem + mindUser + mindTask + brainCall).
  // Qwen Rule 11 kill switch 由 agent-adapter/src/providers/openai.mjs:238-242 自动 inject (model 含 'qwen' → chat_template_kwargs.enable_thinking=false), caller 不需手动加.
  async extractIntent(gathered, latestMessage, config) {
    const adapterUrl = config?.adapterUrl;
    if (!adapterUrl) {
      return _intentFallback(latestMessage, 'adapter_unavailable');
    }

    const historyText = (gathered.history || [])
      .map(m => `[${m.ts || ''}] ${m.dir === 'in' ? 'user' : 'matcher'}: ${m.text || ''}`)
      .join('\n') || '(no history)';
    const peerName = gathered.peer?.name || gathered.peer?.address?.slice(-12) || 'unknown';
    const trustLevel = gathered.peer?.trustLevel || 'normal';

    const mindUser = [
      `Peer: ${peerName} (trust=${trustLevel})`,
      '',
      '24h 对话历史:',
      historyText,
      '',
      `User 最新消息: ${latestMessage}`,
      '',
      '请提炼意图返回 JSON.',
    ].join('\n');

    let response;
    try {
      response = await fetchJson(`${adapterUrl}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peer: this._senderAddress, mindSystem: MATCHER_INTENT_SYSTEM, mindUser, mindTask: true }),
        brainCall: true,
      });
    } catch (err) {
      console.warn(`[matcher] extractIntent adapter call failed: ${err.message}`);
      return _intentFallback(latestMessage, 'adapter_error', err.message);
    }

    const replyText = response?.reply || '';
    let intent;
    try {
      // Strip markdown fence (LLM 偶尔包 ```json ... ```)
      const cleaned = replyText.replace(/^```(?:json)?\s*|\s*```\s*$/gs, '').trim();
      intent = JSON.parse(cleaned);
    } catch (err) {
      console.warn(`[matcher] extractIntent JSON parse failed: "${replyText.slice(0, 100)}"`);
      return _intentFallback(latestMessage, 'intent_unclear', null, true);
    }

    // side enum validation (per spec acceptance, defensive against LLM hallucination)
    if (!['buy', 'sell', 'query', 'cancel', 'none'].includes(intent.side)) {
      intent.side = 'none';
      intent.confidence = 'low';
    }
    return intent;
  }

  // T1.5 装配: gathered → extractIntent (T1.3) → generateReply → replyToUser (T1.4)
  formatForBrain(gathered) {
    return {
      name: this.name,
      description: this.description,
      data: gathered,
      instructions: '',
    };
  }
}

// matcher 撮合官 LLM persona + JSON schema (T1.3 inline prompt, per NWT r114 option i)
const MATCHER_INTENT_SYSTEM = [
  '你是 KANet 撮合官 (matcher), KAS / USDT 跨链撮合 Agent.',
  '',
  '任务: 从 user 消息提炼撮合意图, 返回严格 JSON. 不要任何 markdown wrapper 或解释文本.',
  '',
  'JSON schema:',
  '{',
  '  "side": "buy" | "sell" | "query" | "cancel" | "none",',
  '  "asset": "KAS" | "USDT" | null,',
  '  "qty": <number> | null,',
  '  "qty_unit": "KAS" | "USDT" | null,',
  '  "pay_chain": "BSC" | "ETH" | "POLYGON" | "TRON" | "SOL" | "KASPA" | null,',
  '  "confidence": "high" | "medium" | "low",',
  '  "missing_fields": [<string array, 列出 user 还没说清的字段例如 price/qty/pay_chain>],',
  '  "raw_intent_text": "<user 原话不改>"',
  '}',
  '',
  '只返回 JSON 对象本身, 一个字符不多.',
].join('\n');

// T1.4 ship: generateReply 模板化生成 user-friendly reply (per intent state).
// 每条 reply 必含 "T1 验证阶段, 暂时不能完成实际撮合" disclaimer (per task §T1 verifications, 防 user 误解成交).
export function generateReply(intent) {
  const T1_DISCLAIMER = '\n\n(注意: 我目前在 T1 验证阶段, 暂时不能完成实际撮合.)';
  if (!intent || intent.side === 'none' || intent.confidence === 'low') {
    return '抱歉, 我没完全听懂你的意图. 能更具体说一下你想做什么交易吗? 例如 "我要用 50 USDT 买 KAS, 用 BNB 链付款".' + T1_DISCLAIMER;
  }
  if (intent.missing_fields && intent.missing_fields.length > 0) {
    const sideText = intent.side === 'buy' ? '购买' : intent.side === 'sell' ? '出售' : '了解';
    const assetText = intent.asset || '资产';
    return `我明白你想${sideText} ${assetText}. 还需要确认: ${intent.missing_fields.join(', ')}. 你能补充一下吗?` + T1_DISCLAIMER;
  }
  const qty = intent.qty != null ? `${intent.qty} ${intent.qty_unit || ''}` : '';
  const sideAction = intent.side === 'buy' ? `用 ${qty} 买入 ${intent.asset || ''}` : intent.side === 'sell' ? `卖 ${qty} 换 ${intent.asset || ''}` : `执行 ${intent.side}`;
  const chainText = intent.pay_chain ? `, 用 ${intent.pay_chain} 链` : '';
  return `好的, 我看到你想${sideAction}${chainText}. 已记录你的意图.` + T1_DISCLAIMER;
}

// T1.4 ship: ASCII safety (per ANTI-PATTERNS 陷阱 #3 + LLM 偶尔吐 unpaired surrogate).
export function ensureAsciiSafe(text) {
  if (!text) return '';
  return text.replace(/[\uD800-\uDFFF]/g, '').replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');
}

// T1.4 ship: 调 KANet ActionExecutor.executeOne 发 DM (不自造 send 路径, 不直碰 Relay).
// actionExecutor 由 caller (T1.5 handleListen) 注入 — kernels 5 个不含 action, executor 在 runner.mjs:25 instantiate.
// per spec acceptance "Mind 框架处理后续 (action_executor → relay IPC → 上链)".
export async function replyToUser(peerAddress, replyText, actionExecutor) {
  if (!peerAddress || !replyText || !actionExecutor?.executeOne) {
    return { ok: false, reason: 'replyToUser: missing required arg or actionExecutor lacks executeOne' };
  }
  const safeText = ensureAsciiSafe(replyText);
  return await actionExecutor.executeOne({
    type: 'send_message',
    target: peerAddress,
    message: safeText,
  });
}

function _intentFallback(latestMessage, missingTag, errMsg, parseError) {
  const result = {
    side: 'none', asset: null, qty: null, qty_unit: null, pay_chain: null,
    confidence: 'low', missing_fields: [missingTag],
    raw_intent_text: latestMessage,
  };
  if (errMsg) result._error = errMsg;
  if (parseError) result._parse_error = true;
  return result;
}
