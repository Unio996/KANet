# a5-verify.ps1 - A.5 llama ctx cutover verification (READ-ONLY, zero side effect).
# 给 J1 用: 停/换 llama 前后各跑一次对比。中文仅在 # 注释, Write-Output 串一律 ASCII (no-BOM UTF-8 cp1252 陷阱)。
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File D:\kanet-tn12\scripts\a5-verify.ps1
# 只读: 只查 进程/日志/HTTP GET/nvidia-smi/netstat, 不停不起不写任何 live 状态。
$ErrorActionPreference = 'Continue'
$root = 'D:\kanet-tn12'
Write-Output "=== A.5 verify @ $((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')) host=$env:COMPUTERNAME ==="

Write-Output "`n[1] llama-server.exe process"
$p = Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" -ErrorAction SilentlyContinue
if ($p) {
  foreach ($x in $p) {
    $paged = [math]::Round($x.PagedMemorySize64/1GB, 2)
    $priv  = [math]::Round($x.PrivatePageCount/1GB, 2)
    $ctx = if ($x.CommandLine -match '--ctx-size\s+(\S+)') { $matches[1] } else { '(CommandLine unreadable, maybe SYSTEM non-elevated)' }
    Write-Output ("  PID={0} Start={1} ctx-size={2} PagedMem={3}GB PrivateCommit={4}GB" -f $x.ProcessId, $x.CreationDate, $ctx, $paged, $priv)
    Write-Output ("  CommandLine={0}" -f $(if ($x.CommandLine) { $x.CommandLine } else { '(null=SYSTEM non-elevated)' }))
  }
} else { Write-Output "  (no llama-server.exe running)" }

Write-Output "`n[2] logs/llama-server.log latest KV cache line"
$log = Join-Path $root 'logs\llama-server.log'
if (Test-Path $log) {
  $kv = Select-String -Path $log -Pattern 'llama_kv_cache: size' -Encoding utf8 | Select-Object -Last 1
  if ($kv) { Write-Output ("  {0}" -f $kv.Line.Trim()) } else { Write-Output "  (no kv_cache line in log)" }
} else { Write-Output "  (no $log)" }

Write-Output "`n[3] /props n_ctx (curl :8000)"
try {
  $props = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/props' -TimeoutSec 5 -ErrorAction Stop
  $nctx = $props.default_generation_settings.n_ctx
  $model = $props.model_path
  Write-Output ("  n_ctx={0} model={1}" -f $nctx, $(Split-Path $model -Leaf))
} catch { Write-Output ("  (:8000 /props unreachable: {0})" -f $_.Exception.Message) }

Write-Output "`n[4] nvidia-smi VRAM"
try { $smi = & nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>$null; Write-Output ("  used,total = {0}" -f $smi) } catch { Write-Output "  (nvidia-smi n/a)" }

Write-Output "`n[5] OS free commit"
$os = Get-CimInstance Win32_OperatingSystem
$freeGb = [math]::Round($os.FreeVirtualMemory/1MB, 1)
$usedGb = [math]::Round(($os.TotalVirtualMemorySize - $os.FreeVirtualMemory)/1MB, 1)
$limGb  = [math]::Round($os.TotalVirtualMemorySize/1MB, 1)
Write-Output ("  FreeVirtualMemory(free commit)={0}GB  Used={1}GB  Limit={2}GB" -f $freeGb, $usedGb, $limGb)

Write-Output "`n[6] llm-watchdog running? (expect none)"
$wd = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*llm-watchdog*' })
Write-Output ("  llm-watchdog count={0} {1}" -f $wd.Count, $(if ($wd.Count -eq 0) { '(not running, OK)' } else { 'RUNNING!' }))

Write-Output "`n[7] netstat :8000 LISTENING"
$n = netstat -ano | Select-String ':8000 ' | Select-String 'LISTENING'
if ($n) { $n | ForEach-Object { Write-Output ("  {0}" -f $_.Line.Trim()) } } else { Write-Output "  (:8000 no LISTENING)" }

Write-Output "`n=== end ==="
