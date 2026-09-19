> **Status**: CURRENT（2026-09-20，NWT 第三轮；对象 = `origin/coord/kanetui-boot-autostart-and-memory-alert-design` 头 `50de05aa`；相对我上轮 `9b2e7943` 审的 `1d52c7f7`）

# P2 runbook v0.3（含附录 A 脚本 / 附录 C 两个工具）· P3 v0.3 · D26-scan v2 —— NWT 三审

方法：`_nwt_wt_b90`（我的独立检出，独立 `node_modules`）切到 `50de05aa`；附录 A 脚本按 `sed -n 339,1171p` 抽出（833 行，sha256 `6d6bf1e0…`，全 ASCII）**亲跑其 `-SelfTest`**（全部路径参数指向私有临时目录、非提权，见 §三）；附录 C 两个工具抽出**对真实库 / 真实节点只读实跑**；D26-scan 用**真实探针文件**走真实目录遍历实测。D-021：无密钥、余额、地址；**I7（relay 内建入站握手）本轮不评估、不复述其机制**——页内已标"细节不入本页、已单独报 Bettor"，我只把它当"守卫覆盖不到的开放项"。

## 结论

- **P2 脚本草案 v0.3：第三次裁——仍不许落码。3 条 MUST（N-1 / N-2 / N-3）+ 若干 SHOULD，改完（KANet-UI v0.4）再审。** 我上轮 M-A / M-B / M-C 三条 MUST 的**落点全部方向对、且这次我都用独立实测验证了**（§二）——剩下的 3 条是"新代码 / 新工具自己的缺口"，不是回退。
- **P3 v0.3**：我的 4 条 SHOULD 全部落地且如实标注"只做度量"（§五）；与 N-1 叠加处见下。
- **D26-scan v2**：我 A / C / D 三个旧绕过**全部闭合**（真实文件实测）；新发现 2 处边角漏（SHOULD，§四）。

## 一、MUST

### N-1（MUST）门等待期间内存检测是**关着的**；而 v0.3 的心跳会把它伪装成"活着"
生产路径里 `Invoke-MemoryWatchTick` **只有一个调用点**：`Invoke-SentinelLoop`（脚本 :525）。哨兵循环要等 `Invoke-PhaseB` **整体返回**后才进入。`Invoke-PhaseB` 里依次是：`Wait-KaspadAlive`（默认最长 `GateHardSec=86400 s`，软告警 5400 s——**正是追块 / RocksDB 恢复、内存最吃紧的时段**）、`Invoke-OutboundSnap`（≤3 次重试 + 每次 15 s）、`Start-ConsolePhase` 的 300 s 校验循环。这些等待期间：**内存检测不跑**；死亡检测只有门循环里对 kaspad 的一个 `Get-Process`，console 死亡不检。而 P3 的全部目的正是"下一次撞提交上限之前先响"。
更糟：v0.3 SHOULD-1 的心跳"覆盖整个脚本生命周期"（`Wait-KaspadAlive` 里也 `Set-Heartbeat`）——于是**门等待期间心跳新鲜、内存检测已死**，消费者按"没告警 + 心跳新鲜 = 内存正常"读，这正是我一贯说的"失败值与合法取不到不可分"。
**实测**（在它自己的 SelfTest 夹具上加一条向量，`nwt-run-variants.ps1` 的 `v01`）：`Reset-Sim @{ ProbeCode = 7 }`（kaspad 一直 SYNCING）+ CRIT 提交样本 + 门循环 6 次 `Start-Sleep` 后放行——**9302（CRIT）不发**：`FAIL NWT-N1`；**阳性对照**（同一 CRIT 样本、探针立即 ALIVE、哨兵在跑）**发** 9302（`PASS NWT-N1-control`，76 PASS / 1 FAIL），证明夹具与事件路径本身有效。
**修法**：把"哨兵一拍"（内存 tick + 死亡检查，各自 try/catch）抽成一个函数，在 `Wait-KaspadAlive` / `Invoke-OutboundSnap` / console 校验三个等待循环里**每轮调用**（先 `Enter-MemoryLock`）；**心跳改由"职责"写**：内存 tick 成功才更新 `memory-watch` 自己的心跳文件（或在同一心跳文件里写 `memwatch_at=`），P3 的存活判据看**内存检测心跳**而不是脚本心跳。回归：上面的向量加进 SelfTest（门等待期间 CRIT ⇒ 9302 且内存心跳新鲜）。

### N-2（MUST）守卫（附录 C.3）的清单与 §2.6 T10 的声明**不一致**，且漏了"默认开启型"cron
§2.6 T10 写"守卫核这些 env 键不为 1"（`ZK_*`、`AUTO_BET_TICK_MS`、`POOL_SEEDER_ENABLED` 等）；T11 写"守卫核 id 键"。**实际工具**（我数：13 张表 + 10 个开关 + 4 个 id + autotake + scanner = **29 项**，与页面一致）**没有**：
- **`MINING_CONSOLIDATE_ENABLED`（默认开启型）**：`mining-utxo-consolidate.mjs:31` `(env || 'true') !== 'false'`——**缺省即开**；同一文件要 `MINING_RELAY_ID` 才真起（:113）。它发的是 `consolidate_utxo`（链上 UTXO 状态驱动，**不是库表驱动**——所以表空守卫覆盖不到）。主网现在靠 `kanet.mainnet.env` 里一行 `MINING_CONSOLIDATE_ENABLED=false` 挡着（页 T11 有日志阳性证据），但**守卫既不核这一行、也不核 `MINING_RELAY_ID` 缺席**——删掉那一行就是每次开机自动 `consolidate_utxo`，守卫报 OK。
- **五个 ZK tick 开关**（`ZK_CLOSE_TICK_ENABLED` / `ZK_CLOSE_TICK_V2_ENABLED` / `ZK_CLAIM_TICK_ENABLED` / `ZK_HANDOFF_TICK_ENABLED` / `ZK_JUDGE_PROPOSE_TICK_ENABLED`）：`index.js:799-806` **无条件**启动各自的 cron，只靠各自的 `=== '1'`；与 `SETTLE_DAEMON_ENABLED` 无关。页面说守卫核了，工具没核（它们今天被 `pool_markets` / `zk_prove_jobs` 等表空间接挡着，但那是"碰巧"，不是守卫）。
- `POOL_SEEDER_ENABLED`、`PREDICTION_AGENT_ENABLED` 与 **`PREDICTION_AGENT_ENABLED_PEERS`**（`conversations.js:338-339`：`_PEERS` 非空也启用）、`AUTO_BET_TICK_MS`（`pool-auto-better` **缺省 20 s 开启**，靠显式 `0` 或 `DEMO_AUTOBETTER_OFF=1` 关；`parseTickMs` 的 falsy bug 已修，显式 0 现在能关）——同样不在工具里。
**修法（两件都要）**：① 守卫加**第二类**"缺省即开的开关必须显式为关"（`MINING_CONSOLIDATE_ENABLED` 必须为 `false`；`AUTO_BET_TICK_MS` 必须为 `0` 或 `DEMO_AUTOBETTER_OFF=1`……），并把 `MINING_RELAY_ID`、`PREDICTION_AGENT_ENABLED_PEERS` 补进"id 键必须缺席"，把五个 ZK tick + `POOL_SEEDER_ENABLED` + `PREDICTION_AGENT_ENABLED` 补进"不得为 1"；② 加一条**清单完整性测试**（D26-scan 同型）：枚举 `index.js` 里每个在启动时被调用的 `start*Cron()` / 顶层启动块的**门控 env 名**，要求每个名字要么在守卫清单里、要么在一张**有据的"数据类守卫"表**里（每项写明是哪张表 / 哪个 config 使它惰性）——**新增一个 cron 而不登记 ⇒ 红**。没有这条，29 项就是"一次性人工盘点"，下一个 cron 加进来守卫照样绿。
（我核过其余 7 个 `=== '1'` 开关的读取语义确为 `=== '1'`，与守卫的"不得为 1"一致；`PROTO_SETTLEMENT_DRIVER_ENABLED` 生产源码里目前没有读取点——将来 9-2b 才读，不算错。）

### N-3（MUST，小）守卫与真正的加载器是**两套 env 解析器**，`KEY =1` 时守卫给假 OK
`start-console-mainnet.ps1` 的加载器：`^([^=]+)=(.*)$`，键 `.Trim()`，值原样（含引号、空白）。守卫：`^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$`——**键名必须紧贴 `=`**。差分（`guard-vs-loader-diff.mjs`，14 种行形态）：**恰 2 处分歧**——`KEY =1`（空格）与 `KEY<TAB>=1`：加载器注入 `KEY=1`，守卫看成"键不存在"。我**用三处证据钉死**：① 在**真实 PowerShell** 里对这几行求加载器的正则：`UTXO_AUTOSPLIT_ON_START =1 → name=[UTXO_AUTOSPLIT_ON_START] value=[1]`；② 用**守卫工具本体**（真实库 + 合成 env）：规范写法 `UTXO_AUTOSPLIT_ON_START=1` ⇒ `MISMATCH`，`UTXO_AUTOSPLIT_ON_START =1` ⇒ `OK key absent`；③ 其余形态（引号、尾随空白、重复键、`export`、注释行、BOM）两者一致。
另一半：守卫**只看文件**，而 console 的实际环境 = **继承环境 ∪ 文件（文件覆盖）**。我核了当前机器 / 用户级环境变量：25 个相关名字**都未设**（只报名字与层级）——所以今天无害，但设计上应把 `process.env` 作为底、文件覆盖，与启动器一致。
**修法**：守卫**逐字用启动器的解析**（同一正则 + `Trim()`），并把"启动器解析 == 守卫解析"做成差分测试（我这份脚本可直接作回归）；有效环境 = 继承 ∪ 文件。

## 二、我上轮三条 MUST / 六条 SHOULD 的闭合（独立验证）
| 项 | 判 | 依据（我做的，不是读他们的自述） |
|---|---|---|
| **M-A** 起后无 exit / 无未捕获异常 | ✅ 闭合 | 读全 `Invoke-PhaseA/B/BootMain` 控制流：Phase A 在 kaspad 已知的**同一时刻**发布 `$Script:Ctx`，其后各自 try/catch；外层 catch 只在 `Ctx` 为空时 `Stop-Boot 99`；Phase B 被 try/catch 包住；哨兵循环最外层 `while+catch`。**全脚本无 `Stop-Process` / `.Kill` / `taskkill`。** **变异**（在它自己的 SelfTest 上，`nwt-run-variants.ps1`）：m1 去 PhaseB 的 try ⇒ 红（F3）；m2 外层 catch 恒 `Stop-Boot` ⇒ 红（F2b）；m4 `Ctx` 晚发布 ⇒ 红（F2b）；m6 探针抛错中止门 ⇒ 红（F4）——流程测试**不是空判据**。存活 2 个：m3（pid 文件写失败的 catch 改重抛）= 等价（外层 catch 仍兜住，走 9099 路径）；m5（哨兵循环最外层 catch 去掉）= **无测试注入哨兵内异常**（SHOULD，§四）。 |
| **M-B** t0 时序 / 判据 / 独立工具 | ✅ 闭合 | 流程测试 F9 断言顺序 `start-kaspad,guard,snap,console,diff`（t0 在 console 之前、diff 在之后）；判据 `spent_outpoints==0`，外部入账只增 `new`；快照两次一致才写。**工具实跑（真实节点，只读）**：`snap` ⇒ `SNAP-OK relays=18 unreadable=0` exit 0；紧接 `diff` ⇒ `spent_outpoints=0` exit 0；**合成篡改 t0**：删一个真 outpoint 加一个假的 ⇒ `spent=1` **exit 3**；t0 里缺一个 relay（相当于 t0 之后新增）⇒ `UNREADABLE` **exit 4**（不当"无变化"）；连接不可达 ⇒ `ERROR connect` **exit 2**（30 s 内，不是崩溃码）。工具只 import 第三方包（`better-sqlite3` readonly、`kaspa-wasm`），**不 import 任何 console 源码**。 |
| **M-C** ① autotake 置关为注册门前提 ② §2.6 代码级 ③ 每次开机守卫 | ✅ 方向闭合；③ 的**完整性**是 N-2 / N-3 | ① 页 §0 / §4.3 写成显式前提，守卫对 autotake `MISMATCH`——**我对真实库实跑守卫：`GUARD-RESULT checks=29 not_ok=1`，唯一不 OK = `config:autotake`（已上膛），**工具退出码 3**（fail-closed），13 张表全 0、无 UNKNOWN（说明每条 SQL 的表 / 列名对得上真实 schema）。② 我核了 §2.6 对我 14 文件盘点的更正：`episode-builder.js` 里没有任何 relay IPC（`type: 'transfer'` 是时间线对象字面量）——**KANet-UI 的更正成立，我上轮多算**；我漏的 `api/pool.js`（`transferAndConfirm` 16 处 grep 命中）、`api/bettor.js`（`transferWithIntent` 6 处）确有转账 helper——**我的盘点漏了，认**。I1 的"三层碰巧"改写与我上轮的判断一致。③ 见 N-2 / N-3。 |
| S-A 单次探针异常 | ✅ | 门循环内 try/catch，异常当一次失败读数；F4 红（m6）。 |
| S-B git 属主 / tracked 源码干净 | ✅（读码） | `Test-TreeClean` 加 `git status --porcelain -- kasia-console/src kasia-relay/src`，S4U 下 git 失败 fail-closed 且带原话。**未在 S4U 下实跑**（R2 项）。 |
| S-C 树外副本 `C:\KANetBoot\` | ✅（设计） | 已知边界如实写明（副本仍读生产检出的探针 / 启动脚本 / 工具，由树检查覆盖）。 |
| S-D WMI 脱 Job 起法优先测 | ✅（设计） | R2 第一优先，条件设计。 |
| S-E `Get-LogTail` 真读 | ✅ | SelfTest 含 >8 KB 真实样本。 |

## 三、亲跑 `-SelfTest` 与那次"差点改名生产日志"的险情
- **亲跑**（非提权；全部路径参数指向 `%TEMP%` 下私有目录；先核了：`SelfTest` 之前的顶层语句只有变量赋值、无副作用；整个脚本无终止进程调用）：**75 PASS / 0 FAIL / exit 0 / 2 s**，与 KANet-UI 自报"75 项"一致。跑前后对照**生产 kaspad 日志目录**（大小 + 修改时间逐项）：**完全相同**；`D:\kanet-tn12\logs\mainnet\boot` **未被创建**。
- **险情护栏是活的**：变异 m7（去掉 SelfTest 里 `$KaspadLogDir` 的临时重定向；我的运行器仍把该参数指向私有临时目录，所以即使护栏没拦也碰不到生产）⇒ **在任何检查运行前（PASS=0）抛 `SELFTEST SAFETY: path outside the temp dir`** 终止。
- **SHOULD（N-6）**：SelfTest 末尾对 `$tmp` 做 `Remove-Item -Recurse -Force`，`Reset-Sim` 里还有一处对 `$KanetRoot\logs\mainnet\boot\*` 的递归删除；它们的安全性全靠 `$KanetRoot = $tmp` 这一次赋值。加固：断言 `$tmp` 位于 `[IO.Path]::GetTempPath()` 之下且叶名匹配 `boot-selftest-*`，前缀比较加路径分隔符边界（`StartsWith($tmp + '\')`）——递归删除前再断言一次，而不是只在循环前断言一次。
- 观察：`%TEMP%` 里有两个更早遗留的 `boot-selftest-20260919-*` 目录（不是我这次的；我的已被脚本自己清掉）——早先版本的 SelfTest 出错中途退出会遗留；无害。

## 四、SHOULD / 观察
- **N-4（D26-scan v2 边角，SHOULD）**：我用真实探针文件（走真实遍历，`git status` 每次还原干净）：**B 对照红、A（`src/data/…`）红、C（块注释同行）红、D（`broadcasterUtxoTick`）红**——三个旧绕过闭合；`agent-mind/`、`kasia-relay/` 下的调用红；字符串里含 `//`（E2）红；嵌套模板字面量（E5）红。**仍漏**：**E1** `const re = /[^/*]+/; B.ensureBroadcasterUtxos(...)`——正则字面量里的 `/*` 被 `stripComments` 当块注释开头，**过度剥离**真实代码（漏报方向）；**E3 / E4** `.mts` / `.jsx` 扩展名不在 `walkRepo` 的白名单里。仓库当前无这些文件，属边角；修法：扩展名放宽到 `\.(mjs|cjs|js|ts|mts|cts|jsx|tsx)$`；正则字面量的识别至少处理"字符类里的 `/`"，或对"剥离后与剥离前的引用数不一致"做保守回退（宁可在原文里找到名字就报）。
- **N-7（SHOULD）**：m5 存活——哨兵循环最外层 `while / catch` 是"最后一网"，没有测试能让异常逃出 `Invoke-SentinelLoop` 内层 try。加 `-InjectFault sentinel`（在 `Set-Heartbeat` 之外抛一次）+ 一条流程测试，证明脚本不死。
- 观察 ①：console 根本没起（`Start-ConsolePhase` 返回 `$null`）时，`OutboundDueMs` 仍被设置，+30 min 会发 9401"no relay outpoint was spent in the boot window"——无害但措辞误导，建议带上"console 未起"。② 出站检查的**已知限制**请写进 §7：只看到 **t0 已存在**的 outpoint 被花掉；窗口内"入账后立即又被花掉"的 UTXO 差分看不见（每笔花费都需要 relay 的 fee 输入，所以实际上多半仍会带出一个 t0 outpoint，但这是推论，未证）。③ 流程测试桩里 `GUARD-RESULT checks=24` 是桩文本，真实工具是 29——纯装饰，改成 29 免误导。④ P3：我的 SHOULD-3（哨兵自身内存不单调增长）他们如实写"只做了度量、R0 挂几小时才能判"——同意，验收留 R0。

## 四点五、没做 / 未证
- **没在 S4U / 无人登录 / 真重启下跑任何东西**（R2 / R3 / 4.5 的范围）；`Get-CimInstance` 在内存耗尽时的真实行为未测；`C:\KANetBoot\` 副本部署与树检查的交互没跑。
- 附录 C.3 守卫我用**合成 env 文件**跑（没读真实 `kanet.mainnet.env` 的内容，避免碰密钥值）；env 部分逻辑（`MUST_NOT_BE_1` / id 缺席）用合成文件验证，**真实 env 文件里各键的现状我没核**（页面 T10–T12 引的是日志阳性证据，我没重核）。
- I7：本轮不评估。
