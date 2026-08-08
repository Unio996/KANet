# TN12 node sentinel -- watches THIS node's health and makes the failure audible.
# Author: J1tn, 2026-08-09.
#
# ---------------------------------------------------------------------------
# WHY
# ---------------------------------------------------------------------------
# The mining host has tn12-mining-watchdog-v2.ps1. A pure receiver had NOTHING, and that is
# exactly how it lost four hours on 2026-08-08: connected, alive, processing zero blocks,
# 172,337 behind, and nobody knew. The 15h outage the day before ended the same way -- not
# detected by any monitor, but because the Owner happened to ask.
#
# So this sentinel's only job is to make silence impossible. It takes no corrective action:
# on a receiver the remedies (add a peer, restart with --ram-scale) are judgement calls, and
# an automaton guessing between them can make things worse. Detect and shout; let a human act.
#
# ---------------------------------------------------------------------------
# ALERT ROUTING -- deliberately more than one path
# ---------------------------------------------------------------------------
#   file    : always written. Survives everything, requires someone to look.
#   channel : posted via the local console API when the node can still broadcast.
#             This is the path that reaches teammates without anyone looking -- but it runs
#             over Kaspa, so it is exactly the path a node failure can sever. That is why it
#             is never the ONLY path. (2026-08-07: the outage silenced the whole team's
#             channel; the report had to travel by git instead.)
# Rule this encodes: a report must not depend solely on the component being reported on.
$ErrorActionPreference = 'Continue'

$ProbePath   = if ($env:TN12_PROBE)   { $env:TN12_PROBE }   else { "$PSScriptRoot\tn12-dag-health-probe.mjs" }
$PollSec     = if ($env:TN12_SENTINEL_POLL) { [int]$env:TN12_SENTINEL_POLL } else { 300 }
$AlertFile   = if ($env:TN12_ALERT_FILE) { $env:TN12_ALERT_FILE } else { 'D:\kaspa-tn12-data\_NODE_ALERT.txt' }
$ConsoleBase = if ($env:TN12_CONSOLE)  { $env:TN12_CONSOLE }  else { 'http://127.0.0.1:3200' }
$RelayId     = $env:TN12_RELAY_ID          # unset => channel path disabled, file path still works
$Channel     = if ($env:TN12_CHANNEL)  { $env:TN12_CHANNEL }  else { 'dev-coord-testnet' }
$MaxRounds   = if ($env:TN12_MAX_ROUNDS) { [int]$env:TN12_MAX_ROUNDS } else { 0 }

# States needing a human. `behind` and `catching-up` are NOT here: both are normal transients
# (a restart legitimately lags while headers stream in). Alerting on them would train everyone
# to ignore this file, which is the same outcome as having no alert at all.
$BAD = @('runaway','starved')

function Write-Alert([string]$msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  $line | Out-File $AlertFile -Append -Encoding UTF8
  Write-Host $line
  if ($RelayId) {
    try {
      # Body built as an object and serialised by the HTTP client: the message text is never a
      # shell word. (2026-07-25: a message containing a fenced code block was EXECUTED because
      # it was interpolated into a bash command line; backticks inside double quotes are command
      # substitution. Never route alert text through a shell.)
      $body = @{ relayId = $RelayId; channel = $Channel; message = "[J1tn sentinel] $msg" } | ConvertTo-Json -Compress
      Invoke-RestMethod -Uri "$ConsoleBase/api/chat/send" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 30 | Out-Null
    } catch {
      "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') (channel alert failed: $($_.Exception.Message) -- file path above still holds)" | Out-File $AlertFile -Append -Encoding UTF8
    }
  }
}

$last = $null
$round = 0
Write-Alert "sentinel started (poll=${PollSec}s, alert-on=$($BAD -join '/'), channel=$(if($RelayId){'on'}else{'OFF (no TN12_RELAY_ID)'}))"

while ($true) {
  $round++
  if ($MaxRounds -gt 0 -and $round -gt $MaxRounds) { Write-Host 'sentinel exiting (bounded mode)'; break }

  $diag = 'probe-unreadable'
  $detail = ''
  try {
    $raw = & node $ProbePath 2>$null
    if ($raw) {
      $j = $raw | ConvertFrom-Json
      if ($j.ok) {
        $diag = $j.diagnosis
        $detail = "tips=$($j.tips) lag=$($j.lagSeconds)s gap=$($j.headerMinusBlock) synced=$($j.isSynced)"
      } else { $detail = $j.probeError }
    }
  } catch { $detail = $_.Exception.Message }

  # Edge-triggered: only state CHANGES are announced. A level-triggered alert repeats every
  # poll and becomes noise nobody reads -- and noise nobody reads is silence.
  if ($diag -ne $last) {
    if ($BAD -contains $diag) {
      Write-Alert "PROBLEM: $diag  ($detail)"
    } elseif ($diag -eq 'probe-unreadable') {
      # Unknown is not the same as bad, but it must not be silent either: a blind sentinel and
      # a healthy node read identically from the outside.
      Write-Alert "PROBE UNREADABLE ($detail) -- cannot see this node's health"
    } elseif ($BAD -contains $last -or $last -eq 'probe-unreadable') {
      Write-Alert "RECOVERED: $diag  ($detail)"   # recovery is load-bearing: it closes the incident
    }
    $last = $diag
  }
  Start-Sleep -Seconds $PollSec
}
