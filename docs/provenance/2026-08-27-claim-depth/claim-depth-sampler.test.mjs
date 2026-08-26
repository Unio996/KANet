// (27) v0.4 · 离线确定性测试跑手(无节点无 DB)。跑: node docs/provenance/2026-08-27-claim-depth/claim-depth-sampler.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyInclusion, legBFromBlocks, legAFrom, summarize, LEGA_SOURCES, parseTs } from './claim-depth-sampler.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(HERE, 'vectors.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(HERE, 'expected-output.json'), 'utf8'));
const WRITE = process.argv.includes('--write-expected');

const mkLater = (incDaa, incTs, n, rateMs, jumpAt = null) => Array.from({ length: n }, (_, i) => ({ header: { hash: `b${i}`, daaScore: incDaa + 1 + i + (jumpAt != null && i >= jumpAt ? 5 : 0), timestamp: incTs + (i + 1) * rateMs } }));
const mkSample = (i, { state = 'verified', legBok = true, daa = 22, wall = 2.5, legA = null } = {}) => ({ kind: 'synthetic', txid: `tx${i}`, verified: state === 'verified' ? { state, reason: null } : state === 'excluded' ? { state, reason: 'txid not in canonical block.transactions (tx_log stale / reorged)' } : { state: 'inconclusive', reason: 'block missing / malformed' }, legA: legA ? { state: 'ok', ...legA, final_eligible: legA.source === LEGA_SOURCES.SENDER_TS && (legA.state ?? 'ok') === 'ok' } : null, legB: legBok && state === 'verified' ? { ok: true, legB_daa: daa, legB_wall_s: wall } : { ok: false, err: 'x' } });

const results = {};
for (const v of vectors.cases) {
  let got;
  if (v.type === 'verify') got = verifyInclusion(v.block, v.txid);
  else if (v.type === 'legB') got = legBFromBlocks(v.inclusion, mkLater(v.inclusion.daaScore, v.inclusion.timestamp, v.n, v.rateMs, v.jumpAt), v.depth);
  else if (v.type === 'ts') got = parseTs(v.value);
  else if (v.type === 'legA') { const inp = { ...v.input }; if (v.input.submitRaw !== undefined) { const pt = parseTs(v.input.submitRaw); inp.submitTs = pt.ok ? pt.ms : NaN; inp.submitFmt = pt.ok ? pt.fmt : 'UNPARSED: ' + pt.reason; } const r = legAFrom(inp); got = r && (({ source, state, legA_wall_s, legA_daa, final_eligible, submit_fmt, reason }) => ({ source, state, legA_wall_s: legA_wall_s ?? null, legA_daa: legA_daa ?? null, final_eligible, submit_fmt: submit_fmt ?? null, reason: reason ?? null }))(r); }
  else if (v.type === 'summarize') { const samples = v.samples.flatMap((g, gi) => Array.from({ length: g.count }, (_, i) => mkSample(`${gi}-${i}`, g))); const s = summarize(samples, { minSamples: 30 }); got = { status: s.status, exit: s.exit, verified_n: s.verified_n, legA_inconclusive_ts_n: s.legA_inconclusive_ts.n, legB_n: s.legB_inclusion_to_depth.n, legB_daa_p100: s.legB_inclusion_to_depth.daa?.p100 ?? null, legB_S: s.legB_inclusion_to_depth.daa?.S_unalloc_rule ?? null, legA_final_n: s.legA_final.n, legA_obs: s.legA_observational.sources, excluded: s.excluded, inconclusive: { n: s.inconclusive.n, reasons: s.inconclusive.reasons }, feed: { N: s.feed.N_claim_envelope_daa, S: s.feed.S_unalloc_daa } }; }
  results[v.id] = got;
}
if (WRITE) { console.log(JSON.stringify(results, null, 1)); process.exit(0); }
let fail = 0;
for (const v of vectors.cases) { const a = JSON.stringify(results[v.id]), b = JSON.stringify(expected[v.id]); const ok = a === b; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${v.id}  ${v.desc}${ok ? '' : `\n   got:      ${a}\n   expected: ${b}`}`); }
console.log(`\n${vectors.cases.length - fail}/${vectors.cases.length} PASS`);
process.exit(fail ? 1 : 0);
