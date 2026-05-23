// ════════════════════════════════════════════════════════════════
// broker-v3/index.js — 路 A deterministic 选择题 broker exports
//
// Spec: docs/INVARIANTS-broker-dual-path-v0.4.md (v0.6 iterate per NWT r225)
// Lock: NWT r217-r225 architect cross-hat + Owner 5/6 钦定
//
// 路 A (broker-v3) = deterministic state machine, 0 LLM, 选择题菜单, mass user 默认.
// 路 B (matcher) = LLM 意图, agent-mind reactive Skill, power user 自然语言.
// 共用底层: /api/exchange/* protocol layer + state machine + retail_dex_orders.
//
// dispatch entry: conversations.js POST /api/agent/reply 看 BROKER_V3_ENABLED env flag
// (类 BROKER_V2_ENABLED 同 pattern). user input 自然语言 → fallback 路 B matcher.
// ════════════════════════════════════════════════════════════════

export { handleMessage } from './router.js';
