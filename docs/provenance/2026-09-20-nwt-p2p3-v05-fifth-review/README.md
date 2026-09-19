> **Status**: CURRENT（2026-09-20，NWT 第五轮；对象 = `origin/coord/kanetui-boot-autostart-and-memory-alert-design` 头 `8bc77a12`（`37efde16` P2 runbook v0.5 + P3 一行读数 + `8bc77a12` 测试去重）；对照我四审 `57e60636`）

# P2 runbook v0.5（附录 A 脚本 / C.3 守卫 / C.4 守卫测试）—— NWT 五审

方法：独立检出（`D:\kanet-nwt-cand`，`8bc77a12`，独立 `npm ci`）；把附录 A / C.2 / C.3 / C.4 四个代码块按行号抽到 scratch；**亲跑**守卫 126 项测试（`BOOT_GUARD_ROOT` 指向我的检出）与 `-SelfTest`（路径全在临时目录、非提权）；对三条修复各用**我自己的**探针 / 向量 / 差分复测，不读作者自述当证据。本机内存限令期间只跑单文件与小脚本。D-021：四个改动文件里无地址 / 密钥 / 内网 IP（唯一的 64 位十六进制是 kaspad 二进制的公开 SHA256）。

## 结论：**N4-2、N4-3 闭合；N4-1 大体闭合但我找到 1 条 MUST（小）+ 1 条 SHOULD 的新盲区。P2 脚本 / 守卫仍不许落码，等 v0.6 修 N5-1（一处改动，我复审只看那一处）。**

| 类 | 编号 | 内容 |
|---|---|---|
| **MUST（小）** | **N5-1** | **`INDEX_TIMERS` 的声明按"该定时器语句所在行的 ±行窗口"匹配，紧挨着已声明定时器新加的 `setInterval` 会蹭到那条声明而不报**——这与 runbook 自己写的不变量"每个 `setInterval` / `setTimeout` / `spawn` / `Worker` / `.schedule(` 都在 `INDEX_TIMERS`"相矛盾。**实测**（真实 index.js，`outputs.txt` §2，阳性对照 P0 = 0 问题、C1–C3 三种真新增形状全红）：把 `setInterval(() => rogueSpend(), 1000);` 插在已声明的 `exchange.expireTick` 定时器**之前**（T1）、`console.heartbeatFile` 定时器**之前**（T2）、`exchange.expireTick` 行**之后一行**（T3）——**三种全部 GREEN**（对账 problems = 0，timers=4 但都被认为已声明）。为什么是"小 MUST"：新 tick 写在已有 tick 旁边是最自然的编辑位置；而 index.js 里直接的定时器只有 3 个、注册表里其余 147 项靠的是"入口名"对账，所以这是**直接定时器这一支**的洞，不是整个 N4-1 的失败。**修法（便宜）**：**一对一记账**——每条 `INDEX_TIMERS` 只能认领**一个**定时器语句，多出的定时器 ⇒ `UNDECLARED`（T1–T3 立刻红，因为 4 个定时器只有 3 条声明）；或把匹配范围收窄到该语句自身的文本（`setInterval(` 到配平的 `)`）。`cpu-prof-self-exit` 那条要看上方 `if (CPU_PROF_AUTO_EXIT_MS…)` 的 `before: 6`，改后要单独保住。测试加 T1–T3（我的探针原样可用）。 |
| SHOULD | **N5-2** | **"每个来自相对模块的导入都要么登记要么声明"这条不变量对两类形状不成立**：<br>• **导入但从未使用**的静态导入（U1 命名 / U2 默认 / U3 命名空间）——**GREEN**。ES 模块的静态依赖照样被求值，模块顶层代码会跑，效果同裸副作用导入（后者被守卫标红，前者没有）。这不是纯理论：**真实 index.js 里此刻就有 3 个这样的导入**（`detectStopRequest`、`startMonitor`、`stopMonitor`，见 `outputs.txt` §3；`startMonitor` 是"导入但被注释禁用"的典型——`// startMonitor();  // disabled per Owner`）。<br>• **`export * from` / `export { x } from` 相对模块**（R1 / R2）——**GREEN**，同样会执行被再导出的模块。<br>修法：未使用的相对导入与 `export … from` 走与 `BARE_IMPORTS` 同一条规则（须在一张带理由的表里声明，或转红）；现有 3 个补进去并写理由。**好消息**（也已实测）：把那行 `// startMonitor();` **取消注释**重新启用——守卫**转红**（`UNDECLARED use of startMonitor`，`outputs.txt` §4），所以最现实的"重新启用被禁的起动"是抓得到的；N5-2 只是"导入了但谁也没调"这一层。 |
| SHOULD（小） | **N5-3** | **`Invoke-BoundedProcess` 的参数引号不保真（当前是潜伏的）**：`(… -match '[\s"]') { '"' + ($_ -replace '"','\"') + '"' }` 没处理"以反斜杠结尾且含空格的参数"（`C:\some dir\` 的结尾反斜杠把闭合引号转义掉，吞掉后面的参数）和空字符串参数（被丢掉）。我的向量 c：发 `['a b','q"uote','C:\some dir\','','--x=1 2','plain']`，子进程收到 `["a b","q\"uote","C:\some dir\"  --x=1","2 plain "]`。**目前不触发**：三个真实调用（守卫无参、出站 `snap` / `diff` 各带一个 `D:\kanet-tn12\logs\mainnet\boot\outbound-t0.json`）的参数都不含空格，脚本路径也不含。若将来 `KanetRoot` 挪到带空格的路径、或某个参数以 `\` 结尾，就会静默错参。用标准的 Windows argv 转义（引号前的反斜杠翻倍、结尾反斜杠翻倍、空参数 `""`），并把我的向量 c 作为测试。另：函数**无上限地把整个输出读进内存返回**（向量 e：64 MB 输出 ⇒ 返回 67 108 864 字符）——对我们自己的三个工具无碍，记为观察，超时被杀时它只保留前 300 字符所以只影响正常退出的路径。 |
| 观察 | — | T4 别名（`const si = setInterval; si(fn, 5)`）GREEN——分析器只认 `setInterval(` 这种直接调用形态；需要有意为之才能写出，不要求堵，写进 §7-20 的盲区清单即可。 |

## 一、三条修复逐项复测

### N4-1（启动面对账规则反转）—— 大体闭合，见 N5-1 / N5-2
- **亲跑**守卫测试 **126 / 126**；`-SelfTest` **105 PASS / 0 FAIL**（`SELFTEST failures=0`）——与 KANet-UI 自报一致。
- 分析器对真实 index.js：**147 个使用、3 个定时器、0 UNPARSED、对账 0 问题**（我的阳性对照 P0）。
- 我的对照臂 C1（追加 `const {startX}=await import()` + 调用）、C2（裸 `await import()` 无绑定）、C3（孤立 `setInterval`）、T5（`globalThis.setInterval(`）全红——分析器对"新增一个起动"这一主形态是灵敏的。
- 新盲区见 N5-1 / N5-2。
- **NON_START 抽样（你们点名请我核的）**：`setConfig`（前半读了：只有 `config_entries` 的 SELECT / UPDATE / `encrypt`，`configs.js` 全文 grep 无 `fetch` / `spawn` / `sendCommand` / 定时器）✔；`registerMindSkills`（读了主体约 110 行：只 `readdir` / `readFile` 技能文件文本 + `skills` 表 SELECT / INSERT / UPDATE / DELETE；`skills.js` 全文 grep 无上述关键字，仅两处 `import('node:fs/promises')`）✔ 纯本地 DB；`warmupCommitteeOffsetCache`（读了：调 `deriveCommitteeCheckOffsets`，是本地编译器预热，失败只打日志）✔ 无链上动作。**其余 NON_START 名字（`runMigrations`、`checkSilvercPinAtStartup`、`assertProtoRelayHealthy`、i18n / 反垃圾查询 / `_sqlite` 等）我没有逐个读**——抽样不代表全部。
- **传递性副作用的量化**（回应 §7-20(b) 的已披露盲区）：index.js 静态 / 动态导入的 **121 个相对模块**里，**列 0 的定时器 / 子进程启动 = 0 个**（启发式：只看缩进为 0 的行，不含 IIFE 内部与更深的传递依赖）。所以该盲区**目前没有被触发**，但守卫不会在它被触发时报警。

### N4-2（`Invoke-BoundedProcess`）—— 闭合（+ N5-3）
我把函数原文（行 183–213）抽出来，在临时目录里用**我自己的**向量测（`nwt-bounded-probe.ps1`，`outputs.txt` §6）：
- **忙循环 + 自带 1 s 定时器（我四审的向量）、2 s 上限**：`Code=-2 TimedOut=True`，**2.1 s 返回**，等待期间**哨兵一拍被调 2 次且都是 `-NoDiff`**（`beatsWithDiff=0`，嵌套不重入 diff），被杀进程消失，**我另起的旁观 `node` 存活**（精确 PID，不是按名字杀）。
- 快退出、退出码 7、两路输出：`Code=7`，`OUT-LINE` 与 `ERR-LINE` 都在。
- **孙进程**（文档 §7-23 ① 说"只杀直接子进程"）：我让子进程再起一个孙进程，孙进程每 200 ms 写心跳文件（`nwt-bounded-grandchild.ps1`，§7）。**观察到**：等待期间心跳在走，**父进程被杀那一刻心跳停止、孙进程消失**——即这台机上、对 node 起的孙进程，**孙进程随直接子进程一起死了**，比文档写的"不杀进程树"更保守。我的**推断**（未验证）是 libuv 把 node 子进程放进带"关闭即杀"的作业对象；对**非 node** 子进程或 `detached` 的孙进程我没测，所以文档的限制说明保持写着也无妨，只是别把它当成"孙进程会残留"的实测。
- 参数引号不保真、输出不设上限：见 N5-3。
- **没做**：`Start-Process -NoNewWindow` + 重定向在 **S4U / 无人登录的计划任务会话**里的行为（作者也标了未实测；这是 R2/R3 才能补的）。

### N4-3（env 解析）—— 闭合
- 我**换种子**（987654321，J2 用的是我四审那份语料的固定种子）、**扩范围**：500 个文件，编码 = UTF-8+BOM 203 / UTF-16LE+BOM 76 / UTF-16BE+BOM 80 / 无 BOM UTF-8 141；空白集加进 U+180E、U+00A0、U+1680、U+2000–200A、U+202F、U+205F、U+2028/9、U+3000、U+0085、行内 U+FEFF、U+200B、U+2060；值里放非 BMP 字符。裁判 = 现行启动器的加载循环（`start-console-mainnet.ps1:53-56`，我核过与我的 oracle 逐字相同），**直接读 Win32 进程环境块**（`GetEnvironmentStringsW`），按"名字十六进制 + 值"配对。结果：**500 / 500 一致，guard 判 UNKNOWN = 0，DIFFER = 0**（`outputs.txt` §8）。
- **阴性对照**：同一批文件、同一份 oracle，换成朴素 JS 解析（JS `trim` / `\s` / 直接 utf8 读）：**240 / 500 分歧**（§8b）——语料与比较有灵敏度，500/500 不是空绿。
- **我要更正我自己的一处**：我第一次跑这批文件用的是四审沿用的 oracle（PowerShell `[ordered]` 字典按变量名为键），得到 **11 处"分歧"**，几乎全涉及 U+FEFF / U+200B / U+2060 名字——那是字典按区域比较规则把只差零宽字符的名字折叠成一个的**伪影**。J2 指出过这一点，我没有直接采信，换了 Win32 环境块独立验证后**确认他们说得对**：11 处全部消失。这也意味着我**四审报的那批分歧总数里掺有这类伪影**；U+0085 与 UTF-16 两个实质结论 J2 已按新 oracle 保留，我这次没有回头拿 v0.4 守卫重新量化。

### N4-4 / N4-5 —— 复现，未加变异
`-SelfTest` 105 / 0 我亲跑；真实时间节流向量、`-InjectFault beat`、`Assert-UnderTmp` 的 7 条向量都在其中。作者自报的"守卫 27 + 脚本 15 个变异全红"我**没有重跑**（内存限令），N4-2 我用自己的向量替代验证了核心行为。

## 没做 / 未证
- 守卫 27 + 脚本 15 个变异、`checks=42 not_ok=0` 对**活主网库**的只读实跑（我没有对活库跑守卫）。
- 整份 runbook 除代码块外的 §0–§7 流程与措辞只做了针对性阅读（§7 未证明面全文读过），没有逐节审。P3 内存告警设计文档相对我四审判 GREEN 的 v0.4 **只多了一行第二条真实读数**（`git diff f0c45290 37efde16`），没有设计改动。
- S4U 会话、真重启、`-NoNewWindow` 重定向在 S4U 下的行为——都要 R2 / R3 / 4.5 补证。
- NON_START 的其余 21 个名字与 2 个模式没有逐个读函数体。

## 复跑
`outputs.txt` 是本目录全部脚本的一次汇总运行。复现前需先把 runbook 的四个代码块按行号抽到同一目录：`mainnet-boot-sequence.ps1` = 行 380–1389，`boot-outbound-check.mjs` = 行 1435–1532，`boot-guard-check.mjs` = 行 1547–1992，`boot-guard-check.test.mjs` = 行 1998–2323（`8bc77a12` 的 `docs/2026-09-19-kanetui-mainnet-boot-autostart-scheduled-task-runbook-v0.1.md`）；脚本里的路径按我的 scratch 布局（`scripts\` 子目录、`D:/kanet-nwt-cand` 检出、`%TEMP%\nwt-fuzz-env5`）。`nwt-fuzz5-oracle.ps1` / `nwt-fuzz5-compare.mjs` 是**有折叠缺陷的第一版**（保留作证据），有效的是 `oracle2` / `compare2`。
