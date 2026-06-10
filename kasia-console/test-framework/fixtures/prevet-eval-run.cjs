// 门C prevet eval harness (Bettor r507). Runs labeled corpus through POST /api/pool/prevet,
// tallies FP (bad market scored pass) and FN (good market scored critical).
const fs = require('fs');
const path = require('path');

const MAKER = process.env.EVAL_MAKER_RELAY || '5c07f7e5-752b-470c-8a48-f548b3b17068'; // Bettor-tn (has adapter LLM)
const BASE = 'http://127.0.0.1:3200';
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'prevet-eval-corpus.json'), 'utf8'));

async function prevet(fx) {
  const body = {
    maker_relay_id: MAKER,
    title: fx.title,
    resolution_rule_spec: JSON.stringify(fx.resolution_rule_spec),
    data_source_canonical: fx.resolution_rule_spec.data_source_canonical || '',
    outcome_end_date: fx.outcome_end_date || '',
  };
  const r = await fetch(`${BASE}/api/pool/prevet`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return await r.json().catch(() => ({ ok: false }));
}

(async () => {
  const results = [];
  for (const fx of corpus.fixtures) {
    let res;
    try { res = await prevet(fx); } catch (e) { res = { ok: false, error: e.message }; }
    const tier = res.tier || 'ERR';
    const score = res.score ?? '-';
    results.push({ id: fx.id, class: fx.class, tier, score, llm: (res.llm_votes && res.llm_votes[0]?.score) ?? '-' });
    console.log(`${fx.id.padEnd(13)} class=${fx.class.padEnd(9)} score=${String(score).padStart(2)} tier=${tier}`);
  }
  // tally
  const good = results.filter(r => r.class === 'good');
  const bad = results.filter(r => r.class === 'garbage' || r.class === 'injection');
  const fn = good.filter(r => r.tier === 'critical');          // good wrongly hard-rejected
  const fp = bad.filter(r => r.tier === 'pass');               // bad wrongly passed
  const goodWarn = good.filter(r => r.tier === 'warn');
  const badWarn = bad.filter(r => r.tier === 'warn');
  const fnRate = good.length ? (fn.length / good.length * 100) : 0;
  const fpRate = bad.length ? (fp.length / bad.length * 100) : 0;
  console.log('\n=== EVAL SUMMARY ===');
  console.log(`good (n=${good.length}): FN(critical)=${fn.length} [${fn.map(r=>r.id).join(',')}] | warn=${goodWarn.length} | pass=${good.filter(r=>r.tier==='pass').length}`);
  console.log(`bad  (n=${bad.length}): FP(pass)=${fp.length} [${fp.map(r=>r.id).join(',')}] | warn=${badWarn.length} | critical=${bad.filter(r=>r.tier==='critical').length}`);
  console.log(`FP rate = ${fpRate.toFixed(1)}% (guard <5%)  | FN rate = ${fnRate.toFixed(1)}% (open-line <15%)`);
  console.log(`edge: ${results.filter(r=>r.class==='edge').map(r=>r.id+':'+r.tier).join(', ')}`);
  fs.writeFileSync(path.join(__dirname, '_prevet-eval-result.json'), JSON.stringify({ results, fpRate, fnRate, ts: 'run' }, null, 2));
})();
