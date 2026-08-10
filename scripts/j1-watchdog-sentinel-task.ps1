<#
  刹车那台 watchdog 的哨兵 —— 【安装单元】。装/验/卸三态, 入库可审。

  🔴 存在理由(Codex 2026-08-10T17:04Z 复审, 第 2 格仍判 OPEN):
     判定谓词他判 CLOSED IN CODE, 但调度还在仓外 ——
     「A fresh checkout therefore contains a correct one-shot gate but nothing that
      guarantees it will ever be invoked. A reconstructible command in comments is
      useful documentation, not an installed/versioned supervisory mechanism.」
     🔨 判据: **注释里的一行命令不是装置。** 我上一版把起法写进头注释就算交代了 —— 那只是文档。

  🔴 更要紧的是【原先那个哨兵的命都挂在我这个会话上】:
     它是我 session 里的一个 Monitor 循环 ⇒ **会话没了, 哨兵就没了, 而没有任何东西会说一声。**
     那正是它自己被造出来要消灭的形状(进程消失完全静默)。计划任务不依赖任何会话。

  🔴 而【日志不是消费方】, 这一条必须写在最前面:
     本单元把响声写进 $LogPath。**没有人读的日志 = 没有告警。**
     Codex 同一条里要的是 "a nonzero result reaches the actual notification/escalation consumer" ——
     **本单元只做到"产生并留痕", 没做到"送达"**。送达那一半见 -Install 输出里的明示告示。
     ⇒ 引用本单元时**不许**说成"watchdog 已有守护"; 准确说法是"一次性闸已被定时调用, 且留痕"。

  🔴🔴 【实测状态 2026-08-10T17:2xZ · 本单元【当前未安装】, 原因在此, 别照着装完就以为闭合了】:
     装上并强制运行两次, 结果一致 —— **任务跑得起来, 但在【它的环境里】探针取不到读数**:
       第一次: lastResult=0 · 日志写入 `rc=2 UNREACHABLE:spawnSync ssh ETIMEDOUT`
       第二次: 60s 后仍 267009(运行中) · 无 alive 戳
     ⇒ **这【没有】闭合 Codex 那格, 只是把"没有调度"换成了"调度装了但瞎"。**
     🔴 而我把它**卸掉了**, 不是留着: 一个每 5 分钟喊"取不到"的哨兵**比没有更坏** ——
        它把人训练成忽略它, 而真故障长得一模一样。
     🔵 **两个已被【实测排除】的原因**(别重走):
       · ssh 解析差异 —— 交互 shell 与 `bash -lc` 都是 `/usr/bin/ssh`(Git 的), 不是 Windows 自带那个;
       · 并发争用 —— 单独触发、周围无其他 ssh 时同样挂住。
     ⇒ **未查**: 计划任务会话里 `SSH_ASKPASS` 能不能被 exec / Tailscale 在该上下文的可达性。
        下一个人从这两条起手, 修好后 `-Install` 再 `-Verify`, 并**必须真触发一次核 lastResult**
        ——「注册成功」与「跑得通」在 `-Verify` 输出上读数相同。

  用法:
    powershell -NoProfile -File scripts/j1-watchdog-sentinel-task.ps1 -Verify      # 查它在不在岗(默认)
    powershell -NoProfile -File scripts/j1-watchdog-sentinel-task.ps1 -Install
    powershell -NoProfile -File scripts/j1-watchdog-sentinel-task.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [switch] $Install,
  [switch] $Uninstall,
  [switch] $Verify,
  [int]    $IntervalMinutes = 5,
  [string] $TaskName = 'KANet-J1-WatchdogSentinel',
  [string] $LogPath  = "$env:TEMP\kanet-j1-watchdog-sentinel.log"
)

$ErrorActionPreference = 'Stop'
# 路径从本文件位置推导, 不写死 —— @NWT 2026-08-10 实测: 她的检出在 /d/kanet-tn12。
$SelfDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$Sentinel = Join-Path $SelfDir 'j1-watchdog-sentinel-once.sh'
if (-not (Test-Path $Sentinel)) { throw "找不到哨兵脚本: $Sentinel" }

$bash = 'C:\Program Files\Git\bin\bash.exe'
if (-not (Test-Path $bash)) { throw "找不到 bash: $bash (本单元依赖 Git for Windows)" }

# 转成 bash 认得的路径 (D:\x\y -> /d/x/y)
$sentinelPosix = '/' + ($Sentinel -replace '\\', '/' -replace '^([A-Za-z]):', '$1').Substring(0,1).ToLower() + `
                 (($Sentinel -replace '\\','/') -replace '^[A-Za-z]:','')

# 🔴 判定逻辑【不内联】, 调一个入库的包装脚本 —— 这一版是被上一版打出来的:
#    上一版把带分支的 shell 塞进 -lc 参数, 里面嵌套双引号把参数从中间截断 ⇒ bash 语法错误 rc=2。
#    而它坏成了"看起来正常": 注册成功、state=Ready、日志文件不存在,
#    与"一直健康从没响过"在读数上完全相同。露馅的是 lastResult=2, 不是日志。
$cron      = Join-Path $SelfDir 'j1-watchdog-sentinel-cron.sh'
if (-not (Test-Path $cron)) { throw "找不到包装脚本: $cron" }
$cronPosix = $sentinelPosix -replace 'j1-watchdog-sentinel-once\.sh$', 'j1-watchdog-sentinel-cron.sh'
$inner     = "J1_WD_SENTINEL_LOG='$($LogPath -replace '\\','/')' sh '$cronPosix'"

function Show-State {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $t) { Write-Host "ARMED=no   计划任务 '$TaskName' 不存在"; return $false }
  $i = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  Write-Host "ARMED=yes  state=$($t.State)  lastRun=$($i.LastRunTime)  lastResult=$($i.LastTaskResult)  nextRun=$($i.NextRunTime)"
  # 🔴 存在 != 在跑: 禁用态与不存在在"没有响声"上读数相同。
  if ($t.State -eq 'Disabled') { Write-Host "🔴 但它是 Disabled —— 不会被调用。" ; return $false }
  Write-Host "log=$LogPath  (只在响的时候写; 文件不存在 = 至今没响过, 【不等于】它在跑)"
  return $true
}

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "已卸载 '$TaskName'"; Show-State | Out-Null; exit 0
}

if ($Install) {
  $act  = New-ScheduledTaskAction -Execute $bash -Argument "-lc `"$inner`""
  $trg  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
            -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
  $set  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
  Register-ScheduledTask -TaskName $TaskName -Action $act -Trigger $trg -Settings $set -Force | Out-Null
  Write-Host "已注册 '$TaskName', 每 $IntervalMinutes 分钟一次"
  Show-State | Out-Null
  Write-Host ''
  Write-Host '🔴 告示(别把本单元读成"watchdog 已有守护"):'
  Write-Host '   本单元做到的是【定时调用那道闸 + 响了留痕】。'
  Write-Host '   它【没有】把响声送到任何人面前 —— 日志要有人读才算告警。'
  Write-Host '   "送达"那一半仍然 OPEN(Codex 2026-08-10T17:04Z 原话: reach the actual'
  Write-Host '   notification/escalation consumer)。'
  exit 0
}

# 默认 -Verify
$ok = Show-State
if (-not $ok) { exit 1 }
exit 0
