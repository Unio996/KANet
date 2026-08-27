// (21) v0.8 · 离线确定性测试跑手(无节点)。v0.8 加 D-STAT-1/2 分支(lambda/bracket/nmin/hvis/selfcheck)。跑: node docs/provenance/2026-08-27-kmax/kmax-cost.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { targetFromBits, compactTargetBits, workPerBlock, hNetFromBits, difficultyRatio, decideHNet, clampWindow, hAdvImplied, foldToDevices, costTable, law3FromBlocks, lambdaUb, lambdaUbChernoff, lambdaUbGaussRail, bracketCheck, selfCheck, nMin, hVisUb } from './kmax-cost.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(HERE, 'vectors.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(HERE, 'expected-output.json'), 'utf8'));
const WRITE = process.argv.includes('--write-expected');

const results = {};
for (const v of vectors.cases) {
  let got;
  if (v.type === 'bits') { const t = targetFromBits(v.bits); got = { target: t.toString(), target_hex: '0x' + t.toString(16), roundtrip_bits: compactTargetBits(t), work_per_block: workPerBlock(t).toString(), H1_Hs: hNetFromBits(v.bits), difficulty_ratio: difficultyRatio(v.bits) }; }
  else if (v.type === 'decide') got = decideHNet(v.input);
  else if (v.type === 'window') got = clampWindow(v.window);
  else if (v.type === 'implied') got = { H_adv_implied: hAdvImplied(v.k, v.H_floor), devices: foldToDevices(hAdvImplied(v.k, v.H_floor)) };
  else if (v.type === 'table') got = costTable(v.H_net, v.ks);
  else if (v.type === 'lambda') got = bracketCheck(v.n);
  else if (v.type === 'selfcheck') { const r = selfCheck(); got = { ok: r.ok, sweep_0_200_bracket_failures: r.sweep_0_200_bracket_failures, rows_ok: r.rows.map(x => [x.n, x.ok]) }; }
  else if (v.type === 'nmin') got = { delta: v.delta, N_min: nMin(v.delta) };
  else if (v.type === 'hvis') { try { got = hVisUb(v.input); } catch (e) { got = { thrown: String(e.message).slice(0, 40) }; } }
  else if (v.type === 'law3') { const mk = (n, from, step) => Array.from({ length: n }, (_, i) => ({ header: { hash: 'b' + from + i, timestamp: from + i * step } })); const blocks = [...mk(v.inWindow, v.tipTs - v.windowS * 1000 + 1, Math.floor(v.windowS * 1000 / v.inWindow)), ...mk(v.outWindow, v.tipTs - v.windowS * 1000 - 100000, 10)]; got = law3FromBlocks(blocks, v.tipTs, v.windowS, targetFromBits(v.bits)); }
  results[v.id] = got;
}
if (WRITE) { console.log(JSON.stringify(results, null, 1)); process.exit(0); }
let fail = 0;
for (const v of vectors.cases) { const a = JSON.stringify(results[v.id]), b = JSON.stringify(expected[v.id]); const ok = a === b; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${v.id}  ${v.desc}${ok ? '' : `\n   got:      ${a}\n   expected: ${b}`}`); }
console.log(`\n${vectors.cases.length - fail}/${vectors.cases.length} PASS`);
process.exit(fail ? 1 : 0);
