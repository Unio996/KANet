# 设计稿：系统提交内存检测（memory-watch）v0.2 —— 宿主 = P2 常驻哨兵，不再是 console 模块

> **Status**: CURRENT
>
> 起草 KANet-UI · 2026-09-19 · 文件名沿用 `…console-memory-alert-design-v0.1.md`（账本已按此路径引用），**正文即 v0.2**；v0.1（console 内模块）的差异见下表。依据账本 **(1531)**（死机复盘 P3）、**(1532)**、**(1539)**（NWT 红队审全采纳）、**(1543)**（Bettor 已升 Owner、装 80/85/92% 监视）；NWT 红队审原文 `docs/provenance/2026-09-19-nwt-p2-p3-redteam/README.md`（`ba660ae0`）§四。实现草案**就是 P2 runbook 附录 A 脚本的一部分**（`docs/2026-09-19-kanetui-mainnet-boot-autostart-scheduled-task-runbook-v0.1.md`，正文即 v0.2），本页只写设计与验收判据。
>
> **执行门**：**只写设计**。落码 = P2 脚本 `scripts/mainnet-boot-sequence.ps1` 的 4.1（Bettor 批 → NWT 审 diff）——**不改 console 一行，不需要 console 重启**，所以不再受"并入下一次 console 重启"（原 M-5）约束。脚本的 `-WatchOnly` 模式使它**在计划任务注册前**就能在普通用户会话里跑起来（只检测告警、不起任何进程）——**在生产检出上跑需要 Bettor 明说**（会往 `logs\mainnet\boot\` 写日志与锁文件）。
>
> **写作依 D-021**：不含密钥、余额、地址；payload/日志里的进程只带**名字、PID、私有内存 GB**，**不带命令行**。

## v0.2 相对 v0.1 的改动（对照 NWT 红队审 §四）

| NWT 条目 | 处置 |
|---|---|
| ① 每 60 s `spawn powershell` 会在最坏时刻自己加压，且失败时刻恰是最需要读数的时刻；M-4"连续 3 次失败告警"不够 | **采纳修法 2 的强形式**：不再 spawn——采样是**哨兵 PowerShell 进程内**的 `Get-CimInstance`（in-process）+ `Get-Process`，"spawn 失败"这一失效模式**不存在**。in-process 采样仍可能失败：**内存耗尽类错误（`OutOfMemory`/`1455`/`not enough memory|storage`/`insufficient system resources`）首次出现即按压力证据处理**（Error 事件 9310，不等 3 次）；普通失败仍走"连续 3 次 ⇒ 9311" |
| ① 修法 3：告警**第一落点是 stdout/文件，不是 DB** | **采纳**：本设计**根本不碰 DB**；第一落点 = `memory-watch.log` 一行（**先于**事件日志）。⚠ **计划任务的 stdout 不被捕获**——"stdout 行"在这里落成**追加写的文件日志**，`-WatchOnly` 交互运行时同一行也 `Write-Host` 到终端 |
| ② 没有推送渠道前不算"预防"，应改称"检测 + 取证"；M-6 不能一直开放，至少一个具名消费者 | **采纳**：全文改称**检测与取证**；(1531) 的 P3 条目措辞应同步改（Bettor 的账本）。**M-6 具名消费者见 §5**（事件日志查询进 Bettor 接位读数清单 + Bettor 会话侧 Monitor） |
| ② 更好的宿主：P2 常驻哨兵 | **采纳**：memory-watch 住在 P2 哨兵里（已 30 s 循环、已有 `Get-CommitSnapshot`）；**不依赖 console、不 spawn、不依赖 DB**，console 卡死照样工作；console 内 memory-alert 降为**可选的 UI/events 镜像，另批**，本页不设计 |
| ③ 状态机转移表缺 5 条向量 + 变异不足 | **采纳并已实现**：见 §2.3（表补全，矛盾去掉）与 §4（**15 条向量 + 12 条变异，已在 `-SelfTest` 里跑绿**） |
| 时间源 | **采纳**：所有间隔判断用**单调时钟**（`[Stopwatch]`），墙钟只用于日志时间戳 |
| crit≤warn 非法配置拒起 | **采纳**：`clear < warn < critClear < crit < 100`，否则 `-WatchOnly` 退出 2、哨兵内禁用并发 Error 事件 9313 |
| 采样失败期间状态保持还是重置；`cleared.durationMs` 含盲区 | **明确**：失败期间**状态保持不重置**；恢复后按新读数走同一转移表；`SAMPLE-RECOVERED` 行与 9312 事件带 `blindMs` |

## 0. 结论（先给 Bettor）

在 P2 的常驻哨兵里加一个**只读检测**：每个哨兵 tick（默认 30 s）读一次**系统已提交内存占比**，**≥ 85%** 时先写 `memory-watch.log`、再写 Windows 事件日志（带"谁占着"前 5 名的名字/PID/GB），**≥ 92%** 升一级，回落 **< 80%** 落恢复；采样连续失败 / 内存耗尽类失败也告警。**只检测，不处置**（不杀进程、不限流、不碰 AI 推理服务——那是 P1，Owner/另一台机会话的域）。每 5 分钟一行 `SAMPLE` 留下"内存曲线"。

**它不是预防。** 真正的预防是 P1（推理进程设提交上限 / 分机）。本页的价值 = **缩短"发现"时间 + 留证据**，且只在有人（或 Monitor）读它时成立。

**需要 Bettor 知悉的一处与已采纳项的偏差**：M-2 采纳的是"60 s"——那是针对 `spawn` 方案的成本考虑。in-process 采样没有 spawn 成本，随哨兵 30 s 一次；`-SentinelTickSec` 可调，你要 60 s 就传 60。

## 1. 依据

### 1.1 (1531) 死机时间线（本地时间）
20:28:55 / 20:36:17 / 20:36:50 / 20:39:18 系统**四次**报 Resource-Exhaustion-Detector 2004，点名 `llama-server.exe` 25.8 GB、`python.exe` 19.2 GB 与 9.6 GB；提交上限 89.6 GB = 61.6 GB RAM + 28 GB 固定页面文件；console 的 stdout 到 20:41 仍每分钟 56–76 行（console 不是元凶，且直到 20:41 都还活着）；21:07:57 Owner 发起重启，关机流程在内存耗尽下卡死；21:51:33 硬复位。

### 1.2 一条真实向量（2026-09-19 23:20，本页写作时读到）
提交内存 **74.9%**（已用 67.1 / 上限 89.6 GB，物理空闲 32 GB）；前 5 占用：`llama-server` 16.6 GB、`python`（PID 21928）8.8 GB、`python`（PID 24876）7.7 GB、`vmmemWSL` 6.0 GB、`kaspad` 3.3 GB。22:3x 时同一口径读数是 44–47%——约 40 分钟内涨了近 30 个百分点。**Bettor 复核（(1543)）**：这两个 `python` 是 `KANet-TranslateGen2` / `KANet-VoiceService` 两个计划任务 23:08:15 起的（state=Running）。
- 这条读数在**默认阈值下应当静默**（74.9 < 85）——已作为 `-SelfTest` 向量固化（`real-reading-74.9-default-thresholds-is-silent`），并且**同一读数在 `warn=70` 下应进入 WARN**（`…-with-warn-70-enters-warn`）。
- 我还用**降低阈值**（`-MemWarnPct 40 -MemCritPct 99 -MemClearPct 30 -MemCritClearPct 90`）真跑过一次 `-WatchOnly`（`-KanetRoot` 指向系统临时目录，未碰生产），实得日志（节选）：
```
[memory-watch] WATCH-ONLY started warn=40 crit=99 clear=30 critClear=90 tick=4s (detection only; starts nothing)
[memory-watch] SAMPLE commit=74.9% used=67.1GB limit=89.6GB physFree=31.8GB top=llama-server:10980:16.6,python:21928:8.8,python:24876:7.7,vmmemWSL:17400:6,kaspad:16464:3.3
[memory-watch] STATE enter-warn commit=74.9% used=67.1/89.6GB physFree=31.8GB top=llama-server:10980:16.6,python:21928:8.8,python:24876:7.7,vmmemWSL:17400:6,kaspad:16464:3.3
```
  同次实测：第二个 `-WatchOnly` 实例被 `memory-watch.lock` 拒绝（退出码 10）；**没有起任何 kaspad/console/其它进程**；事件源未注册时事件写失败被记进 `boot-history.log`（`eventlog-write-failed id=9301: The source was not found…`），**文件日志照常**——即 `-WatchOnly` 在没有提权注册事件源的普通会话里也能工作，只是没有事件日志那一层。
- **距离 85% 线还差约 10 个百分点（≈ 9 GB 已提交）**——85% 大约对应 76 GB 已提交。

### 1.3 这个检测能做什么、不能做什么（诚实口径）
- **能**：哨兵是独立的 PowerShell 进程，不依赖 console/DB/spawn；(1531) 里 console 在 20:41 前一直活着；2004 事件表示系统已在报"接近提交上限"，85% 线比它更早——**具体早多少算不出**（当时没有提交内存曲线，这正是加周期 `SAMPLE` 行的原因）。
- **能**：留"谁占着"前 5 快照 + 周期采样曲线，事后不必再从系统事件日志拼。
- **不能**：**不阻止死机**；只在有人/Monitor 读时有价值（§5）。
- **不能**：哨兵进程本身被杀/机器硬复位时无信号；P2 的事件日志与状态文件是另一层，同样依赖机器活着。
- **不能**：内存真到"连 PowerShell 进程内的 CIM 查询都失败"时——这被当作信号（9310/9311），但**未在真实耗尽场景验证过**（也不应去制造）。

## 2. 设计

### 2.1 宿主与接线
- **宿主**：P2 脚本 `mainnet-boot-sequence.ps1` 的常驻哨兵循环（Phase B 末尾），每 tick 在 `try/catch` 内调 `Invoke-MemoryWatchTick`；**单次异常永不使循环退出**。
- **`-WatchOnly` 模式**：只跑内存检测，**不做任何启动动作**，可在**普通用户会话**运行、不需要计划任务/提权（事件源没注册时只写文件日志）。用法：`powershell -File scripts\mainnet-boot-sequence.ps1 -WatchOnly`。
- **单实例**：独占文件锁 `logs\mainnet\boot\memory-watch.lock`：同一时刻只有一个检测器（启动哨兵**或**一个 `-WatchOnly` 会话）；拿不到锁的一方——`-WatchOnly` 退出 10；启动哨兵则跳过内存检测、记 `boot-history.log`（不重复告警）。
- **不碰 console、不碰 DB、不 spawn 子进程、不动主网 env**。

### 2.2 采样（in-process）
- `Get-CimInstance Win32_OperatingSystem`：提交上限 = `TotalVirtualMemorySize`（KB）；已提交 ≈ 上限 − `FreeVirtualMemory`；占比 = 已提交/上限。
- **口径已实测对过**（2026-09-19）：CIM **46.7%**（上限 89.6 GB）vs 性能计数器 `\Memory\% Committed Bytes In Use` **47.5%**，差约 1 个百分点，对 85% 线无影响；`Win32_OperatingSystem` 属性名与区域无关（性能计数器名随系统语言本地化）。不用 `wmic`（Win11 新版本已移除）。
- 前 5 名：`Get-Process | Sort PrivateMemorySize64 -Desc | Select -First 5`，**只取名字、PID、私有内存 GB**。
- 校验：上限 > 0、占比 ∈ (0,100]，否则当作采样失败（**不写占比、不用 0 冒充读数**）。

### 2.3 状态机（补全后的转移表；纯函数 `Get-MemoryTransition`）
配置约束：**`0 < clear < warn < critClear < crit < 100`**，`repeat`、`escalate` > 0，否则拒起。默认 `warn=85 crit=92 clear=80 critClear=88 repeat=30 min escalate=+5 pp`。
**静默带**：WARN 内 `[clear, warn)` 不告警、不重报；CRIT 内 `[critClear, crit)` 不告警、不重报。**重报只在读数仍 ≥ 该级别自己的进入阈值时才可能**（这一条消除了 NWT 指出的"迟滞带内 30 min 重报"与"静默带不落库"的矛盾——**选"带内静默、不重报"**）。

| 当前 | 条件 | 动作 | 新状态 |
|---|---|---|---|
| OK | ≥ crit | `enter-crit` | CRIT（**OK→CRIT 直跳**） |
| OK | ≥ warn | `enter-warn` | WARN |
| WARN | ≥ crit | `escalate` | CRIT |
| WARN | < clear | `cleared` | OK |
| WARN | ≥ warn 且距上次告警 ≥ repeat | `repeat` | WARN |
| WARN | ≥ warn 且 ≥ 上次告警值 + escalate | `repeat` | WARN |
| WARN | `[clear, warn)`（迟滞带） | 无 | WARN |
| CRIT | < clear | `cleared`（**CRIT→OK 直降**，如 93→70；不经 WARN，日志文字不说谎） | OK |
| CRIT | `[clear, critClear)` | `downgrade` | WARN |
| CRIT | ≥ crit 且距上次告警 ≥ repeat | `repeat`（**CRIT 内重报**） | CRIT |
| CRIT | ≥ crit 且 ≥ 上次告警值 + escalate | `repeat` | CRIT |
| CRIT | `[critClear, crit)`（迟滞带） | 无 | CRIT |

- **采样失败期间状态保持**（不重置）；恢复后按新读数走同一张表。
- **单调时钟**：`NowMs` 取自 `[Stopwatch]`；墙钟被调（NTP/手动改时间）不会让"距上次告警 ≥30 min"永不成立或立即成立。
- 状态只在进程内存里：检测器重启后重新武装（若重启时仍高位会再报一次——想要的行为）。

### 2.4 采样失败也是信号
- **内存耗尽类错误**（`OutOfMemory`、`1455`、`not enough memory`、`not enough storage`、`insufficient system resources`）**首次**出现 ⇒ Error 事件 9310（按 CRIT 处理），不等 3 次；
- 其它失败连续 **3** 次 ⇒ Warning 9311（每段失败期只报一次）；恢复 ⇒ Information 9312（含 `blindMs`）；
- 每次失败写一行 `SAMPLE-FAILED n=…: <错误>` 到 `memory-watch.log`。

### 2.5 落点与事件 ID（第一落点 = 文件，其次事件日志）
文件：`logs\mainnet\boot\memory-watch.log`（追加；每行带时间戳；状态跳变行**先写**）。事件日志：Application / 源 `KANetBoot`（源须先由提权会话注册一次；未注册则只有文件）。

| 事件 ID | 类型 | 含义 |
|---|---|---|
| 9301 | Warning | `enter-warn` |
| 9302 | Error | `enter-crit` / `escalate` |
| 9303 | Warning（WARN 级）/ Error（CRIT 级） | `repeat` |
| 9304 | Warning | `downgrade`（CRIT→WARN） |
| 9305 | Information | `cleared` |
| 9310 | Error | 采样失败且属内存耗尽类（首次即发） |
| 9311 | Warning | 连续 3 次采样失败 |
| 9312 | Information | 采样恢复（带 `blindMs`） |
| 9313 | Error | 配置非法，检测被禁用 |

每 10 个 tick（默认 5 分钟）一行 `SAMPLE commit=…% used=…GB limit=…GB physFree=…GB top=name:pid:GB,…`（**给复盘留曲线**；一天约 288 行）。

### 2.6 配置（脚本参数，全部有默认；只写键名，不动主网 env）
`-MemWarnPct 85`、`-MemCritPct 92`、`-MemClearPct 80`、`-MemCritClearPct 88`、`-MemRepeatSec 1800`、`-MemEscalatePp 5`、`-SentinelTickSec 30`。

## 3. 明确不做
- **不处置**：不杀进程、不降内存、不重启 console/kaspad。P1 是 Owner 域，且另一台机的会话正在经 SSH 改 WSL 与推理服务，本设计对它们**只读**。
- **不做推送**：不发电报/DM/桌面通知（不是我能定的，D-E）。
- **不做 console 内模块**：console 内 memory-alert（v0.1 设计）降为**可选的 UI/events 镜像，另批**；若将来做，可复用 v0.1 的 `events` 形状（`memory_pressure` / `memory_pressure_cleared` / `memory_sample_failed`），但**不能成为唯一落点**（console 卡死时它就没了）。

## 4. 验收判据

**A. 状态机（纯函数，表驱动；已实现并在 `-SelfTest` 里跑绿）**

| # | 输入序列（占比 @ 秒） | 期望动作序列 |
|---|---|---|
| V1 | 50@0, 84.9@30 | none, none |
| V2 | 84.9@0, 85@30 | none, enter-warn |
| V3 | 85@0, 86@60, 87@120 | enter-warn, none, none |
| V4 | 85@0, 91@60（+6 pp） | enter-warn, repeat |
| V5 | 85@0, 92@60 | enter-warn, escalate |
| V6 | 92@0, 87.9@60 | enter-crit, downgrade |
| V7 | 85@0, 82@60, 79.9@120 | enter-warn, none, cleared |
| V8 | 85@0, 86@1800 | enter-warn, repeat |
| V9 | 85@0, 70@60, 85@120 | enter-warn, cleared, enter-warn（重新武装） |
| **V10** | 50@0, 95@30 | none, **enter-crit（OK→CRIT 直跳）** |
| **V11** | 93@0, 70@30 | enter-crit, **cleared（CRIT→OK 直降）** |
| **V12** | 92@0, 97@30（+5 pp） | enter-crit, **repeat（CRIT 内重报）** |
| **V13** | 92@0, 93@1800 | enter-crit, repeat（CRIT 内按时间重报） |
| **V14** | 85@0, 82@1900 | enter-warn, none（**WARN 迟滞带内 30 min 后也不重报**） |
| **V15** | 93@0, 90@1900 | enter-crit, none（**CRIT 迟滞带内不重报**） |
| RV1/RV2 | **真实读数 74.9**（默认阈值 / warn=70） | none / enter-warn |

配置校验向量：`crit ≤ warn`、`clear ≥ warn`、`critClear ≤ warn`、`crit ≥ 100` 均被拒（`Test-MemoryConfig`）。

**B. 采样失败路径（已实现；用伪造采样器 + 记录事件，不碰真实事件日志）**：内存耗尽类错误首次即 9310；两次普通失败不告警、第三次 9311 且只一次；失败期间状态保持（WARN 仍是 WARN）；恢复 ⇒ 9312 且日志含 `blindMs=`；恢复后读数 < clear ⇒ 用保持的状态正确 `cleared`（9305）。

**C. 变异对照（每条针对一个转移方向，已在 `-SelfTest` 里自动跑；每个变异必须使 ≥1 条向量变红，否则该条测试判 FAIL）**

| 变异 | 目标转移 |
|---|---|
| `OKWARN` `-ge`→`-gt` | OK→WARN 边界 |
| `OKCRIT` 条件改为永假 | **OK→CRIT 直跳** |
| `WARNCRIT` 条件改为永假 | WARN→CRIT 升级 |
| `WARNCLEAR` 改为永不恢复 | WARN→OK |
| `CRITCLEAR` 改为永不直降 | **CRIT→OK 直降**（落到 downgrade） |
| `CRITDOWN` 阈值 88→80 | CRIT→WARN 降级 |
| `WARNREP_T` / `WARNREP_PP` | WARN 按时间 / 按涨幅重报 |
| `CRITREP_T` / `CRITREP_PP` | **CRIT 内**按时间 / 按涨幅重报 |
| `WARNREP_T` 去掉 `≥warn` 守卫 | WARN 迟滞带不重报（V14） |
| `CRITREP_T` 去掉 `≥crit` 守卫 | CRIT 迟滞带不重报（V15） |

**D. 真机只读验证（不动生产）**：① `-WatchOnly` 在**临时 `-KanetRoot`** 下以调低阈值跑，出现 `STATE enter-warn` 且 `top` 是真实进程名（**已做**，见 §1.2）；② 第二实例被锁拒绝（**已做**，退出码 10）；③ 未起任何进程（**已做**）；④ 事件源未注册时不报错、文件日志照常（**已做**）；⑤ **未做**：事件源注册后事件日志读回（需提权，P2 4.2 后补）；⑥ **未做**：哨兵内长时间（≥1 小时）运行的资源占用与 `SAMPLE` 行节奏。

**E. 上线后（哨兵/`-WatchOnly` 上线时）**：`memory-watch.log` 出现 `started …` 行恰 1 行；30 s 内出现第一条 `SAMPLE`，其占比与手读 `Get-CimInstance` 值在 ±2 pp 内；无压力时无 `STATE` 行（无误报）。

## 5. M-6 具名消费者（NWT：至少一个）

1. **Bettor 接位读数清单**加一条（文档改动，不改 console）：
   `Get-WinEvent -FilterHashtable @{LogName='Application';ProviderName='KANetBoot'} -MaxEvents 30 | Where-Object { $_.Id -ge 9301 -and $_.Id -le 9313 }`
   与 `Get-Content D:\kanet-tn12\logs\mainnet\boot\memory-watch.log -Tail 20`（后者不依赖事件源）。
2. **Bettor 会话侧 Monitor**（本机会话可做，不改 console）：周期读 `memory-watch.log` 的 `STATE`/`SAMPLE-FAILED` 行，或订阅上面的事件查询；据 (1543) Bettor 已装 80/85/92% 监视——**本页的检测与它是两条独立信号**，谁先响都行。
3. `events` 表**不再是消费点**（本设计不写库）。

## 6. 开放项 / 风险
- **P1 未解**：本页只缩短发现时间。**别把"有了 memory-watch"读成"不会再发生"**。
- **`-WatchOnly` 在生产检出上跑**需要 Bettor 明说（写 `logs\mainnet\boot\`）。
- **事件日志那一层依赖提权注册事件源**（P2 4.2）；没注册时只有文件日志。
- **长时间运行的资源占用未测**（§4-D⑥）。
- **口径漂移**：CIM 与性能计数器差 ~1 pp；换机器/区域时以 CIM 为准。
- **并发**：与 P2 哨兵的其它职责同循环、各自独立 `try/catch`；互不依赖。
