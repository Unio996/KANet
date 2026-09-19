// N-T1 复现: 同一个变异(NWT-e: 形态 O 匹配键去掉 index)对【旧测试 dbfa5599 的 33 项】与【新测试(含 O5/O5b)】各跑一次。
// 期望: 旧测试 0 条失败(变异存活 = 真缺口被复现), 新测试 ≥1 条失败(缺口已补)。每次 finally 还原被变异文件并核 sha256。
// 运行: node docs/provenance/2026-09-19-j2-batch9-0-relay-facts/mutate-n-t1-demo.mjs <kasia-relay 绝对路径>
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const REL = process.argv[2];
const target = `${REL}/src/lib/utxo-facts.mjs`;
const oldTestPath = `${REL}/src/lib/_utxo-facts.test.dbfa5599.mjs`;   // `_` 前缀 ⇒ gitignored
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const orig = fs.readFileSync(target);
const origSha = sha(orig);
const text = orig.toString('utf8');

const finds = [
  'const wanted = new Map(req.outpoints.map((o) => [`${o.transactionId}:${o.index}`, o]));',
  'const k = `${key.txid}:${key.index}`;',
  'const h = hit.get(`${o.transactionId}:${o.index}`);',
];
const repls = [
  'const wanted = new Map(req.outpoints.map((o) => [`${o.transactionId}:`, o]));',
  'const k = `${key.txid}:`;',
  'const h = hit.get(`${o.transactionId}:`);',
];
for (const f of finds) { const c = text.split(f).length - 1; if (c !== 1) throw new Error(`锚点命中 ${c} 次: ${f}`); }

const run = (testFile) => {
  const r = spawnSync(process.execPath, [testFile], { cwd: REL, encoding: 'utf8', timeout: 120000 });
  const lines = (r.stdout || '').split('\n');
  return { summary: lines.filter((l) => /passed, \d+ failed/.test(l)).pop() || '(no summary)', fails: lines.filter((l) => l.startsWith('[FAIL]')).map((l) => l.slice(0, 70)) };
};

try {
  fs.writeFileSync(oldTestPath, execFileSync('git', ['show', 'dbfa5599:kasia-relay/src/lib/utxo-facts.test.mjs'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  console.log('== 基线(未变异): 旧测试 / 新测试');
  console.log('  旧(dbfa5599):', run(oldTestPath).summary);
  console.log('  新          :', run(`${REL}/src/lib/utxo-facts.test.mjs`).summary);
  let mutated = text; finds.forEach((f, i) => { mutated = mutated.replace(f, repls[i]); });
  fs.writeFileSync(target, mutated);
  console.log('== 施加变异 NWT-e(形态 O 匹配键去掉 index)后:');
  const oldR = run(oldTestPath), newR = run(`${REL}/src/lib/utxo-facts.test.mjs`);
  console.log('  旧(dbfa5599):', oldR.summary, oldR.fails.length === 0 ? '  ⇐ 变异【存活】(真缺口被复现)' : '  ⇐ 被抓到(与 NWT 结论不符!)');
  console.log('  新          :', newR.summary, newR.fails.length > 0 ? '  ⇐ 变异【被抓】' : '  ⇐ 仍存活(缺口没补上!)');
  for (const f of newR.fails) console.log('     ' + f);
  process.exitCode = (oldR.fails.length === 0 && newR.fails.length > 0) ? 0 : 1;
} finally {
  fs.writeFileSync(target, orig);
  try { fs.unlinkSync(oldTestPath); } catch {}
  console.log(sha(fs.readFileSync(target)) === origSha ? `[RESTORED] utxo-facts.mjs 已还原, sha256 ${origSha.slice(0, 16)}… 一致` : '[!!! 还原失败 !!!]');
}
