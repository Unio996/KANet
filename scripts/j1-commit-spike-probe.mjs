#!/usr/bin/env node
/**
 * 问一句: **某个操作会不会产生【瞬时提交尖峰】?**
 *
 * 🔵 为什么需要它(2026-08-10 夜, console 内存排查): 队里发现一类尖峰 **单次 ≤10 秒**,
 *    而采样器 2 分钟一档 ⇒ **抓不到的完全不留痕**, 换成 5 秒档也只是把问题变小。
 *    ⇒ 换一把**不靠采样**的尺子: Windows 内核为每个进程维护 `PeakPageFileUsage`,
 *      **单调不减** ⇒ **无论尖峰多短都漏不掉**。实战里它当场量出采样器漏了 571MB 的峰。
 *
 * 🔴 三个量必须分清, 否则会把互相印证的读数当成矛盾(当晚真发生过):
 *      PageFileUsage(Private) = **提交量**, 不要求页面常驻
 *      WorkingSetSize         = **常驻集**; Node 的 `process.memoryUsage().rss` 就是它
 *      ⇒ "提交了但从没碰过" 的形态: Private 猛涨而 rss 纹丝不动 —— 两者都对。
 *    本机实证: 分配 1.2G 不触碰 ⇒ Private +1202MB / rss +1MB; 写满后 rss 才 +1178MB。
 *
 * 🔴 棘轮的界: 它**会饱和** —— 峰值一旦到 X, 此后只有更大的尖峰才留痕。
 *    它答"有没有到过、有多大", **不答"什么时候"**。⇒ 与采样器互补, 不是替代。
 *    (每进程计数器 ⇒ **进程重启即重置**, 重启窗天然给一段灵敏度重置过的观测期。)
 *
 * 用法:
 *   node scripts/j1-commit-spike-probe.mjs            # 自检: 跑一个"只提交不触碰"的对照
 *   在别处 import { readCommit, deltaSince } 包住你要测的操作
 */
import { execFileSync } from 'node:child_process';

/** 读本进程(或指定 pid)的提交/常驻及其内核峰值。单位: 字节。 */
export function readCommit(pid = process.pid) {
  // 🔴 Win32_Process 的单位不统一: WorkingSetSize 是【字节】, 而 PageFileUsage /
  //    PeakPageFileUsage / PeakWorkingSetSize 是【KB】。我第一版漏了后者的换算,
  //    打出 peakWs=0.1MB 这种不可能的数 —— **换算错的数长得像一个真读数。**
  const o = execFileSync('powershell', ['-NoProfile', '-Command',
    `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; ` +
    '"{0} {1} {2} {3}" -f ($p.PageFileUsage*1KB),($p.PeakPageFileUsage*1KB),' +
    '$p.WorkingSetSize,($p.PeakWorkingSetSize*1KB)'],
    { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
  return { priv: o[0], peakPriv: o[1], ws: o[2], peakWs: o[3] };
}

/** 相对一个基线读数的增量(MB), 承重的是 peakPriv —— 它是不会漏尖峰的那一个。 */
export function deltaSince(base, now = readCommit()) {
  const mb = (n) => Number((n / 1048576).toFixed(1));
  return {
    peakPrivMB: mb(now.peakPriv - base.peakPriv),
    peakWsMB: mb(now.peakWs - base.peakWs),
    privMB: mb(now.priv - base.priv),
    wsMB: mb(now.ws - base.ws),
  };
}

// 🔴 别手拼 file:// 前缀判"是不是主模块": Windows 上 import.meta.url 是 `file:///D:/...`(三斜杠),
//    手拼出来的是两斜杠 ⇒ 永不相等 ⇒ **自检段静默不跑, 没有任何报错**。我第一版就是这样, 输出空白。
//    (同族: "没有输出" 不等于 "没有检出"。) 用 pathToFileURL 让运行时自己拼。
const _isMain = process.argv[1]
  && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href;
if (_isMain) {
  const mb = (n) => (n / 1048576).toFixed(1).padStart(9);
  const base = readCommit();
  console.log(`基线            priv=${mb(base.priv)} peakPriv=${mb(base.peakPriv)} ws=${mb(base.ws)}`);

  // 对照: 只提交不触碰 —— 这一格证明这把尺【测的是提交, 不是常驻】
  const bufs = [];
  for (let i = 0; i < 8; i++) bufs.push(Buffer.allocUnsafe(100 * 1024 * 1024));
  const d1 = deltaSince(base);
  console.log(`分配 800MB 不触碰  Δ peakPriv=${String(d1.peakPrivMB).padStart(8)}MB  Δ ws=${String(d1.wsMB).padStart(8)}MB`);

  for (const b of bufs) b.fill(7);
  const d2 = deltaSince(base);
  console.log(`同样 800MB 写满    Δ peakPriv=${String(d2.peakPrivMB).padStart(8)}MB  Δ ws=${String(d2.wsMB).padStart(8)}MB`);
  console.log('');
  console.log('⇒ 未触碰时提交已涨而常驻没动 = 这把尺按预期工作。');
}
