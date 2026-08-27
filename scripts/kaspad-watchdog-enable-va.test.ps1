# kaspad-watchdog-enable-va.test.ps1 -- enable-time 集成测 (NWT 甲+ADD, D-013 §3)
# 验纯函数够不到的【循环级】链: 真 Start-Process(哑) -> CIM 重试记 lastSpawn -> 下 tick Get-RestartDecision 判 self -> brake KEPT。
# 4 hook 同 KASPAD_WATCHDOG_TESTMODE=1 门控。哑进程冒充 kaspad, 绝不动真 kaspad。
# 三约束: 哑进程按 pid 记 finally 全 kill; kaspad.exe 前后对照(0 真 spawn); 负向量 SPAWN_CMD-without-TESTMODE => 真路径+LOUD。
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\kaspad-watchdog-enable-va.test.ps1
#   (dev: $env:WD_TARGET 指向 scratch 副本)
$ErrorActionPreference = 'Stop'
$wd = if ($env:WD_TARGET) { $env:WD_TARGET } else { Join-Path $PSScriptRoot 'kaspad-watchdog.ps1' }
$scratch = Join-Path (Split-Path $PSScriptRoot -Parent) 'scratch'
$dummyExe = Join-Path $env:TEMP 'wd-dummy-kaspad.exe'
$dummyProcName = 'wd-dummy-kaspad.exe'
$dummyBaseName = 'wd-dummy-kaspad'      # Get-Process -Name 用(无 .exe, 无 -replace 正则)
$stateFile = Join-Path $scratch '_ev_wd_state.json'
$pass = 0; $fail = 0
$spawnedPids = New-Object System.Collections.ArrayList
function Assert($n, $c) { if ($c) { $script:pass++; Write-Output "PASS $n" } else { $script:fail++; Write-Output "FAIL $n" } }
function Track-Dummies { foreach ($p in @(Get-Process -Name $dummyBaseName -ErrorAction SilentlyContinue)) { [void]$spawnedPids.Add($p.Id) } }
function Count-Dummies { return @(Get-Process -Name $dummyBaseName -ErrorAction SilentlyContinue).Count }

$kaspadBefore = @(Get-Process -Name kaspad -ErrorAction SilentlyContinue).Count

try {
  # 清任何残留 dummy(跨 run 泄漏)保证干净起点
  Get-Process -Name $dummyBaseName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 300
  Copy-Item 'C:\Windows\System32\cmd.exe' $dummyExe -Force
  Remove-Item $stateFile -ErrorAction SilentlyContinue

  # ---- 场景 A: VA-8 端到端 (承重) -- 长哑进程, mock code9 触发真 spawn -> 下 tick 判 self -> brake KEPT ----
  $env:KASPAD_WATCHDOG_NOLOOP = '1'
  $env:KASPAD_WATCHDOG_TESTMODE = '1'
  $env:KASPAD_WATCHDOG_PROCNAME = $dummyProcName
  $env:KASPAD_WATCHDOG_SPAWN_CMD = "$dummyExe|/c ping 127.0.0.1 -n 30"
  $env:KASPAD_WATCHDOG_PROBE_MOCK = '9'
  $env:KASPAD_WATCHDOG_STATE = $stateFile
  $env:KASPAD_WATCHDOG_MAX_TICKS = '0'
  . $wd

  $script:restartAttempts = @(); $script:failCount = 0
  for ($i = 1; $i -le 5 -and $script:restartAttempts.Count -lt 1; $i++) { Invoke-WatchdogTick }
  Track-Dummies
  Assert 'VA8e2e-spawned-dummy (restartAttempts>=1)' ($script:restartAttempts.Count -ge 1)
  $brakeAfterSpawn = $script:restartAttempts.Count
  Invoke-WatchdogTick   # 下一 tick: $cur=存活哑 => 判 self => brake KEPT
  Track-Dummies
  Assert 'VA8e2e-self-brake-KEPT (not reset to 0)' ($script:restartAttempts.Count -ge $brakeAfterSpawn -and $script:restartAttempts.Count -ge 1)

  # ---- 场景 B: 负向量 -- SPAWN_CMD 设但 TESTMODE 未设 => spawnExe 仍真 kaspad + LOUD ignored ----
  $env:KASPAD_WATCHDOG_TESTMODE = $null
  $env:KASPAD_WATCHDOG_SPAWN_CMD = "$dummyExe|/c echo x"
  . $wd
  Assert 'negvec-SPAWN-without-TESTMODE-resolves-real-kaspad' ($spawnExe -eq $kaspadExe)
  Assert 'negvec-TESTMODE-false' ($TESTMODE -eq $false)

  # ---- 场景 C: VA-5 外部重启 -- 哑进程 pid != lastSpawn => external => brake reset ----
  $env:KASPAD_WATCHDOG_TESTMODE = '1'
  $env:KASPAD_WATCHDOG_SPAWN_CMD = "$dummyExe|/c ping 127.0.0.1 -n 30"
  . $wd
  $ext = Start-Process -FilePath $dummyExe -ArgumentList '/c','ping 127.0.0.1 -n 30' -WindowStyle Hidden -PassThru
  [void]$spawnedPids.Add($ext.Id)
  Start-Sleep -Milliseconds 500
  $extCd = "$((Get-CimInstance Win32_Process -Filter "ProcessId=$($ext.Id)").CreationDate)"
  $st5 = @{ lastSpawnPid=999002; lastSpawnCreationDate='bogus-cd'; lastSeenPid=999003; lastSeenCreated='old' }
  $dec5 = Get-RestartDecision $ext.Id $extCd $st5 $true
  Assert 'VA5-external-brake-reset' ($dec5.category -eq 'external' -and $dec5.brakeReset -eq $true)

  # ---- 场景 D: brake N=5 -> 第 6 次 LOUD 无 spawn (循环级 Dead->failCount->threshold->brake 拦截) ----
  $env:KASPAD_WATCHDOG_TESTMODE = '1'
  $env:KASPAD_WATCHDOG_PROBE_MOCK = '9'
  Remove-Item $stateFile -ErrorAction SilentlyContinue
  . $wd
  $now = Get-Date
  $script:restartAttempts = @(1..$MAX_RESTARTS | ForEach-Object { @{ ts=$now; pid=(900000 + $_) } })   # 预置满 MAX
  $script:failCount = $FAIL_THRESHOLD - 1
  $script:cooldownUntil = $null; $script:_mockIdx = 0
  $dummyCntBefore = Count-Dummies
  Invoke-WatchdogTick   # failCount -> threshold -> brake(count>=MAX) -> LOUD, 不 spawn
  Track-Dummies
  Assert 'VA-brakeN5-no-6th-spawn (restartAttempts stays MAX)' ($script:restartAttempts.Count -eq $MAX_RESTARTS)
  Assert 'VA-brakeN5-no-new-dummy' ((Count-Dummies) -eq $dummyCntBefore)

} finally {
  Track-Dummies
  foreach ($tp in ($spawnedPids | Select-Object -Unique)) { try { Stop-Process -Id $tp -Force -ErrorAction SilentlyContinue } catch {} }
  foreach ($p in @(Get-Process -Name $dummyBaseName -ErrorAction SilentlyContinue)) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {} }
  Remove-Item $dummyExe -ErrorAction SilentlyContinue
  Remove-Item $stateFile -ErrorAction SilentlyContinue
  'KASPAD_WATCHDOG_NOLOOP','KASPAD_WATCHDOG_TESTMODE','KASPAD_WATCHDOG_PROCNAME','KASPAD_WATCHDOG_SPAWN_CMD','KASPAD_WATCHDOG_PROBE_MOCK','KASPAD_WATCHDOG_STATE','KASPAD_WATCHDOG_MAX_TICKS' | ForEach-Object { Remove-Item "env:$_" -ErrorAction SilentlyContinue }
}

$kaspadAfter = @(Get-Process -Name kaspad -ErrorAction SilentlyContinue).Count
Assert 'constraint-no-real-kaspad-spawned (before==after)' ($kaspadAfter -eq $kaspadBefore)

Write-Output "==== enable-va RESULT: pass=$pass fail=$fail (kaspadBefore=$kaspadBefore kaspadAfter=$kaspadAfter) ===="
if ($fail -gt 0) { exit 1 } else { exit 0 }
