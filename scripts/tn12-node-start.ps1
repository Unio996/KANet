# TN12 kaspad launcher -- single source of truth for how a node is started.
# Author: J1tn, 2026-08-08/09, after the 15h TN12 stall and the 4h local starvation that followed it.
#
# ---------------------------------------------------------------------------
# WHY THIS FILE EXISTS
# ---------------------------------------------------------------------------
# Every load-bearing launch flag used to live only in someone's shell history:
#   - the miner host's --enable-unsynced-mining  (deliberate, see -Role miner below)
#   - the receiver's  --addpeer over Tailscale   (added 2026-08-09, see below)
# Both are invisible to `git`, so a reboot or a rebuild silently produces a DIFFERENT node
# than the one that was reasoned about. That happened twice in one day. This script is the
# committed answer: launch from here, not from memory.
#
# ---------------------------------------------------------------------------
# WHY -AddPeer IS LOAD-BEARING, NOT A TUNING KNOB
# ---------------------------------------------------------------------------
# TN12 reachable public peers = 2 (86.48.24.208, 152.53.236.224). On 2026-08-08 both went
# silent for 4+ hours: the receiving node stayed connected, processed ZERO blocks, and fell
# 172,337 blocks behind with nothing in the log but connection-manager heartbeats.
#
# The mining host was UNAFFECTED and reported perfect health the whole time -- because it
# produces its own blocks and never needed a peer to feed it. That asymmetry is the trap:
# *the healthy node cannot detect this failure on your behalf.*
#
# Fix: dial a teammate's node directly over Tailscale, which also bypasses the CGNAT that
# makes their P2P port unreachable over the public internet. Measured effect on the stalled
# node: 0 -> 140+ headers/s, immediately.
#
# P2P is bidirectional once established, so a pure receiver dialing the miner is enough;
# the miner does NOT need a symmetric --addpeer back (and should not be restarted for it).
#
# ---------------------------------------------------------------------------
# ROLES
# ---------------------------------------------------------------------------
#   receiver : pure observer / second source. NO unsynced-mining (nothing to mine with).
#   miner    : block producer. Needs --enable-unsynced-mining, and that flag is REQUIRED --
#              removing it deadlocks TN12 (no blocks -> stale sink -> never synced ->
#              submitBlock rejected -> no blocks). Its brake is tn12-mining-watchdog-v2.ps1,
#              NOT the removal of this flag. See docs/2026-08-08-tn12-virtual-stall-*.md
param(
  [ValidateSet('receiver','miner')] [string] $Role     = 'receiver',
  [string] $AppDir     = 'D:/kaspa-tn12-data',
  [string] $Exe        = 'D:\rusty-kaspa\target\release\kaspad.exe',
  [string] $RpcListen  = '0.0.0.0:17210',
  # Teammate nodes to dial directly. Tailscale IPs: immune to CGNAT, and independent of
  # whether the two public TN12 peers are alive. Empty = rely on public peers only (the
  # configuration that starved on 2026-08-08).
  [string[]] $AddPeer  = @('100.99.147.101:16311'),
  # RocksDB cache multiplier. Measured on the J1 receiver 2026-08-09 while it was falling
  # behind at 4.4 blk/s against an 8.0 blk/s network:
  #   kaspad CPU 7.1% of 14 cores, but ONE thread pegged at 99.7%
  #   disk queue 0.11 (idle), pages output/sec 0 (no swap pressure)
  #   cache faults/sec 18,209   <-- the pegged thread is stalling on mmap reads
  # So the limit is a SERIAL section starved of cache, not cores, not disk, not RAM pressure.
  # More cores cannot help a single-threaded stage; a bigger block cache can, by making that
  # stage's reads hit memory. Upstream guidance is ~3.0-4.0 for ~64GB hosts; this box has
  # 15.4GB with ~1.8GB free, so start conservative and raise only with a measurement.
  [double] $RamScale   = 1.5,
  [switch] $WhatIf
)

$ErrorActionPreference = 'Stop'

# AppDir MUST use forward slashes. Git Bash swallows backslashes, yielding a drive-relative
# path (D:kaspa-tn12-data) that silently resolves to a NESTED directory -- the node then
# re-downloads the chain from zero while looking completely healthy. (ANTI-PATTERNS rule 57.)
if ($AppDir -match '\\') { throw "AppDir must use forward slashes, got: $AppDir" }

$argList = @(
  '--testnet'
  '--netsuffix=12'
  "--appdir=$AppDir"
  '--utxoindex'
  "--rpclisten-borsh=$RpcListen"
)
foreach ($p in $AddPeer) { if ($p) { $argList += "--addpeer=$p" } }
if ($RamScale -gt 0 -and $RamScale -ne 1.0) { $argList += "--ram-scale=$RamScale" }
if ($Role -eq 'miner') { $argList += '--enable-unsynced-mining' }

$cmdline = "$Exe " + ($argList -join ' ')
Write-Host "[tn12-node-start] role=$Role"
Write-Host "[tn12-node-start] $cmdline"
if ($WhatIf) { Write-Host '[tn12-node-start] -WhatIf: not launching.'; exit 0 }

$running = Get-Process -Name 'kaspad' -ErrorAction SilentlyContinue
if ($running) {
  Write-Host "[tn12-node-start] kaspad already running (PID $($running.Id -join ',')). Stop it first; refusing to start a second."
  exit 1
}

Start-Process -FilePath $Exe -ArgumentList $argList -WindowStyle Hidden `
  -RedirectStandardOutput "$($AppDir -replace '/','\')\kaspad_detached_stdout.log" `
  -RedirectStandardError  "$($AppDir -replace '/','\')\kaspad_detached_stderr.log"

Start-Sleep -Seconds 6
$p = Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'"
if (-not $p) { throw '[tn12-node-start] kaspad did not come up -- check the stderr log.' }
Write-Host "[tn12-node-start] up: PID $($p.ProcessId)"
Write-Host "[tn12-node-start] VERIFY the args actually reached the process (do not assume):"
Write-Host "  $($p.CommandLine)"
Write-Host "[tn12-node-start] then confirm the dialed peer connected:"
Write-Host "  Select-String -Path $AppDir/kaspa-testnet-12/logs/rusty-kaspa.log -Pattern 'Connected to outgoing peer'"
