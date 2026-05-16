// Phase B Sub B5 — Fundamental Enricher (Owner 5/16 钦定 + Bettor r156-r157 spec consensus 9/9 ACK).
// LLM 结构因子分析 — middle-tier hit recs (0.30-0.45 ∪ 0.55-0.70, skip coin-flip ±5pp around 50/50).
// Wikipedia REST API /page/summary lead paragraph + Qwen3.6 local llama-server (QWEN Rule 11
// chat_template_kwargs.enable_thinking=false). Structured JSON output preferred (regex fallback).
// 24h Wikipedia cache via v115 bettor_wiki_cache. Prompt injection sanitize (200 char + strip ctrl).
// Async Promise.all max 3 parallel (RTX 5090 VRAM safety).
// Dev-alert on 3 consecutive llm fails (systemic problem signal).

import { sqlite } from '../db/client.js';

const ENRICHER_TIER_LOW_MIN = 0.30;
const ENRICHER_TIER_LOW_MAX = 0.45;
const ENRICHER_TIER_HIGH_MIN = 0.55;
const ENRICHER_TIER_HIGH_MAX = 0.70;
const WIKI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const LLAMA_SERVER_URL = process.env.LLAMA_SERVER_URL || 'http://127.0.0.1:8088';
const MODEL_NAME = process.env.QWEN_MODEL || 'qwen3.6';
const LLM_TIMEOUT_MS = 60_000;
const MAX_PARALLEL = 3;

let _consecutiveLlmFails = 0;

export function isMiddleTier(yesPrice) {
  if (!Number.isFinite(yesPrice)) return false;
  return (yesPrice >= ENRICHER_TIER_LOW_MIN && yesPrice <= ENRICHER_TIER_LOW_MAX)
      || (yesPrice >= ENRICHER_TIER_HIGH_MIN && yesPrice <= ENRICHER_TIER_HIGH_MAX);
}

// Bettor r157 §2 (g) — sanitize for prompt injection (200 char + ctrl strip + backtick)
function sanitizeForPrompt(text) {
  if (!text) return '';
  return String(text)
    .slice(0, 200)
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/`/g, "'");
}

function extractEntity(question) {
  if (!question) return null;
  const text = String(question).toLowerCase();
  const m = text.match(/^will\s+([a-z][a-z\s]+?)\s+(win|be\s+in|top|defeat|finish|reach)/);
  if (m) return m[1].trim();
  const stopwords = new Set(['will', 'the', 'and', 'or', 'in', 'on', 'of', 'to', 'for', 'with', 'this', 'that', 'be', 'by', 'a', 'an']);
  const tokens = text.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 3 && !stopwords.has(t));
  return tokens.sort((a, b) => b.length - a.length)[0] || null;
}

async function fetchWikipediaSummary(entity) {
  if (!entity) return null;
  try {
    const cached = sqlite.prepare(`SELECT summary, fetched_at FROM bettor_wiki_cache WHERE entity = ?`).get(entity);
    if (cached) {
      const ageMs = Date.now() - new Date(cached.fetched_at).getTime();
      if (ageMs < WIKI_CACHE_TTL_MS) return cached.summary;
    }
    const slug = entity.replace(/\s+/g, '_');
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'KANet-bettor-enricher/1.0' } });
    if (!res.ok) return null;
    const data = await res.json();
    const summary = data?.extract || null;
    if (summary) {
      try {
        sqlite.prepare(`INSERT OR REPLACE INTO bettor_wiki_cache (entity, summary, fetched_at) VALUES (?, ?, datetime('now'))`).run(entity, summary);
      } catch { /* ignore cache write fail */ }
    }
    return summary;
  } catch { return null; }
}

function buildPrompt(rec, entity, wikiSummary, hit) {
  return `分析 Polymarket 单子结构因子:
市场: ${sanitizeForPrompt(rec.question)}
当前价: ${(hit * 100).toFixed(1)}% (隐含概率)
实体: ${sanitizeForPrompt(entity || 'unknown')}
Wikipedia 摘要: ${sanitizeForPrompt(wikiSummary || 'N/A').slice(0, 400)}

请输出 strict JSON only (no markdown fences):
{
  "historical_base_rate_pct": <0-100 numeric, 该实体过去类似事件成功率>,
  "structural_factors": "<≤80 字 结构因子摘要 (位置/邻位/外部环境/制作组等)>",
  "implied_pct": ${(hit * 100).toFixed(1)},
  "fair_pct": <0-100 numeric, 你估的合理概率>,
  "edge_pp": <numeric (fair_pct - implied_pct), 可正可负>,
  "verdict": "<under-price|over-price|fair>",
  "confidence": <0-1 numeric>
}`;
}

async function callLlm(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${LLAMA_SERVER_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.2,
        chat_template_kwargs: { enable_thinking: false },  // QWEN Rule 11
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseLlmJsonOrRegex(text, hit) {
  if (!text) return null;
  // Strip fences if present
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fence) s = fence[1];
  // JSON parse first
  const jsonMatch = s.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const p = JSON.parse(jsonMatch[0]);
      const fair = Number(p.fair_pct);
      if (Number.isFinite(fair) && fair >= 0 && fair <= 100) {
        return {
          estimate: fair / 100,
          edge_pp: Number.isFinite(Number(p.edge_pp)) ? Number(p.edge_pp) : (fair - hit * 100),
          verdict: p.verdict || 'unknown',
          confidence: Number.isFinite(Number(p.confidence)) ? Math.max(0, Math.min(1, Number(p.confidence))) : 0.5,
          structural_factors: String(p.structural_factors || '').slice(0, 200),
          historical_base_rate_pct: Number.isFinite(Number(p.historical_base_rate_pct)) ? Number(p.historical_base_rate_pct) : null,
        };
      }
    } catch { /* fall through to regex */ }
  }
  // Regex fallback
  const edgeMatch = s.match(/([+\-]?\d+(?:\.\d+)?)\s*(?:pp|%|百分点)\s*edge/i);
  const verdictMatch = s.match(/\b(under-price|over-price|fair)\b/i);
  if (edgeMatch) {
    const edgePp = parseFloat(edgeMatch[1]);
    const fairPct = hit * 100 + edgePp;
    return {
      estimate: Math.max(0.01, Math.min(0.99, fairPct / 100)),
      edge_pp: edgePp,
      verdict: verdictMatch ? verdictMatch[1].toLowerCase() : 'unknown',
      confidence: 0.4,  // regex fallback lower confidence
      structural_factors: s.slice(0, 200),
      historical_base_rate_pct: null,
    };
  }
  return null;
}

export async function enrichRec(rec) {
  const yes = Number(rec.yes_price);
  if (!isMiddleTier(yes)) {
    return { skipped: true, reason: 'outside_middle_tier' };
  }
  const entity = extractEntity(rec.question);
  const wikiSummary = entity ? await fetchWikipediaSummary(entity) : null;
  const prompt = buildPrompt(rec, entity, wikiSummary, yes);
  const llmText = await callLlm(prompt);
  if (!llmText) {
    _consecutiveLlmFails++;
    if (_consecutiveLlmFails === 3) {
      console.error('[fundamental-enricher] DEV-ALERT: 3 consecutive LLM fails — llama-server may be down OR rate limited');
    }
    return { skipped: true, reason: 'llm_fail', llm_fails_streak: _consecutiveLlmFails };
  }
  _consecutiveLlmFails = 0;
  const parsed = parseLlmJsonOrRegex(llmText, yes);
  if (!parsed) {
    return { skipped: true, reason: 'parse_fail', llm_text: llmText.slice(0, 200) };
  }
  return {
    skipped: false,
    estimate: parsed.estimate,
    confidence: parsed.confidence,
    sources: ['wikipedia:' + (entity || 'none'), 'llm:qwen3.6'],
    reasoning: `${parsed.verdict} edge ${parsed.edge_pp >= 0 ? '+' : ''}${parsed.edge_pp?.toFixed(1)}pp · base ${parsed.historical_base_rate_pct ?? 'n/a'}% · ${parsed.structural_factors}`.slice(0, 500),
    edge_pp: parsed.edge_pp,
    verdict: parsed.verdict,
  };
}

// Bettor r157 §1 (e) — async Promise.all max 3 parallel for middle-tier candidates
export async function enrichBatch(recs) {
  const middleTier = (recs || []).filter(r => isMiddleTier(Number(r.yes_price)));
  if (middleTier.length === 0) return [];
  const out = [];
  for (let i = 0; i < middleTier.length; i += MAX_PARALLEL) {
    const chunk = middleTier.slice(i, i + MAX_PARALLEL);
    const results = await Promise.all(chunk.map(r => enrichRec(r).catch(e => ({ skipped: true, reason: 'exception', error: e.message }))));
    for (let j = 0; j < chunk.length; j++) {
      out.push({ rec: chunk[j], result: results[j] });
    }
  }
  return out;
}

export const __testing = { isMiddleTier, sanitizeForPrompt, extractEntity, parseLlmJsonOrRegex, buildPrompt, enrichRec, enrichBatch };
