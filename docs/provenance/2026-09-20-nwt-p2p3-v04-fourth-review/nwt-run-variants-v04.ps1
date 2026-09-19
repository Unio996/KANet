# NWT 四审 f0c45290: 对 v0.4 附录 A 脚本自己的 -SelfTest 做变异。所有路径参数指向私有临时目录; SelfTest 自己也会再重定向+断言。
$ErrorActionPreference = 'Stop'
$src = Get-Content -Raw -LiteralPath 'D:\kanet-tn12\scratch\_nwt_boot_v04\mainnet-boot-sequence.ps1'
$dir = 'D:\kanet-tn12\scratch\_nwt_boot_v04\variants'; New-Item -ItemType Directory -Force $dir | Out-Null
function Apply([string]$text, [string]$find, [string]$repl) {
  $n = ([regex]::Matches($text, [regex]::Escape($find))).Count
  if ($n -ne 1) { throw "pattern matched $n times (need exactly 1): $($find.Substring(0, [Math]::Min(80, $find.Length)))" }
  return $text.Replace($find, $repl)
}
function Run-Variant([string]$name, [string]$text) {
  $ErrorActionPreference = 'Continue'
  $f = Join-Path $dir "$name.ps1"; Set-Content -LiteralPath $f -Value $text -Encoding ASCII
  $root = Join-Path $env:TEMP "nwt-bs4-$name"; New-Item -ItemType Directory -Force $root | Out-Null
  $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $f -SelfTest -KanetRoot $root -KaspadLogDir "$root\kl" -AppDir "$root\ad" -KaspadInternalLog "$root\ri.log" -KaspadExe "$root\k.exe" 2>&1 | Out-String
  $code = $LASTEXITCODE
  Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
  $lines = $out -split "`r?`n"
  $fails = @($lines | Where-Object { $_ -like 'FAIL *' })
  $pass = @($lines | Where-Object { $_ -like 'PASS *' }).Count
  $tag = if ($name -eq 'v00-baseline') { 'base    ' } elseif ($fails.Count -gt 0 -or $code -ne 0) { 'killed  ' } else { 'SURVIVED' }
  '{0} {1,-40} exit={2} pass={3} fail={4}' -f $tag, $name, $code, $pass, $fails.Count
  foreach ($x in $fails | Select-Object -First 3) { '         ' + $x.Substring(0, [Math]::Min(140, $x.Length)) }
  if ($fails.Count -eq 0 -and $code -ne 0) { '         (non-zero exit, no FAIL line) ' + (($lines | Select-Object -Last 2) -join ' | ') }
}
Run-Variant 'v00-baseline' $src
Run-Variant 'n1a-no-beat-in-ALIVE-gate' (Apply $src '    Invoke-SentinelBeat $Ctx -InGate   #' '    #')
Run-Variant 'n1b-no-beat-in-t0-snapshot-loop' (Apply $src "  for (`$i = 1; `$i -le 3; `$i++) {`n    Invoke-SentinelBeat `$Script:Ctx`n" "  for (`$i = 1; `$i -le 3; `$i++) {`n")
Run-Variant 'n1c-no-beat-in-console-verify-loop' (Apply $src "  while ((`$Script:Mono.Elapsed.TotalSeconds - `$t0) -lt 300) {`n    Invoke-SentinelBeat `$Script:Ctx`n" "  while ((`$Script:Mono.Elapsed.TotalSeconds - `$t0) -lt 300) {`n")
Run-Variant 'n1d-memhb-written-before-sampling' (Apply (Apply $src "  Set-MemHeartbeat`n  `$Script:MemTicks++" "  `$Script:MemTicks++") "  `$cfg = Get-MemoryConfig; `$now = [double]`$Script:Mono.ElapsedMilliseconds`n  try { `$s = Get-MemorySample }" "  `$cfg = Get-MemoryConfig; `$now = [double]`$Script:Mono.ElapsedMilliseconds; Set-MemHeartbeat`n  try { `$s = Get-MemorySample }")
Run-Variant 'n1e-memhb-written-on-sample-FAILURE' (Apply $src '    Write-MemLine ("SAMPLE-FAILED n={0}: {1}" -f $Script:MemFails, $err)' '    Write-MemLine ("SAMPLE-FAILED n={0}: {1}" -f $Script:MemFails, $err); Set-MemHeartbeat')
Run-Variant 'n1f-memory-tick-skipped-while-InGate' (Apply $src 'if ($Script:Beat.HaveMem -and ((' 'if ($Script:Beat.HaveMem -and -not $InGate -and ((')
Run-Variant 'n1g-throttle-never-refires' (Apply $src "      `$Script:Beat.LastMemMs = [double]`$Script:Mono.ElapsedMilliseconds`n      Invoke-MemoryWatchTick" "      `$Script:Beat.LastMemMs = 1e15`n      Invoke-MemoryWatchTick")
Run-Variant 'n1h-throttle-removed-samples-every-beat' (Apply $src '-ge ($SentinelTickSec * 1000.0))) {' '-ge 0)) {')
Run-Variant 'n1i-script-heartbeat-not-written-by-beat' (Apply $src "  Set-Heartbeat`n  try {`n    if (`$Script:MemCfgErr -and -not `$Script:Beat.CfgWarned)" "  try {`n    if (`$Script:MemCfgErr -and -not `$Script:Beat.CfgWarned)")
Run-Variant 'n1j-memory-tick-exception-escapes-beat' (Apply $src "  } catch { Write-History (`"memory tick exception: {0}`" -f `$_.Exception.Message) }`n}`n`nfunction Invoke-SentinelLoop" "  } catch { throw }`n}`n`nfunction Invoke-SentinelLoop")
Run-Variant 'n1k-outbound-diff-not-gated-on-console' (Apply $src ' -and $Script:OutboundDueMs -gt 0 -and ' ' -and ')
