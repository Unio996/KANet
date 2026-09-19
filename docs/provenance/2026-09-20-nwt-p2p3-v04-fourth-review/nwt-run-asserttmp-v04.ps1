# NWT 4th review f0c45290: direct unit tests of Assert-UnderTmp + mutations of it (all paths in private temp dirs; the unit tests only rebind $tmp and call the function, nothing is deleted).
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
  '{0,-46} exit={1} pass={2} fail={3}' -f $name, $code, @($lines | Where-Object { $_ -like 'PASS *' }).Count, @($lines | Where-Object { $_ -like 'FAIL *' }).Count
  $lines | Where-Object { $_ -like 'FAIL *' -and $_ -match 'NWT-asserttmp' } | ForEach-Object { '    ' + $_.Substring(0, [Math]::Min(150, $_.Length)) }
}
$anchor = "  Dispose-Locks`n  Assert-UnderTmp `$tmp`n  Remove-Item -Recurse -Force `$tmp"
$vec = @'
  # NWT direct unit tests of Assert-UnderTmp (only rebinds $tmp and calls the function; nothing is deleted)
  function Expect-Safety([scriptblock]$sb) { try { & $sb | Out-Null; return $false } catch { return ($_.Exception.Message -like 'SELFTEST SAFETY*') } }
  $tmpSaved = $tmp
  $tmp = 'C:\Windows';                         $t1 = Expect-Safety { Assert-UnderTmp 'C:\Windows' }
  $tmp = (Split-Path $tmpSaved -Parent);       $t2 = Expect-Safety { Assert-UnderTmp $tmp }
  $tmp = $tmpSaved;                            $t3 = Expect-Safety { Assert-UnderTmp ($tmpSaved + 'x') }
  $tmp = $tmpSaved;                            $t4 = -not (Expect-Safety { Assert-UnderTmp (Join-Path $tmpSaved 'ok') })
  $tmp = (Join-Path ([System.IO.Path]::GetTempPath().TrimEnd('\')) 'other-dir'); $t5 = Expect-Safety { Assert-UnderTmp $tmp }
  $tmp = 'C:\Windows\boot-selftest-x'; $t6 = Expect-Safety { Assert-UnderTmp $tmp }
  $tmp = $tmpSaved
  Check 'NWT-asserttmp-1 temp-root-outside tmp (C:\Windows) is refused' $t1
  Check 'NWT-asserttmp-2 tmp == the temp root itself (leaf is not boot-selftest-*) is refused' $t2
  Check 'NWT-asserttmp-3 sibling path sharing the prefix (no separator boundary) is refused' $t3
  Check 'NWT-asserttmp-4 a real child of tmp is accepted' $t4
  Check 'NWT-asserttmp-5 tmp under the temp root but with a non boot-selftest leaf is refused' $t5
  Check 'NWT-asserttmp-6 boot-selftest-* leaf but NOT under GetTempPath() is refused' $t6

'@
if (([regex]::Matches($src, [regex]::Escape($anchor))).Count -ne 1) { throw 'anchor not unique (line endings?)' }
$w = $src.Replace($anchor, $vec + $anchor)
Run-Variant 'a00-unit-tests-on-baseline' $w
Run-Variant 'a01-unit-tests-on-mutant-no-leaf-check' (Apply $w " -and `$leaf -like 'boot-selftest-*'" '')
Run-Variant 'a02-unit-tests-on-mutant-no-temproot-check' (Apply $w '$tmp.StartsWith($tempRoot + ''\'') -and ' '')
# and the same mutants WITHOUT my unit tests (what the author's suite sees):

