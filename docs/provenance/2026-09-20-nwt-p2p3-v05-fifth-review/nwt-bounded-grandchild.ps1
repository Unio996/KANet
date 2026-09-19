# 孙进程实测(限制①"只杀直接子进程"): 孙进程自己每 200 ms 写心跳文件并有 15 s 寿命上限(自行退出, 不需要我杀)。
# 分别记: 孙进程在父进程被杀【之前】是否活着(心跳在走)、被杀【之后】心跳是否继续。
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Get-Content -LiteralPath (Join-Path $here 'mainnet-boot-sequence.ps1') -Encoding ASCII
$start = ($src | Select-String -Pattern '^function Invoke-BoundedProcess' | Select-Object -First 1).LineNumber
$end = ($src | Select-String -Pattern '^function Invoke-NodeTool' | Select-Object -First 1).LineNumber - 1
$fnText = ($src[($start - 1)..($end - 1)]) -join "`n"
$tmp = Join-Path $env:TEMP ('nwt_bg_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$BootDir = $tmp; $Script:Ctx = @{}
$Script:Log = New-Object System.Collections.ArrayList
function Invoke-SentinelBeat { param($Ctx, [switch]$InGate, [switch]$NoDiff)
  $hb = Join-Path $tmp 'hb.txt'
  $v = if (Test-Path $hb) { (Get-Content $hb -ErrorAction SilentlyContinue) } else { '' }
  [void]$Script:Log.Add(("beat: hb={0}" -f $v)) }
. ([scriptblock]::Create($fnText))
$node = (Get-Command node.exe -ErrorAction Stop).Source
$hbFile = (Join-Path $tmp 'hb.txt') -replace '\\', '/'
$grandJs = @'
const cp = require('child_process'); const fs = require('fs');
const child = "const fs = require('fs'); setInterval(() => fs.writeFileSync('HBFILE', String(Date.now())), 200); setTimeout(() => process.exit(0), 15000);";
const g = cp.spawn(process.execPath, ['-e', child], { stdio: 'ignore' });
fs.writeFileSync(process.argv[2], String(g.pid));
const t = Date.now(); while (Date.now() - t < 20000) {}
'@
Set-Content -LiteralPath (Join-Path $tmp 'grand2.js') -Encoding ASCII -Value ($grandJs.Replace('HBFILE', $hbFile))
$gpidFile = Join-Path $tmp 'gpid.txt'
$sw = [Diagnostics.Stopwatch]::StartNew()
$r = Invoke-BoundedProcess $node @((Join-Path $tmp 'grand2.js'), $gpidFile) 4
$sw.Stop()
$gpid = if (Test-Path $gpidFile) { [int](Get-Content $gpidFile) } else { 0 }
"parent result: Code=$($r.Code) TimedOut=$($r.TimedOut) elapsed=$([math]::Round($sw.Elapsed.TotalSeconds,1))s  grandchildPid=$gpid"
"beats seen during the wait (heartbeat value the grandchild wrote):"
$Script:Log | ForEach-Object { "  $_" }
$t1 = (Get-Content (Join-Path $tmp 'hb.txt') -ErrorAction SilentlyContinue)
Start-Sleep -Milliseconds 1500
$t2 = (Get-Content (Join-Path $tmp 'hb.txt') -ErrorAction SilentlyContinue)
"after the parent was killed: heartbeat before=$t1 after 1.5s=$t2  => grandchild still running: $([bool]($t1 -and $t2 -and $t2 -ne $t1))"
"grandchild process exists: $([bool](Get-Process -Id $gpid -ErrorAction SilentlyContinue))"
# 等孙进程 15 s 自行退出再清理
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Process -Id $gpid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
"tmp dir removed: $(-not (Test-Path $tmp))"
