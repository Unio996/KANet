#!/usr/bin/env node
// R-DOC-PATH 回归用例 (ledger 1748, 2026-09-27, KANet-UI 修 · NWT 待审)。
//
// 证明 checkDocPath() 从 readdirSync 物理扫全仓改成 git ls-files 之后, 两件事都还成立:
//   ① 规则本意没被放掉——一个真被 git track 的、放错位置的 date-prefix 设计文档仍然报错。
//   ② 误报真的没了——.gitignore 排除的目录(如 docs-private/)里的 date-prefix 文件不再被当作
//      "设计文档放错位置"报出来(它们本来就不打算进仓库, 不存在"进了仓库但位置错"这回事)。
//
// 跑法: node scripts/lint-kanet-docpath-regression-test.mjs (无参, 从仓库根目录跑)。
// 本用例会短暂 git add 一个探针文件再撤掉(不留痕迹), 不改动任何真实内容, 对 docs-private/ 只读不写。
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LINT = join(ROOT, 'scripts', 'lint-kanet.mjs');

function runLint(fileArgs) {
  try {
    const out = execFileSync(process.execPath, [LINT, ...fileArgs], { cwd: ROOT, encoding: 'utf8' });
    return { status: 0, out };
  } catch (e) {
    return { status: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

let failures = 0;

// ── ① 被跟踪的、放错位置的 date-prefix 文档必须仍然报错 ──
const probeRel = 'kasia-console/2026-09-27-kanetui-lint-docpath-regression-probe.md';
const probeAbs = join(ROOT, probeRel);
let probeStaged = false;
try {
  writeFileSync(probeAbs, '# regression probe — R-DOC-PATH must still catch this, deleted immediately after this test runs\n');
  execFileSync('git', ['add', probeRel], { cwd: ROOT });
  probeStaged = true;
  const r1 = runLint(['kasia-console/src/lib/checkout-static/checkout.js']);
  if (r1.status === 0 || !r1.out.includes('R-DOC-PATH') || !r1.out.includes(probeRel.replace(/\//g, '\\'))) {
    console.error('✗ ① FAIL: 被跟踪的放错位置文档没有被 R-DOC-PATH 拦下——规则被误放宽了。');
    console.error(r1.out.slice(-1500));
    failures++;
  } else {
    console.log('✓ ① PASS: 被跟踪的放错位置 date-prefix 文档仍被 R-DOC-PATH 拦下(规则本意保留)。');
  }
} finally {
  if (probeStaged) { try { execFileSync('git', ['restore', '--staged', probeRel], { cwd: ROOT }); } catch {} }
  if (existsSync(probeAbs)) rmSync(probeAbs);
}

// ── ② docs-private/(.gitignore 排除, D-021 敏感留存区)不再被误报 ──
// 自建一份合成 fixture(不依赖某个具体 agent 的真实文件是否还在这台检出上——worktree 之间互不共享
// 未跟踪文件, 依赖真实样本会导致本用例在别的 worktree 里假 SKIP), 用完立刻删, 从不 git add。
const ignoredDirAbs = join(ROOT, 'docs-private');
const ignoredFileAbs = join(ignoredDirAbs, '2026-09-27-kanetui-lint-docpath-regression-ignored-probe.md');
const ignoredDirPreexisting = existsSync(ignoredDirAbs);
try {
  const ignoreCheck = (() => {
    try { execFileSync('git', ['check-ignore', 'docs-private/probe.md'], { cwd: ROOT }); return true; }
    catch { return false; }
  })();
  if (!ignoreCheck) {
    console.error('✗ ② FAIL(前置条件): docs-private/ 在这个检出里没有被 .gitignore 排除——无法验证误报是否修好, 环境跟预期不符。');
    failures++;
  } else {
    if (!ignoredDirPreexisting) mkdirSync(ignoredDirAbs);
    writeFileSync(ignoredFileAbs, '# regression probe — gitignored, must NOT be reported by R-DOC-PATH\n');
    const r2 = runLint(['kasia-console/src/lib/checkout-static/checkout.js']);
    if (r2.out.includes('regression-ignored-probe')) {
      console.error('✗ ② FAIL: docs-private/ 下的 gitignored 文件仍被 R-DOC-PATH 报出——误报没修好。');
      failures++;
    } else {
      console.log('✓ ② PASS: docs-private/(gitignored)下新建的 date-prefix 文件不再被 R-DOC-PATH 误报。');
    }
  }
} finally {
  if (existsSync(ignoredFileAbs)) rmSync(ignoredFileAbs);
  if (!ignoredDirPreexisting && existsSync(ignoredDirAbs)) { try { rmSync(ignoredDirAbs, { recursive: true }); } catch {} }
}

if (failures > 0) { console.error(`\n[lint-kanet-docpath-regression-test] ${failures} 项失败`); process.exit(1); }
console.log('\n[lint-kanet-docpath-regression-test] 全部通过');
