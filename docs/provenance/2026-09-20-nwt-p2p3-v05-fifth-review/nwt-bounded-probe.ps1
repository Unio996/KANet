# NWT 五审 N4-2: 直接抽出 Invoke-BoundedProcess(mainnet-boot-sequence.ps1 v0.5 附录 A 原文, 行 183..212), 用我自己的向量测。
# 只碰临时目录; 只杀函数自己创建的那个进程; 孙进程向量的孙进程自己有 15 s 寿命上限(不需要我去杀)。
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Get-Content -LiteralPath (Join-Path $here 'mainnet-boot-sequence.ps1') -Encoding ASCII
$start = ($src | Select-String -Pattern '^function Invoke-BoundedProcess' | Select-Object -First 1).LineNumber
$end = ($src | Select-String -Pattern '^function Invoke-NodeTool' | Select-Object -First 1).LineNumber - 1
$fnText = ($src[($start - 1)..($end - 1)]) -join "`n"
"extracted lines $start..$end ($($fnText.Length) chars)"

$tmp = Join-Path $env:TEMP ('nwt_bp_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$BootDir = $tmp
$Script:Ctx = @{}
$Script:BeatCalls = 0; $Script:BeatWithDiff = 0
function Invoke-SentinelBeat { param($Ctx, [switch]$InGate, [switch]$NoDiff) $Script:BeatCalls++; if (-not $NoDiff) { $Script:BeatWithDiff++ } }
. ([scriptblock]::Create($fnText))
$node = (Get-Command node.exe -ErrorAction Stop).Source

# --- 向量脚本(都放临时目录) ---
Set-Content -LiteralPath (Join-Path $tmp 'busy.js') -Encoding ASCII -Value "setTimeout(()=>{},1000); const t=Date.now(); while(Date.now()-t<20000){}"   # 自带 1 s 定时器 + 事件循环被占 20 s(我四审的忙循环)
Set-Content -LiteralPath (Join-Path $tmp 'exit7.js') -Encoding ASCII -Value "process.stdout.write('OUT-LINE'); process.stderr.write('ERR-LINE'); process.exit(7);"
Set-Content -LiteralPath (Join-Path $tmp 'argv.js') -Encoding ASCII -Value "process.stdout.write(JSON.stringify(process.argv.slice(2)));"
Set-Content -LiteralPath (Join-Path $tmp 'grand.js') -Encoding ASCII -Value "const cp=require('child_process'); const g=cp.spawn(process.execPath,['-e','const t=Date.now(); while(Date.now()-t<15000){}'],{stdio:'ignore'}); require('fs').writeFileSync(process.argv[2], String(g.pid)); const t=Date.now(); while(Date.now()-t<20000){}"
Set-Content -LiteralPath (Join-Path $tmp 'spew.js') -Encoding ASCII -Value "const b='x'.repeat(1024*1024); for(let i=0;i<64;i++) process.stdout.write(b);"   # 64 MB 输出后正常退出

$res = [ordered]@{}
# a. 忙循环, 2 s 上限
$bystander = Start-Process -FilePath $node -ArgumentList @('-e', '"setTimeout(()=>{},30000)"') -PassThru -WindowStyle Hidden
$Script:BeatCalls = 0; $Script:BeatWithDiff = 0
$sw = [Diagnostics.Stopwatch]::StartNew(); $r = Invoke-BoundedProcess $node @((Join-Path $tmp 'busy.js')) 2; $sw.Stop()
$killedPid = if ($r.Text -match 'killed pid (\d+)') { [int]$Matches[1] } else { 0 }
$res['a busy-loop 2s cap'] = ("Code={0} TimedOut={1} elapsed={2:N1}s beats={3} beatsWithDiff={4} killedPid={5} childAlive={6} bystanderAlive={7}" -f $r.Code, $r.TimedOut, $sw.Elapsed.TotalSeconds, $Script:BeatCalls, $Script:BeatWithDiff, $killedPid, [bool](Get-Process -Id $killedPid -ErrorAction SilentlyContinue), (-not $bystander.HasExited))
try { $bystander.Kill() } catch { }   # 我自己起的旁观进程, 精确对象
# b. 退出码与两路输出
$r = Invoke-BoundedProcess $node @((Join-Path $tmp 'exit7.js')) 20
$res['b exit code + both streams'] = ("Code={0} TimedOut={1} Text='{2}'" -f $r.Code, $r.TimedOut, $r.Text)
# c. 参数保真: 空格 / 引号 / 尾部反斜杠 / 空串 / 等号
$sent = @('a b', 'q"uote', 'C:\some dir\', '', '--x=1 2', 'plain')
$r = Invoke-BoundedProcess $node (@((Join-Path $tmp 'argv.js')) + $sent) 20
$res['c argv fidelity: sent'] = ($sent | ConvertTo-Json -Compress)
$res['c argv fidelity: received'] = ("Code={0} Text={1}" -f $r.Code, $r.Text)
# d. 孙进程: 只杀直接子进程, 孙进程照活(限制①的实测)
$gpidFile = Join-Path $tmp 'gpid.txt'
$r = Invoke-BoundedProcess $node @((Join-Path $tmp 'grand.js'), $gpidFile) 3
$gpid = if (Test-Path $gpidFile) { [int](Get-Content $gpidFile) } else { 0 }
$res['d grandchild'] = ("Code={0} TimedOut={1} grandchildPid={2} grandchildAliveAfterParentKilled={3}" -f $r.Code, $r.TimedOut, $gpid, [bool](Get-Process -Id $gpid -ErrorAction SilentlyContinue))
# e. 64 MB 输出后正常退出: 函数把整个输出读进内存返回(无上限)
$before = [GC]::GetTotalMemory($true)
$r = Invoke-BoundedProcess $node @((Join-Path $tmp 'spew.js')) 30
$res['e 64MB stdout'] = ("Code={0} returnedTextChars={1} (no cap on returned text)" -f $r.Code, $r.Text.Length)
$res.GetEnumerator() | ForEach-Object { "{0}: {1}" -f $_.Key, $_.Value }
# 清理: 只删我的临时目录(孙进程 15 s 后自己退出; 到时再删不了就留着)
Start-Sleep -Seconds 1
Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
"tmp dir removed: $(-not (Test-Path $tmp))"
