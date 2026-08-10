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
const ASKPASS = process.env.SSH_ASKPASS || 'D:/kanet/kanet/scratch/j1-askpass-0808.sh';
const NODE_URL = process.env.J1_WD_NODE_URL || 'ws://127.0.0.1:17210';
const STATE_NAME = `tn12-dag-probe-state-${createHash('sha256').update(NODE_URL).digest('hex').slice(0, 16)}.json`;

const ps = [
  '$w = @((Get-CimInstance Win32_Process) | Where-Object { $_.CommandLine -ne $null -and $_.CommandLine -match "tn12-mining-watchdog" })',
  '$m = @((Get-CimInstance Win32_Process) | Where-Object { $_.Name -eq "stratum-bridge.exe" })',
  `$sp = Join-Path $env:TEMP "${STATE_NAME}"`,
  '$hb = "none"',
  'if (Test-Path $sp) { try { $j = (Get-Content $sp -Raw | ConvertFrom-Json); if ($j.ts) { $hb = [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [long]$j.ts) } } catch { $hb = "bad" } }',
  'Write-Output ("WD=" + $w.Count + " MINER=" + $m.Count + " HB=" + $hb)',
].join('; ');
const b64 = Buffer.from(ps, 'utf16le').toString('base64');

try {
  const out = execFileSync('ssh', [
    '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=25',
    '-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no',
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
