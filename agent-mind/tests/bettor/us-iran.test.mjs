/**
 * Bettor Phase 1 — US-Iran rule unit tests.
 * Run: node --test agent-mind/tests/bettor/us-iran.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseRule, latestEmbeddedDate } from '../../src/skills/bettor/rule-parser.mjs';
import { kellyFraction, recommendBet } from '../../src/skills/bettor/kelly.mjs';
import { estimateP } from '../../src/skills/bettor/estimator.mjs';

const US_IRAN_RULE = `This market will resolve to "Yes" if Iran and the United states agree to a permanent peace deal by the specified date, 11:59 PM ET. Otherwise, this market will resolve to "No". A permanent peace deal refers to any agreement which explicitly indicates that military hostilities between the United States and Iran have ended or will permanently cease, or uses equivalent language clearly signaling a lasting end to military hostilities between the United States and Iran. Agreements that are explicitly temporary or which do not include a definitive agreement to end military hostilities between the US and Iran on a lasting basis (e.g. a temporary extension of the two-week ceasefire agreement announced on April 7, 2026), will not qualify. A qualifying agreement will be considered to have been established if either of the following conditions are met: - The United States and Iran each sign or formally adopt a written agreement (e.g. a treaty or multi-point agreement) which meets the above criteria. - Both the governments of the United States and Iran provide clear public confirmation that a qualifying agreement has been definitively established. Negotiations, statements of progress, or other statements which do not constitute a definitive announcement that a qualifying agreement has been reached will not count. The primary resolution source for this market will be official information from the governments of the United States and Iran; however, a consensus of credible reporting may also be used.`;

// ── parseRule ───────────────────────────────────────────────────────────────

test('parseRule: extracts disqualifier mentioning April 7, 2026 ceasefire', () => {
  const p = parseRule(US_IRAN_RULE);
  assert.ok(p.disqualifiers.length >= 1, 'should find at least one disqualifier sentence');
  const all = p.disqualifiers.join(' ');
  assert.match(all, /April 7, 2026/i, 'disqualifier should mention April 7, 2026 fact');
});

test('parseRule: pulls embedded facts from e.g. clauses', () => {
  const p = parseRule(US_IRAN_RULE);
  assert.ok(p.embeddedFacts.length >= 2, `expected >= 2 e.g. clauses, got ${p.embeddedFacts.length}`);
  const all = p.embeddedFacts.join(' ');
  assert.match(all, /two-week ceasefire/i);
  assert.match(all, /April 7, 2026/i);
  assert.match(all, /treaty or multi-point agreement/i);
});

test('parseRule: identifies YES condition sentences', () => {
  const p = parseRule(US_IRAN_RULE);
  assert.ok(p.yesConditions.length >= 1);
});

test('parseRule: extracts both resolution sources', () => {
  const p = parseRule(US_IRAN_RULE);
  assert.ok(p.resolutionSources.includes('official government information'));
  assert.ok(p.resolutionSources.includes('consensus of credible reporting'));
});

test('parseRule: timeWindow includes a date and a time', () => {
  const p = parseRule(US_IRAN_RULE);
  assert.ok(p.timeWindow);
  assert.match(p.timeWindow, /April 7, 2026/);
  assert.match(p.timeWindow, /11:59/);
});

test('latestEmbeddedDate: finds April 7, 2026', () => {
  const p = parseRule(US_IRAN_RULE);
  const d = latestEmbeddedDate(p);
  assert.ok(d, 'should resolve a date');
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 3, 'April is month 3 (0-indexed)');
});

// ── kellyFraction ───────────────────────────────────────────────────────────

test('kellyFraction: 0 when p == market (no edge)', () => {
  assert.equal(kellyFraction({ p: 0.04, marketPrice: 0.04 }), 0);
});

test('kellyFraction: 0 when negative edge (clamped)', () => {
  assert.equal(kellyFraction({ p: 0.04, marketPrice: 0.05 }), 0);
});

test('kellyFraction: classic 60% biased coin = 0.2', () => {
  const f = kellyFraction({ p: 0.6, marketPrice: 0.5 });
  assert.ok(Math.abs(f - 0.2) < 1e-9, `expected 0.2, got ${f}`);
});

test('kellyFraction: high-confidence NO at YES=0.15 ⇒ buy NO at 0.85, big position', () => {
  // p_NO=0.96, b = 1/0.85 - 1 = 0.176
  // f* = (0.96 × 0.176 - 0.04) / 0.176 ≈ 0.733
  const f = kellyFraction({ p: 0.96, marketPrice: 0.85 });
  assert.ok(f > 0.7 && f < 0.8, `expected ~0.73, got ${f.toFixed(3)}`);
});

// ── recommendBet ────────────────────────────────────────────────────────────

test('recommendBet: SKIP when YES=$0.05 vs our 4% (no edge)', () => {
  const r = recommendBet({ pMid: 0.04, yesPrice: 0.05, bankroll: 1000, infoGapMonths: 0 });
  assert.equal(r.side, 'SKIP');
});

test('recommendBet: NO with size when YES=$0.15 vs 4% (edge=11pt on NO side)', () => {
  const r = recommendBet({ pMid: 0.04, yesPrice: 0.15, bankroll: 1000, infoGapMonths: 0 });
  assert.equal(r.side, 'NO');
  assert.ok(r.size > 0);
  assert.ok(r.fraction > 0);
});

test('recommendBet: SKIP when sigma > 30% (LLM unsure, hard cutoff)', () => {
  const r = recommendBet({ pMid: 0.5, sigma: 0.5, yesPrice: 0.97, bankroll: 1000, infoGapMonths: 0 });
  assert.equal(r.side, 'SKIP');
  assert.match(r.reasoning.join(' '), /sigma|不确定/i);
});

test('recommendBet: SKIP when info gap > 3 months (hard cutoff)', () => {
  const r = recommendBet({ pMid: 0.04, yesPrice: 0.15, bankroll: 1000, infoGapMonths: 4 });
  assert.equal(r.side, 'SKIP');
  assert.match(r.reasoning.join(' '), /info gap/i);
});

test('recommendBet: info gap > 1 month halves fraction', () => {
  const r0 = recommendBet({ pMid: 0.04, yesPrice: 0.15, bankroll: 1000, infoGapMonths: 0 });
  const r2 = recommendBet({ pMid: 0.04, yesPrice: 0.15, bankroll: 1000, infoGapMonths: 2 });
  assert.equal(r0.side, 'NO');
  assert.equal(r2.side, 'NO');
  assert.ok(r2.fraction < r0.fraction, `gap should shrink fraction: r0=${r0.fraction.toFixed(3)} r2=${r2.fraction.toFixed(3)}`);
});

// ── estimateP (stub LLM) ────────────────────────────────────────────────────

test('estimateP: returns calibrated shape from stub LLM + computes info gap', async () => {
  const stubLLM = async (_prompt) => JSON.stringify({
    pLow: 0.01, pMid: 0.04, pHigh: 0.08, sigma: 0.03,
    reasoning: 'Stub: 8 days too short, Khamenei red line not crossed',
  });

  const parsed = parseRule(US_IRAN_RULE);
  const r = await estimateP({
    ruleText: US_IRAN_RULE,
    parsed,
    trainingCutoff: '2026-01-31',
    llm: stubLLM,
  });

  assert.equal(r.pMid, 0.04);
  assert.equal(r.sigma, 0.03);
  // Jan 31 → April 7 ≈ 2.2 months
  assert.ok(r.infoGapMonths > 2 && r.infoGapMonths < 3, `expected ~2.2 months, got ${r.infoGapMonths.toFixed(2)}`);
  assert.match(r.reasoning, /Khamenei|stub/i);
});

test('estimateP: throws on invalid LLM response', async () => {
  const badLLM = async () => 'not json at all';
  const parsed = parseRule(US_IRAN_RULE);
  await assert.rejects(
    () => estimateP({ ruleText: US_IRAN_RULE, parsed, trainingCutoff: '2026-01-31', llm: badLLM }),
    /non-JSON/
  );
});

// ── full pipeline (parse → estimate → recommend) ────────────────────────────

test('pipeline: US-Iran end-to-end with stub estimator → SKIP at YES=$0.05', async () => {
  const stubLLM = async () => JSON.stringify({
    pLow: 0.01, pMid: 0.04, pHigh: 0.08, sigma: 0.03,
    reasoning: 'stub',
  });
  const parsed = parseRule(US_IRAN_RULE);
  const est = await estimateP({
    ruleText: US_IRAN_RULE,
    parsed,
    trainingCutoff: '2026-01-31',
    llm: stubLLM,
  });
  const rec = recommendBet({
    pMid: est.pMid,
    sigma: est.sigma,
    infoGapMonths: est.infoGapMonths,
    yesPrice: 0.05,
    bankroll: 1000,
  });
  assert.equal(rec.side, 'SKIP');
});

test('pipeline: US-Iran end-to-end → BUY NO at YES=$0.15 with shrunk size due to gap', async () => {
  const stubLLM = async () => JSON.stringify({
    pLow: 0.01, pMid: 0.04, pHigh: 0.08, sigma: 0.03, reasoning: 'stub',
  });
  const parsed = parseRule(US_IRAN_RULE);
  const est = await estimateP({
    ruleText: US_IRAN_RULE,
    parsed,
    trainingCutoff: '2026-01-31',
    llm: stubLLM,
  });
  const rec = recommendBet({
    pMid: est.pMid,
    sigma: est.sigma,
    infoGapMonths: est.infoGapMonths,
    yesPrice: 0.15,
    bankroll: 1000,
  });
  assert.equal(rec.side, 'NO');
  assert.ok(rec.size > 0 && rec.size < 1000);
  assert.match(rec.reasoning.join(' '), /info gap/i);
});
