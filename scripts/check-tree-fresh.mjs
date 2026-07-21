#!/usr/bin/env node
// check-tree-fresh — stale-tree guard (item②). WARN-NOT-BLOCK: 本地落后 canonical 太多 → LOUD warn 强制 sync 提示,
//   但绝不挡 commit (你可能有合法本地活)。含 PRESERVE-CHECK (J1 输入): 落后 + 本地独有 commit/uncommitted →
//   别 blind sync (会 NUKE 本地 fix·J1 :3300 unSafeJson patch 教训)·先 push/stash 再 sync。
//
// 起因 (2026-06-29, Owner 钦定根治): J1 :3300 worktree 159-behind canonical → grep 本地看 stale → 假阴性。
//   guard 在 commit 时(或常驻调用)LOUD warn 落后·当场抓 stale 节点。配 item① grep-canonical(grep 时认 canonical)。
//
// 用法:
//   node scripts/check-tree-fresh.mjs            # 检查并打印 (pre-commit hook 调·warn-not-block·恒退出 0)
//   node scripts/check-tree-fresh.mjs --strict   # behind>阈值 时退出 1 (可选·CI 用·非 pre-commit)
//
// 挂 pre-commit: 在 .git/hooks/pre-commit (或 lint-kanet 同链) 加 `node scripts/check-tree-fresh.mjs || true`
//   (|| true 确保 warn 不挡 commit)。

import { execFileSync } from 'node:child_process';

const STALE_THRESHOLD = 20;   // 本地落后 canonical 超此 → LOUD warn (同 grep-canonical 阈值)
const ROOT = process.env.KANET_ROOT || process.cwd();
const CANONICAL_BRANCH = process.env.KANET_CANONICAL_BRANCH || 'bshard-m3-deploy';

function git(args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (e) { return ''; }
}

const branch = CANONICAL_BRANCH;
// fetch quiet (拿最新 canonical·不动本地 HEAD/工作树)·失败不阻 (离线 commit 不该被挡)
try { execFileSync('git', ['fetch', '--quiet', 'origin', branch], { cwd: ROOT, stdio: 'ignore' }); }
catch { /* 离线/fetch 失败 → 用已有 remote-tracking, 不阻 */ }

const out = git(['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`]);
const [ahead, behind] = (out || '0\t0').split(/\s+/).map((n) => parseInt(n, 10) || 0);
const dirty = git(['status', '--porcelain']).length > 0;

const W = '\x1b[33m', R = '\x1b[31m', G = '\x1b[32m', X = '\x1b[0m';   // 颜色 (TTY)
const c = (col, s) => (process.stdout.isTTY ? col + s + X : s);

let stale = behind > STALE_THRESHOLD;
if (behind > STALE_THRESHOLD) {
  console.error(c(R, `🔴 STALE-TREE WARN: 本地 HEAD 落后 origin/${branch} ${behind} commits (> ${STALE_THRESHOLD})`));
  console.error(c(R, `   → grep/审码 本地代码会看 STALE 版本=假阴性风险 (J1 159-behind 教训)。`));
  if (ahead > 0 || dirty) {
    console.error(c(W, `   ⚠ PRESERVE-CHECK: 本地领先 ${ahead} commits${dirty ? ' + 有未提交改动' : ''} → 别 blind sync (会 NUKE 本地 fix):`));
    console.error(c(W, `     1) 先把本地独有 commit push canonical (git push origin HEAD:${branch}) 或 stash 未提交改动;`));
    console.error(c(W, `     2) 再 sync: git fetch && git merge origin/${branch} (或 rebase);`));
    console.error(c(W, `     3) grep/审码 用 scripts/grep-canonical.mjs (认 canonical 非本地)。`));
  } else {
    console.error(c(W, `   → 安全 sync (本地无独有 commit): git fetch && git merge origin/${branch}`));
  }
} else if (behind > 0) {
  console.error(c(W, `🟡 本地落后 origin/${branch} ${behind} commits (未超阈值 ${STALE_THRESHOLD})·审码建议用 grep-canonical。`));
} else {
  console.error(c(G, `✅ tree fresh: 本地与 origin/${branch} 同步 (behind=0, ahead=${ahead}${dirty ? ', 有未提交改动' : ''})`));
}

// warn-not-block: 默认恒退出 0 (不挡 commit)。--strict 才在 stale 时退出 1。
process.exit(process.argv.includes('--strict') && stale ? 1 : 0);
