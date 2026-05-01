// agent-mind/src/skills/matcher.mjs
//
// 撮合官 (matcher) — KANet 上的 KAS / USDT 跨链撮合 Agent.
// class-based Skill, 走 registry.mjs:47-73 reactive free-form 路径 + base.mjs Skill base.
// LLM-driven intent extraction, 不走 keyword-based parseIntent (per MATCHER-ARCHITECTURE §4 + r109 verdict).
//
// T1 范围: listen + intent extract + 跟 user 对话, 不发 offer 不动钱.
// (T1.2 ship loadPeerContext / T1.3 extractIntent / T1.4 replyToUser / T1.5 装配)

import { Skill } from './base.mjs';

export class MatcherSkill extends Skill {
  constructor() {
    super('matcher', '撮合官 — KANet 上的 KAS / USDT 跨链撮合 Agent (T1 仅 listen + intent extract, 不发 offer 不动钱)');
  }

  // 每 reactive message 命中 (LLM-driven free-form, keywords=[] 默认 _keywordsMatch pass-through)
  canActivate(taskType, context) {
    return taskType === 'reactive';
  }

  // T1.2 ship loadPeerContext: 24h messages + identities + retail_dex_orders active + relation_states
  async gatherContext(kernels, config) {
    return {};
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
