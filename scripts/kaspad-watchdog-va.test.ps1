# VA harness: dot-source watchdog with NOLOOP=1, test REAL functions (Get-Verdict / brake helpers).
# 覆盖 VA-1/2/4/7/9 + 规则72族(探针自坏码不 restart). ASCII-only output.
# 用法: $env:WD_TARGET='scripts\kaspad-watchdog.ps1'; powershell -File scripts\kaspad-watchdog-va.test.ps1
$ErrorActionPreference = 'Stop'
$env:KASPAD_WATCHDOG_NOLOOP = '1'
$target = if ($env:WD_TARGET) { $env:WD_TARGET } else { Join-Path $PSScriptRoot 'kaspad-watchdog.ps1' }
. $target   # dot-source: 定义函数, NOLOOP 跳过循环
$pass = 0; $fail = 0
function Assert($name, $cond) {
  if ($cond) { $script:pass++; Write-Output "PASS $name" }
  else       { $script:fail++; Write-Output "FAIL $name" }
}

# VA-9 (MUST4): 显式分支, 无 else 陷阱 —— 每个 code 映射正确
Assert 'VA9-code0-Alive'    ((Get-Verdict 0) -eq 'Alive')
Assert 'VA1-code7-Syncing'  ((Get-Verdict 7) -eq 'Syncing')   # VA-1: IBD 期 SYNCING 不重启
Assert 'VA4-code8-Stalled'  ((Get-Verdict 8) -eq 'Stalled')   # VA-4: STALLED 只告警
Assert 'VA2-code9-Dead'     ((Get-Verdict 9) -eq 'Dead')      # VA-2: 真死候选
Assert 'code2-Fail'         ((Get-Verdict 2) -eq 'Fail')
Assert 'code3-Fail'         ((Get-Verdict 3) -eq 'Fail')
Assert 'code4-Fail'         ((Get-Verdict 4) -eq 'Fail')
Assert 'code5-Fail'         ((Get-Verdict 5) -eq 'Fail')
# 规则72族: 探针自坏码 6 => Unknown (不重启), 不落 Fail
Assert 'rule72-code6-Unknown-not-Fail' ((Get-Verdict 6) -eq 'Unknown')
Assert 'code-neg1-Unknown'  ((Get-Verdict -1) -eq 'Unknown')
Assert 'code1-Unknown'      ((Get-Verdict 1) -eq 'Unknown')

# VA-7 (MUST3 刹车): restartAttempts 独立计数 + Prune 窗口 + In-Cooldown
$script:RESTART_WINDOW_SEC = 300
$script:MAX_RESTARTS = 5
$now = Get-Date
# 5 条窗内 + 1 条窗外
$script:restartAttempts = @(
  @{ ts = $now.AddSeconds(-10);  pid = 1 },
  @{ ts = $now.AddSeconds(-20);  pid = 2 },
  @{ ts = $now.AddSeconds(-30);  pid = 3 },
  @{ ts = $now.AddSeconds(-40);  pid = 4 },
  @{ ts = $now.AddSeconds(-50);  pid = 5 },
  @{ ts = $now.AddSeconds(-400); pid = 6 }
)
Prune-RestartAttempts
Assert 'VA7-prune-drops-out-of-window' ($script:restartAttempts.Count -eq 5)   # 窗外那条被剔
Assert 'VA7-brake-fires-at-MAX'        ($script:restartAttempts.Count -ge $script:MAX_RESTARTS)  # >=5 => 刹车

# In-Cooldown: 未来截止=true, 过去=false, null=false
$script:cooldownUntil = $now.AddSeconds(100); Assert 'cooldown-future-true'  (In-Cooldown)
$script:cooldownUntil = $now.AddSeconds(-100); Assert 'cooldown-past-false' (-not (In-Cooldown))
$script:cooldownUntil = $null; Assert 'cooldown-null-false' (-not (In-Cooldown))

# 刹车 Prune 后若全部窗外 => 允许重启(count<MAX)
$script:restartAttempts = @( @{ ts = $now.AddSeconds(-400); pid = 9 } )
Prune-RestartAttempts
Assert 'VA7-after-window-brake-clears' ($script:restartAttempts.Count -lt $script:MAX_RESTARTS)


# === enable-gate 向量 (Get-RestartDecision 纯函数 + 真格式臂; NWT GO) ===
# VA-5 external: 当前 pid 非我 spawn => 清 failCount + 刹车归零
$d5 = Get-RestartDecision 200 'cdB' @{ lastSeenPid=100; lastSeenCreated='cdA'; lastSpawnPid=50; lastSpawnCreationDate='cdX' } $true
Assert 'VA5-external-brake-reset' ($d5.category -eq 'external' -and $d5.brakeReset -eq $true -and $d5.failCountReset -eq $true)
# VA-8 self: (pid,cd) 元组匹配 lastSpawn => 清 failCount 但 brake KEPT
$d8 = Get-RestartDecision 200 'cdB' @{ lastSeenPid=100; lastSeenCreated='cdA'; lastSpawnPid=200; lastSpawnCreationDate='cdB' } $true
Assert 'VA8-self-brake-KEPT' ($d8.category -eq 'self' -and $d8.brakeReset -eq $false -and $d8.failCountReset -eq $true)
# VA-8b stateReadFail: 无证据 => failCount 与 brake 都不动
$d8b = Get-RestartDecision 200 'cdB' $null $false
Assert 'VA8b-stateReadFail-both-unchanged' ($d8b.category -eq 'fail-closed' -and $d8b.brakeReset -eq $false -and $d8b.failCountReset -eq $false)
# VA-8c (承重·NWT 必钉): spawn cd 取不到(lastSpawnCreationDate=null) + 同 pid => fail-closed, brake KEPT, 绝不 external
$d8c = Get-RestartDecision 200 'cdReal' @{ lastSeenPid=100; lastSeenCreated='cdA'; lastSpawnPid=200; lastSpawnCreationDate=$null } $true
Assert 'VA8c-cdNull-samePid-fail-closed-brake-KEPT' ($d8c.category -eq 'fail-closed' -and $d8c.brakeReset -eq $false -and $d8c.failCountReset -eq $false)

# VA-8d (真格式臂): 起真实哑进程, 走真实 spawn 侧 cd 取(CIM 重试) + 真实枚举侧 cur, 喂 Get-RestartDecision => self ∧ brake KEPT
$dummy = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','ping 127.0.0.1 -n 30' -WindowStyle Hidden -PassThru
try {
  $realCd = $null
  foreach ($try in 1,2,3) {
    try { $c2 = Get-CimInstance Win32_Process -Filter "ProcessId=$($dummy.Id)" -ErrorAction Stop; if ($c2 -and $c2.CreationDate) { $realCd = "$($c2.CreationDate)"; break } } catch {}
    if ($try -lt 3) { Start-Sleep -Seconds 1 }
  }
  $curReal = Get-CimInstance Win32_Process -Filter "ProcessId=$($dummy.Id)" | Select-Object -First 1
  $stReal = @{ lastSeenPid = 999999; lastSeenCreated = 'old-cd'; lastSpawnPid = $dummy.Id; lastSpawnCreationDate = $realCd }
  $d8d = Get-RestartDecision $curReal.ProcessId "$($curReal.CreationDate)" $stReal $true
  Assert 'VA8d-real-format-self-brake-KEPT' ($d8d.category -eq 'self' -and $d8d.brakeReset -eq $false)
} finally {
  try { Stop-Process -Id $dummy.Id -Force -ErrorAction SilentlyContinue } catch {}
}

# VA-2b/2c/2d: CIM-null 不改 verdict (L1 override 已移除); verdict 一律按 probe code (Get-Verdict)
Assert 'VA2b-code9-Dead-regardless-CIM'   ((Get-Verdict 9) -eq 'Dead')     # CIM-null+code9 => Dead
Assert 'VA2c-code0-Alive-regardless-CIM'  ((Get-Verdict 0) -eq 'Alive')    # CIM-null+code0 => Alive(+warn)
Assert 'VA2d-code6-Unknown-regardless-CIM'((Get-Verdict 6) -eq 'Unknown')  # CIM-null+code6 => Unknown 冻结

Write-Output "==== VA RESULT: pass=$pass fail=$fail ===="
if ($fail -gt 0) { exit 1 } else { exit 0 }
