// (24) v0.4 · 确定性测试向量跑手(离线, 无节点, 无 DB)。跑: node docs/provenance/2026-08-27-smax/smax-extractor.test.mjs
// 读 vectors.json → 用 smax-extractor.mjs 的纯函数算 → 与 expected-output.json 逐字段比对; 任一不等 ⇒ 退出码 1。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCoinbasePayload, serializeCoinbasePayload, aggregate, completeness, decide } from './smax-extractor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(HERE, 'vectors.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(HERE, 'expected-output.json'), 'utf8'));
const WRITE = process.argv.includes('--write-expected');

const mkBlocks = (miners) => miners.flatMap(({ spkVersion = 0, scriptHex, blocks, outAddr }) => Array.from({ length: blocks }, (_, i) => ({
  header: { hash: `${scriptHex}-${i}` },
  transactions: [{ payload: serializeCoinbasePayload({ blueScore: 1000 + i, subsidy: 100000000, spkVersion, scriptHex, extraHex: '6b616e6574' }), outputs: outAddr ? [{ value: 100000000, verboseData: { scriptPublicKeyAddress: outAddr } }] : [] }],
})));

const results = {};
for (const v of vectors.cases) {
  let got;
  if (v.type === 'parse') got = parseCoinbasePayload(v.payload_hex);
  else if (v.type === 'aggregate') got = (({ s_visible_max, top, distinct_miners, parsed, failed, control_output_addr }) => ({ s_visible_max, top, distinct_miners, parsed, failed, s_visible_max_out: control_output_addr.s_visible_max_out }))(aggregate(mkBlocks(v.miners)));
  else if (v.type === 'completeness') got = (({ expected_blocks, expected_source, ratio, incomplete, gap_blocks }) => ({ expected_blocks, expected_source, ratio, incomplete, gap_blocks }))(completeness(v.input));
  else if (v.type === 'decide') { const comp = completeness(v.input); const d = decide({ blocks: mkBlocks(v.miners), comp, dry: false }); got = { status: d.status, exit: d.exit, s_visible_max: d.s_visible_max ?? null }; }
  results[v.id] = got;
}
if (WRITE) { console.log(JSON.stringify(results, null, 1)); process.exit(0); }
let fail = 0;
for (const v of vectors.cases) {
  const a = JSON.stringify(results[v.id]), b = JSON.stringify(expected[v.id]);
  const ok = a === b; if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${v.id}  ${v.desc}${ok ? '' : `\n   got:      ${a}\n   expected: ${b}`}`);
}
console.log(`\n${vectors.cases.length - fail}/${vectors.cases.length} PASS`);
process.exit(fail ? 1 : 0);
