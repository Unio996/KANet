# TN12 mining watchdog v2 -- keepalive PLUS a DAG-width circuit breaker.
# Author: J1tn, 2026-08-08, after the 15h TN12 virtual-stall incident.
# Replaces: tn12-mining-watchdog.ps1 (kept intact at .v1.bak -- v1 had keepalive only).
#
# ---------------------------------------------------------------------------
# DEPLOYMENT SEQUENCE (NWT 2026-08-08 10:17Z -- read this before (re)deploying)
# ---------------------------------------------------------------------------
# This revision introduces $minerPidFile, which no process running under the
# OLD script has ever written. Dropping this file in place and letting the
# old watchdog loop "pick up" the new code on its next iteration does NOT
# work -- the old loop is still running the old functions until it's killed,
# and the old Get-Process -Name matching would see whatever the new script
# starts too. If both scripts are ever running at once, or if the new script
# starts while an old, unmanaged stratum-bridge is still alive, the new
# watchdog reads "no owned instance" and launches a SECOND miner: two
# processes mining at once, doubling production rate -- the exact failure
# mode this circuit breaker exists to prevent.
# Deploy = stop the old watchdog process AND any running stratum-bridge
# process, confirm clean (no stratum-bridge in the process list), THEN start
# this script. Never deploy by just replacing the .ps1 file in place.
#
# ---------------------------------------------------------------------------
# WHAT BROKE (read this before changing any threshold)
# ---------------------------------------------------------------------------
# Two sync gates are deliberately disabled so TN12 can bootstrap and not halt:
#     kaspad --enable-unsynced-mining      and     bridge BRIDGE_SKIP_SYNC_GATE=1
# Both are REQUIRED. Removing either one deadlocks the network:
#     no blocks -> sink timestamp stays stale -> node never reports synced
#     -> submitBlock is rejected -> still no blocks.  (rusty-kaspa
#      rpc/service/src/service.rs:308 is the guard those flags switch off.)
#
# But with both gates off there was NO other brake. Once the node fell behind
# (sync rate 0.48 -> 0.05 on 2026-08-08 01:45+08), the miner kept producing:
#     produce ~0.56 blk/s  >  utxo-validate ~0.2 blk/s
#     -> tips accumulate -> mergeset saturates (capped ~248) -> validation slows
#     -> even more tips.   Positive feedback. It does NOT self-heal.
# It ran unattended for 15 hours, reached 18132 tips, and took the whole team's
# channel down with it (every relay broadcast was refused: node not synced).
#
# Stopping the miner alone recovered it: 18132 -> 11096 -> 2 tips in ~20 min.
# That is the entire fix, and this script automates it.
#
# ---------------------------------------------------------------------------
# WHY tips, AND NOT isSynced
# ---------------------------------------------------------------------------
# isSynced cannot be the mining gate -- that is exactly the deadlock above.
# tips measures DAG width directly, which is the quantity that actually runs away.
# Observed values: healthy = 2 (single digits).  Incident peak = 18132.
# Four orders of magnitude between them, so the thresholds below are not close calls.
#
# ---------------------------------------------------------------------------
# WHEN THE PROBE ITSELF FAILS  (deliberate, do not "fix" without reading)
# ---------------------------------------------------------------------------
# Probe failure and a wide DAG are NOT the same reading, and they imply opposite
# actions. If the probe cannot answer we KEEP MINING and shout, because:
#   - braking on an unknown reading turns a probe bug into a guaranteed dead chain;
#   - a dead chain is loud and immediate, DAG pollution is silent (15h unnoticed).
# So: unknown -> keep mining + alert. Known-bad -> brake. Known-good -> mine.
$ErrorActionPreference = 'Continue'

# --- thresholds (hysteresis; see baseline note above) ---
# Overridable by env so the brake can be EXERCISED against the real script.
# A circuit breaker nobody ever tripped on purpose is decoration: you cannot tell
# "never fires because all is well" from "never fires because it is broken".
# Verify with:  TN12_TIPS_BRAKE=1 TN12_TIPS_RESUME=0 TN12_POLL_SEC=5 TN12_MAX_ROUNDS=4
$TIPS_BRAKE  = if ($env:TN12_TIPS_BRAKE)  { [int]$env:TN12_TIPS_BRAKE }  else { 500 }  # above -> stop mining, digest
$TIPS_RESUME = if ($env:TN12_TIPS_RESUME) { [int]$env:TN12_TIPS_RESUME } else { 50 }   # back below -> resume
$POLL_SEC    = if ($env:TN12_POLL_SEC)    { [int]$env:TN12_POLL_SEC }    else { 30 }
$MAX_ROUNDS  = if ($env:TN12_MAX_ROUNDS)  { [int]$env:TN12_MAX_ROUNDS }  else { 0 }    # 0 = run forever

$addr        = "kaspatest:qrys4yax468rrm988kyqjtncvstcelgzktml0m3rvdvvktrll0gdxuyu34fru"
$CPU_THREADS = 1  # Bettor 2026-08-08 10:12Z: was 2, dropped to 1 -- the incident's root imbalance
                  # (produce rate > verify rate) gets worse not better at 2 threads, and the
                  # deployed default had silently drifted back to 2 despite J1 reporting "already
                  # on 1" (NWT caught the mismatch). 1 is the conservative safe value while the
                  # brake's steady-state behavior is still being observed; final production
                  # thread count is still an Owner-layer decision, not settled here.
$bridgeExe   = "D:\rusty-kaspa-tn10-build\release\stratum-bridge.exe"
$bridgeArgs  = "--config D:/kaspa-tn12-mining/bridge-tn12-config.yaml --node-mode external --kaspad-address 127.0.0.1:16210 --testnet --print-stats true --internal-cpu-miner --internal-cpu-miner-address $addr --internal-cpu-miner-threads $CPU_THREADS"

$probe       = "D:\kaspa-tn12-mining\tn12-dag-health-probe.mjs"
$wlog        = "D:\kaspa-tn12-mining\_watchdog.log"
$alertFile   = "D:\kaspa-tn12-mining\_DAG_ALERT.txt"   # deliberately NOT over Kaspa
$minerPidFile = "D:\kaspa-tn12-mining\_watchdog_miner.pid"
$pausedFile   = "D:\kaspa-tn12-mining\_MINER_PAUSED.txt"

function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Out-File $wlog -Append -Encoding UTF8 }

# Alert path must not depend on the component being reported on. The 2026-08-08
# incident was invisible for 15h because the only alert channel was the Kaspa
# channel, which the failure itself had taken down.
function Alert($m) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Out-File $alertFile -Append -Encoding UTF8
  Log "ALERT: $m"
}

function Get-Tips {
  try {
    $raw = & node $probe 2>$null
    if (-not $raw) { return $null }
    $j = $raw | ConvertFrom-Json
    if (-not $j.ok) { return $null }
    return [int]$j.tips
  } catch { return $null }
}

# Codex 2026-08-08 Finding 3 (round 1): matching by process NAME kills/misses across
# instances -- a different stratum-bridge we don't own reads as "healthy" while our
# target is dead, or gets killed by mistake. Track the PID we actually launched and
# verify identity before trusting or touching anything -- never act on the name alone.
#
# Codex 2026-08-08 round 2 MUST-FIX: PID + exe path alone is still not identity.
# Two stratum-bridge processes at the SAME exe path but launched with different
# --config/--kaspad-address/--internal-cpu-miner-threads (someone else's manual
# run, a leftover from a prior deploy, or an ordinary PID-reuse collision after our
# instance exited) satisfy "PID matches, .Path matches" without being the instance
# we started. $minerPidFile now records the exact command line captured at OUR
# Start-Miner call; ownership requires that recorded command line to match the
# CURRENT command line running at that PID, not just the PID number and exe path.
# No commandLine on record, or a query failure, or a mismatch -> not owned (fail
# closed, per the project's "deny 绝不 fail-open" convention -- an unconfirmed
# process must never be treated as ours to stop, and an unconfirmed absence must
# never suppress a legitimate Start-Miner).
function Get-OwnedMinerProcess {
  if (-not (Test-Path $minerPidFile)) { return $null }
  $raw = Get-Content $minerPidFile -Raw -ErrorAction SilentlyContinue
  if (-not $raw) { return $null }
  try { $rec = $raw | ConvertFrom-Json } catch { Log "Get-OwnedMinerProcess: pid file unparsable -- treating as not owned"; return $null }
  if (-not $rec.pid) { return $null }
  $proc = Get-Process -Id $rec.pid -ErrorAction SilentlyContinue
  if (-not $proc) { return $null }
  if ($proc.Path -ne $bridgeExe) { return $null }  # PID reuse landed on an unrelated process
  if (-not $rec.commandLine) {
    Log "Get-OwnedMinerProcess: PID=$($rec.pid) has no recorded commandLine -- cannot confirm identity, treating as not owned"
    return $null
  }
  $currentCmdLine = $null
  try { $currentCmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($rec.pid)" -ErrorAction Stop).CommandLine } catch {}
  if ($currentCmdLine -ne $rec.commandLine) {
    Log "Get-OwnedMinerProcess: PID=$($rec.pid) commandLine mismatch (PID reuse or an unrelated stratum-bridge instance at the same path) -- not touching it"
    return $null
  }
  return $proc
}

function Miner-Running { [bool](Get-OwnedMinerProcess) }

function Start-Miner {
  $env:BRIDGE_SKIP_SYNC_GATE = '1'
  $p = Start-Process -FilePath $bridgeExe -ArgumentList $bridgeArgs -WorkingDirectory (Split-Path $bridgeExe) `
    -RedirectStandardOutput "D:\kaspa-tn12-mining\_bridge_tn12.log" `
    -RedirectStandardError  "D:\kaspa-tn12-mining\_bridge_tn12_err.log" -WindowStyle Hidden -PassThru
  # Record the exact command line the OS sees for this PID right now, not $bridgeArgs
  # verbatim -- Win32_Process's CommandLine is what Get-OwnedMinerProcess will compare
  # against later, so the recorded value must come from the same source it will be
  # checked against (quoting/exe-path formatting can differ between the two).
  Start-Sleep -Milliseconds 200
  $cmdLine = $null
  try { $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)" -ErrorAction Stop).CommandLine } catch {}
  if (-not $cmdLine) { Log "Start-Miner: WARNING could not read back commandLine for PID=$($p.Id) -- ownership checks will fail closed (treat as not-owned) until next successful start" }
  (@{ pid = $p.Id; commandLine = $cmdLine } | ConvertTo-Json -Compress) | Out-File $minerPidFile -Encoding utf8
  Log "Start-Miner: launched PID=$($p.Id) commandLine-recorded=$([bool]$cmdLine)"
}

function Stop-Miner {
  $proc = Get-OwnedMinerProcess
  if ($proc) {
    Stop-Process -Id $proc.Id -Force -Confirm:$false -ErrorAction SilentlyContinue
    Log "Stop-Miner: stopped owned PID=$($proc.Id)"
  } else {
    Log "Stop-Miner: no owned instance on record -- not touching other stratum-bridge processes"
  }
  Remove-Item $minerPidFile -ErrorAction SilentlyContinue
}

# Bettor 2026-08-08 10:17Z: PID tracking cannot express "operator deliberately
# stopped this" -- and that IS the reason the brake exists (the incident's own
# fix was "stop mining"; auto-reviving fights the emergency stop). The tips
# brake and this sentinel are deliberately two different mechanisms:
#   - tips brake: automatic, self-resuming, never touches $pausedFile
#   - $pausedFile: only a human creates/removes it, and it overrides everything
# Every call site that would otherwise call Start-Miner must go through this,
# not call Start-Miner directly.
function Start-Miner-Unless-Paused {
  if (Test-Path $pausedFile) {
    Log "Start-Miner skipped: $pausedFile present (operator pause) -- remove that file to allow mining again"
    return
  }
  Start-Miner
}

$braked      = $false
$probeFails  = 0
$round       = 0
Log "watchdog v2 started (brake>$TIPS_BRAKE resume<$TIPS_RESUME poll=${POLL_SEC}s threads=$CPU_THREADS maxRounds=$MAX_ROUNDS)"

while ($true) {
  $round++
  if ($MAX_ROUNDS -gt 0 -and $round -gt $MAX_ROUNDS) {
    # Bounded run (brake-exercise mode). Never leave the miner braked on exit.
    if ($braked) { Log "maxRounds reached while braked -> restarting miner before exit"; Start-Miner-Unless-Paused }
    Log "watchdog v2 exiting after $MAX_ROUNDS rounds (exercise mode)"
    break
  }
  $tips = Get-Tips

  if ($null -eq $tips) {
    # UNKNOWN -- keep current mining behaviour, but make the blindness loud.
    $probeFails++
    if ($probeFails -eq 1 -or $probeFails % 20 -eq 0) {
      Alert "DAG probe unreadable x$probeFails -- mining left AS-IS (unknown != bad). Check node RPC / probe at $probe"
    }
    if (-not $braked -and -not (Miner-Running)) { Log "bridge DEAD -> starting (probe blind)"; Start-Miner-Unless-Paused }
    Start-Sleep -Seconds $POLL_SEC
    continue
  }

  if ($probeFails -gt 0) { Log "DAG probe readable again after $probeFails failure(s)"; $probeFails = 0 }

  if (-not $braked -and $tips -gt $TIPS_BRAKE) {
    $braked = $true
    Stop-Miner
    Alert "BRAKE ENGAGED: tips=$tips > $TIPS_BRAKE. Miner stopped so the node can digest. Will resume under $TIPS_RESUME."
  }
  elseif ($braked -and $tips -lt $TIPS_RESUME) {
    $braked = $false
    Alert "BRAKE RELEASED: tips=$tips < $TIPS_RESUME. Resuming mining."
    Start-Miner-Unless-Paused
  }
  elseif ($braked) {
    Stop-Miner   # hold the brake; nothing else may resurrect the miner meanwhile
    Log "braked, waiting to digest (tips=$tips, need <$TIPS_RESUME)"
  }
  else {
    if (-not (Miner-Running)) { Log "bridge DEAD -> starting (tips=$tips)"; Start-Miner-Unless-Paused }
  }

  Start-Sleep -Seconds $POLL_SEC
}
