/**
 * Bettor Phase 3f-1 Sub #2 — LLM Calibrator unit tests (Bettor r55 spec, 8 cases).
 * Run: node --test agent-mind/tests/bettor/calibrator.test.mjs
 *
 * 4 case classifyConfidence (delta>30 / sigma>15 / tight / moderate)
 * 4 case applyConfidenceDamping (3 band + edge zero)
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { classifyConfidence, applyConfidenceDamping } from '../../src/skills/bettor/calibrator.mjs';

// ── classifyConfidence ──────────────────────────────────────────────────────

test('classifyConfidence: gap > 30pp → low (rule 1, Greece-like LLM 1% vs market 35% extreme disagree)', () => {
  const r = classifyConfidence({ llmPMid: 0.01, marketYes: 0.35, sigma: 0.03 });
  assert.equal(r.band, 'low');
  assert.match(r.reason, /gap 34\.0pp > 30pp/);
});

test('classifyConfidence: sigma > 15pp → low (rule 2, LLM 自报高不确定 优先于 mid)', () => {
  const r = classifyConfidence({ llmPMid: 0.30, marketYes: 0.25, sigma: 0.20 });
  assert.equal(r.band, 'low');
  assert.match(r.reason, /sigma 20\.0pp > 15pp/);
});

test('classifyConfidence: gap ≤ 10pp + sigma ≤ 5pp → high (rule 3, tight alignment + low uncertainty)', () => {
  const r = classifyConfidence({ llmPMid: 0.55, marketYes: 0.50, sigma: 0.04 });
  assert.equal(r.band, 'high');
  assert.match(r.reason, /gap 5\.0pp ≤ 10pp/);
});

test('classifyConfidence: moderate gap or sigma → mid (rule 4 fallback, 10<gap<30 OR 5<sigma<15)', () => {
  const r = classifyConfidence({ llmPMid: 0.40, marketYes: 0.25, sigma: 0.08 });
  assert.equal(r.band, 'mid');
  assert.match(r.reason, /gap 15\.0pp/);
});

// ── applyConfidenceDamping ──────────────────────────────────────────────────

test('applyConfidenceDamping: low → ×0.20 (Kelly 0.25 → 0.05 = 5% bankroll cap)', () => {
  assert.equal(applyConfidenceDamping({ band: 'low', baseFraction: 0.25 }), 0.05);
});

test('applyConfidenceDamping: mid → ×0.50 (Kelly 0.25 → 0.125 = ~12% bankroll cap)', () => {
  assert.equal(applyConfidenceDamping({ band: 'mid', baseFraction: 0.25 }), 0.125);
});

test('applyConfidenceDamping: high → ×1.00 (Kelly unchanged)', () => {
  assert.equal(applyConfidenceDamping({ band: 'high', baseFraction: 0.25 }), 0.25);
});

test('applyConfidenceDamping: edge zero fraction → 0 (idempotent on SKIP recommend)', () => {
  assert.equal(applyConfidenceDamping({ band: 'low', baseFraction: 0 }), 0);
  assert.equal(applyConfidenceDamping({ band: 'mid', baseFraction: 0 }), 0);
  assert.equal(applyConfidenceDamping({ band: 'high', baseFraction: 0 }), 0);
});
