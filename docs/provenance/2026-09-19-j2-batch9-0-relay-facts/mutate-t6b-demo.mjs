// T6b 复现(NWT 9-0 复核唯一存活的变异 S1-f): handleGetAddressUtxos 的默认截止时间被设成 0。
// 对【主线上的旧 41 项测试(git show HEAD)】与【加了 T6b 的新 42 项测试】各跑一次同一个变异。
// 期望: 旧 41 项 0 失败(变异存活 = 缺口被复现), 新 42 项 ≥1 失败(T6b 抓到)。每次 finally 还原被变异文件并核 sha256。
// 运行(在 kasia-relay 目录, 且 HEAD 必须是加 T6b 之前的提交, 即工作树里 utxo-facts.test.mjs 有未提交的 T6b 改动):
//   node ../docs/provenance/2026-09-19-j2-batch9-0-relay-facts/mutate-t6b-demo.mjs <kasia-relay 绝对路径>
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const REL = process.argv[2];
const target = `${REL}/src/lib/utxo-facts.mjs`;
const oldTestPath = `${REL}/src/lib/_utxo-facts.test.main41.mjs`;   // `_` 前缀 ⇒ gitignored
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const orig = fs.readFileSync(target);
const origSha = sha(orig);
const text = orig.toString('utf8');
const FIND = 'legacyGetAddressUtxos, getNetworkId, rpcCallMs = FACTS_RPC_CALL_MS }) {';
const REPL = 'legacyGetAddressUtxos, getNetworkId, rpcCallMs = 0 }) {';
if (text.split(FIND).length - 1 !== 1) throw new Error('变异锚点不是恰 1 次');

const run = (testFile) => {
  const r = spawnSync(process.execPath, [testFile], { cwd: REL, encoding: 'utf8', timeout: 120000 });
  const lines = (r.stdout || '').split('\n');
  return { summary: lines.filter((l) => /passed, \d+ failed/.test(l)).pop() || '(no summary)', fails: lines.filter((l) => l.startsWith('[FAIL]')).map((l) => l.slice(0, 75)) };
};

try {
  fs.writeFileSync(oldTestPath, execFileSync('git', ['show', 'HEAD:kasia-relay/src/lib/utxo-facts.test.mjs'], { cwd: REL, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  const newTest = `${REL}/src/lib/utxo-facts.test.mjs`;
  console.log('== 基线(未变异): 主线旧测试 / 加了 T6b 的新测试');
  console.log('  旧(HEAD):', run(oldTestPath).summary);
  console.log('  新       :', run(newTest).summary);
  fs.writeFileSync(target, text.replace(FIND, REPL));
  console.log('== 施加变异 S1-f(handleGetAddressUtxos 默认截止时间 = 0)后:');
  const oldR = run(oldTestPath), newR = run(newTest);
  console.log('  旧(HEAD):', oldR.summary, oldR.fails.length === 0 ? '  ⇐ 变异【存活】(NWT 报的缺口被复现)' : '  ⇐ 被抓到(与 NWT 结论不符!)');
  console.log('  新       :', newR.summary, newR.fails.length > 0 ? '  ⇐ 变异【被抓】' : '  ⇐ 仍存活(T6b 没补上!)');
  for (const f of newR.fails) console.log('     ' + f);
  process.exitCode = (oldR.fails.length === 0 && newR.fails.length > 0) ? 0 : 1;
} finally {
  fs.writeFileSync(target, orig);
  try { fs.unlinkSync(oldTestPath); } catch {}
  console.log(sha(fs.readFileSync(target)) === origSha ? `[RESTORED] utxo-facts.mjs 已还原, sha256 ${origSha.slice(0, 16)}… 一致` : '[!!! 还原失败 !!!]');
}
