#!/usr/bin/env node
/**
 * 刹车那台的 watchdog 存活探针。
 * 输出一行:  WD=<n> MINER=<n> HB=<age_ms|none>  或  UNREACHABLE:<原因>
 *
 * 🔴 存在理由(2026-08-10 14:09Z 实事): 我部署时用 Start-Process 起 watchdog, 它随 SSH 会话一起没了,
 *    而【没有任何东西会告诉我】——_watchdog.log 只在有事件时写, 进程消失完全静默。
 *    那 70 秒矿机无人监管, 是我下一条 ssh 偶然去验才发现的。
 *
 * 🔴🔴 第一版【只数进程】, 而 Codex 当天就指出它不够:
 *    「一个活着但卡死的 watchdog 照样报 WD=1 ⇒ 这支关掉的是【静默消失】, 不是【功能存活】。」
 *    他要求: 加一个【循环自己产生的、外部可观测的单调信号】, 并在"进程在但心跳陈旧"时判失败。
 *    🔨 而这个形状我当天早上刚在别人的组件上点过(那 5 个陈旧实例"日志 2.5 天没写, 沉默既可能是
 *       一直在过、也可能是循环卡住, 我没有区分") —— 然后给自己造了同一个洞。
 *
 * 🔵 心跳源【不用改 watchdog】: 它每一轮都调探针, 而探针每次都会重写自己的 state 文件, 里面带
 *    `ts`(epoch ms)。⇒ 那就是循环自己产生的单调信号, 已经在那里了。
 *    文件名【可推导不写死】: tn12-dag-probe-state-${sha256(URL)[0:16]}.json (探针 :660-661)
 *    实证: sha256('ws://127.0.0.1:17210')[0:16] = 11904dce92323a82, 与那台上新鲜的那个逐位相同。
 *
 * 🔴 判据两端都要断言(我在探针新鲜度闸上连续两轮犯过"只有上界没有下界"):
 *    未来时间戳同样不算新鲜 —— NTP 校时 / VM 恢复都会产出它, 而 age 为负不 > 阈值。
 *
 * 🔴 阈值 300s 是【推导的】: 最坏一轮 = poll 30s + Get-Health ~9.5s + (braked 时)脉冲 20s +
 *    结算窗 1.5s + Get-DaaNow ~9.5s ≈ 70s ⇒ 300 约 4 倍余量。这些耗时是本机实测(探针一次 ~9.5s)。
 *
 * 🔴 取不到【必须出声】且与"没了"分开: 两者都不是"一切正常", 但导出的动作不同(修连接 vs 救矿机)。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const HOST = process.env.J1_WD_HOST || 'admin@100.99.147.101';
// 🔴🔴 这一行原先是 `process.env.SSH_ASKPASS || '<我们的脚本>'`, 而那是【本探针在计划任务里挂死 90 秒的根因】:
//    · 非登录 shell(我手测用的): SSH_ASKPASS 未设 ⇒ 走我们的脚本 ⇒ 一切正常;
//    · 登录 shell(`bash -lc`, 正是计划任务用的): Git 的 profile 把它设成 `/mingw64/bin/git-askpass.exe`
//      ⇒ `||` 于是采信了它 ⇒ ssh 弹出【Git for Windows 图形密码框】
//      ⇒ 计划任务会话里没有人去点 OK ⇒ ssh 一直等 ⇒ 90 秒后 spawnSync ETIMEDOUT。
//    🔨 判据: **那个 `||` 看着像「允许外部覆盖」, 实际是「允许外部劫持」** ——
//       而劫持它的恰好是一个【会停下来等人】的程序。回落路径必须是我自己指定的那个,
//       想覆盖就用一个**只有我会设**的名字, 别复用被别人写着玩的通用名。
//    🔵 实证(计划任务会话内): 显式导出后 ssh 2 秒返回 Permission denied(rc=255), **根本没有挂**
//       ⇒ 不是 Tailscale、不是网络、不是 ssh 解析 —— 是弹了一个没人能回答的框。
const ASKPASS = process.env.J1_ASKPASS || 'D:/kanet/kanet/scratch/j1-askpass-0808.sh';
const NODE_URL = process.env.J1_WD_NODE_URL || 'ws://127.0.0.1:17210';
const STATE_NAME = `tn12-dag-probe-state-${createHash('sha256').update(NODE_URL).digest('hex').slice(0, 16)}.json`;

const ps = [
  '$w = @((Get-CimInstance Win32_Process) | Where-Object { $_.CommandLine -ne $null -and $_.CommandLine -match "tn12-mining-watchdog" })',
  '$m = @((Get-CimInstance Win32_Process) | Where-Object { $_.Name -eq "stratum-bridge.exe" })',
  // 🔴 刹车状态: 2026-08-10 23:51 哨兵第一次真响, 报的是 `MINER=0` —— 而那是【刹车脉冲】,
  //    watchdog 每轮会停掉矿机 20 秒。误报自动发进了协调频道, 吃掉了队友的注意力。
  //    🔨 修法照我当时自己说的那条: **让哨兵拿到刹车状态, 而不是放宽阈值。**
  //    状态从 watchdog 日志推(它没有专门的状态文件): 最后一个 BRAKE ENGAGED/RELEASED marker。
  //    🔴 取不到时【必须报 unknown, 而 unknown 一律按"没在刹车"处理】——
  //       反过来(默认当成在刹车)会让一次真正的矿机死亡被永久静音。默认必须是出声的那个。
  '$brake = "unknown"',
  // 🔴 一并带出【它依据的那个 marker 是哪一条】。
  //    2026-08-11 03:41:32Z 这里报了 BRAKE=no, 而 watchdog 日志显示当时正在刹车中
  //    (10:38:19 ENGAGED → 10:42:27 RELEASED, 本地 UTC+7)。事后查: marker 就在窗口里, **原因至今未明**。
  //    ⇒ 推不出来就别猜, **让它下次自己说清楚**: 把 marker 的时刻打出来,
  //      下一次误判时一眼能看出它读的是哪一行(以及是不是根本没读到)。
  '$brkat = "-"',
  'try { $bl = Get-Content "D:\\kaspa-tn12-mining\\_watchdog.log" -Tail 800 -ErrorAction Stop | ' +
    'Where-Object { $_ -match "BRAKE ENGAGED|BRAKE RELEASED" } | Select-Object -Last 1; ' +
    'if ($bl) { if ($bl -match "^(\\S+ \\S+)") { $brkat = $Matches[1] -replace " ", "T" } }; ' +
    'if ($bl -match "BRAKE ENGAGED") { $brake = "yes" } elseif ($bl -match "BRAKE RELEASED") { $brake = "no" } } catch { $brake = "unknown"; $brkat = "readfail" }',
  `$sp = Join-Path $env:TEMP "${STATE_NAME}"`,
  '$hb = "none"',
  'if (Test-Path $sp) { try { $j = (Get-Content $sp -Raw | ConvertFrom-Json); if ($j.ts) { $hb = [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [long]$j.ts) } } catch { $hb = "bad" } }',
  'Write-Output ("WD=" + $w.Count + " MINER=" + $m.Count + " HB=" + $hb + " BRAKE=" + $brake + " BRKAT=" + $brkat)',
].join('; ');
const b64 = Buffer.from(ps, 'utf16le').toString('base64');

try {
  const out = execFileSync('ssh', [
    '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=25',
    '-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no',
    // 🔴 密码只问一次: 认证不过就【立刻失败】, 不许反复问 ——
    //    "问三次"和"挂住"在无人应答的会话里读数相同, 而它们都会吃满上面的 timeout。
    '-o', 'NumberOfPasswordPrompts=1',
    HOST, `powershell -NoProfile -EncodedCommand ${b64}`,
  ], {
    encoding: 'utf8', timeout: 90000,
    env: { ...process.env, SSH_ASKPASS: ASKPASS, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: ':0' },
  });
  const line = out.split(/\r?\n/).find((l) => l.startsWith('WD='));
  console.log(line || `UNREACHABLE:no WD= line in output (${out.trim().slice(0, 60)})`);
} catch (e) {
  console.log(`UNREACHABLE:${String(e.message || e).slice(0, 80)}`);
}
