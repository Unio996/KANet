# p9-baseline.ps1 - transfer runbook step (4) P9 window-freeze baseline (READ-ONLY, zero side effect).
# 给转账 runbook §4 P9 用: T0 记基线 + T1-T3 窗口内复跑比对(console PID / supervisor 尾 / netstat 变=console 重启过=日志证据作废)。
# 中文仅在 # 注释, Write-Output 串一律 ASCII (no-BOM UTF-8 cp1252 陷阱, 同 a5-verify/kaspad-watchdog 纪律)。
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File D:/kanet-tn12/scripts/p9-baseline.ps1
# 只读: 只查 netstat/进程/日志尾, 不停不起不写任何 live 状态。
$ErrorActionPreference = 'Continue'
$root = 'D:\kanet-tn12'
$utc = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
Write-Output "=== P9 baseline @ $utc host=$env:COMPUTERNAME ==="

Write-Output "`n[1] console :3200 LISTENING owner PID"
$conn = Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
  $cpid = ($conn | Select-Object -First 1).OwningProcess
  $cp = Get-CimInstance Win32_Process -Filter "ProcessId=$cpid" -ErrorAction SilentlyContinue
  if ($cp) {
    $cl = if ($cp.CommandLine) { $cp.CommandLine } else { '(null=SYSTEM non-elevated unreadable)' }
    Write-Output ("  console PID={0} Start={1} CommandLineReadable={2}" -f $cpid, $cp.CreationDate, $(if ($cp.CommandLine) { 'yes' } else { 'no(SYSTEM)' }))
    Write-Output ("  CommandLine={0}" -f $cl)
  } else { Write-Output ("  console PID={0} (Win32_Process detail unreadable)" -f $cpid) }
} else { Write-Output "  (:3200 no LISTENING = console down!)" }

Write-Output "`n[2] logs/console-supervisor.log tail 20"
$slog = Join-Path $root 'logs\console-supervisor.log'
if (Test-Path $slog) { Get-Content $slog -Tail 20 | ForEach-Object { Write-Output ("  {0}" -f $_) } }
else { Write-Output "  (no $slog)" }

Write-Output "`n[3] netstat :3200 and :8000"
$ns = netstat -ano | Select-String ':3200 |:8000 ' | Select-String 'LISTENING'
if ($ns) { $ns | ForEach-Object { Write-Output ("  {0}" -f $_.Line.Trim()) } } else { Write-Output "  (none)" }

Write-Output "`n[4] console direct children (node.exe under console PID) + relay count"
if ($conn) {
  $cpid = ($conn | Select-Object -First 1).OwningProcess
  $kids = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$cpid" -ErrorAction SilentlyContinue)
  $nodeKids = @($kids | Where-Object { $_.Name -eq 'node.exe' })
  Write-Output ("  console PID={0} direct children total={1} node.exe children={2}" -f $cpid, $kids.Count, $nodeKids.Count)
  # relay count from relay-manager log lines (CommandLine null under SYSTEM, so approx via console.log)
  $clog = Join-Path $root 'logs\console.log'
  if (Test-Path $clog) {
    $relays = @(Select-String -Path $clog -Pattern '\[relay-manager\] Started .* relay \(PID' -ErrorAction SilentlyContinue)
    Write-Output ("  relay-manager 'Started ... relay' log lines(current console.log)={0}" -f $relays.Count)
  }
} else { Write-Output "  (console down, no children)" }

Write-Output "`n=== end (UTC=$utc) ==="
