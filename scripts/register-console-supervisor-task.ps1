# register-console-supervisor-task.ps1 — makes kanet-console-supervisor.sh reboot-durable
# via a genuine Windows Scheduled Task, instead of the current bash-loop (`nohup bash "$0" _run &`).
#
# WHY THIS EXISTS (KANet-UI, 2026-08-22/23, Bettor (612)/(767) P1② — script only, not executed by me):
# The bash-loop supervisor works while its launching session lives, but J1 found the actual failure
# mode: when it's started from an SSH session, Windows' Job Object cleanup kills the whole nohup'd
# process tree the moment that SSH session ends — nohup's protection does not survive that specific
# launch path on Windows. A genuine Scheduled Task is a first-class OS object, not a child of any
# login session, so it survives SSH/RDP disconnects, console logoffs, and (with the right trigger)
# reboots.
#
# REQUIRES ELEVATION (schtasks /create with these options needs an admin token) — this is exactly
# why this is a script for J1/Owner to run, not something I can execute myself (non-admin all
# session, every taskkill/Stop-Process on SYSTEM-owned or other-context processes has been denied).
#
# WHAT THIS DOES NOT DO: it does not touch pool.js, settlement code, or any money-path file. It only
# wraps the existing, already-approved supervisor script in a more durable launcher.

param(
  [string]$TaskName = 'KANet-Console-Supervisor',
  [string]$RepoRoot = 'D:\kanet-tn12',
  [string]$BashExe  = 'C:\Program Files\Git\bin\bash.exe',
  # 'SYSTEM' = maximally durable (survives logoff, no stored credentials, can't be killed without
  #   elevation — but that last property is a double-edged sword: it repeats the exact "non-admin
  #   agent can't restart it" friction we hit with kaspad/console all session. Trade-off, not a
  #   default I'm picking for you.
  # '<domain>\<user>' = runs as a specific account (needs -Password prompt or a stored credential;
  #   this script does not collect a password — pass it interactively via Register-ScheduledTask
  #   prompts, or pre-stage credentials your own way). Killable/restartable by that same user without
  #   elevation, consistent with how the supervisor behaves today.
  [string]$RunAsUser = 'SYSTEM'
)

$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
  Write-Error "Must run elevated (Administrator). This is expected -- see header comment."
  exit 1
}

$scriptPath = Join-Path $RepoRoot 'scripts\kanet-console-supervisor.sh'
if (-not (Test-Path $scriptPath)) {
  Write-Error "Supervisor script not found at $scriptPath -- check -RepoRoot"
  exit 1
}

# Action runs the script's own `_run` internal mode directly (NOT `start`) -- `start` does its own
# nohup-backgrounding + pidfile bookkeeping, which is exactly the mechanism we're replacing. The
# Scheduled Task infrastructure IS the backgrounding/restart layer now; `_run` is the bare foreground
# loop and Task Scheduler supervises the process itself (via the Restart-on-failure settings below),
# not the bash-loop's own machinery.
$action = New-ScheduledTaskAction -Execute $BashExe -Argument "`"$scriptPath`" _run" -WorkingDirectory $RepoRoot

# Two triggers: at system startup (survives reboot) and at any user logon (covers the case where the
# task's account context needs an interactive session to establish some environment; harmless
# duplicate trigger if boot-time launch already succeeded, since the task is marked non-overlapping).
$triggers = @(
  (New-ScheduledTaskTrigger -AtStartup)
  (New-ScheduledTaskTrigger -AtLogOn)
)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 0) `
  -MultipleInstances IgnoreNew

if ($RunAsUser -eq 'SYSTEM') {
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
} else {
  # Interactive registration will prompt for the account's password via the Windows credential UI
  # when -Password is omitted from Register-ScheduledTask; run this in an interactive elevated
  # session, not headlessly, if you pick a non-SYSTEM account.
  $principal = New-ScheduledTaskPrincipal -UserId $RunAsUser -LogonType Password -RunLevel Highest
}

$task = New-ScheduledTask -Action $action -Trigger $triggers -Settings $settings -Principal $principal

# Remove any prior registration of the same name first (idempotent re-run), then register fresh.
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -InputObject $task | Out-Null

Write-Output "Registered scheduled task '$TaskName' (RunAs=$RunAsUser). Not started automatically by this script -- start it explicitly or reboot."
Write-Output "To start now:  Start-ScheduledTask -TaskName '$TaskName'"
Write-Output "To check state: Get-ScheduledTask -TaskName '$TaskName' | Select State, LastRunTime, LastTaskResult"
