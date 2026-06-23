#!/usr/bin/env node
// scripts/prevet-fp-fn-runner.mjs
// NWT-tn r341/r344/r345 测试角 — Bettor r367/r376 派 C
// 跑 120 fixture 量 FP/FN.

import { fixtures, categoryCounts } from './prevet-fp-fn-fixtures.mjs';

const ENDPOINT = process.env.PREVET_URL || 'http://127.0.0.1:3200/api/pool/prevet';
const MAKER = process.env.MAKER_RELAY_ID || '8dd59acb-3ccc-47b8-8833-cc4b7358848f';  // NWT-tn

const tierFromScore = (s) => s >= 7 ? 'pass' : s >= 4 ? 'warn' : 'critical';

const results = [];
let idx = 0;
const t0 = Date.now();

for (const f of fixtures) {
  idx++;
  const body = { maker_relay_id: MAKER, ...f.body };
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json();
    const score = j?.score ?? null;
    const tier = j?.tier ?? (score != null ? tierFromScore(score) : null);
    results.push({ idx, category: f.category, expected: f.expected, actual_score: score, actual_tier: tier, why: (j?.why || []).slice(0, 2), ok: r.ok });
    process.stdout.write(`${idx}/${fixtures.length} ${f.category} expected=${f.expected} score=${score} tier=${tier}\n`);
  } catch (e) {
    results.push({ idx, category: f.category, expected: f.expected, actual_score: null, actual_tier: 'error', error: e.message, ok: false });
    process.stdout.write(`${idx}/${fixtures.length} ${f.category} ERROR: ${e.message}\n`);
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

// FP = good fixture actual tier != pass (= 好被拒)
// FN = critical fixture actual tier == pass (= 垃圾放行)
const goods = results.filter(r => r.expected === 'pass');
const bads = results.filter(r => r.expected === 'critical');
const fpCount = goods.filter(r => r.actual_tier !== 'pass').length;
const fnCount = bads.filter(r => r.actual_tier === 'pass').length;
const fpRate = goods.length ? (fpCount / goods.length * 100).toFixed(1) : 'N/A';
const fnRate = bads.length ? (fnCount / bads.length * 100).toFixed(1) : 'N/A';

// Per category breakdown
const byCat = {};
for (const r of results) {
  byCat[r.category] = byCat[r.category] || { total: 0, pass: 0, warn: 0, critical: 0, error: 0 };
  byCat[r.category].total++;
  byCat[r.category][r.actual_tier || 'error']++;
}

console.log('\n=== FP/FN report ===');
console.log(`fixtures: ${results.length} (cats: ${Object.entries(categoryCounts).map(([k,v]) => `${k}=${v}`).join(', ')})`);
console.log(`elapsed: ${elapsed}s`);
console.log(`FP rate (good 被拒): ${fpCount}/${goods.length} = ${fpRate}% (target <5%)`);
console.log(`FN rate (垃圾放行): ${fnCount}/${bads.length} = ${fnRate}% (target <15%)`);
console.log('\nPer-category breakdown:');
for (const [cat, c] of Object.entries(byCat)) {
  console.log(`  ${cat}: total=${c.total} pass=${c.pass} warn=${c.warn} critical=${c.critical} error=${c.error}`);
}

// Misclassified samples (= 出错样本最有教学价值)
const fps = goods.filter(r => r.actual_tier !== 'pass').slice(0, 5);
const fns = bads.filter(r => r.actual_tier === 'pass').slice(0, 5);
if (fps.length) {
  console.log('\nFP samples (好被拒 first 5):');
  for (const r of fps) console.log(`  #${r.idx} ${r.category} score=${r.actual_score} tier=${r.actual_tier} why=${JSON.stringify(r.why)}`);
}
if (fns.length) {
  console.log('\nFN samples (垃圾放行 first 5):');
  for (const r of fns) console.log(`  #${r.idx} ${r.category} score=${r.actual_score} tier=${r.actual_tier} why=${JSON.stringify(r.why)}`);
}

// Save raw
const outPath = `D:/kanet-tn12/kasia-console/prevet-fp-fn-report-${new Date().toISOString().replace(/[:.]/g,'').slice(0,15)}Z.json`;
import('node:fs').then(fs => {
  fs.writeFileSync(outPath, JSON.stringify({ fp_rate: fpRate, fn_rate: fnRate, fp_count: fpCount, fn_count: fnCount, fixtures: results.length, by_category: byCat, samples_fp: fps, samples_fn: fns, results }, null, 2));
  console.log(`\nraw report saved: ${outPath}`);
});
