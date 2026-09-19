# NWT 四审: 真实时间下验证 Invoke-SentinelBeat 的内存采样节流会重复触发(并证明该向量能抓 n1g 变异)。路径全在私有临时目录。
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
  '{0,-34} exit={1} pass={2} fail={3}' -f $name, $code, @($lines | Where-Object { $_ -like 'PASS *' }).Count, @($lines | Where-Object { $_ -like 'FAIL *' }).Count
  $lines | Where-Object { $_ -match 'NWT-throttle-realtime' } | ForEach-Object { '    ' + $_.Substring(0, [Math]::Min(150, $_.Length)) }
}
$anchor = "  Dispose-Locks`n  Assert-UnderTmp `$tmp`n  Remove-Item -Recurse -Force `$tmp"
$vec = @'
  # NWT real-time throttle check: SentinelTickSec=2, one beat every 0.7 s for 7 s => the memory sample must re-fire about every 2 s (3..5 samples), not once, not every beat
  Reset-Sim; $Script:Fake = $good; $SentinelTickSec = 2; $Script:Beat.LastMemMs = -1e12; $Script:MemTicks = 0
  $rt0 = [DateTime]::UtcNow; while (([DateTime]::UtcNow - $rt0).TotalSeconds -lt 7) { Invoke-SentinelBeat $Script:Ctx; [System.Threading.Thread]::Sleep(700) }
  Check ("NWT-throttle-realtime: samples over 7 s at a 2 s tick = {0} (want 3..5)" -f $Script:MemTicks) ($Script:MemTicks -ge 3 -and $Script:MemTicks -le 5)

'@
if (([regex]::Matches($src, [regex]::Escape($anchor))).Count -ne 1) { throw 'anchor not unique (line endings?)' }
$withVec = $src.Replace($anchor, $vec + $anchor)
Run-Variant 'v01-throttle-vector-on-baseline' $withVec
Run-Variant 'v02-throttle-vector-on-n1g' (Apply $withVec "      `$Script:Beat.LastMemMs = [double]`$Script:Mono.ElapsedMilliseconds`n      Invoke-MemoryWatchTick" "      `$Script:Beat.LastMemMs = 1e15`n      Invoke-MemoryWatchTick")
