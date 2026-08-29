#!/usr/bin/env node
// check-worktree-junctions.mjs — 列出所有 git worktree（主树除外）里的 reparse point（junction / symlink），删 worktree 前必跑。
// 背景: ANTI-PATTERNS 规则 81 (2026-08-29): `git worktree remove` / 递归删除会顺着 junction 进目标 —— 一次删侧树删掉了 live
//       kasia-console/node_modules 85 个顶层包。删前先 `rmdir <link>` (cmd) / `[System.IO.Directory]::Delete(link,false)` 拆链。
// 用法: node scripts/check-worktree-junctions.mjs [--depth N] [--all]      (默认 depth 4; --all 也扫主树)
// 退出码: 0 = 无链; 1 = 有链 (每条一行 "<worktree> <相对路径> -> <目标>", 指向主树的标 "→LIVE")
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const argv = process.argv.slice(2);
const depthArg = argv.indexOf('--depth');
const MAX_DEPTH = depthArg >= 0 ? Number(argv[depthArg + 1]) || 4 : 4;
const SCAN_MAIN = argv.includes('--all');
const SKIP_DIRS = new Set(['.git']);
// node_modules: 只看一层 (顶层包 + @scope/*), 不再深入 —— 设计内的 `node_modules/kaspa-wasm → <本树>/shared/vendor/kaspa-wasm` 就在这一层;
// 更深的链是包自带, 不关心。
const NM_MAX_EXTRA = 2;   // node_modules/<pkg> 与 node_modules/@scope/<pkg>

function worktrees() {
  const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' });
  const list = [];
  for (const block of out.split(/\n\n+/)) {
    const m = block.match(/^worktree (.+)$/m);
    if (m) list.push(resolve(m[1].trim()));
  }
  return list;   // 第一个 = 主树
}

function walk(root, dir, depth, found, nmExtra) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) {          // Windows: junction 与 symlink 在 lstat 下都是 isSymbolicLink()
      let target = '?';
      try { target = readlinkSync(p); } catch {}
      found.push({ root, rel: p.slice(root.length + 1), target });
      continue;                          // 不进链
    }
    if (!st.isDirectory() || SKIP_DIRS.has(e.name)) continue;
    if (nmExtra > 0) { if (nmExtra > 1 || e.name.startsWith('@')) walk(root, p, depth + 1, found, nmExtra - 1); continue; }   // node_modules 内: 只再进 @scope 一层
    walk(root, p, depth + 1, found, e.name === 'node_modules' ? NM_MAX_EXTRA : 0);
  }
}

const under = (t, base) => { const a = t.toLowerCase(), b = base.toLowerCase(); return a === b || a.startsWith(b + sep); };
const wts = worktrees();
const main = wts[0];
const targets = SCAN_MAIN ? wts : wts.slice(1);
const found = [];
for (const wt of targets) walk(wt, wt, 0, found, 0);

// 分类: internal = 目标在链所在的 worktree 自己里面 (设计内, 如 node_modules/kaspa-wasm → <本树>/shared/vendor/kaspa-wasm) —— 列出但不算错;
//       →LIVE  = 目标在主树里而链不在主树 (删 worktree 会穿进 live);  external = 其它树/别处。 非 internal 一律 exit 1。
const rows = found.map((f) => {
  const t = resolve(f.target.replace(/^\\\\\?\\/, ''));
  const kind = under(t, f.root) ? 'internal' : (under(t, main) ? '→LIVE' : 'external');
  return { ...f, kind };
});
const bad = rows.filter((r) => r.kind !== 'internal');
for (const r of rows) console.log(`  ${r.kind === 'internal' ? '(internal)' : r.kind.padEnd(10)} ${r.root}${sep}${r.rel} -> ${r.target}`);
if (!bad.length) {
  console.log(`[check-worktree-junctions] ✓ 0 cross-tree reparse points in ${targets.length} worktree(s) (${rows.length} internal, depth<=${MAX_DEPTH}${SCAN_MAIN ? ', incl. main' : ''})`);
  process.exit(0);
}
console.log(`[check-worktree-junctions] ✗ ${bad.length} cross-tree reparse point(s) (${rows.length - bad.length} internal) — 删 worktree 前先拆链 (cmd: rmdir <link> / [System.IO.Directory]::Delete(link,$false)), 见 ANTI-PATTERNS 规则 81`);
process.exit(1);
