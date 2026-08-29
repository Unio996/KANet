# _launch_console_single.ps1 — 维护窗用: 单独拉起 Console(不碰 relay/其它子系统)
#
# 出处: Bettor r15 A2 缺口二 派给 J1。NWT 复核。
#
# 🔴 与 r15 原指示的两处偏离(均已实测, 见 §边离说明):
#   (1) env 不取"headless 的 export 段" —— 该脚本里【没有】逐条 export;
#       它是 `while IFS='=' read -r k v` 全量读 kanet.env。而手工维护白名单
#       正是 r472 (P0 2026-06-10) 的病根: 3 键白名单静默漏掉 KASPA_RPC_URL,
#       Console 子进程一起就崩。=> 本脚本【全量】导出 kanet.env 所有键。
#   (2) 不用 Win32_Process.Create —— 实测它【不继承调用者环境】(子进程读到
#       空值), 用它起 Console 等于零 env, 直接重演 r472。=> 改用 .NET
#       ProcessStartInfo 显式设环境; 附带 CreateNoWindow 不弹控制台窗。
#
# 安全: 只读 kanet.env, 【绝不打印任何值】(内含 ADMIN_SECRET /
#   CONSOLE_ENCRYPTION_KEY / TELEGRAM_BOT_TOKEN 等)。只报键数与端口。
# 默认 DRY-RUN: 不加 -Go 只做全部前置检查并打印将要执行的动作, 不启动。

[CmdletBinding()]
param(
  [string]$KanetRoot = 'D:\kanet-tn12',
  [switch]$Go,                       # 不加 = 演练; 加了才真启动
  [int]$HealthTimeoutSec = 60
)

$ErrorActionPreference = 'Stop'
function Say($s) { Write-Output ("  {0} {1}" -f (Get-Date -Format 'HH:mm:ss'), $s) }
function Die($s) { Write-Output ("  {0} 🔴 {1}" -f (Get-Date -Format 'HH:mm:ss'), $s); exit 1 }

Say "KANET_ROOT = $KanetRoot   模式 = $(if ($Go) { '真启动' } else { 'DRY-RUN(演练)' })"

# —— 步 1: 前置文件 ——
$envFile = Join-Path $KanetRoot 'kanet.env'
$entry   = Join-Path $KanetRoot 'kasia-console\src\index.js'
$logDir  = Join-Path $KanetRoot 'logs'
if (-not (Test-Path $envFile)) { Die "kanet.env 不存在: $envFile" }
if (-not (Test-Path $entry))   { Die "入口不存在: $entry" }
if (-not (Test-Path $logDir))  { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path $node)) { Die "找不到 node: $node" }
Say "node = $node"

# —— 步 2: 解析 kanet.env(全量, 不打印值) ——
# 与 kanet-start-headless.sh 同语义: 跳过 # 开头与空行; 按【第一个】= 分割。
$envMap = @{}
$lineNo = 0; $skipped = 0
foreach ($line in (Get-Content $envFile)) {
  $lineNo++
  $t = $line.Trim()
  if ($t -eq '' -or $t.StartsWith('#')) { $skipped++; continue }
  $idx = $t.IndexOf('=')
  if ($idx -lt 1) { $skipped++; continue }
  $k = $t.Substring(0, $idx).Trim()
  $v = $t.Substring($idx + 1)
  if ($k -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { $skipped++; continue }
  $envMap[$k] = $v
}
Say "kanet.env 解析: $($envMap.Count) 个键载入, $skipped 行跳过(注释/空/非法键), 共 $lineNo 行"
if ($envMap.Count -lt 50) { Die "只解析出 $($envMap.Count) 个键, 远少于预期(应 ~91) —— 疑似解析错误, 拒绝启动" }

# 关键键存在性自检(只查在不在, 不打印值) —— r472 的教训就是它被静默漏掉
foreach ($must in @('KASPA_RPC_URL', 'KASPA_NETWORK', 'PORT', 'CONSOLE_ENCRYPTION_KEY')) {
  if (-not $envMap.ContainsKey($must)) { Die "缺关键键 $must —— 正是 r472 P0 的失败模式, 拒绝启动" }
}
Say '关键键自检通过: KASPA_RPC_URL / KASPA_NETWORK / PORT / CONSOLE_ENCRYPTION_KEY 均在'

$port = 3200
if ($envMap['PORT'] -match '^\d+$') { $port = [int]$envMap['PORT'] }
Say "Console 端口(取自 kanet.env PORT) = $port"

# —— 步 3: 拒绝重复启动 ——
$busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($busy) {
  $op = Get-CimInstance Win32_Process -Filter "ProcessId=$($busy.OwningProcess)" -ErrorAction SilentlyContinue
  Die "端口 $port 已被 PID $($busy.OwningProcess) 占用($($op.Name)) —— 已有 Console 在跑, 拒绝重复启动"
}
Say "端口 $port 空闲"

# 也查有没有游离的 index.js 实例(不占端口的僵尸 —— 57fde30f 修的正是这个)
$stray = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
         Where-Object { "$($_.CommandLine)" -like '*kasia-console*index.js*' }
if ($stray) {
  Say "⚠ 发现 $(($stray | Measure-Object).Count) 个 index.js 进程但均未占用 ${port}:"
  $stray | ForEach-Object { Say "    PID $($_.ProcessId) 起于 $($_.CreationDate)" }
  Say '  (若是僵尸实例, 先按 reap 流程处理; 本脚本不擅自杀进程)'
}

# —— 步 4: 组装 argv 与环境 ——
$argv = @('--max-old-space-size=4096', ($entry -replace '\\', '/'))
Say "argv: `"$node`" $($argv -join ' ')"

if (-not $Go) {
  Say '演练结束 —— 前置检查全部通过。加 -Go 才会真正启动。'
  exit 0
}

$stdout = Join-Path $logDir 'console.log'
$stderr = Join-Path $logDir 'console.err.log'

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName               = $node
foreach ($a in $argv) { $psi.ArgumentList.Add($a) } 2>$null
if ($psi.ArgumentList.Count -eq 0) { $psi.Arguments = ($argv | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' ' }
$psi.WorkingDirectory       = $KanetRoot
$psi.UseShellExecute        = $false
$psi.CreateNoWindow         = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError  = $true
# EnvironmentVariables 预填了当前进程环境(PATH 等), 在其上叠加 kanet.env 全量
foreach ($k in $envMap.Keys) { $psi.EnvironmentVariables[$k] = $envMap[$k] }
$psi.EnvironmentVariables['KANET_ROOT'] = $KanetRoot
Say "环境: 系统环境 + kanet.env $($envMap.Count) 键 + KANET_ROOT"

$proc = [System.Diagnostics.Process]::Start($psi)
Say "已启动 PID=$($proc.Id)  (stdout -> $stdout)"

# 异步把子进程输出接到日志, 避免管道缓冲填满导致子进程阻塞
Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action {
  if ($EventArgs.Data) { Add-Content -Path $using:stdout -Value $EventArgs.Data -Encoding utf8 }
} | Out-Null
Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action {
  if ($EventArgs.Data) { Add-Content -Path $using:stderr -Value $EventArgs.Data -Encoding utf8 }
} | Out-Null
$proc.BeginOutputReadLine(); $proc.BeginErrorReadLine()

# —— 步 5: 健康验证(不确认就不算成功) ——
Say "等待 /health 就绪(最多 ${HealthTimeoutSec}s)..."
$ok = $false
for ($i = 0; $i -lt $HealthTimeoutSec; $i++) {
  Start-Sleep -Seconds 1
  if ($proc.HasExited) { Die "进程已退出, 退出码 $($proc.ExitCode) —— 见 $stderr" }
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
    if ($r.StatusCode -eq 200) { $ok = $true; Say "/health 200 用时 $($i+1)s: $($r.Content)"; break }
  } catch { }
}
if (-not $ok) { Die "${HealthTimeoutSec}s 内 /health 未就绪 —— 进程仍在(PID $($proc.Id)), 请查 $stderr" }

# 端口归属复核: 必须是我们起的这个 PID, 不能是别人抢占
$own = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($own -and $own.OwningProcess -ne $proc.Id) { Die "端口 $port 的持有者是 PID $($own.OwningProcess), 不是我们启动的 $($proc.Id)" }

Say "✅ Console 单独启动完成  PID=$($proc.Id)  端口=$port  env 键数=$($envMap.Count)"
