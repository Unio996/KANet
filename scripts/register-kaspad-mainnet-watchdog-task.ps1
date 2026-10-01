# register-kaspad-mainnet-watchdog-task.ps1 -- 把主网 kaspad 看门狗注册成 Windows 计划任务(开机/登录自启, 隐藏窗口)。
# J2 2026-10-02(Bettor 派工, Owner「主网节点也配个看门狗」; 背景 账本 (1789): 主网 kaspad 崩溃后无人拉起空转约 2 小时)。
# 写法照 scripts/register-console-supervisor-task.ps1(同一套 Register-ScheduledTask 骨架), 看门狗本体 = scripts/kaspad-watchdog.ps1 -Profile mainnet。
#
# 一行安装(在主网节点恢复之后, 由 KANet-UI 执行):
#   powershell -NoProfile -ExecutionPolicy Bypass -File D:\kanet-tn12\scripts\register-kaspad-mainnet-watchdog-task.ps1
#   然后: Start-ScheduledTask -TaskName 'KANet-Kaspad-Mainnet-Watchdog'
# 预演(不注册任何东西, 只打印将注册的内容): 加 -DryRun。 卸载: 加 -Unregister。
#
# 默认以【当前用户】+ S4U 登录类型运行: 开机即启(不用等登录)、不存密码、不需要管理员提权(为自己注册)。
#   -RunAsUser SYSTEM  : 最耐久(注销/重启都在), 但需要管理员注册, 且 SYSTEM 起的 kaspad 其 CommandLine 对普通用户不可读
#                        (看门狗对"口主人 CommandLine 读不到"记 Unknown 不冤判, 但不如同用户省心) —— 默认不选它。
# 看门狗只启不杀; 单实例(开机+登录两个触发器各拉一份时, 第二份因互斥量直接退出); 崩溃循环刹车 5 次/300s, 冷却 1800s。
# 日志: D:\kaspa-mainnet-data-v201-logs\kaspad-watchdog.log(详细) 与 D:\kanet-tn12\logs\kaspad-mainnet-watchdog.log(起停/拒起/刹车事件一行制)。

param(
  [string]$TaskName = 'KANet-Kaspad-Mainnet-Watchdog',
  [string]$RepoRoot = 'D:\kanet-tn12',
  [string]$RunAsUser = "$env:USERDOMAIN\$env:USERNAME",
  [int]$MinFreeCommitGb = 2,   # 空闲提交量闸(GB)。看门狗默认 8, 但本机实测空闲提交量常在 0-4GB 间, 8 会让它该拉不拉; 默认 2, 见安装说明"内存闸"一节。0 = 用看门狗默认 8
  [switch]$DryRun,
  [switch]$Unregister
)
$ErrorActionPreference = 'Stop'

if ($Unregister) {
  if ($DryRun) { Write-Output "[dry-run] would Unregister-ScheduledTask '$TaskName'"; exit 0 }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Unregistered '$TaskName' (if it existed)."
  exit 0
}

$scriptPath = Join-Path $RepoRoot 'scripts\kaspad-watchdog.ps1'
if (-not (Test-Path $scriptPath)) { Write-Error "watchdog script not found: $scriptPath (check -RepoRoot)"; exit 1 }
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

# -WindowStyle Hidden + 任务 Hidden 设置: 不弹窗。-Profile mainnet 走主网配置(默认值即 (1065) 原命令, 见 kaspad-watchdog.ps1 mainnet profile 块)。
$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`" -Profile mainnet"
if ($MinFreeCommitGb -gt 0) { $arg += " -MinFreeCommitGb $MinFreeCommitGb" }
$action = New-ScheduledTaskAction -Execute $psExe -Argument $arg -WorkingDirectory $RepoRoot

$triggers = @(
  (New-ScheduledTaskTrigger -AtStartup)
  (New-ScheduledTaskTrigger -AtLogOn)
)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -Hidden `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 0) `
  -MultipleInstances IgnoreNew

if ($RunAsUser -eq 'SYSTEM') {
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
} else {
  $principal = New-ScheduledTaskPrincipal -UserId $RunAsUser -LogonType S4U -RunLevel Limited
}
$task = New-ScheduledTask -Action $action -Trigger $triggers -Settings $settings -Principal $principal

if ($DryRun) {
  Write-Output "[dry-run] task '$TaskName' would be registered as: RunAs=$RunAsUser"
  Write-Output "[dry-run] action : $psExe $arg"
  Write-Output "[dry-run] triggers: AtStartup + AtLogOn ; Hidden ; RestartCount 999 / 1 min ; MultipleInstances IgnoreNew ; no time limit"
  Write-Output "[dry-run] NOTHING registered."
  exit 0
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -InputObject $task | Out-Null
Write-Output "Registered scheduled task '$TaskName' (RunAs=$RunAsUser). Not started by this script."
Write-Output "Start now : Start-ScheduledTask -TaskName '$TaskName'"
Write-Output "Check     : Get-ScheduledTask -TaskName '$TaskName' | Select State, LastRunTime, LastTaskResult"
Write-Output "Remove    : powershell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Unregister"
