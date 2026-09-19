// mutate-f5.mjs — 9-1 F5 笔(NWT F4-1: 共享扫描器的 stripComments 换成 D26-scan v2.1 的状态机版)的变异对照(J2 2026-09-20)。
// 逐个破坏 kasia-console/test-fixtures/source-scan/scan-non-test-sources.mjs 里的 stripComments 状态机, 跑扫描器自测, 期望每个变异至少一条 [FAIL]。
// 每个锚点须恰命中 1 次; 每次 finally 还原并核 sha256。F4 笔的探针回归 + 扫描器变异(mutate-f4-scan.mjs)另行原样重跑(见 mutation-f4-scan-rerun-raw.txt)。
// 运行: node docs/provenance/2026-09-20-j2-batch9-f5-scan-strip-comments/mutate-f5.mjs <worktree 根绝对路径>
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = process.argv[2];
const CON = `${ROOT}/kasia-console`;
const SCANNER = `${CON}/test-fixtures/source-scan/scan-non-test-sources.mjs`;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const orig = fs.readFileSync(SCANNER), origSha = sha(orig), text = orig.toString('utf8');
const run = () => spawnSync(process.execPath, ['test-fixtures/source-scan/scan-non-test-sources.test.mjs'], { cwd: CON, encoding: 'utf8', timeout: 120000 });

const muts = [
  ['R-1 ▲ 整个退回旧的简单正则版(NWT F4-1 的三种漏报形态重现)', "let out = '', i = 0, state = 'code', quote = '', inClass = false;", "return src.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').replace(/(^|[^:'\"`])\\/\\/.*$/gm, '$1');\n  let out = '', i = 0, state = 'code', quote = '', inClass = false;"],
  ['R-2 ▲ 不识别字符串(引号不进字符串态)', "if (c === \"'\" || c === '\"' || c === '`') { state = 'str'; quote = c; out += c; i++; continue; }", 'if (false) { state = \'str\'; quote = c; out += c; i++; continue; }'],
  ['R-3 ▲ 模板字面量按单行处理(换行即退出字符串态)', "if (c === '\\n' && quote !== '`') { state = 'code'; }", "if (c === '\\n') { state = 'code'; }"],
  ['R-4 ▲ 不识别正则字面量(regexCanStart 恒 false: 字符类里的 /* 吞掉后面的真调用)', "if (c === '/' && regexCanStart()) {", "if (false) {"],
  ['R-5 除法当成正则(regexCanStart 恒 true)', "if (c === '/' && regexCanStart()) {", "if (c === '/' && true) {"],
  ['R-6 ▲ 正则字符类不处理(类内的 / 提前结束正则)', "if (c === '[') inClass = true; else if (c === ']') inClass = false;", "if (false) inClass = true;"],
  ['R-7 ▲ 字符串态不处理转义(转义引号提前结束字符串)', "    if (c === '\\\\') { out += c + (n ?? ''); i += 2; continue; }\n    if (c === quote)", "    if (c === quote)"],
  ['R-8 块注释不识别(/* … */ 被当成代码保留)', "if (c === '/' && n === '*') { state = 'block'; i += 2; continue; }", "if (false) { state = 'block'; i += 2; continue; }"],
  ['R-9 行注释不识别(// … 被当成代码保留)', "if (c === '/' && n === '/') { state = 'line'; i += 2; continue; }", "if (false) { state = 'line'; i += 2; continue; }"],
  ['R-10 代码态的转义不处理(反斜杠后的 / 仍可开注释)', "if (c === '\\\\') { out += c + (n ?? ''); i += 2; continue; }   // an escaped char in code never opens a comment", "if (false) { out += c + (n ?? ''); i += 2; continue; }"],
];

let allRed = true;
try {
  const base = run();
  console.log('基线(未变异) 扫描器自测:', (base.stdout || '').split('\n').filter((l) => /passed, \d+ failed/.test(l)).pop(), `exit=${base.status}`);
  if (base.status !== 0) allRed = false;
  for (const [name, find, repl] of muts) {
    const c = text.split(find).length - 1;
    if (c !== 1) { console.log(`[ERR ] ${name}: 变异锚点命中 ${c} 次(需要恰 1 次)——变异脚本与源码不同步`); allRed = false; continue; }
    fs.writeFileSync(SCANNER, text.replace(find, () => repl));
    const r = run();
    const failed = (r.stdout || '').split('\n').filter((l) => l.startsWith('[FAIL]'));
    const red = failed.length > 0 || r.status !== 0;
    if (!red) allRed = false;
    console.log(`${red ? '[RED ]' : '[GREEN⚠ 变异存活!]'} ${name}  →  ${failed.length} 条 FAIL${failed[0] ? `(首条: ${failed[0].replace(/^\[FAIL\]\s*/, '').split(/[ ⇒:(]/)[0]})` : ''}${failed.length === 0 && r.status !== 0 ? `(进程异常 exit=${r.status})` : ''}`);
    fs.writeFileSync(SCANNER, orig);
  }
} finally {
  fs.writeFileSync(SCANNER, orig);
  console.log(sha(fs.readFileSync(SCANNER)) === origSha ? `[RESTORED] scan-non-test-sources.mjs 已还原, sha256 ${origSha.slice(0, 16)}… 一致` : '[!!! 还原失败 !!!]');
}
console.log(allRed ? '\n全部变异均被测试抓到' : '\n⚠ 有变异存活或锚点失配, 见上');
process.exit(allRed ? 0 : 1);
