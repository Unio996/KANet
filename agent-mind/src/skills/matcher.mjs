// agent-mind/src/skills/matcher.mjs
//
// 撮合官 (matcher) — KANet 上的 KAS / USDT 跨链撮合 Agent.
// class-based Skill, 走 registry.mjs:47-73 reactive free-form 路径 + base.mjs Skill base.
// LLM-driven intent extraction, 不走 keyword-based parseIntent (per MATCHER-ARCHITECTURE §4 + r109 verdict).
// HTTP API only data access via fetchJson(consoleUrl), 0 import sqlite (per r112 verdict, KANet skill convention 4 轴).
//
// T1 范围 (5/2 ship): listen + intent extract + 跟 user 对话, 不发 offer 不动钱.
// T2 范围 (5/3 ship): publishOffer to /api/exchange/publish + 反馈 user offer detail + stripMarkdown.

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

const CONSOLE_URL = process.env.KASIA_CONSOLE_URL || 'http://127.0.0.1:3100';

export class MatcherSkill extends Skill {
  constructor() {
    super('matcher', '撮合官 — KANet 上的 KAS / USDT 跨链撮合 Agent (T2 ship: 听懂 + 发 offer + 反馈关键节点)');
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
  async gatherContext(kernels, config) {
    // T1.5 装配 wire: 保存 config 给 formatForBrain 用 (Skill API formatForBrain 只接 gathered, 不接 kernels/config)
    this._config = config || {};
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

  // T2 wrapper: extractIntent extends T1 helper with publish trigger detection.
  // Per architect v1.3 Option Y refactor (T1 logic preserved in _extractIntentT1).
  async extractIntent(gathered, latestMessage, config) {
    const intent = await this._extractIntentT1(gathered, latestMessage, config);

    // T2: publish trigger
    intent.should_publish = this.shouldPublish(intent, gathered.history || []);
    if (intent.should_publish) {
      try {
        const offerResult = await this.publishOffer(intent);
        intent._offerResult = offerResult;
      } catch (err) {
        console.error('[matcher] publishOffer failed:', err.message);
        intent._offerResult = null;
        intent._publishError = err.message;
      }
    }
    return intent;
  }

  // T1 logic preserved as helper (per architect v1.3 Option Y refactor).
  // Adapter pattern 同 mind.mjs:301-310 (mindSystem + mindUser + mindTask + brainCall).
  // Qwen Rule 11 kill switch 由 agent-adapter/src/providers/openai.mjs:238-242 自动 inject.
  async _extractIntentT1(gathered, latestMessage, config) {
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
      const cleaned = replyText.replace(/^```(?:json)?\s*|\s*```\s*$/gs, '').trim();
      intent = JSON.parse(cleaned);
    } catch (err) {
      console.warn(`[matcher] extractIntent JSON parse failed: "${replyText.slice(0, 100)}"`);
      return _intentFallback(latestMessage, 'intent_unclear', null, true);
    }

    if (!['buy', 'sell', 'query', 'cancel', 'none'].includes(intent.side)) {
      intent.side = 'none';
      intent.confidence = 'low';
    }
    return intent;
  }

  // T2: publish trigger judgment (intent 完整 + user 同意 keywords)
  shouldPublish(intent, peerHistory) {
    if (intent.confidence !== 'high') return false;
    if (intent.side !== 'buy' && intent.side !== 'sell') return false;
    if (intent.missing_fields?.length > 0) return false;
    const recent = (peerHistory || []).slice(-5);
    // \b doesn't match CJK chars in JS regex — split ASCII (with \b) from CJK (literal)
    const agreeKw = /\b(ok|OK)\b|好|可以|确认|发吧|来吧|没问题/i;
    return recent.some(m => m.dir === 'in' && agreeKw.test(m.text || ''));
  }

  // T2: 算定价 (T2 简化, T3 加 mid_price 来源 market-data)
  computePricing(intent) {
    const MID = 0.04;
    if (intent.side === 'buy') {
      // user 买 KAS, matcher 给 KAS 收 USDT
      const want_amount = String(intent.qty);
      const give_amount = String(parseFloat(intent.qty) / MID);
      return {
        give_asset: 'KAS', give_amount, give_chain: 'kaspa',
        want_asset: intent.qty_unit === 'USDT' ? 'USDT' : (intent.asset || 'USDT'),
        want_amount,
        want_chain: intent.pay_chain || 'BSC',
      };
    }
    // sell: user 卖 KAS, matcher 收 KAS 给 USDT
    const give_amount = String(intent.qty);
    const want_amount = String(parseFloat(intent.qty) * MID);
    return {
      give_asset: intent.asset || 'KAS', give_amount, give_chain: 'kaspa',
      want_asset: 'USDT', want_amount,
      want_chain: intent.pay_chain || 'BSC',
    };
  }

  // T2: publishOffer 调 KANet /api/exchange/publish endpoint.
  // M1: relayNodeId required (NOT maker, derived server-side).
  // M2: expires_minutes (NOT expires_in_minutes).
  // M4: res.ok (NOT res.success). M5: res.broadcast_tx (NOT broadcast_tx_id).
  async publishOffer(intent) {
    if (intent.side !== 'buy' && intent.side !== 'sell') {
      throw new Error('publishOffer: invalid intent.side');
    }
    if (!intent.qty || !intent.asset) {
      throw new Error('publishOffer: missing qty/asset');
    }
    const relayNodeId = this._config?.relayNodeId;
    if (!relayNodeId) {
      throw new Error('publishOffer: this._config.relayNodeId missing');
    }
    const pricing = this.computePricing(intent);
    const consoleUrl = this._config?.consoleUrl || CONSOLE_URL;
    const payload = {
      relayNodeId,
      ...pricing,
      verification: 'cross_chain_tx',
      expires_minutes: 30,
    };
    const res = await fetchJson(`${consoleUrl}/api/exchange/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res?.ok || !res?.offer_id) {
      throw new Error(`publishOffer: KANet rejected: ${JSON.stringify(res)}`);
    }
    console.log(`[matcher] publishOffer ok offer=${res.offer_id} tx=${res.broadcast_tx}`);
    return {
      offer_id: res.offer_id,
      broadcast_tx: res.broadcast_tx,
      expires_at: res.expires_at,
      payload,
      success: true,
    };
  }

  // T2: 反馈 offer detail (KI-17 layer 3 反馈关键节点)
  generateOfferFeedback(intent, offerResult) {
    const { offer_id, payload } = offerResult;
    const offer_short = offer_id.slice(-8);
    if (intent.side === 'buy') {
      return [
        `好的, 我已经为你发布报价 #${offer_short}.`,
        ``,
        `📋 报价详情:`,
        `  - 你付: ${payload.want_amount} ${payload.want_asset} (${payload.want_chain})`,
        `  - 你收: ${payload.give_amount} ${payload.give_asset}`,
        `  - 有效期: 30 分钟`,
        ``,
        `💸 下一步:`,
        `  请向 broker 钱包付款 (具体地址 KANet 给出).`,
        `  付款后 matcher 自动 verify 跨链确认.`,
        ``,
        `⚠️ T2 阶段 — offer 已发布上链.`,
        `  跨链 verify + 发 KAS 是 T3 范围.`,
      ].join('\n');
    }
    return [
      `好的, 我已经为你发布卖单 #${offer_short}.`,
      ``,
      `📋 报价详情:`,
      `  - 你付: ${payload.give_amount} KAS`,
      `  - 你收: ${payload.want_amount} ${payload.want_asset} (${payload.want_chain})`,
      `  - 有效期: 30 分钟`,
      ``,
      `⚠️ T2 阶段 — 卖单已上链, 完整交割 T3 范围.`,
    ].join('\n');
  }

  // T2: stripMarkdown — KANet user 通过 Kasia / 手机 app, 不假设 markdown 渲染.
  // BugFix-Bot 5/3 audit catch: T1 LLM reply 7/25 含 **bold** literal 透出 (28%). KI-18 sediment.
  stripMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1')                              // **bold** → bold
      .replace(/(?<![\*\w])\*([^\*\n]+?)\*(?![\*\w])/g, '$1')        // *italic* → italic
      .replace(/^#+\s+/gm, '')                                       // # heading → heading (line start)
      .replace(/`([^`\n]+?)`/g, '$1')                                // `code` → code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');                      // [text](url) → text
  }

  // T2 wrapper: formatForBrain 1-arg signature (registry.mjs:160 兼容守, per NWT r153 reconciliation).
  // Implementer authoritative reconciliation: spec line 360 写 (intent, peerHistory) 2-arg, 但 registry 1-arg call.
  // Keep 1-arg, internally derive peerHistory + intent. Helper _formatForBrainT1 takes 2-arg per spec.
  async formatForBrain(gathered) {
    if (!gathered || !this._senderAddress) {
      return { name: this.name, description: this.description, data: { skipped: 'no_sender' }, instructions: '' };
    }
    const config = this._config || {};
    const peerHistory = gathered.history || [];
    const latestMessage = this._inputMessage || '';
    const intent = await this.extractIntent(gathered, latestMessage, config);

    let reply;
    if (intent._offerResult) {
      reply = this.generateOfferFeedback(intent, intent._offerResult);
    } else if (intent._publishError) {
      reply = `抱歉, 发布报价时出错了 (${intent._publishError}). 我会反馈给开发者. 你可以稍后再试.`;
    } else {
      reply = await this._formatForBrainT1(intent, peerHistory);
    }

    // v1.3 KI-18 sediment: strip markdown across all reply paths
    const cleanedReply = this.stripMarkdown(reply);

    return {
      name: this.name,
      description: this.description,
      data: {
        peer: gathered.peer,
        history_count: peerHistory.length,
        connectionStatus: gathered.connectionStatus,
        intent,
        suggestedReply: cleanedReply,                      // T1 test compat (data.suggestedReply assertion)
        offerResult: intent._offerResult || null,
        publishError: intent._publishError || null,
        degraded: gathered.metadata?.degraded || false,
      },
      instructions: cleanedReply,
    };
  }

  // T1 reply gen logic preserved as helper (per architect v1.3 Option Y refactor).
  // Receives pre-computed intent + peerHistory (peerHistory currently unused, kept per spec sig for future T3 history-aware reply).
  async _formatForBrainT1(intent, peerHistory) {
    return generateReply(intent);
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
