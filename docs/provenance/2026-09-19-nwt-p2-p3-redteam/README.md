# P2（主网开机自启 runbook + 脚本草案）与 P3（console memory-alert 设计）红队审 —— NWT

2026-09-19。对象：`origin/coord/kanetui-boot-autostart-and-memory-alert-design` 头 **`9059c5b5`**（我先读了 `2a45c034`，再读 `2a45c034..9059c5b5` 的 diff：只加了 Bettor 裁定记录、D-F 改为"kaspad 交系统关机通知"、R1 加"NWT 审过草案后再跑"，正文未变）。文件：`docs/2026-09-19-kanetui-mainnet-boot-autostart-scheduled-task-runbook-v0.1.md`（514 行，含附录 A 脚本草案与附录 B 注册命令）、`docs/2026-09-19-kanetui-console-memory-alert-design-v0.1.md`（164 行）。方法：只读 `git show`；对脚本草案逐函数读码 + 对现场事实（进程表、日志、探针源码、relay 源码、kaspad 日志）核对其断言。D-021：无密钥 / 余额 / 地址。

## 结论

- **P2：设计方向接受，脚本草案不许落码，先改 3 处 MUST（P2-M1…M3）**。最重的一条（M1）会让"开机自启"在最脆弱的时刻（kaspad 刚起、正在追块）反复被自己杀掉；M2 会让 R1 演练与任何有 simnet 节点在跑的时刻误判。附 6 条 SHOULD。
- **P2 ②（自启把启动期烧费变成无人值守必发生）**：除了开关，还有 4 条承重要求（§二）。**开关本身必须先于任务注册上线并在运行中的 console 上被日志证明。**
- **P2 ③（D-F 裁定）：作为"现阶段不手动杀"的规则成立，但它的依据是 n=1 且换了环境，不能当作"已解决"**；我补了一条零风险的测量办法（§三）。
- **P3：三个问题的答案：M-4 不够；P3 在没有推送前不算"预防"（是"检测 + 取证"，且必须改称）；变异对照没覆盖状态机全部边，缺 5 条**。另有一个更好的宿主方案（把采样放进 P2 的常驻哨兵）。
- 我在生产检出里看到的 `kasia-console/list-relays.mjs`、`kasia-console/snapshot-baseline.mjs`、根目录 `scout-status-tracer.ps1` **不是我的**：三者 mtime 均为 2026-09-14 01:26（我这个会话 9/19 22:15 才起），我只在 scratchpad 与自己的 worktree 里写过文件。

## 一、P2 脚本草案（附录 A）红队

### 我核对过、成立的
- kaspad 钉住的 sha256 与二进制**全值逐位相等**（`8afe6a68…6e38`，我重算）；`--version` 输出恰为 `kaspad 2.0.1` + 一个空行（草案 `Out-String.Trim()` 能处理）；活进程命令行 = 草案 `$kArgs` 四个参数逐字。
- 探针语义：`ALIVE(0)` = `isSynced===true ∧ daa>0`（`kaspad-rpc-probe.mjs:118-145`），`7` = isSynced=false；三个 `KASPAD_PROBE_*` 环境变量的默认确实是 TN12（`:17210` / `testnet-12` / `D:/kaspa-tn12-data/…`）——草案只给子进程设并 `finally` 清掉，对；`switch` 分支对 0/7/8/2/6/default 的落法我逐个走过，无穿透错误。
- 认领判定的 `@()` 修复对；`Rotate-LogIfPresent` 目标存在即 throw、不覆盖，对；单实例文件锁（`FileShare.None`，进程存活期持有）对，且不依赖需要特权的 Global mutex。
- 运行时限 `PT0S`、`RestartCount 3`、`IgnoreNew` 的意图对；`-ExecutionPolicy Bypass` 仅作用于该次调用。

### P2-M1（MUST）—— 已启动 kaspad 之后不得有任何 `exit` 路径；否则重试环会反复硬杀刚起的节点
**攻击**：草案自己承认"任务动作进程退出后其 `Start-Process` 子进程是否被一并结束，未实测，按最坏情形设计"，并据此让脚本在 kaspad 就绪之后永不退出。但**就绪之前**的失败仍 `exit`：`Stop-Boot 41`（kaspad 中途退出）/ `43` / `44`（探针依赖坏）/ `45` / `50`，以及**外层 `catch { Stop-Boot 99 }` 对整个 `Invoke-BootSequence` 生效，包括 kaspad ALIVE 之后的 console 阶段与哨兵循环**（例如 `Start-ConsolePhase` 里 `[int](Get-Content …console-mainnet.pid -Raw).Trim()` 在 `$ErrorActionPreference='Stop'` 下抛错，就走到 `Stop-Boot 99` → `exit 99`）。按草案自己的最坏假设，`exit` = 任务实例结束 = kaspad（与 console）被 `TerminateProcess`；随后计划任务按 D-D 每 10 分钟重启，最多再 3 次——**每一次都在 kaspad 刚起、追块 / RocksDB 恢复的窗口里硬杀一次它**，而 `44`（缺 `kaspa-wasm`）、`43` 是**确定性失败**，4 次必然重复。D-D 把"确定性失败多出 3 条事件"当成代价接受了，但真正的代价不是 3 条事件，是 3 次额外硬杀。
**修法**：① **一旦本脚本起了 / 认领了 kaspad，任何路径都不得 `exit`**：41（起后）/43/44/45/50 改为 `Warn-Kaspad`（告警 + 记状态 + 继续常驻，与 console 阶段同一规则）；只有"什么都还没起"的失败可以 `exit`（10 / 20 / 21 / 22 / 30、以及起 kaspad 之前的 41-进程数 / 42）。② 外层 catch 只包"起任何东西之前"的段；起之后的所有阶段各自 `try/catch` → 状态 + Error 事件 + 继续进入哨兵循环，**哨兵循环本身包 try/catch，永不因单次异常退出**。③ 更进一步（R2 里一并测）：kaspad 与 console 用**不属于该任务 Job 的方式**起（团队既往用 WMI `Win32_Process.Create` / `schtasks` 让进程不随起它的会话被收——见 memory「SSH 内 Start-Process 子进程随会话被收」），若 R2 证明子进程能在任务实例结束后存活，则常驻包装不再承重，M1 的风险面整体消失。**验收**：R3 增一条向量——起后注入 44（把探针依赖路径改坏）⇒ kaspad PID 不变、脚本仍在常驻、`boot-status.json` 有 Warning；`-SelfTest` 覆盖不到这一层，不能拿"11 项 PASS"当证据。

### P2-M2（MUST）—— 进程认领的身份判据过宽，两处都会误判
1. **console**：`Get-ConsoleProcs` 用 `CommandLine -match 'kasia-console[\\/]src[\\/]index\.js'`。本仓有约 60 个 worktree（`scratch\_*_wt_*`、`_j2_wt_*`…），**每个都含 `kasia-console\src\index.js`**，且团队会起隔离 console 实例（独立端口 + 空库）做验证。命中任何一个都算"console 进程"：恰 1 个（且它是隔离实例）⇒ **认领了一个不是主网 console 的进程**，脚本以为 console 在跑、永远不起真的（之后 `Test-Listening 3202` 为假，300 s 后只告警）；≥2 ⇒ 61。**修法**：命中条件 = 命令行含**精确的生产路径** `D:\kanet-tn12\kasia-console\src\index.js` **且**该进程拥有 `:3202` 监听 **且**与 `console-mainnet.pid` 一致；三者不全 ⇒ 不认领。
2. **kaspad**：`Get-KaspadProcs` 只按 `Name='kaspad.exe'`。**simnet 验证节点用的是同一个 `D:\rusty-kaspa-v201\kaspad.exe`**（接位文件明写：官方同款 v2.0.1 二进制起隔离 simnet，且规则是"同一时刻只起一个"——即经常恰好有一个在跑）。此时 `kProcs.Count` = 2 ⇒ `Stop-Boot 41`；或只剩 simnet 一个 ⇒ `Test-ArgsMatch` 不符 ⇒ `Stop-Boot 42`（"有个命令行不同的 kaspad，不碰它"）。**开机时没有 simnet，所以真重启不受影响；但 R1 演练（在活机器上跑，正是有 simnet 的机器）与任何日后手动重跑会立刻误判。** **修法**：先按命令行过滤——只把含 `--appdir=<AppDir>` 或 `--rpclisten-borsh=127.0.0.1:<RpcPort>` 的 `kaspad.exe` 视为"主网 kaspad"（其余无视，不计数、不报 42）；42 只留给"主网 appdir/端口上有一个参数不同的进程"。
**验收**：`-SelfTest` 加两组夹具（伪造进程记录数组：多 worktree console、simnet kaspad 并存）⇒ 认领结果正确。

### P2-M3（MUST）—— 见 §二（②）：自启前必须先有 `autoSplitAll` 开关，且 ALIVE 门要防"闪断的 isSynced"
`ALIVE` 只是探针一次读数；kaspad 2.0.1 的 `isSynced`（sink 时间戳落后 <661 s ∧ 有 peer）在"近同步窗"内即为真、之后可以翻回（团队既往实测，memory），而 console 启动后几秒内 `autoSplitAll` 就发 `split_utxo`。**relay 侧 `split_utxo` 路径没有 isSynced 检查**：`git grep isSynced kasia-relay/src` 只有 `lib/transaction.mjs:159`（发送路径 `_sendKaspaInner` 用）与 `rpc-listener.mjs:754`（只打日志）两处。所以起 console 前的门要改为：**连续 N 次探针 ALIVE（建议 ≥3 次、间隔 15 s，即 ≥45 s 稳定）**，而不是第一次 0 就放行；这是把"闪断 ALIVE 后立刻在半同步节点上发钱"的窗口关掉。

### P2 SHOULD
- **S1 脚本自身的来源**：任务动作直接运行 `D:\kanet-tn12\scripts\mainnet-boot-sequence.ps1`——一个**活的 git 工作树里的文件**。D-B 只保护 console（分支不对不起 console），但脚本、`start-console-mainnet.ps1`、`kaspad-rpc-probe.mjs` 三个文件都是在分支检查**之前**就从"当时检出的任何分支"读入的；检出被误切分支的历史事故（我自己也发生过）是真实的，那时脚本可能根本不含 D-B 的检查。建议注册的动作指向**部署到树外固定目录的副本**（如 `C:\KANet\boot\`，sha256 记入 provenance），或至少 boot 时对这三个文件做 `git diff --quiet HEAD -- <path>` + 分支检查并**先于其他一切**执行。
- **S2 前一次停机是否干净（零风险测量，配合 ③）**：脚本在起 kaspad 之前读 `D:\kaspa-mainnet-data-v201\kaspa-mainnet\logs\rusty-kaspa.log` 的尾部，若最后一行不是 `Kaspad has stopped...` ⇒ 发 Warning 事件 `previous_stop_unclean`（并把 GateSoftSec 视为可能更长——RocksDB 恢复）。这是**内部日志**，不是重定向的 stdout（原因见 §三-H3）。
- **S3 stdout 捕获自检**：哨兵每轮顺带比较 `kaspad-stdout.log` 的 mtime，kaspad 活着而 stdout 停写 >10 分钟 ⇒ Warning `stdout_capture_stale`（我在 §三-H3 实见过一次 5 天的静默停写）。
- **S4 S4U 下的跨会话可管理性（R2 必加一条）**：D-A 的实测只列了 `node`/`git`/文件读写。**运维模型依赖"交互式非提权会话能读该进程命令行、能 `Stop-Process`、能读它的日志"**（Bettor 非提权起停 kaspad 是既定做法；(1530) 保留②里"部分在 session 0 的进程命令行读不到"就是同类现象）。S4U 起的进程属于另一个登录会话；同一用户 SID 通常可访问，但**未证**。R2 用无害的 `ping -t` 让 S4U 任务起，再从交互式非提权会话 `Get-CimInstance … CommandLine`、`Stop-Process`——不过就换 D-A 备选，别等到真重启才发现。
- **S5 `Start-ConsolePhase` 的 PID 文件陈旧**：`console-mainnet.pid` 是上一次的残留也会被读走（`start-console-mainnet.ps1` 失败但退出码 0 的路径）。要求：读到的 PID 必须是 `node.exe` 且命令行含生产路径且 `CreationDate ≥ 本脚本开始时间`，否则按 63。
- **S6 哨兵**：只按 PID 判死（PID 复用理论上可致漏报）；建议同时校验进程创建时间未变。它还是"只报一次"，运行期若 console 死后被人手动重起，哨兵不知道——可接受，但写进已知边界。

## 二、（②）自启让启动期烧费"无人值守必发生"——除开关外的承重要求

事实：`src/index.js:870-871` 无条件 `await autoSplitAll()`，无 env 开关（我 postcheck 里已证）；同一启动路径上还有 `broadcaster-utxo` 的 cron（`broadcaster-utxo.mjs`，启动 90 s 后 tick，对"oracle 中继 ∪ `POOL_SEEDER_MAKER_RELAY`"发 `split_utxo force:true`，proto 中继已排除）——今晚日志里它只有 `started`（因当前无 `is_oracle=1` 的行），但**它是否花钱取决于库里的数据**，不是取决于代码。
1. **开关必须先于任务注册上线，并在运行中的 console 上被日志证明**（`[utxo-splitter] disabled` 之类的一行）。注册门（§4.3）现在要求"D-G 已有 Owner 决定"；应改为"**开关已合入、已部署、启动日志已出现该行**"——否则"Owner 决定了不加开关"与"开关还没做"不可区分，第一次无人值守开机就烧。
2. **枚举而不是只治一个**：要求 KANet-UI / Bettor 交一张"**console 启动后无人干预即可能发链上交易的路径**"表（路径 → 触发条件 → 主网现状默认 → 开关）。我只确认了上面两条；**入口触发型**（收到链上消息后自动付 / 自动交割 / autoTaker / market-seeder 等，CLAUDE.md 描述的 Exchange 协议自动化）在主网是否开启我**没有核**，不下结论——正是"需要枚举"的理由（memory：重启前花钱面 = 定时器 + 入口触发路径）。
3. **验收读数 #10 改成链上侧、不是日志侧**：现在只读 `[utxo-splitter]` 日志行——它看不见 `broadcaster-utxo`、看不见任何别的路径。改为：开机后 30 分钟内，对 18 个 relay 地址做一次"出站交易清单"（节点 RPC / relay 日志里 `TRANSFER|SPLIT|COVENANT_BROADCAST` 行汇总），**与上面枚举表的预期集逐笔比对**，多出任何一笔 = 验收失败。
4. **兜底保险丝（仅当 Owner 决定保留启动拆分时）**：当前拆分**不收敛**（同 4 个账户 5→4→5、7→6→7 来回摆，我 postcheck 已证），所以断电/更新重启循环 = 每次都烧。若保留，需要"距上次拆分 <N 小时则跳过"的持久化间隔 + 单次启动总费用上限；若开关默认关则本条免。

## 三、（③）D-F 裁定"kaspad 交系统关机通知、不手动杀"——有没有漏洞

**结论**：作为**现阶段规则**成立（不引入更差的做法），但**它的依据是一次观测、且换了环境，不是已证事实**。漏洞 / 缺口：

- **H1（依据 n=1，且换了登录会话）**：今晚 (1531) 的"干净退出"发生在 kaspad 是**交互式会话里**由 Bettor 非提权 `Start-Process -WindowStyle Hidden` 起的情形。我读了 kaspad 内部日志的关机序列：`21:12:19.596 P2P Server stopped` → `21:12:19.692 GRPC …` → `21:12:20.081 WRPC Server stopped` → `21:12:21.263 Kaspad has stopped...`——从收到信号到落干净标记约 **1.7 秒**，说明**这一次**信号确实送达且处理很快。但 P2 的方案把 kaspad 挪到 **S4U 登录会话**（不再是交互式会话）；**系统关机通知会不会送达另一个（非交互）登录会话里的隐藏控制台进程，我没有证据，也无从在不真关机的情况下证明**。R3 计划测的是"Ctrl+C 能否送达隐藏窗口进程"——那测的是 Ctrl+C，**不是关机通知**，两条路径不同，不能互相代替。
- **H2（可在零风险下把"未证"变成"每次开机都有一条测量"）**：见 P2-S2——起 kaspad 前读内部日志尾，最后一行是否 `Kaspad has stopped...`。第一次自启后的**第二次**关机—开机就能得到 S4U 会话下关机通知是否送达的**直接读数**；此前一律按"可能不干净"对待（例如不要在第一次自启后立刻做依赖干净停机的操作）。这比等 R3 的 Ctrl+C 实验更贴近真实路径。
- **H3（草案文字里的证据来源用错了）**：runbook §1/§4.5-5 把 `kaspad-stdout.pre-…log` 当作"重启前那份"的证据，并把 `D:\kaspa-mainnet-data-v201-logs\kaspad-stdout.pre-reboot-20260919-221852.log`（10.7 MB）当作旧日志。**我看了它：末行时间戳是 2026-09-14 16:02:06，而该 kaspad 进程 9/13 21:12 起、跑到 9/19 21:12 才停——重定向的 stdout 在中途停写了整整 5 天**（原因我没查明：本次 kaspad 的启动器进程 14500 早已不在但 stdout 仍在增长，说明"启动器进程一死管道就断"这条解释不成立）。**所以不能拿重定向的 stdout 当"干净停机"或"没丢日志"的证据；权威是 kaspad 自己的内部日志** `…\kaspa-mainnet\logs\rusty-kaspa.log`（今晚的关机序列就是从这里读到的；它 84 MB 且未轮转——顺带记一笔）。R1/4.5 里所有"轮转件内容 = 重启前那份"的验收都要改成读内部日志。
- **H4（规则留下的缺口，不是错误）**：不手动杀 ⇒ **kaspad 单独重启（换二进制、D-c 类实验、任何只需重启节点的运维）没有已知的干净路径**，只能靠整机重启；任务计划程序里"结束任务" / `Unregister` / `Stop-ScheduledTask` 都是硬杀。R3 测 Ctrl+C 时须**用与真实路径相同的起法**（S4U 任务 → `Start-Process -Hidden` → 重定向）；一个用 `-WindowStyle Hidden` 起的进程有隐藏控制台，用 `CREATE_NO_WINDOW` 起的**没有控制台**——`GenerateConsoleCtrlEvent` 送不到没有控制台的进程。我预期"没有干净手动停法"，如果 R3 证实就把"只有关机通知一条干净路径"写进 runbook，而不是继续找。
- **H5**：Windows 对关机时进程的等待是有限的（应用 / 服务终止超时）；今晚 1.7 s 很宽裕，但那是低负载、无追块状态；追块中关机的落盘时间未知。RocksDB 有 WAL，最坏是恢复而不是丢账，S2 的告警就是为此。

## 四、P3 红队

### ① 采样走 CIM 的 PowerShell 子进程在内存耗尽时本身起不来——M-4"连续 3 次失败告警"是否足够？
**不够，且方向上有更好的做法。**
- **每 60 s `spawn powershell` 有两个问题**：（a）**它会在最坏的时刻自己加压**——Windows PowerShell 冷启动的提交量以数十 MB 计（设计稿也承认"未实测"），提交内存逼近上限时，这个新进程可能就是压垮最后一点余量的那一个；（b）**失败时刻恰是最需要读数的时刻**。M-4 的 3 次 × 60 s = 最短 3 分钟盲区之后才响，而 (1531) 的时间线里 2004 事件到桌面失去响应前后总共十来分钟。
- **修法 1（MUST）**：把"第一次就是 spawn 失败"的**错误类型**当压力证据，而不是等 3 次：`spawn` 的 `ENOMEM` / `EAGAIN` / Windows 错误 1455（`ERROR_COMMITMENT_LIMIT`，"页面文件太小"）/ 8（`ERROR_NOT_ENOUGH_MEMORY`）⇒ **立刻**按 CRIT 处理（写 stdout + 尽力写 events），与"解析失败 / 超时"（普通失败，走 3 次规则）分开计数。
- **修法 2（SHOULD，强烈）**：**常驻一个 PowerShell 子进程**（console 启动时内存健康时起一次，内部循环每 N 秒输出一行 JSON），console 只读它的输出；这样"spawn 失败"这一失效模式**根本不存在**，60 s 的 spawn 抖动也没了。设计稿 §2.2 已想到但"本设计不做"，理由是"要更密才需要"——**理由错了：不是为了更密，是为了在耗尽时还能读**。配套：读不到新行 >2 个周期 ⇒ 按采样失败（防子进程挂死）；子进程与 console 同生命周期。
- **修法 3（MUST）**：告警的**第一落点是 stdout 行，不是 DB**。`events` 写库要靠 SQLite 与事件循环，耗尽时最先失效；stdout 是 (1531) 里留下最后证据的地方（console 最后一行 20:41 的 heap-sample）。每次状态跳变**立刻**打一行 `[memory-alert] STATE OK→WARN commit=…`（不受 5 分钟采样节流），DB 写入是"另加"。

### ② `events` 没有推送渠道——P3 在推送出现之前算不算"预防"？
**不算。它是"检测 + 取证"，应改名，并且不得在任何清单里记为 P 类风险的"已缓解"。** 理由：预防 = 在坏事发生前改变结果；P3 只在"有人正好去查表"时缩短发现时间，且设计稿自己也写"它防不了下一次死机"。而 (1531) 的窗口是深夜、Owner 不在、会话无人盯——没有推送 ⇒ 告警只在事后可见（与 disk-space-alert 同）。**真正的预防是 P1**（给推理进程设提交上限 / 分机）。所以：① 页首与 (1531) 的 P3 条目措辞改为"检测与取证"；② M-6 不能一直开放——**至少一个具名消费者**：把"`SELECT … WHERE source IN ('memory-alert','disk-space-alert') AND created_at > <上次读>`"写进 Bettor 的开机 / 周期读数清单，并给一个 session 侧的 Monitor / 定时读取（本机会话可做，不改 console）。
**更好的宿主**：P2 的常驻哨兵**已经是一个 PowerShell 进程、每 30 s 循环、已经有 `Get-CommitSnapshot`**——把 `commitUsedPct ≥ 85` 判定与 Windows 事件日志告警加进去只需要十几行，它**不依赖 console、不 spawn、不依赖 DB**，console 卡死时它照样工作。建议：**采样与告警主体放 P2 哨兵，console 内的 memory-alert 降为可选的 UI/events 镜像**。（这也让 P3 不必等 console 重启才能上线。）

### ③ 变异对照是否覆盖状态机每条边？
**没有。** 逐边对照 §2.3 与 §4 的 A/B/C：
| 边 / 场景 | 覆盖 | 缺口 |
|---|---|---|
| OK→WARN、WARN→CRIT、CRIT→WARN、WARN→OK、迟滞带、+5pp 重报、30 min 重报、重新武装 | A2 / A5 / A6 / A7 / A7 / A4 / A8 / A9 | — |
| **OK→CRIT 直接**（50 → 95，跳过 WARN） | ✗ | 表第 2 行有，A 表没有向量 |
| **CRIT→OK 直接**（93 → 70，一个 tick 跨过 88 和 80） | ✗ | **表里没这一行，且现有行有矛盾**：CRIT 行"<88 ⇒ 降级到 WARN，记'仍高于恢复线'"——占比 70 时**不是**高于恢复线，文字会说谎；应直接 `cleared` |
| **CRIT 内重报**（92 → 97，+5pp；或 ≥30 min） | ✗ | 只测了 WARN 的重报 |
| **迟滞带内 30 min 重报是否触发**（WARN 状态、占比在 [80,85)） | ✗ | 表的"仍高位"含义不明：≥85 还是 ≥80？迟滞带行说"不落库"，与重报行冲突；A8 用的是 86，绕开了歧义 |
| 配置 `crit ≤ warn` 非法 | ✗ | A10 只有 `clear ≥ warn` |
| 采样失败期间状态（WARN 中途失败再恢复） | ✗ | 失败恢复后状态是保持还是重置未规定；`cleared` 的 `durationMs` 会包含盲区 |
| 时间源 | ✗ | `evaluateCommit` 吃 `nowMs`，若取 `Date.now()`，系统时钟被调后"距上次告警 ≥30 min"永不成立或立即成立；间隔判断应使用单调时钟（`process.hrtime` / `performance.now`） |
另：变异对照 C 只列了 5 条，且**没有一条针对状态转移方向**（如把 CRIT 降级阈值 88 改成 80、把 OK→CRIT 直跳去掉）——按七条准则的"变异必红"标准，每条边至少一个变异，需补到与边数相当。

## 五、给 KANet-UI / Bettor 的处置一览
| 编号 | 类 | 内容 | 落点 |
|---|---|---|---|
| P2-M1 | MUST | 起 / 认领 kaspad 后不得有 `exit`；外层 catch 分段；R2 测子进程存活性 | 附录 A、§2.1/2.3 |
| P2-M2 | MUST | console / kaspad 认领按精确路径 + 监听 + appdir/端口，不按名字 / 片段 | 附录 A `Get-*Procs`、SelfTest 夹具 |
| P2-M3 | MUST | 连续 ≥3 次 ALIVE 再起 console；自启前 autoSplitAll 开关已上线并被日志证明 | §2.1 step 3、§4.3 注册门 |
| P2-② | MUST/SHOULD | 花钱路径枚举表；#10 改链上侧比对；保留启动拆分时的保险丝 | §0 D-G、§4.5 |
| P2-S1…S6 | SHOULD | 脚本树外副本 / 前次停机干净否事件 / stdout 捕获自检 / S4U 跨会话可管理性 / PID 陈旧 / 哨兵 PID 复用 | 附录 A、R2 |
| ③-H1…H5 | 证据 | 依据 n=1 换环境；用内部日志而非 stdout；预期"只有关机通知一条干净路径" | §0 D-F、§4.5、R3 |
| P3 | MUST | spawn 失败类型即 CRIT；stdout 先于 DB；改称"检测与取证"；补状态机 5 条向量 + 变异；M-6 落具名消费者 | P3 §2.4/§4/§5 |
| P3 | SHOULD | 常驻子进程采样；或把采样告警放进 P2 哨兵 | P3 §2.2 |

## 我没做 / 未证
- 没在真环境跑任何脚本（草案未落码，且按 Bettor 裁定 R1 待本审后才跑）；S4U 语义、任务结束后子进程存活、关机通知送达 S4U 会话、`Get-CimInstance` 跨登录会话读命令行——**全部未证**，我只指出它们承重且应在 R2 / 真重启里被测。
- 没读 `autoSplitAll` 的拆分判据；没枚举入口触发型花钱路径的主网开关状态（§二-2）。
- 没核 kaspad 的关机信号类型（无本地源码：`D:\rusty-kaspa-v201` 只有二进制与 zip），H1 因此无法从源码推断，只能靠测量（S2）。
- 我没有改动 KANet-UI 的任何文件；本文件在我的 worktree `scratch/_nwt_wt_b9v03`。
