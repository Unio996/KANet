# NWT 接位诊断 — kanet-boot-sequence.ps1 "dispatched OK" ≠ 启动成功, 本次真实开机验证实测暴露 8.5h 无人值守盲窗(2026-07-17)

> **Status**: CURRENT — 观察性诊断, 未改代码, 待 Bettor/KANet-UI 确认后排入落码

## 交付方式
接位时 console/relay 全栈未起(kaspad 单独在跑), 频道连不上; 诊断过程中栈恢复(见下方追更: **系 Bettor 06:25Z UTC=13:25 本地手动恢复, 非自动自愈**——本文档初稿曾误写"自行恢复", 已被 Bettor 频道纠偏 #okv2nj.2, 在此更正, 报数口径以此版为准), 恢复后走标准频道报备, 本文档为存档细节, 频道发摘要。

## 背景
按 NWT-接位.md step 0 走验签→读状态层, 发现 COORD-LEDGER 最新快照(7/17 17:1xZ)声称"当前 live: console:3200 健康", 但接位当下实测**全 node 进程为零**(kasia-console/relay/scout/mind/adapter 全灭), 只有 `kaspad`(PID 12100)在跑, `coord-status`/`dev-coord-testnet` 频道 HTTP API 连不上(curl exit 7)。用户指派: 诊断这次"开机自启动没拉起来"的根因(不动手改代码/不重启, 只读日志)。

## 时间线(本地时间, 均为 2026-07-17)

| 时刻 | 事件 | 来源 |
|---|---|---|
| 04:32:15 | 宿主机实际重启(`LastBootUpTime`) | `Get-CimInstance Win32_OperatingSystem` |
| 04:32:32 | SYSTEM 计划任务 `KANet-TN12-BootSequence` 触发(仅隔 17s, **触发本身正常**) | `logs/boot-sequence.log` |
| 04:32:32-49 | 该次运行: kaspad-watchdog OK → kaspad RPC ready(10s)→ mining-watchdog OK → `kanet-start.sh`(PID 13108)"dispatched OK" → `console-supervisor.sh`(PID 13124)"dispatched OK" | 同上 |
| (04:32 前后另有 03 次同批次运行: 02:40:46/03:39:23/04:30:37/04:31:35, 均报"dispatched OK") | | 同上 |
| **04:32:49 → 06:25:49Z(=13:25:49 本地)** | `console-supervisor.log` **零新增行**(上一条真实记录停在 7/16 05:04:25Z)——本地 04:32 派发的 `console-supervisor.sh`/`kanet-start.sh` 在写出第一行日志前已死, **~25h 无日志空窗** | `logs/console-supervisor.log` |
| 13:07:33 | `boot-sequence.log` 再度出现一次运行(非"at startup"单次触发形态, 派发同样两步) | `logs/boot-sequence.log` |
| 13:25:49(本地) | `console-supervisor.log` 首次真实新记录 `supervisor start pid=1847` | 同上 |
| 13:25:37-13:30:53 | 40+ node 进程陆续起来, console:3200 恢复(HTTP 302)、`coord-status` 频道可读 | `Get-Process node`, curl 实测 |

**空窗量化: 04:32 → 13:25 本地, 约 8.5 小时全栈(console/relay/scout/mind/adapter)零覆盖, 仅 kaspad+挖矿链路存活。**

## 根因(读 `scripts/kanet-boot-sequence.ps1` 源码坐实, 非猜测)

脚本自身注释已承认这个设计缺口(L22-23):
> "Start-Process 只记录了'意图'不代表实的启动成功(路径错会静默failed, 脚本会照样往下走+日志照样写着starting)"

但 `Start-Watched` 函数(L24-38)**只做到这一步**——判据仅为 `Start-Process` 返回的 `$proc.Id` 是否非空, 拿到 PID 就记 "dispatched OK" 并返回, **不轮询进程是否存活、不验证目标服务(:3200/`console-supervisor` pidfile)是否真的起来**。两次派发(04:32 vs 13:07)命令、参数逐字相同, 结果一死一活, 而 `boot-kanet-start-stdout/stderr.log` 与 `boot-supervisor-start-stdout/stderr.log` 在两次运行里**全部是 0 字节**——说明失败发生在子进程写出第一行输出之前(瞬间死亡), 现有重定向链路抓不住这类失败, `boot-sequence.log` 因此对两次运行给出**相同的"成功"读数**, 与实际结果(一次全灭/一次全活)矛盾。

**這正是"vacuous 验证"同一族问题(与 D-010 v1.0 bcast sender 归因同構)**: 日志字段"dispatched OK"看似是一个检查项, 实际只证明"发起了 Start-Process 调用", 不证明"目标真的在跑"——跟"发起≠执行"(7/17 主线日归因案方法论)、"锚只证新鲜度不证正文"(D-010)是同一个方法论坑的第三次实例。

## 追更(2026-07-17 13:5x·根因已由 Bettor+KANet-UI 独立坐实, 收窄"未能坐实"部分)

原稿"未能坐实"处的两个疑问, 现由 `commit 4e9bd39f`(Bettor #okhf66 实验归因 + KANet-UI 独立诊断两路吻合)给出确定性答案:

**真根因**: `Start-Watched` 传给 `bash.exe` 的 `-ArgumentList` 原为**数组** `@("-lc", "cd '$KanetRoot' && ./kanet-start.sh")`。PS5.1 的 `Start-Process -ArgumentList` 对数组元素**不会逐元素加引号**, 只是用空格 `Join` 成一条命令行——于是第二个数组元素内部的空格被当成新的 token 边界, bash 实际收到的 argv 被拆成 `-lc`、`cd`、`'D:\kanet-tn12'`、`&&`、`./kanet-start.sh` **五个独立参数**。bash 的 `-c` 语义是"取紧跟着的下一个参数作为要执行的命令", 于是 bash 只执行了 `cd`(无参, cd 到 `$HOME`)→ **exit 0 零输出**, `&&` 之后的 `./kanet-start.sh` 从未被当成命令的一部分, 只是被当成 `$0`/`$1`... 位置参数丢弃。**这精确解释了本文档实测的全部症状**: `Start-Process` 拿到了合法 PID(cd 确实起了一个进程)、`boot-sequence.log` 记"dispatched OK"(技术上没撒谎)、但 `boot-kanet-start-std*.log`/`console-supervisor.log` 全程零输出(因为真正该跑的命令从未被执行, 不是"跑了但崩溃前没来得及写日志")。

**修法**: 数组改单字符串, 手动内嵌双引号包住整个 `cd ... && ...` 子句(`"-lc `"cd '$KanetRoot' && ./kanet-start.sh`""`)。PS5.1 对**标量字符串**参数不做二次处理, 直接透传给 `ProcessStartInfo.Arguments`, Windows 标准 argv 解析器按双引号分组, bash 收到完整单一参数, 内部再由 bash 自己的语法解析拆开 `cd '...' && ...`——两层引号(外双内单)职责分离干净, 是 PS5.1 该场景下的标准规避写法。**红队逐字符验证结论: 该修法本身语法/语义正确, 未发现新引入的转义歧义或攻击面**(细节见下方 verdict 小节)。

**遗留悬念也一并解开**: 原稿问"04:32 死、13:07 为何活"——现已明确: 4e9bd39f **13:44:50 才提交**, 晚于 13:07:33 那次 boot-sequence 运行和 13:25-13:30 栈恢复的观测时间点; 即 **13:07 那次调度触发大概率仍撞了同一个数组 bug、同样只执行了空 `cd`**, 真正让栈活过来的是commit message 自证的"已用于当日手动恢复"——**Bettor 06:25Z UTC(=13:25 本地)手动用修复后的正确调用跑起了 kanet-start.sh**(Bettor 频道原话订正 #okv2nj.2: "是Bettor 06:25Z手动恢复, 卡B终验仍FAIL待重验"), 之后才把这个已验证过的写法回填进脚本本体。**结论: 到本文档撰写时为止, 开机自愈从未被真正验证过一次成功的无人值守案例, 卡B(开机自愈证成)状态=FAIL 待重验, 不是"待下次重启才知道", 是这次已经实测失败了一回**, 与 Bettor 频道强调完全一致——不是新增阻塞, 是确认既有开放项仍然开放且状态更明确(FAIL, 非待定)。

## 建议(不落码, 排队待 Bettor/KANet-UI 定夺)

1. `Start-Watched` 后加一层**存活验证**: 派发 `kanet-start.sh`/`console-supervisor.sh` 后, 轮询 `Test-ConsoleAlive`(脚本里已有这个函数, L58-63, 目前只用来做前置跳过判断, 未用来做后置验证)在 N 分钟内是否变 true, 不 true 则 `Log` 一条 **LOUD FAILURE**(而非现在的静默"dispatched OK"了事), 并可选自动重试一次。
2. 若坐实是"SYSTEM 上下文 vs 登录上下文"差异, 需要在两种触发路径(SYSTEM at-startup / 登录级 Startup 脚本)之间挑一个真正可靠的做法, 而不是两条并行、谁先跑到算谁的现状。
3. `kanet-start-launcher.log` 是否真的"下次启动覆盖上次"待确认(若是, 建议改追加+归档, 否则每次故障都会把上一次的失败证据自己冲掉, 这次诊断已经吃了这个亏)。

## 结论

**不是 P0**(现网当前健康: console 302, coord-status 频道可读; 但恢复是 **Bettor 人工干预**, 不是系统自愈——报数口径不能说"已自愈")。**开机自启动机制的"验证"环节是假的**——只验证了"发起了动作", 没验证"动作成功了", 这次实测的 8.5 小时无人值守盲窗就是这个 gap 的直接产物, 且**如果没有人工介入, 这次盲窗理论上会一直持续到下一次真正的重新调度触发**(不是"运气好某次自动成功", 是"有人手动救了")。卡B(开机自愈证成)= **FAIL**, 待下次真开机重启终验。
