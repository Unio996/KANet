#!/usr/bin/env node
// check-tests-fresh — 用例陈旧度提示。WARN-NOT-BLOCK, 恒退出 0(--strict 除外)。
//
// 起因(2026-07-28, NWT 06:38 实读 + J2 取证 + Bettor 06:50 裁定):
//   CLAUDE.md 曾写「修 bug 必同步加 regression case 守住, 永不退化」——而实测:
//   本仓无 CI、无 cron, `--domain`/`--all` 没有任何东西会去调它; m0c1-gate 那 10 个用例
//   甚至从未经 runner 跑过(证据: logs/test-runs 里没有任何一份带时间戳前缀的日志属于它们)。
//   ⇒ 那句话已按裁定先改成实况(commit 9b7e8916); 本脚本是配套的【提示】, 不是补上的哨兵。
//
// 🔴 它回答的是【有没有人在跑】, 不是【跑的结果对不对】——这句必须打在输出里, 不能只写在文档里
//   (Bettor 06:50: 写在文档里的边界没人读, 打在输出里的边界躲不掉)。
//
// 用法:
//   node scripts/check-tests-fresh.mjs             # pre-commit 调, warn-not-block, 恒退出 0
//   node scripts/check-tests-fresh.mjs --strict    # 超期时退出 1(CI 用, 非 pre-commit)
//   node scripts/check-tests-fresh.mjs --days=N     # 覆盖阈值(负样本测试用)
//
// 挂 pre-commit: `node scripts/check-tests-fresh.mjs || true`(同 check-tree-fresh)

import { readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// 🔴 note-1(NWT): 判据源不许被环境变量改。本仓有【树分离】先例(第二棵树) ——
//   若某人 shell 里 KANET_ROOT 指着另一棵树, hook 会去读【那棵树的】logs, 报的是别的仓库的
//   新鲜度, 而输出里看不出来。⇒ 用 git 顶层目录, 拿不到才回落 cwd; 不读 KANET_ROOT。
function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || process.cwd();
  } catch { return process.cwd(); }
}
const ROOT = repoRoot();
const CASES_DIR = path.join(ROOT, 'kasia-console', 'test-framework', 'cases');
const LOG_DIR = path.join(ROOT, 'logs', 'test-runs');
const argDays = (process.argv.find((a) => a.startsWith('--days=')) || '').split('=')[1];
const STALE_DAYS = Number(argDays || process.env.KANET_TESTS_STALE_DAYS || 7);

const W = '\x1b[33m', R = '\x1b[31m', G = '\x1b[32m', X = '\x1b[0m';
const c = (col, s) => (process.stdout.isTTY ? col + s + X : s);

// 🔴 判据源【只收 <name>-latest.json】, 不收 runner 产的带时间戳日志 —— 这一格是我自测时抓到的
//   自己的设计错, 记在这里防下一个人"修回去":
//   · <name>-latest.json 是覆盖式的 ⇒ 它的 mtime【就是那个用例最后一次运行的时刻】= 真信号
//   · 2026-07-13T11-32-31_xxx.log 是 runner 的历史存档 ⇒ 它【本来就该是旧的】, 老不代表没人跑
//   ⇒ 两者混在一起数, 得到的是 "208 份 · 194 份超期" 这种【看着吓人但没有意义】的分母,
//     而结论又由"最新那一份"决定 ⇒ 我今天跑了一个用例, 整套就显示 ✅ ——
//     🔴 那正是"一份新鲜盖住一片陈旧"的形状, 与本脚本要防的病同族。
function collect() {
  if (!existsSync(LOG_DIR)) return [];
  const out = [];
  for (const name of readdirSync(LOG_DIR)) {
    if (!name.endsWith('-latest.json')) continue;   // 一个用例一份, mtime = 该用例最后一次跑
    try { out.push({ name, mtime: statSync(path.join(LOG_DIR, name)).mtimeMs }); } catch { /* 读不到就跳过 */ }
  }
  return out;
}

// 🔴 MUST-FIX(NWT 06:58): 上面那个 collect() 数的是【留下过证据的】, 不是【存在的】——
//   而一个【从来没跑过】的用例根本没有证据文件 ⇒ 对本检查【完全不可见】: 不计数、不点名、不告警。
//   ⇒ 于是那行 "8 个用例 · 0 个超期" 的真实含义是「曾经跑过的那 8 个里没有超期的」,
//     而一百多个从来没跑过的, 它一个字都不会说。
//   🔴 最要紧的是: 本检查诞生的原因正是「m0c1-gate 那 10 个从未经 runner 跑过」——
//     若不把总数数进来, 它【防不住那个让它诞生的病】。
//   🔵 形状: 【被数到的那群】盖住【没被数到的那群】(与本文件上一版"新鲜存档盖住陈旧存档"同族, 上一层)。
function countCases() {
  let discoverable = 0, undiscoverable = 0;   // *.test.mjs(runner 收) vs 其它 .mjs(runner 收不到)
  const walk = (dir) => {
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.mjs')) continue;
      if (e.name.endsWith('.test.mjs')) discoverable++; else undiscoverable++;
    }
  };
  if (existsSync(CASES_DIR)) walk(CASES_DIR);
  return { discoverable, undiscoverable, total: discoverable + undiscoverable };
}

const files = collect();
const ageDays = (ms) => (Date.now() - ms) / 86_400_000;

// 🔴 分母是硬要求(Bettor): 只报"最近一次多久前"时, 【一个都没有】与【刚跑过】读数会靠得太近。
if (files.length === 0) {
  console.error(c(R, `🔴 TESTS-FRESH: logs/test-runs 里【一份运行证据都没有】(0 份)`));
  console.error(c(R, `   → 这不是"测试都过了", 是"没有任何运行留下过痕迹"。两者读数不同, 别混。`));
  console.error(c(W, `   ⓘ 本检查回答的是【有没有人在跑】, 不是【跑的结果对不对】——它是陈旧度提示, 不是验收闸。`));
  process.exit(process.argv.includes('--strict') ? 1 : 0);
}

files.sort((a, b) => b.mtime - a.mtime);
const newest = files[0];
const newestAge = ageDays(newest.mtime);
const staleFiles = files.filter((f) => ageDays(f.mtime) > STALE_DAYS);
const staleCount = staleFiles.length;
// 🔴 判据是【有没有用例超期】, 不是【最新那一份多新】——
//   后者会让"我今天跑了其中一个"把其余全部盖绿(自测时实际发生过, 见 collect() 上方那段)。
const stale = staleCount > 0;

// 🔴 分母是【存在的用例总数】, 不是【留下过证据的数量】(NWT MUST-FIX)
const cases = countCases();
const neverRan = Math.max(0, cases.total - files.length);
const denom = `${files.length} / ${cases.total} 个用例有过运行证据 · ${staleCount} 个超 ${STALE_DAYS} 天 · 最近一次 ${newestAge.toFixed(1)} 天前(${newest.name.replace('-latest.json', '')})`;

if (stale) {
  console.error(c(R, `🔴 TESTS-STALE WARN: ${denom}`));
  for (const f of staleFiles.sort((a, b) => a.mtime - b.mtime).slice(0, 5)) {
    console.error(c(R, `     · ${f.name.replace('-latest.json', '')} — ${ageDays(f.mtime).toFixed(1)} 天前`));
  }
  if (staleCount > 5) console.error(c(R, `     · …另外 ${staleCount - 5} 个`));
  console.error(c(R, `   → 本仓【没有自动回归】: 无 CI、无 cron, --domain/--all 没有任何东西会去调它。`));
  console.error(c(W, `   → 要跑: cd kasia-console && node scripts/test.mjs --domain=<domain>`));
} else {
  console.error(c(G, `✅ tests fresh: ${denom}`));
}
// 🔴 无论红绿都打的两行边界 —— 边界不能只在报警时出现, 否则绿色那次就没人看见它
if (neverRan > 0) {
  console.error(c(R, `   🔴 而 ${neverRan} 个用例【从来没有运行证据】—— 本检查对它们无话可说。`));
  console.error(c(R, `      (其中 ${cases.undiscoverable} 个连 --domain/--all 都扫不到: 文件名不匹配 runner 的 *.test.mjs)`));
}
console.error(c(W, `   ⓘ 本检查回答的是【有没有人在跑】, 不是【跑的结果对不对】——它是陈旧度提示, 不是验收闸。`));
// 🔴 note-2(NWT): -latest.json 在【失败时也会被写】(用例先 writeFileSync 再按 fail 决定退出码)
//   ⇒ "fresh" 可能是"刚跑过而且是红的"。而那些文件里就有 summary:{pass,fail} —— 数据在手边而不读。
//   🔴 这是【刻意的】, 不是漏: 本脚本只做陈旧度提示。一旦它开始读 pass/fail, 它就从"提示"
//   变成了"验收闸", 而那正是上面那句边界要防的误读 —— 到那时"绿"会被当成"测试都过了"。
//   ⇒ 谁要加"顺手把结果也读了", 请先改掉上面那句边界, 别让两者互相矛盾。

process.exit(process.argv.includes('--strict') && stale ? 1 : 0);
