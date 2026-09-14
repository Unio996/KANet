#!/usr/bin/env node
// check-worktree-junctions.mjs — 列出所有 git worktree（主树除外）里的 reparse point（junction / symlink），删 worktree 前必跑。
// 背景: ANTI-PATTERNS 规则 81 (2026-08-29): `git worktree remove` / 递归删除会顺着 junction 进目标 —— 一次删侧树删掉了 live
//       kasia-console/node_modules 85 个顶层包。删前先 `rmdir <link>` (cmd) / `[System.IO.Directory]::Delete(link,false)` 拆链。
// 用法: node scripts/check-worktree-junctions.mjs [--depth N] [--all] [--extra-root=<path> ...]
//   (默认 depth 4; --all 也扫主树; --extra-root 可重复, 追加到规则81(h)默认扫的那批额外根之外)
// 退出码: 0 = 无链; 1 = 有链 (每条一行 "<worktree> <相对路径> -> <目标>", 指向主树的标 "→LIVE"); 3 = 扫描自身出错
//   (2026-09-14, Bettor 1287 派工, J2 审 GREEN-with-notes 采纳): git worktree list 失败 (.git 损坏/git 不在
//   PATH/其它扫描期异常) 与"扫完了、真的找到坏链"是两件不同的事——前者是"这次检查没有真的跑完，不能确定
//   干不干净"，后者是"确实跑完了、确实脏"。两者都拦 (都是非零退出码，pre-commit/推送闸两处都会挡)，但退出码
//   分开，方便接哪个闸的人事后一眼看出是哪一档 (不需要读日志文本猜)。
// 规则81(h) (2026-09-14, Bettor 1318 派工): 原实现只扫 `git worktree list` 里注册过的树——Bettor 在一个
// 未注册的残留目录 `D:\kanet-tn12-wt-6b73` 里发现 `kasia-console\node_modules` 是指向活 node_modules 的
// junction, 脚本对此完全看不见(不在 worktree 列表里, 从不会被 walk 到)。本版本默认额外扫两类"未注册但
// 可能残留活链接"的根: ① 主树所在盘符顶层所有 `kanet*` 目录 (如 `D:\kanet-tn12`/`D:\kanet-g5-test-wt`/
// 残留的 `D:\kanet-tn12-wt-6b73` 这种); ② 主树 `scratch/` 下的全部子目录(含未经 `git worktree add` 直接
// 手工建的残留)。这两类默认**始终扫**, 不受 `--all` 控制(`--all` 只管"要不要连主树自己一起扫", 跟"要不要
// 扫未注册残留"是两件事)。输出里这类根标 `(unregistered)`, 分类判据(internal/→LIVE/external)与已注册
// worktree 完全一致, 判定为坏一样 exit(1)。
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const argv = process.argv.slice(2);
const depthArg = argv.indexOf('--depth');
const MAX_DEPTH = depthArg >= 0 ? Number(argv[depthArg + 1]) || 4 : 4;
const SCAN_MAIN = argv.includes('--all');
const EXTRA_ROOTS_CLI = argv.filter((a) => a.startsWith('--extra-root=')).map((a) => a.slice('--extra-root='.length));
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

function walk(root, dir, depth, found, nmExtra, unregistered = false) {
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
      found.push({ root, rel: p.slice(root.length + 1), target, unregistered });
      continue;                          // 不进链
    }
    if (!st.isDirectory() || SKIP_DIRS.has(e.name)) continue;
    if (OTHER_ROOTS.has(p.toLowerCase())) continue;   // 别的 worktree/额外根 嵌在本树下 (如主树 scratch/_wt_*): 归它自己那轮扫, 不重复计
    if (nmExtra > 0) { if (nmExtra > 1 || e.name.startsWith('@')) walk(root, p, depth + 1, found, nmExtra - 1, unregistered); continue; }   // node_modules 内: 只再进 @scope 一层
    walk(root, p, depth + 1, found, e.name === 'node_modules' ? NM_MAX_EXTRA : 0, unregistered);
  }
}

// 规则81(h): 枚举"未注册但可能残留活链接"的额外根——盘符顶层 kanet* 目录 + 主树 scratch/ 下全部子目录 +
// --extra-root CLI 追加, 去重并排除已经在 `git worktree list` 里注册过的(那些走既有 targets 逻辑, 不重复)。
function unregisteredRoots(wts, mainTree) {
  const registered = new Set(wts.map((w) => w.toLowerCase()));
  const drive = mainTree.slice(0, 3);   // e.g. "D:\\" — 跟主树同盘符, 不硬编码盘符字母
  const candidates = [];

  try {
    for (const e of readdirSync(drive, { withFileTypes: true })) {
      if (e.isDirectory() && /^kanet/i.test(e.name)) candidates.push(resolve(join(drive, e.name)));
    }
  } catch (err) {
    console.error(`[check-worktree-junctions] ⚠ 无法列出盘符顶层目录 ${drive}: ${err.message} — 规则81(h)这一部分未能扫, 其余部分继续`);
  }

  const scratchDir = join(mainTree, 'scratch');
  try {
    for (const e of readdirSync(scratchDir, { withFileTypes: true })) {
      if (e.isDirectory()) candidates.push(resolve(join(scratchDir, e.name)));
    }
  } catch { /* scratch/ 不存在不算错误(某些检出可能没有), 不影响其余扫描 */ }

  for (const p of EXTRA_ROOTS_CLI) candidates.push(resolve(p));

  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const key = c.toLowerCase();
    if (registered.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

const under = (t, base) => { const a = t.toLowerCase(), b = base.toLowerCase(); return a === b || a.startsWith(b + sep); };
// walk() 闭包读这个变量; worktrees() 可能抛 (git 失败), 所以赋值挪进下面的 try 里, 声明留在外层用 let
// (walk() 定义在前面, 引用的是同一个绑定, 不需要传参)。
let OTHER_ROOTS;

try {
  const wts = worktrees();
  const main = wts[0];
  const targets = SCAN_MAIN ? wts : wts.slice(1);
  OTHER_ROOTS = new Set(wts.map((w) => w.toLowerCase()));

  // 规则81(h): 未注册的额外根 — 始终扫(不受 --all 控制, 那个旗标只管主树自己扫不扫)。加进
  // OTHER_ROOTS 防止 --all 扫主树时重复递归进 scratch/ 下同一批目录(它们各自单独拿到一轮扫)。
  const extraRoots = unregisteredRoots(wts, main);
  for (const r of extraRoots) OTHER_ROOTS.add(r.toLowerCase());

  const found = [];
  for (const wt of targets) walk(wt, wt, 0, found, 0, false);
  for (const r of extraRoots) walk(r, r, 0, found, 0, true);

  // 分类: internal = 目标在链所在的 worktree/额外根 自己里面 (设计内, 如 node_modules/kaspa-wasm →
  //       <本树>/shared/vendor/kaspa-wasm) —— 列出但不算错;
  //       →LIVE  = 目标在主树里而链不在主树 (删 worktree/残留目录 会穿进 live);
  //       external = 其它树/别处。 非 internal 一律 exit 1, 未注册根同一套判据、同样拦。
  const rows = found.map((f) => {
    const t = resolve(f.target.replace(/^\\\\\?\\/, ''));
    const kind = under(t, f.root) ? 'internal' : (under(t, main) ? '→LIVE' : 'external');
    return { ...f, kind };
  });
  const bad = rows.filter((r) => r.kind !== 'internal');
  for (const r of rows) {
    const tag = r.unregistered ? '(unregistered) ' : '';
    const kindLabel = r.kind === 'internal' ? '(internal)' : r.kind.padEnd(10);
    console.log(`  ${tag}${kindLabel} ${r.root}${sep}${r.rel} -> ${r.target}`);
  }
  if (!bad.length) {
    console.log(`[check-worktree-junctions] ✓ 0 cross-tree reparse points in ${targets.length} worktree(s) + ${extraRoots.length} unregistered root(s) (${rows.length} internal, depth<=${MAX_DEPTH}${SCAN_MAIN ? ', incl. main' : ''})`);
    process.exit(0);
  }
  console.log(`[check-worktree-junctions] ✗ ${bad.length} cross-tree reparse point(s) (${rows.length - bad.length} internal) — 删 worktree 前先拆链 (cmd: rmdir <link> / [System.IO.Directory]::Delete(link,$false)), 见 ANTI-PATTERNS 规则 81`);
  process.exit(1);
} catch (err) {
  console.error(`[check-worktree-junctions] ⚠ 扫描自身出错 (不是"扫完发现坏链", 是"没能扫完")——git worktree list 失败或扫描期异常, 无法确认干不干净, 按 fail-closed 处理(仍然拦, 但用退出码 3 跟"确实扫完了、确实有坏链"的退出码 1 分开):`);
  console.error(`  ${err?.message || err}`);
  process.exit(3);
}
