// (21) v0.4 · 离线确定性测试跑手(无节点)。跑: node docs/provenance/2026-08-27-kmax/kmax-cost.test.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { targetFromBits, compactTargetBits, workPerBlock, hNetFromBits, difficultyRatio, decideHNet, clampWindow, hAdvImplied, foldToDevices, costTable } from './kmax-cost.mjs';

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
  results[v.id] = got;
}
if (WRITE) { console.log(JSON.stringify(results, null, 1)); process.exit(0); }
let fail = 0;
for (const v of vectors.cases) { const a = JSON.stringify(results[v.id]), b = JSON.stringify(expected[v.id]); const ok = a === b; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${v.id}  ${v.desc}${ok ? '' : `\n   got:      ${a}\n   expected: ${b}`}`); }
console.log(`\n${vectors.cases.length - fail}/${vectors.cases.length} PASS`);
process.exit(fail ? 1 : 0);
