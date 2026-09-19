# simnet-env.ps1 -- isolated SIMNET node + console for batch 9-4 (end-to-end settlement rehearsal). KANet-UI 2026-09-20. ASCII-only (PowerShell 5.1).
#   powershell -File scripts\simnet-env.ps1 up      -Tree <worktree with the code under test and its own node_modules>   [-DryRun]
#   powershell -File scripts\simnet-env.ps1 down    [-WithNode]      | restart | status | node-up | node-down
# What it guarantees (each is checked, not assumed):
#   * a BRAND-NEW run directory per `up` (new DB, new env file, one-time CONSOLE_ENCRYPTION_KEY / INGEST_SECRET); it never reads or points at
#     kanet*.env, console.mainnet.db, the mainnet console tree, port 3202 or the mainnet kaspad (17110);
#   * KASPA_NETWORK=simnet, KASPA_RPC_URL -> the simnet node only; after start it proves networkId=simnet on the node and that the console's own
#     stdout says `[db] path=<run dir>` (i.e. it is on the fresh DB) -- any mismatch => it stops the console it just started and exits 3;
#   * driver switches ON in this env only (PROTO_DRIVER_ENABLED / PROTO_SETTLEMENT_DRIVER_ENABLED); PROTO_RELAY_ID is added AFTER the proto- relay exists
#     (edit the env file, then `restart`: it keeps the DB);
#   * stop = by recorded PID after the command line is verified; the console's relay children are stopped by parent PID; never by name.
# RUN IT WITH ITS OUTPUT REDIRECTED TO A FILE (`... *> out.txt`), never through a pipe (`| cut`): the node and the console it starts inherit the pipe and the reader
#   then waits for EOF until they exit (found on the first real run).
# Memory gate: node-up refuses at commit memory >= 80% (report first, then -SkipMemoryGate only if Bettor says so).
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('up', 'down', 'restart', 'status', 'node-up', 'node-down')][string]$Action,
  [string]$Tree = '',
  [int]$ConsolePort = 3299,
  [string]$Root = 'D:\kanet-tn12\scratch\_simnet_console',
  [switch]$WithNode, [switch]$DryRun, [switch]$SkipMemoryGate,
  [switch]$WithProtoRelay,          # after the console is up: create the throw-away simnet proto- relay, set PROTO_RELAY_ID, restart, wait for the settlement-driver start line
  [string]$ExpectHead = ''          # refuse unless `git -C <Tree> rev-parse HEAD` starts with this
)
$ErrorActionPreference = 'Stop'
$ProdRoot = 'D:\kanet-tn12'; $KaspadExe = 'D:\rusty-kaspa-v201\kaspad.exe'
$KaspadSha = '8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38'
$NodeDir = Join-Path $Root 'node-data'; $NodePid = Join-Path $Root 'node.pid'; $Current = Join-Path $Root 'current-run.txt'
$P2P = 16510; $GRPC = 16610; $BORSH = 18510; $JSONP = 18511
function Die([int]$c, [string]$m) { Write-Host "simnet-env: $m"; exit $c }
# ---- guards: this script may only ever write under $Root, and $Root must be a simnet scratch dir under the prod checkout's scratch\
$rootFull = [IO.Path]::GetFullPath($Root)
if (-not ($rootFull.StartsWith('D:\kanet-tn12\scratch\') -and (Split-Path -Leaf $rootFull) -like '_simnet_console*')) { Die 2 "Root must be D:\kanet-tn12\scratch\_simnet_console*: $rootFull" }
if ($ConsolePort -eq 3202 -or $ConsolePort -eq 3100) { Die 2 "ConsolePort $ConsolePort is a mainnet/TN12 console port" }
function Get-Listener([int]$port) { @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) }
function Get-Cmd([int]$procId) { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue; if ($p) { $p.CommandLine } else { $null } }
function Commit-Pct { $o = Get-CimInstance Win32_OperatingSystem; [math]::Round(100.0 * ($o.TotalVirtualMemorySize - $o.FreeVirtualMemory) / $o.TotalVirtualMemorySize, 1) }
function Stop-Checked([int]$procId, [string]$mustContain) {
  $c = Get-Cmd $procId; if (-not $c) { Write-Host "pid $procId already gone"; return }
  if ($c -notlike "*$mustContain*") { Die 4 "refusing to stop pid ${procId}: command line does not contain '$mustContain' ($c)" }
  Stop-Process -Id $procId -Force; Write-Host "stopped pid $procId"
}
function Node-Up {
  if ((Commit-Pct) -ge 80 -and -not $SkipMemoryGate) { Die 5 "memory gate: commit $(Commit-Pct)% >= 80% -- report to Bettor first" }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $KaspadExe).Hash.ToLower() -ne $KaspadSha) { Die 2 'kaspad.exe sha256 differs from the pinned 2.0.1 build' }
  $other = @(Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'" | Where-Object { $_.CommandLine -like '*--simnet*' })
  if ($other.Count) { Die 2 "a simnet kaspad is already running (pid $($other[0].ProcessId)); not starting a second" }
  foreach ($p in $P2P, $GRPC, $BORSH, $JSONP) { if ((Get-Listener $p).Count) { Die 2 "simnet port $p is already in use" } }
  New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null
  $a = @('--simnet', "--appdir=$NodeDir", '--utxoindex', '--enable-unsynced-mining', '--disable-upnp', "--listen=127.0.0.1:$P2P", "--rpclisten=127.0.0.1:$GRPC", "--rpclisten-borsh=127.0.0.1:$BORSH", "--rpclisten-json=127.0.0.1:$JSONP")
  $pr = Start-Process -FilePath $KaspadExe -ArgumentList $a -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Root 'node-stdout.log') -RedirectStandardError (Join-Path $Root 'node-stderr.log')
  $pr.Id | Out-File $NodePid -Encoding ascii
  for ($i = 0; $i -lt 60 -and -not (Get-Listener $BORSH).Count; $i++) { Start-Sleep -Seconds 1 }
  if (-not (Get-Listener $BORSH).Count) { Die 3 "simnet node did not listen on $BORSH within 60 s (pid $($pr.Id) left running for inspection: node-down)" }
  Write-Host "node up: pid $($pr.Id) borsh ws://127.0.0.1:$BORSH"
}
function Node-Down { if (Test-Path $NodePid) { Stop-Checked ([int](Get-Content $NodePid)) "--appdir=$NodeDir"; Remove-Item $NodePid -Force } else { Write-Host 'no node.pid' } }
function Check-Network([string]$treeKc) {   # proves networkId=simnet ON THE NODE, using the tree's own kaspa-wasm
  $js = "import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url'; const r = createRequire(process.argv[1]); const w = await import(pathToFileURL(r.resolve('kaspa-wasm')).href); const c = new w.RpcClient({ url: 'ws://127.0.0.1:$BORSH', networkId: 'simnet' }); await c.connect({}); const i = await c.getServerInfo(); console.log('NETWORK=' + i.networkId + ' synced=' + i.isSynced); await c.disconnect(); process.exit(i.networkId === 'simnet' ? 0 : 7);"
  $ErrorActionPreference = 'Continue'
  $out = & node.exe --input-type=module -e $js (Join-Path $treeKc 'package.json') 2>&1 | Out-String
  Write-Host ($out.Trim()); return ($LASTEXITCODE -eq 0)
}
function Console-Start([string]$run, [string]$treeFull) {
  # scrub anything inherited from the launching shell that could point the console at real money paths; the env file below sets what is wanted
  foreach ($n in 'PROTO_RELAY_ID', 'BROKER_ENABLED', 'BROKER_RELAY_ID', 'UTXO_AUTOSPLIT_ON_START', 'BROADCASTER_UTXO_MAINTAIN', 'TELEGRAM_BOT_TOKEN', 'KANET_CONSOLE_ENTRY', 'ADMIN_SECRET_FUNDS', 'ADMIN_SECRET_SYSTEM_ACTIONS', 'FAUCET_RELAY_ID', 'POOL_SEEDER_MAKER_RELAY', 'MINING_RELAY_ID') { [Environment]::SetEnvironmentVariable($n, $null, 'Process') }
  Get-Content (Join-Path $run 'kanet.simnet.env') | ForEach-Object { if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }; if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2], 'Process') } }
  foreach ($f in 'console-stdout.log', 'console-stderr.log') { $lp = Join-Path $run $f; if (Test-Path $lp) { Move-Item -LiteralPath $lp -Destination ($lp -replace '\.log$', ('.prev-' + (Get-Date -Format 'HHmmss') + '.log')) } }
  $pr = Start-Process -FilePath node.exe -ArgumentList @((Join-Path $treeFull 'kasia-console\src\index.js')) -WorkingDirectory $treeFull -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $run 'console-stdout.log') -RedirectStandardError (Join-Path $run 'console-stderr.log')
  $pr.Id | Out-File (Join-Path $run 'console.pid') -Encoding ascii
  for ($i = 0; $i -lt 90 -and -not (Get-Listener $ConsolePort).Count; $i++) { Start-Sleep -Seconds 1 }
  return $pr.Id
}
function Console-Down([string]$run) {
  $pf = Join-Path $run 'console.pid'; if (-not (Test-Path $pf)) { Write-Host 'no console.pid'; return }
  $id = [int](Get-Content $pf); $meta = Get-Content (Join-Path $run 'tree.txt')
  foreach ($k in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$id" -ErrorAction SilentlyContinue)) { if ($k.CommandLine -like '*relay.mjs*') { Stop-Process -Id $k.ProcessId -Force; Write-Host "stopped relay child $($k.ProcessId)" } }
  Stop-Checked $id (Join-Path $meta 'kasia-console\src\index.js'); Remove-Item $pf -Force
}
function Run-Dir { if (-not (Test-Path $Current)) { Die 2 'no current run (up first)' }; (Get-Content $Current) }
if ($Action -eq 'node-up') { Node-Up; exit 0 }
if ($Action -eq 'node-down') { Node-Down; exit 0 }
if ($Action -eq 'status') {
  $n = if (Test-Path $NodePid) { [int](Get-Content $NodePid) } else { 0 }
  Write-Host ("node: pid={0} alive={1} borsh-listening={2}" -f $n, [bool]($n -gt 0 -and (Get-Process -Id $n -ErrorAction SilentlyContinue)), [bool](Get-Listener $BORSH).Count)
  if (Test-Path $Current) { $r = Run-Dir; $c = if (Test-Path "$r\console.pid") { [int](Get-Content "$r\console.pid") } else { 0 }; Write-Host ("console: run={0} pid={1} alive={2} port {3} listening={4}" -f $r, $c, [bool]($c -gt 0 -and (Get-Process -Id $c -ErrorAction SilentlyContinue)), $ConsolePort, [bool](Get-Listener $ConsolePort).Count) }
  Write-Host ("mainnet untouched? kaspad 17110 listener pids: {0}; console 3202 listener pids: {1}" -f ((Get-Listener 17110) -join ','), ((Get-Listener 3202) -join ',')); exit 0
}
if ($Action -eq 'down') { Console-Down (Run-Dir); if ($WithNode) { Node-Down }; exit 0 }
if ($Action -eq 'restart') { $r = Run-Dir; $t = (Get-Content "$r\tree.txt"); Console-Down $r; $id = Console-Start $r $t; Write-Host "console restarted pid $id (same run dir, same DB)"; exit 0 }
# ---------------------------------------------------------------- up
if (-not $Tree) { Die 2 '-Tree is required: a worktree that holds the code under test AND its own node_modules (never the mainnet checkout)' }
$treeFull = [IO.Path]::GetFullPath($Tree).TrimEnd('\')
if ($treeFull -eq $ProdRoot -or $treeFull -like "$ProdRoot\kasia-console*") { Die 2 'Tree must not be the mainnet checkout' }
if (-not (Test-Path (Join-Path $treeFull 'kasia-console\src\index.js'))) { Die 2 "Tree has no kasia-console\src\index.js: $treeFull" }
if (-not (Test-Path (Join-Path $treeFull 'kasia-console\node_modules'))) { Die 2 "Tree has no kasia-console\node_modules (no junction, no copy: use a tree that already has its own): $treeFull" }
if ($ExpectHead) { $h = (& git -C $treeFull rev-parse HEAD).Trim(); if (-not $h.StartsWith($ExpectHead)) { Die 2 "Tree HEAD $h does not start with expected $ExpectHead" }; if ((& git -C $treeFull status --porcelain | Measure-Object).Count -gt 0) { Die 2 'Tree has uncommitted changes (the code under test must be exactly the expected commit)' } }
if ((Get-Listener $ConsolePort).Count) { Die 2 "console port $ConsolePort is already in use" }
$run = Join-Path $rootFull ('run-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$hex = { $b = New-Object byte[] 32; $g = [Security.Cryptography.RandomNumberGenerator]::Create(); $g.GetBytes($b); $g.Dispose(); -join ($b | ForEach-Object { '{0:x2}' -f $_ }) }
$envLines = @(
  '# generated by scripts/simnet-env.ps1: one-time test values; NOT the mainnet env, NOT a copy of it',
  'KASPA_NETWORK=simnet', "KASPA_RPC_URL=ws://127.0.0.1:$BORSH", 'KASPA_RPC_LOCAL_ONLY=1',
  "KANET_ROOT=$($treeFull -replace '\\', '/')", "DB_PATH=$((Join-Path $run 'console.simnet.db') -replace '\\', '/')", "PORT=$ConsolePort",
  "CONSOLE_ENCRYPTION_KEY=$(& $hex)", "INGEST_SECRET=$(& $hex)",
  'PROTO_DRIVER_ENABLED=1', 'PROTO_SETTLEMENT_DRIVER_ENABLED=1',
  '# PROTO_RELAY_ID=<id of the proto- relay created in this DB; add it, then: simnet-env.ps1 restart>')
if ($DryRun) { Write-Host "DRY RUN: would create $run and start a console from $treeFull on port $ConsolePort against ws://127.0.0.1:$BORSH"; $envLines | ForEach-Object { if ($_ -notmatch 'KEY=|SECRET=') { Write-Host "  $_" } else { Write-Host "  $($_.Split('=')[0])=<random, not printed>" } }; exit 0 }
if (-not (Get-Listener $BORSH).Count) { Node-Up }
New-Item -ItemType Directory -Force -Path $run | Out-Null
Set-Content -LiteralPath (Join-Path $run 'kanet.simnet.env') -Value $envLines -Encoding ASCII; $treeFull | Out-File (Join-Path $run 'tree.txt') -Encoding ascii; $run | Out-File $Current -Encoding ascii
$id = Console-Start $run $treeFull
$ok = (Get-Listener $ConsolePort).Count -gt 0
$net = Check-Network (Join-Path $treeFull 'kasia-console')
$dbLine = if (Test-Path "$run\console-stdout.log") { (Select-String -LiteralPath "$run\console-stdout.log" -Pattern '^\[db\] path=' -List | Select-Object -First 1).Line } else { '' }
$dbOk = $dbLine -like "*$(($run -replace '\\','\'))\console.simnet.db*"
Write-Host "console pid=$id listening=$ok network-simnet=$net db-line-is-fresh-run-db=$dbOk"
if ($ok -and $net -and $dbOk) {
  Write-Host "SIMNET-ENV-OK run=$run port=$ConsolePort env=$run\kanet.simnet.env"
  if ($WithProtoRelay) {
    Push-Location $treeFull; try { $ErrorActionPreference = 'Continue'; $mk = & node.exe (Join-Path $PSScriptRoot 'simnet-make-proto-relay.mjs') $run 2>&1 | Out-String; $mkc = $LASTEXITCODE } finally { Pop-Location }
    Write-Host ($mk.Trim()); if ($mkc -ne 0) { Write-Host 'PROTO-RELAY-FAIL: stopping the console'; Console-Down $run; exit 3 }
    Console-Down $run; $id2 = Console-Start $run $treeFull
    $drv = $null; for ($i = 0; $i -lt 60 -and -not $drv; $i++) { Start-Sleep -Seconds 1; if (Test-Path "$run\console-stdout.log") { $drv = Select-String -LiteralPath "$run\console-stdout.log" -Pattern '\[proto-settlement-driver\] started' -List | Select-Object -First 1 } }
    if ($drv) { Write-Host "DRIVER-LINE $($drv.Line)" } else { Write-Host 'DRIVER-LINE-MISSING: no [proto-settlement-driver] started line within 60 s (console left running; read console-stdout.log)' }
    Write-Host "console restarted pid=$id2 listening=$((Get-Listener $ConsolePort).Count -gt 0)"
  }
  exit 0
}
Write-Host 'SIMNET-ENV-FAIL: stopping the console I just started'; Console-Down $run; exit 3
