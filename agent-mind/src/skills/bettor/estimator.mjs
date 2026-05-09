/**
 * Probability estimator — LLM-driven.
 *
 * Returns p_low/mid/high + sigma + info-gap, given parsed rule + injected llm.
 * Caller wires real LLM (GLM4.7 / Qwen / Opus). Tests inject stub.
 *
 * Info gap is measured: latest embedded fact date − trainingCutoff.
 * (If rule mentions an April 7, 2026 event and your data ends Jan 31, gap = ~2.2 months.)
 */

import { latestEmbeddedDate } from './rule-parser.mjs';

const PROMPT_TEMPLATE = `You are a calibrated forecaster for prediction markets.

Estimate probability that this market resolves YES. Consider:
- specific resolution language and disqualifiers
- base rates for similar events
- time remaining vs typical event timelines
- explicit reasons for uncertainty

RULE TEXT:
{{ruleText}}

PARSED FIELDS:
- YES conditions: {{yesConditions}}
- Disqualifiers: {{disqualifiers}}
- Embedded facts: {{embeddedFacts}}
- Resolution sources: {{resolutionSources}}
- Time window: {{timeWindow}}

Output STRICT JSON only, no commentary, no markdown fences:
{
  "pLow": <number 0-1, conservative lower bound>,
  "pMid": <number 0-1, central estimate>,
  "pHigh": <number 0-1, optimistic upper bound>,
  "sigma": <number, std dev of estimate>,
  "reasoning": "<1-2 sentence rationale>"
}`;

function fillTemplate(rule, parsed) {
  return PROMPT_TEMPLATE
    .replace('{{ruleText}}', rule)
    .replace('{{yesConditions}}', JSON.stringify(parsed?.yesConditions || []))
    .replace('{{disqualifiers}}', JSON.stringify(parsed?.disqualifiers || []))
    .replace('{{embeddedFacts}}', JSON.stringify(parsed?.embeddedFacts || []))
    .replace('{{resolutionSources}}', JSON.stringify(parsed?.resolutionSources || []))
    .replace('{{timeWindow}}', parsed?.timeWindow || 'none');
}

function stripFences(text) {
  return String(text).replace(/```(?:json)?\s*/gi, '').replace(/```\s*$/g, '').trim();
}

function computeInfoGapMonths(parsed, trainingCutoff) {
  if (!trainingCutoff) return 0;
  const cutoff = new Date(trainingCutoff);
  if (Number.isNaN(cutoff.getTime())) return 0;
  const latest = latestEmbeddedDate(parsed);
  if (!latest) return 0;
  const gapMs = latest.getTime() - cutoff.getTime();
  return Math.max(0, gapMs / (1000 * 60 * 60 * 24 * 30.44));
}

/**
 * @param {object} input
 * @param {string} input.ruleText
 * @param {object} input.parsed - output of parseRule
 * @param {string|Date} [input.trainingCutoff]
 * @param {Function} input.llm - async (prompt) => string
 */
export async function estimateP({ ruleText, parsed, trainingCutoff, llm }) {
  if (typeof llm !== 'function') {
    throw new Error('estimateP requires an llm callable');
  }

  const prompt = fillTemplate(ruleText, parsed);
  const raw = await llm(prompt);
  const cleaned = stripFences(raw);

  let resp;
  try {
    resp = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`estimator LLM returned non-JSON: ${cleaned.slice(0, 200)}`);
  }

  const { pMid, pLow, pHigh, sigma, reasoning } = resp;
  if (typeof pMid !== 'number' || pMid < 0 || pMid > 1) {
    throw new Error(`estimator: invalid pMid ${pMid}`);
  }

  const infoGapMonths = computeInfoGapMonths(parsed, trainingCutoff);

  return {
    pLow: typeof pLow === 'number' ? pLow : Math.max(0, pMid - (sigma ?? 0.03)),
    pMid,
    pHigh: typeof pHigh === 'number' ? pHigh : Math.min(1, pMid + (sigma ?? 0.03)),
    sigma: typeof sigma === 'number' ? sigma : 0.03,
    infoGapMonths,
    reasoning: reasoning || '',
  };
}
