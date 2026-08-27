# reap-console-zombies.ps1 -- 清理僵尸 console 实例 (KANet-UI 域, D-013 §3 附; 接 J1 欠件)
# 背景: 8/23 EADDRINUSE 后 298 个 `kasia-console/src/index.js` node 实例撞端口占用没退出、堆积。
#   本脚本【只识别+只列表】(默认 dry-run); -Apply 须 Bettor 令 + J1 提权。
#
# 🔴 铁律(fail-closed 朝"不杀"):
#   - 绝不触 kaspad / relay / adapter / live console 27412 及其子树。
#   - cmdline 读不到(SYSTEM 非提权) => 归 UNKNOWN 桶, 【绝不】进 candidate。
#   - candidate 须【全部】满足: node.exe ∧ 非 live-console ∧ 非其子树 ∧ 零 LISTENING 套接字
#       ∧ cmdline 可读且含全路径 'kasia-console/src/index.js' ∧ cmdline 不含 kaspad/relay/adapter
#       ∧ 父进程已不存在(孤儿)。任一不满足 => UNKNOWN 或 EXCLUDED。
#
# 判据依据(承重闸②实核, KANet-UI 2026-08-27): 非提权 Get-NetTCPConnection -State Listen 能读到
#   SYSTEM 进程 27412 的 OwningProcess(3200/3210) => 零监听信号可靠, live console 显示有监听=被排除。
#
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\reap-console-zombies.ps1        (dry-run)
#       powershell ... -File scripts\reap-console-zombies.ps1 -Apply                                 (须 Bettor 令+提权)
param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$INDEX_JS_PATH = 'kasia-console/src/index.js'   # 闸①: 全路径, 非裸 index.js (兜底 reparent 出子树的 relay/adapter 子)
$INDEX_JS_ALT  = 'kasia-console\src\index.js'    # 反斜杠形
$EXCLUDE_RE    = 'kaspad|relay|adapter'          # 绝不触
$logDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'logs'
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$outFile = Join-Path $logDir "reap-$ts.json"

# --- live console PID: 闸③ 用实时 netstat OwningProcess(非 pidfile, 避陈旧陷阱) ---
$liveConsolePids = @()
try {
  $liveConsolePids = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 3200,3210 } | Select-Object -Expand OwningProcess -Unique)
} catch {}

# --- 全部 node.exe (pid/ppid/cmdline/start) ---
$nodes = @()
try { $nodes = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop) } catch {}

# --- 构建 live console 子树 (BFS: 任何祖先是 live console 的进程) ---
$allProcs = @{}
try { Get-CimInstance Win32_Process -ErrorAction Stop | ForEach-Object { $allProcs[[int]$_.ProcessId] = [int]$_.ParentProcessId } } catch {}
$subtree = @{}
$frontier = @($liveConsolePids | ForEach-Object { [int]$_ })
foreach ($p in $frontier) { $subtree[$p] = $true }
$changed = $true
while ($changed) {
  $changed = $false
  foreach ($npid in @($allProcs.Keys)) {
    if (-not $subtree.ContainsKey($npid) -and $subtree.ContainsKey($allProcs[$npid])) { $subtree[$npid] = $true; $changed = $true }
  }
}

# --- 全局 EADDRINUSE:3200 上下文 (辅助证据, 非 per-pid) ---
$eaddrinuseSeen = $false
try {
  $eaddrinuseSeen = @(Get-ChildItem (Join-Path $logDir 'console*.log') -ErrorAction SilentlyContinue |
    ForEach-Object { Select-String -Path $_.FullName -Pattern 'EADDRINUSE.*(127\.0\.0\.1:3200|:::3200)' -SimpleMatch:$false -ErrorAction SilentlyContinue } |
    Select-Object -First 1).Count -gt 0
} catch {}

$candidates = @(); $unknown = @(); $excluded = @()
foreach ($n in $nodes) {
  $npid = [int]$n.ProcessId
  $ppid = [int]$n.ParentProcessId
  $cmd = $n.CommandLine
  $cmdReadable = -not [string]::IsNullOrEmpty($cmd)
  $start = "$($n.CreationDate)"
  # 监听套接字
  $listeners = @()
  try { $listeners = @(Get-NetTCPConnection -State Listen -OwningProcess $npid -ErrorAction SilentlyContinue | Select-Object -Expand LocalPort -Unique) } catch {}
  $parentExists = $allProcs.ContainsKey($ppid)
  $rec = [ordered]@{ pid=$npid; ppid=$ppid; start=$start; cmd=$(if($cmdReadable){$cmd.Substring(0,[Math]::Min(120,$cmd.Length))}else{'(unreadable)'}); listeners=$listeners; parentExists=$parentExists }

  # EXCLUDED: live console 或其子树
  if ($liveConsolePids -contains $npid) { $rec.reason='live-console (listens 3200/3210)'; $excluded += $rec; continue }
  if ($subtree.ContainsKey($npid))      { $rec.reason='in live-console subtree'; $excluded += $rec; continue }
  # EXCLUDED: 有监听 (还在服务=非僵尸)
  if ($listeners.Count -gt 0)          { $rec.reason="has LISTENING ($($listeners -join ','))"; $excluded += $rec; continue }
  # cmdline 读不到 => UNKNOWN (fail-closed, 绝不杀)
  if (-not $cmdReadable)               { $rec.reason='cmdline unreadable => UNKNOWN (fail-closed)'; $unknown += $rec; continue }
  # EXCLUDED: cmdline 显 kaspad/relay/adapter
  if ($cmd -match $EXCLUDE_RE)         { $rec.reason='cmdline matches kaspad/relay/adapter (never touch)'; $excluded += $rec; continue }
  # 非 index.js 形 => EXCLUDED (不是 console 实例)
  if (-not ($cmd -match [regex]::Escape($INDEX_JS_PATH) -or $cmd -match [regex]::Escape($INDEX_JS_ALT))) { $rec.reason='not kasia-console/src/index.js shape'; $excluded += $rec; continue }
  # index.js 形 + 零监听 + 非 console/子树: 父在 => UNKNOWN(可能启动中); 父不存在(孤儿) => CANDIDATE
  if ($parentExists) { $rec.reason='index.js zero-listener but parent alive => UNKNOWN (could be starting)'; $rec.eaddrinuseContext=$eaddrinuseSeen; $unknown += $rec; continue }
  $rec.reason='CANDIDATE: index.js shape + zero-listener + not console/subtree + orphan (parent gone)'; $rec.eaddrinuseContext=$eaddrinuseSeen; $candidates += $rec
}

$result = [ordered]@{
  ts=$ts; mode=$(if($Apply){'APPLY'}else{'dry-run'}); liveConsolePids=$liveConsolePids;
  eaddrinuse3200SeenInLogs=$eaddrinuseSeen;
  counts=@{ node_total=$nodes.Count; candidates=$candidates.Count; unknown=$unknown.Count; excluded=$excluded.Count };
  candidates=$candidates; unknown=$unknown; excluded=$excluded
}
try { $result | ConvertTo-Json -Depth 6 | Out-File $outFile -Encoding UTF8 } catch {}
Write-Output "reap $($result.mode): node_total=$($nodes.Count) candidates=$($candidates.Count) unknown=$($unknown.Count) excluded=$($excluded.Count) -> $outFile"
Write-Output "liveConsolePids(3200/3210 owner)=$($liveConsolePids -join ',')  EADDRINUSE:3200-in-logs=$eaddrinuseSeen"

# -Apply: 仅 candidate 桶 Stop-Process; 须 Bettor 令+提权. 空候选=no-op.
if ($Apply) {
  if ($candidates.Count -eq 0) { Write-Output 'APPLY: 0 candidates, no-op'; return }
  Write-Warning "APPLY: stopping $($candidates.Count) candidate zombie(s) -- kaspad/relay/adapter/console UNTOUCHED"
  foreach ($c in $candidates) {
    try { Stop-Process -Id $c.pid -Force -ErrorAction Stop; Write-Output "APPLY: stopped PID $($c.pid)" }
    catch { Write-Output "APPLY: FAILED PID $($c.pid): $($_.Exception.Message)" }
  }
} else {
  Write-Output 'dry-run only (no process touched). -Apply requires Bettor order + elevation.'
}
