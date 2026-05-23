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

// Corpus query (B1.3 +15 LOC per Bettor r113 §5, J1 #205 思路 H upgrade):
//   Find similar resolved markets in historical_resolutions (v108) via keyword overlap.
//   Returns { sample_size, yes_rate, match_mode: 'and'|'or' } OR null if no match.
//   J1 #202 empirical: OR-match dilutes super-tail entity signal (Australia OR Eurovision
//   yes_rate=15.0% noisy). AND-match entity intersection grounded even at sample=1
//   (exact-entity match like "Australia win Eurovision 2024" → "Australia win Eurovision 2026").
//   思路 H sample threshold per match_mode in reasoner caller (AND ≥ 1, OR ≥ 10).
function queryCorpus(question) {
  if (!question) return null;
  try {
    const keywords = question.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 4 && !['will', 'before', 'after', 'during', 'between'].includes(w))
      .slice(0, 5);
    if (keywords.length < 2) return null;
    const params = keywords.map(k => `%${k}%`);
    // AND-mode first (entity intersection — high specificity)
    const andSql = keywords.map(() => 'LOWER(question) LIKE ?').join(' AND ');
    const andRows = sqlite.prepare(
      `SELECT question, final_yes FROM historical_resolutions WHERE ${andSql} LIMIT 30`
    ).all(...params);
    if (andRows.length >= 1) {
      const yesCount = andRows.filter(r => Number(r.final_yes) === 1).length;
      return { sample_size: andRows.length, yes_rate: yesCount / andRows.length, match_mode: 'and' };
    }
    // OR-mode fallback (broader, but diluted — need ≥ 10 for confidence)
    const orSql = keywords.map(() => 'LOWER(question) LIKE ?').join(' OR ');
    const orRows = sqlite.prepare(
      `SELECT question, final_yes FROM historical_resolutions WHERE ${orSql} LIMIT 30`
    ).all(...params);
    if (orRows.length < 10) return null;
    const yesCount = orRows.filter(r => Number(r.final_yes) === 1).length;
    return { sample_size: orRows.length, yes_rate: yesCount / orRows.length, match_mode: 'or' };
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
  // 思路 H corpus-primary fallback (J1 #205, Owner 5/15 "干吧!" + Bettor r131): when enricher null,
  // promote queryCorpus from sanity supplement to primary signal (sample-size + match_mode gated).
  // corpus base rate IS chain truth (resolved Polymarket markets v108), NOT LLM闭门估 — does
  // not violate Owner invariant 1 (闭门估 = LLM without data, FORBIDDEN; corpus = grounded historical).
  if (!enrichedData?.fundamentals) {
    const corpus = queryCorpus(question);
    if (corpus && corpus.match_mode === 'and' && corpus.sample_size >= 1) {
      return { estimate: corpus.yes_rate, confidence: 0.25, sources: [], reasoning: `corpus_and base rate ${(corpus.yes_rate*100).toFixed(0)}% (n=${corpus.sample_size}, exact-entity intersection)`, corpus, fund_source: 'corpus_and' };
    }
    if (corpus && corpus.match_mode === 'or' && corpus.sample_size >= 10) {
      return { estimate: corpus.yes_rate, confidence: 0.15, sources: [], reasoning: `corpus_or base rate ${(corpus.yes_rate*100).toFixed(0)}% (n=${corpus.sample_size}, broad keyword overlap)`, corpus, fund_source: 'corpus_or' };
    }
    return { estimate: null, confidence: 0, sources, reasoning: 'no enriched fundamentals + no corpus match (Owner invariant 1)' };
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
    fund_source: 'enricher',
  };
}

export const __testing = { sourceQuality, queryCorpus, parseLlmJson, SYSTEM_PROMPT, PRIMARY_DOMAINS, SANITY_DOMAINS };
