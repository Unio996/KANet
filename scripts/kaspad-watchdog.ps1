# TN12 kaspad 节点 watchdog — 开机自启动卡(KANet-UI域, 响应Bettor加急卡#lqp8vg, 2026-07-15)
# 仿 D:\kaspa-tn12-mining\tn12-mining-watchdog.ps1 同款模式(只启不杀, 60s tick, 不主动kill任何进程)。
#
# 背景: 2026-07-15 两起故障(宿主机重启+kaspad裸死)都因"进程死了没人拉"放大成全线故障。
# kaspad 是全链的根(console/relay都是它的下游), 没人守夜时进程死了要能自己起来。
#
# 🔴 canonical 命令的两个命门(Bettor #lqtxe6.1 note①钉死, 禁裸命令/禁省略):
#   --enable-unsynced-mining: bootstrap 死锁命门。不带则节点未同步时拒收RPC出块
#     ("Block was not submitted: node is not synced")——没块不同步、不同步不收块, 死锁。
#     7/3 + 7/15 两次全停恢复都靠这个flag解锁 (memory: reference-tn12-node-mining-outage-recovery)。
#   日志重定向: 今天(7/15 07:00Z)kaspad裸死查不到任何日志——上次手动重启命令没带重定向。
#     这次固定写 RedirectStandardOutput/Error, 防止"死因无证"复发。
#
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\kaspad-watchdog.ps1
#   (常驻循环, Ctrl+C 或关窗口停止; 不提供 stop 参数——只启不杀哲学下没有"watchdog杀节点"这回事)

$kaspadExe = "D:\rusty-kaspa\target\release\kaspad.exe"
$kaspadArgs = "--testnet --netsuffix=12 --appdir=D:/kaspa-tn12-data --utxoindex --rpclisten-borsh=0.0.0.0:17210 --enable-unsynced-mining"
$wlog = "D:\kaspa-tn12-data\kaspad-watchdog.log"
$stdoutLog = "D:\kaspa-tn12-data\kaspad-stdout.log"
$stderrLog = "D:\kaspa-tn12-data\kaspad-stderr.log"

function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Out-File $wlog -Append -Encoding UTF8 }

# MUST-FIX①(NWT红队 live 实测坐实): -RedirectStandardOutput/-RedirectStandardError 同名文件是覆盖写
# 不是追加写——若不archive, kaspad第二次死会把第一次死因的日志冲掉, 正好复现watchdog要解决的问题。
# 每次重启前把上一轮日志(若存在)改名加时间戳存档, 新一轮永远从干净的 stdout/stderr 文件名写起。
function Archive-IfExists($path) {
  if (Test-Path $path) {
    $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
    $archived = "$path.$ts"
    Rename-Item -Path $path -NewName (Split-Path $archived -Leaf) -Force
  }
}

Log "kaspad watchdog started (canonical cmd baked in, --enable-unsynced-mining + log redirection non-optional, log-archive-on-restart, try/catch loop)"

while ($true) {
  try {
    # Bettor 升级为结卡前必落(#lr32pt): 本机拓扑真实存在双kaspad(TN10 D:/kaspa-tn10-data 现在没跑但
    # 随时可能被拉起挖矿)。按进程名匹配会把"TN10活着"误判成"TN12活着", watchdog对自己唯一职责静默失效。
    # 改按 CommandLine 匹配 netsuffix=12(TN12专属), 不匹配任何TN10实例。
    $p = Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like '*netsuffix=12*' }
    if (-not $p) {
      Log "kaspad DEAD -> archiving prior stdout/stderr logs (if any) + starting canonical (--enable-unsynced-mining)"
      Archive-IfExists $stdoutLog
      Archive-IfExists $stderrLog
      $proc = Start-Process -FilePath $kaspadExe -ArgumentList $kaspadArgs -WorkingDirectory (Split-Path $kaspadExe) `
        -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -WindowStyle Hidden -PassThru
      Log "Start-Process dispatched, new PID=$($proc.Id) (does not yet confirm RPC ready, only that the OS process launched)"
    }
  } catch {
    # MUST-FIX②(NWT红队): 循环体任何异常(权限/瞬时WMI故障)绝不能让watchdog自己静默退出——
    # 那正是它本来要防的"进程死了没人拉"同款脆弱性。记日志, 继续循环。
    Log "WATCHDOG LOOP ERROR (caught, continuing): $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 60
}
