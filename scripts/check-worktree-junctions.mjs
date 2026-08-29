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
const SKIP_DIRS = new Set(['.git', 'node_modules']);   // node_modules 内部的链 (包自带) 不关心; node_modules 本身若是链会在上一层被列出

function worktrees() {
  const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' });
  const list = [];
  for (const block of out.split(/\n\n+/)) {
    const m = block.match(/^worktree (.+)$/m);
    if (m) list.push(resolve(m[1].trim()));
  }
  return list;   // 第一个 = 主树
}

function walk(root, dir, depth, found) {
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
    if (st.isDirectory() && !SKIP_DIRS.has(e.name)) walk(root, p, depth + 1, found);
  }
}

const wts = worktrees();
const main = wts[0];
const targets = SCAN_MAIN ? wts : wts.slice(1);
const found = [];
for (const wt of targets) walk(wt, wt, 0, found);

if (!found.length) {
  console.log(`[check-worktree-junctions] ✓ 0 reparse points in ${targets.length} worktree(s) (depth<=${MAX_DEPTH}${SCAN_MAIN ? ', incl. main' : ''})`);
  process.exit(0);
}
console.log(`[check-worktree-junctions] ✗ ${found.length} reparse point(s) — 删 worktree 前先拆链 (cmd: rmdir <link>), 见 ANTI-PATTERNS 规则 81`);
for (const f of found) {
  const t = resolve(f.target.replace(/^\\\\\?\\/, ''));
  const live = t.toLowerCase().startsWith((main + sep).toLowerCase()) || t.toLowerCase() === main.toLowerCase();
  console.log(`  ${f.root}${sep}${f.rel} -> ${f.target}${live ? '   →LIVE' : ''}`);
}
process.exit(1);
