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

$kaspadExe = "D:\kaspad-live\db-4d0a9e30\kaspad.exe"   # D-b exe (sha256 2432C36B...361A95 · Owner 2026-09-05 07:45Z 切换 · 规则 ledger 863/875: 独立子目录分版本、文件名必须仍是 kaspad.exe(判活键 :144) · 回滚 D:\kaspad-live\da-1b3046fb\kaspad.exe sha B73F1415...D5534A 同参数 · P2 flag 见 :47)
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
$kaspadArgs = "--testnet --netsuffix=12 --appdir=D:/kaspa-tn12-data --utxoindex --rpclisten-borsh=127.0.0.1:17210 --enable-unsynced-mining --ram-scale=3.0 --rocksdb-cache-size=8192"
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

# 🔴🔴 判据换法 (KANet-UI 2026-07-30 · Bettor #7a423c 二审通过+批准四必改 · 走铁律0 报备→审→批→测):
#   旧判据 = 进程名 + CommandLine 含 netsuffix=12。它两机两形态坏(needs-change 台账 R5 + scratch/watchdog-fix/):
#     · 模式A(本机): 运行中 kaspad 的 CommandLine 长度=0(实测·07-26 已量·07-30 重测一致)⇒ -like 恒不命中
#         ⇒ 永远判 DEAD ⇒ 每 60s 空拉(撞数据目录锁 panic 秒死·18074 次假 DEAD·真 DEAD 与它逐字不可分)。
#     · 模式B(另一台): 对照臂节点 CommandLine 命中 netsuffix=12 ⇒ 多一个匹配 ⇒ 假"活" ⇒ 真节点死不拉(闸关着)。
#   新判据 = 问节点 borsh RPC 答不答(node helper kaspad-rpc-probe.mjs):
#     · network === 'testnet-12'  ← 身份·承重(实测: 用错 networkId 构造 RpcClient 照样连上照样答 ⇒ 连上≠是TN12
#         ⇒ 必须查此字段。此字段亦顶替原 netsuffix=12 那个 TN10/TN12 区分意图, 且不依赖 CommandLine 可读性)。
#     · virtualDaaScore > 0        ← 数据真回来(不是"口通数据没回")。
$probeScript = Join-Path $PSScriptRoot 'kaspad-rpc-probe.mjs'
$FAIL_THRESHOLD = 3   # N 次连续失败才判 DEAD(防一次瞬时抖动/RPC 忙就拉一个竞争进程)
$script:failCount = 0

# === v0.4 三态 + crash-loop 刹车 (D-013 §3, KANet-UI 落码; 未启用=任务保持 Disabled) ===
# 刹车常量照 scripts/kanet-console-supervisor.sh:30-32 (RESTART_WINDOW_SEC=300 / MAX=5 / COOLDOWN=1800), env 可覆盖
$MAX_RESTARTS       = if ($env:KASPAD_WATCHDOG_MAX_RESTARTS)       { [int]$env:KASPAD_WATCHDOG_MAX_RESTARTS }       else { 5 }
$RESTART_WINDOW_SEC = if ($env:KASPAD_WATCHDOG_RESTART_WINDOW_SEC) { [int]$env:KASPAD_WATCHDOG_RESTART_WINDOW_SEC } else { 300 }
$COOLDOWN_SEC       = if ($env:KASPAD_WATCHDOG_COOLDOWN_SEC)       { [int]$env:KASPAD_WATCHDOG_COOLDOWN_SEC }       else { 1800 }
$stateFile = if ($env:KASPAD_WATCHDOG_STATE) { $env:KASPAD_WATCHDOG_STATE } else { "D:\kaspa-tn12-data\kaspad-watchdog-state.json" }
$restartAttempts = @()      # 独立于 failCount 的刹车计数 (MUST3): [ @{ ts=[datetime]; pid=[int] } ]
$cooldownUntil = $null      # crash-loop 触发后的冷却截止
$script:stateReadFailStreak = 0    # 连续状态读失败 (C: >=3 LOUD)

# state 文件读写 (JSON). ASCII-only log strings.
function Load-WatchdogState {
  try { if (Test-Path $stateFile) { return (Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json) } } catch {}
  return $null
}
function Save-WatchdogState($obj) {
  try { $obj | ConvertTo-Json -Compress | Out-File $stateFile -Encoding UTF8; return $true } catch { return $false }
}
function Prune-RestartAttempts {
  $cut = (Get-Date).AddSeconds(-1 * $RESTART_WINDOW_SEC)
  $script:restartAttempts = @($script:restartAttempts | Where-Object { $_.ts -gt $cut })
}
function In-Cooldown {
  return ($null -ne $script:cooldownUntil -and (Get-Date) -lt $script:cooldownUntil)
}
function Try-BroadcastChannel($msg) {
  # crash-loop LOUD alert: 频道(console chat send)可用则发, 不可用吞掉不阻塞. relay id 从 env(可选).
  try {
    if ($env:KASPAD_WATCHDOG_ALERT_RELAY) {
      $body = @{ relayId = $env:KASPAD_WATCHDOG_ALERT_RELAY; channel = 'dev-coord'; message = $msg } | ConvertTo-Json -Compress
      Invoke-RestMethod -Uri 'http://127.0.0.1:3200/api/chat/send' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 3 | Out-Null
    }
  } catch {}
}

# 返回 @{Alive=$bool; Verdict=$str; Code=$int; Reason=$str}。helper 自带硬超时(TIMEOUT_MS*2)
# ⇒ & node 必在 ~17s 内返回, 不挂。
# 退码分开(Bettor 08:56 要求·别塌成一个"失败"): 0=ALIVE / 2=身份不符 / 3=数据空 / 4=超时 / 5=连不上 / 6=依赖缺失 / 1=其它。
#
# 🔴🔴 MUST-FIX(J1tn 2026-08-10 只读实测坐实, 移交本域): 旧写法 `Alive = ($code -eq 0)` 把"探针自己
# 崩了"和"探针查出节点真的连不上"塌成同一个"失败"——8.4 天日志里 2,383 次 FAIL 中 1,799 次(75.5%)
# 是 node 子进程自己被 Windows 结构化异常杀死(`code=-1073740791`, libuv 断言 `!(handle->flags &
# UV_HANDLE_CLOSING)`, 与 kaspad 是死是活无关), 只是被"只启不杀"哲学(数据目录锁挡着二次拉起)兜住
# 没出事, 不代表判据是对的。
# 隔壁 tn12-mining-watchdog-v2.ps1 对同一类问题的处理已经是团队认定的正确写法(DAG 探针 `ok:false` /
# `$null -eq $tips` ⇒ UNKNOWN != bad, 维持原样、不当证据用)——本次照抄同一分类, 不是发明新判据:
#   Verdict=Alive  : code=0(探针连上+身份对+数据真, 见 kaspad-rpc-probe.mjs 注释)
#   Verdict=Fail   : code∈{2,3,4,5} —— 探针成功探测到具体问题(身份不符/数据空/超时/连不上), 这是
#                    探针"做出了判断"的四种失败, 计入 DEAD 判据(原意图不变)。
#   Verdict=Unknown: 其余一切(含 code=6/依赖缺失——探针自己脚注写着"探测器自身坏,不是节点坏";
#                    code=1/其它异常——探针自己的兜底 catch, 不携带具体节点状态信息;以及任何不在
#                    探针自身声明退码集合 {0,1,2,3,4,5,6} 里的值——包括 PowerShell 侧 invoke 失败的
#                    -1, 和这次坐实的原生崩溃退码)。UNKNOWN 不计入、也不清零 $script:failCount——我们对
#                    节点状态没有任何新证据, 计数器该停在原地, 既不该被一次探针自己的崩溃拉去重启,
#                    也不该让它悄悄清空一个已经在累积的真实劣化信号。
# v0.4 MUST4: verdict 映射抽成顶层函数 (Probe-Tn12Node + VA harness 共用同一真函数, 非镜像)
# === enable-va TESTMODE (NWT 甲+ADD): 4 test-only hook 同一 KASPAD_WATCHDOG_TESTMODE=1 门控 ===
# 🔴 生产【绝不】设此 env(任务 XML/生产启动路径不设); enable-time 前置断言 TESTMODE unset(D-013 §3)。
# 承重(ADD): spawn 覆盖抬高 blast-radius(生产误开=永远起哑进程=kaspad 永不重启静默 broken) => STARTUP LOUD-warn。
$TESTMODE = ($env:KASPAD_WATCHDOG_TESTMODE -eq '1')
$_testHookVals = @($env:KASPAD_WATCHDOG_PROCNAME, $env:KASPAD_WATCHDOG_PROBE_MOCK, $env:KASPAD_WATCHDOG_SPAWN_CMD, $env:KASPAD_WATCHDOG_MAX_TICKS) | Where-Object { $_ }
if (-not $TESTMODE -and $_testHookVals.Count -gt 0) {
  Log "ignored test env: KASPAD_WATCHDOG_* test hook(s) set but TESTMODE!=1 -- ALL IGNORED (production behavior)"
  Write-Warning "kaspad-watchdog: ignored test env (TESTMODE off)"
}
# procname(进程闸) / spawn 目标 / MAX_TICKS / mock 码: 仅 TESTMODE 下可覆盖, 否则真值(负向量已在上: SPAWN_CMD without TESTMODE => 真 kaspad + LOUD ignored)
$procName  = if ($TESTMODE -and $env:KASPAD_WATCHDOG_PROCNAME) { $env:KASPAD_WATCHDOG_PROCNAME } else { 'kaspad.exe' }
$MAX_TICKS = if ($TESTMODE -and $env:KASPAD_WATCHDOG_MAX_TICKS) { [int]$env:KASPAD_WATCHDOG_MAX_TICKS } else { 0 }
$spawnExe  = $kaspadExe
$spawnArgs = $kaspadArgs
if ($TESTMODE -and $env:KASPAD_WATCHDOG_SPAWN_CMD) {
  # 形: "<full-exe-path>|<args>"(test 提供全路径便于 Split-Path WorkingDirectory)
  $_sp = $env:KASPAD_WATCHDOG_SPAWN_CMD -split '\|', 2
  $spawnExe  = $_sp[0]
  $spawnArgs = if ($_sp.Count -gt 1) { $_sp[1] } else { '' }
}
$script:_mockCodes = if ($TESTMODE -and $env:KASPAD_WATCHDOG_PROBE_MOCK) { @($env:KASPAD_WATCHDOG_PROBE_MOCK -split ',' | ForEach-Object { [int]$_.Trim() }) } else { @() }
$script:_mockIdx = 0
$spawnStdout = $stdoutLog
$spawnStderr = $stderrLog
if ($TESTMODE) {
  # TESTMODE spawn 绝不碰真 kaspad 日志(被真 kaspad 锁; archive 会扰真节点) => 走 TEMP
  $spawnStdout = Join-Path $env:TEMP 'wd-testmode-stdout.log'
  $spawnStderr = Join-Path $env:TEMP 'wd-testmode-stderr.log'
}
if ($TESTMODE) {
  $m = "!!!!! kaspad-watchdog TESTMODE ACTIVE -- spawn redirected to '$spawnExe', NOT protecting kaspad !!!!!"
  Log $m; Write-Warning $m
}

# probe 包装: TESTMODE mock 码序(顺序取, 越界取末位) / 否则真 probe. Get-Verdict 运行时解析(定义在后, PS 调用时才绑定)
function Get-ProbeResult {
  if ($TESTMODE -and $script:_mockCodes.Count -gt 0) {
    $code = if ($script:_mockIdx -lt $script:_mockCodes.Count) { $script:_mockCodes[$script:_mockIdx] } else { $script:_mockCodes[-1] }
    $script:_mockIdx++
    return @{ Alive = ($code -eq 0); Verdict = (Get-Verdict $code); Code = $code; Reason = "MOCK code=$code" }
  }
  return Probe-Tn12Node
}

function Get-Verdict($code) {
  if     ($code -eq 0)     { return 'Alive' }    # HEALTHY: isSynced=true 且 daa>0
  elseif ($code -eq 7)     { return 'Syncing' }  # IBD 中: failCount=0, 不重启
  elseif ($code -eq 8)     { return 'Stalled' }  # 卡: 只告警, 不重启
  elseif ($code -eq 9)     { return 'Dead' }     # no-process(probe 侧): 真死候选
  elseif ($code -in 2,4,5) { return 'Fail' }     # 身份不符/超时/连不上: 真问题, 重启候选
  elseif ($code -eq 3)     { return 'Fail' }     # 收窄: isSynced 真但 daa 坏 = 非-daa 数据空(罕见)
  else                     { return 'Unknown' }  # code 6/-1/其它探针自身坏; 7/8/9 绝不落这里
}

# v0.4 enable-gate (NWT GO): 自/外重启判别 + 刹车-keep 决策抽纯函数 (VA-5/8/8b/8c/8d 单测真函数, 非内联)
# 承重(NWT 必钉): cd-null 分支【必须】排在 (PID,CD) 元组比较之前显式 return 'fail-closed'(brake KEPT) --
#   否则 AND 因 null 侧假 => mine=false => fall through external => 清刹车 = fail-open 反向。
#   null-CD = "证据缺失 => 默认 self", 不是 "不匹配"。
# 输入: $curPid/$curCd(CIM 枚举, 可 null) / $st(状态对象或 null) / $stateReadOk(bool)
# 输出: @{ failCountReset; brakeReset; category='self'|'external'|'fail-closed'|'none' }
function Get-RestartDecision($curPid, $curCd, $st, $stateReadOk) {
  # 无证据: 状态读失败 => 不动任何计数, 刹车 KEPT (读失败=无证据, 非实例变; 同 (1) 原则)
  if (-not $stateReadOk -or $null -eq $st) {
    return @{ failCountReset = $false; brakeReset = $false; category = 'fail-closed' }
  }
  # 无当前进程 或 无 lastSeen 基线 => 无从判别实例变 => none
  if ($null -eq $curPid -or $null -eq $st.lastSeenPid) {
    return @{ failCountReset = $false; brakeReset = $false; category = 'none' }
  }
  # 实例是否变 (pid 或 cd 相对 lastSeen)
  $changed = ($curPid -ne $st.lastSeenPid) -or ("$curCd" -ne "$($st.lastSeenCreated)")
  if (-not $changed) {
    return @{ failCountReset = $false; brakeReset = $false; category = 'none' }
  }
  # === NWT 必钉: cd-null fail-closed 分支【在 (PID,CD) 元组比较之前】 ===
  # spawn 时 cd 取不到(lastSpawnCreationDate=null) + 同 pid => 证据缺失默认 self => 不动计数, brake KEPT (VA-8c)
  if ($null -eq $st.lastSpawnCreationDate -and $curPid -eq $st.lastSpawnPid) {
    return @{ failCountReset = $false; brakeReset = $false; category = 'fail-closed' }
  }
  # (PID,CD) 元组精确匹配 => 自重启 (清 failCount, brake KEPT)
  $mine = ($curPid -eq $st.lastSpawnPid -and "$curCd" -eq "$($st.lastSpawnCreationDate)")
  if ($mine) {
    return @{ failCountReset = $true; brakeReset = $false; category = 'self' }
  }
  # 否则外部重启 (清 failCount + 刹车归零)
  return @{ failCountReset = $true; brakeReset = $true; category = 'external' }
}

function Probe-Tn12Node {
  try {
    $out = & node $probeScript '--timeout-ms=8000' 2>&1
    $code = $LASTEXITCODE
    $reason = "$($out | Select-Object -Last 1)"
    $verdict = Get-Verdict $code
    return @{ Alive = ($verdict -eq 'Alive'); Verdict = $verdict; Code = $code; Reason = $reason }
  } catch {
    return @{ Alive = $false; Verdict = 'Unknown'; Code = -1; Reason = "probe-invoke-error: $($_.Exception.Message)" }
  }
}

function Invoke-WatchdogTick {
  if ($TESTMODE) { Log "TESTMODE tick (mockIdx=$($script:_mockIdx))" }
  try {
    # === §3c: L1 进程闸 + 自/外重启判别 (进 verdict 前) ===
    $cur = $null
    try { $cur = Get-CimInstance Win32_Process -Filter "Name='$procName'" -ErrorAction Stop | Select-Object -First 1 } catch { $cur = $null }
    $st = Load-WatchdogState
    if ($null -eq $st) { $script:stateReadFailStreak++ } else { $script:stateReadFailStreak = 0 }
    # === §3c 自/外重启判别 (纯函数 Get-RestartDecision; 见 VA-5/8/8b/8c/8d) ===
    $curPid = if ($cur) { $cur.ProcessId } else { $null }
    $curCd  = if ($cur) { "$($cur.CreationDate)" } else { $null }
    $dec = Get-RestartDecision $curPid $curCd $st ($null -ne $st)
    if ($dec.failCountReset) { $script:failCount = 0 }
    if ($dec.brakeReset)     { $script:restartAttempts = @() }
    if ($dec.category -ne 'none') {
      Log "kaspad restart-decision: $($dec.category) (failCountReset=$($dec.failCountReset) brakeReset=$($dec.brakeReset)) pid=$curPid"
    }
    # fail-closed: 判别读不到(state 缺)=当自重启, 不清刹车(上面 mine 分支默认走不到=不清). 更新 lastSeen.
    $newSt = @{
      lastSpawnPid = $(if ($st) { $st.lastSpawnPid } else { $null })
      lastSpawnCreationDate = $(if ($st) { $st.lastSpawnCreationDate } else { $null })
      lastSeenPid = $(if ($cur) { $cur.ProcessId } else { $null })
      lastSeenCreated = $(if ($cur) { "$($cur.CreationDate)" } else { $null })
    }
    Save-WatchdogState $newSt | Out-Null
    if ($script:stateReadFailStreak -ge 3) {
      $m = "!!!!! kaspad-watchdog STATE UNREADABLE ${stateReadFailStreak}x !!!!! brake has no memory -> chain-restart risk, OPERATOR: inspect/rm $stateFile"
      Log $m; Write-Warning $m; Try-BroadcastChannel $m
    }

    $r = Get-ProbeResult
    # NWT: CIM $cur=null 自身【永不】升 Dead; verdict 一律按 probe 退码 (code9=>Dead / code6=>Unknown 冻结 / code0=>Alive).
    # CIM-null 且 probe 非 code9 => WMI/CIM 分歧告警 (RPC 应答=进程在, CIM 是坏的那个), 不强制 Unknown/Dead.
    if ($null -eq $cur -and $r.Code -ne 9) {
      # NWT 文案 nit: code6/-1 = 探针自坏没触 RPC => 不能说 "RPC says node present"; 按码分文案
      if ($r.Code -eq 6 -or $r.Code -eq -1) {
        Log "WMI/CIM note: Get-CimInstance kaspad.exe empty and probe code=$($r.Code) (probe self-fault, did not reach RPC) -- node presence undetermined; verdict follows probe ($($r.Verdict)), NO forced Dead"
      } else {
        Log "WMI/CIM divergence: Get-CimInstance kaspad.exe empty but probe code=$($r.Code) reached RPC -- RPC-side says node present, CIM likely broken; verdict follows probe ($($r.Verdict)), NO forced Dead"
      }
    }

    if ($r.Verdict -eq 'Alive') {
      $script:failCount = 0
    } elseif ($r.Verdict -eq 'Syncing') {
      $script:failCount = 0
      Log "kaspad SYNCING (IBD, isSynced=false, NO restart, failCount=0) code=$($r.Code): $($r.Reason)"
    } elseif ($r.Verdict -eq 'Stalled') {
      Log "kaspad SYNC-STALLED (>STALL_MS no progress, ALERT ONLY, NO restart) code=$($r.Code): $($r.Reason)"
    } elseif ($r.Verdict -eq 'Unknown') {
      # UNKNOWN != bad: 探针自身坏(code 6/-1), 对节点无证据 => failCount 不动(既不累加也不清零)
      Log "kaspad probe UNKNOWN (probe itself failed, no signal, failCount stays $script:failCount) code=$($r.Code): $($r.Reason)"
    } else {
      # Dead / Fail
      $script:failCount++
      Log "kaspad probe FAIL/DEAD ($script:failCount/$FAIL_THRESHOLD) code=$($r.Code): $($r.Reason)"
      if ($script:failCount -ge $FAIL_THRESHOLD) {
        # === MUST3 crash-loop 刹车 (独立于 failCount, 在 memgate 之前) ===
        Prune-RestartAttempts
        if ($script:restartAttempts.Count -ge $MAX_RESTARTS -or (In-Cooldown)) {
          if (-not (In-Cooldown)) { $script:cooldownUntil = (Get-Date).AddSeconds($COOLDOWN_SEC) }
          $marker = "!!!!! kaspad CRASH-LOOP DETECTED !!!!! restarts >= $MAX_RESTARTS in ${RESTART_WINDOW_SEC}s (or cooldown) -> STALLED-escalate, NO Start-Process, OPERATOR ACTION NEEDED"
          Log $marker; Write-Warning $marker; Try-BroadcastChannel $marker
        } else {
          # === memgate (v0.4 §0.5, 不动): 4x backoff 读 free commit, fail-closed skip ===
          $minGb = if ($env:KASPAD_MIN_FREE_COMMIT_GB) { [int]$env:KASPAD_MIN_FREE_COMMIT_GB } else { 8 }
          $freeGb = $null
          foreach ($w in @(0,2,5,10)) {
            if ($w -gt 0) { Start-Sleep -Seconds $w }
            try { $freeGb = [math]::Floor((Get-CimInstance Win32_OperatingSystem).FreeVirtualMemory / 1MB) } catch { $freeGb = $null }
            if ($null -ne $freeGb) { break }
          }
          if ($null -eq $freeGb) {
            Log "kaspad refuse-start:commit-unknown free=? (FreeVirtualMemory read failed, fail-closed skip, failCount kept)"
          } elseif ($freeGb -lt $minGb) {
            Log "kaspad refuse-start:low-commit free=${freeGb}GB < ${minGb}GB (memory gate skip, failCount kept)"
          } else {
            Log "kaspad DEAD (>=$FAIL_THRESHOLD fails) -> memgate ok free=${freeGb}GB, brake ok ($($script:restartAttempts.Count)/$MAX_RESTARTS), archiving logs + starting canonical (--enable-unsynced-mining)"
            if (-not $TESTMODE) { Archive-IfExists $spawnStdout; Archive-IfExists $spawnStderr }
            $spArgs = @{ FilePath = $spawnExe; ArgumentList = $spawnArgs; WorkingDirectory = (Split-Path $spawnExe); WindowStyle = 'Hidden'; PassThru = $true }
            if (-not $TESTMODE) { $spArgs.RedirectStandardOutput = $spawnStdout; $spArgs.RedirectStandardError = $spawnStderr }   # TESTMODE 不重定向(避哑进程日志锁)也不 archive 真日志
            $proc = Start-Process @spArgs
            # spawn 后取 cd: CIM 重试 x3 / 间隔 1s (WMI 瞬时坏韧性); 三次仍无 => cd=null => 判别走 fail-closed (VA-8c)
            $spawnedCd = $null
            foreach ($try in 1,2,3) {
              try { $c2 = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.Id)" -ErrorAction Stop; if ($c2 -and $c2.CreationDate) { $spawnedCd = "$($c2.CreationDate)"; break } } catch {}
              if ($try -lt 3) { Start-Sleep -Seconds 1 }
            }
            $script:restartAttempts += @{ ts = (Get-Date); pid = $proc.Id }   # 记入刹车 (MUST3)
            Save-WatchdogState @{ lastSpawnPid = $proc.Id; lastSpawnCreationDate = $spawnedCd; lastSeenPid = $proc.Id; lastSeenCreated = $spawnedCd } | Out-Null
            Log "Start-Process dispatched, new PID=$($proc.Id) cd=$spawnedCd (brake now $($script:restartAttempts.Count)/$MAX_RESTARTS)"
            Start-Sleep -Seconds $(if ($TESTMODE) { 1 } else { 8 })
            $c = Get-ProbeResult
            if ($c.Verdict -eq 'Alive' -or $c.Verdict -eq 'Syncing') { Log "post-start probe OK/SYNCING: $($c.Reason)" }
            else { Log "post-start probe still not-alive code=$($c.Code): $($c.Reason) (likely still starting / IBD)" }
            $script:failCount = 0
          }
        }
      }
    }
  } catch {
    # MUST-FIX2: 循环体任何异常绝不能让 watchdog 静默退出(那正是它要防的). 记日志继续.
    Log "WATCHDOG LOOP ERROR (caught, continuing): $($_.Exception.Message)"
  }
}

if (-not $env:KASPAD_WATCHDOG_NOLOOP) {  # NOLOOP=1 让 VA harness dot-source 只取函数不进循环; TESTMODE loop 见 MAX_TICKS
Log "kaspad watchdog started (RPC-liveness judge via kaspad-rpc-probe.mjs, --enable-unsynced-mining + log redirection non-optional, log-archive-on-restart, only-start-never-kill, try/catch loop)"
  $tickCount = 0
  while ($true) {
    Invoke-WatchdogTick
    $tickCount++
    if ($MAX_TICKS -gt 0 -and $tickCount -ge $MAX_TICKS) { Log "TESTMODE: reached MAX_TICKS=$MAX_TICKS, exiting loop"; break }
    Start-Sleep -Seconds 60
  }
}
