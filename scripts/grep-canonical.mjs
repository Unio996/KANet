#!/usr/bin/env node
// grep-canonical — grep the CANONICAL (origin) version of tracked files, never stale local.
//
// 起因 (2026-06-29, Owner 钦定根治 stale-grep 假阴性): 多 agent 共享 working tree, 本地分支落后
//   canonical (origin) → agent grep 本地代码看 stale 版本 → 连环假阴性 (J1 §(c): 159-behind 本地
//   kanet-broker.js 198 行缺 bots 端点·canonical 384 行有 → 误报"端点不存在"·浪费团队半小时 ping-pong)。
//   根治 = 凡审码/grep "现有 API/资产/已存在" 声明, 必 grep CANONICAL 非本地。本工具 = item①。
//
// 用法:
//   node scripts/grep-canonical.mjs <pattern> [pathspec...]            # grep origin/<本分支 upstream>
//   node scripts/grep-canonical.mjs <pattern> --branch <branch> [path] # 指定 canonical 分支
//   node scripts/grep-canonical.mjs --behind                           # 只查本地落后 canonical 多少 (item② 雏形)
//
// 行为: ① git fetch origin <branch> (quiet, 拿最新 canonical, 不动本地工作树/HEAD)
//       ② git grep -n <pattern> origin/<branch> -- <pathspec> (grep 那个 revision, 非本地文件)
//       ③ banner 明示 "CANONICAL origin/<branch>" + 本地 behind/ahead 计数 (stale 时 LOUD warn)
//
// 退出码: 0 = 有匹配, 1 = 无匹配, 2 = 错误 (fetch/分支不存在)。

import { execFileSync } from 'node:child_process';

const STALE_THRESHOLD = 20;   // 本地落后 canonical 超此 → LOUD warn 强制 sync 提示 (item② 阈值)
const ROOT = process.env.KANET_ROOT || process.cwd();
// 🔴 团队 canonical 分支 = 显式常量 (CLAUDE.md 主开发分支), 绝不 auto-resolve 本地 HEAD 的 @{u} upstream:
//   实测教训 (2026-06-29 本工具自测抓到): HEAD 在 bshard-m3-deploy 但其 upstream 配成 origin/j2-bshard-payout
//   (personal 分支) → @{u} 解析到 personal 分支 → grep 错版本 = 正是本工具要防的 stale/wrong-version 假阴性。
//   ∴ canonical 必显式。--branch 可覆盖 (跨分支审码时)。
const CANONICAL_BRANCH = process.env.KANET_CANONICAL_BRANCH || 'bshard-m3-deploy';

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}
function gitQuiet(args) {
  try { return git(args).trim(); } catch (e) { return ''; }
}

function resolveBranch(explicit) {
  // 显式 --branch 优先; 否则团队 canonical 常量 (绝不用 @{u}, 那会解析到 personal 分支 = bug 根因)。
  return explicit || CANONICAL_BRANCH;
}

function behindAhead(branch) {
  // left=本地领先(ahead), right=本地落后(behind)
  const out = gitQuiet(['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`]);
  const [ahead, behind] = out.split(/\s+/).map((n) => parseInt(n, 10) || 0);
  return { ahead, behind };
}

function staleBanner(branch) {
  const { ahead, behind } = behindAhead(branch);
  const lines = [];
  if (behind > STALE_THRESHOLD) {
    lines.push(`🔴 STALE-TREE WARN: 本地 HEAD 落后 origin/${branch} ${behind} commits (> ${STALE_THRESHOLD})`);
    if (ahead > 0) lines.push(`   ⚠ 同时本地领先 ${ahead} commits → PRESERVE-CHECK: 先 push/stash 本地独有改动再 sync (别 blind sync NUKE 本地 fix·J1 :3300 unSafeJson patch 教训)`);
    else lines.push(`   → 安全 sync: git fetch && git merge origin/${branch} (本地无独有 commit)`);
  } else if (behind > 0) {
    lines.push(`🟡 本地落后 origin/${branch} ${behind} commits (未超阈值 ${STALE_THRESHOLD}, 但 grep 已用 canonical 不受影响)`);
  } else {
    lines.push(`✅ 本地与 origin/${branch} 同步 (behind=0, ahead=${ahead})`);
  }
  return lines.join('\n');
}

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
  console.log('用法: node scripts/grep-canonical.mjs <pattern> [pathspec...] [--branch <branch>]');
  console.log('     node scripts/grep-canonical.mjs --behind [--branch <branch>]   # 只查 stale 状态');
  process.exit(argv.length === 0 ? 2 : 0);
}

// 解析 --branch
let branch = null;
const bi = argv.indexOf('--branch');
if (bi >= 0) { branch = argv[bi + 1]; argv.splice(bi, 2); }
branch = resolveBranch(branch);

// fetch canonical (quiet, 不改本地 HEAD/工作树)
try { git(['fetch', '--quiet', 'origin', branch]); }
catch (e) { console.error(`🔴 git fetch origin ${branch} 失败: ${(e.stderr || e.message || '').toString().slice(0, 200)}`); process.exit(2); }

// --behind 模式: 只报 stale 状态
if (argv.includes('--behind')) { console.log(staleBanner(branch)); process.exit(0); }

const pattern = argv[0];
const pathspec = argv.slice(1);

console.log(`=== grep CANONICAL origin/${branch} (非本地·防 stale 假阴性) ===`);
console.log(staleBanner(branch));
console.log('');

let matched = false;
try {
  // -E = extended regex (alternation (a|b)/+/? 直觉可用·同 ripgrep/egrep); -I = 跳过二进制
  const out = git(['grep', '-n', '-E', '-I', '-e', pattern, `origin/${branch}`, ...(pathspec.length ? ['--', ...pathspec] : [])]);
  process.stdout.write(out);
  matched = out.trim().length > 0;
} catch (e) {
  // git grep 退出码 1 = 无匹配 (非错误)
  if (e.status === 1) matched = false;
  else { console.error(`🔴 git grep 错误: ${(e.stderr || e.message || '').toString().slice(0, 200)}`); process.exit(2); }
}
if (!matched) console.log(`(canonical origin/${branch} 无匹配 "${pattern}")`);
process.exit(matched ? 0 : 1);
