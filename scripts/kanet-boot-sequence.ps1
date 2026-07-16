# KANet TN12 开机启动序 — 响应 Bettor 加急卡 #lqp8vg(2026-07-15, 两起故障"进程死了没人拉"放大成全线故障)
#
# 顺序(Bettor #lqtxe6 GREEN-with-notes 折入): kaspad-watchdog(拉起kaspad) → 等RPC ready(超时5min)
#   → tn12-mining-watchdog(现成不动) → kanet-start.sh(全栈, 显式Git-Bash绝对路径) → console-supervisor.sh(显式起, 不假设side-effect)
#
# 🔴 note②(Bettor#lqtxe6.1): bash 若走 PATH 解析可能命中 C:\WINDOWS\system32\bash.exe(WSL存根, 完全不是
#   Git-Bash, 实测坐实此机确有此坑)——本脚本全程用 Git-Bash 绝对路径, 禁裸 `bash` 命令。
# 🔴 note③(Bettor#lqtxe6.1): console-supervisor 今天被发现死了多日无人知——本脚本不假设 kanet-start.sh
#   会"顺带"起它(旧 memory 声称的 side-effect, 7/15 实测已推翻: 跑完 kanet-start.sh 后 supervisor 依然
#   dead), 显式单独起一条。supervisor 自身"启动后中途静默死亡"不在本卡范围内, 另立卡跟踪(见频道)。
# 🔴 本脚本只负责"开机把该起的都起来", 不做运行期健康监控/不杀任何进程——运行期监控是各 watchdog/
#   supervisor 自己的职责, 边界不重叠。
#
# 注册为 Windows Task Scheduler "At startup" 触发的任务, 用此脚本作为 Action(见频道设计稿④验证分级:
# 先手动 Run Now 测链路, 真开机自动触发留给下一次自然重启终验, 终验前禁称"自启动已上线")。

$GitBash = "C:\Program Files\Git\bin\bash.exe"
$KanetRoot = "D:\kanet-tn12"
$blog = "D:\kanet-tn12\logs\boot-sequence.log"
function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Out-File $blog -Append -Encoding UTF8 }

# 建议④(Bettor 升级同待遇): Start-Process 只记录了"意图"不代表实的启动成功(路径错会静默failed,
# 脚本会照样往下走+日志照样写着starting)。每次调用后检查返回的进程对象, 拿不到就LOUD报错。
function Start-Watched($filePath, $argList, $label, $extraParams = @{}) {
  try {
    $proc = Start-Process -FilePath $filePath -ArgumentList $argList -WindowStyle Hidden -PassThru @extraParams -ErrorAction Stop
    if ($proc -and $proc.Id) {
      Log "${label}: dispatched OK, PID=$($proc.Id)"
      return $proc
    } else {
      Log "${label}: FAILED — Start-Process returned no process object"
      return $null
    }
  } catch {
    Log "${label}: FAILED — $($_.Exception.Message)"
    return $null
  }
}

# 同 MUST-FIX①(kaspad-watchdog 那条)一样的覆盖写坑, 这里的重定向日志也适用——重复触发本脚本
# (多次 Run Now / 多次自然重启)会互相冲掉彼此的 kanet-start/supervisor 启动日志, 归档后再写。
function Archive-IfExists($path) {
  if (Test-Path $path) {
    $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
    Rename-Item -Path $path -NewName "$(Split-Path $path -Leaf).$ts" -Force
  }
}

New-Item -ItemType Directory -Force -Path "D:\kanet-tn12\logs" | Out-Null
Log "=== boot sequence start ==="

# 守卫辅助函数(Bettor #lrgvk7.1, 折入自 KANet-UI 读码发现: kanet-start.sh 对 :3200 无端口占用检测,
# 硬起会 EADDRINUSE 崩 + pidfile 被覆盖留 debris, 不是干净 no-op)。
# 🔴 收窄说明(频道待 Bettor 确认, 暂按此版本实现): 没有挂在整个脚本开头整体 early-exit——今天第二起
# 故障(kaspad 裸死)那种"console 还活着但 kaspad 死了"场景下, 整体早退会连①kaspad-watchdog这步也跳过,
# 正好错过它最该管的场景。①②③⑤各自已有独立幂等检查(watchdog识别进程活着不重复拉/
# console-supervisor.sh start 有 pidfile+kill -0 检查), 只有④kanet-start.sh 真的没有自保护, 守卫只挡这一步。
function Test-ConsoleAlive {
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:3200/" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop | Out-Null
    return $true
  } catch { return $false }
}

# ① kaspad watchdog(detached, 常驻; 它自己会在第一个60s tick内发现kaspad缺失并拉起)
Start-Watched "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "$KanetRoot\scripts\kaspad-watchdog.ps1") "kaspad-watchdog.ps1" | Out-Null

# ② 等 kaspad RPC ready(borsh端口17210 TCP探活, 超时5分钟——Bettor note④给的上限)
Log "waiting for kaspad RPC (127.0.0.1:17210), timeout 300s"
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  $tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port 17210 -WarningAction SilentlyContinue -InformationLevel Quiet
  if ($tcp) { $ready = $true; break }
  Start-Sleep -Seconds 5
}
if ($ready) { Log "kaspad RPC ready after $($i*5)s" } else { Log "WARN: kaspad RPC not ready after 300s timeout, proceeding anyway (mining/console will keep retrying)" }

# ③ 挖矿 watchdog(现成脚本不动, detached)
Start-Watched "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "D:\kaspa-tn12-mining\tn12-mining-watchdog.ps1") "tn12-mining-watchdog.ps1" | Out-Null

# ④ kanet-start.sh(全栈: console+relay+bridge stack; 显式Git-Bash绝对路径, 不走PATH裸 `bash`)
# 守卫: kanet-start.sh 本身对 :3200 无端口占用检测, 硬起会 EADDRINUSE 崩+pidfile 被覆盖留 debris。
# console 已活 = 跳过这一步(其余各步各自有独立幂等检查, 不受这个守卫影响)。
if (Test-ConsoleAlive) {
  Log "kanet-start.sh SKIPPED — :3200 already alive (kanet-start.sh has no port-guard of its own, avoid EADDRINUSE crash/debris)"
} else {
  $kanetStartOut = "D:\kanet-tn12\logs\boot-kanet-start-stdout.log"
  $kanetStartErr = "D:\kanet-tn12\logs\boot-kanet-start-stderr.log"
  Archive-IfExists $kanetStartOut
  Archive-IfExists $kanetStartErr
  $kanetStartExtra = @{ WorkingDirectory = $KanetRoot; RedirectStandardOutput = $kanetStartOut; RedirectStandardError = $kanetStartErr }
  Start-Watched $GitBash @("-lc", "cd '$KanetRoot' && ./kanet-start.sh") "kanet-start.sh" $kanetStartExtra | Out-Null
}

# ⑤ console-supervisor(显式起, 不假设 kanet-start.sh 会顺带起它——7/15 实测该假设不成立)
$supervisorOut = "D:\kanet-tn12\logs\boot-supervisor-start-stdout.log"
$supervisorErr = "D:\kanet-tn12\logs\boot-supervisor-start-stderr.log"
Archive-IfExists $supervisorOut
Archive-IfExists $supervisorErr
$supervisorExtra = @{ WorkingDirectory = $KanetRoot; RedirectStandardOutput = $supervisorOut; RedirectStandardError = $supervisorErr }
Start-Watched $GitBash @("-lc", "cd '$KanetRoot' && bash scripts/kanet-console-supervisor.sh start") "console-supervisor.sh" $supervisorExtra | Out-Null

Log "=== boot sequence dispatched all steps (this script now exits; watchdogs/supervisor/console keep running independently) ==="
