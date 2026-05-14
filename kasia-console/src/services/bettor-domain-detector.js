// Phase B Sub B1.1 — Domain detector for predictions market questions.
// Owner 5/14 17:00 hat 切 (Bettor architect+reviewer / J1 implementor). spec docs/bettor-phase-b-fundamental-enricher-spec.md §B1.1.
//
// detectDomain(question, description) → { domain, confidence, reasoning }
//   domain ∈ {sports, politics, economic, crypto, legal, other}
//   confidence ∈ [0, 1]
//
// Read-through cache to `bettor_domain_cache` (v109 migration) with per-domain TTL
// (Bettor r113 §2): sports 3600 / politics 86400 / economic 86400 / crypto 300 /
// legal 21600 / other 7200. Stale → refetch (Bettor r113 Q4 ack字面).
//
// Invariant 1 (Owner 14:50): LLM classify ONLY. Probability estimation 严格 forbidden here.
// Qwen Rule 11 (enable_thinking=false) honored via callLLMWithFallback tier3_llama.

import { sqlite } from '../db/client.js';
import { callLLMWithFallback } from './llm-fallback.js';

const DOMAINS = ['sports', 'politics', 'economic', 'crypto', 'legal', 'other'];

// Per-domain TTL in seconds (Bettor r113 §2)
const TTL_BY_DOMAIN = {
  sports: 3600,        // 1h — stats refresh fast
  politics: 86400,     // 24h — polls daily
  economic: 86400,     // 24h — macro indicators
  crypto: 300,         // 5min — on-chain volatile
  legal: 21600,        // 6h — court/regulatory cycles
  other: 7200,         // 2h — fallback
};

const SYSTEM_PROMPT = `You classify prediction market questions into exactly ONE category.
Categories: sports, politics, economic, crypto, legal, other.
You output ONLY a JSON object — no preamble, no explanation outside JSON.
Schema: {"domain": "<category>", "confidence": <float 0-1>, "reasoning": "<one sentence>"}
You DO NOT estimate the probability of YES/NO resolution here. Classification only.`;

function buildUserPrompt(question, description) {
  const desc = (description || '').slice(0, 800);
  return `Question: ${question}\nDescription: ${desc}\n\nOutput JSON:`;
}

function parseLlmJson(text) {
  if (!text) return null;
  // Strip markdown fences if any
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fence) s = fence[1];
  // Find first {...} block
  const obj = s.match(/\{[\s\S]*\}/);
  if (!obj) return null;
  try {
    const parsed = JSON.parse(obj[0]);
    if (!DOMAINS.includes(parsed.domain)) return null;
    const conf = Number(parsed.confidence);
    if (!Number.isFinite(conf) || conf < 0 || conf > 1) return null;
    return { domain: parsed.domain, confidence: conf, reasoning: String(parsed.reasoning || '').slice(0, 500) };
  } catch { return null; }
}

function readCache(marketId) {
  if (!marketId) return null;
  const row = sqlite.prepare(
    `SELECT domain, confidence, reasoning, ttl_seconds,
            CAST((julianday('now') - julianday(cached_at)) * 86400 AS INTEGER) AS age_seconds
     FROM bettor_domain_cache WHERE market_id = ?`
  ).get(marketId);
  if (!row) return null;
  if (row.age_seconds >= row.ttl_seconds) return null; // stale → refetch
  return { domain: row.domain, confidence: row.confidence, reasoning: row.reasoning, cached: true };
}

function writeCache(marketId, result) {
  if (!marketId) return;
  const ttl = TTL_BY_DOMAIN[result.domain] ?? TTL_BY_DOMAIN.other;
  sqlite.prepare(
    `INSERT INTO bettor_domain_cache (market_id, domain, confidence, reasoning, ttl_seconds, cached_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(market_id) DO UPDATE SET
       domain = excluded.domain,
       confidence = excluded.confidence,
       reasoning = excluded.reasoning,
       ttl_seconds = excluded.ttl_seconds,
       cached_at = excluded.cached_at`
  ).run(marketId, result.domain, result.confidence, result.reasoning, ttl);
}

export async function detectDomain(question, description, marketId = null, adapterUrl = null) {
  if (!question || typeof question !== 'string') {
    return { domain: 'other', confidence: 0, reasoning: 'empty question' };
  }
  // Cache hit
  if (marketId) {
    const cached = readCache(marketId);
    if (cached) return cached;
  }
  // LLM call
  const llm = await callLLMWithFallback({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(question, description),
    adapterUrl,
  });
  if (!llm.ok || !llm.text) {
    return { domain: 'other', confidence: 0, reasoning: `LLM fail: ${llm.error || 'empty'}` };
  }
  const parsed = parseLlmJson(llm.text);
  if (!parsed) {
    return { domain: 'other', confidence: 0, reasoning: `LLM unparsable: ${llm.text.slice(0, 200)}` };
  }
  if (marketId) writeCache(marketId, parsed);
  return parsed;
}

// Test helper — exposed for Tier 4 verification scripts.
export const __testing = { DOMAINS, TTL_BY_DOMAIN, parseLlmJson, SYSTEM_PROMPT };
