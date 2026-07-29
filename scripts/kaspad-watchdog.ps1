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
# 🔴 预置改动 (J1tn 2026-07-28, 节点域 owner 自拍; Bettor 频道明示"你那台你自己拍")
#   borsh RPC 由 0.0.0.0 改绑回环。由来: kaspad 的 borsh RPC 无鉴权, 而 0.0.0.0 让它绑上
#   tailnet 接口 —— 已两台互证跨机此刻可达 (J1 rc=52 自打 + KANet-UI 从对面实打 rc=52)。
#   本机该口 30 条连接 100% 回环 ⇒ 绑回环不打断任何现有调用方。
#
# 🔴🔴 本行的生效时机 —— 读这段之前先知道: 【本注释不能告诉你此刻的 bind 是什么】
#   $kaspadArgs 在【本脚本启动那一刻】读一次并存进 watchdog 进程内存。⇒ 改本文件【不】改变
#   正在跑的那个 watchdog: 只改文件 + 杀 kaspad, 它会用【旧参数】把节点拉回来, 而没有任何
#   东西会喊。⇒ 本行在【下一次 watchdog 本身重启】(开机/自启动卡)时才随新进程落地。
#
#   🔴 所以【不要】从本文件推断当前状态 —— 那正是本行想防的错误, 而本注释同样犯得起它:
#      2026-07-28 写下它时尚未生效; 之后任何一次 watchdog 重启都会让它生效, 而这段字不会自己改。
#      ⇒ 判据只有一个: 读【运行中 kaspad 的 CommandLine】(见下方验收判据 (a))。
#
#   这个"预置而不立即执行"是刻意的: 让它搭下一个【本来就会发生】的【节点重启窗】, 不为它单开一次 ——
#   🔴 用词按 Bettor 2026-07-28 钦定: 【console 重启窗】(只重 console+其 relay 子进程) 与
#      【节点重启窗】(重 kaspad, 停矿, 全网级) 是两个词; 单写"重启窗"三个字一律无效。
#      ⇒ 本行需要的是【节点重启窗】+ watchdog 进程本身重启, console 重启窗对它【零作用】。
#   单开一次停机会在 spc_daa_index 上凿一个 > MAX_WALK 的永久空洞 (本机已有 2 个,
#   见 scratch/j1-spc-index-holes.mjs)。Bettor 2026-07-28 频道裁定: 两台都等窗。
#
# ✅ 验收判据(必须在生效后才验; 现在验【一定失败】, 那是预期):
#   (a) Get-CimInstance Win32_Process 读【运行中 kaspad】的 CommandLine —— 不是读本文件
#   (b) netstat: 该口 LocalAddress 是回环, 不是通配
#   (c) 双臂实打: 从本机 tailnet 地址打该口 ⇒ 必须 rc=7; 同时回环打同口 ⇒ 必须 rc=52
#       🔴 两臂缺一不可 —— 只看到 rc=7 分不出【关好了】与【节点根本没起来】
#
# ⚠️ 这砍掉一个当前无人使用的能力: 跨节点直连本机 RPC。若日后团队确需, 不要退回通配 ——
#    改绑本机 tailnet 地址(有范围的口), 并当作一次显式决定记账。
$kaspadArgs = "--testnet --netsuffix=12 --appdir=D:/kaspa-tn12-data --utxoindex --rpclisten-borsh=127.0.0.1:17210 --enable-unsynced-mining"
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
