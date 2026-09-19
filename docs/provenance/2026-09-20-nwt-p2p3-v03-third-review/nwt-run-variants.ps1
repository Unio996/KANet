# NWT 2026-09-20: run the runbook v0.3 appendix-A script's own -SelfTest against mutated / extended copies.
# Every run redirects ALL path params into a private temp root (the script also redirects itself); nothing production is touched.
$ErrorActionPreference = 'Stop'
$src = Get-Content -Raw -LiteralPath 'D:\kanet-tn12\scratch\_nwt_boot_v03\mainnet-boot-sequence.ps1'
$dir = 'D:\kanet-tn12\scratch\_nwt_boot_v03\variants'; New-Item -ItemType Directory -Force $dir | Out-Null

function Apply([string]$text, [string]$find, [string]$repl) {
  $n = ([regex]::Matches($text, [regex]::Escape($find))).Count
  if ($n -ne 1) { throw "pattern matched $n times (need exactly 1): $($find.Substring(0, [Math]::Min(70, $find.Length)))" }
  return $text.Replace($find, $repl)
}
function Run-Variant([string]$name, [string]$text) {
  $ErrorActionPreference = 'Continue'   # native stderr through 2>&1 must not become a terminating error in PS 5.1
  $f = Join-Path $dir "$name.ps1"; Set-Content -LiteralPath $f -Value $text -Encoding ASCII
  $root = Join-Path $env:TEMP "nwt-bs-$name"; New-Item -ItemType Directory -Force $root | Out-Null
  $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $f -SelfTest -KanetRoot $root -KaspadLogDir "$root\kl" -AppDir "$root\ad" -KaspadInternalLog "$root\ri.log" -KaspadExe "$root\k.exe" 2>&1 | Out-String
  $code = $LASTEXITCODE
  Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
  $lines = $out -split "`r?`n"
  $fails = @($lines | Where-Object { $_ -like 'FAIL *' })
  $pass = @($lines | Where-Object { $_ -like 'PASS *' }).Count
  '{0,-34} exit={1} pass={2} fail={3}' -f $name, $code, $pass, $fails.Count
  foreach ($x in $fails | Select-Object -First 4) { '    ' + $x.Substring(0, [Math]::Min(150, $x.Length)) }
  if ($fails.Count -eq 0 -and $code -ne 0) { '    (non-zero exit without FAIL lines) ' + ($lines | Select-Object -Last 3) -join ' | ' }
}

# ---- N1 vector: memory watch must run while the ALIVE gate is still waiting ----
$anchor = "  Dispose-Locks`r`n  Remove-Item -Recurse -Force `$tmp -ErrorAction SilentlyContinue"
if ($src -notmatch [regex]::Escape($anchor)) { $anchor = "  Dispose-Locks`n  Remove-Item -Recurse -Force `$tmp -ErrorAction SilentlyContinue" }
$crit = '@{ pct = 96.0; usedGB = 86.0; limitGB = 89.6; physFreeGB = 0.4; top = ''x:1:1''; selfMB = 40.0; selfHandles = 500 }'
$vec = @"
  # NWT-N1 positive control: with the sentinel running (probe ALIVE at once) a CRIT sample MUST raise 9302 -- proves the fixture path works
  Reset-Sim; `$Script:Fake = $crit; Run-Flow
  Check 'NWT-N1-control: sentinel raises 9302 on a CRIT sample' (`$Script:Sim.Ev -contains 9302)
  # NWT-N1: same CRIT sample while kaspad is still SYNCING (probe 7) for 6 gate iterations, then ALIVE
  Reset-Sim @{ ProbeCode = 7 }; `$Script:Fake = $crit
  `$Script:OnSleepAt = 6; `$Script:OnSleep = { `$Script:Sim.ProbeCode = 0 }
  `$Script:Ctx = @{ Pid = `$PID; StartTicks = `$null; PrevUnclean = `$false }; `$null = Wait-KaspadAlive `$Script:Ctx; `$Script:OnSleepAt = 0
  Check 'NWT-N1: memory CRIT (9302) is raised DURING the ALIVE gate wait' (`$Script:Sim.Ev -contains 9302)

"@
Run-Variant 'v00-baseline' $src
Run-Variant 'v01-N1-vector' ($src.Replace($anchor, $vec + $anchor))

# ---- M-A mutation checks: do the flow tests notice a regression of each M-A protection? ----
Run-Variant 'm1-no-try-around-PhaseB' (Apply $src '  try { Invoke-PhaseB $Script:Ctx }
  catch {' '  & { Invoke-PhaseB $Script:Ctx }
  &{ }
  if ($false) {')
Run-Variant 'm2-outer-catch-always-StopBoot' (Apply $src 'if ($null -eq $Script:Ctx) { Stop-Boot 99' 'if ($true) { Stop-Boot 99')
Run-Variant 'm3-pidfile-catch-rethrows' (Apply $src 'catch { Write-History ("kaspad.pid write failed (non-fatal, kaspad stays up): {0}" -f $_.Exception.Message) }' 'catch { throw }')
Run-Variant 'm4-Ctx-published-after-Set-BootStatus' (Apply (Apply $src '  $Script:Ctx = @{ Pid = $kPid; StartTicks = $null; Tree = $tree; PrevUnclean = $prevUnclean; StdoutPath = (Join-Path $KaspadLogDir ''kaspad-stdout.log'') }' '') '  if ($InjectFault -eq ''phasea-late'') { throw ''injected late Phase A exception (kaspad already known, outside every inner try)'' }' '  if ($InjectFault -eq ''phasea-late'') { throw ''injected late Phase A exception (kaspad already known, outside every inner try)'' }
  $Script:Ctx = @{ Pid = $kPid; StartTicks = $null; Tree = $tree; PrevUnclean = $prevUnclean; StdoutPath = (Join-Path $KaspadLogDir ''kaspad-stdout.log'') }')
Run-Variant 'm5-sentinel-loop-no-outer-catch' (Apply $src 'catch { Write-History ("sentinel loop threw (restarting the loop, NOT the boot logic): {0}" -f $_.Exception.Message); Start-Sleep -Seconds 30 }' 'catch { throw }')
Run-Variant 'm6-probe-throw-aborts-gate' (Apply $src 'try { $p = Invoke-Probe } catch { $p = [pscustomobject]@{ Code = 1; Line = ("probe threw: {0}" -f $_.Exception.Message) } }' '$p = Invoke-Probe')
