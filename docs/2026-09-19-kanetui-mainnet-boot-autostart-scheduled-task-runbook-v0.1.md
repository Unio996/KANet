# runbook：主网 kaspad + console 开机自启（Windows 计划任务）v0.5 草稿

> **Status**: CURRENT
>
> 起草 KANet-UI · 2026-09-19/20 · 文件名沿用 `…-v0.1.md`（账本 (1535)/(1537)/(1539)/(1544) 已按此路径引用），**正文即 v0.5**；v0.1→v0.2→v0.3→v0.4→v0.5 的差异全部列在下面，与更早读者记忆冲突处以本页为准。依据账本 **(1531)**（死机复盘 P2）、**(1532)**、**(1533)**、**(1539)**（NWT 红队审 `ba660ae0` 全采纳）、**(1542)**、Bettor 转派的 **NWT 复审 `9b2e7943`** 与 **NWT 三审 `16899661`**（`docs/provenance/2026-09-20-nwt-p2p3-v03-third-review/`，下称"NWT 三审"，同样读的是原文）（`docs/provenance/2026-09-19-nwt-p2p3-v02-review/README.md`，下称"NWT 复审"，**读的是原文**）；`docs/iteration/j1-inbox/2026-09-14T10-00Z-bettor-GO-unattended-reboot-verify-with-conditions.md`（9/14 无人登录重启验证读数口径）。
>
> **执行门（页首必读；"页写好了"≠"可以执行了"）**：**只写不执行**。① 本页 → NWT 再审本页与附录 A/C 的脚本草案（**NWT 已四次裁"脚本草案不许落码"，v0.5 需第五次审**）→ ② 新增 `scripts/mainnet-boot-sequence.ps1`、`scripts/boot-outbound-check.mjs`、`scripts/boot-guard-check.mjs` 是**代码**，铁律 0：**落码须 Bettor 批** → ③ **注册门（v0.3 再收紧，见 §4.3）**：D-026 开关**已上线并被运行中 console 的启动日志证明**（V6）∧ **主网 `autotake` 已被 Owner/Bettor 置关**（一个 `config_entries` 写入，不是代码，**不是我动**）∧ 守卫工具已落地并对活库跑绿 → ④ 提权注册计划任务 = **J1 EXECUTE 单**（本机 KANet-UI 会话非提权）→ ⑤ 预演 R0–R3 逐级过（R1 等 NWT 审过脚本后）→ ⑥ 真重启验证 = **Bettor GO + 本机全部会话被切断的窗口**。任何一步未过，不进下一步。
>
> **写作依 D-021**：不写密钥值；不写任何余额、地址与持有人的对应；**不写未修复漏洞的利用细节**（§2.6 只写类别与状态；这类细节写本机 `docs-private/`，页内只留指针）。本页出现的路径、端口、`kaspad` 二进制 sha256（公开发布物的哈希）、进程名、relay **名字**（不含地址）都是运维坐标。
>
> **本页没有动任何东西**：v0.3 期间只做了只读——进程表、计划任务定义、性能计数器、日志目录、探针一次、主网 DB `readonly` 计数与 `config_entries` 非敏感开关行、对 18 个 relay 地址的 outpoint 快照（节点只读 RPC）、只读代码审计（一个子 agent，只读）；没起没停任何进程，没注册任何任务，没往生产检出写任何文件。脚本草案的 `-SelfTest` 与 `-WatchOnly` 都在**系统临时目录**跑（`-SelfTest` 现在**强制断言所有路径在临时目录内**，见 §7-9 的"事故教训"）。

## v0.5 改动（对照 NWT 四审 `57e60636`：`docs/provenance/2026-09-20-nwt-p2p3-v04-fourth-review/`；读的是原文）

四审结论：N-1 闭合、N-3 主体闭合、P3 v0.4 GREEN、D26-scan v2.1 GREEN；P2 脚本仍不许落码，**2 条 MUST（N4-1 / N4-2）+ 3 条 SHOULD（N4-3 / N4-4 / N4-5）**，本版全做。

| NWT 四审条目 | 处置 | 落点 |
|---|---|---|
| **N4-1（MUST）** `CRON_REGISTRY` 的"新增 cron 不登记 ⇒ 红"名不副实：发现规则只认"静态命名导入 + 名字以 start/init 开头 + 被调用"一种拼写；NWT 在真实 `index.js` 上追加五种写法（launch 动词 / 动态 import 解构 / 命名空间 / 直接 `setInterval` / 裸副作用导入）全绿；真实文件里已有未登记的启动期项（:308-312 exchange 定时器块、:874 `autoStartIfEnabled`、:906/912/974/988 四个 broker 动态导入 starter）；且对账只在测试里，没人手敲就不在岗 | **采纳，且取 NWT 推荐的"规则反转"**：分析器（`analyzeBootFile`，见 C.3）**枚举 index.js 里所有来自相对模块、并被使用的标识符**（静态命名 / 默认 / 命名空间 / 动态 `await import()` 解构·命名空间·成员调用 / `import().then`；被调用**或仅被当值引用**都算使用），要求每个**要么在 `CRON_REGISTRY`（起动项：保护类型 + 证据）、要么在 `NON_START`（显式声明的非起动项：路由注册 / i18n / 配置读取 …，带理由）**；另要求每个 `setInterval` / `setTimeout` / `spawn` / `Worker` / `.schedule(` 都在 `INDEX_TIMERS`、每个裸副作用导入都在 `BARE_IMPORTS`；**任何分析器无法分类的 `import()` / 命名空间当值用的形状 ⇒ `UNPARSED` ⇒ 红（未知形状 = 红，不是静默绿）**。真实 index.js：**147 个使用**，新登记 **13** 个起动项（`autoStartIfEnabled`（新增 `config` 类：由 `scanner_enabled` 配置守卫）、exchange 状态机 5 个函数（`data`：`exchange_offers` 空表守卫）、broker 四个动态起动项（`switch`：`BROKER_ENABLED`）、`catchUpUningestedMarkets`（audit-only，**如实标为未审计链上发送**）、两个诊断安装器（no-spend，证据 = 各自头注释）），`NON_START` 声明 **24** 个名字 + 2 个模式，`INDEX_TIMERS` 3 项。**并且同一对账在每次启动时对生产 `index.js` 自己运行**（守卫新增 `boot-registry` 一项：不符 ⇒ MISMATCH 并 fail-closed 不起 console；`index.js` 读不到 ⇒ UNKNOWN），不再依赖有人手敲测试。测试：NWT 的 A–G 六种写法 + 我另加 H–P 九种（默认导入 / 成员调用 / `.then` / 非字面 import / 无 await / 别名 / `setTimeout` / `spawn` / 起动项当值传），**共 15 种追加形状在真实 index.js 上全部转红**；字符串/注释里出现 `startFoo(` 或 `import './x'` **不算**（有专门测试）；STALE（登记了但 index.js 不再使用）两个方向都红 | 附录 C.3 / C.4、§2.6、§4.1、§7-20…22 |
| **N4-2（MUST，小）** `Invoke-NodeTool` / `Invoke-Probe` 没有外部超时——会把 N-1 收益吃回去：ALIVE 门每 ~15 s 调一次、`Invoke-SentinelBeat` 里调出站 diff，卡住则内存检测、死亡检测、两个心跳全停；工具自带的 5 分钟 hard timer 是 JS 定时器，子进程卡在 CPU 密集 wasm 时**触发不了**（NWT 实测阻塞 20.1 s） | **采纳并加强**：新函数 `Invoke-BoundedProcess`：`Start-Process -PassThru -NoNewWindow` + 重定向到 `BootDir` 里的临时文件 + **父侧** `WaitForExit` 分片轮询；超时 ⇒ **只 `Kill()` 自己创建的那个进程对象（精确 PID，绝不按名字、绝不动 kaspad/console）**，返回 `Code=-2`、文本含被杀 PID 与部分输出。超时值：探针 **15 s**、守卫 **60 s**、出站 snap / diff 各 **120 s**（均为参数；守卫对活库实测 <1 s，探针自带 8 s 超时）。**再进一步（回应 NWT 观察②"单次子进程调用期间 beat 不跑"）**：等待循环里**每 ~1 s 调一次哨兵一拍**（带 `-NoDiff`：diff 自己就是一个有界子进程，嵌套拍不重入它），所以**内存采样与两个心跳在慢工具执行期间也照常推进**——N-1 不变量在单次子进程调用内也成立；出站 diff 也挪到一拍里**最后**一项（内存/死亡检查之后）。三个调用方：探针 `-2` ⇒ **单列的一种读数**（不清零 `consecErr`，**不计入"探针错误 ×5 即弃门"**，事件 **9207** 首次与每 20 次报一次；慢但活着的节点不该因此被弃）；守卫 `-2` ⇒ 与其它工具错误同为 **fail-closed**（不起 console，9065）；snap `-2` ⇒ 既有 3 次重试后 9403；diff `-2` ⇒ 9403（**失败读数，不是"无花费"9401**）。测试：真 node 子进程 6 条（快工具返回真退出码与两路输出；带空格参数保引号；**NWT 的"自带 1 s 定时器 + 事件循环占 20 s"忙循环在 2 s 上限处被终止（实测 2.0 s 返回，<9 s 断言）**；被终止的进程消失且**旁观的另一个 node 进程仍活着**（证明不是按名字杀）；**4 s 挂起期间 ≥2 次内存采样且两个心跳新鲜**；缺脚本不抛）+ 4 条流程（探针连续 6 次超时后仍能 ALIVE 且 9207 恰一次、无 9045；守卫超时 fail-closed；snap 超时；diff 超时不报 9401） | 附录 A、§2.1、§5（9207）、§7-23 |
| **N4-3（SHOULD）** 守卫 env 解析残余分歧：① `.NET Trim()`/`\s` 与 JS 在 U+0085、行内 U+FEFF、U+2028/9 上不同（600 个随机文件 192 处分歧，其中 6 例"启动器得到 `KEY=1`、守卫看不到"）；② 文件编码：启动器 `Get-Content` 认 UTF-16 BOM，守卫按 UTF-8 读 ⇒ UTF-16LE 文件里开关被读成"absent" | **采纳**：① 用 .NET 的空白集自实现 `Trim` 与 `\s`，值的 `(.*)` 改为"除 \n 外任意"；② 新 `decodeEnvFile`：按 BOM 识别 UTF-8 / UTF-16 LE / UTF-16 BE，**无 BOM 且含 NUL ⇒ UNKNOWN（fail-closed）**，并**无 BOM 且设置行的"名字"部分含非 ASCII ⇒ UNKNOWN**（启动器此时按系统 ANSI 代码页解码，我们复现不了；值与注释里的非 ASCII 不受影响）；BOM 只消耗一个（第二个 U+FEFF 是数据，与 `Get-Content` 一致）。测试：**NWT 的差分 fuzz 移入测试（固定种子 300 个随机文件，含 U+0085 / 行内 U+FEFF / U+2028 / U+2029 / NBSP / U+3000 / 混合换行 / BOM）对真实 PowerShell 启动器循环，零分歧**；另 4 条 CLI 场景 + 7 条编码场景。**诚实注记**：NWT 的 oracle 把结果放进 PowerShell `[ordered]` 字典、以"变量名"为键，会把只差一个 U+FEFF 的两个不同变量名折叠成一个；我另测确认**真启动器确实设置了带 U+FEFF 的变量名**，所以差分改为按"名字的十六进制 + 值"配对比较（不影响 NWT 关于 U+0085 / 编码的结论） | 附录 C.3 / C.4、§7-24 |
| **N4-4（SHOULD）** `Invoke-SentinelBeat` 节流无真实时间回归（n1g 存活）；n1j（内存 tick 异常逃出 beat）、n1k（出站 diff 不再以"console 已起"为前提）存活 | **采纳**：SelfTest 加 NWT 的**真实时间向量**（tick 1 s、每 0.4 s 一拍共 4 s ⇒ 3–5 次采样；实测 4；n1g 变异只得 1 次 ⇒ 红）；新增 `-InjectFault beat`（一拍里某项职责抛错：调用方不被打断、异常入 history）；新增"console 未起 ⇒ diff 不跑、不报 9401"流程 | 附录 A |
| **N4-5（SHOULD）** `Assert-UnderTmp` 无变异测试 | **采纳**：NWT 的 6 条向量 + 1 条正例进 SelfTest；三个弱化变异（去叶名检查 / 去临时根检查 / 去分隔符边界）**各被一条向量抓红** | 附录 A |
| 观察 ①③ | ① `Set-MemHeartbeat` 在采样成功后、状态机求值前写：语义是"采样成功"，接受；③ `AUTO_BET_TICK_MS` 要求字面 `0`：过严即 fail-closed，方向安全，不改 | — |
| **变异证据（v0.5）** | 守卫 **27 个**变异（含 v0.4 的 9 个中仍适用的 8 个 + N4-1 的 13 个 + N4-3 的 6 个）**全被抓红**；脚本 **15 个**变异（超时不杀 / 超时不触发 / 等待中不调 beat / 探针超时计入错误 / 守卫超时当通过 / diff 超时报无花费 / beat 内异常逃出 / 无 console 也排 diff / 节流不再触发 / Assert-UnderTmp 三种弱化 / 超时返回 -1 / 参数不加引号 / 注入点不抛）**全被抓红**。**安全说明**：没有任何变异按名字杀进程（那会波及本机其它 node）；"不杀"用"不调 Kill"变异证明 | — |
| **首次对活库的 42/42** | v0.5 守卫对**活主网库/真实 env/真实生产 index.js** 只读实跑：**`checks=42 not_ok=0`、退出码 0**（**D-027 把 `autotake_enabled` 置 false 之后**；此前 41 项中恰 1 项 MISMATCH=`autotake`）；耗时 <1 s。这是守卫**第一次**在活库上全绿 | §4.1 |

## v0.4 改动（对照 NWT 三审 `16899661` 逐条；三审已独立实测确认我上轮 M-A/M-B/M-C 的落点方向都对，这次的三条 MUST 是**新代码/新工具自己的缺口**）

| NWT 三审条目 | 处置 | 落点 |
|---|---|---|
| **N-1（MUST）** 门等待期间内存检测是**关着的**，而 v0.3 心跳把它伪装成"活着"：`Invoke-MemoryWatchTick` 只在哨兵循环里调，哨兵要等 `Invoke-PhaseB` 整体返回；`Wait-KaspadAlive` 最长 24 h（追块/RocksDB 恢复、内存最吃紧的时段）、t0 快照重试、console 300 s 校验期间都不检测；"没告警 + 心跳新鲜"被读成"内存正常"。NWT 用我的夹具加向量实测：kaspad 一直 SYNCING + CRIT 样本 ⇒ 9302 **不发** | **采纳，已修并测**：抽出**哨兵一拍 `Invoke-SentinelBeat`**（写脚本心跳 + 死亡检查 + 出站 diff + 内存锁重试 + 节流后的内存 tick，每项独立 try/catch，永不抛），在**三个等待循环每轮调用**（ALIVE 门、t0 快照重试、console 校验）+ 哨兵循环每 tick 调用。**心跳拆成两个文件**：`sentinel-heartbeat` = 脚本还活着；**`memwatch-heartbeat` = 内存检测确实产出了样本（只在采样成功后才更新）**——P3 的存活判据改看后者。NWT 的向量原样加进 SelfTest（F14：SYNCING + CRIT ⇒ 门等待期间 9302 且内存心跳新鲜；F14b 对照：正常样本不报警但仍刷新内存心跳；F15：采样失败时内存心跳**不**刷新；F17/F17b：**真** `Start-ConsolePhase` 校验循环与**真** `Invoke-OutboundSnap` 重试循环里同样触发 CRIT 报警）。变异对照 4 个各被对应测试抓红（门里去掉一拍 ⇒ F13/F14/F14b 红；内存心跳提前写 ⇒ F15 红；console 循环去掉一拍 ⇒ F17 红；快照循环去掉一拍 ⇒ F17b 红） | 附录 A、§2.1、§5、P3 页 |
| **N-2（MUST）** 守卫漏"缺省即开型"：页面 §2.6 T10 写守卫核 ZK_*/AUTO_BET/POOL_SEEDER 等，工具没核；最要紧 `MINING_CONSOLIDATE_ENABLED` 源码缺省即开且链上状态驱动，主网靠 env 一行 `=false` 挡着，守卫不核这行也不核 `MINING_RELAY_ID` 缺席；另有五个 ZK tick、`POOL_SEEDER_ENABLED`、`PREDICTION_AGENT_ENABLED`/`_PEERS`、`pool-auto-better` | **采纳，已修并测**：守卫加**第二类"缺省即开必须显式为关"**（`MINING_CONSOLIDATE_ENABLED` 必须显式 `false`、缺席即 MISMATCH；`AUTO_BET_TICK_MS` 必须 `0` 或 `DEMO_AUTOBETTER_OFF=1`），"不得为 1"补入五个 ZK tick + `POOL_SEEDER_ENABLED` + `PREDICTION_AGENT_ENABLED`，id 键补入 `MINING_RELAY_ID`、`PREDICTION_AGENT_ENABLED_PEERS`，另加 `market_seeder_config(enabled=1)`；**29 → 41 项**。**清单完整性测试**：`CRON_REGISTRY` 登记 index.js 启动期调用的全部 63 个 start-like 调用，测试从真实 index.js 自动发现并**双向对账**——新增 cron 不登记 ⇒ 红、删除调用留 STALE ⇒ 红、登记项点名的门控/表不在守卫清单 ⇒ 红、启动模块里的 `*_ENABLED`/`*_OFF` 名不在清单也不在 `ignoreGates` ⇒ 红；**并诚实标出 20 个调用只是 audit-only(15)/not-audited(5)——可见但没有运行期守卫** | 附录 C.3/C.4、§2.6 |
| **N-3（MUST，小）** 守卫与启动器是两套 env 解析器（`KEY =1` 启动器读成开、守卫报 key absent ⇒ 假 OK）；守卫只看文件，真实环境 = 继承 ∪ 文件 | **采纳，已修并测**：守卫**逐字用启动器的解析规则**（`^([^=]+)=(.*)$`、键 Trim、值原样、空值 = 删除、空名 = 启动器抛错、大小写不敏感、去 BOM、CRLF/LF/单独 CR 分行）；有效环境 = **继承 ∪ 文件（文件覆盖）**；**差分测试**：17 种行形态（含混合行尾、BOM、重复键、空值、继承变量被空值删除）与**真实 PowerShell 启动器循环**逐项比对，另单测空名情形 | 附录 C.3/C.4 |
| SHOULD：D26-scan 边角 E1/E3/E4 | **采纳并已实测**：剥注释器识别**正则字面量**（`/[^/*]+/` 里的 `/*` 不再吞掉后面的真调用；除法不是正则；`return /x*/` 是正则），扫描扩展名放宽到 `.mts/.cts/.jsx/.tsx`；用真实文件各放一次（E1/E3/E4 + 旧 A/C）全红，基线 22/22 | 测试文件 |
| SHOULD：SelfTest 递归删除加固（N-6） | **采纳**：`Assert-UnderTmp`：`$tmp` 必须在 `GetTempPath()` 之下、叶名 `boot-selftest-*`、路径比较带分隔符边界；**每次递归删除前再断言一次**（`Reset-Sim` 里与末尾各一处）。**诚实**：这条防御性断言**没有对应的变异测试**（变异"去掉末尾那次断言"没被任何测试抓到——断言只在 `$tmp` 被弄坏时才会触发，而我没有构造那种场景） | 附录 A |
| SHOULD：哨兵最外层 catch 无测试注入（N-7） | **采纳**：`-InjectFault sentinel`（异常逃出 `Invoke-SentinelLoop`，走 `Invoke-BootMain` 最外层 catch）+ 流程测试 F16；变异（最外层 catch 改为 `throw`）⇒ F16 红；R3 新增真机向量 ⑧' | 附录 A、§4.4 |
| 观察①：console 没起时仍发 9401 "no relay outpoint was spent" | **采纳**：出站 diff **只在 console 已起/认领时才排期**（`$Script:Con` 非空）；console 没起就没有"启动窗口"可归因，不发 9401 | 附录 A |
| 观察②：出站检查已知限制写 §7 | **采纳**：§7-13/16 | §7 |
| 观察③：流程测试桩里 `checks=24` 是桩文本 | **采纳**：桩改成与真实工具同量级的数字，仅为免误导 | 附录 A |

## v0.3 改动（对照 NWT 复审 `9b2e7943` 逐条；已并入下文）

| NWT 复审条目 | 处置 | 落点 |
|---|---|---|
| **M-A** 起后仍有两条 exit/终止路径：① Phase A 里 `Start-Process` 后紧接 `Set-Content kaspad.pid` 抛错 → 最外层 catch → `exit 99`；② `Invoke-PhaseB` 无 try/catch，"永不结束"安全网只在正常返回时可达 | **采纳，且已用控制流测试证明**：Phase A 在 kaspad 已知的**同一时刻**发布 `$Script:Ctx`，其后的一切（写 pid 文件、取 StartTime、写状态）各自 `try/catch`；`Invoke-BootMain` 的外层 catch **只在 `$Script:Ctx` 为空（什么都没起）时才 `Stop-Boot 99`**，否则告警 9099 并继续；`Invoke-PhaseB` 被 try/catch 包住（异常 ⇒ 9098 + 落入常驻哨兵，**不重入启动逻辑**）；哨兵循环每项职责各自 try/catch。**新增 `-InjectFault`（仅预演）与 22 条控制流测试**（真 `Invoke-BootMain` 跑在伪造原语之上）：pid 写失败 / Phase A 晚期异常（走外层 catch）/ Phase B 未捕获异常 / 探针每次抛错 ⇒ **Stop-Boot 一次都没被调用、kaspad 上下文已发布、哨兵仍在跑**；变异对照 7 个，每个都被对应流程测试抓红（含 v0.2 的 bug 本身） | 附录 A、§2.1、§4.4 R3 |
| **M-B** 附录 C 的 t0 时序错位：t0 定在 console 稳定后，但启动期拆分在 console 起后几秒就发，早于 t0，diff 抓不到它要抓的那笔；"多出任何一笔"会被外部入账误报 | **采纳**：t0 由**哨兵在 `KASPAD_ALIVE` 与起 console 之间自动取**；`+30 min` 自动 diff；判定改为 **`spent_outpoints == 0`**（出站证据；外部入账只增 `new`，无害）；**每次开机自动执行**，结果落 `boot-status.json` + 事件 9401/9402/9403/9404；快照要求**两次读数一致**（utxoindex 追平的稳定性读数，NWT 补充限制），不一致重试 ≤3 次，仍不行 ⇒ 9403 警告、**本次不做检查**（console 照起，可用性优先，且明说）。工具改为**独立小脚本 `scripts/boot-outbound-check.mjs`，不 import 任何 console 库**（NWT §四-4） | 附录 A/C、§4.5 #10 |
| **M-C** §2.6 表不足以作自启门；第 10 行安全论据"无 Mind 大脑"对 autoTaker 不成立（`autotake_enabled=true`+`mode=auto` 已上膛，靠 `agent_wallets` 空表挡着，而它不在空表清单里）；14 个转账调用点要逐个分类；要每次开机的自动守卫 | **采纳全部**：① **`autotake` 置关 = 注册门的显式前提**（Owner/Bettor 定，**不是我动**；在此之前守卫会因它 MISMATCH 而**永不自启 console**——这是设计，是逼出这个决定的机制）；② **§2.6 重写为代码级**：转账/花费调用点逐个分类（定时 / 入站消息 / HTTP / 手动），每个入站触发的配主网阳性证据；**第 10 行原论据作废并更正**；③ **`scripts/boot-guard-check.mjs`（41 项守卫）+ 哨兵在起 console 前跑它**：与"预期为零"不符（或表缺失/无法读）⇒ **不起 console（kaspad 照起）、Warning 9065、等人**。守卫覆盖 `agent_wallets`、`exchange_offers`、`pool_markets`、`pool_bettor_sides`、`oracle_registry`、`oracle_stake_enrollments`、`retail_dex_buy_publications`、`mm_orders`、`submit_intents(prepared)`、`worldcup_schedule(pending_teams)`、`zk_prove_jobs(pending)`、`chain_events(bettor_refund_available)`、`is_oracle=1` relay、`autotake_*`、`scanner_enabled`、10 个 env 开关键、4 个 env id 键。活库实跑：41 项中恰 1 项 MISMATCH（`autotake`），与 NWT 所述一致；12+8 个合成场景全过 | §2.6、附录 C、§4.3 |
| S-A 单次探针异常中止整个门 | **采纳**：循环内 try/catch，异常 = 一次失败读数（`streak=0; consecErr++`，≥5 次走既有告警），流程测试 F4 证明 | 附录 A |
| S-B git 属主 / tracked 源码干净 | **采纳**：`Test-TreeClean` 加 `git status --porcelain -- kasia-console/src kasia-relay/src` 必须为空，且四个脚本文件 `diff --quiet HEAD`；git 在 S4U 下失败（含 dubious ownership）⇒ fail-closed 且**把 git 原话写进原因**；**R2(b) 改测 `git -C D:\kanet-tn12 branch --show-current` 与 `git diff --quiet HEAD -- <脚本>`**；若撞属主检查，注册前需 `git config --system --add safe.directory`（提权，J1） | 附录 A、§4.3、§4.4 R2 |
| S-C 树外副本定案 | **Bettor 已采纳 `C:\KANetBoot\`**（脚本 + 两个工具的部署副本，sha256 记 provenance）；页内已在 4.1 前定稿。**这是本页唯一需要 Bettor 拍的路径决定**；**已知边界**：副本仍要从生产检出读探针/启动脚本/工具（树检查已覆盖它们）；副本只解决"脚本自身随检出分支漂移" | §0、§4.1 |
| S-D 优先测 WMI 脱 Job 起法 | **采纳**：R2 把 WMI `Win32_Process.Create` 起法列在**第一优先**；若证实可行，**直接把起法改成它**（常驻包装不再承重，M-A 风险面整体消失）——写成条件设计，不实现 | §4.4 R2、§2.1 |
| S-E `Get-LogTail` 真读 | **采纳**：`-SelfTest` 对 >8 KB 的真实样本文件跑 `Get-LogTail`（返回尾部、含标记、缺文件返回 null） | 附录 A |
| P3 SHOULD-1…4 | **采纳并已实现**（见 P3 页）：CIM `-OperationTimeoutSec 10` + 每 tick 写 `sentinel-heartbeat`；耗尽类错误加 HRESULT 数值匹配；`SAMPLE` 行带哨兵自身内存与句柄；内存锁失败**每 tick 重试**并写 `MEMWATCH-TAKEOVER` | 附录 A、P3 页 |
| D26-scan | **采纳并已实现**（不在本页，见 `broadcaster-utxo.test.mjs`）：只在仓库根跳 `data/logs/scratch/docs`；整文件剥注释；两个导出名都覆盖；NWT 的 A/B/C/D 四个探针固化为测试并用真实文件各验证一次 | 测试文件 |

**v0.2 相对 v0.1 的改动**（NWT 红队审 `ba660ae0`，已并入下文，此处只留索引）：M1 Phase A/B 分段、M2 认领判据收紧、M3 连续 ≥3 次 ALIVE、S1–S6、注册门改 V6、§2.6 枚举表、#10 改链上侧、D-F 加零风险测量与 H3 证据纠错、R2/R3 补向量、P3 改宿主。

## 0. 结论与需要 Bettor 定的点

**做法**：一个计划任务 `\KANet\KANet-Mainnet-Boot`，触发器"系统启动 + 延迟 2 分钟"，**不依赖任何人登录**，动作 = 一个编排脚本，按序：树检查 → 核 kaspad 二进制 → 前次停机检查 → 轮转日志 → 起/认领 kaspad → **连续 ≥3 次探针 ALIVE** → **守卫（41 项"今天为零"事实重新核）** → **t0 出站快照** → 轮转 console 日志 → 起/认领 console → 验证 → **常驻做哨兵（死亡哨兵 + 出站检查 + 提交内存检测，只告警不重启）**。

**Bettor 四点硬要求 → 本页落点**（v0.1 已答，v0.2 补 NWT 收紧后的形状）：

| # | 硬要求 | 落点 |
|---|---|---|
| ① | kaspad 命令行逐字 = (1321) §0；起前核 sha256 与 `--version` | 附录 A Phase A：sha256 全值 + `--version == kaspad 2.0.1` **不符即拒起**（退出码 21/22，此时什么都没起，可 exit）；四个参数逐字（`$kArgs`），认领判定已对活进程命令行校验 |
| ② | 日志按时间戳轮转，不毁证据 | 每次**起进程前**把非空 stdout/stderr 改名为 `<原名>.pre-boot-<yyyyMMdd-HHmmss><ext>`；只改名不删；改名失败（含目标已存在）⇒ 拒起（kaspad 侧：Phase A 退出码 30；console 侧：告警 31，不退出）；认领（adopt）的进程**不轮转**。⚠ **验收口径纠错见 §1**：kaspad 重定向 stdout 会静默停写，权威是内部日志 |
| ③ | console 前置门 = 探针 `ALIVE` | **连续 ≥3 次** `ALIVE`（≥45 s）才起 console；`SYNCING(7)`/`STALLED(8)`/连不上等都把连续计数清零 |
| ④ | 不依赖登录；失败不无限重试；写清次数与放弃后告警落点 | §2.2、§2.3（**v0.2：只有"什么都还没起"的失败才 exit，才会被计划任务重试**）、§2.5 |

**Bettor 裁定记录**：D-A（S4U + Limited）、D-B（分支不对不起 console、kaspad 照起、事件日志留原因——事件 9062）、D-C（90 分钟告警继续等 / 24 小时放弃——**v0.2：24 小时后放弃 = 告警 + 不起 console + 继续常驻，不 exit**）、D-E（事件日志 + 状态文件；"console 起来后灌 `events`"另批）**保持采纳**。**D-D 修订**：v0.1 写的"确定性失败多出 3 条事件可接受"**作废**——那个代价被低估了：按脚本自己承认的最坏假设，每次 exit 都是硬杀正在追块的节点，3 次重试 = 3 次额外硬杀。v0.2 的答案不是"接受"，而是**让 kaspad 起后根本没有 exit 路径**（M1）。

**仍需 Bettor 定的点**：

| # | 点 | 默认 | 备注 |
|---|---|---|---|
| D-F | 停 kaspad | 现阶段规则不变：重启前只停 console 与 relay 子进程，kaspad 交系统关机通知，不手动 `Stop-Process` | **依据是 n=1（今晚一次干净退出，1.7 s，低负载、非追块、交互式会话起的进程）**；P2 把 kaspad 挪进 S4U 会话，**关机通知能否送达那个会话未证**。零风险测量：脚本每次起 kaspad 前读内部日志尾行（S2），第一次自启后的**第二次**关机—开机就是直接读数；在那之前一律按"可能不干净"对待（不要在第一次自启后立刻做依赖干净停机的操作）。**H4 缺口**：不手动杀 ⇒ **kaspad 单独重启（换二进制、只需重启节点的运维）没有已知干净路径**，只能整机重启；R3 用真实起法测 Ctrl+C，**预期"没有干净手动停法"**，若证实就把"只有关机通知一条干净路径"写进 runbook，不再继续找 |
| 脚本部署位置（S1/S-C） | **已裁定：树外固定目录 `C:\KANetBoot\`**（脚本 + `boot-outbound-check.mjs` + `boot-guard-check.mjs` 三个副本） | sha256 记 provenance；谁来部署由 4.1 的落码人（Bettor 派）负责；**已知边界**：副本仍要从生产检出读探针/启动脚本/`better-sqlite3`，树检查覆盖前者 |
| 采样阈值等 | 见 P3 页（M-1…M-5 已采纳） | — |

## 1. 现状实核（只读，2026-09-19 22:3x–23:2x 本地时间；摘要）

| 项 | 读数 |
|---|---|
| kaspad | PID 16464，命令行 `"D:\rusty-kaspa-v201\kaspad.exe" --appdir=D:\kaspa-mainnet-data-v201 --utxoindex --rpclisten-borsh=127.0.0.1:17110 --rocksdb-cache-size=2048`；sha256 前缀 `8afe6a68`（全值见附录 A，本次实算，NWT 独立重算一致）；`--version` = `kaspad 2.0.1` |
| console | PID 9024（`src/index.js`），由 `scripts/start-console-mainnet.ps1` 起 |
| 已有计划任务 | `KANet-TranslateGen2` / `KANet-TranslateProto` / `KANet-VoiceService`（AI 推理侧）：**用户 ADMIN、Interactive（必须有人登录）、无触发器、运行时限 30 天**——不能当模板 |
| 已有的自启 | kaspad、console **都没有** |
| 当前会话 | `quser` 显示 `admin` 在 console 会话（ID 1）——"不依赖登录"必须靠**重启验证**证明 |
| 权限 | 本机 KANet-UI 会话 `IsInRole(Administrator)=False` ⇒ 注册启动触发器任务要**提权**（J1 EXECUTE 单） |
| PATH | `node.exe`、`git.exe` 都在**机器级** PATH |
| PowerShell | 只有 Windows PowerShell 5.1（无 `pwsh`）⇒ 脚本按 5.1 语法写 |
| **⚠ 日志证据纠错（NWT H3，Bettor 复核成立）** | `D:\kaspa-mainnet-data-v201-logs\kaspad-stdout.pre-reboot-20260919-221852.log`（10.7 MB）的**末行时间戳是 2026-09-14 16:02:06**，而该 kaspad 进程 9/13 21:12 起、跑到 9/19 21:12 才停——**重定向的 stdout 在中途静默停写了整整 5 天，成因未明**（NWT 排除了"启动器进程死则管道断"）。v0.1 把这份轮转件当作"重启前那份"是错的。**权威是 kaspad 自己的内部日志** `D:\kaspa-mainnet-data-v201\kaspa-mainnet\logs\rusty-kaspa.log`（84 MB，未轮转；今晚的关机序列 `21:12:19 P2P Server stopped … 21:12:21 Kaspad has stopped...` 就是从这里读到的） |
| 提交内存 | 22:3x 读 44–47%；**23:20 读 74.9%（已用 67.1 / 上限 89.6 GB）**——`llama-server` 16.6 GB、两个 `python.exe`（8.8 + 7.7 GB）、`vmmemWSL` 6.0 GB、kaspad 3.3 GB；(1531) 点名的进程又回来了，P1 风险仍在（不在本线范围，已只读报 Bettor） |

## 2. 设计

### 2.1 流程与退出码（v0.3：Phase A / Phase B，起后无 exit 且无未捕获异常）

```
开机 +2 min ──▶ [计划任务 \KANet\KANet-Mainnet-Boot] ──▶ mainnet-boot-sequence.ps1

Invoke-BootMain
  0  单实例文件锁 boot.lock（拿不到 ⇒ 退出 10，仅写 boot-history.log，无事件）

PHASE A —— kaspad 还没"已知"。exit 合法；**只有 `$Script:Ctx` 为空时**外层 catch 才 `Stop-Boot 99`
  1  树检查（S1/S-B）：分支 == bshard-m3-deploy ∧ 4 个脚本与 HEAD 一致 ∧ kasia-console/src、kasia-relay/src 相对 HEAD 干净；
        git 在该令牌下失败也判不通过（原因带 git 原话）⇒ 事件 9062，**只阻断 console，kaspad 照起**
  2  核 kaspad 二进制：文件在？sha256 == 钉住值？--version == "kaspad 2.0.1"？        ⇒ 20 / 21 / 22
  3  主网 kaspad 进程 = 命令行含 --appdir=<主网appdir> 或 --rpclisten-borsh=127.0.0.1:17110 的 kaspad.exe（simnet 节点忽略）
        多于 1 个 ⇒ 41；恰 1 个且命令行逐 token 相同 ⇒ **认领**；恰 1 个但命令行不同 ⇒ 42（绝不碰它）
        没有 ⇒ 读内部日志尾（S2：末行非 "Kaspad has stopped" ⇒ 事件 9205、软阈值×2）→ 轮转 kaspad 日志（失败 ⇒ 30）→ 起（起不来 ⇒ 40）
  ── **kaspad 已起或已认领的那一刻，立刻发布 `$Script:Ctx`**；此后写 kaspad.pid / 取 StartTime / 写状态 **各自 try/catch，失败只写 boot-history.log** ──
  ── Phase A 里若此后仍有异常逃出：**告警 9099，继续**（不 exit）──

PHASE B —— 永无 exit、永无未捕获异常。`Invoke-PhaseB` 整体被 try/catch 包住：异常 ⇒ 告警 9098，**直接落入常驻哨兵，不重入启动逻辑**
  4  门：每 15 s 跑探针（环境变量只给子进程；**探针本身抛错 = 一次失败读数**，S-A），**连续 ≥3 次 ALIVE** 才过
        0 ⇒ 计数+1 │ 7/8/3/4/5/9/其它 ⇒ 计数清零（8：事件 9201 一次；其它/抛错连续 5 次 ⇒ 告警 45）
        2 错网 ⇒ 告警 43 │ 6 探针依赖坏 ⇒ 告警 44 │ kaspad 进程没了 ⇒ 告警 46 │ 24 h 仍未稳定 ALIVE ⇒ 告警 50
        以上 = 记状态 + Warning 事件 + **不起 console，kaspad 与哨兵继续活**；软阈值 90 min（前次停机不干净则 180 min）未过 ⇒ 事件 9250 一次
  5  **守卫（M-C③）**：跑 scripts\boot-guard-check.mjs（42 项：41 项"今天为零"事实 + 对生产 index.js 的启动面对账，全部重新核一遍）
        全 OK ⇒ 继续；任何 MISMATCH / 表缺失 / 工具出错 ⇒ **不起 console（fail-closed）、Warning 9065（列出不符项名）、等人**
  6  **t0 快照（M-B）**：scripts\boot-outbound-check.mjs snap（18 个 relay 地址各读两次、相隔 10 s，两次须一致；不一致重试 ≤3 次，间隔 15 s）
        成功 ⇒ 记 t0；仍不稳 ⇒ 事件 9403"本次不做出站检查"，**继续起 console**
  7  console（失败只告警，不退出）
        树检查未过 ⇒ 告警 62、不起；console 进程 = 命令行含**精确生产路径**的 node.exe：多于 1 个 ⇒ 告警 61；恰 1 个 ⇒ 须拥有 :3202 ∧ 与 console-mainnet.pid 一致才认领
        没有 ⇒ 轮转 console 日志（失败 ⇒ 告警 31）→ 调 start-console-mainnet.ps1（退出码≠0 ⇒ 告警 63）→ 读 console-mainnet.pid，须是**新起的 node.exe 且命令行含生产路径**（S5）
        验证：进程活 + :3202 在听 + GET /api/system/rpc-overview 应答，最长 300 s ⇒ BOOT_OK（事件 9101）；否则告警 64，**不杀不重起**
        记 outbound 到期时刻 = 现在 + 30 min（仅当 t0 成功）
  8  常驻哨兵，每 30 s（默认）：每 tick 调 **哨兵一拍 Invoke-SentinelBeat**（**同一个函数也在 ALIVE 门 / t0 快照重试 / console 校验三个等待循环里每轮调用，N-1**）——一拍 = 写 `sentinel-heartbeat`（脚本活着）+ 死亡检查 + 出站 diff（到期）+ 内存锁重试 + **节流的内存 tick**（成功采样才写 `memwatch-heartbeat`），每项独立 try/catch，永不抛：
        · kaspad / console 判死 = PID 不在 ∨ 启动时间变了（S6）⇒ 记状态 + Error 事件 9203 / 9204，一次，不重起
        · S3：kaspad 活着而 stdout >10 min 未写 ⇒ 事件 9206 一次（启发式）
        · **出站检查（M-B）**：到期后自动跑 diff ⇒ `spent_outpoints==0` 且全部可读 ⇒ 9401(Info)；`spent>0` ⇒ **9402(Warning，带逐 relay 行)**；有 relay 不可读 ⇒ 9404；工具出错 ⇒ 9403
        · **提交内存检测（P3）**：≥85% 判定 + 文件日志（第一落点）+ 事件日志；锁被 -WatchOnly 占着则**每 tick 重试**，取到写 MEMWATCH-TAKEOVER
```

**为什么 Phase B 永无 exit、永无未捕获异常**：Task Scheduler 对"动作进程退出后它 `Start-Process` 起的子进程会不会被一并结束"**我没有实测**（R2 测）；按最坏情形设计——只要脚本退出（含**异常终止**，`-File` 模式下退出码非 0），刚起的 kaspad 可能被一并带走；配合计划任务的失败重启，就成了"每 10 分钟在 kaspad 追块窗口里硬杀一次"（NWT P2-M1）。NWT 复审指出 v0.2 还有两条漏（pid 文件写失败被外层 catch 接成 exit 99；`Invoke-PhaseB` 未包裹）——v0.3 已闭合，且由控制流测试与变异对照证明（§4.1）。**代价**：任务永远显示"正在运行"，在任务计划程序里"结束"它 = 硬杀 kaspad + console。**若 R2 证明子进程能在任务实例结束后存活**，或 **WMI `Win32_Process.Create` 起法能让 kaspad/console 脱离任务 Job（NWT S-D，R2 第一优先测）**，则应**直接把起法改成它**：脚本变成"起完就走的启动器"，常驻包装不再承重，这整条风险面消失（条件设计，不在本草案实现）。

**为什么不做运行期自动重启**：(a) console 共享 RpcClient 在 kaspad 重启后**不自愈**；(b) console 重启有花钱面（见 §2.6）。两条都需要人判断。**本任务只保证"开机拉起来"**。

### 2.2 任务定义

| 项 | 值 | 理由 |
|---|---|---|
| 名字 | `\KANet\KANet-Mainnet-Boot` | 与 AI 推理侧 `KANet-*` 分开放 |
| 触发器 | **系统启动**，延迟 `PT2M` | 不等登录 |
| 主体 | 用户 `ADMIN`，`LogonType=S4U`，`RunLevel=Limited` | D-A 已采纳；**S4U 跨会话可管理性未证，R2 测（S4）** |
| 动作 | `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<脚本路径>"`，起始目录 `D:\kanet-tn12` | **脚本路径建议指向树外部署副本**（S1）；`-ExecutionPolicy Bypass` 仅对这一次调用生效 |
| **运行时限** | **`0`（无限）** | 🔴 默认 72 小时强杀；常驻任务不设 = 开机 3 天后连 kaspad 一起杀 |
| 多实例策略 | `IgnoreNew` | 与脚本文件锁双保险 |
| 失败重启 | 3 次，间隔 10 分钟 | **v0.2：只会因 Phase A 的"什么都没起"失败触发**，见 2.3 |
| 不设 | "仅在网络可用时运行" | 开机早期不稳定；脚本自己等 |

### 2.3 重试与放弃（v0.2 收紧）

- **谁重试**：计划任务"失败后重启"，**只对脚本以非 0 退出**的情形——现在只有 Phase A：10 / 20 / 21 / 22 / 30 / 40 / 41(进程数>1) / 42 / 99。这些发生时**什么都还没起**，重试无副作用（确定性失败多几次重复而已，多几条 Error 事件，**不再有额外硬杀**）。
- **次数与间隔**：最多 3 次、间隔 10 分钟。**放弃后**任务停在"失败"，最后一条 Error 事件即放弃告警。
- **Phase B 的一切失败**（含探针/console/哨兵异常）**不触发计划任务重试**，只告警 + 常驻。
- **R2 要实测的假设**：非 0 退出码是否触发重启、是否精确 3 次后停。

### 2.4 探针环境变量（探针默认是 TN12 的）

`scripts/kaspad-rpc-probe.mjs` 默认连 `ws://127.0.0.1:17210`、期望 `testnet-12`、状态文件写 `D:/kaspa-tn12-data/…`。对主网必须设三个环境变量（脚本只给探针子进程设、`finally` 清掉，避免 console 继承——NWT 已核对）：`KASPAD_PROBE_URL=ws://127.0.0.1:17110`、`KASPAD_PROBE_NETWORK=mainnet`（**实测**：对活节点回 `ALIVE:network=mainnet daa=…`，退出码 0）、`KASPAD_PROBE_STATE=<可写路径>`（不设则写到已退役的 TN12 目录，写失败被静默吞掉 ⇒ 卡死判定永不触发）。探针未改动；退出码语义照其头注释（NWT 已逐分支核）。

### 2.5 告警落点（"放弃后告警落在哪"）

console 没起来时 `events` 表写不了，所以三处都**不依赖 console**：

| 落点 | 内容 | 读法 |
|---|---|---|
| Windows 事件日志 · Application · 源 `KANetBoot` | 9100 开始 / 9101 正常；**9000+退出码**（Phase A 失败 Error；Phase B 的 43/44/45/46/50/97/98 是 Warning）；console 告警 9031/9061/9062/9063/9064；9201 kaspad 卡同步；9205 前次停机不干净/未知；9206 stdout 停写；9250 90 分钟未稳定；9203/9204 运行期死亡；**内存 9301–9305、9310–9313（见 P3 页）** | `try { Get-WinEvent -FilterHashtable @{LogName='Application';ProviderName='KANetBoot'} -MaxEvents 30 -ErrorAction Stop } catch { 'no KANetBoot events (source not registered yet, or none written)' }`（**源未注册时 `Get-WinEvent` 会抛错而不是返回空**，所以要包 try/catch）。**源要先由提权会话注册一次**（§4.2）；**没注册时脚本只写文件日志，不报错**（`-WatchOnly` 在普通用户会话里就是这种情形，已实测：事件写失败被记进 `boot-history.log`，文件日志照常） |
| `logs\mainnet\boot\boot-status.json` | 最新阶段 + 时间 + 细节 | `Get-Content` |
| `logs\mainnet\boot\boot-history.log`、`memory-watch.log` | 阶段序列；内存采样与状态跳变（**第一落点，先于事件日志**） | 追加文本 |

不含密钥、余额、地址。不通知 Owner 手机（D-E）。

### 2.6 "console 启动后无人干预即可能发链上交易的路径"枚举表（v0.3：**代码级**；NWT 复审 M-C）

**方法与证据**：① **代码级只读审计**（一个只读子 agent 逐个读源码，我对其中承重结论逐条复核）——范围：非测试源码里所有下发 relay IPC 命令 `transfer`（含常量 `COMMAND_TYPES.TRANSFER`）及其它花费类命令的调用点，按触发类分类；② 主网 console **当前进程的启动日志**（`logs\mainnet\console-mainnet-stdout.log`：`started` / `disabled` / `NOT started`）；③ 主网库 **`readonly`** 计数与 `config_entries` **非敏感开关行**；④ `kanet.mainnet.env` **只核键是否存在与布尔值，不读任何密钥**。**判定口径**：花不花钱取决于**库里的数据**的路径标"数据依赖"——它们"今天为零"由**表为空**保证，不由代码保证；v0.3 起这些"今天为零"由 §2.1 第 5 步的**守卫每次开机重新验证**。

**先更正 NWT 的盘点与我自己 v0.2 的论据**：
- **v0.2 §2.6 第 10 行的安全论据"`trading_config_json` 非空的 relay 0 个（无 Mind 大脑可下决定）"对 autoTaker 不成立——作废。** autoTaker 不依赖 Mind、不依赖 `trading_config_json`；它是 **`config_entries` 里 `autotake_enabled=true` + `autotake_mode=auto`（migration v88 于 9/13 播种，非任何人的裁定；我读库复核成立）已上膛**的入站触发路径，今天为零靠的是**三层"碰巧"**（见下表 I1），而其中 `agent_wallets` 空表原先**不在**空表清单里。
- **NWT 的 14 文件转账盘点需修正（子 agent 实读）**：`episode-builder.js`（6 处）**不是花费点**（是 UI 时间线/证据对象，无 relay import）；`broker-intake-watcher.js`（8）与 `broker-action-queue.js`、`settler-router.js` 用的是**常量** `COMMAND_TYPES.TRANSFER`，`type: 'transfer'` 字面 grep 会漏；**NWT 清单漏掉**：`api/pool.js`（8 处经 `transferAndConfirm`）、`api/bettor.js`（3 处经 `transferWithIntent`）、`api/relay.js` 的通用 send-command 透传、`agent-mind/src/mind.mjs`（在 `src/` 之外）、`bshard-close-transport.mjs` 的 3 处（NWT 只列了 1 个文件名）。
- **⚠ 当前运行中的 console（PID 9024，22:21:24 起）跑的是 D-026 合入之前的旧代码**——所以它的启动日志里 `[utxo-splitter]` 仍是旧行为、`[broadcaster-utxo] started` 仍在；D-026 的默认关只在**下一次重启**后生效（V6 才是证据）。

**A. 定时器类（console 启动即起）**

| # | 路径（file:line） | 发什么 | 触发条件 / 关键守卫 | 主网现状（证据） | 无人干预会花钱吗 |
|---|---|---|---|---|---|
| T1 | 启动期 `autoSplitAll()`（`index.js:871`） | `split_utxo` target=8 | 每次启动一次；D-026：`UTXO_AUTOSPLIT_ON_START!=='1'` 早退（`utxo-splitter.js`） | **旧代码 22:21:34 实发 4 笔**（KANet-UI 5 出 / Trader-A 7 出 / Trader-M 3 出 / Bettor 2 出；`kaspa_tx_log` 有这 4 行） | **是（每次启动）**，直到 D-026 上线；上线后由开关保证，守卫核 env 键 |
| T2 | `broadcaster-utxo` cron（`index.js:815`） | `split_utxo` target=30 force | 启动 90 s 后首 tick、每 180 s；目标 = `is_oracle=1` ∪ `POOL_SEEDER_MAKER_RELAY` ∪ `BROADCASTER_RELAY_IDS`；D-026：`BROADCASTER_UTXO_MAINTAIN!=='1'` 不注册 timer | `is_oracle=1` 0 行；两个 env 键不存在；日志只有 `started`（旧代码） | **数据依赖**；上线后由开关保证；守卫核 `is_oracle` 行数与两个 id 键 |
| T3 | `oracle-pool-renewal-cron.mjs:68`（`index.js:791`，除非 `ORACLE_OFF=1`） | `transfer`（续期质押，默认 2 KAS） | `oracle_stake_enrollments WHERE active=1 AND lock_until_daa−now<3M`，且 `relay_address` 匹配 `relay_nodes` | 日志 `started`；tick 行 "no renewals needed (closest_expiry=N/A)" | **数据依赖**（表空）；守卫核 `oracle_stake_enrollments` 行数 |
| T4 | 预测结算族：`bettor-prediction-settler.js`（`index.js:692` 无条件起）+ `submit-intent.mjs:171/243`（`resumeStaleIntents`/payout sweep） | `transfer` / `prediction_settle_tx`；重放 `submit_intents status='prepared'`（>2 min） | `exchange_offers` 处于 matched/verifying/collecting_sigs 且到期；`submit_intents status='prepared'` | 日志 `started`；无 "payout sweep:"/"intent resume:" 行（仅 `scanned>0` 才打）；`exchange_offers` 0、`submit_intents` 0 | **数据依赖**；守卫核 `exchange_offers`、`submit_intents(prepared)` |
| T5 | `pool-market-settler.js`、`bettor-refund-claim-auto.mjs:133`（`index.js:735`）、`pool-house-agent.js` | `pool_settle_tx`/`pool_refund_*`/`pool_side_refund_cancelled_tx`；house-agent 经 HTTP 自调下注 | `pool_markets` 各状态到期；refund 候选 = `pool_bettor_sides` ⋈ `chain_events(bettor_refund_available)`；house-agent 需名为 `HouseAgent` 的 relay 且 `pool_markets` 有世界杯盘 | 日志 `started`；`pool.selectMarkets … rows=0`；`pool_markets` 0、`pool_bettor_sides` 0、`chain_events(refund_available)` 0；**无 `HouseAgent` relay** | **数据依赖**；守卫核上述三表与 `chain_events` |
| T6 | `worldcup-schedule-cron.mjs:92`（`index.js` 启动） | 间接：POST `create-v07` ⇒ `transferAndConfirm` 100 KAS maker 质押 | `worldcup_schedule status='pending_teams'`；**console 基址默认 `127.0.0.1:3200`（主网 console 在 3202）**；maker id 默认硬编码的 TN12 uuid | 日志 `started`；`worldcup_schedule(pending_teams)` 0；3200 无监听 | **数据依赖 + 被"配置碰巧"挡着**；守卫核 `worldcup_schedule` |
| T7 | market seeder + deposit watcher + **refund worker**（`market-seeder.js`） | 发 offer（`send_broadcast` 费）；refund worker 发 EVM USDT 退款 | `market_seeder_config.enabled`（默认 0，主网 0）；refund worker 需 `retail_dex_buy_publications` 行 | 日志 `started`；`enabled=0`；`retail_dex_buy_publications` 0 | 今天为零（**开关关 ∧ 表空**）；守卫核该表 |
| T8 | `exchange.expireTick`（`index.js:310`，30 s） | `send_broadcast`（协议消息的手续费） | `exchange_offers` 超时行 | 0 offers | 数据依赖，仅费 |
| T9 | `agent-mind/src/mind.mjs:988`（`mind-manager` 主动调度） | `SEND_KAS`（HTTP 自调 `transfer`） | `minds[name]` 必须存在且有 `runProactive` | 日志 "No relay nodes with adapters, skipping Mind init"（`minds` 空）；`adapter-launcher 0/0` | 今天为零（无 Mind 实例） |
| T10 | 结算守护/ZK/bshard 族：`settle-daemon` + 4 个 ZK tick、`zk-prove-worker`、`bshard-close-voter`/`-v2`、`bshard-close-submit-v2`、`proto-driver`、`pool-auto-better`、`pool-market-seeder` | 各类 covenant/settle/bet | 各自 env 开关（`SETTLE_DAEMON_ENABLED`、`ZK_*`、`BSHARD_*`、`PROTO_DRIVER_ENABLED`、`AUTO_BET_TICK_MS=0`、`POOL_SEEDER_ENABLED=0`） | 日志逐行 `disabled (…!=1)` / `NOT started`；`[proto-driver] disabled` | **否（开关关，日志阳性证据）**；守卫核这些 env 键不为 `1` |
| T11 | `mining-consolidate`、`faucet-health`、`bot-autofund` | `consolidate_utxo`/`transfer` | env 开关 / relay id 配置 | `MINING_CONSOLIDATE_ENABLED=false — cron not started`；后两者 `… not set — cron not started` | **否（但 `MINING_CONSOLIDATE_ENABLED` 是缺省即开型：主网现在只靠 env 里一行 `=false` 挡着；v0.4 守卫要求它显式为 `false`、缺席即 MISMATCH，并核 `MINING_RELAY_ID` 缺席）** |
| T12 | broker 族（`broker-intake-watcher`、`broker-action-queue` 等，含 5 分钟补零钱拆分） | `transfer`（退款/发币）、`split_utxo` | 只在 `if (BROKER_ENABLED==='1')` 块内加载（`index.js:904`）；模块顶层无 `BROKER_RELAY_ID` 即抛错 | 日志 `[broker] disabled (BROKER_ENABLED!=1)`；`BROKER_ENABLED` 键不存在；`[broker-utxo-split]` 0 行 | **否**；守卫核 `BROKER_ENABLED` |

**B. 入站触发类（外部消息驱动，无人在场也会执行）**

| # | 路径（file:line） | 发什么 | 守卫链（引用即代码坐标） | 主网现状（阳性证据） | 无人干预会花钱吗 |
|---|---|---|---|---|---|
| **I1** | **autoTaker** `_evaluateAutoTake`（`trade-protocol-filter.js:1963-2210`；入口 = kaspa-scout 上报 → `POST /api/chat/ingest` → `onBroadcastWritten` → `handleExchange`） | 自动接单 + **EVM USDT 支付**（`_autoPayExchange`，用 `agent_wallets` 私钥；**不是** KAS `transfer`） | ① scout 开着（`scanner_enabled`：`scanner.js:259-263`，`enabled && enabled!=='false'`）② `autotake_enabled==='true'`（:1968）③ 自己 offer/方向/折扣/金额/日限/冷却（:1973-2018）④ **`agent_wallets` 存在默认 bnb 钱包，否则 `if (!bestRelay) return;`（:2025-2033）**⑤ 信誉（:2040）⑥ `autotake_mode==='auto'` 才执行，`approval` 只写提案（:2075）⑦ 接单 HTTP POST 到**硬编码 `localhost:3100`**（:2121） | ① **`config_entries` 里 `scanner_enabled` 行不存在 ⇒ 关**（我读库核；启动日志也无 `[scanner] auto-starting`）② **`autotake_enabled=true`、③ `autotake_mode=auto`（已上膛，v88 播种）**④ **`agent_wallets` 0 行** ⑦ 主网 console 在 3202，`3100` 无监听 | **今天不会，靠三层"碰巧"**：scout 关 + `agent_wallets` 空 + 端口硬编码不对。**任何一层变了**（有人启动 scout——`startScanner` 会持久化 `scanner_enabled=true` 并在之后每次开机自启；导入一个 bnb 钱包；改端口）**都会让"已上膛"的路径接上**。守卫核这三项；**`autotake` 置关是注册门前提** |
| I2 | `handleExchangePaid` → `exchange-machine.js:1043 _verifyAndComplete` | KAS `transfer` 交割给 taker | 走同一入站链（scout 开着）；需已有 offer 处于 matched/verifying（`trade-protocol-filter.js:2538`）、支付已验证并达落链深度（`exchange-machine.js:889-895`）、maker 是本地 relay | `exchange_offers` 0 行；scout 关 | 今天为零（表空 + scout 关） |
| I3 | `settler-router.js:47`（`_autoSettleAsset`，`trade-protocol-filter.js:2978`） | KAS `transfer` | `verification==='kaspa_tx'`、本地 taker relay 非 dex-broker、资产受支持 | 同上 | 今天为零（同上） |
| I4 | 池预言机 sign_req 处理 `handlePoolOracleTxSignReq`（`trade-protocol-filter.js:571-723`） | `send_broadcast`（sign_resp 费）+ `sign_input_for_settle`（**不是 KAS 转账**） | `pool_markets` 行 + `pool_committee` 行 + 本地 `is_oracle=1` relay | `pool_markets` 0、`is_oracle=1` 0 | 今天为零（表空） |
| I5 | 池退款请求 `handlePoolRefundRequest`（:168-212） | `pool_refund_*` IPC | 本地 `pool_markets` 行、`maker_pk` 与本地 maker 一致等 | `pool_markets` 0 | 今天为零（表空） |
| I6 | 预测 agent（DM 入口）`prediction-agent-mind.mjs:385` | KAS 下注（HTTP 自调） | `PREDICTION_AGENT_ENABLED==='1'` 或 `_PEERS`，且用户 `/predict` 确认流程 | `kanet.mainnet.env` 该键 `=0` | **否** |
| **I7** | **relay 内建的入站握手自动接受**（`kasia-relay/src/rpc-listener.mjs` 约 :915-1004；这是 relay 进程自己发，**不是** console IPC `transfer`） | 对新对端自动发一笔**小额接受交易**（日志记 0.2 KAS）+ 可选问候消息 | 黑名单、进程内与 console `relation_states` 去重、原子 claim；**我在该区间未见 env 开关**；**与 `scanner_enabled`、`agent_wallets`、任何库表都无关** | 当前与死机前两份 console stdout 中 `HANDSHAKE ACCEPTED` 均 0 行——**只证明这两个窗口没发生，不证明它是关着的** | **⚠ 入站触发、无库表前提、未见开关**：**守卫覆盖不到**（没有可验证的"零"）。类别与影响：**有界但无人值守的链上花费**；量级与上限评估**不入本页**（D-021；已单独报 Bettor，由其决定归档处）。**开放项：是否给它一个开关，交 Bettor/NWT 判** |

**C. HTTP 类与手动类**：需要调用者主动触发的路由（`api/relay.js` 的 `transfer` 与通用 send-command 透传、`api/pool.js`、`api/bettor.js`、`api/trading.js`、`api/chat.js` 的 faucet（拒非 `kaspatest:` 地址）、`api/operator-settle.js`、`api/capability.js`、`api/tg-wallet.js` 等）——**它们的鉴权强弱不在本页写**（D-021：未修复面的细节不入库；相关票 `T-LOOPBACK-AUTHZ` 族，细节不入库）。**对"无人值守"这一问题它们的含义是：没有人调用就不发；但"本机任何进程都能调用"这一点意味着自启后本机上任何其它进程的行为也在花费面之内**——这是 P1（同机争资源/同机多租户）与 T-LOOPBACK-AUTHZ 的范围，不是本任务能解决的。
- 手动/库类：`relay-manager.js:531 transferAndConfirm` 是 helper（触发在 A/C 类里）；`submit-intent.mjs`、`broker-action-queue.js` 是库。

**D. 子 agent 明说"未能确定"的（原样保留）**：主网库中除已知的空表外的行数是**从日志推断**（我已对 `scanner_enabled`、`submit_intents`、`worldcup_schedule`、`zk_prove_jobs`、`chain_events(refund_available)`、`oracle_stake_enrollments` 补了只读实测，全为 0/无行）；**relay 侧 `processComm`/`processPayment` 是否有自动回复/自动付款没有追**；`api/capability.js`、`api/tg-wallet.js` 的 `custodial_transfer` 发送方没追（`TELEGRAM_BOT_TOKEN` 未设，bot 未起）；`api/exchange.js`、`api/oracle-pool.js`、`api/escrow.js` 里用 `send_broadcast` 的 HTTP 处理没读；各 HTTP 路由的"鉴权"结论只覆盖读到的前 20–35 行。

**读表结论（Owner 口径）**：D-026 上线且 **`autotake` 被置关**后，主网 console 启动后无人干预的链上花费 = **"今天为零，由：两个默认关的开关（T1、T2）+ 一批默认关的 env 开关（T10–T12）+ 若干张空表（T3–T8、I2–I5，每次开机由守卫重新验证）+ 一个被置关的自动接单（I1）保证；I7（relay 内建入站握手自动接受）不在保证之内，是未闭合的开放项"**。**不是**"启动期不再花钱"。任何一次守卫 MISMATCH 都会让 console **不自启**（kaspad 照起）并发 Warning 等人——这是**有意的可用性代价**。

**关于"保险丝"（NWT ②-4）**：仅当 Owner 决定**保留**启动拆分时需要（拆分不收敛，5→4→5 来回摆，每次重启都烧）。D-026 已定默认关 ⇒ **不适用，不做**。

## 3. 前置检查（只读；任何时候都能跑）

| # | 检查 | 命令 | 期望 |
|---|---|---|---|
| 3.1 | 生产检出分支 | `git -C D:\kanet-tn12 branch --show-current` | `bshard-m3-deploy` |
| 3.2 | 主网 kaspad 进程恰 1 个且命令行逐字（simnet 节点不计） | `Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'" \| Select ProcessId, CommandLine` | 命令行含主网 appdir 的恰 1 行 = 附录 A `$kArgs` 四个参数 |
| 3.3 | kaspad 二进制哈希与版本 | `(Get-FileHash D:\rusty-kaspa-v201\kaspad.exe -Algorithm SHA256).Hash` 与 `& D:\rusty-kaspa-v201\kaspad.exe --version` | 与附录 A 常量逐位相同；`kaspad 2.0.1` |
| 3.4 | 脚本"认领"判定对活进程成立 | 已跑：把脚本的判定函数对活 kaspad 命令行核（**抓到并修了"单个结果被展开成标量、`.Count` 为空、会去起第二个 kaspad"的真 bug**——调用处必须 `@(...)`）；v0.2 又加了 simnet/worktree 伪造记录夹具 | `True`；夹具全 PASS |
| 3.5 | 主网探针 | `$env:KASPAD_PROBE_URL='ws://127.0.0.1:17110'; $env:KASPAD_PROBE_NETWORK='mainnet'; $env:KASPAD_PROBE_STATE='<可写路径>'; node scripts\kaspad-rpc-probe.mjs; $LASTEXITCODE` | `ALIVE:network=mainnet …`、`0`（只读，一次连接） |
| 3.6 | 现有任务里没有同名任务 | `Get-ScheduledTask -TaskName KANet-Mainnet-Boot -ErrorAction SilentlyContinue` | 无输出 |
| 3.7 | 机器当前状态（记基线） | kaspad PID + `CreationDate` 完整值；console PID（命令行含**精确生产路径**）+ `CreationDate` | 记下；预演后核未变 |
| 3.8 | 前次停机是否干净（内部日志） | `Get-Content D:\kaspa-mainnet-data-v201\kaspa-mainnet\logs\rusty-kaspa.log -Tail 3` | 末行含 `Kaspad has stopped`（今晚重启前那次是；**当前运行期间的日志末行当然是运行中的行**——此项只在 kaspad 已停时有意义） |

## 4. 执行步骤（每步四段：前置 → 动作 → 验收读数 → 中止/回滚）

### 4.1 落码：`scripts/mainnet-boot-sequence.ps1`、`scripts/boot-outbound-check.mjs`、`scripts/boot-guard-check.mjs`

**门**：NWT 再审本页（含附录 A/C）→ Bettor 批（铁律 0）。**树外部署副本目录已裁定 = `C:\KANetBoot\`**（NWT S-C：这是 S1 的核心，否则脚本自身仍随检出分支漂移）：把脚本与两个工具原样部署到该目录、**sha256 记 provenance**，计划任务动作（附录 B）指向该副本；副本内 `-KanetRoot` 仍指向生产检出读探针/启动脚本/工具依赖。
**前置**：在 `scratch\_kanetui_wt_<name>` 独立 worktree 里做，**不动生产检出**；不 junction 活 node_modules（脚本不需要；两个工具的 `better-sqlite3` 只从生产 console 树 `readonly` 读——**这是对 console 树依赖的唯一一处，工具不 import console 的任何库代码**）。
**动作**：把附录 A 与附录 C 原样落为三个文件（ps1 **仅 ASCII**）；`node scripts\lint-kanet.mjs <三个文件>`；采纳 S-C 则另出树外副本并记 sha256。
**验收读数**：
1. `[System.Management.Automation.Language.Parser]::ParseFile` 无错误；
2. `powershell.exe -NoProfile -File scripts\mainnet-boot-sequence.ps1 -SelfTest` ⇒ **全 `PASS`、`SELFTEST failures=0`、退出码 0**（v0.5 草案已跑：**105 项 PASS**（v0.4 为 82；v0.5 新增 23 项：6 条真 node 子进程的父侧超时测试、N4-2 四条流程、N4-4 三条 + 一条真实时间节流向量、`Assert-UnderTmp` 七条直测、第二条真实内存读数向量 3 条——见 P3 页 1.2）——伪造进程夹具、15 条状态机向量 + 12 条变异、采样失败路径、HRESULT 数值匹配、`Get-LogTail` 真读 >8 KB 文件、2026-09-19 23:20 真实读数向量、**22 条控制流测试**）。`-SelfTest` **不起 kaspad / console 等业务进程**（v0.5 起会起**测试自己创建的**几个 node 子进程——含一个故意占 20 s 的忙循环，用来证明父侧超时——且只杀它们自己），且**开头强制断言所有可能被触碰的路径都在临时目录内**（见 §7-9 的事故教训）；
3. **控制流测试的证明力**（NWT 要求"不能拿 PASS 条数当证据"，所以**用变异证明它们在守东西**）：真 `Invoke-BootMain` 跑在伪造原语之上，覆盖 F1 正常顺序（起 kaspad→守卫→t0 快照→console）、F2/F2b/F3/F4 四种注入（pid 写失败 / Phase A 晚期异常走外层 catch / Phase B 未捕获异常 / 探针每次抛错）⇒ **`Stop-Boot` 一次都没被调用、kaspad 上下文已发布、哨兵仍在跑**、F5 二进制哈希不符（起前失败：**Stop-Boot 21 且什么都没起**）、F6 守卫不符（不起 console、无快照、9065）、F7 t0 不稳（9403，console 仍起）、F8 树不干净（**真** `Start-ConsolePhase` 返回 null、9062）、F9–F11 出站 diff 自动跑在 console 之后且 `spent>0`⇒9402、不可读⇒9404 而非 9401、F12 内存锁被占后重试接管。**7 个脚本变异各自被对应流程测试抓红**：外层 catch 恒 exit（v0.2 的 bug 本身）⇒ F2b 红；Phase B 异常不包裹 ⇒ F3 红；探针异常中止门 ⇒ F4 红；t0 挪到 console 之后 ⇒ F1/F9 红；守卫结果被忽略 ⇒ F6 红；不可读 relay 报成 clean ⇒ F11 红；内存锁不重试 ⇒ F12 红。
4. 工具测试（v0.5）：**`boot-guard-check.test.mjs` 126 项全过**（每张空表/每个开关/两个默认开开关/id 键/继承与文件覆盖/大小写/`KEY =1`；**17 种行形态与真实 PowerShell 启动器逐项差分**；清单钉住；**index.js 全部相对模块标识符 / 定时器 / 裸导入与声明面的反转对账（v0.5）**）+ **27 个变异各被抓红**；对活库实跑（D-027 置 false 之后）**42 项全 OK、退出码 0**（此前 41 项中恰 1 项 MISMATCH = `autotake`）。`boot-outbound-check.mjs` 对活节点 snap→diff = 0 变化，三个合成变异（删一个真 outpoint ⇒ exit 3；只多出一个（入账）⇒ exit 0 不误报；某 relay 不可读 ⇒ exit 4）。

**中止/回滚**：任一失败 ⇒ 不合入。回滚 = 不合入/`git revert`，无运行时效果（脚本没被任何东西调用）。

### 4.2 一次性：注册事件源（提权，J1 EXECUTE）

**门**：4.1 已合入。**前置**：`[System.Diagnostics.EventLog]::SourceExists('KANetBoot')` 为 `False`。**动作**（提权）：`New-EventLog -LogName Application -Source KANetBoot`。**验收读数**：`SourceExists` ⇒ `True`；写一条测试事件（id 9199）并 `Get-WinEvent` 读回。**回滚**：`Remove-EventLog -Source KANetBoot`。

### 4.3 注册计划任务（提权，J1 EXECUTE）

**门（v0.3 再收紧）——以下**全部**成立才注册**：
1. 4.2 通过；**预演 R2 通过**（含 git 属主实测，见 R2(b)）；
2. **D-026 开关已合入主线、已部署，并且运行中的主网 console 自己的 stdout 出现**：`[utxo-splitter] disabled (UTXO_AUTOSPLIT_ON_START!=1, raw=undefined)` 恰 1 行、`[utxo-splitter] … → … UTXOs` 0 行、`accounts split` 0 行、`[broadcaster-utxo] disabled (BROADCASTER_UTXO_MAINTAIN!=1, raw=undefined)` 恰 1 行、无 `[broadcaster-utxo] … rebalanced`。**这是 V6，是权威；静态 grep env 文件（V5）只是辅助**——console 子进程继承启动者 shell 的环境，`start-console-mainnet.ps1` 只往进程环境里加值、不清除继承变量。**（状态（Bettor (1542)）：已合入主线 `4e16ce39`，NWT 审 diff `99195212` GREEN、18 个变异 0 存活；合入不生效，V6 待下一次 console 重启核——所以本门此刻仍未过。）**
3. **主网 `autotake` 已被 Owner/Bettor 置关**（`autotake_enabled=false` 或 `autotake_mode=approval`——**一个 `config_entries` 写入，不是代码；Owner/Bettor 定，我不动**）。**已置关：D-027 于 2026-09-19T19:18:00Z 执行（`autotake_enabled` true→false，`autotake_mode` 未动；事件 `40ee32d7…`；Bettor 事后独立核，账本 1579）**；置关前，`boot-guard-check.mjs` 会因它 MISMATCH ⇒ **哨兵永不自启 console**。所以这一条**既是前提，也是被机制强制的**：不做这个决定，自启在功能上就不会拉起 console。**（NWT M-C①）**
4. **守卫工具已落地并对活库跑绿**（v0.5：**42 项全 OK 已于 2026-09-19 19:47Z 对活库实测**，即上一条完成后）；I7（relay 内建入站握手自动接受）**已有 Bettor/NWT 的处置结论**（加开关或明确接受为已知有界面）——它不在守卫覆盖内（§2.6-I7）；
5. Bettor 出 EXECUTE 单。
> 原门"D-G 已有 Owner 决定"**作废**：那句话无法区分"决定不加开关"与"开关还没做"。

**前置**：3.6 ⇒ 无同名任务；3.1 ⇒ 分支正确；脚本与两个工具已落在生产检出（或树外副本）且哈希记录在案；**若 R2(b) 显示 S4U 令牌下 git 撞"dubious ownership"**：先由提权会话 `git config --system --add safe.directory D:/kanet-tn12`（范围最小：只这一个目录），否则树检查恒不通过、console 永不自启（fail-closed，但开机才发现）。
**动作**：附录 B 的注册命令（提权）。**注册后立刻**：`Get-ScheduledTask … | Select -Expand Triggers/Settings` 逐项对 §2.2 表。
**验收读数**：`ExecutionTimeLimit`=`PT0S`；`RestartCount`=3、`RestartInterval`=`PT10M`；`MultipleInstancesPolicy`=`IgnoreNew`；触发器 Boot、`Delay`=`PT2M`；主体 `S4U` + `Limited`。**注册本身不运行任务、不影响正在跑的 kaspad 与 console。**
**回滚**：见 §6。

### 4.4 预演（在真重启之前，逐级）

| 级 | 做什么 | 验收 | 风险 |
|---|---|---|---|
| **R0** | 语法解析 + `-SelfTest`（4.1 已含）；另可在**普通用户会话**跑 `-WatchOnly`（**只做内存检测、不起任何进程**）：先用**临时 `-KanetRoot`** 与调低的阈值验证告警路径（已跑过：`STATE enter-warn`、第二实例被文件锁拒绝退出码 10、未起任何进程），再以真实阈值挂在生产上；**并让它跑 ≥ 数小时，看 `SAMPLE` 行里 `sentinel_ws=` 与 `handles=` 不单调增长**（NWT P3 SHOULD-3——一个内存检测器不该成为内存增长者） | 见 P3 页 | `-WatchOnly` 在生产上跑会往 `logs\mainnet\boot\` 写日志与锁文件——**需 Bettor 明说** |
| **R1** | **认领演练（幂等）**：kaspad 与 console 都在跑的现状下，手动运行一次脚本。预期：`KASPAD_ADOPTED` → 连续 3 次 ALIVE → **守卫 ⇒ 现状 `autotake` 仍 MISMATCH ⇒ 9065、不认领 console**（这本身就是对守卫的一次真机演练）→ 常驻；**不起任何进程、不轮转任何日志**。验完结束该脚本进程 | 进程表 kaspad/console 的 PID 与 `CreationDate` **不变**；没有新增 `*.pre-boot-*`；simnet 验证节点或隔离 console 在跑时判据**不受影响** | **需 Bettor 明说，且必须在 NWT 审过脚本草案之后** |
| **R2** | **计划任务语义实测（无害动作）**，由 J1 注册一次性演练任务 `\KANet\KANet-Boot-Rehearsal`，主体与 §2.2 相同（S4U、Limited）、触发器"手动"：<br>**a) 起法与存活性（NWT M-A/S-D；第一优先）**：**先测 WMI `Win32_Process.Create` 起 `ping.exe -t 127.0.0.1`（是否脱离任务 Job、任务实例结束后是否存活）**；再测 `Start-Process` 起法（脚本以退出码 7 退出：子进程是否还活着；非 0 退出是否触发"失败重启"、几次后停）。**若 WMI 起法成立，直接改脚本起法（§2.1 末段），常驻包装不再承重**<br>**b) 令牌能力（NWT S-B）**：常驻变体下测 `node -v`、**`git -C D:\kanet-tn12 branch --show-current`**、**`git -C D:\kanet-tn12 diff --quiet HEAD -- scripts/start-console-mainnet.ps1`**（S4U 令牌可能撞 git 的 dubious-ownership 检查——只测 `git --version` 不够）、读非敏感本地文件、写 `logs\mainnet\boot\` 下文件<br>**c) 跨会话可管理性（NWT S4）**：任务起的 `ping -t`，从**交互式非提权会话**读其 `CommandLine`、`Stop-Process` 它 | a) 子进程存活与否、重启次数 = 3；b) 全部成功（git 失败 ⇒ 按 4.3 前置加 `safe.directory` 后重测）；**c) 读得到命令行且停得掉；若不成立 ⇒ 回报 Bettor 换 D-A 备选，不硬上**。演练完 `Unregister-ScheduledTask` | 只起 `ping`，不碰主网进程 |
| **R3** | **起动路径演练（隔离，不碰主网）**：用脚本参数覆盖对一个 **simnet kaspad + 全新临时数据目录**（`scratch\`，端口避开 J2 的 simnet 与主网 17110，先确认没人占用）跑。**必须用与真实路径相同的起法**（S4U 任务 → 真实起法 → 重定向）。**`-SkipConsole` 打开**。向量：<br>① `KASPAD_STARTED` → 连续 3 次 `ALIVE` → `KASPAD_ALIVE`；再跑一遍 ⇒ `KASPAD_ADOPTED`，首遍日志被轮转成 `pre-boot-<ts>`；<br>② 故意把 `-KaspadSha256` 改错一位 ⇒ 退出码 21、**没有起进程**；<br>③ **（NWT M-A，真机版）`-InjectFault probe`** ⇒ **kaspad PID 不变、脚本仍常驻、事件 9045**；<br>④ **（新）`-InjectFault pidfile`** ⇒ **kaspad PID 不变、脚本进程不变、boot-history.log 有 pid 写失败一行、无 exit**；<br>⑤ **（新）`-InjectFault phasea-late`**（走外层 catch）⇒ **kaspad PID 与脚本都不变、事件 9099**；<br>⑥ **（新）`-InjectFault phaseb`**（Phase B 未捕获异常）⇒ **kaspad PID 与脚本都不变、事件 9098、哨兵心跳文件持续更新**；<br>⑦ **Ctrl+C / 关机通知（NWT H1/H4）**：测"`GenerateConsoleCtrlEvent` 能否送达该真实起法的隐藏进程"（预期：`-WindowStyle Hidden` 有隐藏控制台可能可达，`CREATE_NO_WINDOW` 无控制台不可达）；**这测的是 Ctrl+C，不是系统关机通知，两条路径不同、不能互相代替**；<br>⑧' **（v0.4，NWT N-7）`-InjectFault sentinel`**（异常逃出哨兵循环、走最外层 catch）⇒ **kaspad PID 与脚本都不变、`boot-history.log` 有 `sentinel loop threw` 一行、心跳持续更新**；<br>⑧ 前次停机检查：构造"末行非 `Kaspad has stopped`"的内部日志夹具 ⇒ 事件 9205、软阈值×2 | 逐向量记录；**③–⑥ 是 NWT 点名的真机注入向量，`-SelfTest` 的伪造原语测试只是它的预演，不能代替**；探针对 simnet 的 `network` 字符串未验证——先读，不符则只测起/轮转/认领，不测门 | 起一个 simnet kaspad（临时目录），事后结束并清目录 |

### 4.5 真重启验证（需要 Bettor GO；本机全部会话会被切断）

**门**：4.3 已注册 + R0–R3 全过 + Bettor GO + Owner 知悉（同 9/14 先例）。
**前置**：NO-TX 检查（console stdout 近 2 分钟无 `broadcast`/`submitTransaction`/`send_tx`）→ 停 console（PID 文件）→ 清 `relay.mjs` 遗留子进程 → **不手动停 kaspad**（D-F：交给系统关机通知）→ `shutdown /r /t 10`。**先停 console 与 relay 子进程，再关机**（(1531) P4）。**不再有人手取 t0 快照**——t0 由哨兵在起 console 之前自动取（M-B）。
**动作**：`shutdown /r /t 10`。此后没有人登录；由 J1 经 SSH 读数。
**验收读数**：

| # | 读数 | 期望 |
|---|---|---|
| 1 | `quser` | **空**（无人登录——这才证明"不依赖登录"） |
| 2 | 事件日志 `KANetBoot` | 9100 → … → 9101，**没有 9000+ 的 Error**；若有 9205 记下（"前次停机不干净"，**这正是 D-F 的直接读数**）；**9065 出现 ⇒ 守卫拒起 console（前提未满足，见 4.3-3/4）** |
| 3 | `boot-status.json` / `boot-history.log` | `phase=BOOT_OK`；阶段序列含 `GUARD_OK` → `OUTBOUND_T0` → `CONSOLE_STARTED` |
| 4 | kaspad | 新 PID、恰 1 个主网 kaspad、命令行逐字；`17110` 恰 1 个 Listen；探针 `ALIVE:network=mainnet` |
| 5 | **日志证据（v0.2 改，NWT H3）** | ① kaspad **内部日志** `rusty-kaspa.log` 上一段以 `Kaspad has stopped` 收尾（= 关机通知送达 S4U 会话的直接证据）；② 出现 `kaspad-stdout.pre-boot-<ts>.log` 与 `console-mainnet-stdout.pre-boot-<ts>.log`，**但不以"内容 = 重启前那份"作为验收**；③ 记 `kaspad-stdout.log` 在开机 30 分钟内是否持续增长（S3 的实测样本） |
| 6 | console | 新 PID、恰 1 个（命令行含精确生产路径）；`127.0.0.1:3202` 恰 1 个 Listen；stdout `[silverc-pin] PASS` 恰 1 行、`WARMUP FAIL` 0 行；**D-026 上线后：`[utxo-splitter] disabled` 与 `[broadcaster-utxo] disabled` 各恰 1 行（V6）** |
| 7 | `GET /api/system/rpc-overview` | `total=18 connected=18` |
| 8 | 四条敏感路由 | 均 503 |
| 9 | 时间 | 关机 → `BOOT_OK` 的总时长 |
| **10（v0.3：自动、链上侧、判据 `spent==0`）** | **不再人手做。** 哨兵在**起 console 之前**自动取 t0（两次读数一致的快照），console 起来 **+30 分钟自动 diff**，结果落 `boot-status.json` 与事件日志：**9401 = `spent_outpoints==0` 且 18 个 relay 全部可读（通过）**；**9402 = `spent>0`（失败，带逐 relay 行：名字、spent/new 数、新增 txid 前缀）**；9404 = 无花费但有 relay 不可读（**不算通过**）；9403 = 快照不稳定或工具出错（**本次开机没有做出站检查——要人补做**）。**外部入账只增加 `new_outpoints`，不算失败** | 9401；无 9402/9403/9404。**9402 时逐笔对 §2.6 表解释**（预期集在 D-026 上线且 `autotake` 置关后 = **空**）；**这一步现在是每次开机自动执行，不只是"首次真重启"** |
| 11 | 内存哨兵在岗 | `memory-watch.log` 有 `started in boot sentinel` 行与周期 `SAMPLE` 行（含 `sentinel_ws=`/`handles=`）；**`memwatch-heartbeat`**（**只在内存检测真的产出样本后才更新**）与 `sentinel-heartbeat`（脚本还活着）mtime 都不超过 2 个 tick；**两个心跳含义不同：前者新鲜才代表"内存检测在工作"，后者新鲜而前者过期 = 脚本在但内存检测没在产出（例如 CIM 采样一直失败）** |

**已知限制（NWT M-B 补充）**：快照完整性依赖 `--utxoindex` 在 t0 时已追平；已用"两次读数一致"做稳定性读数，仍不一致则放弃本次检查（9403）而不是给出可能漏报的结论。**`kaspa_tx_log` 只登记"输出含我们某个 relay 地址"的交易，看不见"纯外付、无找零回自己"的出站**（见附录 C 的实测事实）——所以判据的**主信号是 outpoint 差分**，`kaspa_tx_log` 只作登记覆盖度自检。

**中止/回滚**：
- `quser` 非空、或事件日志无 9100 ⇒ 任务没在无人登录时跑起来：停在这里，等 Owner 登录后按 §6 手动拉起（同 9/14 T4），任务改 D-A 备选。
- 有 Error 事件 ⇒ 按 §5 处置；**不要手动重复起 kaspad**（先看 `boot-status.json` 与 kaspad 内部日志）。
- 手动拉起 = 9/14 GO §2 的 kaspad 原命令 + `scripts\start-console-mainnet.ps1`（本 runbook 上线前的现行做法）。

## 5. 失败时读什么（速查表）

| 事件 ID / 退出码 | 含义 | 先读 | 处置 |
|---|---|---|---|
| 退出码 10（**无事件**，只写 `boot-history.log`） | 拿不到 `boot.lock` | `boot-history.log`；`Get-Process powershell` | 通常是手动跑过（如 R1）没关；确认后结束旧实例 |
| 9020 / 9021 / 9022 | kaspad 二进制不存在 / sha256 不符 / `--version` 不符（Phase A，**什么都没起**） | 状态文件 message | **不要改钉住值去"让它过"**：先问是谁换了二进制 |
| 9030 / 9031 | 日志改名失败（kaspad，Phase A / console，Phase B 告警） | message | 不覆盖证据：手动改名后重试 |
| 9040 / 9041 / 9042 | kaspad 起不来 / 主网 kaspad 进程数>1 / 主网 kaspad 命令行不同（Phase A） | `kaspad-stderr.log`、进程表 | 42：脚本不碰它，由 Bettor 定 |
| 9043 / 9044 / 9045 / 9046 / 9050 | **Phase B Warning**：17110 上不是主网 / 探针依赖坏 / 探针连续 5 次异常或抛错 / 等待中 kaspad 消失 / 24 h 未稳定 ALIVE | 状态文件 lastProbe | **kaspad 未被动，console 未起**，脚本仍常驻；由人判断 |
| 9062 | 树检查不过（分支不对 / 4 个脚本与 HEAD 不一致 / `kasia-console/src`、`kasia-relay/src` 不干净 / **git 在该令牌下失败——原因带 git 原话，如 dubious ownership**） | 事件 message | console 不起，kaspad 照起；R2(b) 应已提前暴露 git 类问题 |
| **9065** | **守卫不符（M-C③）**：列出不符项名（表非空 / autotake 已上膛 / scanner 开 / env 开关键为 1 / id 键存在 / 表缺失或读不了 = UNKNOWN fail-closed）或守卫工具出错 | 事件 message（`GUARD … MISMATCH` 行）；手动 `node scripts\boot-guard-check.mjs` 复现（只读） | **console 不起（有意）**；处理不符项（多数需要 Owner/Bettor 决定，如 `autotake` 置关），再手动起 console，不要重复触发本任务 |
| 9201 / 9250 | kaspad 卡同步 / 90 分钟（或 180）未稳定 | kaspad **内部日志**尾部 | 只告警；脚本继续等到 24 小时 |
| 9205 | 前次停机不干净或未知（内部日志末行非 `Kaspad has stopped`） | 事件 message（含末行前 120 字符） | 预期 RocksDB 恢复更久；D-F 的直接测量，记账 |
| 9206 | kaspad 活着而 `kaspad-stdout.log` >10 分钟未写 | 内部日志 | **启发式**；内部日志才是权威 |
| 9061 / 9063 / 9064 / 9097 | console：进程数>1 或认领不成立 / 起动脚本失败或 PID 陈旧 / 300 s 内不健康 / 段内意外异常 | `console-mainnet-stderr.log` | kaspad 已起且活着；console 由人手动起 |
| 9203 / 9204 | 运行期 kaspad / console 消失（PID 不在或启动时间变了） | 事件日志前后文、系统事件日志（内存耗尽 2004？） | **nothing restarts it automatically**：kaspad 重启后 console 必须一起重启；先 quiesce 再重启 |
| 9098 / 9099 | **Phase B 整体异常（落入哨兵）/ Phase A 在 kaspad 已知后的异常（继续）**；Phase A 起前异常是退出码 99 | 状态文件 / `boot-history.log` message | 报 Bettor；kaspad 未被动 |
| **9207** | **探针 15 s 未应答被杀（Warning，v0.5 N4-2）**：不计入"探针错误 ×5"，门继续等；首次与每第 20 次报一次 | 事件 message；`boot-history.log` | 探针进程在忙（追块期常见）不等于 kaspad 死；看 kaspad 内部日志与 WRPC 是否仍监听；持续出现 ⇒ 节点卡死的旁证 |
| **9401 / 9402 / 9403 / 9404** | **出站检查**：9401 通过（`spent==0` 且全可读）/ **9402 检出花费（Warning，带逐 relay 行）** / 9403 本次没有做出站检查（t0 不稳或工具出错）/ 9404 无花费但有 relay 不可读（不算通过） | 事件 message；`logs\mainnet\boot\outbound-t0.json`（只含 txid:index，无地址无金额）；手动 `node scripts\boot-outbound-check.mjs diff <t0文件>`（只读） | 9402：逐笔对 §2.6 解释；无法解释 ⇒ 立即报 Bettor（有人在无人时花了钱）；9403/9404：人补做 |
| 9301–9305、9310–9313 | 内存检测（见 P3 页） | `memory-watch.log`；**`memwatch-heartbeat` mtime 过旧 = 内存检测没在产出（P3 存活判据）；`sentinel-heartbeat` 过旧 = 脚本自己挂了/没起来** | 见 P3 页 |

## 6. 回滚与待议项

**回滚**（最坏情形也只影响"开机自启"这一件新东西）：
1. 禁用：`Disable-ScheduledTask -TaskPath '\KANet\' -TaskName KANet-Mainnet-Boot`（提权）——下次开机不再触发。
2. 若任务正在"运行"（常驻）而要撤：**不要在任务计划程序里"结束"它**（= `TerminateProcess` 杀掉全部子进程，含 kaspad，非干净退出）。先按 §4.5 前置停 console 与 relay 子进程，让 kaspad 随**系统关机通知**干净退出（即重启机器）；`Disable`/`Unregister` 会不会顺带结束运行中的实例**未实测**（R2 一并测），测清之前不要指望它"温和"。
3. 注销：`Unregister-ScheduledTask -TaskPath '\KANet\' -TaskName KANet-Mainnet-Boot -Confirm:$false`（提权）。事件源与 `logs\mainnet\boot\` 可留。
4. 手动起法 = 9/14 GO §2。

**待议项（不在本页范围）**：
- **运行期崩溃**没有任何自动处置；本任务只覆盖开机。`scripts\kaspad-watchdog.ps1` 是 TN12 链，不可复用。
- console 起来后把 `boot-status.json` 灌进 `events` 表 = 改 console 代码，另批（D-E）。
- **kaspad 单独重启没有已知干净路径**（H4）；R3 ④ 只测 Ctrl+C；预期结论"只有关机通知一条干净路径"。
- **目录改名 `D:\kanet-tn12 → D:\kanet`**：脚本、`start-console-mainnet.ps1`、计划任务动作里的路径全是硬编码，**改名与本任务必须同窗同步**。
- **kaspad 升级**：钉住值（sha256 + 版本串）要跟着换，走 Bettor。
- **休眠/快速启动**：`shutdown /s` 后上电（快速启动）与 `shutdown /r` 是否都触发"系统启动"触发器，未证明；4.5 用 `/r`，冷启动（今晚这种硬复位后上电）建议再补一次。
- **T-SPLIT-UTXOS-API-AUTHZ**（NWT 顺带发现）：`POST /api/relay/:id/split-utxos` 无鉴权，任何本机进程可触发烧费重平衡——与 §2.6 无关（不是无人值守路径），已另开票。

## 7. 已知未证明面（诚实口径）

1. **S4U 主体在本机 console/kaspad 上是否无碍**：推理上无碍，**未实测**——R2。
2. **任务实例结束后子进程是否存活 / WMI `Win32_Process.Create` 能否脱离任务 Job**：未实测——R2 a)（第一优先）。当前设计按"会被杀"的最坏情形做。
3. **非 0 退出码是否触发"失败重启"、次数是否精确为 3**：未实测——R2。
4. **S4U 起的进程能否被交互式非提权会话读命令行/停掉；S4U 令牌下 git 是否撞属主检查**：未证——R2 b)/c)。
5. **系统关机通知能否送达 S4U 会话里的隐藏控制台进程（H1）**：**未证，且无法在不真关机的情况下证明**；R3 ⑦ 测的是 Ctrl+C，不是它；直接读数来自第一次自启后第二次关机—开机时的 9205/内部日志。
6. **追块中关机的落盘时间（H5）**：未知；今晚 1.7 s 是低负载。RocksDB 有 WAL，最坏是恢复而非丢账，S2 告警为此。
7. **Windows"快速启动"下启动触发器是否触发**：未实测。
8. **探针对 simnet 的 `network` 字符串**：未验证。
9. **脚本主体没有在真环境跑过**：只有辅助函数/向量、**伪造原语之上的控制流测试**、`-WatchOnly` 在临时根目录的一次运行、认领判定对活进程的一次校验。R1、R3、4.5 逐级补证。**伪造原语的控制流测试不能代替 R3 ③–⑥ 的真机注入**（NWT）。
   - **事故教训（写进页以免重犯）**：v0.3 草案早期版本的流程测试**没有把 `$KaspadLogDir` 重定向到临时目录**，测试里"起 kaspad"的前一步 `Rotate-LogIfPresent` 因此**对生产 kaspad 的 stdout 日志做了一次真实的改名尝试**——**只因活 kaspad 持有该文件的打开句柄，Windows 拒绝改名，才没有发生**（我事后核了：生产日志目录文件与 PID 均未变）。这是运气，不是设计。**已修**：`-SelfTest` 现在把所有可能被触碰的路径重定向到临时目录，并在跑流程测试前**断言每个路径都以临时目录开头，否则抛错终止**；本页所有"测试跑绿"都是在这个断言之后的结果。
10. **哨兵边界（S6）**：只报一次；运行期 console 死后若被人手动重起，哨兵不知道——可接受。
11. **§2.6 的完整性**：入站类的 relay 侧 `processComm`/`processPayment` 没有追；I7（relay 内建入站握手自动接受）**守卫覆盖不到**（无库表前提、未见开关），是**开放项**；HTTP 类只登记到"需要调用者触发"。
12. **`kaspa_tx_log` 的覆盖范围**：见附录 C——只登记"输出里含我们某个地址"的交易；判据主信号是 outpoint 差分。
13. **出站检查的盲区**：t0 之后、diff 之前**被外部入账再被花掉**的 outpoint 既不在 t0 也不在 diff 里，看不见（快照差分只见首尾）；`getUtxosByAddresses` 对超大地址集有 wasm trap 前科——18 个团队地址目前无碍，`UNREADABLE` 已单列；utxoindex 未追平由"两次读数一致"缓解，不是证明。
14. **守卫的可用性代价**：守卫是 fail-closed——任何表出现一行合法数据（例如将来真有 `pool_markets`）都会让 console 不自启，需要人核后手动起。这是有意的，但意味着"自启"的可用性依赖数据保持"今天为零"。
15. 提交内存字段口径以本机实测为准（en-US；脚本用 `Win32_OperatingSystem` 属性，不受区域影响）。

16. **哨兵一拍在等待循环里的节流**：内存 tick 按 `SentinelTickSec`（默认 30 s）节流，等待循环每 10–15 s 一拍，所以内存采样节奏不变；等待循环里**不重复报 kaspad 死亡**（门自己报 9046）。**门/快照/校验三个循环之外的长阻塞**（例如 `Get-CimInstance` 卡住不返回）由 `-OperationTimeoutSec 10` 限制；`Invoke-NodeTool` 拉起的 node 子进程**没有超时**——若它挂住，一拍就被它拖住（探针自带 8 s 超时，快照/守卫工具没有）。**这是已知缺口，未修**。
17. **出站检查的已知限制（NWT 观察②）**：只看得到 **t0 时已存在**的 outpoint 被花掉；窗口内"入账后立即又被花掉"的 UTXO，差分看不见（每笔花费都需要 relay 的 fee 输入，所以实际上多半仍会带出一个 t0 outpoint，但这是推论，**未证**）。console **没起**时不排期、不发 9401（v0.4）。
18. **守卫登记表的可见但未守卫部分**（v0.5：登记表已改为反转规则并每次启动对生产 index.js 对账，见 20；下面关于 `audit-only` / `not-audited` 的限制仍成立）：`CRON_REGISTRY` 里 20 个调用是 `audit-only`/`not-audited`，登记只保证"新增的不会悄悄绕过"，不保证"已有的都被运行期守卫"；其中 `startAllRelays`（`infra`）内含 I7（relay 内建入站握手自动接受）这个**开放项**。
19. **`Invoke-SentinelBeat` 的死亡检查在门里不含 kaspad**（避免与门的 9046 重复）；门失败返回后，由哨兵循环第一拍补报 9203。
20. **对账覆盖的实际形态与盲区（v0.5，取代 v0.4 §2.6 那句"新增 cron 不登记 ⇒ 红"）**：覆盖 = index.js 里**来自相对模块**的静态命名 / 默认 / 命名空间导入、动态 `await import()`（解构 / 命名空间变量 / `(await import()).x` / `import().then`）、`setInterval` / `setTimeout` / `setImmediate` / `spawn` / `fork` / `exec*` / `new Worker` / `.schedule(`、裸副作用导入；**分析器不认识的 import 形状一律 UNPARSED = 红**。**不覆盖**：(a) **非相对（npm 包）导入**——包自己在 import 时起东西；(b) **传递性副作用**——被 index.js 导入的模块**在自己顶层**再起定时器/导入别的模块（NWT 也指出他没枚举这一层），登记表只按"index.js 用了哪个入口"分类；(c) 动态 `require`、`eval`；(d) index.js 之外由 console 起的**别的进程**（relay / adapter 子进程，走 `startAllRelays` / `startAllAdapters` 一条 infra 登记，I7 开放项在内）；(e) **"被使用"是文本判定**：死代码里的引用也算使用（多报 = 安全方向），同名局部变量遮蔽也会多报。
21. **`NON_START` 的 24 个名字是我按 index.js 上下文与模块头注释归类的**（路由注册按名字模式；`runMigrations` / `getConfig` / i18n / 反垃圾查询等按调用位置），**没有逐个读函数体**；`warmupCommitteeOffsetCache` 可能跑本地编译器（无链上动作，index.js 注释写明失败不阻启动）。请 NWT 抽样核，尤其 `setConfig`（生成 INGEST_SECRET 写库）与 `registerMindSkills`（写技能行）确为纯本地 DB。
22. **守卫工具里有一份自带的 `stripComments`（状态机版）**，与 `broadcaster-utxo.test.mjs` 的本地副本同源；J2 F5 已把该副本移进共享扫描器（`kasia-console/test-fixtures/source-scan/scan-non-test-sources.mjs`，待合主线）。**守卫必须自包含**（部署在 `C:\KANetBoot\\` 的树外副本，不能在运行期依赖测试夹具目录），所以守卫里保留一份；F5 合入后我加一条**等价性测试**（守卫的 `stripComments` 与共享扫描器的在一批语料上输出一致），并把 `broadcaster-utxo.test.mjs` 的本地副本改成 import 共享版（单一实现）。
23. **有界子进程的限制（v0.5）**：① 只杀**直接子进程**（不杀进程树）——我们的三个工具都不再起孙进程；② 超时粒度 = 1 s 轮询片；③ `Start-Process -NoNewWindow` + 重定向在 **S4U / 无人登录的计划任务会话里未实测**（R2/R3 补证）；④ 探针在 `-2` 上"不计错、继续等"，若探针**永久**挂住，门只会等到 `GateHardSec`（24 h）再放弃——与 v0.4"卡死 24 h 不报警"相比至少有 9207 与两个心跳在动，但这是**可见的等待，不是自愈**。
24. **env 文件编码的可用性代价**：无 BOM 且设置行**名字**含非 ASCII ⇒ 守卫 UNKNOWN ⇒ 不自启（fail-closed）。主网 env 现状我**没有读内容**（避开密钥值），NWT 用合成文件测；若真实文件恰有此形状，会被拦下，需人加 BOM 或改名后重启。值与注释里的非 ASCII 不受影响。BOM-less 文件里"设置行 = 一个 DBCS 前导字节吞掉后面的 ASCII 字符"这类**行内解码差异**仍无法完全复现（只在名字含非 ASCII 时拦），未证。
25. **SelfTest 现在会起真 node 子进程且耗时 ~13 s**（v0.4 ~2 s）：仍只碰临时目录、只杀自己创建的进程；在低内存（提交 ≥80%）时不要跑（本机规矩）。`Get-CimInstance` 在**内存耗尽**时的真实行为仍未测（NWT 四审"没做/未证"同）。

## 附录 A. `scripts/mainnet-boot-sequence.ps1` v0.5 草案全文（**未落码、未在真启动上运行**；ASCII-only；落码须 Bettor 批 + NWT 再审）

```powershell
# mainnet-boot-sequence.ps1 v0.5 -- DRAFT, not landed, not run on a real boot. KANet-UI 2026-09-19.
# Boot-time orchestration for the mainnet node + console, plus a resident sentinel (death watch, boot-window outbound-spend check,
# system commit-memory watch). BOOT-ONLY: it never restarts anything that died after boot (a console restart after a kaspad
# restart has money-path side effects and must be a human decision).
# Order: tree check -> verify kaspad binary -> previous-stop check -> rotate logs -> start/adopt kaspad -> wait for >=3 consecutive
# probe ALIVE -> GUARD check (every "zero today" fact re-verified) -> outbound snapshot t0 -> rotate console logs -> start/adopt
# console -> verify -> resident sentinel (alerts only; +30 min outbound diff).
# HARD RULE (NWT P2-M1 / M-A): once kaspad has been started or adopted this script has NO exit path and NO uncaught exception path.
# Everything after that point is "warn + keep the sentinel alive", because (unproven) Task Scheduler may kill processes started by
# a task when the task instance ends, and a retry loop would then hard-kill a node that is still catching up.
# Modes: default = boot + sentinel;  -WatchOnly = memory watch only, starts nothing (safe in an ordinary user session);
#        -SelfTest = helper/vector/flow checks only, starts nothing.  -InjectFault is for R3 rehearsal only (production passes none).
# ASCII-only on purpose (Windows PowerShell 5.1 reads a BOM-less file as ANSI).
[CmdletBinding()]
param(
  [string]  $KanetRoot       = 'D:\kanet-tn12',
  [string]  $KaspadExe       = 'D:\rusty-kaspa-v201\kaspad.exe',
  [string]  $KaspadSha256    = '8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38',
  [string]  $KaspadVersion   = 'kaspad 2.0.1',
  [string]  $AppDir          = 'D:\kaspa-mainnet-data-v201',
  [string]  $KaspadLogDir    = 'D:\kaspa-mainnet-data-v201-logs',
  [string]  $KaspadInternalLog = 'D:\kaspa-mainnet-data-v201\kaspa-mainnet\logs\rusty-kaspa.log',
  [int]     $RpcPort         = 17110,
  [string]  $ExpectNetwork   = 'mainnet',
  [int]     $ConsolePort     = 3202,
  [int]     $GateSoftSec     = 5400,    # not stably ALIVE after this: alert once, keep waiting (doubled if the previous stop was unclean)
  [int]     $GateHardSec     = 86400,   # after this: warn, do NOT start console, stay resident
  [int]     $ProbeEverySec   = 15,
  [int]     $AliveStreakNeeded = 3,     # consecutive ALIVE probes before console may start (3 x 15 s = 45 s of stability)
  [int]     $OutboundDelaySec  = 1800,  # outbound-spend diff runs this long after the console phase
  [string]  $AllowedBranch   = 'bshard-m3-deploy',
  [double]  $MemWarnPct      = 85,
  [double]  $MemCritPct      = 92,
  [double]  $MemClearPct     = 80,
  [double]  $MemCritClearPct = 88,
  [int]     $MemRepeatSec    = 1800,
  [double]  $MemEscalatePp   = 5,
  [int]     $SentinelTickSec = 30,
  [string[]]$ExtraKaspadArgs = @(),
  [int]     $ProbeTimeoutSec    = 15,   # N4-2: parent-side hard limits for every node child (a JS timer inside the child cannot fire while wasm holds the event loop)
  [int]     $GuardTimeoutSec    = 60,
  [int]     $OutboundTimeoutSec = 120,
  [string]  $InjectFault     = '',      # REHEARSAL ONLY: '' | pidfile | phasea-late | phaseb | probe | sentinel | beat
  [switch]  $SkipConsole,
  [switch]  $WatchOnly,
  [switch]  $SelfTest
)
$ErrorActionPreference = 'Stop'
$BootDir = Join-Path $KanetRoot 'logs\mainnet\boot'
$StatusFile = Join-Path $BootDir 'boot-status.json'
$HistoryFile = Join-Path $BootDir 'boot-history.log'
$MemLogFile = Join-Path $BootDir 'memory-watch.log'
$HeartbeatFile = Join-Path $BootDir 'sentinel-heartbeat'          # "the script is alive"
$MemHeartbeatFile = Join-Path $BootDir 'memwatch-heartbeat'        # "the memory detector produced a sample" (NWT N-1): the liveness criterion for P3
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$ScriptStart = Get-Date
$ExpectedConsoleScript = Join-Path $KanetRoot 'kasia-console\src\index.js'
$Script:Mono = [System.Diagnostics.Stopwatch]::StartNew()   # monotonic clock for all interval logic (wall clock can be stepped)
$Script:MaxSentinelTicks = 0                                # 0 = run forever (production); >0 only in -SelfTest flow tests
$Script:Ctx = $null; $Script:Con = $null; $Script:HaveMem = $false
$Script:OutboundT0Ok = $false; $Script:OutboundDone = $false; $Script:OutboundDueMs = 0; $Script:ProbeTimeouts = 0; $Script:BeatFaulted = $false

function Write-History([string]$Msg) {
  try { Add-Content -LiteralPath $HistoryFile -Value ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Msg) -Encoding ASCII } catch { }
}

function Set-BootStatus([string]$Phase, [hashtable]$Detail = @{}) {
  try {   # the whole body is guarded: a status write must never be the reason the script dies
    $o = [ordered]@{ phase = $Phase; at = (Get-Date).ToString('o'); pid = $PID; stamp = $Stamp; detail = $Detail }
    $tmp = "$StatusFile.tmp"
    New-Item -ItemType Directory -Force -Path $BootDir | Out-Null
    ($o | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $tmp -Encoding ASCII
    Move-Item -LiteralPath $tmp -Destination $StatusFile -Force
    Write-History ("{0} {1}" -f $Phase, ($Detail | ConvertTo-Json -Compress -Depth 3))
  } catch { }
}

function Send-BootEvent([int]$Id, [string]$Type, [string]$Msg) {
  # Application log, source KANetBoot. The source must be registered once by an elevated session (runbook 4.2).
  # Without it the event is skipped and only the file logs carry the alert (Write-History records the failure).
  try { Write-EventLog -LogName Application -Source 'KANetBoot' -EventId $Id -EntryType $Type -Message $Msg -ErrorAction Stop }
  catch { Write-History ("eventlog-write-failed id={0}: {1}" -f $Id, $_.Exception.Message) }
}

function Stop-Boot([int]$Code, [string]$Phase, [string]$Msg) {
  # Fatal. ONLY legal while nothing has been started or adopted yet (Phase A before kaspad is known). Never call afterwards.
  Set-BootStatus $Phase @{ exitCode = $Code; message = $Msg }
  Send-BootEvent (9000 + $Code) 'Error' ("KANet mainnet boot FAILED phase={0} code={1}: {2}" -f $Phase, $Code, $Msg)
  exit $Code
}

function Warn-Kaspad([int]$Code, [string]$Phase, [string]$Msg) {
  # Post-start kaspad-side failure: alert, record, keep the (possibly still syncing) kaspad and this sentinel alive.
  Set-BootStatus $Phase @{ code = $Code; message = $Msg }
  Send-BootEvent (9000 + $Code) 'Warning' ("KANet mainnet kaspad phase={0} code={1}: {2}. Console will NOT be started by the boot sequence; kaspad left running." -f $Phase, $Code, $Msg)
}

function Warn-Console([int]$Code, [string]$Phase, [string]$Msg) {
  Set-BootStatus $Phase @{ code = $Code; message = $Msg }
  Send-BootEvent (9000 + $Code) 'Warning' ("KANet mainnet console NOT started/healthy phase={0} code={1}: {2}" -f $Phase, $Code, $Msg)
}

function Rotate-LogIfPresent([string]$Path, [string]$StampStr) {
  # Same naming convention already in logs\mainnet: <base>.pre-<label>-<yyyyMMdd-HHmmss><ext>. Rename only; never delete.
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $fi = Get-Item -LiteralPath $Path
  if ($fi.Length -eq 0) { return $null }
  $dest = Join-Path $fi.DirectoryName ('{0}.pre-boot-{1}{2}' -f $fi.BaseName, $StampStr, $fi.Extension)
  if (Test-Path -LiteralPath $dest) { throw "rotation target already exists: $dest" }
  Move-Item -LiteralPath $Path -Destination $dest -ErrorAction Stop
  return $dest
}

function Test-ArgsMatch([string]$CommandLine, [string]$Exe, [string[]]$WantArgs) {
  if (-not $CommandLine) { return $false }
  $have = @(($CommandLine -replace '"', '') -split '\s+' | Where-Object { $_ })
  $want = @($Exe) + $WantArgs
  if ($have.Count -ne $want.Count) { return $false }
  for ($i = 0; $i -lt $want.Count; $i++) { if ($have[$i] -ne $want[$i]) { return $false } }
  return $true
}

# ---- process identity (NWT P2-M2): claim by exact path / appdir / port, never by process name or path fragment ----
function Select-MainnetKaspad([object[]]$Procs, [string]$AppDirName, [int]$Port) {
  # A kaspad.exe is "the mainnet node" only if its command line names the mainnet appdir or the mainnet RPC port.
  # simnet validation nodes use the SAME kaspad.exe; they are ignored (not counted, not reported).
  @($Procs | Where-Object { $_.CommandLine -and ($_.CommandLine -like "*--appdir=$AppDirName*" -or $_.CommandLine -like "*--rpclisten-borsh=127.0.0.1:$Port*") })
}
function Select-ConsoleCandidates([object[]]$Procs, [string]$ExpectedScript) {
  # Only node.exe whose command line contains the EXACT production script path. Worktree copies (scratch\..\kasia-console\src\index.js)
  # and isolated test consoles have a different full path and are ignored.
  @($Procs | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('/', '\').ToLower().Contains($ExpectedScript.ToLower()) })
}
function Test-ConsoleClaim([object]$Proc, [int[]]$ListenerPids, [string]$PidFileValue) {
  # All three must hold: exact production path (already selected) AND owns the console port AND matches console-mainnet.pid.
  if (-not $Proc) { return $false }
  $pidOk = ($PidFileValue -as [int]) -eq [int]$Proc.ProcessId
  return (($ListenerPids -contains [int]$Proc.ProcessId) -and $pidOk)
}

function Get-KaspadProcs { @(Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'") }
function Get-NodeProcs { @(Get-CimInstance Win32_Process -Filter "Name='node.exe'") }
function Get-ListenerPids([int]$Port) { @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | ForEach-Object { [int]$_.OwningProcess }) }
function Test-Listening([int]$Port) { (Get-ListenerPids $Port).Count -gt 0 }

function Get-NativeText([scriptblock]$Block) {
  $ErrorActionPreference = 'Continue'   # native stderr merged with 2>&1 must not become a terminating error
  (& $Block 2>&1 | Out-String).Trim()
}

function Test-TreeClean {
  # NWT S1 / S-B: what the console will run must be COMMITTED code on the allowed branch. Checked FIRST; a dirty/wrong tree blocks the
  # console only, never kaspad. git failing under the S4U token (e.g. "dubious ownership") also fails closed, WITH the git message
  # as the reason -- so it is diagnosable, and R2(b) tests exactly this command under the task's token.
  $branch = Get-NativeText { & git -C $KanetRoot branch --show-current }
  if ($branch -ne $AllowedBranch) { return @{ ok = $false; reason = ("git branch --show-current gave '{0}', expected '{1}'" -f $branch.Substring(0, [Math]::Min(120, $branch.Length)), $AllowedBranch) } }
  foreach ($f in 'scripts/start-console-mainnet.ps1', 'scripts/kaspad-rpc-probe.mjs', 'scripts/boot-outbound-check.mjs', 'scripts/boot-guard-check.mjs') {
    & git -C $KanetRoot diff --quiet HEAD -- $f
    if ($LASTEXITCODE -ne 0) { return @{ ok = $false; reason = "$f differs from HEAD (or git failed)" } }
  }
  $dirty = Get-NativeText { & git -C $KanetRoot status --porcelain -- kasia-console/src kasia-relay/src }
  if ($dirty) { return @{ ok = $false; reason = ("kasia-console/src or kasia-relay/src not clean vs HEAD: {0}" -f $dirty.Substring(0, [Math]::Min(160, $dirty.Length)).Replace("`r", ' ').Replace("`n", ' | ')) } }
  @{ ok = $true; reason = '' }
}

function Test-CleanStopMarker([string]$TailText) {
  # last non-empty line of the kaspad INTERNAL log must contain 'Kaspad has stopped' (NWT S2 / H2). The redirected stdout is
  # NOT authoritative: it went silent for 5 days on 2026-09-14 for an unknown reason.
  $lines = @($TailText -split "`r?`n" | Where-Object { $_.Trim() })
  if ($lines.Count -eq 0) { return @{ known = $false; clean = $false; last = '' } }
  $last = $lines[-1]
  @{ known = $true; clean = [bool]($last -match 'Kaspad has stopped'); last = $last.Substring(0, [Math]::Min(120, $last.Length)) }
}
function Get-LogTail([string]$Path, [int]$Bytes = 8192) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $fs = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
  try {
    $n = [int][Math]::Min([long]$Bytes, $fs.Length); [void]$fs.Seek(-$n, 'End')
    $buf = New-Object byte[] $n; [void]$fs.Read($buf, 0, $n); [System.Text.Encoding]::UTF8.GetString($buf)
  } finally { $fs.Dispose() }
}

function Invoke-BoundedProcess([string]$FilePath, [string[]]$ArgList, [int]$TimeoutSec, [switch]$InGate) {
  # N4-2 (NWT 4th review): run ONE child process under a PARENT-side hard time limit. Never throws.
  # Returns @{ Code; Text; TimedOut }: Code = the child's exit code; -1 = could not start; -2 = killed after $TimeoutSec s.
  # Only the process object THIS function created is ever killed (exact PID): never kaspad, never the console, never "all node.exe".
  # A JS timer inside the child cannot enforce a limit while wasm holds its event loop (NWT measured 20.1 s of blocking), so the limit lives here.
  # While waiting it runs the sentinel beat about once a second (no diff: the diff is itself a bounded child), so the memory detector,
  # the death watch and BOTH heartbeats keep advancing during a slow tool -- the N-1 invariant holds inside single child calls too.
  $ErrorActionPreference = 'Continue'
  $stem = Join-Path $BootDir ('tool-' + [guid]::NewGuid().ToString('N'))
  $fOut = $stem + '.out'; $fErr = $stem + '.err'; $p = $null; $timedOut = $false
  try {
    $argStr = (@($ArgList) | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { "$_" } }) -join ' '
    $p = Start-Process -FilePath $FilePath -ArgumentList $argStr -PassThru -NoNewWindow -RedirectStandardOutput $fOut -RedirectStandardError $fErr
    $null = $p.Handle   # cache the handle so ExitCode stays readable after exit (Windows PowerShell 5.1 quirk)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while (-not $p.WaitForExit(1000)) {
      try { Invoke-SentinelBeat $Script:Ctx -InGate:$InGate -NoDiff } catch { }   # the beat never throws; belt and braces
      if ($sw.Elapsed.TotalSeconds -ge $TimeoutSec) { $timedOut = $true; try { $p.Kill() } catch { }; [void]$p.WaitForExit(5000); break }
    }
    if (-not $timedOut) { $p.WaitForExit() }   # flush the redirected streams
    $code = if ($timedOut) { -2 } else { $p.ExitCode }
    if ($null -eq $code) { $code = -1 }
    $text = ''
    foreach ($f in $fOut, $fErr) { if (Test-Path -LiteralPath $f) { try { $text += [System.IO.File]::ReadAllText($f) } catch { } } }
    $text = $text.Trim()
    if ($timedOut) { $text = ("TIMEOUT after {0}s (killed pid {1}); partial output: {2}" -f $TimeoutSec, $p.Id, $text.Substring(0, [Math]::Min(300, $text.Length))) }
    [pscustomobject]@{ Code = $code; Text = $text; TimedOut = $timedOut }
  } catch { [pscustomobject]@{ Code = -1; Text = ("failed to run: {0}" -f $_.Exception.Message); TimedOut = $false } }
  finally { foreach ($f in $fOut, $fErr) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue } }
}

function Invoke-NodeTool([string]$ScriptRel, [string[]]$ToolArgs, [int]$TimeoutSec = 120) {
  # runs a repo script with node under a parent-side time limit; returns @{ Code; Text; TimedOut } and NEVER throws (a spawn failure or a hang is a result, not a crash)
  $ErrorActionPreference = 'Continue'
  try { $node = (Get-Command node.exe -ErrorAction Stop).Source } catch { return [pscustomobject]@{ Code = -1; Text = ("tool failed to run: {0}" -f $_.Exception.Message); TimedOut = $false } }
  Invoke-BoundedProcess $node (@((Join-Path $KanetRoot $ScriptRel)) + @($ToolArgs)) $TimeoutSec
}

function Invoke-Probe {
  # Runs the existing probe (exit 0 = ALIVE, 7 = SYNCING, 8 = STALLED, 5/9 = not up yet, 2 = wrong network, 6 = probe broken; -2 = did not answer within $ProbeTimeoutSec and was killed).
  # The three KASPAD_PROBE_* variables are set for the child only and removed afterwards so the console never inherits them.
  if ($InjectFault -eq 'probe') { throw 'injected probe failure' }
  $ErrorActionPreference = 'Continue'
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $env:KASPAD_PROBE_URL = "ws://127.0.0.1:$RpcPort"; $env:KASPAD_PROBE_NETWORK = $ExpectNetwork
  $env:KASPAD_PROBE_STATE = Join-Path $BootDir 'probe-state.json'
  try { $r = Invoke-BoundedProcess $node @((Join-Path $KanetRoot 'scripts\kaspad-rpc-probe.mjs'), '--timeout-ms=8000') $ProbeTimeoutSec -InGate }
  finally { Remove-Item Env:KASPAD_PROBE_URL, Env:KASPAD_PROBE_NETWORK, Env:KASPAD_PROBE_STATE -ErrorAction SilentlyContinue }
  [pscustomobject]@{ Code = $r.Code; Line = $r.Text }
}

# ---------------------------------------------------------------- memory watch (P3 v0.2/v0.3: hosted here, not in console)
# Detection + forensics only. No spawn, no DB, no console dependency. First landing = memory-watch.log (+ host), then the
# Application event log. Interval logic uses the monotonic stopwatch, never the wall clock.
function Get-MemoryConfig {
  @{ Warn = $MemWarnPct; Crit = $MemCritPct; Clear = $MemClearPct; CritClear = $MemCritClearPct; RepeatMs = ($MemRepeatSec * 1000); EscalatePp = $MemEscalatePp }
}
function Test-MemoryConfig($Cfg) {
  # required ordering: 0 < Clear < Warn < CritClear < Crit < 100. Returns $null when valid, else the reason.
  if (-not ($Cfg.Clear -gt 0)) { return 'clear must be > 0' }
  if (-not ($Cfg.Clear -lt $Cfg.Warn)) { return 'clear must be < warn' }
  if (-not ($Cfg.Warn -lt $Cfg.CritClear)) { return 'warn must be < critClear' }
  if (-not ($Cfg.CritClear -lt $Cfg.Crit)) { return 'critClear must be < crit (crit <= warn is invalid)' }
  if (-not ($Cfg.Crit -lt 100)) { return 'crit must be < 100' }
  if (-not ($Cfg.RepeatMs -gt 0 -and $Cfg.EscalatePp -gt 0)) { return 'repeat and escalate must be > 0' }
  return $null
}
function Get-MemoryTransition($State, [double]$Pct, [double]$NowMs, $Cfg) {
  # Pure state machine. Returns @{ Action; State }. Actions: none | enter-warn | enter-crit | escalate | repeat | downgrade | cleared
  # Silent bands: in WARN, [Clear, Warn) never alerts; in CRIT, [CritClear, Crit) never alerts. Repeats only while the reading is
  # at/above the level's own entry threshold. One tagged line per transition so the mutation checks in -SelfTest can target it.
  $lvl = $State.Level
  if ($lvl -eq 'OK') {
    if ($Pct -ge $Cfg.Crit) { return @{ Action = 'enter-crit'; State = @{ Level = 'CRIT'; LastMs = $NowMs; LastPct = $Pct } } }   #T-OKCRIT
    if ($Pct -ge $Cfg.Warn) { return @{ Action = 'enter-warn'; State = @{ Level = 'WARN'; LastMs = $NowMs; LastPct = $Pct } } }   #T-OKWARN
    return @{ Action = 'none'; State = $State }
  }
  if ($lvl -eq 'WARN') {
    if ($Pct -ge $Cfg.Crit) { return @{ Action = 'escalate'; State = @{ Level = 'CRIT'; LastMs = $NowMs; LastPct = $Pct } } }   #T-WARNCRIT
    if ($Pct -lt $Cfg.Clear) { return @{ Action = 'cleared'; State = @{ Level = 'OK'; LastMs = $NowMs; LastPct = $Pct } } }   #T-WARNCLEAR
    if ($Pct -ge $Cfg.Warn -and ($NowMs - $State.LastMs) -ge $Cfg.RepeatMs) { return @{ Action = 'repeat'; State = @{ Level = 'WARN'; LastMs = $NowMs; LastPct = $Pct } } }   #T-WARNREP_T
    if ($Pct -ge $Cfg.Warn -and $Pct -ge ($State.LastPct + $Cfg.EscalatePp)) { return @{ Action = 'repeat'; State = @{ Level = 'WARN'; LastMs = $NowMs; LastPct = $Pct } } }   #T-WARNREP_PP
    return @{ Action = 'none'; State = $State }
  }
  # CRIT
  if ($Pct -lt $Cfg.Clear) { return @{ Action = 'cleared'; State = @{ Level = 'OK'; LastMs = $NowMs; LastPct = $Pct } } }   #T-CRITCLEAR
  if ($Pct -lt $Cfg.CritClear) { return @{ Action = 'downgrade'; State = @{ Level = 'WARN'; LastMs = $NowMs; LastPct = $Pct } } }   #T-CRITDOWN
  if ($Pct -ge $Cfg.Crit -and ($NowMs - $State.LastMs) -ge $Cfg.RepeatMs) { return @{ Action = 'repeat'; State = @{ Level = 'CRIT'; LastMs = $NowMs; LastPct = $Pct } } }   #T-CRITREP_T
  if ($Pct -ge $Cfg.Crit -and $Pct -ge ($State.LastPct + $Cfg.EscalatePp)) { return @{ Action = 'repeat'; State = @{ Level = 'CRIT'; LastMs = $NowMs; LastPct = $Pct } } }   #T-CRITREP_PP
  return @{ Action = 'none'; State = $State }
}

function Write-MemLine([string]$Msg) {
  $line = '{0} [memory-watch] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Msg
  try { Add-Content -LiteralPath $MemLogFile -Value $line -Encoding ASCII } catch { }
  Write-Host $line
}

function Test-ExhaustionError($Ex) {
  # memory-exhaustion-class failure: matched by MESSAGE text (en-US) AND by numeric HRESULT / Win32 code on the exception chain
  # (region-independent): E_OUTOFMEMORY 0x8007000E, 0x800705AF (paging file too small), 0x80070008 (not enough storage),
  # 0x800705AA (insufficient system resources); 1455 / 8 / 1450 as bare Win32 codes.
  $hr = @(-2147024882, -2147023441, -2147024888, -2147023446)
  $w32 = @(1455, 8, 1450)
  for ($e = $Ex; $null -ne $e; $e = $e.InnerException) {
    if ($e -is [System.OutOfMemoryException]) { return $true }
    if ($hr -contains [int]$e.HResult) { return $true }
    if ($e -is [System.ComponentModel.Win32Exception] -and ($w32 -contains [int]$e.NativeErrorCode)) { return $true }
    if ([string]$e.Message -match 'OutOfMemory|1455|not enough memory|not enough storage|insufficient system resources') { return $true }
  }
  return $false
}

function Get-MemorySample {
  # in-process only (CIM query + Get-Process): no child process is spawned, so this cannot fail for lack of memory to start one.
  # -OperationTimeoutSec: under memory exhaustion WMI may HANG instead of erroring; a hung sample must fail after 10 s, not freeze the
  # sentinel loop (which also carries the death watch).
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -OperationTimeoutSec 10
  $lim = [double]$os.TotalVirtualMemorySize; $free = [double]$os.FreeVirtualMemory
  if (-not ($lim -gt 0)) { throw 'TotalVirtualMemorySize not > 0' }
  $pct = [math]::Round(100 * ($lim - $free) / $lim, 1)
  if (-not ($pct -gt 0 -and $pct -le 100)) { throw "commit pct out of range: $pct" }
  # names, PIDs and private GB only -- never command lines
  $top = @(Get-Process | Sort-Object PrivateMemorySize64 -Descending | Select-Object -First 5 | ForEach-Object { '{0}:{1}:{2}' -f $_.Name, $_.Id, [math]::Round($_.PrivateMemorySize64 / 1GB, 1) })
  $me = Get-Process -Id $PID   # the sentinel's own footprint: a memory detector must not be a memory grower (NWT P3 SHOULD-3)
  @{ pct = $pct; usedGB = [math]::Round(($lim - $free) / 1MB, 1); limitGB = [math]::Round($lim / 1MB, 1); physFreeGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1); top = ($top -join ',')
     selfMB = [math]::Round($me.PrivateMemorySize64 / 1MB, 1); selfHandles = $me.HandleCount }
}

$Script:MemState = @{ Level = 'OK'; LastMs = 0; LastPct = 0 }
$Script:MemFails = 0; $Script:MemFailStartMs = 0; $Script:MemFailAlerted = $false; $Script:MemExhaustAlerted = $false; $Script:MemTicks = 0
function Invoke-MemoryWatchTick {
  $cfg = Get-MemoryConfig; $now = [double]$Script:Mono.ElapsedMilliseconds
  try { $s = Get-MemorySample }
  catch {
    $err = $_.Exception.Message
    if ($Script:MemFails -eq 0) { $Script:MemFailStartMs = $now }
    $Script:MemFails++
    Write-MemLine ("SAMPLE-FAILED n={0}: {1}" -f $Script:MemFails, $err)
    # memory-exhaustion-class failures are pressure evidence on the FIRST occurrence (do not wait for 3 misses)
    if ((Test-ExhaustionError $_.Exception) -and -not $Script:MemExhaustAlerted) {
      $Script:MemExhaustAlerted = $true
      Send-BootEvent 9310 'Error' ("memory watch: sample failed with a memory-exhaustion-class error (treat as CRIT): {0}" -f $err)
    }
    if ($Script:MemFails -ge 3 -and -not $Script:MemFailAlerted) {
      $Script:MemFailAlerted = $true
      Send-BootEvent 9311 'Warning' ("memory watch: {0} consecutive sample failures; state held at {1}. last error: {2}" -f $Script:MemFails, $Script:MemState.Level, $err)
    }
    return   # state is HELD (not reset) across failures
  }
  if ($Script:MemFails -gt 0) {
    $blind = [int]($now - $Script:MemFailStartMs)
    Write-MemLine ("SAMPLE-RECOVERED after {0} failures, blindMs={1}" -f $Script:MemFails, $blind)
    if ($Script:MemFailAlerted) { Send-BootEvent 9312 'Information' ("memory watch: sampling recovered after {0} ms blind" -f $blind) }
    $Script:MemFails = 0; $Script:MemFailAlerted = $false; $Script:MemExhaustAlerted = $false
  }
  Set-MemHeartbeat
  $Script:MemTicks++
  if ($Script:MemTicks % 10 -eq 1) { Write-MemLine ("SAMPLE commit={0}% used={1}GB limit={2}GB physFree={3}GB top={4} sentinel_ws={5}MB handles={6}" -f $s.pct, $s.usedGB, $s.limitGB, $s.physFreeGB, $s.top, $s.selfMB, $s.selfHandles) }
  $t = Get-MemoryTransition $Script:MemState $s.pct $now $cfg
  $Script:MemState = $t.State
  if ($t.Action -eq 'none') { return }
  $txt = 'STATE {0} commit={1}% used={2}/{3}GB physFree={4}GB top={5}' -f $t.Action, $s.pct, $s.usedGB, $s.limitGB, $s.physFreeGB, $s.top
  Write-MemLine $txt   # first landing: file/host BEFORE the event log
  $ev = switch ($t.Action) {
    'enter-warn' { 9301, 'Warning' } 'enter-crit' { 9302, 'Error' } 'escalate' { 9302, 'Error' }
    'repeat' { $(if ($t.State.Level -eq 'CRIT') { 9303, 'Error' } else { 9303, 'Warning' }) }
    'downgrade' { 9304, 'Warning' } 'cleared' { 9305, 'Information' }
  }
  Send-BootEvent $ev[0] $ev[1] ("memory: {0}. Detection only; this watcher takes no action." -f $txt)
}

function Enter-MemoryLock {
  # exclusive file lock: only one memory watcher (boot sentinel OR a -WatchOnly session) at a time; released at process exit
  try { $Script:MemLock = [System.IO.File]::Open((Join-Path $BootDir 'memory-watch.lock'), 'OpenOrCreate', 'ReadWrite', 'None'); return $true } catch { return $false }
}
function Set-Heartbeat {
  # "the script is alive" (NWT P3 SHOULD-1). NOT proof that memory detection is running -- see Set-MemHeartbeat.
  try { Set-Content -LiteralPath $HeartbeatFile -Value ((Get-Date).ToString('o')) -Encoding ASCII } catch { }
}
function Set-MemHeartbeat {
  # NWT N-1: written ONLY when a memory sample was actually taken and evaluated. A consumer that wants "memory detection is alive" must
  # read THIS file; a fresh sentinel-heartbeat with a stale memwatch-heartbeat means the script is up but memory detection is not.
  try { Set-Content -LiteralPath $MemHeartbeatFile -Value ((Get-Date).ToString('o')) -Encoding ASCII } catch { }
}

# ---------------------------------------------------------------- boot phases
function Invoke-PhaseA {
  # PHASE A: exit is legal ONLY until kaspad is known. The moment kaspad is started/adopted, $Script:Ctx is set and NOTHING after that
  # point may throw out of this function (every later operation is individually guarded).
  Set-BootStatus 'BOOT_BEGIN' @{ memoryConfigError = $Script:MemCfgErr }
  Send-BootEvent 9100 'Information' 'KANet mainnet boot sequence begin'
  $tree = Test-TreeClean   # S1: evaluated FIRST; a dirty/wrong tree blocks the console only, never kaspad
  if (-not $tree.ok) { Send-BootEvent 9062 'Warning' ("boot: {0}; console will NOT be started" -f $tree.reason) }
  if (-not (Test-Path -LiteralPath $KaspadExe)) { Stop-Boot 20 'KASPAD_BINARY' "missing $KaspadExe" }
  $sha = (Get-FileHash -LiteralPath $KaspadExe -Algorithm SHA256).Hash.ToLower()
  if ($sha -ne $KaspadSha256.ToLower()) { Stop-Boot 21 'KASPAD_BINARY' ("sha256 mismatch: got {0}" -f $sha.Substring(0, 12)) }
  $ver = Get-NativeText { & $KaspadExe --version }
  if ($ver -ne $KaspadVersion) { Stop-Boot 22 'KASPAD_BINARY' "--version mismatch: '$ver'" }

  $kArgs = @("--appdir=$AppDir", '--utxoindex', "--rpclisten-borsh=127.0.0.1:$RpcPort", '--rocksdb-cache-size=2048') + $ExtraKaspadArgs
  $kProcs = @(Select-MainnetKaspad (Get-KaspadProcs) $AppDir $RpcPort)
  if ($kProcs.Count -gt 1) { Stop-Boot 41 'KASPAD_START' "$($kProcs.Count) mainnet kaspad processes present; refusing to pick one" }
  $prevUnclean = $false; $adopted = $false; $kPid = 0
  if ($kProcs.Count -eq 1) {
    if (-not (Test-ArgsMatch $kProcs[0].CommandLine $KaspadExe $kArgs)) { Stop-Boot 42 'KASPAD_START' 'the mainnet kaspad is running with a different command line; not touching it' }
    $kPid = [int]$kProcs[0].ProcessId; $adopted = $true
  } else {
    # S2: was the previous stop clean? (internal log, not the redirected stdout). Zero-risk measurement, evidence for the shutdown-notice question.
    $tail = Get-LogTail $KaspadInternalLog
    if ($null -eq $tail) { $prevUnclean = $true; Send-BootEvent 9205 'Warning' 'previous_stop_unknown: kaspad internal log not found' }
    else {
      $mk = Test-CleanStopMarker $tail
      if (-not ($mk.known -and $mk.clean)) { $prevUnclean = $true; Send-BootEvent 9205 'Warning' ("previous_stop_unclean: last internal-log line = '{0}'. Expect RocksDB recovery; soft gate doubled." -f $mk.last) }
      else { Set-BootStatus 'PREVIOUS_STOP_CLEAN' @{ } }
    }
    New-Item -ItemType Directory -Force -Path $KaspadLogDir | Out-Null
    $kOut = Join-Path $KaspadLogDir 'kaspad-stdout.log'; $kErr = Join-Path $KaspadLogDir 'kaspad-stderr.log'
    try { $r1 = Rotate-LogIfPresent $kOut $Stamp; $r2 = Rotate-LogIfPresent $kErr $Stamp } catch { Stop-Boot 30 'KASPAD_LOG_ROTATE' $_.Exception.Message }
    $kp = Start-Process -FilePath $KaspadExe -ArgumentList $kArgs -RedirectStandardOutput $kOut -RedirectStandardError $kErr -WindowStyle Hidden -PassThru
    if (-not $kp -or -not $kp.Id) { Stop-Boot 40 'KASPAD_START' 'Start-Process returned no process' }
    $kPid = $kp.Id
  }
  # ---- kaspad is now started/adopted: publish the context FIRST, then do every follow-up guarded ----
  $Script:Ctx = @{ Pid = $kPid; StartTicks = $null; Tree = $tree; PrevUnclean = $prevUnclean; StdoutPath = (Join-Path $KaspadLogDir 'kaspad-stdout.log') }
  try { if ($InjectFault -eq 'pidfile') { throw 'injected pid-file failure' }; if (-not $adopted) { Set-Content -LiteralPath (Join-Path $KaspadLogDir 'kaspad.pid') -Value $kPid -Encoding ASCII } }
  catch { Write-History ("kaspad.pid write failed (non-fatal, kaspad stays up): {0}" -f $_.Exception.Message) }
  try { $Script:Ctx.StartTicks = (Get-Process -Id $kPid -ErrorAction Stop).StartTime.Ticks } catch { Write-History ("kaspad StartTime read failed (non-fatal): {0}" -f $_.Exception.Message) }
  Set-BootStatus $(if ($adopted) { 'KASPAD_ADOPTED' } else { 'KASPAD_STARTED' }) @{ kaspadPid = $kPid }
  if ($InjectFault -eq 'phasea-late') { throw 'injected late Phase A exception (kaspad already known, outside every inner try)' }   # rehearsal only: exercises the OUTER catch
}

function Wait-KaspadAlive($Ctx) {
  # PHASE B (no exit paths). Returns $true after $AliveStreakNeeded CONSECUTIVE probe ALIVEs, else warns and returns $false.
  $soft = if ($Ctx.PrevUnclean) { $GateSoftSec * 2 } else { $GateSoftSec }
  $t0 = $Script:Mono.Elapsed.TotalSeconds; $streak = 0; $consecErr = 0; $stalledAlerted = $false; $softAlerted = $false; $lastNote = $t0
  while ($true) {
    Invoke-SentinelBeat $Ctx -InGate   # NWT N-1: the memory detector + death watch must run DURING the gate wait (up to 24 h), not only after it
    if (-not (Get-Process -Id $Ctx.Pid -ErrorAction SilentlyContinue)) { Warn-Kaspad 46 'KASPAD_GATE' "kaspad pid $($Ctx.Pid) exited while waiting for ALIVE"; return $false }
    # NWT S-A: a probe that cannot even run (node spawn failure under memory pressure) is a FAILED READING, not a reason to abort the gate
    try { $p = Invoke-Probe } catch { $p = [pscustomobject]@{ Code = 1; Line = ("probe threw: {0}" -f $_.Exception.Message) } }
    switch ($p.Code) {
      0 { $streak++; $consecErr = 0 }
      7 { $streak = 0; $consecErr = 0 }
      8 { $streak = 0; $consecErr = 0; if (-not $stalledAlerted) { $stalledAlerted = $true; Send-BootEvent 9201 'Warning' ("kaspad sync STALLED: {0}" -f $p.Line) } }
      -2 { $streak = 0; $consecErr = 0; $Script:ProbeTimeouts++; if ($Script:ProbeTimeouts -eq 1 -or ($Script:ProbeTimeouts % 20) -eq 0) { Send-BootEvent 9207 'Warning' ("kaspad probe did not answer within {0}s and was killed (occurrence {1}); it is NOT counted as a probe error; the gate keeps waiting. {2}" -f $ProbeTimeoutSec, $Script:ProbeTimeouts, $p.Line) } }
      { $_ -in 3, 4, 5, 9 } { $streak = 0 }
      2 { Warn-Kaspad 43 'KASPAD_GATE' ("wrong network on rpc port: {0}" -f $p.Line); return $false }
      6 { Warn-Kaspad 44 'KASPAD_GATE' ("probe dependency broken: {0}" -f $p.Line); return $false }
      default { $streak = 0; $consecErr++; if ($consecErr -ge 5) { Warn-Kaspad 45 'KASPAD_GATE' ("probe error x5: {0}" -f $p.Line); return $false } }
    }
    if ($streak -ge $AliveStreakNeeded) { Set-BootStatus 'KASPAD_ALIVE' @{ kaspadPid = $Ctx.Pid; consecutiveAlive = $streak; probe = $p.Line }; return $true }
    $el = $Script:Mono.Elapsed.TotalSeconds - $t0
    if ($el -ge $GateHardSec) { Warn-Kaspad 50 'KASPAD_GATE' ("not stably ALIVE after {0}s; last probe: {1}" -f $GateHardSec, $p.Line); return $false }
    if ($el -ge $soft -and -not $softAlerted) { $softAlerted = $true; Send-BootEvent 9250 'Warning' ("kaspad not stably ALIVE after {0}s; console NOT started; still waiting. last probe: {1}" -f $soft, $p.Line) }
    if (($Script:Mono.Elapsed.TotalSeconds - $lastNote) -ge 300) { $lastNote = $Script:Mono.Elapsed.TotalSeconds; Set-BootStatus 'KASPAD_WAITING' @{ kaspadPid = $Ctx.Pid; alivestreak = $streak; lastProbe = $p.Line } }
    Start-Sleep -Seconds $ProbeEverySec
  }
}

function Invoke-GuardStep {
  # NWT M-C(3): every "zero today" fact of the spending-path table is re-verified on EVERY boot, before the console may start.
  # Not OK / tool error => console NOT started, kaspad left running, Warning 9065, wait for a human. Returns $true only when all guards pass.
  $r = Invoke-NodeTool 'scripts\boot-guard-check.mjs' @() $GuardTimeoutSec
  if ($r.Code -eq 0) { Set-BootStatus 'GUARD_OK' @{ summary = ($r.Text -split "`r?`n" | Select-Object -Last 1) }; return $true }
  $bad = @($r.Text -split "`r?`n" | Where-Object { $_ -match '^GUARD ' -and $_ -notmatch ' OK( |$)' -and $_ -notmatch '^GUARD-RESULT' } | ForEach-Object { $_.Substring(0, [Math]::Min(150, $_.Length)) })
  $msg = if ($r.Code -eq 3) { "guard mismatch: " + ($bad -join ' | ') } else { "guard tool error (exit {0}): {1}" -f $r.Code, $r.Text.Substring(0, [Math]::Min(200, $r.Text.Length)) }
  Warn-Console 65 'CONSOLE_GUARD' ($msg.Substring(0, [Math]::Min(900, $msg.Length)) + " -- console NOT started (fail-closed); kaspad left running")
  return $false
}

function Invoke-OutboundSnap {
  # NWT M-B: t0 is taken HERE -- after kaspad is stably ALIVE and BEFORE the console starts -- because the startup-time spending path
  # fires within seconds of the console starting. Two reads must agree (utxoindex caught up); retried a few times; failure only warns.
  for ($i = 1; $i -le 3; $i++) {
    Invoke-SentinelBeat $Script:Ctx
    $r = Invoke-NodeTool 'scripts\boot-outbound-check.mjs' @('snap', (Join-Path $BootDir 'outbound-t0.json'), '--settle-sec', '10') $OutboundTimeoutSec
    if ($r.Code -eq 0) { $Script:OutboundT0Ok = $true; Set-BootStatus 'OUTBOUND_T0' @{ attempt = $i; result = $r.Text }; return }
    Write-History ("outbound snap attempt {0} exit {1}: {2}" -f $i, $r.Code, $r.Text)
    Start-Sleep -Seconds 15
  }
  Send-BootEvent 9403 'Warning' 'outbound check: t0 snapshot unavailable after 3 attempts (utxoindex not settled or RPC/tool failure); the boot-window spend check will NOT run this boot'
}

function Invoke-OutboundDiff {
  $Script:OutboundDone = $true
  $r = Invoke-NodeTool 'scripts\boot-outbound-check.mjs' @('diff', (Join-Path $BootDir 'outbound-t0.json')) $OutboundTimeoutSec
  $last = ($r.Text -split "`r?`n" | Select-Object -Last 1)
  switch ($r.Code) {
    0 { Set-BootStatus 'OUTBOUND_OK' @{ result = $last }; Send-BootEvent 9401 'Information' ("outbound check: no relay outpoint was spent in the boot window. {0}" -f $last) }
    3 { $m = "OUTBOUND SPEND DETECTED in the boot window (spent_outpoints > 0). Per-relay lines: " + ($r.Text -replace "`r?`n", ' | '); Set-BootStatus 'OUTBOUND_SPENT' @{ result = $last }; Send-BootEvent 9402 'Warning' $m.Substring(0, [Math]::Min(1500, $m.Length)) }
    4 { Set-BootStatus 'OUTBOUND_UNREADABLE' @{ result = $last }; Send-BootEvent 9404 'Warning' ("outbound check: nothing spent but at least one relay was UNREADABLE (not counted as no change). {0}" -f $last) }
    default { Send-BootEvent 9403 'Warning' ("outbound check: diff failed (exit {0}): {1}" -f $r.Code, $r.Text.Substring(0, [Math]::Min(300, $r.Text.Length))) }
  }
}

function Start-ConsolePhase($Ctx) {
  # returns @{ Pid; StartTicks } or $null after a Warn-Console (kaspad stays up either way)
  if (-not $Ctx.Tree.ok) { Warn-Console 62 'CONSOLE_TREE_GUARD' ("{0}; console NOT started" -f $Ctx.Tree.reason); return $null }
  $logDir = Join-Path $KanetRoot 'logs\mainnet'; $pidFile = Join-Path $logDir 'console-mainnet.pid'
  $cand = @(Select-ConsoleCandidates (Get-NodeProcs) $ExpectedConsoleScript)
  $cPid = $null
  if ($cand.Count -gt 1) { Warn-Console 61 'CONSOLE_START' "$($cand.Count) node.exe processes run the production console script; refusing to pick one"; return $null }
  if ($cand.Count -eq 1) {
    $pf = ''; if (Test-Path -LiteralPath $pidFile) { $pf = (Get-Content -LiteralPath $pidFile -Raw).Trim() }
    if (-not (Test-ConsoleClaim $cand[0] (Get-ListenerPids $ConsolePort) $pf)) { Warn-Console 61 'CONSOLE_START' 'a process runs the production console script but is not (yet) the claimed console (port/pid-file mismatch); not starting a second one'; return $null }
    $cPid = [int]$cand[0].ProcessId; Set-BootStatus 'CONSOLE_ADOPTED' @{ consolePid = $cPid }
  } else {
    try { $c1 = Rotate-LogIfPresent (Join-Path $logDir 'console-mainnet-stdout.log') $Stamp; $c2 = Rotate-LogIfPresent (Join-Path $logDir 'console-mainnet-stderr.log') $Stamp }
    catch { Warn-Console 31 'CONSOLE_LOG_ROTATE' $_.Exception.Message; return $null }
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $KanetRoot 'scripts\start-console-mainnet.ps1') | Out-Null   # child stdout must not leak into the return value
    if ($LASTEXITCODE -ne 0) { Warn-Console 63 'CONSOLE_START' "start-console-mainnet.ps1 exit code $LASTEXITCODE"; return $null }
    # S5: the PID file may be a stale leftover; accept it only if it names a fresh node.exe running the production script
    $cPid = $null; try { $cPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim() } catch { }
    $proc = $null; if ($cPid) { $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$cPid" -ErrorAction SilentlyContinue }
    $fresh = $proc -and $proc.Name -eq 'node.exe' -and (Select-ConsoleCandidates @($proc) $ExpectedConsoleScript).Count -eq 1 -and ($proc.CreationDate -ge $ScriptStart.AddSeconds(-5))
    if (-not $fresh) { Warn-Console 63 'CONSOLE_START' 'console-mainnet.pid does not name a fresh node.exe running the production console script (stale pid file?)'; return $null }
    Set-BootStatus 'CONSOLE_STARTED' @{ consolePid = $cPid; rotated = @($c1, $c2) | Where-Object { $_ } }
  }
  # verify: process alive, port listening, HTTP answering. A failure here warns; it never kills or restarts the console.
  $t0 = $Script:Mono.Elapsed.TotalSeconds; $ok = $false
  while (($Script:Mono.Elapsed.TotalSeconds - $t0) -lt 300) {
    Invoke-SentinelBeat $Script:Ctx
    if ((Get-Process -Id $cPid -ErrorAction SilentlyContinue) -and (Test-Listening $ConsolePort)) {
      try {
        $sum = (Invoke-RestMethod -Uri "http://127.0.0.1:$ConsolePort/api/system/rpc-overview" -TimeoutSec 10).summary
        Set-BootStatus 'BOOT_OK' @{ consolePid = $cPid; rpcSummary = $sum }; Send-BootEvent 9101 'Information' 'KANet mainnet boot OK'; $ok = $true; break
      } catch { }
    }
    Start-Sleep -Seconds 10
  }
  if (-not $ok) { Warn-Console 64 'CONSOLE_UNHEALTHY' 'console process/port/HTTP not healthy within 300s; NOT restarted by the boot sequence' }
  $st = $null; try { $st = (Get-Process -Id $cPid -ErrorAction Stop).StartTime.Ticks } catch { }
  @{ Pid = $cPid; StartTicks = $st }
}

function Test-SameProcess($ProcId, $StartTicks) {
  # S6: PID reuse safe -- alive AND same start time
  try { $p = Get-Process -Id $ProcId -ErrorAction Stop; return ($null -eq $StartTicks -or $p.StartTime.Ticks -eq $StartTicks) } catch { return $false }
}

function Invoke-PhaseB($Ctx) {
  # PHASE B: kaspad is running. NO exit path and NO uncaught exception below this line (the caller also wraps it).
  if ($InjectFault -eq 'phaseb') { throw 'injected uncaught phase-B exception' }
  $gateOk = $false
  try { $gateOk = Wait-KaspadAlive $Ctx } catch { Warn-Kaspad 98 'KASPAD_GATE' ("unexpected: {0}" -f $_.Exception.Message) }
  if ($SkipConsole) { Set-BootStatus 'CONSOLE_SKIPPED' @{ reason = 'rehearsal switch' }; return }
  if (-not $gateOk) { return }
  $guardOk = $false
  try { $guardOk = Invoke-GuardStep } catch { Warn-Console 65 'CONSOLE_GUARD' ("guard step threw: {0} -- console NOT started (fail-closed)" -f $_.Exception.Message) }
  if (-not $guardOk) { return }
  try { Invoke-OutboundSnap } catch { Send-BootEvent 9403 'Warning' ("outbound snap threw: {0}" -f $_.Exception.Message) }
  try {
    $Script:Con = Start-ConsolePhase $Ctx
    if ($Script:OutboundT0Ok -and $Script:Con) { $Script:OutboundDueMs = [double]$Script:Mono.ElapsedMilliseconds + ($OutboundDelaySec * 1000.0) }
  } catch { Warn-Console 97 'CONSOLE_START' ("unexpected: {0}" -f $_.Exception.Message) }
}

$Script:Beat = @{ HaveMem = $false; MemTried = $false; KDead = $false; CDead = $false; Stale = $false; LastMemMs = -1e12; CfgWarned = $false }
$Script:SentinelFaulted = $false

function Invoke-SentinelBeat($Ctx, [switch]$InGate, [switch]$NoDiff) {
  # ONE sentinel beat = the duties that must never stop while this script lives (NWT N-1). Called on every tick of the sentinel loop AND on
  # every iteration of the three waiting loops that precede it (ALIVE gate up to 24 h, t0-snapshot retries, console verification), so the
  # memory detector and the death watch are never off. Every duty is individually try/catch'd; this function never throws.
  if ($null -eq $Ctx) { $Ctx = $Script:Ctx }
  Set-Heartbeat
  try {
    if ($Script:MemCfgErr -and -not $Script:Beat.CfgWarned) { $Script:Beat.CfgWarned = $true; Send-BootEvent 9313 'Error' ("memory watch DISABLED: invalid config: {0}" -f $Script:MemCfgErr) }
    # kaspad death is reported by the gate itself (Warn-Kaspad 46) while InGate; afterwards by this watch
    if ($Ctx -and -not $InGate -and -not $Script:Beat.KDead -and -not (Test-SameProcess $Ctx.Pid $Ctx.StartTicks)) { $Script:Beat.KDead = $true; Set-BootStatus 'KASPAD_DIED_AFTER_BOOT' @{ kaspadPid = $Ctx.Pid }; Send-BootEvent 9203 'Error' "kaspad pid $($Ctx.Pid) is gone after boot; nothing restarts it automatically" }
    if ($Script:Con -and -not $Script:Beat.CDead -and -not (Test-SameProcess $Script:Con.Pid $Script:Con.StartTicks)) { $Script:Beat.CDead = $true; Set-BootStatus 'CONSOLE_DIED_AFTER_BOOT' @{ consolePid = $Script:Con.Pid }; Send-BootEvent 9204 'Error' "console pid $($Script:Con.Pid) is gone after boot; nothing restarts it automatically" }
    # S3 (heuristic): kaspad alive but its redirected stdout has not been written for >10 min
    if ($Ctx -and -not $Script:Beat.KDead -and -not $Script:Beat.Stale -and $Ctx.StdoutPath -and (Test-Path -LiteralPath $Ctx.StdoutPath)) {
      if (((Get-Date) - (Get-Item -LiteralPath $Ctx.StdoutPath).LastWriteTime).TotalMinutes -gt 10) { $Script:Beat.Stale = $true; Send-BootEvent 9206 'Warning' 'stdout_capture_stale: kaspad is alive but kaspad-stdout.log has not been written for >10 min; the internal log is the authority' }
    }
  } catch { Write-History ("sentinel death-watch exception: {0}" -f $_.Exception.Message) }
  try {   # NWT P3 SHOULD-4: (re)try the memory lock on EVERY beat until we hold it; the sample itself is throttled to one per SentinelTickSec
    if ($InjectFault -eq 'beat' -and -not $Script:BeatFaulted) { $Script:BeatFaulted = $true; throw 'injected beat-duty exception (rehearsal only)' }   # exercises the per-duty catch: the caller must not be interrupted
    if (-not $Script:Beat.HaveMem -and -not $Script:MemCfgErr -and (Enter-MemoryLock)) {
      $Script:Beat.HaveMem = $true
      Write-MemLine ($(if ($Script:Beat.MemTried) { 'MEMWATCH-TAKEOVER: boot sentinel now holds the memory watch ' } else { 'started in boot sentinel ' }) + ("warn={0} crit={1} clear={2} critClear={3} tick={4}s (detection only)" -f $MemWarnPct, $MemCritPct, $MemClearPct, $MemCritClearPct, $SentinelTickSec))
    } elseif (-not $Script:Beat.HaveMem -and -not $Script:MemCfgErr -and -not $Script:Beat.MemTried) { $Script:Beat.MemTried = $true; Write-History 'memory-watch.lock held by another watcher; will retry every beat' }
    if ($Script:Beat.HaveMem -and (([double]$Script:Mono.ElapsedMilliseconds - $Script:Beat.LastMemMs) -ge ($SentinelTickSec * 1000.0))) {
      $Script:Beat.LastMemMs = [double]$Script:Mono.ElapsedMilliseconds
      Invoke-MemoryWatchTick
    }
  } catch { Write-History ("memory tick exception: {0}" -f $_.Exception.Message) }
  try {   # NWT M-B: the boot-window outbound diff runs by itself, every boot (only scheduled when a console exists). Last duty: it is a bounded child (N4-2) and nested beats skip it.
    if (-not $NoDiff -and $Script:OutboundT0Ok -and -not $Script:OutboundDone -and $Script:OutboundDueMs -gt 0 -and [double]$Script:Mono.ElapsedMilliseconds -ge $Script:OutboundDueMs) { Invoke-OutboundDiff }
  } catch { Write-History ("outbound diff exception: {0}" -f $_.Exception.Message) }
}

function Invoke-SentinelLoop($Ctx) {
  # Resident sentinel. Every duty lives in Invoke-SentinelBeat (individually try/catch'd); nothing here can end the script (production never returns).
  if ($InjectFault -eq 'sentinel' -and -not $Script:SentinelFaulted) { $Script:SentinelFaulted = $true; throw 'injected sentinel-loop exception (rehearsal only)' }   # exercises the outermost catch in Invoke-BootMain
  $ticks = 0
  while ($true) {
    Invoke-SentinelBeat $Ctx
    $ticks++
    if ($Script:MaxSentinelTicks -gt 0 -and $ticks -ge $Script:MaxSentinelTicks) { return }   # test hook only; production value is 0
    Start-Sleep -Seconds $SentinelTickSec
  }
}

function Invoke-BootMain {
  New-Item -ItemType Directory -Force -Path $BootDir | Out-Null
  $Script:MemCfgErr = Test-MemoryConfig (Get-MemoryConfig)
  # Single boot instance via an exclusive file lock held for the life of the process (a Global\ mutex needs a privilege a limited
  # task token may lack; the lock also works across sessions). Task Scheduler is set to IgnoreNew as well.
  try { $Script:LockStream = [System.IO.File]::Open((Join-Path $BootDir 'boot.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
  catch { Write-History 'another boot sequence instance holds boot.lock; exiting'; exit 10 }
  $Script:Ctx = $null
  try { Invoke-PhaseA }
  catch {
    # kaspad NOT yet known => nothing was started => exiting is legal. kaspad known => it is NOT: warn and carry on.
    if ($null -eq $Script:Ctx) { Stop-Boot 99 'UNEXPECTED_PRE_START' $_.Exception.Message }
    Write-History ("Phase A threw AFTER kaspad was known (carrying on): {0}" -f $_.Exception.Message)
    Send-BootEvent 9099 'Warning' ("boot: unexpected exception after kaspad was started/adopted; carrying on as sentinel: {0}" -f $_.Exception.Message)
  }
  # --- from here on: kaspad is known. No exit, no uncaught exception, no re-entry of the start logic. ---
  try { Invoke-PhaseB $Script:Ctx }
  catch { Write-History ("Phase B threw (carrying on as sentinel): {0}" -f $_.Exception.Message); Send-BootEvent 9098 'Warning' ("boot: unexpected exception in the boot phases; kaspad left running, sentinel continues: {0}" -f $_.Exception.Message) }
  while ($true) {
    try { Invoke-SentinelLoop $Script:Ctx; if ($Script:MaxSentinelTicks -gt 0) { return } }
    catch { Write-History ("sentinel loop threw (restarting the loop, NOT the boot logic): {0}" -f $_.Exception.Message); Start-Sleep -Seconds 30 }
  }
}

if ($SelfTest) {
  # Helper / vector / control-flow checks only. Uses a temp dir; starts NO real process, touches no production path.
  $tmp = Join-Path $env:TEMP ('boot-selftest-' + $Stamp); New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $KanetRoot = $tmp; $BootDir = Join-Path $tmp 'logs\mainnet\boot'; New-Item -ItemType Directory -Force -Path $BootDir | Out-Null
  $StatusFile = Join-Path $BootDir 'boot-status.json'; $HistoryFile = Join-Path $BootDir 'boot-history.log'; $MemLogFile = Join-Path $BootDir 'memory-watch.log'; $HeartbeatFile = Join-Path $BootDir 'sentinel-heartbeat'; $MemHeartbeatFile = Join-Path $BootDir 'memwatch-heartbeat'
  # SELFTEST SAFETY: every path a flow test could touch is redirected into the temp dir (an earlier draft left $KaspadLogDir on the
  # production path; the live kaspad's open log file happened to make the rotation fail instead of renaming it).
  $KaspadLogDir = Join-Path $tmp 'kaspad-logs'; New-Item -ItemType Directory -Force -Path $KaspadLogDir | Out-Null
  $KaspadInternalLog = Join-Path $tmp 'rusty-kaspa.log'; $AppDir = Join-Path $tmp 'kaspa-data'
  $KaspadExe = Join-Path $tmp 'fake-kaspad.exe'; New-Item -ItemType File -Force -Path $KaspadExe | Out-Null
  $ExpectedConsoleScript = Join-Path $tmp 'kasia-consolesrcindex.js'
  # NWT N-6: the safety assertion is (a) about the temp dir itself and (b) re-run before EVERY recursive delete, with a path-separator boundary
  function Assert-UnderTmp([string]$p) {
    $tempRoot = [System.IO.Path]::GetTempPath().TrimEnd('\')
    $leaf = Split-Path -Leaf $tmp
    if (-not ($tmp.StartsWith($tempRoot + '\') -and $leaf -like 'boot-selftest-*')) { throw "SELFTEST SAFETY: temp root is not a boot-selftest-* dir under GetTempPath(): $tmp" }
    if (-not ($p -eq $tmp -or $p.StartsWith($tmp + '\'))) { throw "SELFTEST SAFETY: path outside the temp dir: $p" }
  }
  foreach ($pathVar in $KanetRoot, $BootDir, $StatusFile, $HistoryFile, $MemLogFile, $HeartbeatFile, $MemHeartbeatFile, $KaspadLogDir, $KaspadInternalLog, $KaspadExe, $AppDir, $ExpectedConsoleScript) { Assert-UnderTmp $pathVar }
  $fail = 0
  function Check([string]$Name, [bool]$Ok) { if ($Ok) { "PASS $Name" } else { "FAIL $Name"; $Script:fail++ } }
  # --- log rotation
  Set-Content (Join-Path $tmp 'a-stdout.log') 'evidence' -Encoding ASCII
  New-Item -ItemType File -Force -Path (Join-Path $tmp 'a-stderr.log') | Out-Null   # truly 0 bytes (Set-Content '' writes CRLF)
  $d = Rotate-LogIfPresent (Join-Path $tmp 'a-stdout.log') $Stamp
  Check 'rotate-nonempty-renames' ($d -and (Test-Path $d) -and -not (Test-Path (Join-Path $tmp 'a-stdout.log')) -and ((Get-Content $d) -eq 'evidence'))
  Check 'rotate-name-convention' ($d -like "*a-stdout.pre-boot-$Stamp.log")
  Check 'rotate-empty-skipped' ($null -eq (Rotate-LogIfPresent (Join-Path $tmp 'a-stderr.log') $Stamp))
  Check 'rotate-missing-skipped' ($null -eq (Rotate-LogIfPresent (Join-Path $tmp 'nope.log') $Stamp))
  Set-Content (Join-Path $tmp 'a-stdout.log') 'second' -Encoding ASCII
  $threw = $false; try { Rotate-LogIfPresent (Join-Path $tmp 'a-stdout.log') $Stamp | Out-Null } catch { $threw = $true }
  Check 'rotate-collision-throws-and-keeps-source' ($threw -and (Test-Path (Join-Path $tmp 'a-stdout.log')) -and ((Get-Content (Join-Path $tmp 'a-stdout.log')) -eq 'second'))
  # --- command-line matching
  $exe = 'D:\x\kaspad.exe'; $a = @('--appdir=D:\d', '--utxoindex')
  Check 'args-match-quoted-exe' (Test-ArgsMatch '"D:\x\kaspad.exe" --appdir=D:\d --utxoindex' $exe $a)
  Check 'args-match-rejects-extra' (-not (Test-ArgsMatch 'D:\x\kaspad.exe --appdir=D:\d --utxoindex --unsaferpc' $exe $a))
  Check 'args-match-rejects-missing' (-not (Test-ArgsMatch 'D:\x\kaspad.exe --appdir=D:\d' $exe $a))
  Check 'args-match-rejects-different-value' (-not (Test-ArgsMatch 'D:\x\kaspad.exe --appdir=D:\other --utxoindex' $exe $a))
  # --- NWT M2 fixtures: fabricated process records (no live process is touched)
  $mainK = [pscustomobject]@{ ProcessId = 100; CommandLine = '"D:\rusty-kaspa-v201\kaspad.exe" --appdir=D:\kaspa-mainnet-data-v201 --utxoindex --rpclisten-borsh=127.0.0.1:17110 --rocksdb-cache-size=2048' }
  $simK = [pscustomobject]@{ ProcessId = 200; CommandLine = '"D:\rusty-kaspa-v201\kaspad.exe" --simnet --appdir=D:\kanet-tn12\scratch\simnet-data --rpclisten-borsh=127.0.0.1:17510' }
  $oddK = [pscustomobject]@{ ProcessId = 300; CommandLine = 'D:\rusty-kaspa-v201\kaspad.exe --appdir=D:\kaspa-mainnet-data-v201 --unsaferpc' }
  Check 'kaspad-select-mainnet-and-simnet-together' ((@(Select-MainnetKaspad @($mainK, $simK) 'D:\kaspa-mainnet-data-v201' 17110)).Count -eq 1)
  Check 'kaspad-select-only-simnet-is-zero-not-42' ((@(Select-MainnetKaspad @($simK) 'D:\kaspa-mainnet-data-v201' 17110)).Count -eq 0)
  Check 'kaspad-select-mainnet-appdir-with-odd-args-still-selected' ((@(Select-MainnetKaspad @($oddK) 'D:\kaspa-mainnet-data-v201' 17110)).Count -eq 1)
  $prodJs = 'D:\kanet-tn12\kasia-console\src\index.js'
  $cProd = [pscustomobject]@{ ProcessId = 500; CommandLine = '"C:\Program Files\nodejs\node.exe" D:\kanet-tn12\kasia-console\src\index.js' }
  $cWt1 = [pscustomobject]@{ ProcessId = 501; CommandLine = 'node.exe D:\kanet-tn12\scratch\_j2_wt_a_branch\kasia-console\src\index.js' }
  $cWt2 = [pscustomobject]@{ ProcessId = 502; CommandLine = 'node.exe D:\kanet-tn12\scratch\_nwt_wt_b9v03\kasia-console\src\index.js' }
  Check 'console-select-ignores-worktree-copies' ((@(Select-ConsoleCandidates @($cWt1, $cWt2) $prodJs)).Count -eq 0)
  Check 'console-select-picks-only-production-path' ((@(Select-ConsoleCandidates @($cProd, $cWt1, $cWt2) $prodJs)).Count -eq 1)
  Check 'console-claim-needs-all-three' ((Test-ConsoleClaim $cProd @(500) '500') -and -not (Test-ConsoleClaim $cProd @(999) '500') -and -not (Test-ConsoleClaim $cProd @(500) '501') -and -not (Test-ConsoleClaim $cProd @(500) '') -and -not (Test-ConsoleClaim $null @(500) '500'))
  # --- NWT S2 + S-E: previous-stop marker (string function AND the real file reader on a >8 KB log)
  Check 'stop-marker-clean' ((Test-CleanStopMarker "x`r`n2026-09-19 21:12:21 [INFO ] Kaspad has stopped...`r`n`r`n").clean)
  Check 'stop-marker-unclean-when-last-line-is-other' (-not (Test-CleanStopMarker "Kaspad has stopped...`r`n2026-09-19 22:00:00 [INFO ] Accepted 100 blocks`r`n").clean)
  Check 'stop-marker-empty-is-unknown' (-not (Test-CleanStopMarker "`r`n`r`n").known)
  $big = Join-Path $tmp 'big-internal.log'
  $filler = ('2026-09-19 20:00:00 [INFO ] Processed 100 blocks in the last 10s (lots of filler text to exceed the tail window)' + "`r`n") * 300   # ~30 KB
  Set-Content -LiteralPath $big -Value ($filler + '2026-09-19 21:12:21.263 [INFO ] Kaspad has stopped...') -Encoding ASCII
  $t8 = Get-LogTail $big
  Check 'get-logtail-real-file-over-8KB-returns-only-the-tail-and-finds-marker' (($t8.Length -le 8192) -and ($t8.Length -gt 100) -and (Test-CleanStopMarker $t8).clean)
  Set-Content -LiteralPath $big -Value ($filler + '2026-09-19 22:00:00.000 [INFO ] Accepted 100 blocks') -Encoding ASCII
  Check 'get-logtail-real-file-unclean-when-last-line-is-other' (-not (Test-CleanStopMarker (Get-LogTail $big)).clean)
  Check 'get-logtail-missing-file-is-null' ($null -eq (Get-LogTail (Join-Path $tmp 'missing.log')))
  # --- status file + commit sample + heartbeat
  Set-BootStatus 'SELFTEST' @{ ok = $true }
  Check 'status-json-roundtrip' ((Get-Content $StatusFile -Raw | ConvertFrom-Json).phase -eq 'SELFTEST')
  $ms = Get-MemorySample
  Check 'memory-sample-sane' (($ms.pct -gt 0) -and ($ms.limitGB -gt 0) -and ($ms.top -notmatch '[\\/ ]--') -and ($ms.selfMB -gt 0) -and ($ms.selfHandles -gt 0))
  Set-Heartbeat
  Check 'heartbeat-file-written' ((Test-Path $HeartbeatFile) -and (((Get-Date) - (Get-Item $HeartbeatFile).LastWriteTime).TotalSeconds -lt 30))
  # --- exhaustion-class detection: message AND numeric HRESULT (NWT P3 SHOULD-2)
  Check 'exhaustion-by-OutOfMemoryException' (Test-ExhaustionError (New-Object System.OutOfMemoryException))
  Check 'exhaustion-by-message-en' (Test-ExhaustionError (New-Object System.Exception 'Not enough memory resources are available to process this command'))
  Check 'exhaustion-by-HRESULT-0x8007000E-with-foreign-message' (Test-ExhaustionError (New-Object System.Runtime.InteropServices.COMException 'texto en otro idioma', -2147024882))
  Check 'exhaustion-by-HRESULT-0x800705AF' (Test-ExhaustionError (New-Object System.Runtime.InteropServices.COMException 'x', -2147023441))
  Check 'exhaustion-by-HRESULT-0x80070008' (Test-ExhaustionError (New-Object System.Runtime.InteropServices.COMException 'x', -2147024888))
  Check 'exhaustion-by-HRESULT-0x800705AA' (Test-ExhaustionError (New-Object System.Runtime.InteropServices.COMException 'x', -2147023446))
  Check 'exhaustion-by-inner-exception-chain' (Test-ExhaustionError (New-Object System.Exception 'outer', (New-Object System.Runtime.InteropServices.COMException 'inner', -2147024882)))
  Check 'exhaustion-not-triggered-by-unrelated-error' (-not (Test-ExhaustionError (New-Object System.Exception 'some generic wmi failure')))
  # --- memory config validation (NWT: crit <= warn must be rejected)
  $cfg = @{ Warn = 85; Crit = 92; Clear = 80; CritClear = 88; RepeatMs = 1800000; EscalatePp = 5 }
  Check 'memcfg-valid' ($null -eq (Test-MemoryConfig $cfg))
  Check 'memcfg-rejects-crit-le-warn' ($null -ne (Test-MemoryConfig @{ Warn = 85; Crit = 85; Clear = 80; CritClear = 88; RepeatMs = 1; EscalatePp = 1 }))
  Check 'memcfg-rejects-clear-ge-warn' ($null -ne (Test-MemoryConfig @{ Warn = 85; Crit = 92; Clear = 85; CritClear = 88; RepeatMs = 1; EscalatePp = 1 }))
  Check 'memcfg-rejects-critclear-le-warn' ($null -ne (Test-MemoryConfig @{ Warn = 85; Crit = 92; Clear = 80; CritClear = 85; RepeatMs = 1; EscalatePp = 1 }))
  Check 'memcfg-rejects-crit-ge-100' ($null -ne (Test-MemoryConfig @{ Warn = 85; Crit = 100; Clear = 80; CritClear = 88; RepeatMs = 1; EscalatePp = 1 }))
  # --- state-machine vectors: each vector = @(name, @(@(pct, tSec), ...), expected actions). Runs against ANY transition function.
  $vectors = @(
    @('V1-below-warn-silent',            @(@(50, 0), @(84.9, 30)),                       @('none', 'none')),
    @('V2-enter-warn-at-85',             @(@(84.9, 0), @(85, 30)),                       @('none', 'enter-warn')),
    @('V3-no-repeat-inside-30min',       @(@(85, 0), @(86, 60), @(87, 120)),             @('enter-warn', 'none', 'none')),
    @('V4-warn-repeat-on-plus-5pp',      @(@(85, 0), @(91, 60)),                         @('enter-warn', 'repeat')),
    @('V5-warn-escalates-to-crit',       @(@(85, 0), @(92, 60)),                         @('enter-warn', 'escalate')),
    @('V6-crit-downgrades-to-warn',      @(@(92, 0), @(87.9, 60)),                       @('enter-crit', 'downgrade')),
    @('V7-hysteresis-then-clear',        @(@(85, 0), @(82, 60), @(79.9, 120)),           @('enter-warn', 'none', 'cleared')),
    @('V8-warn-repeat-after-30min',      @(@(85, 0), @(86, 1800)),                       @('enter-warn', 'repeat')),
    @('V9-rearm-after-clear',            @(@(85, 0), @(70, 60), @(85, 120)),             @('enter-warn', 'cleared', 'enter-warn')),
    @('V10-ok-to-crit-direct',           @(@(50, 0), @(95, 30)),                         @('none', 'enter-crit')),
    @('V11-crit-to-ok-direct',           @(@(93, 0), @(70, 30)),                         @('enter-crit', 'cleared')),
    @('V12-crit-repeat-on-plus-5pp',     @(@(92, 0), @(97, 30)),                         @('enter-crit', 'repeat')),
    @('V13-crit-repeat-after-30min',     @(@(92, 0), @(93, 1800)),                       @('enter-crit', 'repeat')),
    @('V14-warn-band-never-repeats',     @(@(85, 0), @(82, 1900)),                       @('enter-warn', 'none')),
    @('V15-crit-band-never-repeats',     @(@(93, 0), @(90, 1900)),                       @('enter-crit', 'none'))
  )
  function Get-VectorFailures([scriptblock]$Fn) {
    $bad = @()
    foreach ($v in $vectors) {
      $st = @{ Level = 'OK'; LastMs = 0; LastPct = 0 }; $got = @()
      foreach ($step in $v[1]) { $t = & $Fn $st $step[0] ($step[1] * 1000.0) $cfg; $st = $t.State; $got += $t.Action }
      if (($got -join ',') -ne ($v[2] -join ',')) { $bad += $v[0] }
    }
    $bad
  }
  $real = (Get-Command Get-MemoryTransition).ScriptBlock
  $bad = @(Get-VectorFailures $real)
  Check 'state-machine-all-15-vectors-pass' ($bad.Count -eq 0)
  if ($bad.Count) { "  failing vectors: $($bad -join ', ')" }
  # --- mutation checks: each mutant edits ONE tagged line; at least one vector must go red (else the vectors guard nothing)
  $body = $real.ToString()
  function New-Mutant([string]$Tag, [string]$Old, [string]$New) {
    $out = @(); $hit = 0
    foreach ($l in ($body -split "`r?`n")) { if ($l.Contains("#T-$Tag") -and $l.Contains($Old)) { $l = $l.Replace($Old, $New); $hit++ }; $out += $l }
    if ($hit -ne 1) { return $null }
    [scriptblock]::Create($out -join "`n")
  }
  $mutants = @(
    @('OKWARN',       '$Pct -ge $Cfg.Warn',                          '$Pct -gt $Cfg.Warn'),
    @('OKCRIT',       '$Pct -ge $Cfg.Crit',                          '$Pct -gt 1000'),
    @('WARNCRIT',     '$Pct -ge $Cfg.Crit',                          '$Pct -gt 1000'),
    @('WARNCLEAR',    '$Pct -lt $Cfg.Clear',                         '$Pct -lt 0'),
    @('CRITCLEAR',    '$Pct -lt $Cfg.Clear',                         '$Pct -lt 0'),
    @('CRITDOWN',     '$Pct -lt $Cfg.CritClear',                     '$Pct -lt $Cfg.Clear'),
    @('WARNREP_T',    '($NowMs - $State.LastMs) -ge $Cfg.RepeatMs',  '($NowMs - $State.LastMs) -ge 1e15'),
    @('WARNREP_PP',   '$Pct -ge ($State.LastPct + $Cfg.EscalatePp)', '$Pct -ge 1000'),
    @('CRITREP_T',    '($NowMs - $State.LastMs) -ge $Cfg.RepeatMs',  '($NowMs - $State.LastMs) -ge 1e15'),
    @('CRITREP_PP',   '$Pct -ge ($State.LastPct + $Cfg.EscalatePp)', '$Pct -ge 1000'),
    @('WARNREP_T',    '$Pct -ge $Cfg.Warn -and',                     ''),
    @('CRITREP_T',    '$Pct -ge $Cfg.Crit -and',                     '')
  )
  foreach ($m in $mutants) {
    $sb = New-Mutant $m[0] $m[1] $m[2]
    if (-not $sb) { Check ("mutant-{0}-applied-exactly-once" -f $m[0]) $false; continue }
    $red = @(Get-VectorFailures $sb)
    Check ("mutant-{0} '{1}'->'{2}' turns >=1 vector red" -f $m[0], $m[1], $m[2]) ($red.Count -ge 1)
  }
  # --- real reading (2026-09-19 23:20, commit 74.9% of 89.6 GB; llama-server + two python.exe back): silent at the default thresholds, enter-warn if warn were 70
  $st0 = @{ Level = 'OK'; LastMs = 0; LastPct = 0 }
  Check 'real-reading-74.9-default-thresholds-is-silent' ((Get-MemoryTransition $st0 74.9 0 $cfg).Action -eq 'none')
  $cfg70 = @{ Warn = 70; Crit = 92; Clear = 60; CritClear = 88; RepeatMs = 1800000; EscalatePp = 5 }
  Check 'real-reading-74.9-with-warn-70-enters-warn' ((Get-MemoryTransition $st0 74.9 0 $cfg70).Action -eq 'enter-warn')
  # second real reading (2026-09-20 02:50 +07, commit 77.4% = 69.3 of 89.6 GB, physFree 32.4 GB; the coordinator saw it cross 80% at 02:47): still silent at the default warn=85, WARN once warn is 75
  Check 'real-reading-77.4-default-thresholds-is-silent' ((Get-MemoryTransition $st0 77.4 0 $cfg).Action -eq 'none')
  $cfg75 = @{ Warn = 75; Crit = 92; Clear = 65; CritClear = 88; RepeatMs = 1800000; EscalatePp = 5 }
  Check 'real-reading-77.4-with-warn-75-enters-warn' ((Get-MemoryTransition $st0 77.4 0 $cfg75).Action -eq 'enter-warn')
  Check 'synthetic-80.5-default-thresholds-is-still-silent (NOT a measured value: the coordinator reported a crossing of 80% at 02:47, the number itself was not read by me)' ((Get-MemoryTransition $st0 80.5 0 $cfg).Action -eq 'none')
  # --- watch tick smoke (real sample, temp log)
  $Script:MemState = @{ Level = 'OK'; LastMs = 0; LastPct = 0 }; $Script:MemTicks = 0
  $ok = $true; try { Invoke-MemoryWatchTick } catch { $ok = $false }
  Check 'memory-tick-smoke-no-throw-and-logs-first-sample-with-sentinel-self-footprint' ($ok -and (Test-Path $MemLogFile) -and ((Get-Content $MemLogFile -Raw) -match 'SAMPLE commit=.*sentinel_ws=.*handles='))
  # --- sampling-failure path (NWT P3): fabricated sampler + recorded events; no real event log is touched
  $Script:EvIds = @()
  function Send-BootEvent([int]$Id, [string]$Type, [string]$Msg) { $Script:EvIds += $Id }
  $Script:Fake = $null
  function Get-MemorySample { if ($Script:Fake -is [System.Exception]) { throw $Script:Fake }; if ($Script:Fake -is [string]) { throw $Script:Fake }; $Script:Fake }
  $good = @{ pct = 60.0; usedGB = 50.0; limitGB = 89.6; physFreeGB = 30.0; top = 'x:1:1'; selfMB = 40.0; selfHandles = 500 }
  $Script:MemState = @{ Level = 'WARN'; LastMs = 0; LastPct = 86 }; $Script:MemFails = 0; $Script:MemFailAlerted = $false; $Script:MemExhaustAlerted = $false; $Script:MemTicks = 0
  $Script:Fake = 'Exception of type System.OutOfMemoryException was thrown'; Invoke-MemoryWatchTick
  Check 'sample-fail-exhaustion-class-alerts-9310-on-FIRST-occurrence' (($Script:EvIds -contains 9310) -and ($Script:EvIds -notcontains 9311))
  $Script:EvIds = @(); $Script:MemFails = 0; $Script:MemFailAlerted = $false; $Script:MemExhaustAlerted = $false
  $Script:Fake = (New-Object System.Runtime.InteropServices.COMException 'mensaje localizado sin palabras clave', -2147024882); Invoke-MemoryWatchTick
  Check 'sample-fail-exhaustion-class-by-HRESULT-alerts-9310-even-with-foreign-message' ($Script:EvIds -contains 9310)
  $Script:EvIds = @(); $Script:MemFails = 0; $Script:MemFailAlerted = $false; $Script:MemExhaustAlerted = $false
  $Script:Fake = 'some generic wmi failure'; 1..2 | ForEach-Object { Invoke-MemoryWatchTick }
  Check 'sample-fail-two-generic-failures-do-not-alert' ($Script:EvIds.Count -eq 0)
  Invoke-MemoryWatchTick; Invoke-MemoryWatchTick
  Check 'sample-fail-third-failure-alerts-9311-exactly-once' ((@($Script:EvIds | Where-Object { $_ -eq 9311 })).Count -eq 1)
  Check 'sample-fail-state-is-HELD-not-reset' ($Script:MemState.Level -eq 'WARN')
  $Script:Fake = $good; Invoke-MemoryWatchTick
  Check 'sample-recovery-alerts-9312-and-logs-blindMs' (($Script:EvIds -contains 9312) -and ((Get-Content $MemLogFile -Raw) -match 'blindMs='))
  Check 'sample-recovery-below-clear-then-clears-held-state' ($Script:MemState.Level -eq 'OK' -and ($Script:EvIds -contains 9305))

  # ================= N4-2: parent-side time limit on node children (REAL node processes; only the ones this test creates are ever killed) =================
  $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
  Assert-UnderTmp (Join-Path $tmp 'scripts'); New-Item -ItemType Directory -Force -Path (Join-Path $tmp 'scripts') | Out-Null
  $busyJs = Join-Path $tmp 'scripts\busy.js'; $fastJs = Join-Path $tmp 'scripts\fast.js'; $echoJs = Join-Path $tmp 'scripts\echo.js'
  foreach ($jsPath in $busyJs, $fastJs, $echoJs) { Assert-UnderTmp $jsPath }
  # the child arms its OWN 1 s hard timer and then blocks its event loop for 20 s: that timer cannot fire (NWT measured exactly this), only the parent-side limit can end it
  Set-Content -LiteralPath $busyJs -Value "setTimeout(() => process.exit(2), 1000); const t = Date.now(); while (Date.now() - t < 20000) {} console.log('finished busy loop');" -Encoding ASCII
  Set-Content -LiteralPath $fastJs -Value "console.log('hello'); process.stderr.write('oops'); process.exit(3);" -Encoding ASCII
  Set-Content -LiteralPath $echoJs -Value "console.log(process.argv.slice(2).join('|'));" -Encoding ASCII
  $r1 = Invoke-BoundedProcess $nodeExe @($fastJs) 20
  Check 'bounded-N4-2a-fast-tool: the real exit code and both streams are returned, not timed out' (($r1.Code -eq 3) -and ($r1.Text -match 'hello') -and ($r1.Text -match 'oops') -and (-not $r1.TimedOut))
  $r2 = Invoke-NodeTool 'scripts\echo.js' @('a b', 'c') 20
  Check 'bounded-N4-2b-Invoke-NodeTool: an argument with a space survives the quoting, exit 0' (($r2.Code -eq 0) -and ($r2.Text -eq 'a b|c'))
  $bystander = Start-Process -FilePath $nodeExe -ArgumentList '-e "setTimeout(() => {}, 60000)"' -PassThru -NoNewWindow
  $swB = [System.Diagnostics.Stopwatch]::StartNew()
  $r3 = Invoke-BoundedProcess $nodeExe @($busyJs) 2
  $swB.Stop()
  $r3pid = if ($r3.Text -match 'killed pid (\d+)') { [int]$Matches[1] } else { 0 }
  Check ('bounded-N4-2c-hung-child: a 20 s event-loop block ends at the parent-side limit (returned after {0:N1}s, want < 9), Code -2, TimedOut' -f $swB.Elapsed.TotalSeconds) (($swB.Elapsed.TotalSeconds -lt 9) -and ($r3.Code -eq -2) -and $r3.TimedOut -and ($r3.Text -like 'TIMEOUT after 2s*'))
  Check 'bounded-N4-2d-exactly the timed-out process is gone; an unrelated node process is still alive (no kill by name)' (($r3pid -gt 0) -and ($null -eq (Get-Process -Id $r3pid -ErrorAction SilentlyContinue)) -and (-not $bystander.HasExited))
  try { $bystander.Kill() } catch { }
  # while a tool hangs the beat keeps running: memory samples and both heartbeats advance DURING the wait (the N-1 invariant holds inside a single child call)
  $tickSaved = $SentinelTickSec; $SentinelTickSec = 1
  try { $v = Get-Variable -Scope Script -Name 'MemLock' -ValueOnly -ErrorAction SilentlyContinue; if ($v) { $v.Dispose(); Set-Variable -Scope Script -Name 'MemLock' -Value $null } } catch { }   # an earlier memory test may still hold memory-watch.lock
  $Script:Beat = @{ HaveMem = $false; MemTried = $false; KDead = $false; CDead = $false; LastMemMs = -1e12; Stale = $false; CfgWarned = $false }; $Script:MemCfgErr = $null; $Script:MemTicks = 0; $Script:Ctx = $null; $Script:Fake = $good   # Get-MemorySample is the fabricated sampler here (returns $Script:Fake)
  Remove-Item $HeartbeatFile, $MemHeartbeatFile -ErrorAction SilentlyContinue
  $r4 = Invoke-BoundedProcess $nodeExe @($busyJs) 4
  Check ('bounded-N4-2e-beat-runs-DURING-a-hung-child: {0} memory samples in a 4 s wait at a 1 s tick (want >= 2), both heartbeats fresh' -f $Script:MemTicks) (($r4.Code -eq -2) -and ($Script:MemTicks -ge 2) -and (Test-Path $HeartbeatFile) -and (Test-Path $MemHeartbeatFile) -and (((Get-Date) - (Get-Item $MemHeartbeatFile).LastWriteTime).TotalSeconds -lt 3))
  $SentinelTickSec = $tickSaved
  try { $v = Get-Variable -Scope Script -Name 'MemLock' -ValueOnly -ErrorAction SilentlyContinue; if ($v) { $v.Dispose(); Set-Variable -Scope Script -Name 'MemLock' -Value $null } } catch { }
  $r5 = Invoke-BoundedProcess $nodeExe @((Join-Path $tmp 'scripts\does-not-exist.js')) 20
  Check 'bounded-N4-2f-missing-script: node exits non-zero, no timeout, no throw' (($r5.Code -ne 0) -and ($r5.Code -ne -2) -and (-not $r5.TimedOut))

  # ================= CONTROL-FLOW TESTS under stubs (NWT M-A / M-B / M-C / S-A): the real Invoke-BootMain runs; every
  # process-touching primitive is replaced by a stub that records calls. Nothing real is started; Start-Sleep is a no-op. =========
  $Script:Sim = @{}; $Script:GuardChecksStub = 41   # stub text only; the real tool prints its own count
  function Dispose-Locks { foreach ($lk in 'LockStream', 'MemLock') { try { $v = Get-Variable -Scope Script -Name $lk -ValueOnly -ErrorAction SilentlyContinue; if ($v) { $v.Dispose(); Set-Variable -Scope Script -Name $lk -Value $null } } catch { } } }
  function Reset-Sim([hashtable]$over = @{}) {
    Dispose-Locks
    Assert-UnderTmp $BootDir; Assert-UnderTmp $KanetRoot   # re-asserted immediately before the recursive delete (NWT N-6)
    Remove-Item -Recurse -Force (Join-Path $BootDir '*') -ErrorAction SilentlyContinue
    $Script:OnSleepAt = 0; $Script:OnSleep = $null; $Script:SentinelFaulted = $false; $Script:Beat = @{ HaveMem = $false; MemTried = $false; KDead = $false; CDead = $false; LastMemMs = -1e12; Stale = $false; CfgWarned = $false }; $Script:MemCfgErr = $null; $Script:Sim = @{ NodeProcs = @(); Listeners = @(); RestCalls = 0; RestFailFirst = 0; Sleeps = 0; StopBoot = @(); Started = 0; Console = 0; Order = @(); Ev = @(); ProbeCode = 0; Sha = $KaspadSha256; GuardCode = 0; SnapCode = 0; DiffCode = 0; TreeOk = $true }
    foreach ($k in $over.Keys) { $Script:Sim[$k] = $over[$k] }
    $Script:Ctx = $null; $Script:Con = $null; $Script:OutboundT0Ok = $false; $Script:OutboundDone = $false; $Script:OutboundDueMs = 0; $Script:ProbeTimeouts = 0; $Script:BeatFaulted = $false
    $Script:MemState = @{ Level = 'OK'; LastMs = 0; LastPct = 0 }; $Script:MemTicks = 0; $Script:MemFails = 0
    $Script:Fake = $good; $Script:MaxSentinelTicks = 2
    $Script:InjectFaultSaved = $InjectFault
  }
  function Stop-Boot([int]$Code, [string]$Phase, [string]$Msg) { $Script:Sim.StopBoot += $Code; throw 'STOPBOOT' }
  function Send-BootEvent([int]$Id, [string]$Type, [string]$Msg) { $Script:Sim.Ev += $Id }
  function Start-Sleep { param([double]$Seconds, [int]$Milliseconds) $Script:Sim.Sleeps++; if ($Script:OnSleepAt -and $Script:Sim.Sleeps -eq $Script:OnSleepAt) { & $Script:OnSleep } }
  function Test-TreeClean { @{ ok = $Script:Sim.TreeOk; reason = 'stub' } }
  function Get-KaspadProcs { @() }
  function Get-FileHash { param($LiteralPath, $Algorithm) [pscustomobject]@{ Hash = $Script:Sim.Sha.ToUpper() } }
  function Get-NativeText([scriptblock]$Block) { $KaspadVersion }
  function Get-LogTail([string]$Path, [int]$Bytes = 8192) { "x`r`n2026 [INFO] Kaspad has stopped..." }
  function Start-Process { param($FilePath, $ArgumentList, $RedirectStandardOutput, $RedirectStandardError, $WindowStyle, [switch]$PassThru) $Script:Sim.Started++; $Script:Sim.Order += 'start-kaspad'; [pscustomobject]@{ Id = $PID } }
  function Invoke-Probe { if ($InjectFault -eq 'probe') { throw 'injected probe failure' }; if ($Script:Sim.ProbeSeq -and $Script:Sim.ProbeSeq.Count -gt 0) { $c = $Script:Sim.ProbeSeq[0]; $Script:Sim.ProbeSeq = @($Script:Sim.ProbeSeq | Select-Object -Skip 1); return [pscustomobject]@{ Code = $c; Line = 'stub probe seq' } }; [pscustomobject]@{ Code = $Script:Sim.ProbeCode; Line = 'stub probe' } }
  function Invoke-NodeTool([string]$ScriptRel, [string[]]$ToolArgs, [int]$TimeoutSec = 120) {
    if ($ScriptRel -like '*guard*') { $Script:Sim.Order += 'guard'; return [pscustomobject]@{ Code = $Script:Sim.GuardCode; Text = $(if ($Script:Sim.GuardCode -eq 0) { "GUARD-RESULT checks=$($Script:GuardChecksStub) not_ok=0" } else { "GUARD config:autotake MISMATCH armed`nGUARD-RESULT checks=$($Script:GuardChecksStub) not_ok=1" }) } }
    if ($ToolArgs[0] -eq 'snap') { $Script:Sim.Order += 'snap'; return [pscustomobject]@{ Code = $Script:Sim.SnapCode; Text = 'SNAP-OK stub' } }
    $Script:Sim.Order += 'diff'; [pscustomobject]@{ Code = $Script:Sim.DiffCode; Text = 'RESULT stub' }
  }
  $RealStartConsole = (Get-Command Start-ConsolePhase).ScriptBlock
  function Get-NodeProcs { @($Script:Sim.NodeProcs) }
  function Get-ListenerPids([int]$Port) { @($Script:Sim.Listeners) }
  function Invoke-RestMethod { param($Uri, $TimeoutSec) $Script:Sim.RestCalls++; if ($Script:Sim.RestCalls -le $Script:Sim.RestFailFirst) { throw 'stub: console not answering yet' }; [pscustomobject]@{ summary = 'stub 18/18' } }
  function Start-ConsolePhase($Ctx) { if ($Script:Sim.NoConsole) { return $null }; $Script:Sim.Console++; $Script:Sim.Order += 'console'; @{ Pid = $PID; StartTicks = $null } }
  $SkipConsole = [switch]$false
  function Run-Flow {
    try { Invoke-BootMain } catch { if ($_.Exception.Message -ne 'STOPBOOT') { $Script:Sim.Ev += 'UNCAUGHT:' + $_.Exception.Message } }
    if ($env:BOOT_SELFTEST_DEBUG) { "  [flow] inject=$InjectFault Order=$($Script:Sim.Order -join ',') Ev=$($Script:Sim.Ev -join ',') Stop=$($Script:Sim.StopBoot -join ',') Started=$($Script:Sim.Started) Console=$($Script:Sim.Console)" }
  }

  Reset-Sim; Run-Flow
  Check 'flow-F1-normal: kaspad started once, guard->snap->console in that order, sentinel ran, no Stop-Boot' (($Script:Sim.StopBoot.Count -eq 0) -and ($Script:Sim.Started -eq 1) -and (($Script:Sim.Order -join ',') -eq 'start-kaspad,guard,snap,console') -and ($Script:Sim.Ev -notcontains 9065))
  Check 'flow-F1b: heartbeat written by the sentinel' (Test-Path $HeartbeatFile)

  $InjectFault = 'pidfile'; Reset-Sim; Run-Flow
  Check 'flow-F2-inject-pidfile-failure-after-kaspad-started: NO Stop-Boot, kaspad context published, boot continues to console' (($Script:Sim.StopBoot.Count -eq 0) -and ($Script:Sim.Started -eq 1) -and ($Script:Sim.Console -eq 1) -and ($Script:Ctx.Pid -gt 0))

  $InjectFault = 'phasea-late'; Reset-Sim; Run-Flow
  Check 'flow-F2b-inject-exception-late-in-Phase-A-after-kaspad-known (reaches the OUTER catch): NO Stop-Boot, 9099 raised, boot continues to console' (($Script:Sim.StopBoot.Count -eq 0) -and ($Script:Sim.Started -eq 1) -and ($Script:Sim.Ev -contains 9099) -and ($Script:Sim.Console -eq 1))

  $InjectFault = 'phaseb'; Reset-Sim; Run-Flow
  Check 'flow-F3-inject-uncaught-Phase-B-exception: NO Stop-Boot, no uncaught exception, kaspad untouched, sentinel still ran, console NOT started' (($Script:Sim.StopBoot.Count -eq 0) -and ($Script:Sim.Started -eq 1) -and ($Script:Sim.Console -eq 0) -and ($Script:Sim.Ev -contains 9098) -and (@($Script:Sim.Ev | Where-Object { "$_" -like 'UNCAUGHT*' }).Count -eq 0) -and (Test-Path $HeartbeatFile))

  $InjectFault = 'probe'; Reset-Sim; Run-Flow
  Check 'flow-F4-probe-throws-every-time (S-A): warn 45 after 5 failed readings, console NOT started, NO Stop-Boot, kaspad untouched' (($Script:Sim.StopBoot.Count -eq 0) -and ($Script:Sim.Started -eq 1) -and ($Script:Sim.Console -eq 0) -and ($Script:Sim.Ev -contains 9045))
  $InjectFault = ''

  Reset-Sim @{ Sha = 'deadbeef' + $KaspadSha256.Substring(8) }; Run-Flow
  Check 'flow-F5-binary-hash-mismatch (PRE-start): Stop-Boot 21 and NOTHING was started' (($Script:Sim.StopBoot -contains 21) -and ($Script:Sim.Started -eq 0))

  Reset-Sim @{ GuardCode = 3 }; Run-Flow
  Check 'flow-F6-guard-mismatch (M-C3): console NOT started, no snapshot, Warning 9065, kaspad left running, NO Stop-Boot' (($Script:Sim.StopBoot.Count -eq 0) -and ($Script:Sim.Started -eq 1) -and ($Script:Sim.Console -eq 0) -and ($Script:Sim.Ev -contains 9065) -and ($Script:Sim.Order -notcontains 'snap'))

  Reset-Sim @{ SnapCode = 5 }; Run-Flow
  Check 'flow-F7-t0-snapshot-never-settles: warning 9403, console still starts (availability), diff never runs' (($Script:Sim.Ev -contains 9403) -and ($Script:Sim.Console -eq 1) -and ($Script:Sim.Order -notcontains 'diff'))

  # F8: the REAL Start-ConsolePhase (captured before it was stubbed) must refuse to start a console on a dirty/wrong tree, while kaspad is unaffected
  Reset-Sim; $tc = & $RealStartConsole @{ Tree = @{ ok = $false; reason = 'dirty tree (fixture)' } }
  Check 'flow-F8-dirty-tree: real Start-ConsolePhase returns null, raises 9062, and never reaches the start-console script' (($null -eq $tc) -and ($Script:Sim.Ev -contains 9062) -and ($Script:Sim.Console -eq 0))

  # F17: the REAL Start-ConsolePhase (adopt path) verification loop must also run the sentinel beat (memory detector) every iteration.
  # Fixture: a fabricated production console (this process's own PID, so Get-Process works), listening, pid file agreeing; the HTTP check
  # fails twice before answering, so the loop iterates. A CRIT sample must be alerted from INSIDE that loop.
  Reset-Sim @{ RestFailFirst = 2 }; $Script:Fake = @{ pct = 95.0; usedGB = 85.0; limitGB = 89.6; physFreeGB = 1.0; top = 'x:1:1'; selfMB = 40.0; selfHandles = 500 }
  $consoleDir = Join-Path $KanetRoot 'logs\mainnet'; New-Item -ItemType Directory -Force -Path $consoleDir | Out-Null; Set-Content -LiteralPath (Join-Path $consoleDir 'console-mainnet.pid') -Value $PID -Encoding ASCII
  $Script:Sim.NodeProcs = @([pscustomobject]@{ ProcessId = $PID; Name = 'node.exe'; CommandLine = ('"node.exe" ' + $ExpectedConsoleScript) }); $Script:Sim.Listeners = @($PID)
  $Script:Ctx = @{ Pid = $PID; StartTicks = $null; Tree = @{ ok = $true; reason = '' }; PrevUnclean = $false }
  $con17 = & $RealStartConsole $Script:Ctx
  Check 'flow-F17-real-console-verification-loop-runs-the-memory-detector (CRIT alerted from inside the console-wait loop; console adopted)' (($null -ne $con17) -and ($Script:Sim.Ev -contains 9302) -and ($Script:Sim.Ev -contains 9101))
  # F17b: the t0-snapshot retry loop too (real Invoke-OutboundSnap; the snapshot tool never settles)
  Reset-Sim @{ SnapCode = 5 }; $Script:Fake = @{ pct = 95.0; usedGB = 85.0; limitGB = 89.6; physFreeGB = 1.0; top = 'x:1:1'; selfMB = 40.0; selfHandles = 500 }; $Script:Ctx = @{ Pid = $PID; StartTicks = $null }
  Invoke-OutboundSnap
  Check 'flow-F17b-t0-snapshot-retry-loop-runs-the-memory-detector (CRIT alerted while the snapshot keeps failing)' (($Script:Sim.Ev -contains 9302) -and ($Script:Sim.Ev -contains 9403))

  # NWT N-1 (their vector, on our fixture): kaspad SYNCING for a long time + a CRIT commit sample. The memory detector must fire 9302 DURING
  # the ALIVE gate wait and must produce a fresh memwatch-heartbeat, without waiting for the sentinel loop.
  Reset-Sim @{ ProbeCode = 7 }; $Script:Fake = @{ pct = 95.0; usedGB = 85.0; limitGB = 89.6; physFreeGB = 1.0; top = 'x:1:1'; selfMB = 40.0; selfHandles = 500 }
  $Script:OnSleepAt = 6; $Script:OnSleep = { $Script:Sim.ProbeCode = 0 }
  $Script:Ctx = @{ Pid = $PID; StartTicks = $null; PrevUnclean = $false }; $null = Wait-KaspadAlive $Script:Ctx; $Script:OnSleepAt = 0
  Check 'flow-F14-NWT-N1: CRIT commit sample during a long ALIVE-gate wait (kaspad SYNCING) raises 9302 BEFORE the sentinel loop exists' (($Script:Sim.Ev -contains 9302) -and (Test-Path $MemHeartbeatFile))
  Reset-Sim @{ ProbeCode = 7 }; $Script:Fake = $good
  $Script:OnSleepAt = 6; $Script:OnSleep = { $Script:Sim.ProbeCode = 0 }
  $Script:Ctx = @{ Pid = $PID; StartTicks = $null; PrevUnclean = $false }; $null = Wait-KaspadAlive $Script:Ctx; $Script:OnSleepAt = 0
  Check 'flow-F14b-control: a NORMAL sample during the gate wait raises no memory alert but still refreshes memwatch-heartbeat' (($Script:Sim.Ev -notcontains 9302) -and ($Script:Sim.Ev -notcontains 9301) -and (Test-Path $MemHeartbeatFile))
  Reset-Sim; $Script:Fake = 'some generic wmi failure'; $Script:Ctx = @{ Pid = $PID; StartTicks = $null; PrevUnclean = $false }
  Invoke-SentinelBeat $Script:Ctx
  Check 'flow-F15-memwatch-heartbeat-is-NOT-refreshed-when-sampling-fails (fresh sentinel-heartbeat + stale memwatch-heartbeat = script up, memory detection not producing)' ((Test-Path $HeartbeatFile) -and -not (Test-Path $MemHeartbeatFile))
  $Script:Beat.LastMemMs = -1e12; $Script:Fake = $good; Invoke-SentinelBeat $Script:Ctx
  Check 'flow-F15b: once a sample succeeds again memwatch-heartbeat appears' (Test-Path $MemHeartbeatFile)
  $InjectFault = 'sentinel'; Reset-Sim; Run-Flow
  Check 'flow-F16-inject-exception-that-escapes-the-sentinel-loop (outermost catch, NWT m5): script survives, loop restarts, kaspad untouched, no Stop-Boot' (($Script:Sim.StopBoot.Count -eq 0) -and ($Script:Sim.Started -eq 1) -and (@($Script:Sim.Ev | Where-Object { "$_" -like 'UNCAUGHT*' }).Count -eq 0) -and ((Get-Content $HistoryFile -Raw) -match 'sentinel loop threw'))
  $InjectFault = ''

  # heartbeat covers the gate too: with no sentinel loop running yet, a long ALIVE wait must still leave a fresh heartbeat
  Reset-Sim @{ ProbeCode = 7 }; Remove-Item $HeartbeatFile -ErrorAction SilentlyContinue
  $Script:OnSleepAt = 2; $Script:OnSleep = { $Script:Sim.ProbeCode = 0 }
  $Script:Ctx = @{ Pid = $PID; StartTicks = $null; PrevUnclean = $false }; $null = Wait-KaspadAlive $Script:Ctx; $Script:OnSleepAt = 0
  Check 'flow-F13-heartbeat-is-written-by-the-ALIVE-gate-loop-not-only-by-the-sentinel' (Test-Path $HeartbeatFile)

  # M-B timing: the diff must run AFTER the console phase and only after the delay, driven by the sentinel
  Reset-Sim; $Script:MaxSentinelTicks = 3; $OutboundDelaySec = 0; Run-Flow; $OutboundDelaySec = 1800
  Check 'flow-F9-outbound-diff-runs-by-itself-after-console (t0 before console, diff after)' (($Script:Sim.Order -join ',') -eq 'start-kaspad,guard,snap,console,diff' -and ($Script:Sim.Ev -contains 9401))
  Reset-Sim @{ DiffCode = 3 }; $Script:MaxSentinelTicks = 3; $OutboundDelaySec = 0; Run-Flow; $OutboundDelaySec = 1800
  Check 'flow-F10-diff-spent-outpoints-raises-Warning-9402' ($Script:Sim.Ev -contains 9402)
  Reset-Sim @{ DiffCode = 4 }; $Script:MaxSentinelTicks = 3; $OutboundDelaySec = 0; Run-Flow; $OutboundDelaySec = 1800
  Check 'flow-F11-unreadable-relay-is-NOT-reported-as-clean (9404, not 9401)' (($Script:Sim.Ev -contains 9404) -and ($Script:Sim.Ev -notcontains 9401))
  # memory lock retry (NWT P3 SHOULD-4): a foreign holder at boot, released later -> takeover on a later tick
  # F12: a foreign holder owns memory-watch.lock at boot; it is released during the 3rd Start-Sleep (= after the sentinel's first tick).
  # The boot sentinel must retry every tick and log MEMWATCH-TAKEOVER, and must have had NO memory watch on tick 1.
  Reset-Sim; $foreign = [System.IO.File]::Open((Join-Path $BootDir 'memory-watch.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
  $Script:OnSleepAt = 3; $Script:OnSleep = { $foreign.Dispose() }; $Script:MaxSentinelTicks = 2; Run-Flow; $Script:OnSleepAt = 0
  $ml = Get-Content $MemLogFile -Raw -ErrorAction SilentlyContinue
  Check 'flow-F12-memory-lock-held-by-another-watcher-is-retried-and-taken-over-with-MEMWATCH-TAKEOVER' (($ml -match 'MEMWATCH-TAKEOVER') -and ($ml -notmatch 'started in boot sentinel'))

  # ---- N4-2 flows: a probe that keeps timing out is its own reading (9207 once), never the "probe error x5" abort; a guard/snapshot/diff timeout is a FAILED reading
  Reset-Sim @{ ProbeSeq = @(-2, -2, -2, -2, -2, -2, 0, 0, 0) }; Run-Flow
  Check 'flow-N4-2g-probe-timeouts x6 then ALIVE x3: 9207 raised ONCE, the gate is NOT aborted (no 9045), console started' ((@($Script:Sim.Ev | Where-Object { $_ -eq 9207 }).Count -eq 1) -and ($Script:Sim.Ev -notcontains 9045) -and ($Script:Sim.Console -eq 1))
  Reset-Sim @{ GuardCode = -2 }; Run-Flow
  Check 'flow-N4-2h-guard-tool-timeout (exit -2) is fail-closed: console NOT started, 9065 raised, no snapshot' (($Script:Sim.Console -eq 0) -and ($Script:Sim.Ev -contains 9065) -and ($Script:Sim.Order -notcontains 'snap'))
  Reset-Sim @{ SnapCode = -2 }; Run-Flow
  Check 'flow-N4-2i-snapshot-tool-timeout: 9403, console still starts (availability), diff never runs' (($Script:Sim.Ev -contains 9403) -and ($Script:Sim.Console -eq 1) -and ($Script:Sim.Order -notcontains 'diff'))
  Reset-Sim @{ DiffCode = -2 }; $Script:MaxSentinelTicks = 3; $OutboundDelaySec = 0; Run-Flow; $OutboundDelaySec = 1800
  Check 'flow-N4-2j-diff-tool-timeout: reported as 9403 (a failed reading), not as "no spend" (9401)' (($Script:Sim.Ev -contains 9403) -and ($Script:Sim.Ev -notcontains 9401))
  # ---- N4-4: a fault INSIDE one beat duty must not interrupt the caller (per-duty catch); a boot with no console must not run or report the outbound diff
  $InjectFault = 'beat'; Reset-Sim; Run-Flow
  Check 'flow-N4-4a-inject-exception-inside-a-beat-duty: the boot completes normally (console started, nothing uncaught) and the exception is recorded' (($Script:Sim.StopBoot.Count -eq 0) -and ($Script:Sim.Console -eq 1) -and (@($Script:Sim.Ev | Where-Object { "$_" -like 'UNCAUGHT*' }).Count -eq 0) -and ((Get-Content $HistoryFile -Raw) -match 'memory tick exception: injected beat-duty'))
  $InjectFault = ''
  Reset-Sim @{ NoConsole = $true }; $Script:MaxSentinelTicks = 3; $OutboundDelaySec = 0; Run-Flow; $OutboundDelaySec = 1800
  Check 'flow-N4-4b-console-not-started: the outbound diff never runs and 9401 is never claimed' (($Script:Sim.Console -eq 0) -and ($Script:Sim.Order -notcontains 'diff') -and ($Script:Sim.Ev -notcontains 9401))
  # ---- N4-4: REAL-time throttle vector (NWT): the memory sample must re-fire about once per tick, not once, not on every beat. tick 1 s, one beat every 0.4 s for 4 s => 3..5 samples
  $tickSaved2 = $SentinelTickSec
  Reset-Sim; $Script:Fake = $good; $SentinelTickSec = 1; $Script:Beat.LastMemMs = -1e12; $Script:MemTicks = 0
  $rt0 = [DateTime]::UtcNow; while (([DateTime]::UtcNow - $rt0).TotalSeconds -lt 4) { Invoke-SentinelBeat $Script:Ctx; [System.Threading.Thread]::Sleep(400) }
  Check ('flow-N4-4c-throttle-real-time: samples over 4 s at a 1 s tick = {0} (want 3..5)' -f $Script:MemTicks) (($Script:MemTicks -ge 3) -and ($Script:MemTicks -le 5))
  $SentinelTickSec = $tickSaved2
  # ---- N4-5 (NWT vectors): direct unit tests of Assert-UnderTmp; only $tmp is rebound and the function called, nothing is deleted
  function Expect-Safety([scriptblock]$sb) { try { & $sb | Out-Null; return $false } catch { return ($_.Exception.Message -like 'SELFTEST SAFETY*') } }
  $tmpSaved = $tmp
  $tmp = 'C:\Windows';                        $t1 = Expect-Safety { Assert-UnderTmp 'C:\Windows' }
  $tmp = (Split-Path $tmpSaved -Parent);      $t2 = Expect-Safety { Assert-UnderTmp $tmp }
  $tmp = $tmpSaved;                           $t3 = Expect-Safety { Assert-UnderTmp ($tmpSaved + 'x') }
  $tmp = $tmpSaved;                           $t4 = -not (Expect-Safety { Assert-UnderTmp (Join-Path $tmpSaved 'ok') })
  $tmp = (Join-Path ([System.IO.Path]::GetTempPath().TrimEnd('\')) 'other-dir'); $t5 = Expect-Safety { Assert-UnderTmp $tmp }
  $tmp = 'C:\Windows\boot-selftest-x';       $t6 = Expect-Safety { Assert-UnderTmp $tmp }
  $tmp = $tmpSaved;                           $t7 = -not (Expect-Safety { Assert-UnderTmp $tmpSaved })
  Check 'asserttmp-1 a temp dir outside the temp root (C:\Windows) is refused' $t1
  Check 'asserttmp-2 tmp == the temp root itself (leaf is not boot-selftest-*) is refused' $t2
  Check 'asserttmp-3 a sibling path that only shares the prefix (no separator boundary) is refused' $t3
  Check 'asserttmp-4 a real child of tmp is accepted' $t4
  Check 'asserttmp-5 tmp under the temp root but with a non boot-selftest leaf is refused' $t5
  Check 'asserttmp-6 a boot-selftest-* leaf that is NOT under GetTempPath() is refused' $t6
  Check 'asserttmp-7 tmp itself is accepted' $t7

  Dispose-Locks
  Assert-UnderTmp $tmp
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  "SELFTEST failures=$fail"; exit ([int]($fail -gt 0))
}

if ($WatchOnly) {
  New-Item -ItemType Directory -Force -Path $BootDir | Out-Null
  $memCfgErr = Test-MemoryConfig (Get-MemoryConfig)
  if ($memCfgErr) { Write-Host "memory config invalid: $memCfgErr"; exit 2 }
  if (-not (Enter-MemoryLock)) { Write-Host 'another memory watcher holds memory-watch.lock; exiting'; exit 10 }
  Write-MemLine ("WATCH-ONLY started warn={0} crit={1} clear={2} critClear={3} tick={4}s (detection only; starts nothing)" -f $MemWarnPct, $MemCritPct, $MemClearPct, $MemCritClearPct, $SentinelTickSec)
  while ($true) {
    Set-Heartbeat
    try { Invoke-MemoryWatchTick } catch { Write-History ("memory tick exception: {0}" -f $_.Exception.Message) }
    Start-Sleep -Seconds $SentinelTickSec
  }
}

Invoke-BootMain
```

## 附录 B. 计划任务注册命令草案（**提权，J1 EXECUTE 单；KANet-UI 不执行**；4.3 才用）

```powershell
# 前置: 4.1 脚本已落码; 4.2 事件源已注册; R2 已过; D-026 开关已合入并被运行中 console 的启动日志证明 (V6)
$user   = "$env:COMPUTERNAME\ADMIN"
$script = 'C:\KANetBoot\mainnet-boot-sequence.ps1'   # 树外部署副本 (S-C, Bettor 已裁定); sha256 记 provenance; 副本内 -KanetRoot 默认仍指向 D:\kanet-tn12
$act  = New-ScheduledTaskAction -Execute 'powershell.exe' `
          -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $script) `
          -WorkingDirectory 'D:\kanet-tn12'
$trg  = New-ScheduledTaskTrigger -AtStartup
$trg.Delay = 'PT2M'
$prn  = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
$set  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
          -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10) `
          -MultipleInstances IgnoreNew -StartWhenAvailable `
          -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskPath '\KANet\' -TaskName 'KANet-Mainnet-Boot' -Action $act -Trigger $trg -Principal $prn -Settings $set `
  -Description 'Mainnet boot: verify kaspad, start/adopt, wait for 3 consecutive probe ALIVE, start/adopt console; resident sentinel + memory watch (alerts only). Runbook: docs/2026-09-19-kanetui-mainnet-boot-autostart-scheduled-task-runbook-v0.1.md (v0.2 body)'
# 立即核 (只读):
Get-ScheduledTask -TaskPath '\KANet\' -TaskName KANet-Mainnet-Boot | ForEach-Object { $_.Settings | Select-Object ExecutionTimeLimit,RestartCount,RestartInterval,MultipleInstances; $_.Principal | Select-Object UserId,LogonType,RunLevel; $_.Triggers | Select-Object CimClass,Delay }
```

## 附录 C. 两个只读工具与实测（**未落码**；落码须 Bettor 批 + NWT 审；均为**独立小脚本，不 import 任何 console 库**）

### C.1 事实：`kaspa_tx_log` 只登记入账，看不见纯外付出站（NWT 已复核成立）

主网库表 `kaspa_tx_log`（v60，relay 嵌入式 indexer 从 `block-added` 写入；relay `rpc-listener.mjs` 的 indexer 只按 `_watchedAddresses` 匹配**输出**）：
```
kaspa_tx_log: 74 行, from_address 为空/NULL = 74 行, distinct from_address = 0;
              其中 to_address 属于我们 18 个地址 = 74, 不属于 = 0
console 启动（15:21:34Z）之后的行: 4 行 —— 逐行 outputs 全部落在我们自己的地址上(external_outs=0, 输出数 2/3/5/7),
              正是 (1533) 记录的 22:21:34 启动拆分那 4 笔
```
所以它能覆盖"输出含我们自己地址"的自转/找零（含启动期拆分），**看不见"纯外付、无找零回自己"的出站**——那类只能靠 outpoint 差分。据此 #10 的**主信号 = 快照差分的 `spent_outpoints`**，`kaspa_tx_log` 仅作"新增 txid 是否被 indexer 登记"的覆盖度自检。

### C.2 `scripts/boot-outbound-check.mjs`（M-B；哨兵自动调用；也可手动只读运行）

- `snap <outfile>`：18 个地址各读两次（`--settle-sec 10` 间隔），**两次一致才写文件**（utxoindex 稳定性读数）；不一致 ⇒ 退出 5。文件只含 `txid:index`，**无地址、无金额**。
- `diff <t0file>`：退出 **0 = `spent_outpoints==0` 且全部可读**；**3 = `spent>0`**；**4 = 无花费但有 relay 不可读（不算通过）**；2 = 工具出错。**外部入账只增 `new`，不影响退出码。**
- **实测（2026-09-19，活节点，只读）**：`snap`（两次读数间隔 5 s）⇒ `SNAP-OK relays=18 unreadable=0`；紧接 `diff` ⇒ `RESULT … spent_outpoints=0 new_outpoints=0`，退出 0；三个合成变异：**(A)** t0 文件里删掉 Bettor 的一个真 outpoint 并加一个假的 ⇒ `Bettor spent=1 new=1 new_txids=44347266 …`（点名的正是 22:21:34 那笔启动拆分），**退出 3**；**(B)** 只删一个真 outpoint（即"多出一个入账 outpoint"）⇒ `spent=0 new=1`，**退出 0（不误报）**；**(C)** 把某 relay 在 t0 中标为不可读 ⇒ `Bettor UNREADABLE`，**退出 4**。
- **依赖**：`kaspa-wasm`（`kasia-relay/node_modules`，与探针同一份）、`better-sqlite3`（`readonly`，只读 relay 名字/地址与 `kaspa_tx_log` 的 txid）。参数 `--root/--db/--url/--network/--settle-sec` 便于隔离演练。

```js
// boot-outbound-check.mjs -- READ-ONLY outbound-spend check for the mainnet relay addresses (P2 runbook 4.5 reading #10).
// Standalone on purpose (NWT 9b2e7943 §四-4): it does NOT import any console library. It needs only kaspa-wasm (the copy under
// kasia-relay, same as scripts/kaspad-rpc-probe.mjs) and better-sqlite3 (opened readonly, only to read relay names + addresses).
//
//   node scripts/boot-outbound-check.mjs snap <outfile> [--settle-sec 10]
//        Two reads of every relay address, --settle-sec apart; writes txid:index sets (no addresses, no amounts) only if the two
//        reads are IDENTICAL (utxoindex caught up / no in-flight change). exit 0 = written, 5 = not settled, 2 = error.
//   node scripts/boot-outbound-check.mjs diff <t0file>
//        exit 0 = spent_outpoints == 0 and every relay readable; 3 = spent_outpoints > 0 (outbound/self spend evidence);
//        4 = nothing spent but at least one relay UNREADABLE (never counted as "no change"); 2 = error.
//        External INCOMING payments only add outpoints ("new") and are NOT a failure. The verdict is spent_outpoints == 0.
// Output is names, counts and txid prefixes only (D-021: no addresses, no amounts).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const [cmd, file] = argv;
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const root = path.resolve(opt('--root', path.resolve(here, '..')));   // default: the repo root this script lives in (scripts/..)
const req = createRequire(path.join(root, 'kasia-console', 'package.json'));
const DB = opt('--db', path.join(root, 'kasia-console', 'data', 'console.mainnet.db'));
const URL = opt('--url', 'ws://127.0.0.1:17110');
const NET = opt('--network', 'mainnet');
const SETTLE_MS = Number(opt('--settle-sec', '10')) * 1000;
const RPC_TIMEOUT_MS = 30000;
const die = (code, msg) => { console.log(msg); process.exit(code); };
const timeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout:${label}:${ms}ms`)), ms))]);

if (!['snap', 'diff'].includes(cmd) || !file) die(2, 'usage: snap <outfile> | diff <t0file>');
let relays;
try {
  const Database = req('better-sqlite3');
  const db = new Database(DB, { readonly: true, fileMustExist: true });
  relays = db.prepare('SELECT name, address FROM relay_nodes WHERE address IS NOT NULL ORDER BY name').all();
  db.close();
} catch (e) { die(2, `ERROR reading relay list: ${e.message}`); }
if (!relays.length) die(2, 'ERROR no relay addresses found');

let kaspa;
try { kaspa = req(path.join(root, 'kasia-relay', 'node_modules', 'kaspa-wasm', 'kaspa.js')); } catch (e) { die(2, `ERROR kaspa-wasm load: ${e.message}`); }
const { RpcClient, Encoding, Address } = kaspa;
const hard = setTimeout(() => die(2, 'ERROR hard timeout'), 5 * 60 * 1000); hard.unref?.();
const rpc = new RpcClient({ url: URL, encoding: Encoding.Borsh, networkId: NET });
try { await timeout(rpc.connect(), RPC_TIMEOUT_MS, 'connect'); } catch (e) { die(2, `ERROR connect: ${e.message}`); }

const txOf = (e) => e.outpoint?.transactionId ?? e.entry?.outpoint?.transactionId;
const idxOf = (e) => e.outpoint?.index ?? e.entry?.outpoint?.index ?? 0;
async function readAll() {
  const out = {};
  for (const r of relays) {
    try {
      const { entries } = await timeout(rpc.getUtxosByAddresses([new Address(r.address)]), RPC_TIMEOUT_MS, `utxos:${r.name}`);
      out[r.name] = entries.map((e) => `${txOf(e)}:${idxOf(e)}`).sort();
    } catch (e) { out[r.name] = { error: String(e.message || e).slice(0, 80) }; }   // UNREADABLE is reported, never "no change"
  }
  return out;
}
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

try {
  if (cmd === 'snap') {
    const a = await readAll();
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const b = await readAll();
    const unread = Object.values(b).filter((v) => !Array.isArray(v)).length;
    const unstable = relays.filter((r) => !same(a[r.name], b[r.name])).map((r) => r.name);
    if (unstable.length) die(5, `NOT-SETTLED relays_changed_between_reads=${unstable.length} names=${unstable.join(',')} unreadable=${unread}`);
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), relays: b }));
    console.log(`SNAP-OK relays=${relays.length} unreadable=${unread} settle_ms=${SETTLE_MS}`);
    process.exitCode = 0;
  } else {
    const t0 = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    const now = await readAll();
    let seen = new Set();
    try {   // coverage self-check only: which new txids did the relay indexer log? (kaspa_tx_log records outputs paying OUR addresses; from_address is always empty)
      const Database = req('better-sqlite3'); const db = new Database(DB, { readonly: true, fileMustExist: true });
      seen = new Set(db.prepare('SELECT tx_id FROM kaspa_tx_log').all().map((r) => r.tx_id)); db.close();
    } catch { /* coverage info is optional */ }
    let spent = 0, fresh = 0, unread = 0, unlogged = 0;
    for (const r of relays) {
      const a = t0.relays[r.name], b = now[r.name];
      if (!Array.isArray(a) || !Array.isArray(b)) { unread++; console.log(`${r.name} UNREADABLE`); continue; }
      const sa = new Set(a), sb = new Set(b);
      const gone = a.filter((x) => !sb.has(x)), add = b.filter((x) => !sa.has(x));
      const txids = [...new Set(add.map((x) => x.split(':')[0]))];
      const miss = txids.filter((t) => !seen.has(t));
      spent += gone.length; fresh += add.length; unlogged += miss.length;
      if (gone.length || add.length) console.log(`${r.name} spent=${gone.length} new=${add.length} new_txids=${txids.map((t) => t.slice(0, 8)).join(',')} not_in_kaspa_tx_log=${miss.length}`);
    }
    console.log(`RESULT relays=${relays.length} unreadable=${unread} spent_outpoints=${spent} new_outpoints=${fresh} new_txids_not_in_kaspa_tx_log=${unlogged} since=${t0.at}`);
    process.exitCode = spent > 0 ? 3 : (unread > 0 ? 4 : 0);
  }
} catch (e) { console.log(`ERROR ${e.message}`); process.exitCode = 2; }
finally { try { await rpc.disconnect(); } catch { /* ignore */ } }
setTimeout(() => process.exit(process.exitCode ?? 0), 300);
```

### C.3 `scripts/boot-guard-check.mjs` v0.5（M-C③ + NWT N-2/N-3 + N4-1/N4-3；哨兵在起 console 前调用）

- 退出 **0 = 42 项全 OK；3 = 至少一项 MISMATCH 或 UNKNOWN（fail-closed）；2 = 工具出错**。只打印守卫名、计数与 env **键名**；**不打印任何 env 值、任何未被明确允许读的配置值、地址或余额**；`config_entries` 只读 `is_sensitive=0` 的行。另有 `--print-lists`（所有清单 + 启动登记表 + `NON_START` / `INDEX_TIMERS` / `BARE_IMPORTS`）、`--print-env-parse <文件>`（按启动器规则解析一个 env 文件）两个只读模式，与测试专用的 `--index <文件>`（把 index.js 对账指向另一份文件）。
- **42 项 = 14 项表/查询（空表类）+ 2 项配置（`autotake`、`scanner_enabled`）+ 17 项"默认关、不得为 `1`"的 env 开关 + 2 项"默认开、必须显式为关" + 6 项"必须缺席/为空"的 id 键 + 1 项 `boot-registry`（v0.5：index.js 对账，见下）**。
- **N4-1 反转对账（v0.5，取代 v0.4 的"名字形状发现"）**：`analyzeBootFile` 对 index.js 做**去注释、去字符串内容**后的分析，枚举**所有来自相对模块的、被使用（调用或当值引用）的标识符**，`reconcileBoot` 要求每个都在 `CRON_REGISTRY` 或 `NON_START`；每个直接定时器 / 进程启动都在 `INDEX_TIMERS`（按"该语句所在行向前 `before` 行、向后 `after` 行"的窗口匹配，各项可调）；每个裸副作用导入都在 `BARE_IMPORTS`；**任何不能分类的 `import()` / 命名空间当值用的形状 ⇒ UNPARSED ⇒ 红**；登记但 index.js 已不使用的 ⇒ STALE ⇒ 红。真实 index.js（`f0c45290` = `bshard-m3-deploy` `30b11216`，两者 index.js 相同）：**147 个使用，0 个 UNPARSED，3 个定时器，0 个裸导入**。**这一对账在每次启动时对生产 index.js 运行**（`boot-registry` 一项）；`index.js` 读不到 ⇒ UNKNOWN。覆盖与盲区见 §7-20。
- **N-2 第二类"缺省即开必须显式为关"**：`MINING_CONSOLIDATE_ENABLED` 源码是 `(env || 'true').trim().toLowerCase() !== 'false'`，**缺省即开**——守卫要求它**显式为 `false`**，缺席 = MISMATCH；`AUTO_BET_TICK_MS` 要求**显式 `0` 或 `DEMO_AUTOBETTER_OFF=1`**。
- **N-3 / N4-3 有效环境 = 继承环境 ∪ 文件**：守卫在启动脚本进程里跑，其继承环境就是 console 将继承的；文件按**启动器的规则**解析：`^([^=]+)=(.*)$`、键 **.NET 意义上的 `Trim()`**（空白集 = `\t\n\v\f\r` + 空格 + U+0085 U+00A0 U+1680 U+2000–200A U+2028 U+2029 U+202F U+205F U+3000；**注意 JS 的 `trim()` 集不同：JS 有 U+FEFF 无 U+0085**）、值原样（`.` = 除 \n 外任意字符）、后写覆盖先写、空值 = 删除该变量、空名 = 启动器会抛错、名字大小写不敏感、CRLF / LF / **单独 CR** 分行。**文件解码**：按 BOM 认 UTF-8 / UTF-16 LE / UTF-16 BE（只消耗一个 BOM）；**无 BOM 且含 NUL ⇒ UNKNOWN；无 BOM 且设置行"名字"含非 ASCII ⇒ UNKNOWN**（见 §7-24）。
- **活库实跑（只读，D-027 之后，2026-09-19 19:47Z）**：`checks=42 not_ok=0`、退出码 0（此前 41 项中恰 1 项 MISMATCH = `config:autotake`）；耗时 <1 s。
- **测试 `boot-guard-check.test.mjs`：126 项全过**（夹具库/夹具 env 都在 `mkdtemp` 临时目录，写之前**断言目录在临时根下**）：v0.4 的 93 项中沿用的全部 + 声明一致性（gates / tables / configs / kinds / 证据）+ 真实 index.js 全量对账 + 真实模块里 `*_ENABLED`/`*_OFF` 名字全被守卫 + **15 种追加形状转红（NWT 的 A–G + 我的 H–P）** + 字符串/注释不误报 + 两个 STALE 方向 + **运行期**（真文件 OK / 未声明使用与 UNPARSED ⇒ 退出 3 / 读不到 ⇒ UNKNOWN）+ **N4-3：300 个种子固定的随机 env 文件对真实 PowerShell 启动器循环零分歧** + 4 条 U+0085 / U+2028 / U+FEFF 场景 + 7 条编码场景（UTF-16 LE/BE 带 BOM、无 BOM 的 NUL、非 ASCII 名字 / 注释 / 值、第二个 U+FEFF 是数据）。
- **变异对照 27 个（每个都被抓红）**：v0.4 沿用的 8 个（解析器退回 v0.3 规则 / 去掉默认开条目 / 去掉一个开关 / 忽略继承 / 空值不再删除继承 / 名字大小写敏感 / 去掉一个 id 键 / 不按单独 CR 分行）+ N4-1 的 13 个（定时器 / 裸导入 / `.then` / 命名空间成员 / UNPARSED / STALE 各不对账；`NON_START` 路由模式放宽成匹配任意标识符；只算"被调用"不算"被当值引用"；字符串不去内容；运行期不对账；读不到 index.js 报 OK；两个登记项被删）+ N4-3 的 6 个（`.NET Trim` 换成 JS `trim` / UTF-16 LE·BE 的 BOM 不认 / NUL 不再 UNKNOWN / 非 ASCII 名字不再 UNKNOWN / 值的正则退回 JS `.`）。

```js
// boot-guard-check.mjs v0.5 -- READ-ONLY pre-console guard for an UNATTENDED mainnet boot (P2 runbook 2.6 / NWT M-C(3), N-2, N-3, N4-1, N4-3).
// Verifies, before the sentinel starts the console, that every "today it cannot spend because a table is empty / a switch is off"
// fact in the runbook's spending-path table STILL holds on this boot. Any mismatch => the sentinel does NOT start the console
// (kaspad stays up), raises a Warning event and waits for a human. It turns "zero today" into "verified zero on every boot".
//   node scripts/boot-guard-check.mjs [--db <console.mainnet.db>] [--env <kanet.mainnet.env>] [--root <repo root>]
//   node scripts/boot-guard-check.mjs --print-lists                (JSON: every list + the boot-cron registry; touches nothing)
//   node scripts/boot-guard-check.mjs --print-env-parse <file>     (the launcher-faithful parse of one env file; touches nothing)
//   exit 0 = every guard OK; 3 = at least one MISMATCH/UNKNOWN (fail-closed); 2 = tool error.
// Prints guard names, counts and env KEY NAMES only. It never prints an env value, a config value it was not explicitly allowed
// to read, an address or a balance (D-021). It opens the DB readonly and only reads config_entries rows flagged is_sensitive=0.
//
// ENV SEMANTICS (NWT N-3): the console's real environment = INHERITED environment of the process that starts it, overlaid by the lines of
// kanet.mainnet.env exactly as scripts/start-console-mainnet.ps1 loads them:
//     skip  ^\s*#  and blank lines;   match  ^([^=]+)=(.*)$;   name = $matches[1].Trim();   value = $matches[2] verbatim (quotes, spaces kept);
//     [Environment]::SetEnvironmentVariable(name, value, 'Process')  -- later lines win; an EMPTY value REMOVES the variable; an empty name throws.
// Windows environment names are case-insensitive, so names are compared upper-cased. This file's parser is that loader, byte for byte in
// behaviour, and boot-guard-check.test.mjs diffs it against the REAL PowerShell loader on 17 line shapes plus 300 seeded random files (v0.5: .NET whitespace
// set, dotAll value, BOM sniffing -- see decodeEnvFile). ALSO (v0.5): the guard reconciles the production index.js against the declared boot surface
// (analyzeBootFile / reconcileBoot; result line `boot-registry`); an undeclared use, timer or unparsed import shape is a MISMATCH.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------------------------------------ the lists (exported via --print-lists)
// A. tables / queries whose emptiness keeps an unattended spending path from having anything to act on (data-driven paths).
const EMPTY_TABLES = [
  ['agent_wallets', 'SELECT COUNT(*) c FROM agent_wallets'],                       // autoTaker (auto-accept + USDT pay) needs a default bnb wallet row
  ['exchange_offers', 'SELECT COUNT(*) c FROM exchange_offers'],
  ['pool_markets', 'SELECT COUNT(*) c FROM pool_markets'],                         // house-agent, pool-settler, prediction-*
  ['pool_bettor_sides', 'SELECT COUNT(*) c FROM pool_bettor_sides'],               // bettor-refund-claim-auto
  ['oracle_registry', 'SELECT COUNT(*) c FROM oracle_registry'],
  ['oracle_stake_enrollments', 'SELECT COUNT(*) c FROM oracle_stake_enrollments'], // oracle-renewal
  ['retail_dex_buy_publications', 'SELECT COUNT(*) c FROM retail_dex_buy_publications'], // seeder refund worker
  ['mm_orders', 'SELECT COUNT(*) c FROM mm_orders'],
  ['submit_intents(status=prepared)', "SELECT COUNT(*) c FROM submit_intents WHERE status = 'prepared'"],   // submit-intent resume replays prepared spends at boot
  ['worldcup_schedule(status=pending_teams)', "SELECT COUNT(*) c FROM worldcup_schedule WHERE status = 'pending_teams'"],   // worldcup-schedule-cron creates markets (100 KAS maker stake)
  ['zk_prove_jobs(status=pending)', "SELECT COUNT(*) c FROM zk_prove_jobs WHERE status = 'pending'"],
  ['chain_events(bettor_refund_available)', "SELECT COUNT(*) c FROM chain_events WHERE event_type = 'bettor_refund_available'"],   // bettor-refund-claim-auto's real candidate signal
  ['market_seeder_config(enabled=1)', "SELECT COUNT(*) c FROM market_seeder_config WHERE enabled = 1"],   // market seeder master row (default 0)
  ['relay_nodes(is_oracle=1,address)', 'SELECT COUNT(*) c FROM relay_nodes WHERE is_oracle = 1 AND address IS NOT NULL'],   // broadcaster-utxo targets
];
// B. default-OFF switches: MISMATCH when the effective value is exactly '1' (all read as `=== '1'` in source; NWT verified 7 of them, the rest are cited in the registry)
const SWITCH_NOT_1 = [
  'UTXO_AUTOSPLIT_ON_START', 'BROADCASTER_UTXO_MAINTAIN', 'PROTO_DRIVER_ENABLED', 'PROTO_SETTLEMENT_DRIVER_ENABLED', 'BROKER_ENABLED',
  'SETTLE_DAEMON_ENABLED', 'ZK_PROVE_WORKER_ENABLED', 'BSHARD_CLOSE_VOTER_ENABLED', 'BSHARD_CLOSE_VOTER_V2_ENABLED', 'BSHARD_CLOSE_SUBMIT_V2_ENABLED',
  // N-2: the five ZK tick switches (index.js starts each cron unconditionally; each gates itself with === '1'), the pool seeder, the prediction agent
  'ZK_CLOSE_TICK_ENABLED', 'ZK_CLOSE_TICK_V2_ENABLED', 'ZK_CLAIM_TICK_ENABLED', 'ZK_HANDOFF_TICK_ENABLED', 'ZK_JUDGE_PROPOSE_TICK_ENABLED',
  'POOL_SEEDER_ENABLED', 'PREDICTION_AGENT_ENABLED',
];
// C. default-ON switches (N-2 second class): the code ENABLES the path when the variable is absent, so "absent" is a MISMATCH and the safe
// value must be written explicitly.
const DEFAULT_ON = [
  { key: 'MINING_CONSOLIDATE_ENABLED', safe: (v) => v !== undefined && v.trim().toLowerCase() === 'false', rule: "must be explicitly 'false' (source: (env || 'true').trim().toLowerCase() !== 'false' => absent = ON)" },
  { key: 'AUTO_BET_TICK_MS', safe: (v, get) => v === '0' || get('DEMO_AUTOBETTER_OFF') === '1', rule: "must be '0', or DEMO_AUTOBETTER_OFF must be '1' (source: pool-auto-better ticks by default; explicit 0 disables)" },
];
// D. id / list keys that must be ABSENT or empty (their presence configures a spending relay)
const ID_ABSENT = [
  'POOL_SEEDER_MAKER_RELAY', 'BROADCASTER_RELAY_IDS', 'BOT_AUTOFUND_SOURCE_RELAY_ID', 'FAUCET_RELAY_ID',
  'MINING_RELAY_ID',                     // N-2: without it the (default-on) mining consolidate cron does not start
  'PREDICTION_AGENT_ENABLED_PEERS',      // N-2: any non-empty value ENABLES the prediction agent for those peers
];
// E. names that gate a non-cron path but are still part of the guarded surface
const NON_CRON_GATES = ['PREDICTION_AGENT_ENABLED', 'PREDICTION_AGENT_ENABLED_PEERS', 'DEMO_AUTOBETTER_OFF'];

// F. THE BOOT-CRON REGISTRY (NWT N-2 completeness): every start-like call index.js makes at boot must be registered here with the kind of
// protection it has. The test (boot-guard-check.test.mjs) discovers the calls in index.js and goes RED when one is unregistered, when a gate it
// names is not in the lists above, or when a table it names is not guarded. kinds:
//   switch      default-off, gated by env names in `gates` (all in SWITCH_NOT_1)
//   default-on  default-on, gated by env names in `gates` (all in DEFAULT_ON)
//   id          inert without the env id keys in `gates` (all in ID_ABSENT)
//   data        default-on but inert while the `tables` (names in EMPTY_TABLES) are empty
//   no-spend    read-only / monitoring / local processes; `why` cites the evidence (runbook 2.6 audit)
//   infra       starts infrastructure (relays, adapters); spending inside is an OPEN item, named in `why`
//   audit-only  covered by the 2.6 audit but NOT by a runtime guard (visible on purpose: tighten or accept)
//   not-audited NOT looked at in the 2.6 audit (visible on purpose)
const CRON_REGISTRY = {
  autoSplitAll: { kind: 'switch', gates: ['UTXO_AUTOSPLIT_ON_START'], why: 'D-026' },
  startBroadcasterUtxoMaintainerCron: { kind: 'switch', gates: ['BROADCASTER_UTXO_MAINTAIN'], tables: ['relay_nodes(is_oracle=1,address)'], why: 'D-026 M1' },
  startMiningConsolidateCron: { kind: 'default-on', gates: ['MINING_CONSOLIDATE_ENABLED', 'MINING_RELAY_ID'], why: 'default ON; chain-state driven (consolidate_utxo)', ignoreGates: [] },
  startAutoBetterCron: { kind: 'default-on', gates: ['AUTO_BET_TICK_MS', 'DEMO_AUTOBETTER_OFF'], why: 'default ticks; explicit 0 / DEMO_AUTOBETTER_OFF=1 disables' },
  startZkProveWorkerCron: { kind: 'switch', gates: ['ZK_PROVE_WORKER_ENABLED'], why: 'zk-prove-worker.mjs' },
  startBshardCloseVoterCron: { kind: 'switch', gates: ['BSHARD_CLOSE_VOTER_ENABLED'], why: 'bshard-close-voter.js' },
  startBshardCloseVoterV2Cron: { kind: 'switch', gates: ['BSHARD_CLOSE_VOTER_V2_ENABLED'], why: 'bshard-close-voter.js' },
  startBshardCloseSubmitV2Cron: { kind: 'switch', gates: ['BSHARD_CLOSE_SUBMIT_V2_ENABLED'], why: 'bshard-close-voter.js' },
  startSettleDaemonCron: { kind: 'switch', gates: ['SETTLE_DAEMON_ENABLED', 'ZK_CLOSE_TICK_ENABLED'], why: 'bshard-settle-daemon.mjs :66/:68' },
  startZkCloseTickV2Cron: { kind: 'switch', gates: ['ZK_CLOSE_TICK_V2_ENABLED'], why: 'bshard-settle-daemon.mjs :1058' },
  startClaimAutonomousTickCron: { kind: 'switch', gates: ['ZK_CLAIM_TICK_ENABLED'], why: 'bshard-settle-daemon.mjs :1059' },
  startZkHandoffAutonomousTickCron: { kind: 'switch', gates: ['ZK_HANDOFF_TICK_ENABLED'], why: 'bshard-settle-daemon.mjs :1123' },
  startZkJudgeProposeAutonomousTickCron: { kind: 'switch', gates: ['ZK_JUDGE_PROPOSE_TICK_ENABLED'], why: 'bshard-settle-daemon.mjs :1147' },
  startProtoDriver: { kind: 'switch', gates: ['PROTO_DRIVER_ENABLED', 'PROTO_SETTLEMENT_DRIVER_ENABLED'], why: 'proto-driver.mjs (settlement switch has no reader yet: 9-2b)' },
  startPoolMarketSeeder: { kind: 'switch', gates: ['POOL_SEEDER_ENABLED', 'POOL_SEEDER_MAKER_RELAY'], why: 'pool-market-seeder.js' },
  startBotAutofundCron: { kind: 'id', gates: ['BOT_AUTOFUND_SOURCE_RELAY_ID'], why: 'pool-bot-autofund.js: source relay id unset = cron not started' },
  startFaucetHealthCron: { kind: 'id', gates: ['FAUCET_RELAY_ID'], why: 'faucet-utxo-health.mjs: read-only health; id unset = cron not started' },
  startPredictionSettlerCron: { kind: 'data', tables: ['exchange_offers', 'submit_intents(status=prepared)'], why: 'bettor-prediction-settler.js + submit-intent resume' },
  startPredictionVoterCron: { kind: 'data', tables: ['relay_nodes(is_oracle=1,address)'], why: 'scans is_oracle=1 relays' },
  startPoolMarketSettlerCron: { kind: 'data', tables: ['pool_markets'], why: 'pool-market-settler.js' },
  startBettorRefundClaimAutoCron: { kind: 'data', tables: ['pool_bettor_sides', 'chain_events(bettor_refund_available)'], why: 'bettor-refund-claim-auto.mjs' },
  startHouseAgentCron: { kind: 'data', tables: ['pool_markets'], why: 'needs a relay named HouseAgent AND pool_markets rows' },
  startOraclePoolRenewalCron: { kind: 'data', tables: ['oracle_stake_enrollments'], why: 'oracle-pool-renewal-cron.mjs (transfer)' },
  startWorldcupScheduleCron: { kind: 'data', tables: ['worldcup_schedule(status=pending_teams)'], why: 'worldcup-schedule-cron.mjs (also blocked by a wrong console base URL default: accidental)' },
  startMarketSeeder: { kind: 'data', tables: ['market_seeder_config(enabled=1)'], why: 'market-seeder.js: config enabled=0' },
  startSeederDepositWatcher: { kind: 'data', tables: ['retail_dex_buy_publications'], why: 'market-seeder.js' },
  startSeederRefundWorker: { kind: 'data', tables: ['retail_dex_buy_publications'], why: 'market-seeder.js (EVM USDT refunds)' },
  startPeriodicIngest: { kind: 'no-spend', why: 'pair-ingestor.mjs: ingest only (not audited beyond the name/no env keys)' },
  startAllAdapters: { kind: 'no-spend', why: 'spawns local adapter processes; 0/0 started on mainnet' },
  startRefreshWorker: { kind: 'no-spend', why: 'connection-manager refresh worker' },
  startEventLoopLagHeartbeat: { kind: 'no-spend', why: 'diagnostics' },
  startRelayHealthMonitorCron: { kind: 'no-spend', why: 'restarts relays (max 3/h); no spend command' },
  startRelayHotwalletMonitorCron: { kind: 'no-spend', why: 'may stop a relay; no spend command', ignoreGates: ['HOTWALLET_MONITOR_OFF'] },
  startSettleFailedAlertCron: { kind: 'no-spend', why: 'read-only alert' },
  startDiskSpaceAlertCron: { kind: 'no-spend', why: 'read-only alert' },
  startRpcHealthDegradationAlertCron: { kind: 'no-spend', why: 'read-only alert; self-restart default OFF' },
  startZkProveJobStuckAlertCron: { kind: 'no-spend', why: 'read-only alert' },
  startSpcDaaIndexStaleCheck: { kind: 'no-spend', why: 'read-only monitor (audit: no spend commands)' },
  startTxLandedReconciler: { kind: 'no-spend', why: 'reconciler (audit: no spend commands)' },
  startPrepruneCaptureWorker: { kind: 'no-spend', why: 'capture worker (audit: no spend commands)' },
  startBrokerFeeEmitCron: { kind: 'no-spend', why: 'broker fee emit (audit: no spend commands); broker family is BROKER_ENABLED-gated elsewhere' },
  startOraclePoolScannerCron: { kind: 'no-spend', why: 'startup log: scan + derive chain_view' },
  startAllRelays: { kind: 'infra', why: 'starts relay processes; OPEN ITEM: relay-internal inbound-handshake auto-accept is not covered by any guard (runbook 2.6 I7)' },
  initMinds: { kind: 'audit-only', why: 'no minds on mainnet (runbook 2.6 T9)' },
  startScheduler: { kind: 'audit-only', why: 'mind scheduler; minds empty (runbook 2.6 T9)' },
  startTgBotIfConfigured: { kind: 'audit-only', why: 'TELEGRAM_BOT_TOKEN unset on mainnet; bot not auto-started' },
  startBrokerBotManager: { kind: 'audit-only', why: 'boot reconcile 0 bots; broker family disabled' },
  startReconcileCron: { kind: 'audit-only', why: 'broker-state-machine; needs BROKER_RELAY_ID (module throws without it)' },
  startStateReconciler: { kind: 'audit-only', why: 'broker-state-reconciler; needs BROKER_RELAY_ID' },
  startScavengerCron: { kind: 'audit-only', why: 'bettor_* family: bettor_real_config.enabled=0, positions 0 (runbook 2.6)' },
  startBettorResolver: { kind: 'audit-only', why: 'bettor_* family' },
  startBettorTracker: { kind: 'audit-only', why: 'bettor_* family' },
  startBettorReactor: { kind: 'audit-only', why: 'bettor_* family' },
  startBettorAutoValve: { kind: 'audit-only', why: 'bettor_* family (valve A redeem etc.): positions 0' },
  startBettorPositionProtector: { kind: 'audit-only', why: 'alert-only skeleton per its startup line' },
  startPositionWatcherCron: { kind: 'audit-only', why: 'alert-only per its startup line' },
  startFossaStableScannerCron: { kind: 'audit-only', why: 'no auto-fire per its startup line' },
  startBettorVariantExpander: { kind: 'audit-only', why: 'stub per its startup line' },
  startOracleVoterHealthMonitorCron: { kind: 'not-audited', why: 'monitor by name' },
  startBshardCoherenceObservabilityMonitor: { kind: 'not-audited', why: 'observability monitor by name' },
  startPrepruneCaptureStaleCheck: { kind: 'not-audited', why: 'stale check by name' },
  startZkProveServer: { kind: 'not-audited', why: 'zk-prove HTTP server (ZK_PROVE_SERVER_* keys)' },
  startExternalGateway: { kind: 'not-audited', why: 'needs KANET_EXTERNAL_GATEWAY_HOST/PORT to start' },
  // ---- v0.5 (NWT N4-1): the boot-time items the old name-shaped discovery could not see (index.js line numbers at f0c45290 == origin/bshard-m3-deploy 30b11216)
  autoStartIfEnabled: { kind: 'config', configs: ['scanner_enabled'], why: 'index.js:874 -> scanner.js: starts the inbound scanner only if the config row scanner_enabled was on before the restart (guard: config:scanner_enabled)' },
  expireStale: { kind: 'data', tables: ['exchange_offers'], why: 'exchange-machine.js state machine over exchange_offers; index.js:308-313 runs it once at boot + on a 30 s tick (INDEX_TIMERS exchange-expire-tick)' },
  checkStaleDisputes: { kind: 'data', tables: ['exchange_offers'], why: 'same block as expireStale' },
  cleanupStaleOrphanAccepts: { kind: 'data', tables: ['exchange_offers'], why: 'same block as expireStale' },
  timeoutVerifying: { kind: 'data', tables: ['exchange_offers'], why: 'same block; emits timeout_v1 chain messages ONLY for rows in exchange_offers (empty = inert)' },
  checkMatchedTimeout: { kind: 'data', tables: ['exchange_offers'], why: 'same block; 30 s tick' },
  startIntakeWatcher: { kind: 'switch', gates: ['BROKER_ENABLED'], why: 'index.js:906 dynamic import inside if (process.env.BROKER_ENABLED === "1")' },
  startStaleAligningSweep: { kind: 'switch', gates: ['BROKER_ENABLED'], why: 'index.js:912, same BROKER_ENABLED block' },
  startCompletionWatcher: { kind: 'switch', gates: ['BROKER_ENABLED'], why: 'index.js:974, its own if (BROKER_ENABLED === "1") block' },
  startBscIncomingWatcher: { kind: 'switch', gates: ['BROKER_ENABLED'], why: 'index.js:988 (imported as { start: startBscIncomingWatcher }), its own BROKER_ENABLED block' },
  catchUpUningestedMarkets: { kind: 'audit-only', why: 'index.js:763 boot catch-up of market_publishes from the durable broadcast_messages store (DB ingest, idempotent per its comment); NOT audited for chain sends' },
  installUtxoFetchProbe: { kind: 'no-spend', why: 'utxo-fetch-allocation-probe.mjs header: TEMPORARY diagnostic, observe-only, zero DB writes' },
  installBigResponseObserve: { kind: 'no-spend', why: 'http-big-response-observe.mjs header: observe-only fastify onSend hook, returns payload unchanged' },
};
const CONFIG_GUARDS = ['autotake', 'scanner_enabled'];   // names of the `config:<name>` checks in runGuard

// G. (v0.5, NWT N4-1) THE RECONCILIATION RULE IS INVERTED: it no longer looks for names that "look like" a start call. It enumerates EVERY identifier that
// index.js imports from a relative module (static named / default / namespace, dynamic `await import()` destructure / namespace / member call) and USES,
// and requires each to be either in CRON_REGISTRY (a boot starter: protection kind + evidence) or in NON_START (an explicitly-declared non-starter: routes,
// i18n, config readers ...). Any other identifier, ANY import()/timer/process-start shape the analyzer cannot classify, and every bare side-effect import must
// be declared too. So a NEW function call in index.js goes RED whatever it is called. The same check runs at BOOT against the production index.js
// (see runGuard), not only in the test. What it does NOT cover: see the runbook section 7.
const NON_START = {
  patterns: [
    { re: '^register\\w*Routes?$', why: 'HTTP route registration: declares endpoints, no boot-time action of its own (the routes themselves are the HTTP surface, runbook 2.6 "HTTP class")' },
    { re: '^_[A-Z0-9_]+_SENTINEL$', why: 'constants passed to the committee-offset warm-up' },
  ],
  names: {
    wrapTick: { why: 'timing wrapper for a tick callback (observe-only)' },
    currentKeyFingerprint: { why: 'logs a sha256 prefix of the encryption key; no chain action' },
    runMigrations: { why: 'DB schema migration at boot (local DB write, no chain)' },
    checkSilvercPinAtStartup: { why: 'observability-only compiler pin self-check (its index.js comment)' },
    warmupCommitteeOffsetCache: { why: 'local cache warm-up (may run the local compiler); failure never blocks boot (its index.js comment); no chain action' },
    registerMindSkills: { why: 'seeds skill rows in the local DB' },
    assertProtoRelayHealthy: { why: 'boot assertion (throws => proto routes not registered); no chain send' },
    getConfig: { why: 'config reader' },
    setConfig: { why: 'config writer used by ensureIngestSecret (generates INGEST_SECRET into config_entries); DB only' },
    _sqlite: { why: 'DB handle' },
    _listRelayNodes: { why: 'DB reader used by a route' },
    parseLang: { why: 'i18n' }, getT: { why: 'i18n' }, isRtl: { why: 'i18n' }, LANG_NAMES: { why: 'i18n constant' },
    checkOutboundAllowed: { why: 'anti-spam query used inside route handlers' },
    getActivityLog: { why: 'anti-spam query used inside route handlers' }, getActivityByPeer: { why: 'anti-spam query used inside route handlers' },
    getOutboundStats: { why: 'anti-spam query used inside route handlers' }, getMergedContacts: { why: 'anti-spam query used inside route handlers' },
    stopAllAdapters: { why: 'shutdown path' }, stopAllRelays: { why: 'shutdown path' },
  },
};
const BARE_IMPORTS = {};   // 'module specifier' -> why (a bare side-effect import runs the module's top level at import time); index.js has none today
// Direct timers / process starts that index.js itself performs (not through an imported starter). `re` is matched against the statement's line minus `before` (default 2) .. plus `after` (default 1) lines.
const INDEX_TIMERS = [
  { id: 'cpu-prof-self-exit', re: 'CPU_PROF_AUTO_EXIT_MS', before: 6, kind: 'no-spend', why: 'env-gated diagnostic: process.exit(0) after N ms to flush a CPU profile; env unset = no timer' },
  { id: 'exchange-expire-tick', re: 'exchange\\.expireTick', kind: 'data', tables: ['exchange_offers'], why: '30 s tick over exchange_offers (see the expireStale family in CRON_REGISTRY)' },
  { id: 'console-heartbeat-file', re: 'console\\.heartbeatFile', kind: 'no-spend', why: 'writes logs/console-heartbeat.txt every 2 s (local file)' },
];

// ------------------------------------------------------------------------------------------------ index.js analysis (v0.5, N4-1)
// Comment stripper that knows strings, template literals and REGEX LITERALS (a `/*` inside a character class must not open a block comment).
// Over-stripping real code is the unsafe direction, so on doubt it keeps the text.
export function stripComments(src) {
  let out = '', i = 0, state = 'code', quote = '', inClass = false;
  const regexCanStart = () => { const t = out.replace(/\s+$/, ''); if (t === '') return true; const p = t[t.length - 1]; return '(,=:[!&|?{};+-*%<>~^'.includes(p) || /(^|[^\w$.])(return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(t); };
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; i += 2; continue; }
      if (c === '/' && regexCanStart()) { state = 'regex'; inClass = false; out += c; i++; continue; }
      if (c === "'" || c === '"' || c === '`') { state = 'str'; quote = c; out += c; i++; continue; }
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
      out += c; i++; continue;
    }
    if (state === 'regex') {
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
      if (c === '[') inClass = true; else if (c === ']') inClass = false;
      else if (c === '\n') { state = 'code'; }
      else if (c === '/' && !inClass) { state = 'code'; }
      out += c; i++; continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i++; continue; }
    if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i += 2; out += ' '; } else { if (c === '\n') out += c; i++; } continue; }
    if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
    if (c === quote) { state = 'code'; out += c; i++; continue; }
    if (c === '\n' && quote !== '`') { state = 'code'; }
    out += c; i++;
  }
  return out;
}
// same length as its input: the CONTENTS of '...' and "..." literals become spaces (so a log line that mentions `startFoo(` is not a call). Template literals are
// left visible on purpose (a ${call()} inside one is code; over-matching = a false RED = the safe direction).
export function blankQuotedStrings(code) {
  let out = '', i = 0, q = '';
  while (i < code.length) {
    const c = code[i];
    if (!q) { if (c === "'" || c === '"') { q = c; out += c; i++; continue; } if (c === '`') { const j = findTemplateEnd(code, i); out += code.slice(i, j); i = j; continue; } out += c; i++; continue; }
    if (c === '\\') { out += ' ' + (code[i + 1] === '\n' ? '\n' : ' '); i += 2; continue; }
    if (c === q) { q = ''; out += c; i++; continue; }
    if (c === '\n') { q = ''; out += c; i++; continue; }   // unterminated: resync
    out += ' '; i++;
  }
  return out;
}
function findTemplateEnd(code, i) { let j = i + 1, depth = 0; while (j < code.length) { const c = code[j]; if (c === '\\') { j += 2; continue; } if (c === '$' && code[j + 1] === '{') { depth++; j += 2; continue; } if (c === '}' && depth > 0) { depth--; j++; continue; } if (c === '`' && depth === 0) return j + 1; j++; } return code.length; }
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;
const isRel = (s) => s.startsWith('.');
// -> { uses: Map(name -> { module, kind, line }), bare: [{module,line}], timers: [{line, ctx, what}], unparsed: [{line, why, snippet}] }
export function analyzeBootFile(text) {
  const code = stripComments(text);
  const view = blankQuotedStrings(code);
  const uses = new Map(), bare = [], timers = [], unparsed = [];
  const bindings = new Map();   // local name -> { module, kind }
  const stmtSpans = [];         // spans of import statements (so the binding itself is not counted as a use)
  const addBinding = (name, module, kind, idx) => { if (name && /^[\w$]+$/.test(name)) bindings.set(name, { module, kind, line: lineOf(code, idx) }); };
  // static imports (statement level, multi-line ok)
  for (const m of view.matchAll(/(?<![\w$.])import\s+([\s\S]*?)\s*from\s*(['"])([^'"\n]*)\2/dg)) {   // matched on the string-blanked view (an `import ... from` inside a string is not an import); the specifier text comes back from `code` at the same offsets
    const whole = code.slice(m.index, m.index + m[0].length), clause = code.slice(m.indices[1][0], m.indices[1][1]), spec = code.slice(m.indices[3][0], m.indices[3][1]); if (!isRel(spec)) continue;
    stmtSpans.push([m.index, m.index + whole.length]);
    const ns = /^\*\s*as\s+([\w$]+)$/.exec(clause.trim());
    if (ns) { addBinding(ns[1], spec, 'namespace', m.index); continue; }
    const named = /\{([\s\S]*)\}/.exec(clause);
    const head = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, ' ').trim();
    if (head) for (const h of head.split(/\s+/)) addBinding(h, spec, 'default', m.index);
    if (named) for (const part of named[1].split(',')) { const p = part.trim(); if (!p) continue; const local = p.split(/\s+as\s+/).pop().trim(); addBinding(local, spec, 'named', m.index); }
  }
  for (const m of view.matchAll(/(?<![\w$.])import\s*(['"])([^'"\n]*)\1/dg)) { const spec = code.slice(m.indices[2][0], m.indices[2][1]); if (isRel(spec)) bare.push({ module: spec, line: lineOf(code, m.index) }); stmtSpans.push([m.index, m.index + m[0].length]); }
  // dynamic imports: every `import(` occurrence must be classified, or it is reported UNPARSED (red)
  const dynSpans = [];
  for (const m of view.matchAll(/(?<![\w$.])import\s*\(/g)) {
    const at = m.index, line = lineOf(code, at);
    const lit = /^import\s*\(\s*(['"])([^'"\n]+)\1\s*\)/.exec(code.slice(at));
    if (!lit) { unparsed.push({ line, why: 'dynamic import with a non-literal specifier', snippet: code.slice(at, at + 80).replace(/\s+/g, ' ') }); continue; }
    const spec = lit[2], after = code.slice(at + lit[0].length, at + lit[0].length + 60), before = code.slice(Math.max(0, at - 160), at);
    dynSpans.push([at, at + lit[0].length]);
    if (!isRel(spec)) continue;   // package import: not a boot starter of ours (runbook 7)
    let mm;
    if ((mm = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\s*$/.exec(before))) { for (const part of mm[1].split(',')) { const p = part.trim(); if (!p) continue; const local = p.split('=')[0].split(':').pop().trim(); addBinding(local, spec, 'dynamic-destructure', at); } continue; }
    if ((mm = /(?:const|let|var)\s+([\w$]+)\s*=\s*await\s*$/.exec(before))) { addBinding(mm[1], spec, 'namespace', at); continue; }
    if (/\(\s*await\s*$/.test(before) && (mm = /^\s*\)\s*\.\s*([\w$]+)/.exec(after))) { uses.set(`(await import(${spec})).${mm[1]}`, { module: spec, kind: 'dynamic-member', line }); continue; }
    if (/^\s*\.\s*then\s*\(/.test(after)) { uses.set(`import(${spec}).then`, { module: spec, kind: 'dynamic-then', line }); continue; }
    unparsed.push({ line, why: 'dynamic import() in a shape the analyzer cannot classify', snippet: (before.slice(-40) + code.slice(at, at + lit[0].length) + after.slice(0, 20)).replace(/\s+/g, ' ') });
  }
  const inSpan = (idx, spans) => spans.some(([a, b]) => idx >= a && idx < b);
  // uses of the bound names (a use = any occurrence outside the import statement itself, called or merely referenced)
  for (const [name, b] of bindings) {
    const re = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`, 'g');
    for (const m of view.matchAll(re)) {
      if (inSpan(m.index, stmtSpans)) continue;
      if (/^\s*:/.test(view.slice(m.index + name.length, m.index + name.length + 3)) && /[{,]\s*$/.test(view.slice(Math.max(0, m.index - 3), m.index))) continue;   // an object-literal KEY with the same spelling is not a use
      const line = lineOf(code, m.index);
      if (b.kind === 'namespace') {
        const mem = /^\s*\.\s*([\w$]+)/.exec(view.slice(m.index + name.length, m.index + name.length + 60));
        if (mem) { const k = `${name}.${mem[1]}`; if (!uses.has(k)) uses.set(k, { module: b.module, kind: 'namespace-member', line }); }
        else if (!/^\s*\(/.test(view.slice(m.index + name.length, m.index + name.length + 3))) unparsed.push({ line, why: `namespace import ${name} used as a value (not ns.member)`, snippet: view.slice(Math.max(0, m.index - 20), m.index + 40).replace(/\s+/g, ' ') });
        continue;
      }
      if (!uses.has(name)) uses.set(name, { module: b.module, kind: b.kind, line });
    }
  }
  // timers / process starts done by index.js itself
  for (const m of view.matchAll(/(?<![\w$])(setInterval|setTimeout|setImmediate|spawn|fork|execFile|exec|execSync|spawnSync)\s*\(|\.\s*(schedule|setInterval)\s*\(|new\s+Worker\s*\(/g)) {
    if (inSpan(m.index, stmtSpans)) continue;
    const line = lineOf(code, m.index);
    timers.push({ line, what: m[0].replace(/\s+/g, '') });
  }
  return { uses, bare, timers, unparsed, lines: code.split('\n') };
}
// -> problems[] ; empty = the declared surface matches what index.js does
export function reconcileBoot(analysis, lists) {
  const problems = [];
  const reg = lists.cronRegistry, nsPat = (lists.nonStart.patterns || []).map((p) => new RegExp(p.re)), nsNames = lists.nonStart.names;
  const declared = (n) => Object.prototype.hasOwnProperty.call(reg, n) || Object.prototype.hasOwnProperty.call(nsNames, n) || nsPat.some((r) => r.test(n));
  for (const [name, u] of analysis.uses) if (!declared(name)) problems.push(`UNDECLARED use of ${name} (from ${u.module}, ${u.kind}, line ${u.line}) -- declare it in CRON_REGISTRY (a boot starter: kind + evidence) or NON_START (with a reason)`);
  for (const k of Object.keys(reg)) if (!analysis.uses.has(k)) problems.push(`STALE registry entry (index.js no longer uses it): ${k}`);
  for (const k of Object.keys(nsNames)) if (!analysis.uses.has(k)) problems.push(`STALE NON_START name (index.js no longer uses it): ${k}`);
  for (const b of analysis.bare) if (!Object.prototype.hasOwnProperty.call(lists.bareImports, b.module)) problems.push(`UNDECLARED bare side-effect import ${b.module} (line ${b.line}) -- the module's top level runs at import time`);
  const win = (t, e) => analysis.lines.slice(Math.max(0, t.line - 1 - (e.before ?? 2)), t.line + (e.after ?? 1)).join('\n');   // the statement's line +- a per-entry window
  for (const t of analysis.timers) if (!lists.indexTimers.some((e) => new RegExp(e.re).test(win(t, e)))) problems.push(`UNDECLARED timer/process start ${t.what} in index.js (line ${t.line}) -- declare it in INDEX_TIMERS with a kind and evidence`);
  for (const e of lists.indexTimers) if (!analysis.timers.some((t) => new RegExp(e.re).test(win(t, e)))) problems.push(`STALE INDEX_TIMERS entry: ${e.id}`);
  for (const u of analysis.unparsed) problems.push(`UNPARSED shape at line ${u.line}: ${u.why} :: ${u.snippet}`);
  return problems;
}

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

// ------------------------------------------------------------------------------------------------ launcher-faithful env parse
// .NET whitespace (String.Trim(), regex \s): NOT the same set as JavaScript's. .NET has U+0085 and no U+FEFF; JS has U+FEFF and no U+0085. (NWT N4-3: the
// differential fuzz found 192/600 disagreements, 6 of them "launcher ends up with KEY=1, the v0.4 guard saw nothing".)
const NET_WS = '\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';
const RE_COMMENT = new RegExp(`^[${NET_WS}]*#`), RE_BLANK = new RegExp(`^[${NET_WS}]*$`), RE_TRIM = new RegExp(`^[${NET_WS}]+|[${NET_WS}]+$`, 'g');
// Get-Content decodes by BOM (UTF-8 / UTF-16 LE / UTF-16 BE); with NO BOM it uses the system ANSI code page, which we cannot reproduce byte-for-byte.
// -> { text } or { unknown: reason }. Fail-closed: a NUL byte with no BOM (a UTF-16 file saved without one), or a non-ASCII byte inside a setting NAME.
export function decodeEnvFile(buf) {
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return { text: buf.subarray(3).toString('utf8') };
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return { text: buf.subarray(2).toString('utf16le') };
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) { const b = Buffer.from(buf.subarray(2)); b.swap16(); return { text: b.toString('utf16le') }; }
  if (buf.includes(0)) return { unknown: 'NUL byte in a file with no BOM (looks like UTF-16 without a BOM; the launcher would decode it differently)' };
  const text = buf.toString('utf8');
  for (const line of text.split(/\r\n|\r|\n/)) { if (RE_COMMENT.test(line) || RE_BLANK.test(line)) continue; const eq = line.indexOf('='); if (eq > 0 && /[^\x00-\x7f]/.test(line.slice(0, eq))) return { unknown: 'non-ASCII character inside a setting NAME in a BOM-less file (the launcher decodes with the system ANSI code page)' }; }
  return { text };
}
export function parseLauncherEnvText(text) {
  // scripts/start-console-mainnet.ps1: Get-Content (the BOM is consumed by the DECODER, see decodeEnvFile; a second U+FEFF stays in the data), splits on CRLF / LF / lone CR, then the two -match lines, then SetEnvironmentVariable
  const out = new Map(); let emptyNameLines = 0;
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (RE_COMMENT.test(line) || RE_BLANK.test(line)) continue;
    const m = /^([^=]+)=([^\n]*)$/.exec(line);   // .NET `.` matches everything but \n (JS `.` also stops at \r, U+2028, U+2029)
    if (!m) continue;
    const name = m[1].replace(RE_TRIM, '');
    if (name === '') { emptyNameLines++; continue; }         // the launcher's SetEnvironmentVariable('') THROWS here (script aborts); we never treat it as a setting
    const key = name.toUpperCase();
    if (m[2] === '') out.set(key, null); else out.set(key, m[2]);   // an empty value REMOVES the variable
  }
  return { vars: out, emptyNameLines };
}
export function effectiveEnv(inherited, fileVars) {
  const eff = new Map();
  for (const [k, v] of Object.entries(inherited)) if (v !== undefined && v !== '') eff.set(k.toUpperCase(), v);
  for (const [k, v] of fileVars) { if (v === null) eff.delete(k); else eff.set(k, v); }
  return eff;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  if (argv.includes('--print-lists')) {
    console.log(JSON.stringify({ tables: EMPTY_TABLES.map((r) => r[0]), switchNotOne: SWITCH_NOT_1, defaultOn: DEFAULT_ON.map((d) => d.key), idAbsent: ID_ABSENT, nonCronGates: NON_CRON_GATES, cronRegistry: CRON_REGISTRY, configGuards: CONFIG_GUARDS, nonStart: NON_START, bareImports: BARE_IMPORTS, indexTimers: INDEX_TIMERS }, null, 1));
    process.exit(0);
  }
  if (argv.includes('--print-env-parse')) {
    const f = opt('--print-env-parse');
    const dec = decodeEnvFile(fs.readFileSync(f)); if (dec.unknown) { console.log(`UNKNOWN: ${dec.unknown}`); process.exit(3); }
    const { vars, emptyNameLines } = parseLauncherEnvText(dec.text);
    for (const [k, v] of [...vars].sort()) console.log(`${k}=[${v === null ? '<removed>' : v}]`);
    console.log(`emptyNameLines=${emptyNameLines}`);
    process.exit(0);
  }
  await runGuard();
}

async function runGuard() {
  const root = path.resolve(opt('--root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')));
  const DB = opt('--db', path.join(root, 'kasia-console', 'data', 'console.mainnet.db'));
  const ENVF = opt('--env', path.join(root, 'kanet.mainnet.env'));
  const req = createRequire(path.join(root, 'kasia-console', 'package.json'));
  const results = [];
  const add = (name, status, detail = '') => results.push({ name, status, detail });
  let db;
  try {
    const Database = req('better-sqlite3');
    db = new Database(DB, { readonly: true, fileMustExist: true });
  } catch (e) { console.log(`ERROR opening db: ${e.message}`); process.exit(2); }

  for (const [name, sql] of EMPTY_TABLES) {
    try { const c = db.prepare(sql).get().c; add(`rows:${name}`, c === 0 ? 'OK' : 'MISMATCH', `count=${c} expected=0`); }
    catch (e) { add(`rows:${name}`, 'UNKNOWN', `query failed: ${String(e.message).slice(0, 60)}`); }   // a missing table is UNKNOWN, fail-closed
  }
  function flag(key) {
    try {
      const r = db.prepare('SELECT is_sensitive, value_encrypted v FROM config_entries WHERE key = ?').get(key);
      if (!r) return { state: 'absent' };
      if (r.is_sensitive !== 0) return { state: 'sensitive' };   // refuse to read a sensitive row
      return { state: 'ok', v: String(r.v) };
    } catch { return { state: 'error' }; }
  }
  {   // autoTaker: safe = NOT (enabled=='true' AND mode=='auto')
    const en = flag('autotake_enabled'), mode = flag('autotake_mode');
    if (en.state !== 'ok' || mode.state !== 'ok') add('config:autotake', 'UNKNOWN', `enabled=${en.state} mode=${mode.state}`);
    else if (en.v === 'true' && mode.v === 'auto') add('config:autotake', 'MISMATCH', 'autotake_enabled=true and autotake_mode=auto (armed: auto-accepts inbound offers when a bnb agent wallet exists)');
    else add('config:autotake', 'OK', `enabled=${en.v} mode=${mode.v}`);
  }
  {   // scanner_enabled: master switch of the INBOUND protocol path. Absent or 'false' = off.
    const sc = flag('scanner_enabled');
    if (sc.state === 'absent') add('config:scanner_enabled', 'OK', 'absent (= off)');
    else if (sc.state !== 'ok') add('config:scanner_enabled', 'UNKNOWN', `state=${sc.state}`);
    else add('config:scanner_enabled', sc.v === 'false' ? 'OK' : 'MISMATCH', `value=${sc.v} (inbound protocol path ${sc.v === 'false' ? 'off' : 'ON: needs a human decision before an unattended boot'})`);
  }
  db.close();

  // ---- effective environment = inherited (the process that runs this guard is the boot script, i.e. what the console would inherit) + file overlay
  let fileVars = null;
  try { const dec = decodeEnvFile(fs.readFileSync(ENVF)); if (dec.unknown) add('env:file', 'UNKNOWN', dec.unknown); else fileVars = parseLauncherEnvText(dec.text).vars; } catch (e) { add('env:file', 'UNKNOWN', `cannot read env file: ${e.code || e.message}`); }
  if (fileVars !== null) {
    const eff = effectiveEnv(process.env, fileVars);
    const get = (k) => (eff.has(k) ? eff.get(k) : undefined);
    const src = (k) => (fileVars.has(k) ? 'file' : 'inherited environment');
    for (const k of SWITCH_NOT_1) add(`env-switch:${k}`, get(k) === '1' ? 'MISMATCH' : 'OK', eff.has(k) ? `set in ${src(k)} (value not printed)` : 'absent');
    for (const d of DEFAULT_ON) {
      const v = get(d.key); const ok = d.safe(v, get);
      if (ok) add(`env-default-on:${d.key}`, 'OK', v === undefined ? 'absent, but the alternative switch is explicitly safe' : `explicitly safe in ${src(d.key)} (value not printed)`);
      else add(`env-default-on:${d.key}`, 'MISMATCH', v === undefined ? `absent => the path is ON by default; ${d.rule}` : `set in ${src(d.key)} but not the safe value; ${d.rule}`);
    }
    for (const k of ID_ABSENT) { const v = get(k); const present = v !== undefined && v.trim() !== ''; add(`env-id:${k}`, present ? 'MISMATCH' : 'OK', present ? `present and non-empty in ${src(k)} (value not printed)` : 'absent/empty'); }
  }
  // ---- v0.5 (N4-1): reconcile the PRODUCTION index.js against the declared surface at every boot (not only in the test)
  try {
    const idxPath = opt('--index', path.join(root, 'kasia-console', 'src', 'index.js'));   // --index: test hook to point at a different file
    const analysis = analyzeBootFile(fs.readFileSync(idxPath, 'utf8'));
    const lists = JSON.parse(JSON.stringify({ cronRegistry: CRON_REGISTRY, nonStart: NON_START, bareImports: BARE_IMPORTS, indexTimers: INDEX_TIMERS }));
    const problems = reconcileBoot(analysis, lists);
    if (problems.length === 0) add('boot-registry', 'OK', `index.js uses=${analysis.uses.size} timers=${analysis.timers.length} unparsed=0; every use is declared`);
    else for (const [i, p] of problems.entries()) add(`boot-registry#${i + 1}`, 'MISMATCH', p.slice(0, 260));
  } catch (e) { add('boot-registry', 'UNKNOWN', `cannot analyse index.js: ${e.code || e.message}`); }
  let bad = 0;
  for (const r of results) { if (r.status !== 'OK') bad++; console.log(`GUARD ${r.name} ${r.status}${r.detail ? ' ' + r.detail : ''}`); }
  console.log(`GUARD-RESULT checks=${results.length} not_ok=${bad}`);
  process.exit(bad ? 3 : 0);
}
```

### C.4 `scripts/boot-guard-check.test.mjs`（上述 126 项测试全文）

```js
// boot-guard-check.test.mjs -- tests for scripts/boot-guard-check.mjs (NWT N-2 completeness, N-3 parser parity, guard scenarios).
// Run: node --test scripts/boot-guard-check.test.mjs     (env BOOT_GUARD_ROOT overrides the repo root, for rehearsal in a worktree)
// SAFETY: everything that writes (fixture DBs / env files) lives in a mkdtemp directory under os.tmpdir(); before the first write the test
// asserts that directory is under the temp root and never touches the repo's data dir or kanet.mainnet.env.
import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(here, 'boot-guard-check.mjs');
const ROOT = path.resolve(process.env.BOOT_GUARD_ROOT || path.join(here, '..'));
const req = createRequire(path.join(ROOT, 'kasia-console', 'package.json'));
const Database = req('better-sqlite3');
const { parseLauncherEnvText, effectiveEnv, decodeEnvFile, analyzeBootFile, reconcileBoot, stripComments } = await import('file:///' + TOOL.replace(/\\/g, '/'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-guard-test-'));
assert.ok(TMP.startsWith(os.tmpdir() + path.sep) && path.basename(TMP).startsWith('boot-guard-test-'), 'SAFETY: test dir must be a boot-guard-test-* dir under the temp root');
const safe = (p) => { assert.ok(p === TMP || p.startsWith(TMP + path.sep), `SAFETY: path outside the temp dir: ${p}`); return p; };
test.after(() => { assert.ok(TMP.startsWith(os.tmpdir() + path.sep)); fs.rmSync(TMP, { recursive: true, force: true }); });

const LISTS = JSON.parse(spawnSync(process.execPath, [TOOL, '--print-lists'], { encoding: 'utf8' }).stdout);

// ------------------------------------------------------------------------------------------------ 1. guard scenarios (fixture DB + fixture env, CLI)
function mk(name, { rows = {}, autotake = ['false', 'auto'], skipTable = null, envText = '', scanner = null, extra = [], bom = false } = {}) {
  const safeName = name.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
  const dbp = safe(path.join(TMP, `g-${safeName}.db`)); try { fs.unlinkSync(dbp); } catch { /* fresh */ }
  const db = new Database(dbp);
  db.exec('CREATE TABLE relay_nodes (id TEXT, name TEXT, address TEXT, is_oracle INTEGER DEFAULT 0)');
  for (const t of ['submit_intents', 'worldcup_schedule', 'zk_prove_jobs']) db.exec(`CREATE TABLE ${t} (status TEXT)`);
  db.exec('CREATE TABLE chain_events (event_type TEXT)'); db.exec('CREATE TABLE market_seeder_config (id TEXT, enabled INTEGER)');
  for (const t of ['agent_wallets', 'exchange_offers', 'pool_markets', 'pool_bettor_sides', 'oracle_registry', 'oracle_stake_enrollments', 'retail_dex_buy_publications', 'mm_orders']) if (t !== skipTable) db.exec(`CREATE TABLE ${t} (id INTEGER)`);
  db.exec('CREATE TABLE config_entries (key TEXT, is_sensitive INTEGER, value_encrypted TEXT)');
  if (autotake) { db.prepare("INSERT INTO config_entries VALUES ('autotake_enabled',0,?)").run(autotake[0]); db.prepare("INSERT INTO config_entries VALUES ('autotake_mode',0,?)").run(autotake[1]); }
  if (scanner !== null) db.prepare("INSERT INTO config_entries VALUES ('scanner_enabled',0,?)").run(scanner);
  for (const sqlx of extra) db.exec(sqlx);
  for (const [t, n] of Object.entries(rows)) { if (t === 'oracle') db.prepare("INSERT INTO relay_nodes VALUES ('i','n','addr-x',1)").run(); else for (let i = 0; i < n; i++) db.exec(`INSERT INTO ${t} VALUES (1)`); }
  db.close();
  const envp = safe(path.join(TMP, `g-${safeName}.env`)); fs.writeFileSync(envp, bom ? Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(envText, 'utf8')]) : envText);
  return { dbp, envp };
}
// a CLEAN effective environment: every default-on switch explicitly safe, so scenarios only vary what they mean to
const CLEAN_ENV = 'MINING_CONSOLIDATE_ENABLED=false\nAUTO_BET_TICK_MS=0\n';
function run(label, spec, want, { inherited = {}, expectNotOk } = {}) {
  test(`(guard) ${label}`, () => {
    const { dbp, envp } = mk(label, { ...spec, envText: (spec.noClean ? '' : CLEAN_ENV) + (spec.envText || '') });
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...inherited };   // NOT the caller's environment: a clean, controlled base
    const r = spawnSync(process.execPath, [TOOL, '--db', dbp, '--env', envp, '--root', ROOT], { encoding: 'utf8', env });
    const notOk = r.stdout.split('\n').filter((l) => /^GUARD (?!RESULT)/.test(l) && !/ OK( |$)/.test(l)).map((l) => l.split(' ')[1]);
    assert.strictEqual(r.status, want, `exit ${r.status} want ${want}; not_ok=${notOk.join(',')}\n${r.stdout.slice(-400)}`);
    if (expectNotOk) assert.ok(notOk.includes(expectNotOk), `expected ${expectNotOk} among not-OK: ${notOk.join(',')}`);
  });
}
run('all clear', {}, 0);
run('autotake true+approval is safe', { autotake: ['true', 'approval'] }, 0);
run('autotake true+auto (the real mainnet state) -> MISMATCH', { autotake: ['true', 'auto'] }, 3, { expectNotOk: 'config:autotake' });
run('autotake rows absent -> UNKNOWN (fail-closed)', { autotake: null }, 3, { expectNotOk: 'config:autotake' });
for (const t of ['agent_wallets', 'exchange_offers', 'pool_markets', 'pool_bettor_sides', 'oracle_registry', 'oracle_stake_enrollments', 'retail_dex_buy_publications', 'mm_orders']) run(`table ${t} has a row -> MISMATCH`, { rows: { [t]: 1 } }, 3, { expectNotOk: `rows:${t}` });
run('an is_oracle=1 relay with an address -> MISMATCH', { rows: { oracle: 1 } }, 3);
run('missing table -> UNKNOWN (fail-closed)', { skipTable: 'oracle_registry' }, 3, { expectNotOk: 'rows:oracle_registry' });
run('scanner_enabled=true -> MISMATCH', { scanner: 'true' }, 3, { expectNotOk: 'config:scanner_enabled' });
run('scanner_enabled=false is fine', { scanner: 'false' }, 0);
run('a prepared submit_intent -> MISMATCH', { extra: ["INSERT INTO submit_intents VALUES ('prepared')"] }, 3);
run('a submit_intent in another status is fine', { extra: ["INSERT INTO submit_intents VALUES ('done')"] }, 0);
run('worldcup_schedule pending_teams -> MISMATCH', { extra: ["INSERT INTO worldcup_schedule VALUES ('pending_teams')"] }, 3);
run('zk_prove_jobs pending -> MISMATCH', { extra: ["INSERT INTO zk_prove_jobs VALUES ('pending')"] }, 3);
run('bettor_refund_available event -> MISMATCH', { extra: ["INSERT INTO chain_events VALUES ('bettor_refund_available')"] }, 3);
run('other chain_events are fine', { extra: ["INSERT INTO chain_events VALUES ('x')"] }, 0);
run('market_seeder_config enabled=1 -> MISMATCH', { extra: ["INSERT INTO market_seeder_config VALUES ('default',1)"] }, 3, { expectNotOk: 'rows:market_seeder_config(enabled=1)' });
run('market_seeder_config enabled=0 is fine', { extra: ["INSERT INTO market_seeder_config VALUES ('default',0)"] }, 0);
// N-2: every default-OFF switch, one by one (each must be a MISMATCH at exactly '1' and fine at '0')
for (const k of LISTS.switchNotOne) { run(`switch ${k}=1 -> MISMATCH`, { envText: `${k}=1\n` }, 3, { expectNotOk: `env-switch:${k}` }); run(`switch ${k}=0 is fine`, { envText: `${k}=0\n` }, 0); }
// N-2: default-ON second class
run('MINING_CONSOLIDATE_ENABLED ABSENT (default-on!) -> MISMATCH', { noClean: true, envText: 'AUTO_BET_TICK_MS=0\n' }, 3, { expectNotOk: 'env-default-on:MINING_CONSOLIDATE_ENABLED' });
run('MINING_CONSOLIDATE_ENABLED=true -> MISMATCH', { noClean: true, envText: 'MINING_CONSOLIDATE_ENABLED=true\nAUTO_BET_TICK_MS=0\n' }, 3);
run("MINING_CONSOLIDATE_ENABLED=' FALSE ' (trim+lower, as the source does) is safe", { noClean: true, envText: 'MINING_CONSOLIDATE_ENABLED= FALSE \nAUTO_BET_TICK_MS=0\n' }, 0);
run('AUTO_BET_TICK_MS ABSENT (default-on!) -> MISMATCH', { noClean: true, envText: 'MINING_CONSOLIDATE_ENABLED=false\n' }, 3, { expectNotOk: 'env-default-on:AUTO_BET_TICK_MS' });
run('AUTO_BET_TICK_MS=60000 -> MISMATCH', { noClean: true, envText: 'MINING_CONSOLIDATE_ENABLED=false\nAUTO_BET_TICK_MS=60000\n' }, 3);
run('AUTO_BET_TICK_MS absent but DEMO_AUTOBETTER_OFF=1 is safe', { noClean: true, envText: 'MINING_CONSOLIDATE_ENABLED=false\nDEMO_AUTOBETTER_OFF=1\n' }, 0);
for (const k of LISTS.idAbsent) { run(`id key ${k} present -> MISMATCH`, { envText: `${k}=abc\n` }, 3, { expectNotOk: `env-id:${k}` }); run(`id key ${k} empty is fine`, { envText: `${k}=\n` }, 0); }
run('PREDICTION_AGENT_ENABLED_PEERS whitespace-only is empty (source trims and filters) -> fine', { envText: 'PREDICTION_AGENT_ENABLED_PEERS= \n' }, 0);
run('a commented-out switch line is ignored', { envText: '# UTXO_AUTOSPLIT_ON_START=1\n' }, 0);
// N-3 inheritance: the effective environment is inherited UNION file
run('INHERITED environment alone can arm a switch (file has no key) -> MISMATCH', {}, 3, { inherited: { UTXO_AUTOSPLIT_ON_START: '1' }, expectNotOk: 'env-switch:UTXO_AUTOSPLIT_ON_START' });
run('inherited safe value is enough for a default-on key', { noClean: true, envText: '' }, 0, { inherited: { MINING_CONSOLIDATE_ENABLED: 'false', AUTO_BET_TICK_MS: '0' } });
run('file overrides inherited (file says 0, inherited says 1) -> fine', { envText: 'UTXO_AUTOSPLIT_ON_START=0\n' }, 0, { inherited: { UTXO_AUTOSPLIT_ON_START: '1' } });
run('an EMPTY file value REMOVES an inherited one (launcher semantics) -> fine', { envText: 'UTXO_AUTOSPLIT_ON_START=\n' }, 0, { inherited: { UTXO_AUTOSPLIT_ON_START: '1' } });
run('env names are case-insensitive (Windows): inherited lower-case key still counts -> MISMATCH', {}, 3, { inherited: { utxo_autosplit_on_start: '1' } });
// N-3 the two bugs NWT found: `KEY =1` must now be seen as SET (launcher reads it as KEY=1)
run('KEY =1 (space before =) is read as SET by the launcher -> MISMATCH (v0.3 said "absent")', { envText: 'UTXO_AUTOSPLIT_ON_START =1\n' }, 3, { expectNotOk: 'env-switch:UTXO_AUTOSPLIT_ON_START' });
run('KEY<TAB>=1 -> MISMATCH', { envText: 'UTXO_AUTOSPLIT_ON_START\t=1\n' }, 3);
run('a lower-case KEY in the FILE is the same Windows variable -> MISMATCH', { envText: 'utxo_autosplit_on_start=1\n' }, 3, { expectNotOk: 'env-switch:UTXO_AUTOSPLIT_ON_START' });
// the lists themselves are PINNED to NWT's findings (a mutation that silently shortens a list must not pass just because the per-item loops shrink with it)
test('(N-2 pin) the guard lists contain everything NWT named', () => {
  for (const k of ['ZK_CLOSE_TICK_ENABLED', 'ZK_CLOSE_TICK_V2_ENABLED', 'ZK_CLAIM_TICK_ENABLED', 'ZK_HANDOFF_TICK_ENABLED', 'ZK_JUDGE_PROPOSE_TICK_ENABLED', 'POOL_SEEDER_ENABLED', 'PREDICTION_AGENT_ENABLED', 'UTXO_AUTOSPLIT_ON_START', 'BROADCASTER_UTXO_MAINTAIN', 'BROKER_ENABLED', 'SETTLE_DAEMON_ENABLED', 'PROTO_DRIVER_ENABLED']) assert.ok(LISTS.switchNotOne.includes(k), `switch list must contain ${k}`);
  for (const k of ['MINING_CONSOLIDATE_ENABLED', 'AUTO_BET_TICK_MS']) assert.ok(LISTS.defaultOn.includes(k), `default-on list must contain ${k}`);
  for (const k of ['MINING_RELAY_ID', 'PREDICTION_AGENT_ENABLED_PEERS', 'POOL_SEEDER_MAKER_RELAY', 'BROADCASTER_RELAY_IDS', 'BOT_AUTOFUND_SOURCE_RELAY_ID', 'FAUCET_RELAY_ID']) assert.ok(LISTS.idAbsent.includes(k), `id-absent list must contain ${k}`);
  for (const k of ['agent_wallets', 'exchange_offers', 'pool_markets', 'pool_bettor_sides', 'oracle_registry', 'oracle_stake_enrollments', 'retail_dex_buy_publications', 'mm_orders', 'relay_nodes(is_oracle=1,address)']) assert.ok(LISTS.tables.includes(k), `table list must contain ${k}`);
});

// ------------------------------------------------------------------------------------------------ 2. N-3: guard parser == the REAL PowerShell loader on 17 line shapes
test('(N-3) the guard parses kanet.mainnet.env exactly like start-console-mainnet.ps1 (17 line shapes, mixed CRLF / LF / lone CR, BOM, duplicates, empty value) vs a real powershell.exe run of the launcher loop', () => {
  const lines = [
    ['﻿ZZT_A=1', '\r\n'], ['ZZT_B =1', '\n'], ['ZZT_C\t=1', '\r\n'], [' ZZT_D=1', '\n'], ['ZZT_E= 1', '\r\n'], ['ZZT_F=1 ', '\n'],
    ['ZZT_G="1"', '\r\n'], ["ZZT_H='1'", '\n'], ['export ZZT_I=1', '\r\n'], ['# ZZT_J=1', '\n'], ['   # ZZT_K=1', '\r\n'],
    ['ZZT_L=1', '\n'], ['ZZT_L=2', '\r'], ['ZZT_M=', '\n'], ['ZZT_N=a=b', '\r\n'], ['\tZZT_P=1', '\n'], ['ZZT_Q=1', '\r'], ['ZZT_R=', '\n'],
  ];
  const buf = Buffer.from(lines.map(([l, e]) => l + e).join(''), 'utf8');
  const f = safe(path.join(TMP, 'shapes.env')); fs.writeFileSync(f, buf);
  const ps = `$env:ZZT_R='9'; $f='${f.replace(/'/g, "''")}'; $log=@()
Get-Content $f | ForEach-Object { if ($_ -match '^\\s*#' -or $_ -match '^\\s*$') { return }; if ($_ -match '^([^=]+)=(.*)$') { try { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2], 'Process') } catch { $log += 'THROW' } } }
Get-ChildItem Env: | Where-Object { $_.Name -like 'ZZT_*' } | Sort-Object Name | ForEach-Object { '{0}=[{1}]' -f $_.Name.ToUpper(), $_.Value }
'log=' + ($log -join ',')`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const psOut = r.stdout.split(/\r?\n/).filter((l) => /^ZZT_/.test(l));
  // guard side: parse + overlay on the same inherited ZZT_R=9
  const { vars } = parseLauncherEnvText(decodeEnvFile(buf).text);
  const eff = effectiveEnv({ ZZT_R: '9' }, vars);
  const mine = [...eff].filter(([k]) => k.startsWith('ZZT_')).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=[${v}]`);
  assert.deepStrictEqual(mine, psOut, `guard parse differs from the real loader.\nguard: ${mine.join(' ')}\nps   : ${psOut.join(' ')}`);
  // spot-check the interesting outcomes so a wrong-but-equal pair cannot pass silently
  assert.ok(psOut.includes('ZZT_B=[1]') && psOut.includes('ZZT_C=[1]'), '`KEY =1` and `KEY<TAB>=1` ARE set by the launcher (the v0.3 guard said absent)');
  assert.ok(psOut.includes('ZZT_L=[2]') && !psOut.some((l) => l.startsWith('ZZT_M=')) && !psOut.some((l) => l.startsWith('ZZT_R=')), 'last duplicate wins; empty value removes/keeps unset, including an inherited value');
  assert.ok(psOut.includes('ZZT_G=["1"]') && psOut.includes('ZZT_F=[1 ]') && psOut.includes('ZZT_E=[ 1]'), 'quotes and surrounding spaces in the VALUE are kept verbatim');
  assert.ok(!psOut.some((l) => l.startsWith('ZZT_I=')) && !psOut.some((l) => l.startsWith('ZZT_J=') || l.startsWith('ZZT_K=')), '`export KEY=1` sets a variable named "export ZZT_I", comments are skipped');
  assert.ok(psOut.includes('ZZT_A=[1]'), 'a leading UTF-8 BOM is stripped by Get-Content');
});
test('(N-3) an empty NAME (` =1`) makes the REAL launcher throw; the guard never treats it as a setting', () => {
  const f = safe(path.join(TMP, 'emptyname.env')); fs.writeFileSync(f, ' =1\nZZT_S=1\n');
  const ps = `$f='${f.replace(/'/g, "''")}'; $log=@(); Get-Content $f | ForEach-Object { if ($_ -match '^\\s*#' -or $_ -match '^\\s*$') { return }; if ($_ -match '^([^=]+)=(.*)$') { try { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2], 'Process') } catch { $log += 'THROW' } } }; 'log=' + ($log -join ',')`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  assert.match(r.stdout, /log=THROW/, 'the launcher throws on an empty name (its $ErrorActionPreference=Stop would abort it)');
  const { vars, emptyNameLines } = parseLauncherEnvText(decodeEnvFile(fs.readFileSync(f)).text);
  assert.strictEqual(emptyNameLines, 1); assert.ok(!vars.has('') && vars.get('ZZT_S') === '1');
});

// ------------------------------------------------------------------------------------------------ 3. N-2 / N4-1: boot-surface reconciliation (inverted rule)
const REAL_INDEX = fs.readFileSync(path.join(ROOT, 'kasia-console', 'src', 'index.js'), 'utf8');
export function checkRegistry(lists) {   // internal consistency of the declarations themselves
  const problems = [];
  const reg = lists.cronRegistry, all = new Set([...lists.switchNotOne, ...lists.defaultOn, ...lists.idAbsent, ...lists.nonCronGates]);
  const kinds = ['switch', 'default-on', 'id', 'data', 'config', 'no-spend', 'infra', 'audit-only', 'not-audited'];
  const check = (k, e) => {
    for (const g of e.gates || []) if (!all.has(g)) problems.push(`${k}: gate env ${g} is not in any guard list`);
    for (const t of e.tables || []) if (!lists.tables.includes(t)) problems.push(`${k}: table guard ${t} is not in the guard's table list`);
    for (const c of e.configs || []) if (!lists.configGuards.includes(c)) problems.push(`${k}: config guard ${c} is not a config check`);
    if (e.kind === 'switch' && !(e.gates || []).length) problems.push(`${k}: kind switch needs gates`);
    if (e.kind === 'data' && !(e.tables || []).length) problems.push(`${k}: kind data needs tables`);
    if (e.kind === 'config' && !(e.configs || []).length) problems.push(`${k}: kind config needs configs`);
    if (!kinds.includes(e.kind)) problems.push(`${k}: unknown kind ${e.kind}`);
    if (!e.why) problems.push(`${k}: missing why (evidence)`);
  };
  for (const [k, e] of Object.entries(reg)) check(k, e);
  for (const e of lists.indexTimers) check(`INDEX_TIMERS:${e.id}`, e);
  for (const [k, e] of Object.entries(lists.nonStart.names)) if (!e.why) problems.push(`NON_START ${k}: missing why`);
  for (const p of lists.nonStart.patterns) { if (!p.why) problems.push(`NON_START pattern ${p.re}: missing why`); try { new RegExp(p.re); } catch { problems.push(`NON_START pattern ${p.re}: not a regex`); } }
  for (const k of Object.keys(reg)) if (lists.nonStart.names[k]) problems.push(`${k} is both a registry entry and a NON_START name`);
  return problems;
}
test('(N4-1) the declarations are internally consistent (gates/tables/configs exist, kinds valid, every entry has evidence)', () => {
  const p = checkRegistry(LISTS); assert.deepStrictEqual(p, [], p.join('\n'));
});
test('(N4-1) index.js: every relative-module identifier it USES is declared (registry or NON_START); no undeclared timer / bare import; no unparsed shape', () => {
  const analysis = analyzeBootFile(REAL_INDEX);
  assert.ok(analysis.uses.size >= 100, `the analysis must actually find the uses (found ${analysis.uses.size})`);
  const problems = reconcileBoot(analysis, LISTS);
  assert.deepStrictEqual(problems, [], problems.join('\n'));
  const kinds = {}; for (const e of Object.values(LISTS.cronRegistry)) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  console.log(`boot surface: uses=${analysis.uses.size} timers=${analysis.timers.length}; registry by kind:`, JSON.stringify(kinds));
});
test('(N4-1) gate-like env names (*_ENABLED / *_OFF) in every module index.js STARTS are all guarded or explicitly ignored with a reason', () => {
  const src = path.join(ROOT, 'kasia-console', 'src');
  const guarded = new Set([...LISTS.switchNotOne, ...LISTS.defaultOn, ...LISTS.idAbsent, ...LISTS.nonCronGates]);
  const ignored = new Set(Object.values(LISTS.cronRegistry).flatMap((e) => e.ignoreGates || []));
  const found = new Map();
  for (const [name, u] of analyzeBootFile(REAL_INDEX).uses) {
    if (!LISTS.cronRegistry[name]) continue;
    const p = path.resolve(src, u.module); if (!fs.existsSync(p)) continue;
    for (const m of stripComments(fs.readFileSync(p, 'utf8')).matchAll(/process\.env\.([A-Z0-9_]+)/g)) if (/_ENABLED$|_OFF$/.test(m[1])) found.set(m[1], name);
  }
  const unguarded = [...found].filter(([n]) => !guarded.has(n) && !ignored.has(n)).map(([n, c]) => `${n} (read by ${c})`);
  assert.deepStrictEqual(unguarded, [], `gate-like env names not in the guard lists (add them, or list them in the registry entry's ignoreGates with a reason): ${unguarded.join(', ')}`);
});
// ---- NWT's six blind spots (nwt-registry-blindspot-probe.mjs: A control + B..G) appended to the REAL index.js: every one must now be RED
const NEW_SHAPES = [
  ['A control: static import + startBrandNewCron()', "\nimport { startBrandNewCron } from './services/new.js';\nstartBrandNewCron();\n", /startBrandNewCron/],
  ['B verb "launch": launchPayoutSweeper()', "\nimport { launchPayoutSweeper } from './services/new.js';\nlaunchPayoutSweeper();\n", /launchPayoutSweeper/],
  ['C dynamic import destructure', "\nconst { startDynCron } = await import('./services/dyn.js');\nstartDynCron();\n", /startDynCron/],
  ['D namespace import: ns.startNsCron()', "\nimport * as ns from './services/ns.js';\nns.startNsCron();\n", /ns\.startNsCron/],
  ['E direct timer: setInterval(() => sendMoney(), 1000)', "\nsetInterval(() => sendMoney(), 1000);\n", /UNDECLARED timer/],
  ['G bare side-effect import', "\nimport './services/x.js';\n", /UNDECLARED bare side-effect import \.\/services\/x\.js/],
  ['H default import + call', "\nimport spendAll from './services/spend.js';\nspendAll();\n", /spendAll/],
  ['I member call on an awaited dynamic import: (await import()).go()', "\n(await import('./services/m.js')).go();\n", /\(await import\(\.\/services\/m\.js\)\)\.go/],
  ['J import().then(...)', "\nimport('./services/t.js').then((m) => m.run());\n", /import\(\.\/services\/t\.js\)\.then/],
  ['K dynamic import with a non-literal specifier', "\nconst mod = './services/' + process.env.X;\nawait import(mod);\n", /UNPARSED/],
  ['L dynamic import assigned without await', "\nconst p = import('./services/n.js');\n", /UNPARSED/],
  ['M aliased named import: import { start as go }', "\nimport { startThing as goThing } from './services/a.js';\ngoThing();\n", /goThing/],
  ['N setTimeout', "\nsetTimeout(() => { fire(); }, 5);\n", /UNDECLARED timer/],
  ['O child process spawn', "\nimport { spawn } from 'node:child_process';\nspawn('x', []);\n", /UNDECLARED timer\/process start spawn/],
  ['P a starter passed as a VALUE, never called: setTimeout(startSneaky, 1)', "\nimport { startSneaky } from './services/s.js';\nsetTimeout(startSneaky, 1);\n", /startSneaky/],
];
for (const [label, addition, want] of NEW_SHAPES) {
  test(`(N4-1) a new shape appended to the real index.js goes RED: ${label}`, () => {
    const problems = reconcileBoot(analyzeBootFile(REAL_INDEX + addition), LISTS);
    assert.ok(problems.length > 0 && problems.some((p) => want.test(p)), `expected a problem matching ${want}; got: ${problems.join(' | ') || '(none: GREEN = the blind spot is still there)'}`);
  });
}
test('(N4-1) the analysis ignores strings and comments (a log line or comment that mentions startFoo( is not a use), and a relative import inside a string is not an import', () => {
  const noise = "\n// startGhostCron();  import { startGhostCron } from './g.js';\n/* setInterval(() => x(), 1) */\nconsole.log('startGhostCron() setInterval( import(\"./g.js\")');\nconst re = /[^/*]+/; const s = \"import './ghost.js'\";\n";
  assert.deepStrictEqual(reconcileBoot(analyzeBootFile(REAL_INDEX + noise), LISTS), []);
});
test('(N4-1 control) removing a use from index.js leaves a STALE registry entry; declaring a gate/table that is in no list is caught by the consistency check', () => {
  const noMining = REAL_INDEX.replace(/startMiningConsolidateCron/g, 'startMiningConsolidateCronX');
  assert.ok(reconcileBoot(analyzeBootFile(noMining), LISTS).some((p) => p.includes('STALE') && p.includes('startMiningConsolidateCron')), 'a renamed/removed starter must go RED as STALE (and the new spelling as UNDECLARED)');
  const bad = JSON.parse(JSON.stringify(LISTS)); bad.cronRegistry.startProtoDriver.gates.push('NOT_A_GUARDED_NAME'); bad.cronRegistry.startPoolMarketSettlerCron.tables = ['no_such_table_guard']; bad.cronRegistry.autoStartIfEnabled.configs = ['no_such_config'];
  const pr = checkRegistry(bad);
  assert.ok(pr.some((p) => p.includes('NOT_A_GUARDED_NAME')) && pr.some((p) => p.includes('no_such_table_guard')) && pr.some((p) => p.includes('no_such_config')), pr.join('\n'));
});
test('(N4-1 control) a stale INDEX_TIMERS entry (its timer disappeared) and a stale NON_START name are RED', () => {
  const noTimer = REAL_INDEX.replace('exchange.expireTick', 'exchange.renamedTick');
  assert.ok(reconcileBoot(analyzeBootFile(noTimer), LISTS).some((p) => /UNDECLARED timer/.test(p)) && reconcileBoot(analyzeBootFile(noTimer), LISTS).some((p) => /STALE INDEX_TIMERS entry: exchange-expire-tick/.test(p)));
  const noI18n = REAL_INDEX.replace(/parseLang/g, 'parseLangX');
  assert.ok(reconcileBoot(analyzeBootFile(noI18n), LISTS).some((p) => p.includes('STALE NON_START name') && p.includes('parseLang')));
});
// (these four use a UTF-8 BOM: only then does Get-Content decode as UTF-8, which is the situation NWT measured)
// ---- the SAME reconciliation runs inside the guard at boot (not only in this test): a production index.js with an undeclared use => the guard exits 3
function runWithIndex(label, indexText) {
  const { dbp, envp } = mk(label, { envText: CLEAN_ENV });
  const r = safe(path.join(TMP, `root-${label.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 24)}`));
  fs.mkdirSync(path.join(r, 'kasia-console', 'src'), { recursive: true }); fs.writeFileSync(path.join(r, 'kasia-console', 'src', 'index.js'), indexText);
  // the tool resolves better-sqlite3 from <root>/kasia-console/package.json: point --root at the real repo for the DB module, and use --index to override only the file under test
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };
  return spawnSync(process.execPath, [TOOL, '--db', dbp, '--env', envp, '--root', ROOT, '--index', path.join(r, 'kasia-console', 'src', 'index.js')], { encoding: 'utf8', env });
}
test('(N4-1 runtime) the guard reconciles the production index.js at boot: the real file is OK; a file with an undeclared use / unparsed import goes MISMATCH (exit 3)', () => {
  const ok = runWithIndex('rt real', REAL_INDEX);
  assert.strictEqual(ok.status, 0, ok.stdout.slice(-500)); assert.match(ok.stdout, /GUARD boot-registry OK/);
  const bad = runWithIndex('rt bad', REAL_INDEX + "\nconst { startRogue } = await import('./services/rogue.js');\nstartRogue();\n");
  assert.strictEqual(bad.status, 3); assert.match(bad.stdout, /GUARD boot-registry#1 MISMATCH UNDECLARED use of startRogue/);
  const unparsed = runWithIndex('rt unparsed', REAL_INDEX + "\nawait import(process.env.ROGUE);\n");
  assert.strictEqual(unparsed.status, 3); assert.match(unparsed.stdout, /UNPARSED shape/);
});
test('(N4-1 runtime) an unreadable index.js is UNKNOWN (fail-closed), not silently skipped', () => {
  const { dbp, envp } = mk('rt missing', { envText: CLEAN_ENV });
  const r = spawnSync(process.execPath, [TOOL, '--db', dbp, '--env', envp, '--root', ROOT, '--index', path.join(TMP, 'no-such-index.js')], { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  assert.strictEqual(r.status, 3); assert.match(r.stdout, /GUARD boot-registry UNKNOWN/);
});

// ------------------------------------------------------------------------------------------------ 4. N4-3: parser residue (NWT fuzz) + file encodings
const PS_LOADER = (dir) => `$ErrorActionPreference='Continue'; $dir='${dir.replace(/'/g, "''")}'; $res=[ordered]@{}
foreach ($f in Get-ChildItem $dir -Filter 'case_*.env' | Sort-Object Name) {
  foreach ($k in @([Environment]::GetEnvironmentVariables('Process').Keys)) { if ($k -like 'NWTZ_*') { [Environment]::SetEnvironmentVariable($k, $null, 'Process') } }
  $threw=0; Get-Content $f.FullName | ForEach-Object { if ($_ -match '^\\s*#' -or $_ -match '^\\s*$') { return }; if ($_ -match '^([^=]+)=(.*)$') { try { [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2], 'Process') } catch { $threw++ } } }
  $pairs=@(); foreach ($k in @([Environment]::GetEnvironmentVariables('Process').Keys | Where-Object { $_ -like 'NWTZ_*' })) { $pairs += ,@((($k.ToUpper().ToCharArray() | ForEach-Object { '{0:X4}' -f [int]$_ }) -join ' '), [Environment]::GetEnvironmentVariable($k,'Process')) }
  $res[$f.Name]=[ordered]@{ pairs=$pairs; threw=$threw } }
$res | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $dir 'oracle.json')`;
test('(N4-3) differential fuzz vs the REAL PowerShell loader: 300 seeded random env files incl. U+0085 / interior U+FEFF / U+2028 / U+2029 / NBSP / U+3000, mixed EOLs, BOM -- zero disagreements', () => {
  const dir = safe(path.join(TMP, 'fuzz')); fs.mkdirSync(dir, { recursive: true });
  let s = 123456789; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const WS = [' ', '\t', ' ', '\u0085', ' ', '\u000B', '\u000C', '\uFEFF', '\u3000', '\u00A0', '\u2003', '\u2028', '\u2029', '\u202F'];
  const NAMES = ['NWTZ_A', 'nwtz_a', 'NWTZ_B', 'Nwtz_B', 'NWTZ_C'];
  const VALS = ['1', '0', 'false', 'FALSE', ' ', '"1"', "'1'", '1 ', ' 1', '=', '=1', '#x', 'a b', ' ', '1\u2028', '\u00851', '1\uFEFF', 'x=y', '', '', ''];
  const EOLS = ['\n', '\r\n', '\r'];
  const line = () => { const r = rnd();
    if (r < 0.08) return pick(['#', ' #', '\t#']) + pick(NAMES) + '=' + pick(VALS);
    if (r < 0.12) return pick(['', ' ', '\t', '\u0085']);
    if (r < 0.16) return 'export ' + pick(NAMES) + '=' + pick(VALS);
    if (r < 0.20) return pick(NAMES);
    if (r < 0.24) return pick(WS) + '=' + pick(VALS);
    const pre = rnd() < 0.3 ? pick(WS) : '', mid1 = rnd() < 0.3 ? pick(WS) : '', mid2 = rnd() < 0.2 ? pick(WS) : '';
    return pre + pick(NAMES) + mid1 + '=' + mid2 + pick(VALS); };
  const N = 300;
  for (let i = 0; i < N; i++) { const n = 1 + Math.floor(rnd() * 6); let txt = ''; const mode = pick(['lf', 'crlf', 'cr', 'mixed']);
    for (let j = 0; j < n; j++) { txt += line(); if (j < n - 1 || rnd() < 0.5) txt += mode === 'mixed' ? pick(EOLS) : { lf: '\n', crlf: '\r\n', cr: '\r' }[mode]; }
    fs.writeFileSync(path.join(dir, `case_${String(i).padStart(4, '0')}.env`), '\uFEFF' + txt, 'utf8'); }
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_LOADER(dir)], { encoding: 'utf8', timeout: 240000 });
  assert.strictEqual(r.status, 0, r.stderr);
  const oracle = JSON.parse(fs.readFileSync(path.join(dir, 'oracle.json'), 'utf8').replace(/^\uFEFF/, ''));
  const diffs = [];
  for (const [name, o] of Object.entries(oracle)) {
    const dec = decodeEnvFile(fs.readFileSync(path.join(dir, name))); assert.ok(dec.text !== undefined, `${name} must decode`);
    const hex = (s) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')).join(' ');
    const g = {}; for (const [k, v] of parseLauncherEnvText(dec.text).vars) if (k.startsWith('NWTZ_') && v !== null) g[hex(k)] = v;
    const l = {}; for (const p of o.pairs || []) l[p[0]] = p[1];
    if (JSON.stringify(Object.entries(g).sort()) !== JSON.stringify(Object.entries(l).sort())) diffs.push(`${name}: guard=${JSON.stringify(g)} launcher=${JSON.stringify(l)}`);
  }
  assert.strictEqual(Object.keys(oracle).length, N); assert.deepStrictEqual(diffs.slice(0, 5), [], `${diffs.length} disagreements with the real loader; first: ${diffs[0]}`);
});
run('KEY<U+0085>=1 (NEL inside the name; .NET Trim() removes it, JS trim() does not) -> MISMATCH', { bom: true, envText: 'UTXO_AUTOSPLIT_ON_START\u0085=1\n' }, 3, { expectNotOk: 'env-switch:UTXO_AUTOSPLIT_ON_START' });
run('<U+0085>KEY=1 (NEL before the name) -> MISMATCH', { bom: true, envText: '\u0085UTXO_AUTOSPLIT_ON_START=1\n' }, 3, { expectNotOk: 'env-switch:UTXO_AUTOSPLIT_ON_START' });
run('KEY=1<U+2028> keeps U+2028 in the VALUE (.NET . matches it) so the value is not exactly 1 -> fine (same as the launcher)', { bom: true, envText: 'UTXO_AUTOSPLIT_ON_START=1\u2028\n' }, 0);
run('interior U+FEFF is NOT whitespace for .NET Trim(): "KEY<U+FEFF>=1" is a different variable name -> fine (same as the launcher)', { bom: true, envText: 'UTXO_AUTOSPLIT_ON_START\uFEFF=1\n' }, 0);
// encodings: the launcher's Get-Content honours the BOM
function runBuf(label, buf, want, notOk) {
  test(`(N4-3 encoding) ${label}`, () => {
    const { dbp, envp } = mk(label, { envText: CLEAN_ENV }); fs.writeFileSync(envp, buf);
    const r = spawnSync(process.execPath, [TOOL, '--db', dbp, '--env', envp, '--root', ROOT], { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
    assert.strictEqual(r.status, want, r.stdout.slice(-400)); if (notOk) assert.ok(r.stdout.includes(notOk), `${notOk} missing: ${r.stdout.slice(-300)}`);
  });
}
const u16 = (t, bom) => Buffer.concat([Buffer.from(bom), Buffer.from(t, 'utf16le')]);
const ARM = CLEAN_ENV + 'UTXO_AUTOSPLIT_ON_START=1\n';
runBuf('UTF-16LE with BOM arming a switch -> MISMATCH (v0.4 read it as garbage and said "absent")', u16(ARM, [0xFF, 0xFE]), 3, 'GUARD env-switch:UTXO_AUTOSPLIT_ON_START MISMATCH');
runBuf('UTF-16BE with BOM arming a switch -> MISMATCH', (() => { const b = Buffer.from(ARM, 'utf16le'); b.swap16(); return Buffer.concat([Buffer.from([0xFE, 0xFF]), b]); })(), 3, 'GUARD env-switch:UTXO_AUTOSPLIT_ON_START MISMATCH');
runBuf('UTF-16LE with BOM, all clear -> exit 0', u16(CLEAN_ENV, [0xFF, 0xFE]), 0);
runBuf('UTF-16LE WITHOUT a BOM (NUL bytes) -> UNKNOWN (fail-closed)', Buffer.from(ARM, 'utf16le'), 3, 'GUARD env:file UNKNOWN');
runBuf('UTF-8 with BOM arming a switch -> MISMATCH', Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(ARM)]), 3, 'GUARD env-switch:UTXO_AUTOSPLIT_ON_START MISMATCH');
runBuf('a non-ASCII byte inside a setting NAME in a BOM-less file -> UNKNOWN (the launcher decodes with the ANSI code page)', Buffer.from(CLEAN_ENV + '中文_KEY=1\n'), 3, 'GUARD env:file UNKNOWN');
runBuf('non-ASCII in a COMMENT or in a VALUE of a BOM-less file is fine (all clear)', Buffer.from(CLEAN_ENV + '# 中文注释\nHINT_TEXT=中文\n'), 0);
test('(N4-3 encoding) decodeEnvFile unit: a second U+FEFF after the BOM is DATA (Get-Content consumes one BOM only)', () => {
  const d = decodeEnvFile(Buffer.from([0xEF, 0xBB, 0xBF, 0xEF, 0xBB, 0xBF, 0x41, 0x3D, 0x31]));   // BOM, U+FEFF, "A=1"
  assert.strictEqual(d.text, '\uFEFFA=1'); assert.ok(!parseLauncherEnvText(d.text).vars.has('A'), 'name is U+FEFF+A, not A');
});
test('(N4-1) the guard\'s own stripComments behaves exactly like the shared scanner\'s (J2 F5) on index.js and on tricky snippets -- the guard must stay self-contained, so it keeps a copy, and this test keeps the copy honest', async () => {
  const shared = path.join(ROOT, 'kasia-console', 'test-fixtures', 'source-scan', 'scan-non-test-sources.mjs');
  if (!fs.existsSync(shared)) return;   // an older tree without the shared scanner: nothing to compare against
  const { stripComments: theirs } = await import('file:///' + shared.replace(/\\/g, '/'));
  const corpus = [REAL_INDEX, "const re = /[^/*]+/; x(); // c\n/* b */ y();", "const s = 'a // not a comment'; const t = `t ${ x /* c */ } `;", "a = b / c; // d\ne = f / g;", "return /x*/.test(s);\n/* m\nl */ z();", "const q = \"/* in a string */\";"];
  for (const c of corpus) assert.strictEqual(stripComments(c), theirs(c));
});
```

