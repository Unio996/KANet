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
# MINER IDENTITY IS THREE-VALUED, NOT BOOLEAN (Codex 2026-08-08 rounds 3+4 MUST-FIX)
# ---------------------------------------------------------------------------
# Get-MinerState returns OWNED_RUNNING / CONFIRMED_ABSENT / UNKNOWN_OR_CONFLICT,
# not a boolean. A round-2 fix made the STOP path safe (never touch a process you
# can't confirm you own) but every auto-START call site still read "not confirmed
# running" as one thing -- so a transient identity-check failure (CIM query hiccup,
# unreadable pid file) while the real miner was alive and well would launch a
# SECOND miner, reproducing the exact death spiral this breaker exists to prevent.
# Same lesson as the DAG-probe section above: an absent positive reading has two
# causes (genuinely gone vs. can't tell), and only one of them is safe to act on.
# Round 3 introduced the three states but round 4 caught that CONFIRMED_ABSENT was
# still reachable from missing/empty/unparsable pid-file metadata alone -- that's
# absence of OUR bookkeeping, not proof the process is gone. Resolve-AbsentOrUnknown
# is the fix: CONFIRMED_ABSENT now requires an independent host-wide scan for any
# process at $bridgeExe to come back empty; a match (tracked or not) always yields
# UNKNOWN_OR_CONFLICT instead. This uses path-matching differently from what round
# 1 rejected: round 1's Finding 3 was about trusting a name/path match AS ownership
# (for stopping/restarting); here a match only ever pushes toward the cautious
# state, never toward trusting it as owned.
# Start-Miner-Unless-Paused is the single choke point all 4 auto-start call sites
# go through -- it only starts on CONFIRMED_ABSENT, no-ops silently on
# OWNED_RUNNING, and Alerts without starting on UNKNOWN_OR_CONFLICT (this is also
# the "stale/corrupt pid-file metadata needs an explicit operator look, not a
# silent auto-start" requirement).
# Scenarios this must get right (traced by hand; no PS test harness exists for this
# script, verification is manual code trace + will be exercised live once deployed):
# (1) CIM query fails transiently while the real miner is alive -> recorded PID
# matches path but Win32_Process query throws -> UNKNOWN_OR_CONFLICT, no second
# miner. (2) commandLine unreadable (recorded null, e.g. Start-Miner's own readback
# failed) -> UNKNOWN_OR_CONFLICT. (3) PID reuse, an unrelated (non-bridge) process
# now owns that PID, AND no other stratum-bridge is running anywhere on the host ->
# CONFIRMED_ABSENT (independently verified), safe to start. (3b) same PID reuse, but
# a stratum-bridge IS running under some other PID -> UNKNOWN_OR_CONFLICT, not
# CONFIRMED_ABSENT (round 4's fix -- round 3 would have missed this). (4) pid file
# missing/corrupt while a real miner happens to be running untracked -> the
# independent scan finds it -> UNKNOWN_OR_CONFLICT, not a silent auto-start (round
# 4's core fix; round 3 would have wrongly returned CONFIRMED_ABSENT here). (5)
# normal case, miner genuinely exited, pid file intact, and the independent scan
# also finds nothing at $bridgeExe anywhere -> CONFIRMED_ABSENT, restarts normally.
#
# ---------------------------------------------------------------------------
# TWO INVARIANTS (Bettor 2026-08-08 14:11, upgraded 15:22 -- every round-1-through-6
# finding was one of these two violated somewhere; self-certified here per state
# transition, not just patched at the one spot each round's finding pointed at)
# ---------------------------------------------------------------------------
# (1) NEVER start a duplicate miner.
# (2) ALWAYS be able to stop a miner this breaker itself started.
# 🔴 Round 6 correction (Codex found a CORE-BREAK in the actual brake, Bettor
# 15:22): the round-5 self-certification below checked STATE REACHABILITY --
# "does the code only attempt to stop/start when the state permits it" -- but not
# ACTION EFFICACY -- "did the stop/start actually work". Stop-Miner used to fire
# Stop-Process, unconditionally log "stopped", and delete the ownership record
# with no check that the process was actually gone; a silent kill failure meant a
# FALSE report of invariant (2) holding while the miner kept running, now
# untracked and permanently unstoppable. Every action point below is now verified,
# not just reachability-gated:
# Start (Start-Miner, reached only via Start-Miner-Unless-Paused):
#   - Unless-Paused only calls Start-Miner when Get-MinerState = CONFIRMED_ABSENT,
#     itself only reachable when either the tracked PID is independently proven
#     gone AND a host-wide scan independently proves nothing else is running at
#     $bridgeExe, or that scan is what concluded absence in the first place ->
#     satisfies (1): nothing already running when we launch.
#   - Efficacy: Start-Miner does not return "successful" until it has re-read the
#     LIVE commandLine for the PID it just launched via a fresh query (which can
#     only succeed against a genuinely running process) and persisted it; on
#     failure it kills what it just started (itself now verified, see below)
#     instead of leaving it running unconfirmed -> satisfies (2): a successful
#     Start-Miner return means Get-MinerState will read OWNED_RUNNING next check.
# Stop (Stop-Miner, reached from brake-engage/brake-hold, and the exercise-mode
# exit path resumes rather than stops so it doesn't apply here):
#   - Only ever attempts to kill a process when Get-MinerState = OWNED_RUNNING
#     (positively identified via PID + normalized path + matching commandLine or
#     the StartTime fallback) -> can't violate (1) (stopping isn't starting).
#   - Efficacy (round 6 fix): the kill is followed by a Get-Process re-check.
#     Confirmed gone -> log success, clear the pid file. NOT confirmed gone ->
#     the pid file is left AS-IS (state stays OWNED_RUNNING, which is still an
#     accurate read -- the process really is still alive), no success is
#     reported, and the next loop iteration retries the stop instead of the
#     breaker silently believing it already won.
#   - UNKNOWN_OR_CONFLICT: Stop-Miner deliberately does not touch it. This is
#     correct when the process ISN'T ours (touching it would be the round-1
#     mistake). It would violate (2) if a process WE started ever durably landed
#     here -- round 5 closed the only durable path into that (a launch that never
#     got ownership confirmed), and round 6's Test-OwnedByStartTime closes the
#     remaining transient/persistent CIM-failure path (PID + normalized path +
#     StartTime, from plain Get-Process, is used as a CIM-free ownership
#     confirmation whenever the CommandLine check can't run). Only ever used to
#     CONFIRM ownership, never to weaken CONFIRMED_ABSENT (that still requires the
#     independent host-wide scan).
# Start-Miner's own abort-kill path (established ownership fails after launch,
# see below) got the same efficacy check first (dbd5f4b1) -- round 6 mirrors it
# to the primary Stop-Miner path, which is the one that actually matters for the
# brake's core job.
# 🔴 Round 7 correction (Bettor 2026-08-08 16:11 -- the enumeration of "action
# points" itself was incomplete, not the fixes): rounds 5-6 verified three PROCESS
# actions (launch, abort-kill, main-stop) but missed a fourth action this
# invariant also depends on -- PERSISTING the ownership record. Start-Miner used
# to write the pid file with a plain Out-File and no read-back; a failed or
# truncated write there would leave a genuinely-running, in-memory-confirmed
# miner with no durable record to reconstruct OWNED_RUNNING from on the next
# poll -- and unlike a transient CIM hiccup, this failure does NOT self-heal
# (Start-Miner doesn't get called again just because the file write failed).
# Fixed: write to a temp file in the same directory (Move-Item into place is a
# same-volume rename, effectively atomic, not copy+delete) then read the
# destination back and verify it parses to the exact pid/commandLine just
# written. A write that can't be verified aborts the launch via the same
# Kill-AndVerify path as the commandLine-readback failure above -- persistence
# is now a fourth verified action point alongside launch/abort-kill/main-stop.
# The complete action-point set as of round 7: {launch, persist ownership,
# stop/kill, read ownership (Get-MinerState, verified continuously by
# construction since every branch either positively confirms or explicitly
# returns UNKNOWN_OR_CONFLICT)}.
# 🔴 Round 8 correction (Codex -- invariant (2) COMPLETENESS, not a missing action
# point this time): verifying persistence (round 7) and verifying kill (round 6)
# were each correct in isolation, but their COMPOUND failure -- the durable write
# fails AND the abort-kill also fails -- used to fall through to unconditionally
# discarding the in-memory provenance (pid/cmdLine/startTimeTicks) that Start-Miner
# still holds in scope at that point, via an unconditional Remove-Item. The
# surviving process (kill failed, it's still running) became a permanent orphan:
# host-wide scanning still protects invariant (1) (won't start a duplicate) but
# that alone doesn't restore invariant (2) (being able to target THIS one to stop
# it). Fix: Write-BestEffortOwnershipRecord -- one plain (non-atomic, unverified)
# write attempt using the values already in scope, tried only on this compound-
# failure path, before falling back to discarding the record. It cannot make
# things worse (if it also fails, behavior is identical to before this fix) and
# gives the next Get-MinerState poll a chance to recognize the survivor via either
# the commandLine match or the StartTime fallback. Applied to BOTH Start-Miner
# failure branches (commandLine-readback failure and persistence-verification
# failure) via one shared function, not two copies -- and StartTime capture moved
# to immediately after launch (it never depended on the commandLine check
# succeeding) so it's available for the recovery record in either branch, not just
# the happy path.
# Adversarial scenario traced (no automated harness for this script; verification
# is by code trace, per this file's established practice): write fails -> kill
# fails -> process survives -> Write-BestEffortOwnershipRecord succeeds -> next
# loop iteration's Get-MinerState reads the recovered record, finds the process
# still running with matching commandLine (or StartTime if commandLine was never
# captured), returns OWNED_RUNNING -> Stop-Miner can target and retry stopping it.
# If the best-effort write ALSO fails, the orphan is undetectable to this specific
# retry mechanism (same residual as before this fix), but is still caught by the
# host-wide scan on the next start attempt, which still refuses to start a
# duplicate -- invariant (1) never depends on this fix succeeding.
$ErrorActionPreference = 'Continue'

# --- thresholds (hysteresis; see baseline note above) ---
# Overridable by env so the brake can be EXERCISED against the real script.
# A circuit breaker nobody ever tripped on purpose is decoration: you cannot tell
# "never fires because all is well" from "never fires because it is broken".
# Verify with:  TN12_TIPS_BRAKE=1 TN12_TIPS_RESUME=0 TN12_POLL_SEC=5 TN12_MAX_ROUNDS=4
# The mergeset cliff, traced to source rather than repeated from memory (J1tn 2026-08-10).
# It had been quoted as "248" in every discussion for two days without anyone naming where it
# comes from, which is exactly how a number survives being wrong. On rusty-kaspa HEAD ab4c51a:
#   TESTNET12_PARAMS inherits ..TESTNET_PARAMS -> blockrate = BlockrateParams::new::<10>()
#   -> Bps<10>::ghostdag_k() = 124 -> mergeset_size_limit() = 124 * 2 = 248
# 🔴 Scope: read on MY tree. Other machines' checkouts differ (J2/Bettor read v2.0.0 at the same
# path on 2026-08-06), so re-derive rather than trust this line if the network params ever move.
$MERGESET_CLIFF = 248
# 🔴 Was 500 until 2026-08-10, i.e. 252 tips ABOVE the cliff it was supposed to back up: a level
# brake set past the point of no return can only fire after the damage, which makes it decoration.
# That argument is structural and needs no frequency data.
# 220 is chosen with ~28 tips of margin under the cliff. Measured false-brake cost of 220 = ZERO:
# across the full 18.7h remote sample record (scratch/tn12-remote-dag-samples.jsonl) max tips was
# 155 and the count of samples above 180 was 0.
# 🔴 READ THIS BEFORE TUNING IT: this is the BACKSTOP, not the primary criterion, and lowering it
# does NOT make the brake fire earlier. In all three recorded climb cycles (2026-08-09 12:0x/3x/5x)
# the brake was engaged by the `overproduction` DERIVATIVE verdict every single time, and this
# level threshold fired exactly zero times in the whole record. What actually gates how early the
# brake speaks is the probe's RISE_FLOOR (150): in cycle 1 the streak, span and 1.5x-growth
# conditions were all satisfied at 12:04:50Z (tips=104, streak=14, span=288s, 104/64=1.63) while
# the verdict waited until 12:10:17Z (tips=152) -- RISE_FLOOR alone cost 5.5 minutes of warning
# and 48 of the 96 tips of headroom under the cliff. Tune THAT if you want earlier braking.
$TIPS_BRAKE  = if ($env:TN12_TIPS_BRAKE)  { [int]$env:TN12_TIPS_BRAKE }  else { 220 }  # above -> stop mining, digest
$TIPS_RESUME = if ($env:TN12_TIPS_RESUME) { [int]$env:TN12_TIPS_RESUME } else { 50 }   # back below -> resume
$POLL_SEC    = if ($env:TN12_POLL_SEC)    { [int]$env:TN12_POLL_SEC }    else { 30 }
$MAX_ROUNDS  = if ($env:TN12_MAX_ROUNDS)  { [int]$env:TN12_MAX_ROUNDS }  else { 0 }    # 0 = run forever
# Duty cycle used while braked. Must stay well under POLL_SEC's cadence so each poll still
# re-reads tips before deciding again; 20s was chosen because measured pulses of 60-75s
# overshot (-44 tips in one round) and finer steps give the loop more chances to exit.
$PULSE_SEC   = if ($env:TN12_PULSE_SEC)   { [int]$env:TN12_PULSE_SEC }   else { 20 }

$addr        = "kaspatest:qrys4yax468rrm988kyqjtncvstcelgzktml0m3rvdvvktrll0gdxuyu34fru"
$CPU_THREADS = 1  # Bettor 2026-08-08 10:12Z: was 2, dropped to 1 -- the incident's root imbalance
                  # (produce rate > verify rate) gets worse not better at 2 threads, and the
                  # deployed default had silently drifted back to 2 despite J1 reporting "already
                  # on 1" (NWT caught the mismatch). 1 is the conservative safe value while the
                  # brake's steady-state behavior is still being observed; final production
                  # thread count is still an Owner-layer decision, not settled here.
$bridgeExe   = "D:\rusty-kaspa-tn10-build\release\stratum-bridge.exe"
$bridgeExeNorm = [System.IO.Path]::GetFullPath($bridgeExe)
# NWT 2026-08-08 13:19: raw string -eq on .Path is fragile to path-representation
# differences (relative segments, separator style) even when it's genuinely the
# same file; GetFullPath normalizes that (PowerShell string -eq is already
# case-insensitive, so casing alone was never the risk). Symlinks/junctions and
# 8.3 short-path forms are NOT resolved by this -- accepted residual, see
# Test-SameExePath below and the account-visibility note near Get-AnyBridgeInstance.
function Test-SameExePath($candidatePath) {
  if (-not $candidatePath) { return $false }
  try { return ([System.IO.Path]::GetFullPath($candidatePath)) -eq $bridgeExeNorm } catch { return $false }
}
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

# Returns the whole health object, not just tips. Previously this returned an int, so the
# probe's verdict could not reach the brake at all -- J2 grepped the script and found
# diagnosis/starved/isolated with ZERO hits, i.e. every verdict we refined tonight was
# decoration. The brake read a raw number and nothing else.
function Get-Health {
  try {
    $raw = & node $probe 2>$null
    if (-not $raw) { return $null }
    $j = $raw | ConvertFrom-Json
    if (-not $j.ok) { return $null }
    return $j
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
# Codex 2026-08-08 round 4 MUST-FIX: round 3 still let CONFIRMED_ABSENT be reached
# from missing/empty/unparsable pid-file metadata alone. That's an absence of OUR
# OWN BOOKKEEPING, not a positive proof the process is gone -- the pid file could
# have been deleted or truncated externally, or lost across a watchdog restart,
# while a miner we actually started keeps running under a PID we no longer have on
# record. Every prior branch that concluded CONFIRMED_ABSENT from "no metadata"
# was the same fail-open shape round 3 just fixed for the tracked-PID case, just
# one layer up: "no evidence of X" collapsed into "X is false" instead of "unknown
# whether X". Fix: CONFIRMED_ABSENT now requires an INDEPENDENT positive check --
# scanning all running processes for anything at $bridgeExe -- before it can be
# concluded from missing metadata. This is a different use of path-matching than
# round 1 rejected: round 1's Finding 3 was about treating a name/path match as
# "ours" for the purpose of STOPPING or claiming ownership; here a match only ever
# pushes the verdict toward the cautious UNKNOWN_OR_CONFLICT, never toward trusting
# it as owned. Absence of a match is what earns CONFIRMED_ABSENT.
# Bettor 2026-08-08 13:18 MUST-FIX: the scan Resolve-AbsentOrUnknown leans on needs
# its own verification -- an empty result has two causes (genuinely scanned and
# found nothing / the scan itself failed to run), same shape as every other
# absence-has-two-causes case in this file. -ErrorAction Stop promotes ANY
# enumeration failure (not just individual per-process access errors) to a
# terminating error we catch, so a partial/failed scan is never silently read as
# "confirmed empty."
# 🔴 ACCEPTED BOUNDARY (Bettor 2026-08-08 13:20, documented not silently assumed):
# Get-Process only enumerates processes visible to the account running this
# watchdog. A stratum-bridge instance started under a DIFFERENT account would not
# appear here at all -- this scan would return Ok=$true, Process=$null (a clean
# "found nothing" from its own point of view) even though a real instance exists.
# This watchdog assumes the miner and the watchdog run under the same account (the
# deployment sequence documented at the top of this file already implies this --
# there is no cross-account launch path anywhere in this script). If that
# assumption is ever violated, this is a real gap; it is not fixed here because
# doing so needs either running this scan elevated or switching to a system-wide
# CIM query, both of which change this script's privilege requirements and are an
# Owner/ops decision, not a silent code change bundled into an unrelated fix.
function Get-AnyBridgeInstance {
  try {
    $procs = Get-Process -ErrorAction Stop
  } catch {
    return @{ Ok = $false; Process = $null }
  }
  return @{ Ok = $true; Process = ($procs | Where-Object { Test-SameExePath $_.Path } | Select-Object -First 1) }
}

function Resolve-AbsentOrUnknown([string]$reason) {
  $scan = Get-AnyBridgeInstance
  if (-not $scan.Ok) {
    Log "Get-MinerState: $reason, and the independent host-wide scan itself failed -- cannot confirm either way -- UNKNOWN_OR_CONFLICT"
    return @{ State = 'UNKNOWN_OR_CONFLICT'; Process = $null }
  }
  if ($scan.Process) {
    Log "Get-MinerState: $reason, but a stratum-bridge process IS running at $bridgeExe (PID=$($scan.Process.Id)) -- UNKNOWN_OR_CONFLICT, cannot confirm ownership"
    return @{ State = 'UNKNOWN_OR_CONFLICT'; Process = $scan.Process }
  }
  Log "Get-MinerState: $reason, and independently confirmed no process at $bridgeExe anywhere on the host -- CONFIRMED_ABSENT"
  return @{ State = 'CONFIRMED_ABSENT'; Process = $null }
}

# Bettor 2026-08-08 14:17: the documented residual (an already-owned PID reading
# as UNKNOWN_OR_CONFLICT for one poll cycle on a transient CIM failure) sits on
# the brake's STOP path -- an emergency brake that can be blinded by exactly the
# same failure mode it exists to survive is not an acceptable residual there, even
# a bounded/self-healing one. CIM-free fallback: PID + normalized exe path +
# StartTime together are a strong anti-PID-reuse anchor (PID reuse essentially
# never reproduces the exact same StartTime), available from plain Get-Process
# without depending on CIM/WMI at all. Only used to CONFIRM ownership when the
# CommandLine check can't run -- never used to weaken CONFIRMED_ABSENT, which
# still requires Resolve-AbsentOrUnknown's independent host-wide scan.
function Test-OwnedByStartTime($proc, $rec) {
  if (-not $rec.startTimeTicks) { return $false }
  try { return $proc.StartTime.Ticks -eq [int64]$rec.startTimeTicks } catch { return $false }
}

function Get-MinerState {
  if (-not (Test-Path $minerPidFile)) { return Resolve-AbsentOrUnknown "no pid file" }
  $raw = Get-Content $minerPidFile -Raw -ErrorAction SilentlyContinue
  if (-not $raw) { return Resolve-AbsentOrUnknown "pid file empty/unreadable" }
  $rec = $null
  try { $rec = $raw | ConvertFrom-Json } catch { return Resolve-AbsentOrUnknown "pid file unparsable" }
  if (-not $rec.pid) { return Resolve-AbsentOrUnknown "pid file has no pid field" }

  $proc = Get-Process -Id $rec.pid -ErrorAction SilentlyContinue
  if (-not $proc) { return Resolve-AbsentOrUnknown "recorded PID=$($rec.pid) is not running" }
  if (-not (Test-SameExePath $proc.Path)) { return Resolve-AbsentOrUnknown "recorded PID=$($rec.pid) now belongs to a different, non-bridge process (PID recycled)" }

  if (-not $rec.commandLine) {
    if (Test-OwnedByStartTime $proc $rec) {
      Log "Get-MinerState: PID=$($rec.pid) has no recorded commandLine, but StartTime matches recorded launch -- OWNED_RUNNING (CIM-free confirmation)"
      return @{ State = 'OWNED_RUNNING'; Process = $proc }
    }
    Log "Get-MinerState: PID=$($rec.pid) has no recorded commandLine and StartTime fallback couldn't confirm it either -- UNKNOWN_OR_CONFLICT (a stratum-bridge IS running at this PID/path, cannot confirm it's ours)"
    return @{ State = 'UNKNOWN_OR_CONFLICT'; Process = $proc }
  }
  $currentCmdLine = $null
  try { $currentCmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($rec.pid)" -ErrorAction Stop).CommandLine } catch {}
  if (-not $currentCmdLine) {
    if (Test-OwnedByStartTime $proc $rec) {
      Log "Get-MinerState: PID=$($rec.pid) CommandLine query failed, but StartTime matches recorded launch -- OWNED_RUNNING (CIM-free fallback confirmation, the brake can still stop this)"
      return @{ State = 'OWNED_RUNNING'; Process = $proc }
    }
    Log "Get-MinerState: PID=$($rec.pid) CommandLine query failed (transient CIM hiccup?) and StartTime fallback couldn't confirm it either -- UNKNOWN_OR_CONFLICT, not touching, not starting a second instance"
    return @{ State = 'UNKNOWN_OR_CONFLICT'; Process = $proc }
  }
  if ($currentCmdLine -ne $rec.commandLine) {
    Log "Get-MinerState: PID=$($rec.pid) commandLine mismatch (PID reuse or an unrelated stratum-bridge instance at the same path) -- UNKNOWN_OR_CONFLICT"
    return @{ State = 'UNKNOWN_OR_CONFLICT'; Process = $proc }
  }
  return @{ State = 'OWNED_RUNNING'; Process = $proc }
}

# Shared by every kill path (Start-Miner's abort-kill and Stop-Miner's main
# stop): -ErrorAction Stop + a post-kill Get-Process re-check so a failed
# Stop-Process is never silently treated as success. Not trying to guarantee an
# orphan is eliminated (a kill that fails here is real but, in Start-Miner's
# abort-kill case, doesn't reproduce the death spiral -- invariant (1) is still
# protected because the next Start-Miner attempt's host-wide scan will see the
# orphan and refuse to start a duplicate) -- just refusing to let it pass as a
# clean success anywhere it's used.
function Kill-AndVerify([int]$targetPid) {
  try {
    Stop-Process -Id $targetPid -Force -Confirm:$false -ErrorAction Stop
    Start-Sleep -Milliseconds 200
    return -not (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)
  } catch { return $false }
}

# Codex 2026-08-08 round 8 MUST-FIX: used only on the COMPOUND failure path (the
# durable/verified write already failed, AND the abort-kill also failed, so a
# process we launched is surviving with no recoverable record). A single plain
# write, no temp+rename+read-back -- if that stronger mechanism just failed,
# retrying it identically is unlikely to differ, and what a surviving orphan needs
# most is SOME record for the next cycle to target, not a perfectly verified one.
# Shared by both Start-Miner failure branches so the recovery behavior can't drift
# between them (the same class of bug -- "fix in one place, sibling location not
# updated" -- has recurred multiple times today; one implementation closes it here).
function Write-BestEffortOwnershipRecord([int]$targetPid, $commandLine, $startTimeTicks) {
  try {
    (@{ pid = $targetPid; commandLine = $commandLine; startTimeTicks = $startTimeTicks } | ConvertTo-Json -Compress) |
      Out-File $minerPidFile -Encoding utf8 -ErrorAction Stop
    return $true
  } catch { return $false }
}

# Codex 2026-08-08 round 5 MUST-FIX (invariant (2): must always be able to stop
# what this breaker started): the old behaviour on a failed commandLine readback
# was to warn, record commandLine=null, and leave the just-launched process
# running. That process is real and ours, but Get-MinerState can never re-confirm
# it (no commandLine on record -> UNKNOWN_OR_CONFLICT), and Stop-Miner deliberately
# never touches UNKNOWN_OR_CONFLICT (correct for processes we DIDN'T start -- wrong
# here, since we know for a fact we just started this one). The brake could then
# never stop a miner it launched itself. Ownership establishment is now part of
# what "starting successfully" means: retry the readback briefly, and if it never
# succeeds, kill the process we just started rather than leave an unconfirmable
# miner running. A launch that can't prove itself is treated as a launch that
# failed, not a launch that succeeded with degraded tracking.
function Start-Miner {
  $env:BRIDGE_SKIP_SYNC_GATE = '1'
  $p = Start-Process -FilePath $bridgeExe -ArgumentList $bridgeArgs -WorkingDirectory (Split-Path $bridgeExe) `
    -RedirectStandardOutput "D:\kaspa-tn12-mining\_bridge_tn12.log" `
    -RedirectStandardError  "D:\kaspa-tn12-mining\_bridge_tn12_err.log" -WindowStyle Hidden -PassThru
  # Record the exact command line the OS sees for this PID right now, not $bridgeArgs
  # verbatim -- Win32_Process's CommandLine is what Get-MinerState will compare
  # against later, so the recorded value must come from the same source it will be
  # checked against (quoting/exe-path formatting can differ between the two).
  # Bettor 2026-08-08 14:17, moved earlier per round-8 fix below: capture
  # StartTime (as .Ticks -- a plain int64, avoids any JSON date-format round-trip
  # ambiguity) right after launch, not gated behind a successful commandLine
  # readback. StartTime doesn't depend on CIM at all, so it's available even when
  # the CIM-based commandLine check below is struggling -- and round 8 needs it
  # available for BOTH failure branches' best-effort recovery record, not just
  # the happy path.
  $startTimeTicks = $null
  try { $startTimeTicks = (Get-Process -Id $p.Id -ErrorAction Stop).StartTime.Ticks } catch {}

  $cmdLine = $null
  $maxAttempts = 5
  for ($i = 1; $i -le $maxAttempts -and -not $cmdLine; $i++) {
    Start-Sleep -Milliseconds 200
    try { $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)" -ErrorAction Stop).CommandLine } catch {}
  }
  if (-not $cmdLine) {
    Log "Start-Miner: FAILED to establish ownership for PID=$($p.Id) after $maxAttempts attempts -- killing it rather than leaving a miner this breaker could never stop again"
    $killVerified = Kill-AndVerify $p.Id
    if ($killVerified) {
      Remove-Item $minerPidFile -ErrorAction SilentlyContinue
      Alert "Start-Miner ABORTED: launched PID=$($p.Id) but could not confirm its commandLine after $maxAttempts attempts -- killed it (verified gone). No miner is running from this attempt. Will retry next loop iteration if still CONFIRMED_ABSENT."
    } else {
      $recovered = Write-BestEffortOwnershipRecord $p.Id $null $startTimeTicks
      if ($recovered) {
        Alert "Start-Miner COMPOUND FAILURE: launched PID=$($p.Id), could not confirm its commandLine, AND the abort-kill could not be confirmed -- process likely still running. commandLine unavailable, but wrote a best-effort record with StartTime so the next cycle's Get-MinerState can still recognize and target this PID via the CIM-free fallback. Needs operator look."
      } else {
        Alert "Start-Miner COMPOUND FAILURE: launched PID=$($p.Id), could not confirm its commandLine, abort-kill could not be confirmed, AND the best-effort recovery write also failed -- possible orphan process at PID=$($p.Id) with NO ownership record, needs operator look. The next start attempt's host-wide scan should still catch it and refuse to start a duplicate."
      }
    }
    return
  }

  # Bettor 2026-08-08 16:11 MUST-FIX (W2 -- the PERSISTENCE action itself needed
  # efficacy verification too, same class as launch/kill: a failed or truncated
  # write here would leave a miner genuinely running with no durable ownership
  # record, and every future Get-MinerState read would see a missing/corrupt pid
  # file and never re-confirm OWNED_RUNNING -- the brake could never stop it, and
  # this specific failure mode isn't self-healing (the write doesn't get retried
  # once Start-Miner has returned). Write to a temp file in the same directory
  # (same volume -> Move-Item is a rename, effectively atomic, not a copy+delete
  # that could leave a half-written destination), then read back and verify it
  # parses to the exact pid/commandLine just written -- a write that can't be
  # verified is treated as a failed launch, not a successful one with an
  # unreadable record.
  $tmpFile = "$minerPidFile.tmp"
  $writeVerified = $false
  try {
    (@{ pid = $p.Id; commandLine = $cmdLine; startTimeTicks = $startTimeTicks } | ConvertTo-Json -Compress) |
      Out-File $tmpFile -Encoding utf8 -ErrorAction Stop
    Move-Item -Path $tmpFile -Destination $minerPidFile -Force -ErrorAction Stop
    $readBack = Get-Content $minerPidFile -Raw -ErrorAction Stop | ConvertFrom-Json
    $writeVerified = ($readBack.pid -eq $p.Id) -and ($readBack.commandLine -eq $cmdLine)
  } catch {}
  Remove-Item $tmpFile -ErrorAction SilentlyContinue

  if (-not $writeVerified) {
    Log "Start-Miner: FAILED to durably persist ownership record for PID=$($p.Id) (write/rename/read-back verification failed) -- killing it rather than leaving a miner with no recoverable ownership record"
    $killVerified = Kill-AndVerify $p.Id
    if ($killVerified) {
      Remove-Item $minerPidFile -ErrorAction SilentlyContinue
      Alert "Start-Miner ABORTED: launched PID=$($p.Id), ownership confirmed in-memory, but the pid-file write could not be verified -- killed it (verified gone). No miner is running from this attempt."
    } else {
      # Codex 2026-08-08 round 8 MUST-FIX: this compound-failure branch used to
      # unconditionally Remove-Item the pid file here, discarding the in-memory
      # provenance (pid/cmdLine/startTimeTicks) we still hold in this scope even
      # though the durable write we JUST attempted failed -- the surviving,
      # unkillable process became a permanent orphan the breaker could never again
      # recognize, even though the values needed to recognize it were sitting
      # right here. Host-wide scanning still protects invariant (1) (won't start a
      # duplicate), but that alone doesn't restore invariant (2) (being able to
      # stop this specific one). Fix: attempt one more plain best-effort write
      # (not the full temp+rename+read-back dance again -- if that mechanism is
      # broken, retrying the same way is unlikely to differ, and a survivor here
      # needs SOME record more than it needs a perfectly verified one) before
      # giving up. If it also fails, we're no worse off than discarding outright.
      $recovered = Write-BestEffortOwnershipRecord $p.Id $cmdLine $startTimeTicks
      if ($recovered) {
        Alert "Start-Miner COMPOUND FAILURE: launched PID=$($p.Id), pid-file write verification failed AND the abort-kill could not be confirmed -- process likely still running. Wrote a best-effort (unverified) ownership record so the next cycle's Get-MinerState has a chance to recognize and target it for stop/reconcile. Needs operator look."
      } else {
        Remove-Item $minerPidFile -ErrorAction SilentlyContinue
        Alert "Start-Miner COMPOUND FAILURE: launched PID=$($p.Id), pid-file write verification failed, abort-kill could not be confirmed, AND the best-effort recovery write also failed -- possible orphan process at PID=$($p.Id) with NO ownership record, needs operator look. The next start attempt's host-wide scan should still catch it and refuse to start a duplicate."
      }
    }
    return
  }
  Log "Start-Miner: launched PID=$($p.Id), ownership confirmed and durably persisted (startTime-recorded=$([bool]$startTimeTicks))"
}

# Codex 2026-08-08 round 6 MUST-FIX (CORE-BREAK, on the actual brake -- Bettor
# 15:22, self-certification round 6 had checked state REACHABILITY (only acts on
# OWNED_RUNNING) but not ACTION EFFICACY (did the stop actually work). A silent
# Stop-Process failure here used to report a false "stopped" AND delete the
# ownership record -- the brake would believe the death spiral was contained while
# the miner it thought it killed kept running, now untracked and permanently
# unstoppable by this automation. This is the same verify-the-kill pattern round
# 5's abort-kill path already got (dbd5f4b1) -- it had not been mirrored here, the
# actual primary stop path, which is the one that matters most.
function Stop-Miner {
  $s = Get-MinerState
  if ($s.State -eq 'OWNED_RUNNING') {
    $stopVerified = Kill-AndVerify $s.Process.Id
    if ($stopVerified) {
      Log "Stop-Miner: stopped owned PID=$($s.Process.Id) (verified gone)"
      Remove-Item $minerPidFile -ErrorAction SilentlyContinue
    } else {
      # Do NOT delete the pid file and do NOT report success -- leave the state
      # as OWNED_RUNNING (the record is still accurate, the process is still
      # alive) so the next loop iteration re-attempts the stop instead of
      # silently believing the brake engaged.
      Alert "Stop-Miner FAILED to stop owned PID=$($s.Process.Id) -- kill attempt did not confirm the process is gone. Miner may still be running. NOT marking as stopped, NOT clearing ownership record -- will retry next cycle. Needs operator look if this repeats."
    }
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
Log "watchdog v2 started (brake>$TIPS_BRAKE resume<$TIPS_RESUME poll=${POLL_SEC}s threads=$CPU_THREADS maxRounds=$MAX_ROUNDS cliff=$MERGESET_CLIFF)"
# The guard lives next to the constant rather than in a test file, deliberately: a test asserting
# "TIPS_BRAKE < 248" can be satisfied by a repo the deployed machine is not running, and this
# script's whole history is one of live/repo drift. Here it is checked on the machine that brakes,
# at the moment it starts, using the value that machine actually has -- including one handed in by
# env, which no repo-side test can see at all.
# It ALERTS and keeps running rather than refusing to start: a watchdog that exits leaves the miner
# entirely unsupervised, which is strictly worse than a badly-placed backstop. It also does not
# silently clamp the value -- that would hide an operator's intent instead of contradicting it.
# Exercise it (this must print a loud alert, and the run must continue):
#   TN12_TIPS_BRAKE=999 TN12_MAX_ROUNDS=1 powershell -File tn12-mining-watchdog-v2.ps1
if ($TIPS_BRAKE -ge $MERGESET_CLIFF) {
  Alert "MISCONFIGURED BACKSTOP: TIPS_BRAKE=$TIPS_BRAKE is at or above the mergeset cliff ($MERGESET_CLIFF). A level brake past the cliff can only fire after the DAG is already unrecoverable, so this backstop is currently decoration. The derivative verdict (diagnosis=overproduction) is unaffected and still brakes. Set TN12_TIPS_BRAKE below $MERGESET_CLIFF."
}

while ($true) {
  $round++
  if ($MAX_ROUNDS -gt 0 -and $round -gt $MAX_ROUNDS) {
    # Bounded run (brake-exercise mode). Never leave the miner braked on exit.
    if ($braked) { Log "maxRounds reached while braked -> restarting miner before exit"; Start-Miner-Unless-Paused }
    Log "watchdog v2 exiting after $MAX_ROUNDS rounds (exercise mode)"
    break
  }
  $health = Get-Health
  $tips = if ($health) { [int]$health.tips } else { $null }

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

  # ROOT FIX (2026-08-09): brake on the VERDICT as well as the raw number.
  #
  # Until now braking required tips > 500, so nothing whatsoever constrained the climb below
  # that. Tonight it climbed twice at a steady ~13/min with zero deceleration (Bettor's
  # four-read, J2's 18 minutes of per-minute samples, my rising streak of 21) and each time we
  # simply waited for the wedge. NWT's phrasing: pulse fixed "stuck above 500 with no way out"
  # and left "no deceleration at all below 500" untouched.
  #
  # Every other knob is already at its limit: hashrate has been at the floor of 1 thread since
  # 2026-08-08 and still overproduces, J2 withdrew the lower-threshold proposal because braking
  # costs block production, and the pulse drains without preventing. Consuming the verdict is
  # what remains on our side of the consensus parameter.
  #
  # `overproduction` is the derivative verdict: tips rising for RISE_STREAK consecutive samples,
  # debounced, and independent of any cliff constant. Measured tonight it fires at tips=153 with
  # lag=490 -- roughly 350 tips before the threshold would have. Braking there does NOT stop
  # block production, because braked now means the pulse duty cycle, so the chain keeps
  # advancing while the DAG narrows. That distinction is the whole reason this is safe to wire.
  $verdict = if ($health) { [string]$health.diagnosis } else { '' }
  $overproducing = ($verdict -eq 'overproduction')
  # "the climb has stopped" -- computed here, before the if/elseif chain, because an assignment
  # placed between if and elseif silently breaks the chain (PowerShell parses it, so a syntax
  # check passes while the logic is severed). Caught by reading the file rather than trusting
  # the parser's OK.
  $climbBroken = ($null -ne $health -and $null -ne $health.risingStreak -and [int]$health.risingStreak -eq 0)
  if (-not $braked -and ($tips -gt $TIPS_BRAKE -or $overproducing)) {
    $braked = $true
    Stop-Miner
    $why = if ($tips -gt $TIPS_BRAKE) { "tips=$tips > $TIPS_BRAKE" } else { "diagnosis=overproduction (tips=$tips, streak=$($health.risingStreak), lag=$($health.lagSeconds)) -- braking on the trend, not the cliff" }
    Alert "BRAKE ENGAGED: $why. Entering pulse duty cycle; will resume under $TIPS_RESUME."
  }
  # DIMENSION FIX (2026-08-09): release needs the trend too, not just the level.
  # Engaging looks at the trend and ignores absolute tips; releasing looked ONLY at absolute
  # tips. So a brake that engaged at tips=30 already satisfied its own release condition
  # (30 < 50) and popped back open 38 seconds later, having stopped the miner for nothing.
  # Requiring the rising run to be broken as well puts both directions on the same quantity.
  # It adds no new constant: risingStreak == 0 simply means "the climb stopped".
  # The level test is KEPT rather than replaced -- a flat-but-high DAG (tonight's 536 wedge sat
  # perfectly still) must not read as recovered just because it stopped rising.
  elseif ($braked -and $tips -lt $TIPS_RESUME -and $climbBroken) {
    $braked = $false
    Alert "BRAKE RELEASED: tips=$tips < $TIPS_RESUME and climb broken (streak=0). Resuming mining."
    Start-Miner-Unless-Paused
  }
  elseif ($braked) {
    # DEADLOCK FIX (J1tn 2026-08-09, after this branch stopped the chain for 4.5h).
    # Holding the miner off until tips fall never terminates: the DAG only digests tips when
    # NEW BLOCKS arrive to advance virtual, so "stop mining and wait" removes the very thing
    # that would drain them. Live: braked at tips=525, then 4.5 hours pinned at 536.
    # Measured way out: pulses of 60-75s moved tips 498 -> 77 (-32..-44 per round). While
    # virtual can advance, mining DRAINS tips -- each block merges a whole mergeset and adds
    # only itself. It only piles them up when virtual is stuck. So the brake is a duty cycle.
    # Both invariants hold: starting still goes through Start-Miner-Unless-Paused (three-valued
    # guard + operator pause file), stopping still goes through Stop-Miner (owned-only +
    # Kill-AndVerify). No new start path is introduced.
    Start-Miner-Unless-Paused
    Start-Sleep -Seconds $PULSE_SEC
    Stop-Miner
    Log "braked: pulsed ${PULSE_SEC}s to drain (tips=$tips, need <$TIPS_RESUME)"
  }
  else {
    Start-Miner-Unless-Paused  # self-guards: no-op if OWNED_RUNNING, alerts (no start) if UNKNOWN_OR_CONFLICT, starts only if CONFIRMED_ABSENT
  }

  Start-Sleep -Seconds $POLL_SEC
}
