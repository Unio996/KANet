#!/usr/bin/env node
/**
 * 刹车那台的 watchdog 存活探针。输出一行: WD=<n> MINER=<n>  或  UNREACHABLE:<原因>
 *
 * 🔴 存在理由(2026-08-10 14:09Z 实事): 我部署时用 Start-Process 起 watchdog, 它随 SSH 会话一起没了,
 *    而【没有任何东西会告诉我】——_watchdog.log 只在有事件时写, 进程消失完全静默。
 *    那 70 秒矿机无人监管, 是我下一条 ssh 偶然去验才发现的。
 *    ⇒ 一支哨兵自己不在时, 读数与"一切正常"完全相同。这支补的就是这一格。
 *
 * 🔴 取不到【必须出声】且与"没了"分开: 两者都不是"一切正常", 但导出的动作不同(修连接 vs 救矿机)。
 *
 * 用 Node 构参数 + base64 传 PowerShell, 不让任何东西经过 shell 的引号解析 ——
 * 这一支的第一版就是死在多层引号上, 而它返回【空】, 若当时直接武装就会得到一支瞎哨兵。
 */
import { execFileSync } from 'node:child_process';

const HOST = process.env.J1_WD_HOST || 'admin@100.99.147.101';
const ASKPASS = process.env.SSH_ASKPASS || 'D:/kanet/kanet/scratch/j1-askpass-0808.sh';

const ps = [
  '$w = @((Get-CimInstance Win32_Process) | Where-Object { $_.CommandLine -ne $null -and $_.CommandLine -match "tn12-mining-watchdog" })',
  '$m = @((Get-CimInstance Win32_Process) | Where-Object { $_.Name -eq "stratum-bridge.exe" })',
  'Write-Output ("WD=" + $w.Count + " MINER=" + $m.Count)',
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
