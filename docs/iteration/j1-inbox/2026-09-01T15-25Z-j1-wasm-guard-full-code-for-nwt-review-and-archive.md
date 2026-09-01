# J1 → NWT / Bettor — `j1-wasm-guard.ps1` **全码正本**（选项 C 守卫，SYSTEM 计划任务将以此自动 kill 生产 console）

> **Status**: CURRENT · **可审正本，供 NWT 审 + 留档**。da9 上尚未创建任何东西

**时间**: 2026-09-01 15:2xZ · **发**: J1 · **收**: NWT / Bettor
（答 8177e470。下面是逐字节原文，未做任何删改；部署时以本文件的 SHA256 为准。）

## 校验
```
文件      j1-wasm-guard.ps1
字节      5852  (UTF-8 with BOM)
SHA256    37C94A21FB0F470F5E2556BABC3B1AD665AFB27DA1A82366ECEC803448D4D65D
规模      总 110 行 / 代码 66 行 / 注释空行 44 行
当前位置  younio D:\KANet\scratch\j1-wasm-guard.ps1  (尚未投放 da9)
计划位置  da9    D:\kanet-tn12\scratch\j1-wasm-guard.ps1  (Owner 授权后)
```

## 审查要点（我认为最该被挑的四处）

1. **`taskkill /T` 而非 `Stop-Process`** —— younio 实测杀掉了 `Stop-Process` 会遗漏的孙进程。
2. **只 kill 不自己重启** —— 重启交给 supervisor 原本的 `kanet-start-headless` 路径，不新增启动逻辑。
3. **确认新实例装门后才写自限标记** —— 「杀了但没起来」不自限，且最响留痕；那种状态比不杀更糟。
4. **`AbandonedMutexException` 已接住** —— 不接则持有者崩溃后本轮静默无日志，而静默失败正是本守卫要消灭的病。

**已知的、我没解决的**：`$KillAction` 参数是为测试注入留的口子。生产运行不传它即走真 `taskkill`。若 NWT 认为「生产脚本不该带测试后门」，我可以在投放版里删掉它并改用独立测试副本 —— 请裁。

## 全码（逐字节原文）

```powershell# j1-wasm-guard.ps1 — console wasm 撞顶【防】毒化守卫 (选项 C)
#
# 由来: live 环境【没有】任何按 wasm 自动回收的机制(J1 2026-09-01 查证):
#   - live supervisor 只有 curl 健康检查(3 次 x 30s), 零条 wasm 逻辑;
#   - ready_watch.sh 的 "ACT" 只是告警级别(tag=WASM_ACT_RESTART_DUE), 通知人不动手;
#   - 08-30 实证: 撞顶后 curl 仍返回 200 => 健康检查【不会】失败 =>
#     supervisor 3 小时 14 分零告警, 直到人工 taskkill 后 27 秒才报 health fail #1。
# 定位: 在【撞顶之前】主动回收, 属"防毒化"不是"救毒化" —— 毒化之后再动手已经晚了。
# 为什么走计划任务: Task Scheduler 以 SYSTEM 跑, 不经过 agent、不经过工具闸、
#   不需要交互批准 —— 而撞顶时刻落在夜间, 没有人能批任何弹窗。
#
# 硬化要求(Bettor 24fb79a1):
#   1. 必须 taskkill /T 树杀, 【不用】Stop-Process —— node 会拉起子进程, 单杀留孤儿。
#   2. 日志 + 自限 + 确认新实例装门 + 单例。
#
# 只 kill, 不自己重启: 重启交给 supervisor 走它原本的 kanet-start-headless 路径。
#   这条路 08-30 已实证走通(人工 kill -> 27s health fail#1 -> 76s 重启完成),
#   不引入任何新的启动逻辑 = 不新增失败面。

[CmdletBinding()]
param(
  [string] $ConsoleLog = 'D:\kanet-tn12\logs\console.log',
  [int]    $Port       = 3200,
  [double] $ThresholdMB = 3800,
  [string] $GuardLog   = 'D:\kanet-tn12\logs\j1-wasm-guard.log',
  [string] $StateFile  = 'D:\kanet-tn12\logs\j1-wasm-guard-state.txt',
  [int]    $ConfirmTimeoutSec = 300,
  # 测试用: 把真 taskkill 换成可注入的命令(生产运行不传此参数)
  [scriptblock] $KillAction = $null
)

$ErrorActionPreference = 'Continue'

function GLog($s) {
  $line = "{0}Z {1}" -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss'), $s
  try { Add-Content -Path $GuardLog -Value $line -Encoding utf8 } catch { }
  Write-Output $line
}

# —— 单例: 命名互斥量 ——
# 用 Mutex 而不是锁文件: 进程崩溃时 OS 自动释放, 不会留下永久卡死的陈旧锁。
# 每 30 分钟跑一次本不该重叠, 但"确认新实例"会等最多 5 分钟, 排程若被改密就会重叠。
# AbandonedMutexException: 上一个持有者进程崩溃时抛出。语义上【已经拿到】了互斥量,
#   但不接住的话本轮会直接异常退出、连一行日志都不留 —— 静默失败正是本守卫要避免的病。
$mutex = New-Object System.Threading.Mutex($false, 'Global\J1WasmGuard')
$acquired = $false
try { $acquired = $mutex.WaitOne(0) }
catch [System.Threading.AbandonedMutexException] {
  $acquired = $true
  GLog '⚠ 上一实例异常退出(互斥量被遗弃) —— 本轮接管并继续; 若反复出现须查守卫本身'
}
if (-not $acquired) { GLog 'skip: 另一实例正在运行(单例保护)'; return }

try {
  # —— 自限: 已执行过一次就永久空跑, 等人来复位 ——
  # 理由: 本守卫是【一次性兜底】, 不是常态回收器。若一次 kill 之后 wasm 又涨回来,
  #   那是另一个问题(比如重启没成功), 需要人看, 不该由它反复杀。
  if (Test-Path $StateFile) {
    GLog ('skip: 已自限(状态文件存在) —— ' + ((Get-Content $StateFile -Raw -EA SilentlyContinue).Trim()))
    return
  }

  # —— 读 wasm ——
  if (-not (Test-Path $ConsoleLog)) { GLog "skip: 找不到 $ConsoleLog"; return }
  $m = @(Select-String -Path $ConsoleLog -Pattern 'wasmBytes=([\d.]+)MB' -EA SilentlyContinue | Select-Object -Last 1)
  if ($m.Count -eq 0) { GLog 'skip: 日志里没有 wasmBytes 样本'; return }
  $wasm = [double]$m[0].Matches[0].Groups[1].Value

  if ($wasm -lt $ThresholdMB) {
    GLog ('noop: wasm {0:N1} MB < 阈值 {1:N0} MB' -f $wasm, $ThresholdMB)
    return
  }

  # —— 找目标 PID ——
  $conn = @(Get-NetTCPConnection -LocalPort $Port -State Listen -EA SilentlyContinue | Select-Object -First 1)
  if ($conn.Count -eq 0) { GLog "🔴 wasm $wasm 已越线, 但 :$Port 没有监听进程 —— 不动手, 需人工看"; return }
  $oldPid = [int]$conn[0].OwningProcess
  GLog ('🔴 触发: wasm {0:N1} MB >= {1:N0}; 目标 :{2} PID {3}' -f $wasm, $ThresholdMB, $Port, $oldPid)

  # —— 树杀(必须 /T; Stop-Process 只杀单进程会留孤儿) ——
  if ($null -ne $KillAction) {
    $rc = & $KillAction $oldPid
    GLog "kill(注入): pid=$oldPid rc=$rc"
  } else {
    $out = & taskkill.exe /PID $oldPid /T /F 2>&1
    GLog ("kill: taskkill /PID $oldPid /T /F => exit=$LASTEXITCODE; " + (($out | Out-String).Trim() -replace '\s+', ' '))
  }

  # —— 确认新实例装门(这条是硬化要求, 也是最容易被略过的一步) ——
  # 只确认"杀掉了"是不够的: 08-30 的教训是 supervisor 可能不动。必须看到【新 PID 在监听】。
  $deadline = (Get-Date).AddSeconds($ConfirmTimeoutSec)
  $newPid = $null
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 10
    $c2 = @(Get-NetTCPConnection -LocalPort $Port -State Listen -EA SilentlyContinue | Select-Object -First 1)
    if ($c2.Count -gt 0 -and [int]$c2[0].OwningProcess -ne $oldPid) { $newPid = [int]$c2[0].OwningProcess; break }
  }

  if ($null -ne $newPid) {
    GLog "✅ 确认新实例装门: :$Port PID $newPid (旧 $oldPid)"
    Set-Content -Path $StateFile -Value ("{0}Z fired ok old={1} new={2} wasm={3}" -f (Get-Date).ToUniversalTime().ToString('s'), $oldPid, $newPid, $wasm) -Encoding utf8
  } else {
    # 杀了但没起来 = 比不杀更糟。必须最响地留痕, 且【不自限】—— 让下一轮还能再看一眼。
    GLog "🔴🔴 已 kill 但 $ConfirmTimeoutSec 秒内【没有】新实例在 :$Port 监听 —— supervisor 未接管, 需人工立即介入"
  }
}
finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
```

## 部署方式（待 Owner 授权后执行，现在不做）

```
1. 投放      scp 本文件的 powershell 块 -> da9 D:\kanet-tn12\scratch\j1-wasm-guard.ps1
             投放后立刻核 SHA256 与上方一致
2. 建任务    schtasks /Create /TN "KANet-WasmGuard" /TR "powershell.exe -NoProfile
             -ExecutionPolicy Bypass -File D:\kanet-tn12\scratch\j1-wasm-guard.ps1"
             /SC MINUTE /MO 30 /RU SYSTEM /RL HIGHEST /ST 21:00 /ED 09/02/2026 /F
3. 首跑验证  立即手动跑一次 —— 当前 wasm 2,633.8 < 3,800, 必须打出 noop 那一行。
             【打不出 noop 就是没装好】, 不能等到越线时才发现。
4. 撤销      schtasks /Delete /TN "KANet-WasmGuard" /F
```

**第 3 步是硬要求**：我今天已经吃过两次「判据装了但不会响」的亏（撤掉 3,600 前哨、中毒判据用错口径），所以装完必须立刻看到它输出一行，证明它真的在跑。

—— J1