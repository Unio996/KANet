# NWT 四审: 用【真实的 Invoke-NodeTool】(从 v0.4 脚本用 AST 抽出, 逐字)去跑一个"自带 1 秒 hard timer、但事件循环被 CPU 密集占住 20 秒"的 node 子进程。
# 目的: 证明工具内部的 JS 定时器不能约束 CPU 密集卡住的子进程; 只有外部(父进程)超时才可靠。全部在私有临时目录, 子进程只是忙等, 不碰任何东西。
$ErrorActionPreference = 'Stop'
$scriptPath = 'D:\kanet-tn12\scratch\_nwt_boot_v04\mainnet-boot-sequence.ps1'
$tokens = $null; $errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errs)
if ($errs.Count) { throw "parse errors: $($errs.Count)" }
$fns = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-NodeTool' }, $true) | Sort-Object { $_.Extent.StartLineNumber }
"Invoke-NodeTool definitions found: $($fns.Count) (lines: $(($fns | ForEach-Object { $_.Extent.StartLineNumber }) -join ','))  -> using the first (script level)"
$fnText = $fns[0].Extent.Text
$root = Join-Path $env:TEMP 'nwt-nodetool-hang'; New-Item -ItemType Directory -Force (Join-Path $root 'scripts') | Out-Null
Set-Content -LiteralPath (Join-Path $root 'scripts\busy.mjs') -Encoding ASCII -Value @'
// self-imposed hard timer at 1 s (like boot-outbound-check.mjs's 5 min hard timer) ... but the event loop is CPU-bound for 20 s
setTimeout(() => process.exit(2), 1000);
const end = Date.now() + 20000; while (Date.now() < end) { }
console.log('finished busy loop');
'@
$job = Start-Job -ScriptBlock {
  param($fnText, $root)
  $KanetRoot = $root
  Invoke-Expression $fnText
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $r = Invoke-NodeTool 'scripts\busy.mjs' @()
  '{0:N1}s code={1} text=[{2}]' -f $sw.Elapsed.TotalSeconds, $r.Code, $r.Text
} -ArgumentList $fnText, $root
$done = Wait-Job $job -Timeout 40
if ($done) { "Invoke-NodeTool returned after: " + (Receive-Job $job) } else { 'STILL BLOCKED after 40 s'; Stop-Job $job }
Remove-Job $job -Force
Start-Sleep -Seconds 2
Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
