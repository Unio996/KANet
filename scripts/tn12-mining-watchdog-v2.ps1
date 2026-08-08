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
#
# ---------------------------------------------------------------------------
# MINER IDENTITY IS THREE-VALUED, NOT BOOLEAN (Codex 2026-08-08 round 3 MUST-FIX)
# ---------------------------------------------------------------------------
# Get-MinerState returns OWNED_RUNNING / CONFIRMED_ABSENT / UNKNOWN_OR_CONFLICT,
# not a boolean. A round-2 fix made the STOP path safe (never touch a process you
# can't confirm you own) but every auto-START call site still read "not confirmed
# running" as one thing -- so a transient identity-check failure (CIM query hiccup,
# unreadable pid file) while the real miner was alive and well would launch a
# SECOND miner, reproducing the exact death spiral this breaker exists to prevent.
# Same lesson as the DAG-probe section above: an absent positive reading has two
# causes (genuinely gone vs. can't tell), and only one of them is safe to act on.
# Start-Miner-Unless-Paused is the single choke point all 4 auto-start call sites
# go through -- it only starts on CONFIRMED_ABSENT, no-ops silently on
# OWNED_RUNNING, and Alerts without starting on UNKNOWN_OR_CONFLICT (this is also
# the "stale/corrupt pid-file metadata needs an explicit operator look, not a
# silent auto-start" requirement -- an unparsable pid file is UNKNOWN_OR_CONFLICT).
# Five scenarios this must get right (traced by hand; no PS test harness exists for
# this script, verification is manual code trace + will be exercised live once
# deployed): (1) CIM query fails transiently while the real miner is alive -> no
# recorded commandLine changes, but Win32_Process query throws -> UNKNOWN_OR_CONFLICT,
# no second miner. (2) commandLine unreadable (recorded null, e.g. Start-Miner's own
# readback failed) -> UNKNOWN_OR_CONFLICT. (3) PID reuse, an unrelated (non-bridge)
# process now owns that PID -> .Path mismatch -> CONFIRMED_ABSENT, safe to start.
# (4) pid file missing/corrupt while a real miner happens to be running untracked
# -> UNKNOWN_OR_CONFLICT (cannot prove absence without name-matching, which round 1
# already rejected as unsafe) -- accepted limitation, strictly safer than fail-open.
# (5) normal case, miner genuinely exited, pid file intact and consistent -> Get-Process
# returns nothing for that PID -> CONFIRMED_ABSENT, restarts normally.
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
# Codex 2026-08-08 round 3 MUST-FIX: the round-2 fix (commandLine match) was correct
# for the STOP direction but Get-OwnedMinerProcess's null return conflated three
# different facts into one falsy value: CONFIRMED_ABSENT (pid file missing / OS
# confirms nothing runs at that PID / that PID belongs to something that isn't any
# stratum-bridge) and UNKNOWN_OR_CONFLICT (pid file unparsable, or a real
# stratum-bridge IS running there but a transient CIM query failure or a
# commandLine mismatch means we can't confirm it's ours). Every prior call site
# read null as "safe to start a new miner" -- so a one-shot CIM hiccup while our
# own miner was alive and well would launch a SECOND miner, reproducing the exact
# death spiral this breaker exists to prevent. "Absent" has two causes (confirmed
# gone vs can't tell) and they demand opposite actions on the start path, even
# though round 2 correctly treated them the same way on the stop path (don't touch
# what you can't confirm).
function Get-MinerState {
  if (-not (Test-Path $minerPidFile)) { return @{ State = 'CONFIRMED_ABSENT'; Process = $null } }
  $raw = Get-Content $minerPidFile -Raw -ErrorAction SilentlyContinue
  if (-not $raw) { return @{ State = 'CONFIRMED_ABSENT'; Process = $null } }
  $rec = $null
  try { $rec = $raw | ConvertFrom-Json } catch {
    Log "Get-MinerState: pid file unparsable -- UNKNOWN_OR_CONFLICT (needs operator look at $minerPidFile before this will auto-start again)"
    return @{ State = 'UNKNOWN_OR_CONFLICT'; Process = $null }
  }
  if (-not $rec.pid) { return @{ State = 'CONFIRMED_ABSENT'; Process = $null } }
  $proc = Get-Process -Id $rec.pid -ErrorAction SilentlyContinue
  if (-not $proc) { return @{ State = 'CONFIRMED_ABSENT'; Process = $null } }  # OS-level fact: nothing runs at that PID
  if ($proc.Path -ne $bridgeExe) { return @{ State = 'CONFIRMED_ABSENT'; Process = $null } }  # that PID isn't any stratum-bridge -- ours is gone, PID recycled
  if (-not $rec.commandLine) {
    Log "Get-MinerState: PID=$($rec.pid) has no recorded commandLine -- UNKNOWN_OR_CONFLICT (a stratum-bridge IS running at this PID/path, cannot confirm it's ours)"
    return @{ State = 'UNKNOWN_OR_CONFLICT'; Process = $proc }
  }
  $currentCmdLine = $null
  try { $currentCmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($rec.pid)" -ErrorAction Stop).CommandLine } catch {}
  if (-not $currentCmdLine) {
    Log "Get-MinerState: PID=$($rec.pid) CommandLine query failed (transient CIM hiccup?) -- UNKNOWN_OR_CONFLICT, not touching, not starting a second instance"
    return @{ State = 'UNKNOWN_OR_CONFLICT'; Process = $proc }
  }
  if ($currentCmdLine -ne $rec.commandLine) {
    Log "Get-MinerState: PID=$($rec.pid) commandLine mismatch (PID reuse or an unrelated stratum-bridge instance at the same path) -- UNKNOWN_OR_CONFLICT"
    return @{ State = 'UNKNOWN_OR_CONFLICT'; Process = $proc }
  }
  return @{ State = 'OWNED_RUNNING'; Process = $proc }
}

function Start-Miner {
  $env:BRIDGE_SKIP_SYNC_GATE = '1'
  $p = Start-Process -FilePath $bridgeExe -ArgumentList $bridgeArgs -WorkingDirectory (Split-Path $bridgeExe) `
    -RedirectStandardOutput "D:\kaspa-tn12-mining\_bridge_tn12.log" `
    -RedirectStandardError  "D:\kaspa-tn12-mining\_bridge_tn12_err.log" -WindowStyle Hidden -PassThru
  # Record the exact command line the OS sees for this PID right now, not $bridgeArgs
  # verbatim -- Win32_Process's CommandLine is what Get-MinerState will compare
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
  $s = Get-MinerState
  if ($s.State -eq 'OWNED_RUNNING') {
    Stop-Process -Id $s.Process.Id -Force -Confirm:$false -ErrorAction SilentlyContinue
    Log "Stop-Miner: stopped owned PID=$($s.Process.Id)"
    Remove-Item $minerPidFile -ErrorAction SilentlyContinue
  } elseif ($s.State -eq 'UNKNOWN_OR_CONFLICT') {
    Log "Stop-Miner: state UNKNOWN_OR_CONFLICT -- not touching (cannot confirm ownership); pid file left as-is for operator inspection"
  } else {
    Log "Stop-Miner: no owned instance on record -- not touching other stratum-bridge processes"
    Remove-Item $minerPidFile -ErrorAction SilentlyContinue
  }
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
  # Codex 2026-08-08 round 3 MUST-FIX, checked here once so every call site
  # inherits it instead of each one having to separately remember "only start on
  # CONFIRMED_ABSENT" -- a repeat of the exact bug class this fix closes.
  $s = Get-MinerState
  if ($s.State -eq 'OWNED_RUNNING') { return }  # already running -- silent, this is the expected steady state
  if ($s.State -eq 'UNKNOWN_OR_CONFLICT') {
    Alert "Start-Miner skipped: state UNKNOWN_OR_CONFLICT -- a stratum-bridge may already be running and not confirmed ours; starting another would risk a double-miner. Needs operator look at $minerPidFile."
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
    if (-not $braked) { Start-Miner-Unless-Paused }  # self-guards: no-op if OWNED_RUNNING, alerts (no start) if UNKNOWN_OR_CONFLICT, starts only if CONFIRMED_ABSENT
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
    Start-Miner-Unless-Paused  # self-guards: no-op if OWNED_RUNNING, alerts (no start) if UNKNOWN_OR_CONFLICT, starts only if CONFIRMED_ABSENT
  }

  Start-Sleep -Seconds $POLL_SEC
}
