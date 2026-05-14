// Phase B Sub B1.3 — Fundamental reasoner for predictions market questions.
// Owner 5/14 17:00 hat 切 (Bettor architect+reviewer / J1 implementor). spec docs/bettor-phase-b-fundamental-enricher-spec.md §B1.3.
//
// reasonFundamental(question, description, enrichedData, adapterUrl?)
//   → { estimate (0-1 OR null), confidence (0-1), sources, reasoning, facts?, corpus? }
//
// Owner invariant 1 (5/14 14:50 "稳一个字"): LLM grounded ONLY. enriched_data 空 → estimate=null.
// 严禁 base statistical fallback (Phase 3g Finland 2% 教训).
//
// Confidence formula (Bettor r113 §3 Q3 refined):
//   confidence = 0.5 × source_quality + 0.5 × LLM_self_rated
//   source_quality: TheSportsDB/ESPN/Wikipedia/FRED primary = 1.0, Polymarket sanity-only = 0.3, unknown = 0.5
//
// +15 LOC corpus query (Bettor r113 §3 Q5): historical_resolutions (v108 corpus) keyword overlap → base rate sanity
//   sample point. NOT a driver — appended to LLM prompt as 1 grounding source.

import { sqlite } from '../db/client.js';
import { callLLMWithFallback } from './llm-fallback.js';

const SYSTEM_PROMPT = `You analyze a prediction market question USING ONLY the provided grounded data.

Rules:
- You DO NOT speculate beyond the grounded data.
- If grounded data is empty/missing OR insufficient → output {"estimate": null, "confidence": 0, "facts": [], "reasoning": "no grounded data"}.
- DO NOT use generic priors, "I think", "I feel", or base statistical fallback.
- Cite specific facts from the grounded data only.

Output ONLY JSON, no preamble:
{
  "facts": ["fact 1 from grounded data", "fact 2", ...],
  "directions": [{"fact": "...", "direction": "YES|NO|neutral"}, ...],
  "estimate": <float in [0,1] OR null>,
  "confidence": <float in [0,1] — your self-rated confidence based on # and quality of facts cited>,
  "reasoning": "<one sentence summary>"
}`;

const PRIMARY_DOMAINS = ['thesportsdb.com', 'espn.com', 'wikipedia.org', 'fred.stlouisfed.org', 'polygonscan.com', 'etherscan.io'];
const SANITY_DOMAINS = ['polymarket.com', 'gamma-api.polymarket.com'];

function sourceQuality(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return 0;
  const scores = sources.map(url => {
    const u = String(url || '').toLowerCase();
    if (PRIMARY_DOMAINS.some(d => u.includes(d))) return 1.0;
    if (SANITY_DOMAINS.some(d => u.includes(d))) return 0.3;
    return 0.5; // unknown — moderate
  });
  return Math.max(...scores);
}

// Corpus query (B1.3 +15 LOC per Bettor r113 §5):
//   Find ≥3 similar resolved markets in historical_resolutions (v108) via keyword overlap.
//   Return { sample_size, yes_rate } OR null if too few matches.
//   NOT a driver — appended to LLM prompt as 1 grounding sanity-check.
function queryCorpus(question) {
  if (!question) return null;
  try {
    const keywords = question.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 4 && !['will', 'before', 'after', 'during', 'between'].includes(w))
      .slice(0, 5);
    if (keywords.length < 2) return null;
    const placeholders = keywords.map(() => 'LOWER(question) LIKE ?').join(' OR ');
    const params = keywords.map(k => `%${k}%`);
    const rows = sqlite.prepare(
      `SELECT question, final_yes FROM historical_resolutions WHERE ${placeholders} LIMIT 30`
    ).all(...params);
    if (rows.length < 3) return null;
    const yesCount = rows.filter(r => Number(r.final_yes) === 1).length;
    return { sample_size: rows.length, yes_rate: yesCount / rows.length };
  } catch { return null; }
}

function parseLlmJson(text) {
  if (!text) return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fence) s = fence[1];
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export async function reasonFundamental(question, description, enrichedData, adapterUrl = null) {
  const sources = Array.isArray(enrichedData?.sources) ? enrichedData.sources : [];
  // Hard invariant: no grounded data → null estimate (Owner pivot 14:50)
  if (!enrichedData?.fundamentals) {
    return { estimate: null, confidence: 0, sources, reasoning: 'no enriched fundamentals — abstain (Owner invariant 1)' };
  }
  // Corpus sanity (1 grounding point if ≥3 matches)
  const corpus = queryCorpus(question);
  const corpusNote = corpus
    ? `\n\nHistorical base rate (sanity only): ${(corpus.yes_rate * 100).toFixed(0)}% YES resolution on ${corpus.sample_size} similar resolved markets in corpus.`
    : '';
  const userPrompt = `Question: ${question}\nDescription: ${(description || '').slice(0, 400)}\n\nGrounded data:\n${enrichedData.fundamentals}${corpusNote}\n\nOutput JSON:`;
  const llm = await callLLMWithFallback({ system: SYSTEM_PROMPT, user: userPrompt, adapterUrl });
  if (!llm.ok || !llm.text) {
    return { estimate: null, confidence: 0, sources, reasoning: `LLM fail: ${llm.error || 'empty'}` };
  }
  const parsed = parseLlmJson(llm.text);
  if (!parsed) {
    return { estimate: null, confidence: 0, sources, reasoning: `LLM unparsable: ${llm.text.slice(0, 200)}` };
  }
  // Validate estimate: null OR finite [0,1]
  let estimate = null;
  if (parsed.estimate !== null && parsed.estimate !== undefined) {
    const e = Number(parsed.estimate);
    if (Number.isFinite(e) && e >= 0 && e <= 1) estimate = e;
  }
  if (estimate === null) {
    return { estimate: null, confidence: 0, sources, reasoning: parsed.reasoning || 'LLM returned null estimate', facts: parsed.facts || [] };
  }
  // Confidence: 0.5 × source_quality + 0.5 × LLM_self_rated (Bettor r113 §3 Q3 refined)
  const llmConf = Number(parsed.confidence);
  const llmRated = (Number.isFinite(llmConf) && llmConf >= 0 && llmConf <= 1) ? llmConf : 0.5;
  const srcQ = sourceQuality(sources);
  const confidence = 0.5 * srcQ + 0.5 * llmRated;
  return {
    estimate,
    confidence,
    sources,
    reasoning: String(parsed.reasoning || '').slice(0, 500),
    facts: Array.isArray(parsed.facts) ? parsed.facts.slice(0, 20) : [],
    corpus: corpus || null,
  };
}

export const __testing = { sourceQuality, queryCorpus, parseLlmJson, SYSTEM_PROMPT, PRIMARY_DOMAINS, SANITY_DOMAINS };
