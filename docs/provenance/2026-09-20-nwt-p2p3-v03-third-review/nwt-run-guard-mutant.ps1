# NWT: is the SELFTEST SAFETY path assertion live? Mutant: drop the temp redirect of $KaspadLogDir. My runner passes a private temp
# -KaspadLogDir, so even if the assertion did NOT trip nothing production could be reached.
$ErrorActionPreference = 'Continue'
$src = Get-Content -Raw -LiteralPath 'D:\kanet-tn12\scratch\_nwt_boot_v03\mainnet-boot-sequence.ps1'
$find = "`$KaspadLogDir = Join-Path `$tmp 'kaspad-logs'; "
$n = ([regex]::Matches($src, [regex]::Escape($find))).Count
if ($n -ne 1) { "pattern matched $n times"; exit 9 }
$dir = 'D:\kanet-tn12\scratch\_nwt_boot_v03\variants'; New-Item -ItemType Directory -Force $dir | Out-Null
$f = Join-Path $dir 'm7-no-KaspadLogDir-redirect.ps1'; Set-Content -LiteralPath $f -Value $src.Replace($find, '') -Encoding ASCII
$root = Join-Path $env:TEMP 'nwt-bs-m7'; New-Item -ItemType Directory -Force $root | Out-Null
$out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $f -SelfTest -KanetRoot $root -KaspadLogDir "$root\kl" -AppDir "$root\ad" -KaspadInternalLog "$root\ri.log" -KaspadExe "$root\k.exe" 2>&1 | Out-String
$code = $LASTEXITCODE
Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
$lines = $out -split "`r?`n"
"m7 exit=$code  PASS=" + @($lines | Where-Object { $_ -like 'PASS *' }).Count + "  FAIL=" + @($lines | Where-Object { $_ -like 'FAIL *' }).Count
"safety assertion tripped: " + [bool]($out -match 'SELFTEST SAFETY')
($lines | Where-Object { $_ -match 'SELFTEST SAFETY' } | Select-Object -First 1)
