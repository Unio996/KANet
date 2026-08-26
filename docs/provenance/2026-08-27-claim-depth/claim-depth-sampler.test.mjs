// (27) v0.2 · 离线确定性测试跑手(无节点无 DB)。跑: node docs/provenance/2026-08-27-claim-depth/claim-depth-sampler.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyInclusion, legBFromBlocks, legAFrom, summarize } from './claim-depth-sampler.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(HERE, 'vectors.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(HERE, 'expected-output.json'), 'utf8'));
const WRITE = process.argv.includes('--write-expected');

// 合成: 包含块 + 后续块序列(daaScore 单调, 每块 +1 DAA, 时间戳按 rateMs 推进)
const mkLater = (incDaa, incTs, n, rateMs, jumpAt = null) => Array.from({ length: n }, (_, i) => ({ header: { hash: `b${i}`, daaScore: incDaa + 1 + i + (jumpAt != null && i >= jumpAt ? 5 : 0), timestamp: incTs + (i + 1) * rateMs } }));
const mkSample = (i, { verified = true, legBok = true, daa = 22, wall = 2.5, legA = null } = {}) => ({ kind: 'synthetic', txid: `tx${i}`, verified: verified ? { ok: true, reason: null } : { ok: false, reason: 'txid not in block.transactions (tx_log stale / reorged)' }, legA, legB: legBok && verified ? { ok: true, legB_daa: daa, legB_wall_s: wall } : { ok: false, err: 'x' } });

const results = {};
for (const v of vectors.cases) {
  let got;
  if (v.type === 'verify') got = verifyInclusion(v.block, v.txid);
  else if (v.type === 'legB') got = legBFromBlocks(v.inclusion, mkLater(v.inclusion.daaScore, v.inclusion.timestamp, v.n, v.rateMs, v.jumpAt), v.depth);
  else if (v.type === 'legA') got = legAFrom(v.input);
  else if (v.type === 'summarize') { const samples = v.samples.flatMap((g, gi) => Array.from({ length: g.count }, (_, i) => mkSample(`${gi}-${i}`, g))); const s = summarize(samples, { minSamples: 30 }); got = { status: s.status, exit: s.exit, legB_n: s.legB_inclusion_to_depth.n, legB_daa_p100: s.legB_inclusion_to_depth.daa?.p100 ?? null, legB_S: s.legB_inclusion_to_depth.daa?.S_unalloc_rule ?? null, legA_n: s.legA_submit_to_inclusion.n, excluded: s.verified_excluded, feed: s.feed }; }
  results[v.id] = got;
}
if (WRITE) { console.log(JSON.stringify(results, null, 1)); process.exit(0); }
let fail = 0;
for (const v of vectors.cases) { const a = JSON.stringify(results[v.id]), b = JSON.stringify(expected[v.id]); const ok = a === b; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${v.id}  ${v.desc}${ok ? '' : `\n   got:      ${a}\n   expected: ${b}`}`); }
console.log(`\n${vectors.cases.length - fail}/${vectors.cases.length} PASS`);
process.exit(fail ? 1 : 0);
