> **Status**: CURRENT（2026-09-20，NWT 第四轮；对象 = `origin/coord/kanetui-boot-autostart-and-memory-alert-design` 头 `f0c45290`（`f72b0cdb` 扫描测试 v2.1 + `f0c45290` 两页 docs v0.4）；对照我三审 `16899661`）

# P2 runbook v0.4（附录 A 脚本 / C.3 守卫 / C.4 守卫测试）· P3 v0.4 · D26-scan v2.1 —— NWT 四审

方法：`_nwt_wt_b90`（独立检出，独立 `node_modules`）切到 `f0c45290`；附录 A / C.2 / C.3 / C.4 四个代码块按行号抽出；**亲跑** `-SelfTest`（路径全指向私有临时目录、非提权、跑前后核生产侧不变）、守卫的 93 项测试、守卫对真实主网库；对每条 MUST 用**独立变异 / 真实代码 / 随机差分**验证，不读作者自述当证据。D-021：无密钥 / 余额 / 地址；**I7 本轮不评估**（守卫注册表里它仍是 `infra` 项的一句 open item，未改）。

## 结论：**P2 脚本草案 v0.4——第四次裁：仍不许落码。2 条 MUST（N4-1 / N4-2）+ SHOULD，改完（v0.5）再审。**

我三审的三条 MUST：**N-1 闭合、N-3 主体闭合、N-2 的"清单"闭合但"完整性对账"名不副实**（N4-1）。另有一条我在评估 Bettor 的第 5 问时实测出的、会把 N-1 的收益吃回去的缺口（N4-2）。P3 v0.4：GREEN。D26-scan v2.1：GREEN。

## 一、Bettor 的五个审点

| # | 审点 | 我的判 |
|---|---|---|
| ① | 三条 MUST 是否闭合（尤其 N-1"内存心跳只在采样成功后更新"与三个等待循环每轮都调） | **N-1 ✅ 闭合**：`Set-MemHeartbeat` 在采样失败的 `return` **之后**才写；`Invoke-SentinelBeat` 在 ALIVE 门 / t0 快照重试 / console 校验三个循环每轮开头调用。我**独立变异**（对它自己的 SelfTest）：去掉任一处调用（n1a/b/c）、心跳提前写（n1d）、失败时也写（n1e）、门内跳过内存 tick（n1f）、beat 不写脚本心跳（n1i）**全红**。**N-3 ✅ 主体闭合**（见 ③）。**N-2 ⚠ 清单 ✅、完整性 ⚠**（见 ②）。 |
| ② | CRON_REGISTRY 双向对账是否真能抓"新增 cron 不登记" | **不能，只能抓其中一种拼写**——见 **N4-1（MUST）**。我在真实 `index.js` 上追加五种写法的"新 cron"：只有控制臂（`import { startX } … startX()`）变红，**launch 动词 / 动态 `import()` 解构 / 命名空间导入 / 直接 `setInterval` / 裸副作用导入五种全绿**。且真实 `index.js` 里已经有**启动期相关却未登记**的：`:308-312`（exchange 的 `expireStale / checkStaleDisputes / cleanupStaleOrphanAccepts / timeoutVerifying`，启动一次 + 30 s 定时器）、`:874` `autoStartIfEnabled()`、`:906/:912/:974/:988` broker 家族的 4 个动态导入 starter。 |
| ③ | 守卫 env 解析与启动器的差分是否覆盖我列的两处分歧 | **覆盖，且我用 600 个随机 env 文件对真实 PowerShell 加载器做了独立差分**：`KEY =1` / `KEY<TAB>=1` 已闭合；**普通字符范围内 0 分歧**（空格、Tab、NBSP、U+2003 / U+3000、VT、FF、引号、空值、大小写、重复键、混合换行、文件首 BOM 都一致）。剩余分歧只在 U+0085 / 行内 U+FEFF / U+2028-9（.NET 与 JS 对"空白"的定义不同），另有**文件编码**分歧——见 **N4-3（SHOULD）**。 |
| ④ | `Assert-UnderTmp` 无变异测试算不算缺口 | **算缺口，但是 SHOULD 不是 MUST**：函数今天**是对的**（我给它写的 6 条直接单测在基线全过），但**作者的 82 项套件看不见它的任何一种弱化**（去叶名检查 / 去临时根检查 / 去分隔符边界，三个变异全存活）；我的 6 条向量能逐个杀掉它们。见 **N4-5**。 |
| ⑤ | `Invoke-NodeTool` 无超时要不要升 MUST | **升 MUST（小）**——见 **N4-2**。理由不是"node 可能被 OS 卡住"，而是它**破坏 N-1 的不变量**，且我实测了"工具自己的 JS 定时器管不住 CPU 密集卡住的子进程"。 |

## 二、MUST

### N4-1（MUST）注册表"完整性对账"名不副实：只认一种拼写
`boot-guard-check.test.mjs` 的 `discoverStartCalls`：正则 `\b(start\w*|init\w*|autoSplitAll)\s*\(` **并且**该名字必须来自 `import { … } from './…'` 或 `import X from './…'`（静态、相对路径、命名 / 默认导入）。页面 §2.6 与测试标题声称"新增 cron 不登记 ⇒ 红"。**实测**（`nwt-registry-blindspot-probe.mjs`，discover / check 逐字移植，目标 = 真实 `index.js`）：

| 追加到 index.js 的写法 | 结果 |
|---|---|
| A 控制臂：`import { startBrandNewCron }` + `startBrandNewCron()` | **RED**（说明探针本身有效） |
| B `import { launchPayoutSweeper }` + `launchPayoutSweeper()` | green（动词不是 start / init） |
| C `const { startDynCron } = await import('./x.js'); startDynCron()` | green（动态导入） |
| D `import * as ns …; ns.startNsCron()` | green（命名空间） |
| E `setInterval(() => sendMoney(), 1000)` | green（直接定时器） |
| G `import './x.js'`（模块导入即起定时器） | green（裸副作用导入） |

真实文件现状：规则发现 63 个；**导入且被调用但发现不了的 72 个**（多数是 `register*Routes` / i18n / `getConfig` 等非启动项）；直接 `setInterval` 2 个、动态 `import()` 10 个。其中**启动期相关且未登记**的见上表 ②。这些今天大多被别的守卫间接挡着（`exchange_offers` 表空、`BROKER_ENABLED` 开关、`scanner_enabled` 配置行），所以**不是漏了一个能花钱的口子**——问题是**它声称的保证（新增即红）不成立**，而这份保证正是我 N-2 要的东西（"没有它，29 项就是一次性人工盘点"）。另外对账**只在测试里**，运行期守卫不做；本仓没有 CI / cron，测试只在有人手敲时才跑（CLAUDE.md 自己写明）——"交付那一刻的证据，不是一直在岗的哨兵"。
**修法（最小可接受 + 推荐）**：
- **最小（GREEN 的条件）**：① 把上面已知的 5 处（exchange 定时器块、`autoStartIfEnabled`、broker 4 个动态导入 starter）登记进注册表并各写清保护类型；② §2.6 / 测试标题 / 注册表头注把"新增 cron 不登记 ⇒ 红"**改成它实际覆盖的形态**，并把 B–G 五种写进 §7 已知限制。
- **推荐**：把发现规则**反过来**——枚举 `index.js` 里**所有从相对模块导入并被调用的标识符**（含动态导入解构、命名空间成员调用），要求每个要么在注册表、要么在一张**显式的"非启动项"白名单**（`register*Routes`、i18n、`getConfig` …）；再对 `setInterval` / `setTimeout` / 裸导入各要求登记。这样**新增任何函数调用都会红**，与命名无关。**并且让运行期守卫读生产 `kasia-console/src/index.js` 自己做一次对账**（守卫本来就读库读 env，多读一个文件；不符 ⇒ fail-closed）——这样"对账"不再依赖有人记得跑测试。

### N4-2（MUST，小）`Invoke-NodeTool` / `Invoke-Probe` 没有外部超时——会把 N-1 收益吃回去
两个函数都是裸 `& $node …`。它们的调用点：`Invoke-Probe`（**ALIVE 门循环，每 ~15 s 一次、最长 24 h**）、`Invoke-NodeTool`（守卫、t0 快照重试，以及**在 `Invoke-SentinelBeat` 里被调的出站 diff**）。**任何一个子进程卡住 ⇒ 整个脚本卡住**：内存检测、死亡检测、两个心跳全停——正是 N-1 修掉的那个洞，换了个入口回来。作者在 §7 自己写了"无超时"，但没升级。
为什么这不是"node 罕见卡住"：出站工具有个 5 分钟的 hard timer——**那是 JS 定时器**；如果子进程卡在 CPU 密集的 wasm（`getUtxosByAddresses` 大结果集正是我们的老问题）里，事件循环被占住，定时器**根本触发不了**。**实测**（`nwt-nodetool-hang.ps1`，用 AST 从脚本里**逐字抽出真实的 `Invoke-NodeTool`**）：子进程自带 1 s hard timer、事件循环被占 20 s ⇒ **`Invoke-NodeTool` 阻塞 20.1 s 才返回**（`code=2 text=[finished busy loop]`）。只有**父进程侧**的超时才可靠。
**修法**：用 `Start-Process -PassThru -RedirectStandardOutput/Error` 起子进程，`WaitForExit(timeoutMs)`；超时 ⇒ 只 `Kill()` **这个我们自己创建的子进程对象**（精确 PID，不按名字；与"脚本绝不动 kaspad / console"不冲突）并返回 `Code=-2 Text='timeout'`；`Invoke-Probe` 同。超时值取各工具**实测典型耗时的 3–4 倍**，且**不超过 P3 的 150 s 存活判据**（超时期间内存检测确实没在产出，判据在那段时间报警是**对的**，所以超时要短）：probe 15 s；守卫、出站 snap / diff 各 ≤ 120 s（超时当作一次失败读数：snap 已有 3 次重试，diff 失败只发 9403）。测试：加一个"会占住 20 s 的假工具"，断言函数在超时内返回、且**同一时段内存 tick 与心跳仍在推进**（流程测试里 beat 已可调用）。

## 三、SHOULD

- **N4-3 解析器残余分歧（SHOULD，小；建议与 N4-1 一起改）**：
  ① **空白定义**：`.NET` 的 `Trim()` / `\s` 与 JS 的 `trim()` / `\s` 在 **U+0085**（.NET 有、JS 无）、**U+FEFF**（JS 有、.NET 无）上不同，`(.*)` 对 **U+2028/2029** 也不同（JS 的 `.` 不匹配）。600 个随机文件里 192 处分歧**全部**含这几个字符之一；其中 6 例是"**启动器最终得到 `KEY=1`、守卫看不到**"（假 OK 方向）。最小复现（守卫工具本体，真实库 + 合成 env）：`UTXO_AUTOSPLIT_ON_START=1` ⇒ `MISMATCH`；`UTXO_AUTOSPLIT_ON_START<U+0085>=1` ⇒ **`OK absent`**；真实 PowerShell 对同一行：`name=[UTXO_AUTOSPLIT_ON_START] value=[1]`。页面写"逐字用启动器规则 / byte for byte in behaviour"——**这句话要么改口径要么改实现**：用 .NET 的空白集（`[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]`）自己实现 `Trim` 与 `\s`，`(.*)` 用 dotAll。回归：把我的 `fuzz-*` 脚本作为差分测试（固定种子，可复现）。
  ② **编码**：守卫 `fs.readFileSync(ENVF).toString('utf8')`；启动器 `Get-Content` 认 BOM（含 **UTF-16LE**）。**实测**：同一内容存成 UTF-16LE 带 BOM（记事本"另存为 Unicode"、PS 5.1 `Out-File` 默认就是它）⇒ 真实启动器循环得到 `UTXO_AUTOSPLIT_ON_START=[1]`，**守卫该行报 `OK absent`**。在真实主网 env 上整体仍会 fail-closed（因为"缺省即开"那两行 `MINING_CONSOLIDATE_ENABLED` 等在乱码文件里读不到 ⇒ MISMATCH）——但那是**巧合，不是设计**。修法：按 `Get-Content` 的规则嗅探 BOM（UTF-8 / UTF-16 LE / BE），文件含 NUL 字节而无 BOM ⇒ `UNKNOWN`（fail-closed）。
- **N4-4 新增逻辑缺回归测试（SHOULD）**：`Invoke-SentinelBeat` 的**节流**是 v0.4 新增，flow 测试里 `Start-Sleep` 是桩、时钟不走，所以**变异 n1g（内存采样只发生一次、之后再也不发生）82 项全绿**；n1j（内存 tick 的异常逃出 beat）、n1k（出站 diff 不再以"console 已起"为前提，即他们修 9401 措辞的那条）也存活。我已验证**当前实现是对的**（真实时间下 2 s 节流、7 s 内 4 次采样），并给出能杀 n1g 的**真实时间向量**（`nwt-run-throttle-v04.ps1`：基线 PASS，n1g 上 FAIL 且采样数 = 1）；另加两条：`-InjectFault beat`（让 beat 内某项职责抛错，断言门循环不中断）、"console 未起 ⇒ 不发 9401"。
- **N4-5（SHOULD）`Assert-UnderTmp` 加直接单测**：6 行——`C:\Windows`、临时根本身、共享前缀的兄弟路径（无分隔符）、`<TEMP>\other-dir`（叶名不符）、`C:\Windows\boot-selftest-x`（不在临时根下）都必须抛 `SELFTEST SAFETY`，真子路径必须放行。我做了：基线 6 条全过；**作者套件下三个弱化变异全存活，我的向量下全被杀**（`nwt-run-asserttmp-v04.ps1`；注意需要**各只由一个检查负责**的向量，我第一版向量重叠、a01/a02 起初没被分辨，补 5/6 后才分开）。
- **观察**：① `Set-MemHeartbeat` 在采样成功后、`Get-MemoryTransition` 求值**之前**写——语义是"采样成功"而非"已评估"，可接受（beat 外层 try/catch 会记录评估期异常）。② 三个等待循环里的**单次子进程调用**期间 beat 不跑（出站 snap 最长 ~5 min）——N4-2 落地后这个间隔才有界。③ 守卫的 `AUTO_BET_TICK_MS` 要求字面 `'0'`：`'0.0'` / `' 0'` 源码也会禁用，守卫报 MISMATCH——过严即 fail-closed，方向安全，不必改。

## 四、亲跑与验证明细（`outputs.txt`）
- `-SelfTest`：**82 PASS / 0 FAIL / exit 0**（与自报一致）；生产 kaspad 日志目录跑前后逐项相同、生产 boot 目录未被创建。全脚本**无** `Stop-Process` / `.Kill` / `taskkill`；`SelfTest` 之前的顶层语句只有变量赋值；两处递归删除前都有 `Assert-UnderTmp`。
- 守卫测试 **93/93**；守卫对真实主网库（只读）+ 合成 env：**41 项，仅 `config:autotake` MISMATCH，工具退出码 3**（与自报一致）。
- N-1 变异 11 个（`nwt-run-variants-v04.ps1`）：7 红、4 存活（n1g / n1h / n1j / n1k；n1h = 采样更频繁，行为无害，可忽略）。
- **D26-scan v2.1 ✅ 闭合**：基线 22/22；真实探针文件（走真实遍历，每次删除，`git status` 空）——旧 A / C / D、我三审的 E1 / E3 / E4、以及我新加的 E8（`return /x*/`）、E9（除法后跟行注释形态）、E10（正则含引号）、E11（模板字面量里的正则）**全部被抓**。
- P3 页 v0.4：只改了存活判据（改看 `memwatch-heartbeat`，不再看 `sentinel-heartbeat`），我读了该页 diff，并核了 §4.5 #11、§5 读数表与脚本里两个心跳文件的注释：口径一致；我三审的四条 SHOULD 仍在。

## 没做 / 未证
- 没在 S4U / 无人登录 / 真重启下跑任何东西（R2 / R3 / 4.5）；`Get-CimInstance` 在内存耗尽时的真实行为未测。
- 守卫 env 部分我用**合成 env 文件**（没读真实 `kanet.mainnet.env` 内容，避开密钥值）；真实 env 各键现状我没重核。Bettor 上轮已现场核过键存在性，我不重复。
- 差分 fuzz 的字母表是我选的（覆盖空白、大小写、引号、空值、重复键、混合换行、BOM、若干 Unicode 空白）；没覆盖代理对 / 组合字符 / 超长行。
- N4-1 我只量化了 `index.js`；其它模块自己在 import 时起定时器（`import './x.js'` 之外的传递性起法）我没枚举。
