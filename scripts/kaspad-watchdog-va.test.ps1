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

Write-Output "==== VA RESULT: pass=$pass fail=$fail ===="
if ($fail -gt 0) { exit 1 } else { exit 0 }
