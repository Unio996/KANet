// mutate-f4-scan.mjs — 9-1 F4 笔(NWT F2-1)共享源码扫描器的变异对照 + "真实探针文件"回归(J2 2026-09-20)。
// A 部分(探针回归, 即 NWT 的真实探针形态): 在真实仓库树里种一个引用违规标识符的文件——src/data/、kasia-console/scripts/、根 scripts/、.mts、.tsx、require——
//   跑对应测试(claim-draw 的 B6 / c1 的 F1-2 扫描), 期望每个都红; 跑完删除探针文件并核对已删。
// B 部分(扫描器自身变异): 逐个破坏 scan-non-test-sources.mjs, 跑其自测, 期望每个都红; 每次还原并核 sha256。
// 运行: node docs/provenance/2026-09-20-j2-batch9-1-f4-c-module-nwt-f1-fixes/mutate-f4-scan.mjs <worktree 根绝对路径>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = process.argv[2];
const CON = `${ROOT}/kasia-console`;
const SCANNER = `${CON}/test-fixtures/source-scan/scan-non-test-sources.mjs`;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const runNode = (file) => spawnSync(process.execPath, [file], { cwd: CON, encoding: 'utf8', timeout: 240000 });
const isRed = (r) => `${r.stdout || ''}${r.stderr || ''}`.split('\n').some((l) => l.startsWith('[FAIL]')) || r.status !== 0;
const failNames = (r) => `${r.stdout || ''}`.split('\n').filter((l) => l.startsWith('[FAIL]')).map((l) => l.replace(/^\[FAIL\]\s*/, '').split(/[ ⇒:(]/)[0]);

let allRed = true;

// ── A: 探针回归 ──
const FIX_REF = "import '../../../kasia-console/src/lib/proto-chain-parents-fixtures.mjs';\n";
const WT_REF = "import { verifyStepInputsOnChainWithTimers } from '../../kasia-console/src/lib/proto-settlement-c1.mjs';\n";
const probes = [
  ['A-1 ▲ src/data/(曾被 skipDir 含 data 漏掉)引用夹具', 'kasia-console/src/data/_probe_f4.js', FIX_REF, 'src/lib/proto-claim-draw.test.mjs'],
  ['A-2 ▲ kasia-console/scripts/(曾不在扫描根内)引用夹具', 'kasia-console/scripts/_probe_f4.mjs', FIX_REF, 'src/lib/proto-claim-draw.test.mjs'],
  ['A-3 ▲ 根 scripts/ 的 .mts 引用夹具', 'scripts/_probe_f4.mts', FIX_REF, 'src/lib/proto-claim-draw.test.mjs'],
  ['A-4 .tsx 引用夹具', 'packages/_probe_f4.tsx', FIX_REF, 'src/lib/proto-claim-draw.test.mjs'],
  ['A-5 require 形态引用夹具', 'kasia-relay/src/_probe_f4.cjs', "const m = require('../../kasia-console/src/lib/proto-chain-parents-fixtures.mjs');\n", 'src/lib/proto-claim-draw.test.mjs'],
  ['A-6 ▲ src/data/ 引用仅测试用入口 verifyStepInputsOnChainWithTimers', 'kasia-console/src/data/_probe_f4b.js', WT_REF, 'src/lib/proto-settlement-c1.test.mjs'],
  ['A-7 ▲ kasia-console/scripts/ 引用仅测试用入口', 'kasia-console/scripts/_probe_f4b.mjs', WT_REF, 'src/lib/proto-settlement-c1.test.mjs'],
  ['A-8 根 scripts/ 的 .mts 引用仅测试用入口', 'scripts/_probe_f4b.mts', WT_REF, 'src/lib/proto-settlement-c1.test.mjs'],
];
// 对照臂: 基线(无探针)两个测试都绿
for (const tf of ['src/lib/proto-claim-draw.test.mjs', 'src/lib/proto-settlement-c1.test.mjs']) {
  const r = runNode(tf);
  console.log(`基线(无探针) ${tf}:`, (r.stdout || '').split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop(), `exit=${r.status}`);
  if (r.status !== 0) allRed = false;
}
for (const [name, rel, body, tf] of probes) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  let r;
  try { r = runNode(tf); } finally { fs.rmSync(abs, { force: true }); }
  const red = isRed(r);
  if (!red) allRed = false;
  console.log(`${red ? '[RED ]' : '[GREEN⚠ 探针存活!]'} ${name}  →  ${failNames(r).length} 条 FAIL${failNames(r)[0] ? `(首条: ${failNames(r)[0]})` : ''}  探针已删=${!fs.existsSync(abs)}`);
}

// ── B: 扫描器自身变异 ──
const orig = fs.readFileSync(SCANNER), origSha = sha(orig), text = orig.toString('utf8');
const muts = [
  ['S-1 ▲ 按目录名在任意深度跳过 data(NWT F2-1 的原漏洞)', "if (ent.name === 'node_modules') continue;", "if (ent.name === 'node_modules' || ent.name === 'data') continue;"],
  ['S-2 ▲ 按目录名跳过 scripts', "if (ent.name === 'node_modules') continue;", "if (ent.name === 'node_modules' || ent.name === 'scripts') continue;"],
  ['S-3 ▲ 扩展名只认 mjs', 'const EXT = /\\.(mjs|js|cjs|ts|mts|cts|jsx|tsx)$/;', 'const EXT = /\\.mjs$/;'],
  ['S-4 不去注释(注释里的提及被算成引用)', "pattern.test(stripComments(fs.readFileSync(f.abs, 'utf8')))", "pattern.test(fs.readFileSync(f.abs, 'utf8'))"],
  ['S-5 不排除 .test/.spec 文件', 'ent.isFile() && EXT.test(ent.name) && !TEST_NAME.test(ent.name)', 'ent.isFile() && EXT.test(ent.name)'],
  ['S-6 node_modules 只在仓库根跳过(任意深度的依赖被扫描)', "if (ent.name === 'node_modules') continue;", "if (!rel && ent.name === 'node_modules') continue;"],
  ['S-7 minFiles 下限失效', 'if (files.length < minFiles) throw new Error(', 'if (false) throw new Error('],
  ['S-8 exceptRel 不再放行定义者自己', 'if (exceptRel.includes(f.rel)) continue;', ''],
  ['S-9 排除改成"路径里任意位置包含前缀"而非"仓库根相对前缀"', "excludedPrefixes.some((p) => `${childRel}/`.startsWith(p))", "excludedPrefixes.some((p) => `${childRel}/`.includes(p))"],
  ['S-10 排除清单缺 docs/(证据目录里的脚本被算成源码)', "'.git/', 'docs/', 'scratch/',", "'.git/', 'scratch/',"],
];
try {
  const base = runNode('test-fixtures/source-scan/scan-non-test-sources.test.mjs');
  console.log('基线(未变异) 扫描器自测:', (base.stdout || '').split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop(), `exit=${base.status}`);
  if (base.status !== 0) allRed = false;
  for (const [name, find, repl] of muts) {
    const c = text.split(find).length - 1;
    if (c !== 1) { console.log(`[ERR ] ${name}: 变异锚点命中 ${c} 次(需要恰 1 次)——变异脚本与源码不同步`); allRed = false; continue; }
    fs.writeFileSync(SCANNER, text.replace(find, () => repl));
    const r = runNode('test-fixtures/source-scan/scan-non-test-sources.test.mjs');
    const red = isRed(r);
    if (!red) allRed = false;
    console.log(`${red ? '[RED ]' : '[GREEN⚠ 变异存活!]'} ${name}  →  ${failNames(r).length} 条 FAIL${failNames(r)[0] ? `(首条: ${failNames(r)[0]})` : ''}`);
    fs.writeFileSync(SCANNER, orig);
  }
} finally {
  fs.writeFileSync(SCANNER, orig);
  console.log(sha(fs.readFileSync(SCANNER)) === origSha ? `[RESTORED] scan-non-test-sources.mjs 已还原, sha256 ${origSha.slice(0, 16)}… 一致` : '[!!! 还原失败 !!!]');
}
console.log(allRed ? '\n全部探针与变异均被测试抓到' : '\n⚠ 有探针/变异存活或锚点失配, 见上');
process.exit(allRed ? 0 : 1);
