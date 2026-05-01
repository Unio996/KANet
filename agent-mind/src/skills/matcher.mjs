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
