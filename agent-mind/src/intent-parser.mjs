/**
 * Intent Parser — passive intent registry.
 *
 * Does NOT scan directories. Receives intents via registerIntents() from registry.mjs.
 * parseIntent(input) → { intent, params, config } or { intent: null }
 * Threshold: score < 0.15 → miss → falls through to Brain.
 */

const INTENTS = {};
const EXECUTORS = {};

const ACTIVE_CATEGORIES = new Set(['query', 'execute', 'trigger', 'reputation']);

/**
 * Register intents from a skill package.
 * Called by registry.mjs during autoDiscover().
 */
export function registerIntents(intents, skillId, executor) {
  for (const [name, cfg] of Object.entries(intents)) {
    if (cfg.params) {
      cfg.params = cfg.params.map(p => ({
        ...p,
        regex: p.regex || new RegExp(p.pattern, p.flags || ''),
      }));
    }
    cfg._skillId = skillId;
    INTENTS[name] = cfg;
  }
  if (executor) EXECUTORS[skillId] = executor;
}

/**
 * Get the executor module for a skill.
 */
export function getExecutor(skillId) {
  return EXECUTORS[skillId] || null;
}

/**
 * Get count of registered intents.
 */
export function getIntentCount() {
  return Object.keys(INTENTS).length;
}

/**
 * Enable additional intent categories at runtime.
 */
export function enableCategories(...cats) {
  for (const c of cats) ACTIVE_CATEGORIES.add(c);
}

/**
 * Check sender permission for an intent category.
 * Execute intents: owner only. Trusted: query only. Stranger: public queries only.
 * Silent deny = no error returned (avoid probe detection).
 */
export function checkPermission(senderRelation, category) {
  if (senderRelation === 'blocked') return 'deny';
  if (senderRelation === 'owner') return 'allow';
  // trusted / sibling / recommended — query OK, execute denied
  if (['trusted', 'sibling', 'recommended'].includes(senderRelation)) {
    if (category === 'execute') return 'silent_deny';
    return 'allow';
  }
  // stranger / normal / unknown
  if (category === 'query') return 'allow';
  return 'silent_deny';
}

/**
 * Parse user input into an intent + extracted params.
 */
export function parseIntent(input, options = {}) {
  // Guard: skip intent matching on query_card JSON responses to prevent ping-pong loops
  // (Agent A responds with query_card → Agent B's parser matches keywords in the JSON → infinite loop)
  if (input && /^\s*\{/.test(input) && input.includes('"type"')) {
    return { intent: null, params: {}, config: null };
  }

  const enabled = options.enabledCategories || ACTIVE_CATEGORIES;
  let best = { intent: null, score: 0, hits: 0, config: null };

  // ── Phase 1: 提取结构化数据（地址、金额、订单号）──
  const extracted = {};
  for (const [name, cfg] of Object.entries(INTENTS)) {
    for (const p of (cfg.params || [])) {
      const match = input.match(p.regex);
      if (match) extracted[p.name] = match[1];
    }
  }

  // ── Phase 2: execute/trigger 类 — 只在提取到关键参数时才匹配 ──
  // 这是唯一允许跳过 Brain 的场景：消息里有明确的结构化指令
  for (const [name, cfg] of Object.entries(INTENTS)) {
    if (!enabled.has(cfg.category)) continue;
    if (cfg.category !== 'execute' && cfg.category !== 'trigger') continue;

    // execute 类必须提取到至少一个参数才匹配
    const params = {};
    let paramHits = 0;
    for (const p of (cfg.params || [])) {
      if (extracted[p.name]) { params[p.name] = extracted[p.name]; paramHits++; }
    }

    // 无参数的 execute/trigger：需要 ≥1 个长关键词（≥4字）精确命中
    if (paramHits === 0) {
      const longHits = cfg.keywords.filter(kw => kw.length >= 4 && input.includes(kw));
      if (longHits.length === 0) continue;
    }

    // 至少一个关键词命中
    const kwHits = cfg.keywords.filter(kw => input.includes(kw)).length;
    if (kwHits === 0) continue;

    return { intent: name, params, config: cfg };
  }

  // ── Phase 3: query 类 — 关键词匹配但门槛更高 ──
  // query 类不跳过 Brain（Brain 会看到数据），误触代价低，但仍要求合理置信度
  for (const [name, cfg] of Object.entries(INTENTS)) {
    if (!enabled.has(cfg.category)) continue;
    if (cfg.category === 'execute' || cfg.category === 'trigger') continue;

    const matchedKws = cfg.keywords.filter(kw => input.includes(kw));
    if (matchedKws.length === 0) continue;

    // 要求：至少一个 ≥3 字的关键词命中
    const meaningfulHits = matchedKws.filter(kw => kw.length >= 3);
    if (meaningfulHits.length === 0) continue;

    const score = matchedKws.reduce((s, kw) => s + (kw.length >= 4 ? 2 : 1.5), 0);
    if (score > best.score) {
      best = { intent: name, score, hits: matchedKws.length, config: cfg };
    }
  }

  if (best.hits === 0) {
    return { intent: null, params: {}, config: null };
  }

  // 提取 query 的参数
  const params = {};
  for (const p of (best.config.params || [])) {
    if (extracted[p.name]) params[p.name] = extracted[p.name];
  }

  return { intent: best.intent, params, config: best.config };
}

/**
 * Build formatHint based on dimensions.
 */
export function getFormatHint(dimensions) {
  if (dimensions === 'single') return '格式：一句话，包含精确数值。';
  if (dimensions === 'multi')  return '格式：先列关键数字，再给一句总体判断。';
  return '';
}
