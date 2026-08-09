#!/usr/bin/env node
/**
 * 部署漂移自查 —— 回答一个今天真咬到人的问题:
 *   **我复核/推送的那份, 和【正在跑】的那份, 差了多远?**
 *
 * 病史(2026-08-09): 我一天里推了四个探针修复、被独立复核三次、每次都写"已推 xxxxxxxx",
 * 而 watchdog 实际调用的是 `D:\kaspa-tn12-mining\tn12-dag-health-probe.mjs` —— 一份 08:36 的副本,
 * 四个修复一个都没有。**整轮复核是对着没在跑的代码做的。**
 * 同族: CLAUDE.md 铁律 0.5 记的 silverc OP_PICK 修复只活在一个未推的本地分支上。
 * 共同点: **承重的东西住在 git 之外, 而没有任何检查会发现它陈了** —— 直到下一次有人依赖它。
 *
 * 🔴 本工具【去发现, 不去记住】: 不维护"哪些文件被部署了"的名单。名单会漏, 而漏掉的那份
 *    不会有任何提示(正是 memory: enumerating-tools-must-discover-not-remember)。
 *    做法: 扫部署根目录下的所有文件, 凡 basename 在仓库里有同名文件的, 就比哈希。
 *    ⇒ 一份我从不知道存在的副本, 也会被抓出来。
 *
 * 用法:
 *   node scripts/check-deployed-drift.mjs                     # 只查本机部署根
 *   DRIFT_SSH=<user@挖矿机> node scripts/check-deployed-drift.mjs   # 连远端一起查
 *
 * 🔴 这里【故意用占位符】而不是真实 user@host, 原因是实账不是洁癖:
 *    我第一版在这写了具体的 `admin@<点分四段>`, 然后把这一行【原样 copy 进了 dev-coord 频道】——
 *    而那个频道是【链上明文, 永久且公开】, 发出去撤不回。@J2 与 @Bettor 当场抓到。
 *    🔨 判据: **用法示例是最有说服力的指路牌** —— 是这行注释教我泄的, 不是我一时忘了纪律。
 *    ⇒ 具体连接目标放本地 env / `kanet.env` / `scratch/`, 不进注释、不进 commit、不进频道。
 *    ⚠ 作用域: 本条只处理【我这个工具的传播路径】。同一地址在本仓多处文档与
 *      `kasia-console/src/services/zk-prove-server.mjs` 里早已存在 —— 那是另一件事, 我没动, 也不假装动了。
 * 环境:
 *   DRIFT_ROOTS   逗号分隔的部署根目录(默认见下)
 *   DRIFT_SSH     远端 user@host; 设了就用 PowerShell Get-FileHash 远程算
 *
 * ⚠ 认证来源(@NWT 复核时问的, 确实该写出来): SSH 参数里强制 `PreferredAuthentications=password`
 *   且 `PubkeyAuthentication=no`, 而脚本里【看不到任何密码】—— 密码由调用方经 OpenSSH 的
 *   `SSH_ASKPASS` + `SSH_ASKPASS_REQUIRE=force` 提供(本机放在 scratch/ 的一个 askpass 脚本)。
 *   ⇒ 直接 `node scripts/check-deployed-drift.mjs` 带 DRIFT_SSH 跑而没配 askpass 的人会卡在认证上,
 *     那不是 bug。**不配置就走本机模式**(不设 DRIFT_SSH), 一样能查本机可达的部署根。
 */
import fsx from 'node:fs';
import pathx from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = pathx.resolve(pathx.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = (process.env.DRIFT_ROOTS || 'D:/kaspa-tn12-mining,D:/kanet-tn12/scripts').split(',').map((s) => s.trim()).filter(Boolean);
const SSH = process.env.DRIFT_SSH || '';

// 🔴 行尾会制造假漂移, 而【单边归一会制造另一种假漂移】—— 我两个都撞了, 第二个更难看:
//  ① 不归一: 远端是 LF 检出、我的 Windows 工作副本是 CRLF ⇒ 内容相同却报漂移(探针那份就是)。
//  ② 只归一仓库侧: 远端给的是 PowerShell Get-FileHash 的【raw】哈希, 与我归一后的哈希永远对不上
//     ⇒ 我据此差点报出"在跑的 watchdog 与仓库任何版本都不匹配"这个【假发现】。
//     实际它与 scripts/ 那份【逐字节相同】(两次运行的 raw 哈希 3043b3e7de57 完全一致)。
// ⇒ 正确做法: 仓库侧同时算 raw 与归一两个哈希, 远端的 raw 哈希命中任一即算一致。
const shaRaw = (buf) => createHash('sha256').update(buf).digest('hex');
const shaNorm = (buf) => createHash('sha256')
  .update(Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')).digest('hex');
const bothHashes = (buf) => [shaRaw(buf), shaNorm(buf)];

// 仓库侧: 按 basename 建索引。同名多路径也留着 —— 那本身就是个该被看见的歧义。
const repoByName = new Map();
(function walk(dir) {
  for (const e of fsx.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
    const p = pathx.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(mjs|js|ps1|sh|cjs)$/.test(e.name)) {
      if (!repoByName.has(e.name)) repoByName.set(e.name, []);
      repoByName.get(e.name).push(p);
    }
  }
})(REPO);

let drifted = 0, matched = 0, ambiguous = 0, unreachable = 0;
const say = (s) => console.log(s);

function compare(name, deployedPath, deployedHash, deployedMtime) {
  const candidates = repoByName.get(name) || [];
  if (!candidates.length) return;                       // 部署目录里的私有文件, 与仓库无关
  const pairs = candidates.map((p) => bothHashes(fsx.readFileSync(p)));
  if (pairs.some(([r, n]) => r === deployedHash || n === deployedHash)) { matched++; return; }
  const hashes = pairs.map(([r]) => r);
  drifted++;
  if (candidates.length > 1) ambiguous++;
  say(`🔴 漂移  ${deployedPath}`);
  say(`        部署 ${deployedHash.slice(0, 12)}  mtime=${deployedMtime}`);
  for (let i = 0; i < candidates.length; i++) {
    const rel = pathx.relative(REPO, candidates[i]);
    const st = fsx.statSync(candidates[i]);
    say(`        仓库 ${hashes[i].slice(0, 12)}  ${rel}  mtime=${st.mtime.toISOString().slice(0, 16).replace('T', ' ')}`);
  }
}

// ---- 本机部署根 ----
for (const root of ROOTS) {
  if (SSH) break;                                        // 走远端时本地路径通常不存在, 别产生噪音
  if (!fsx.existsSync(root)) { say(`⏭ 跳过(本机不存在): ${root}`); continue; }
  (function walkDep(dir) {
    for (const e of fsx.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = pathx.join(dir, e.name);
      if (e.isDirectory()) walkDep(p);
      else if (/\.(mjs|js|ps1|sh|cjs)$/.test(e.name)) {
        const st = fsx.statSync(p);
        compare(e.name, p, shaRaw(fsx.readFileSync(p)), st.mtime.toISOString().slice(0, 16).replace('T', ' '));
      }
    }
  })(root);
}

// ---- 远端部署根(SSH + PowerShell Get-FileHash) ----
if (SSH) {
  for (const root of ROOTS) {
    const ps = `Get-ChildItem '${root.replace(/\//g, '\\')}' -Recurse -Include *.mjs,*.js,*.ps1,*.sh,*.cjs -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notlike '*node_modules*' } | ForEach-Object { $_.FullName + '|' + (Get-FileHash $_.FullName -Algorithm SHA256).Hash + '|' + $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm') }`;
    let out;
    try {
      out = execFileSync('ssh', ['-n', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=25',
        '-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no', SSH,
        `powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`], { encoding: 'utf8', timeout: 240000 });
    } catch (e) {
      // 🔴 够不到 ≠ 没漂移。必须单独计数并显形, 否则一次连不上会伪装成"全部一致"。
      unreachable++; say(`🔴 够不到(这【不等于】没漂移): ${SSH}:${root} — ${String(e.message).slice(0, 80)}`);
      continue;
    }
    for (const line of out.split(/\r?\n/)) {
      const parts = line.trim().split('|');
      if (parts.length !== 3) continue;
      compare(pathx.basename(parts[0]), `${SSH}:${parts[0]}`, parts[1].toLowerCase(), parts[2]);
    }
  }
}

say('');
say(`扫描完成: 一致 ${matched} · 漂移 ${drifted}${ambiguous ? ` (其中 ${ambiguous} 个仓库里有同名多份, 无法确定它该跟哪一份)` : ''} · 够不到 ${unreachable}`);
if (!matched && !drifted) {
  // 判据自体检: 一个可比文件都没找到时, "零漂移"会假装成通过。
  say('🔴 一个可比对的文件都没找到 —— 大概率是根目录写错或够不到, 【不要】把这读成"没有漂移"。');
  process.exit(2);
}
say(drifted || unreachable
  ? '🔴 有漂移或有够不到的部署根 —— 在跑的那份与你复核的那份【不是同一份】。'
  : '✅ 扫到的部署副本都与仓库一致。');
process.exit(drifted || unreachable ? 1 : 0);
