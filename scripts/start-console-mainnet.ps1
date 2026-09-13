# start-console-mainnet.ps1 — 主网 console 独立启动脚本（2026-09-13 · KANet-UI · GO-B 交付）
#
# 背景：主网 console/relay 起服务方案 `docs/2026-09-13-kanetui-mainnet-console-relay-startup-plan-v0.1.md`
#   §1.3（v0.3 MUST-FIX）——不碰 `kanet.env`、不经过 `kanet-start.sh`（那是 TN12 全栈编排脚本）。
#   本脚本是独立小型启动方式：读 `kanet.mainnet.env`，把值注入**这一个进程自己的环境**，起
#   `kasia-console/src/index.js` 单进程（不含 relay/scanner/bridge 等子系统——那些是否需要另起，
#   属于后续问题，本次 GO-C 范围只是"console 进程本身能不能干净地在主网上跑起来"）。
#
# 🔴 NWT 红队复核 `9ba20fb2`（`docs/2026-09-13-nwt-redteam-kanetui-mainnet-startup-plan-v0.3-review-v0.1.md`）
#   §二 点出的四项骨架缺口，本脚本逐条核对：
#   ① CONSOLE_ENCRYPTION_KEY —— 已在 kanet.mainnet.env 里，且是本次全新生成的 32 字节随机数
#      （node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"，即 index.js:111
#      自己错误提示里给的那条命令）。🔴🔴 **绝对不允许从 kanet.env 复制这个值过来**——跨网络复用
#      同一把加密密钥等于让本该独立的两个加密域共享钥匙，是真实安全风险，不是图省事的选项，
#      跟"不跨网络复用签名私钥"是同一条纪律（同起服务方案 §2.3）。缺失/格式不对时 index.js 会
#      fail-loud（`console.error` + `exit(1)`），不是静默安全洞，但"该用哪把"这件事本身必须做对。
#   ② DB_PATH —— kanet.mainnet.env 里已写**绝对路径**（`D:/kanet-tn12/kasia-console/data/
#      console.mainnet.db`），不用相对路径，绕开 `client.js` 的 `resolve()` 受脚本执行时 cwd
#      影响这个坑，不需要额外 `cd` 处理。
#   ③ 日志 —— 本脚本显式 stdout/stderr 分文件重定向（下方 -RedirectStandardOutput/-Error），
#      写到独立的 `logs\mainnet\` 目录，不跟 TN12 现有 `logs\` 混，防止重演"没重定向、关窗口就
#      丢日志"或"手动乱重定向堆爆 C 盘"两类既有事故（分见 kanet-start.sh 头注释 + CLAUDE.md
#      临时脚本铁律）。
#   ④ PID 文件 —— 非 MUST，NWT 建议，本脚本照做：起完把 PID 写进
#      `logs\mainnet\console-mainnet.pid`，方便以后手动停（本实例不接 supervisor，停需要手动
#      `Get-Process -Id (Get-Content logs\mainnet\console-mainnet.pid) | Stop-Process`）。
#
# 🔴 不做的事（刻意排除，非遗漏，见起服务方案 §1.3/§4）：
#   - 不接入 kaspad-watchdog.ps1 / kanet-boot-sequence.ps1（TN12 专属自启动链）
#   - 不改 kanet.env 任何一个字节
#   - 不碰 TN12 相关任何进程/数据
#   - 不需要管理员权限
#
# 用法：powershell -File scripts\start-console-mainnet.ps1
#   （从项目根 D:\kanet-tn12 跑，或脚本自己会 cd 过去，见下）

$ErrorActionPreference = 'Stop'

$KanetRoot = "D:\kanet-tn12"
$EnvFile = "$KanetRoot\kanet.mainnet.env"
$LogDir = "$KanetRoot\logs\mainnet"
$PidFile = "$LogDir\console-mainnet.pid"

if (-not (Test-Path $EnvFile)) {
  Write-Error "找不到 $EnvFile —— 先按 docs/2026-09-13-kanetui-mainnet-kanet-env-audit-v0.1.md 生成这个文件，本脚本不代为生成（生成动作本身含密钥，不该在这个脚本里静默发生）。"
  exit 2
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# 逐行注入 kanet.mainnet.env 到这个 PowerShell 会话自己的进程环境（不写任何系统级/用户级环境变量，
# 只在本会话及其子进程可见，脚本一退出这些值就没了——这是刻意的隔离方式，不需要额外清理步骤）。
Get-Content $EnvFile | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }  # 跳过注释行和空行
  if ($_ -match '^([^=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2], 'Process')
  }
}

# 起前核对（不是 MUST 但值得一起做）：确认关键变量真的注入进来了，缺了立刻停手，不要带着空值起
foreach ($k in @('KASPA_NETWORK', 'KASPA_RPC_URL', 'DB_PATH', 'PORT', 'KANET_ROOT', 'CONSOLE_ENCRYPTION_KEY')) {
  if (-not [Environment]::GetEnvironmentVariable($k, 'Process')) {
    Write-Error "关键变量 $k 没有从 $EnvFile 里注入成功，停手——不要带着缺失值起进程（尤其 CONSOLE_ENCRYPTION_KEY 缺失时 index.js 自己也会 exit(1)，但在那之前先自己查一遍更快）。"
    exit 2
  }
}
if ([Environment]::GetEnvironmentVariable('KASPA_NETWORK', 'Process') -ne 'mainnet') {
  Write-Error "KASPA_NETWORK 不是 mainnet（当前值: $([Environment]::GetEnvironmentVariable('KASPA_NETWORK','Process'))）——停手，这不该发生，检查 kanet.mainnet.env 内容。"
  exit 2
}

Write-Host "[start-console-mainnet] 环境变量已注入，KASPA_NETWORK=$([Environment]::GetEnvironmentVariable('KASPA_NETWORK','Process')) PORT=$([Environment]::GetEnvironmentVariable('PORT','Process')) DB_PATH=$([Environment]::GetEnvironmentVariable('DB_PATH','Process'))"

$proc = Start-Process -FilePath "node.exe" `
  -ArgumentList @("$KanetRoot\kasia-console\src\index.js") `
  -WorkingDirectory $KanetRoot `
  -RedirectStandardOutput "$LogDir\console-mainnet-stdout.log" `
  -RedirectStandardError "$LogDir\console-mainnet-stderr.log" `
  -WindowStyle Hidden -PassThru

if (-not $proc -or -not $proc.Id) {
  Write-Error "Start-Process 没有返回有效进程对象——起动可能静默失败，检查上面的路径是否对，不要假设它起来了。"
  exit 2
}

$proc.Id | Out-File $PidFile -Encoding ascii
Write-Host "[start-console-mainnet] 已起，PID=$($proc.Id)，写进 $PidFile"
Write-Host "[start-console-mainnet] 日志: $LogDir\console-mainnet-stdout.log / console-mainnet-stderr.log"
Write-Host "[start-console-mainnet] 停止命令: Get-Process -Id (Get-Content '$PidFile') | Stop-Process"
