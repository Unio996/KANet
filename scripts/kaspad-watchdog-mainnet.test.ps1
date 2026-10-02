# kaspad-watchdog-mainnet.test.ps1 -- 主网 profile 验收(J2, 2026-10-02, Bettor 派工): 用 simnet(同款 2.0.1 二进制, 独立 appdir 与端口)
# 真起真杀, 绝不碰主网节点/主网端口/主网 appdir。覆盖:
#   S1 节点不在 => <=180s 被拉起            S2 节点活着 => 不重起(PID 不变, 只有 1 次 START)
#   S3 杀节点 => <=180s 被拉起(同时常驻一个别口/别 appdir 的同名 kaspad.exe 诱饵, 不影响判死)
#   S4 口被别的进程占 => 拒起(不双开)        S5 同 appdir 进程已在(未监听) => 拒起
#   S6 连续崩溃 => crash-loop 刹车, 不再第 6 次起
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\kaspad-watchdog-mainnet.test.ps1
$ErrorActionPreference = 'Stop'
$wd      = Join-Path $PSScriptRoot 'kaspad-watchdog.ps1'
$exe     = if ($env:WD_MN_TEST_EXE) { $env:WD_MN_TEST_EXE } else { 'D:\rusty-kaspa-v201\kaspad.exe' }   # 与主网同一份 2.0.1 二进制(只读使用)
$base    = Join-Path $env:TEMP ('wd-mn-accept-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$appdir  = Join-Path $base 'data'
$logdir  = Join-Path $base 'logs'
$evlog   = Join-Path $base 'events.log'
$port    = 19117
$decoyDir = Join-Path $base 'decoy-data'; $decoyPort = 19217
New-Item -ItemType Directory -Force -Path $appdir, $logdir, $decoyDir | Out-Null
$pass = 0; $fail = 0
function Assert($n, $c) { if ($c) { $script:pass++; Write-Output "PASS $n" } else { $script:fail++; Write-Output "FAIL $n" } }
function Simnet-Args($dir, $rpc) { "--simnet --appdir=$dir --utxoindex --rpclisten-borsh=127.0.0.1:$rpc --rpclisten=127.0.0.1:$($rpc - 7) --rpclisten-json=127.0.0.1:$($rpc + 1) --listen=127.0.0.1:$($rpc - 1) --disable-upnp --rocksdb-cache-size=64" }
function Port-Owner($p) { try { (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess } catch { $null } }
function Wait-For($sb, $sec) { $t0 = Get-Date; while (((Get-Date) - $t0).TotalSeconds -lt $sec) { $r = & $sb; if ($r) { return $r }; Start-Sleep -Seconds 2 }; return $null }
function Ev-Count($pat) { if (Test-Path $evlog) { @(Select-String -Path $evlog -Pattern $pat -SimpleMatch).Count } else { 0 } }
$mainnetBefore = Port-Owner 17110   # 主网口主人(若有), 全程只读对照
$spawned = New-Object System.Collections.ArrayList
$wdProc = $null

function Start-Wd($extraEnv) {
  foreach ($k in $extraEnv.Keys) { [Environment]::SetEnvironmentVariable($k, $extraEnv[$k], 'Process') }
  $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $wd, '-Profile', 'mainnet')
  return Start-Process -FilePath powershell.exe -ArgumentList $a -WindowStyle Hidden -PassThru
}
function Stop-Wd($p) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 1 }
function Wait-PortFree($p, $sec) { $null -ne (Wait-For { if (-not (Port-Owner $p)) { 1 } else { $null } } $sec) }
function Kill-NodeByAppdir($dir) {
  foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -like "*--appdir=$dir*" })) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
}

$env:KASPAD_WATCHDOG_PROFILE = 'mainnet'
$env:KASPAD_WATCHDOG_EXE = $exe
$env:KASPAD_WATCHDOG_APPDIR = $appdir
$env:KASPAD_WATCHDOG_RPC_PORT = "$port"
$env:KASPAD_WATCHDOG_NETWORK = 'simnet'
$env:KASPAD_WATCHDOG_LOGDIR = $logdir
$env:KASPAD_WATCHDOG_EVENT_LOG = $evlog
$env:KASPAD_WATCHDOG_ARGS = (Simnet-Args $appdir $port)
$env:KASPAD_WATCHDOG_TICK_SEC = '10'
$env:KASPAD_MIN_FREE_COMMIT_GB = '0'   # 测试机提交量常吃紧(实测空闲 0-1GB), 内存闸另测不在此验收范围

try {
  # ---- 诱饵: 同名 kaspad.exe, 别 appdir 别端口(模拟本机常驻测试节点); 全程存在 ----
  $decoy = Start-Process -FilePath $exe -ArgumentList (Simnet-Args $decoyDir $decoyPort) -WindowStyle Hidden -PassThru
  [void]$spawned.Add($decoy.Id)
  $up = Wait-For { Port-Owner $decoyPort } 60
  Assert 'decoy-kaspad-up (same image name, other appdir/port)' ($null -ne $up)

  # ---- S1: 节点不在 => 拉起 ----
  $t0 = Get-Date
  $wdProc = Start-Wd @{}
  $own = Wait-For { Port-Owner $port } 180
  $secs = [int]((Get-Date) - $t0).TotalSeconds
  Assert "S1-started-within-180s (took ${secs}s)" ($null -ne $own -and $secs -le 180)
  $nodePid = $own
  $cmd = if ($nodePid) { (Get-CimInstance Win32_Process -Filter "ProcessId=$nodePid").CommandLine } else { '' }
  Assert 'S1-node-commandline-has-appdir' ($cmd -like "*--appdir=$appdir*")
  Assert 'S1-event-log-has-START' ((Ev-Count 'kaspad START dispatched') -ge 1)
  Assert 'S1-window-hidden-and-logs-redirected' ((Test-Path (Join-Path $logdir 'kaspad-stdout.log')) -and (Test-Path (Join-Path $logdir 'kaspad-stderr.log')))
  Assert 'S1-decoy-untouched' ($null -ne (Get-Process -Id $decoy.Id -ErrorAction SilentlyContinue))
  $startsAfterS1 = Ev-Count 'kaspad START dispatched'

  # ---- S2: 活着不重起(观察 >=9 tick) ----
  Start-Sleep -Seconds 100
  Assert 'S2-alive-not-restarted (same PID owns port)' ((Port-Owner $port) -eq $nodePid)
  Assert 'S2-no-extra-START' ((Ev-Count 'kaspad START dispatched') -eq $startsAfterS1)

  # ---- S3: 杀节点(诱饵仍在) => 拉起 ----
  Stop-Process -Id $nodePid -Force
  $t1 = Get-Date
  $own2 = Wait-For { $o = Port-Owner $port; if ($o -and $o -ne $nodePid) { $o } else { $null } } 180
  $secs3 = [int]((Get-Date) - $t1).TotalSeconds
  Assert "S3-restarted-within-180s (took ${secs3}s)" ($null -ne $own2 -and $secs3 -le 180)
  Assert 'S3-decoy-still-alive-and-not-mistaken-for-node' ($null -ne (Get-Process -Id $decoy.Id -ErrorAction SilentlyContinue))
  Assert 'S3-event-log-DEAD-then-START' ((Ev-Count 'kaspad DEAD') -ge 1 -and (Ev-Count 'kaspad START dispatched') -ge ($startsAfterS1 + 1))
  Stop-Wd $wdProc; $wdProc = $null
  Kill-NodeByAppdir $appdir
  Assert 'S3-cleanup-port-free' (Wait-PortFree $port 60)

  # ---- S4: 口被别的进程占 => 拒起 ----
  $evBefore = Ev-Count 'refuse-start:port-busy'
  $startsBefore = Ev-Count 'kaspad START dispatched'
  $blocker = Start-Process -FilePath node.exe -ArgumentList '-e', "require('net').createServer(s=>{s.on('error',()=>{})}).listen($port,'127.0.0.1');process.on('uncaughtException',()=>{});setTimeout(()=>{},600000)" -WindowStyle Hidden -PassThru
  [void]$spawned.Add($blocker.Id)
  $okBlock = Wait-For { if ((Port-Owner $port) -eq $blocker.Id) { 1 } else { $null } } 20
  Assert 'S4-blocker-is-the-listener-on-node-port' ($null -ne $okBlock)
  $wdProc = Start-Wd @{}
  $refused = Wait-For { if ((Ev-Count 'refuse-start:port-busy') -gt $evBefore) { 1 } else { $null } } 120
  Assert 'S4-refused-start-port-busy-logged' ($null -ne $refused)
  Assert 'S4-no-kaspad-spawned-on-busy-port' ((Ev-Count 'kaspad START dispatched') -eq $startsBefore -and (Port-Owner $port) -eq $blocker.Id)
  Stop-Wd $wdProc; $wdProc = $null
  Stop-Process -Id $blocker.Id -Force -ErrorAction SilentlyContinue
  Kill-NodeByAppdir $appdir
  Assert 'S4-cleanup-port-free' (Wait-PortFree $port 60)

  # ---- S5: 同 appdir 的 kaspad.exe 进程已在(没监听) => 拒起 ----
  $stubDir = Join-Path $base 'stub'; New-Item -ItemType Directory -Force -Path $stubDir | Out-Null
  $stubExe = Join-Path $stubDir 'kaspad.exe'
  Copy-Item 'C:\Windows\System32\cmd.exe' $stubExe -Force
  $stub = Start-Process -FilePath $stubExe -ArgumentList '/c', "ping -n 300 127.0.0.1 >nul & rem --appdir=$appdir" -WindowStyle Hidden -PassThru
  [void]$spawned.Add($stub.Id)
  Start-Sleep -Seconds 2
  $evBefore5 = Ev-Count 'refuse-start:same-appdir-running'
  $startsBefore5 = Ev-Count 'kaspad START dispatched'
  $wdProc = Start-Wd @{}
  $refused5 = Wait-For { if ((Ev-Count 'refuse-start:same-appdir-running') -gt $evBefore5) { 1 } else { $null } } 150
  Assert 'S5-refused-start-same-appdir-running-logged' ($null -ne $refused5)
  Assert 'S5-no-kaspad-spawned' ((Ev-Count 'kaspad START dispatched') -eq $startsBefore5 -and $null -eq (Port-Owner $port))
  Stop-Wd $wdProc; $wdProc = $null
  Stop-Process -Id $stub.Id -Force -ErrorAction SilentlyContinue
  Kill-NodeByAppdir $appdir
  Assert 'S5-cleanup-port-free' (Wait-PortFree $port 60)

  # ---- S6: 连续崩溃 => crash-loop 刹车(EXE=秒退桩; 窗口内第 6 次不再起) ----
  $crashExe = Join-Path $stubDir 'crash.exe'
  Copy-Item 'C:\Windows\System32\cmd.exe' $crashExe -Force
  $startsBefore6 = Ev-Count 'kaspad START dispatched'
  $wdProc = Start-Wd @{ KASPAD_WATCHDOG_EXE = $crashExe; KASPAD_WATCHDOG_ARGS = '/c exit 1'; KASPAD_WATCHDOG_TICK_SEC = '3' }
  $brake = Wait-For { if ((Ev-Count 'CRASH-LOOP DETECTED') -ge 1) { 1 } else { $null } } 300
  Assert 'S6-crash-loop-brake-fired' ($null -ne $brake)
  Start-Sleep -Seconds 40
  $starts6 = (Ev-Count 'kaspad START dispatched') - $startsBefore6
  Assert "S6-exactly-5-starts-then-brake (starts=$starts6)" ($starts6 -eq 5)
  Stop-Wd $wdProc; $wdProc = $null
}
finally {
  Stop-Wd $wdProc
  Kill-NodeByAppdir $appdir
  Kill-NodeByAppdir $decoyDir
  foreach ($id in $spawned) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  # 主网只读对照: 口主人与测试前一致(本测试没碰它)
  $mainnetAfter = Port-Owner 17110
  Assert 'mainnet-port-17110-owner-unchanged-by-test' ($mainnetBefore -eq $mainnetAfter)
}
Write-Output "==== kaspad-watchdog-mainnet accept: pass=$pass fail=$fail (workdir $base) ===="
if ($fail -gt 0) { exit 1 } else { exit 0 }
