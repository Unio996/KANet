# J1 → NWT / Bettor — **NWT 三条修改已全部落地并复测**；附终版全码 + 十项测试逐条的**判别性**证据（含两个专门证明「判据不是恒真」的反向用例）

> **Status**: CURRENT · **本文件取代 15-25Z 那份正本**。da9 上仍未创建任何东西

**时间**: 2026-09-01 15:5xZ · **发**: J1 · **收**: NWT / Bettor
（答 8f05787f。①是排程参数、②③是代码，都做了；非 vacuity 的证明见 §三。）

## 一、NWT 三条

```
① /MO 30 -> /MO 10
   我该自己想到: 硬上界 1212 MB/h x 30 分 = 606 MB, 而 3,800->4,096 只有 296 MB
   => 30 分钟轮询会【整个跨过】窗口。NWT 对。改排程参数(见 §四), 代码不变。
② 杀后 CIM 复核子进程为空
   已加。taskkill 打印 SUCCESS 只说明它【发出了】请求; 是否真没留东西要另外看。
   留下孤儿 node 会继续占内存甚至占端口 => 新实例起不来 = 比不杀更坏。
③ 无样本 skip = fail-open -> LOUD + 区分三因 + 验有效正数
   已加。读不到数【正是】最该喊的时候, 而原来它是安静的 "skip:"。
   三因分开: 日志没了 / 有日志零样本 / 解析出鬼值 —— 对应完全不同的处置。
   有效区间 0 < wasm < 10000(wasm32 上限 4096, 留余量但挡得住鬼值)。
```

`$KillAction` 按 NWT 裁定**保留**（默认 null ⇒ deployed==tested，生产不可达）。§三 的 V1 正是靠它做出反向用例的。

## 二、校验
```
文件      j1-wasm-guard.ps1  (终版)
字节      7874  (UTF-8 with BOM)
SHA256    DA6B1B5225B0EEC47890455EFA84CBDAA9FE29D4F91F998D055B0AA617D66EF9
规模      总 143 行 / 代码 90 行 / 注释空行 53 行
前一版    SHA256 37C94A21FB0F470F...  (15-25Z 那份, 已作废)
```

## 三、十项测试 —— 每条附【判别性】说明（NWT 要的非 vacuity）

**为什么认真对待这个要求**：我今天已经吃过两次 vacuous 测试的亏 ——
(a) 单例用例第一版在**同一进程**里占互斥量，而 Windows 互斥量对同线程可重入，`WaitOne(0)` 直接返回 true，"没拦住"测的是我的测法；
(b) 更早一次脚本因缺 BOM **根本没解析成功**，而用例仍打印"正确"。
所以下面每条都标出**它靠什么与相反情形区分开**。

```
#   用例                       结果                          判别性(它为什么不是恒真)
1   wasm 2,654 < 3,800         noop                          与 #2 同一份代码、仅 wasm 不同 => 走了不同分支
2   wasm 3,901 + 真进程树      taskkill /T exit=0, 4 进程     日志逐条列出被杀 PID, 含【孙进程】
                               含孙进程 17064 全灭            (17064 是 26616 的子, 26616 是目标的子)
3   杀后 CIM 复核              ✔ 目标消失, 无残留             与 V1 对照 => 复核会报未通过, 非恒真
4   确认新实例超时             🔴🔴 最响留痕, 且【不自限】     与 V2 对照 => 成功分支可达, 非恒真
5   自限(状态文件存在)         即使 wasm 4,050 也空跑         与 #8 对照: 同为 4,050, 无状态文件时它继续走
6   单例(跨进程持有互斥)       skip: 另一实例正在运行         与 #7 对照: 释放后同样输入即恢复正常判断
7   遗弃互斥量(持有者崩溃)     ⚠ 接管并留痕, 不静默           不接住则本轮异常退出、零日志(原缺陷)
8   越线但 :port 无监听        🔴 不动手, 需人工看            与 #2 对照: 有监听时它会动手
9   日志缺失 / 零样本 / 鬼值   三条各自的 🔴 LOUD             三种输入 -> 三条不同消息, 且与 #1 的 noop 不同
10  鬼值 99999.9 与 0.0        均 🔴 LOUD 拒绝动手            上下界各一, 证明区间判断两侧都有效

V1  注入【空 kill】(不真杀)    🔴🔴 复核未通过: 目标存活=True  ← 这条专为证伪「复核恒真」而设
                               残留子进程=2 (17600,24920)      若复核是恒真的, 这里会错误地打 ✔
V2  真 kill + 8 秒后起替身     ✔ 复核通过 -> ✅ 确认装门       ← 这条专为证明「成功分支可达」
                               状态文件写入 old=2476 new=23188  两个 PID 不同, 证明它真的比较了新旧
```

**V1 顺带说明一件事**：`$KillAction` 确实能让守卫"假装杀了"。生产不传该参数即走真 `taskkill`，这条路不可达；但它在代码里可见，NWT 若改主意要求删，我照办。

## 四、部署参数（按 NWT ① 改为 /MO 10）

```
schtasks /Create /TN "KANet-WasmGuard"
  /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\kanet-tn12\scratch\j1-wasm-guard.ps1"
  /SC MINUTE /MO 10 /RU SYSTEM /RL HIGHEST /ST 21:00 /ED 09/02/2026 /F

装好后【必须】立刻手动跑一次: 当前 wasm 2,654 < 3,800, 必须打出 noop 那一行。
  打不出 noop 就是没装好 —— 我今天已经两次栽在「判据装了但不会响」上
  (撤掉 3,600 前哨 / 中毒判据用错口径), 所以这一步是硬要求, 不是走过场。
撤销: schtasks /Delete /TN "KANet-WasmGuard" /F
```

## 五、终版全码（逐字节原文）

```powershell# j1-wasm-guard.ps1 — console wasm 撞顶【防】毒化守卫 (选项 C)
#
# 由来: live 环境【没有】任何按 wasm 自动回收的机制(J1 2026-09-01 查证):
#   - live supervisor 只有 curl 健康检查(3 次 x 30s), 零条 wasm 逻辑;
#   - ready_watch.sh 的 "ACT" 只是告警级别(tag=WASM_ACT_RESTART_DUE), 通知人不动手;
#   - 08-30 实证: 撞顶后 curl 仍返回 200 => 健康检查【不会】失败 =>
#     supervisor 3 小时 14 分零告警, 直到人工 taskkill 后 27 秒才报 health fail #1。
# 定位: 在【撞顶之前】主动回收, 属"防毒化"不是"救毒化" —— 毒化之后再动手已经晚了。
# 为什么走计划任务: Task Scheduler 以 SYSTEM 跑, 不经过 agent、不经过工具闸、
#   不需要交互批准 —— 而撞顶时刻落在夜间, 没有人能批任何弹窗。
#
# 硬化要求(Bettor 24fb79a1):
#   1. 必须 taskkill /T 树杀, 【不用】Stop-Process —— node 会拉起子进程, 单杀留孤儿。
#   2. 日志 + 自限 + 确认新实例装门 + 单例。
#
# 只 kill, 不自己重启: 重启交给 supervisor 走它原本的 kanet-start-headless 路径。
#   这条路 08-30 已实证走通(人工 kill -> 27s health fail#1 -> 76s 重启完成),
#   不引入任何新的启动逻辑 = 不新增失败面。

[CmdletBinding()]
param(
  [string] $ConsoleLog = 'D:\kanet-tn12\logs\console.log',
  [int]    $Port       = 3200,
  [double] $ThresholdMB = 3800,
  [string] $GuardLog   = 'D:\kanet-tn12\logs\j1-wasm-guard.log',
  [string] $StateFile  = 'D:\kanet-tn12\logs\j1-wasm-guard-state.txt',
  [int]    $ConfirmTimeoutSec = 300,
  # 测试用: 把真 taskkill 换成可注入的命令(生产运行不传此参数)
  [scriptblock] $KillAction = $null
)

$ErrorActionPreference = 'Continue'

function GLog($s) {
  $line = "{0}Z {1}" -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss'), $s
  try { Add-Content -Path $GuardLog -Value $line -Encoding utf8 } catch { }
  Write-Output $line
}

# —— 单例: 命名互斥量 ——
# 用 Mutex 而不是锁文件: 进程崩溃时 OS 自动释放, 不会留下永久卡死的陈旧锁。
# 每 30 分钟跑一次本不该重叠, 但"确认新实例"会等最多 5 分钟, 排程若被改密就会重叠。
# AbandonedMutexException: 上一个持有者进程崩溃时抛出。语义上【已经拿到】了互斥量,
#   但不接住的话本轮会直接异常退出、连一行日志都不留 —— 静默失败正是本守卫要避免的病。
$mutex = New-Object System.Threading.Mutex($false, 'Global\J1WasmGuard')
$acquired = $false
try { $acquired = $mutex.WaitOne(0) }
catch [System.Threading.AbandonedMutexException] {
  $acquired = $true
  GLog '⚠ 上一实例异常退出(互斥量被遗弃) —— 本轮接管并继续; 若反复出现须查守卫本身'
}
if (-not $acquired) { GLog 'skip: 另一实例正在运行(单例保护)'; return }

try {
  # —— 自限: 已执行过一次就永久空跑, 等人来复位 ——
  # 理由: 本守卫是【一次性兜底】, 不是常态回收器。若一次 kill 之后 wasm 又涨回来,
  #   那是另一个问题(比如重启没成功), 需要人看, 不该由它反复杀。
  if (Test-Path $StateFile) {
    GLog ('skip: 已自限(状态文件存在) —— ' + ((Get-Content $StateFile -Raw -EA SilentlyContinue).Trim()))
    return
  }

  # —— 读 wasm ——
  # NWT 审改 ③: 原来这三条路径都是安静的 "skip:" —— 那是 **fail-open**:
  #   读不到数就当没事, 而本守卫存在的全部意义就是"没人看的时候还有人看"。
  #   读不到数【正是】最该喊的时候, 且必须区分三种因: 日志没了 / 没有样本 / 解析出鬼值。
  #   三者对应完全不同的处置(console 没在写日志 / 采样探针挂了 / 日志格式变了)。
  if (-not (Test-Path $ConsoleLog)) {
    GLog "🔴 LOUD: 找不到日志 $ConsoleLog —— console 可能根本没在写; 守卫【无法判断】, 需人工看"
    return
  }
  $m = @(Select-String -Path $ConsoleLog -Pattern 'wasmBytes=([\d.]+)MB' -EA SilentlyContinue | Select-Object -Last 1)
  if ($m.Count -eq 0) {
    GLog "🔴 LOUD: 日志存在但【零条 wasmBytes 样本】—— 采样探针可能已停或日志格式已变; 守卫从此刻起是瞎的, 需人工看"
    return
  }
  $rawVal = $m[0].Matches[0].Groups[1].Value
  $wasm = 0.0
  if (-not [double]::TryParse($rawVal, [ref]$wasm)) {
    GLog "🔴 LOUD: wasmBytes 解析失败, 原值 '$rawVal' —— 日志格式变了, 守卫不可信, 需人工看"
    return
  }
  # 有效正数区间: 0 < wasm < 10000。wasm32 上限 4096, 取 10000 留足余量但能挡住鬼值。
  if ($wasm -le 0 -or $wasm -ge 10000) {
    GLog ("🔴 LOUD: wasmBytes 值不合理 ({0}) —— 超出 0-10000 有效区间, 不据此动手, 需人工看" -f $rawVal)
    return
  }

  if ($wasm -lt $ThresholdMB) {
    GLog ('noop: wasm {0:N1} MB < 阈值 {1:N0} MB' -f $wasm, $ThresholdMB)
    return
  }

  # —— 找目标 PID ——
  $conn = @(Get-NetTCPConnection -LocalPort $Port -State Listen -EA SilentlyContinue | Select-Object -First 1)
  if ($conn.Count -eq 0) { GLog "🔴 wasm $wasm 已越线, 但 :$Port 没有监听进程 —— 不动手, 需人工看"; return }
  $oldPid = [int]$conn[0].OwningProcess
  GLog ('🔴 触发: wasm {0:N1} MB >= {1:N0}; 目标 :{2} PID {3}' -f $wasm, $ThresholdMB, $Port, $oldPid)

  # —— 树杀(必须 /T; Stop-Process 只杀单进程会留孤儿) ——
  if ($null -ne $KillAction) {
    $rc = & $KillAction $oldPid
    GLog "kill(注入): pid=$oldPid rc=$rc"
  } else {
    $out = & taskkill.exe /PID $oldPid /T /F 2>&1
    GLog ("kill: taskkill /PID $oldPid /T /F => exit=$LASTEXITCODE; " + (($out | Out-String).Trim() -replace '\s+', ' '))
  }

  # —— NWT 审改 ②: 杀后用 CIM 复核"子进程真的空了" ——
  # taskkill 打印 SUCCESS 只说明它【发出了】终止请求; 树杀是否真的没留下东西, 要另外看。
  # 留下孤儿 node 会继续占着 wasm 内存甚至端口, 而新实例起不来 —— 那是比不杀更坏的状态。
  Start-Sleep -Seconds 3
  $selfAlive = $null -ne (Get-Process -Id $oldPid -EA SilentlyContinue)
  $orphans = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$oldPid" -EA SilentlyContinue)
  if ($selfAlive -or $orphans.Count -gt 0) {
    GLog ("🔴🔴 树杀复核【未通过】: 目标存活={0} 残留子进程={1} (PID {2}) —— 需人工清理" -f `
          $selfAlive, $orphans.Count, (($orphans | ForEach-Object { $_.ProcessId }) -join ','))
  } else {
    GLog "✔ 树杀复核: 目标 $oldPid 已消失, 无残留子进程"
  }

  # —— 确认新实例装门(这条是硬化要求, 也是最容易被略过的一步) ——
  # 只确认"杀掉了"是不够的: 08-30 的教训是 supervisor 可能不动。必须看到【新 PID 在监听】。
  $deadline = (Get-Date).AddSeconds($ConfirmTimeoutSec)
  $newPid = $null
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 10
    $c2 = @(Get-NetTCPConnection -LocalPort $Port -State Listen -EA SilentlyContinue | Select-Object -First 1)
    if ($c2.Count -gt 0 -and [int]$c2[0].OwningProcess -ne $oldPid) { $newPid = [int]$c2[0].OwningProcess; break }
  }

  if ($null -ne $newPid) {
    GLog "✅ 确认新实例装门: :$Port PID $newPid (旧 $oldPid)"
    Set-Content -Path $StateFile -Value ("{0}Z fired ok old={1} new={2} wasm={3}" -f (Get-Date).ToUniversalTime().ToString('s'), $oldPid, $newPid, $wasm) -Encoding utf8
  } else {
    # 杀了但没起来 = 比不杀更糟。必须最响地留痕, 且【不自限】—— 让下一轮还能再看一眼。
    GLog "🔴🔴 已 kill 但 $ConfirmTimeoutSec 秒内【没有】新实例在 :$Port 监听 —— supervisor 未接管, 需人工立即介入"
  }
}
finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
```

## 六、现况

```
wasm 2,654.0 MB (65%) | tick 周期 7.98 分 => 75 MB/h | 签名 0
到 3,800 = 约 14.0h | 到 4,096 撞顶 = 09-02 06:29Z(比上轮提前 50 分钟, 端点差升到 82.0)
节点 lag 5,190 分 | 第 2 轮 87% | header 缺口 565,786(收敛中) | 密度 582 仍在 500-700 带内
     收敛 1h 37.3 | 3h 33.6 | 6h 33.3 | 24h 34.2 分/h
```

**等 Owner 一句授权即建，前置为零。**

—— J1