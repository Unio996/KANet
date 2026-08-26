# NWT 红队 — start 脚本 remediation §B/§C

> 作者 NWT · 2026-08-26 · 派工 Bettor · 被审 = `docs/2026-08-26-kanet-ui-start-script-remediation-design.md`(7a4b7ad7,§B/§C)
> **总评:§B 抽公共 lib 的粒度对、两步落地(纯重构等价臂→逐条开修法)纪律对;但 Bettor 点的三处我全部实测坐实为真缺口 —— ①flock 在本机 Git-Bash 根本不存在 + mkdir 锁孤儿无人清 ②env 标志 fail-open 会静默关掉整个监工 ③heartbeat 是自报族、两向都失。§B/§C = PASS-WITH-MUST-FIX。**

---

## ① #9c pidfile 锁 — 🔴 **flock 本机不存在(实测)+ mkdir 锁孤儿死锁,比它要修的 TOCTOU 更糟**

设计 B.2 #9c:"用 `flock` on pidfile 或 mkdir 锁"。两个都有问题,且第一个直接不可用:
- 🔴 **`flock` 在本机 Git-Bash 【不存在】** `[MEASURED]`:`which flock` / `command -v flock` = **NOT FOUND**(MSYS2/Git-Bash 最小集不含 util-linux 的 flock)。⇒ **"flock on pidfile"这条路子在本机是死的**,写了也跑不起来(且 supervisor 跑在 SYSTEM 下,PATH 更可能缺)。
- **mkdir 锁可用**(`mkdir` 存在,`mkdir <dir>` 是原子的:已存在即失败)—— 是对的原语,**但设计没解孤儿**:🔴 **持锁进程崩溃/被 SIGKILL 而没 `rmdir`,锁目录永久残留 ⇒ 下一次 start 永远拿不到锁 ⇒ 永不起 supervisor。这把 TOCTOU 的"多起一个"换成了"再也起不来"—— 后者更糟**(#9c 本来要防的是 over-spawn,孤儿锁造成 never-spawn = 监工彻底缺席,正是 8/23 那类"死了没人拉")。
- **修法(须写进 #9c)**:① 弃 flock,定 mkdir 锁;② 锁目录里**写持锁者 PID**;③ **取锁失败时 stale 回收**:读锁内 PID,`kill -0` 不存在 ⇒ 判孤儿、`rmdir` 后重试;存在 ⇒ 真竞争、退让;④ **EXIT trap `rmdir`** 正常退出即清(但 trap 不接 SIGKILL,故 ③ 的 stale-PID 回收是真正的兜底,不能只靠 trap)。**没有 ③④,mkdir 锁第一次崩就把 supervisor 永久锁死。**
- 🔵 备选(更简单):不加锁,改**后验去重** —— supervisor `_run` 起手先看有没有别的活 supervisor(读 pidfile 的 PID + `kill -0`),发现自己不是唯一就退(loser exits)。省掉锁原语与孤儿问题,代价是短暂两进程并存一瞬(比孤儿死锁安全)。**二选一,但 flock 这条必须删。**

---

## ② #9b `KANET_SUPERVISED=1` — 🔴 **可继承 env 标志 fail-open:误带一次=监工静默全关**

设计 B.2 #9b:supervisor 调 headless 前 `export KANET_SUPERVISED=1`,`kanet_ensure_supervisor` 见此 flag no-op(断递归)。`[MEASURED]` 全库现无此 flag(新引入)。Bettor 问"能否被 supervisor 之外的调用者误带"——**能,而且后果是 fail-open(静默关监工):**
- **env 变量【向整个子树继承】**:supervisor→headless(=1)→headless spawn 的 console(=1)→console 的任何子进程 / 它 exec 的任何脚本,**全部继承 =1**。
- 🔴 **失效方向 = fail-open**:任何继承了 =1 的进程若跑到 `kanet_ensure_supervisor`,**no-op ⇒ 不起 supervisor**。场景:①console 或其后代因某种原因重跑一次 start 脚本(手动/自愈路径)——它带着继承的 =1 ⇒ 静默跳过起 supervisor;②**操作员 shell 里残留了 KANET_SUPERVISED=1**(上一次 session 导出没清 / profile 里手滑)→ 手动 `kanet-start.sh` **静默不起 supervisor** ⇒ **自动重启能力悄悄关闭,下次崩了没人拉 = 用这套 remediation 亲手复刻 8/23**。而且是**静默**的(no-op 不报错),没有任何东西喊"监工没起"。
- **修法**:**别用可继承 env 传"我是被监工起的"这个瞬时事实**。改用**显式参数**:`kanet-start-headless.sh --supervised`(或位置参数),只对**这一次直接调用**生效、**不随子树继承**。或 `kanet_ensure_supervisor` **正向核实调用者确实是 supervisor**(查父进程 = console-supervisor)而非信一个可继承 flag。**关键判据:传递"被监工起"这个信号的载体,作用域必须 = 一次调用,不能 = 整个进程子树。** 同族记忆 `reference-multi-flag-atomic-activation-fail-open-gap` / `feedback-config-write-verify-must-check-runtime-layer-sync`。

---

## ③ C heartbeat"活着"判据 — 🟡 **是自报族,两向都失;是改进但绝不能当重启的唯一触发**

`[MEASURED]` 现无 heartbeat 机制(launcher `:35` 盲 `Start-Process`,无判重无心跳)。Bettor 问"会不会又是自报沉默=正常那族"——**是,而且比单向更麻烦,两向都失:**
- **方向甲:fresh heartbeat ≠ 活**。若心跳由独立定时器写,进程 wedge(卡死/死循环)但定时器还在跳 ⇒ 报活。**对 Claude 会话稍缓解**(会话只在**行动时**能写文件、无真后台定时器)⇒ 崩了/真卡住确实停写(absence 大体跟踪"不再行动")。
- 🔴 **方向乙:stale heartbeat ≠ 死(承重)**。Claude 会话**只在 tool 调用间隙写**,一次长 red-team / 长 tool 调用 / 长思考**合法地几分钟到十几分钟不写**(本轮我审 E1 就 10+ 分钟没动静)。⇒ **深度工作中的 agent 看起来像死的** ⇒ 若据此重启 = **false-death → 重复拉起**(正是我机制红队 §2.3 的核心风险:同 handoff 两会话抢一个活)。
- ⇒ **裁定**:heartbeat **是改进**(比"数 claude.exe"准、且**覆盖 bypass 会话**——ListAgents 看不到它们,这是 heartbeat 的真价值),但它**是弱正信号不是活性 oracle**:fresh⇒最近还在动;stale⇒**可能死也可能在忙**。**三条硬约束(须写进 C.3):**
  1. **heartbeat 绝不作为【重启(破坏性)】的唯一触发** —— 重启前必配第二个独立信号(进程在不在 = `Get-Process`/PID 存活),两者都指向死才动手(同机制红队"三路全黑才判死")。
  2. **"判死"阈值必须 > 最长合法静默期**。Claude 会话按 tool 间隙写心跳,阈值设几分钟必误杀 —— 参照真实深度工作跨度(≥15-20 min)且宁长勿短(误判死的代价=重复拉起,远大于晚发现真死)。
  3. **写心跳是 agent 侧行为**(C.3 已认),意味着**心跳粒度天然耦合 agent 活动、不是均匀时钟** ⇒ 判据不能假设"每 N 秒必有一跳"。
- 🔵 判重(C-2)用 heartbeat 判"已在跑"**方向相反、更安全**:那里 fresh heartbeat=别开第二窗(保守拒开),即便 agent 在忙没写 ⇒ 最坏是"没判出它在跑→开了第二窗"——这退回 launcher 判重失败,但不是破坏性。所以 **heartbeat 用于"判重防双开"(C-2)比用于"判死触发重启"安全得多**;设计应把这两个用途分开定纪律,重启那侧从严。

---

## §B 其余(顺带,非阻塞)
- 🟢 **两步落地纪律对、保留**:VB-1 纯重构等价臂(迁入 lib 后进程集合/端口/log 逐项相同)先证零行为变更,再逐条 open 修法单独 diff —— 这正是"重构+改行为别混一个 diff"的正解,赞。
- 🟢 **channel-bridge :3100→:3200 并入本批**对:自愈会稳定拉起一个读错网的进程,不能只重建不改 config。
- 🔵 **一条补**:`kanet_bring_up_sidecars` 的"幂等检查"判 sidecar 在不在,若用 pidfile 存在/进程存在判 ⇒ 同 ③ 的问题(进程在但 wedge 不重建)。sidecar 自愈的"活"判据也别只看进程存在,至少看端口 LISTEN(ws-proxy :17310 / bridge 端口)。非阻塞,记一条。
- 🔵 `kanet_stop_old` 跳过 supervisor+sidecar pidfile 修 #9a 对;但注意 stop 的"跳过"表意 = 不杀,而自愈的"重建"要靠 bring_up 的幂等 —— 两者对 wedge-but-alive 的 sidecar 都不动它,若 sidecar 半死会一直半死。同 ③,记一条。

## 交付判词
| 问 | 结论 |
|---|---|
| ① #9c 锁 | 🔴 **MUST-FIX**:flock 本机实测不存在(路子死);mkdir 锁可用但设计没解孤儿 ⇒ 崩溃残留锁 = 永不起 supervisor(比 TOCTOU 更糟)。改:mkdir 锁 + PID 戳 + stale-PID 回收 + EXIT trap;或改后验去重(loser exits)。**flock 那句删。** |
| ② #9b env 标志 | 🔴 **MUST-FIX**:KANET_SUPERVISED 可继承 ⇒ 子树/污染 shell 误带 =1 ⇒ **静默不起 supervisor(fail-open,亲手复刻 8/23 无人拉)**。改:用**显式参数**(作用域=一次调用)或正向核实父进程是 supervisor,别用可继承 env 传瞬时事实。 |
| ③ C heartbeat | 🟡 **是自报族两向都失**:fresh≠活(wedge)、stale≠死(深度工作静默)。是改进(覆盖 bypass 会话、比数进程准)但非 oracle ⇒ **绝不当重启唯一触发**(配进程存活+阈值>最长合法静默≥15-20min);"判重防双开"用途(C-2)安全,"判死触发重启"用途从严,两者分开定纪律。 |

**总 verdict:§B/§C = PASS-WITH-MUST-FIX。** 架构(抽 lib)、两步落地、channel-bridge 并批都对;三处必改(①flock删+mkdir孤儿回收 ②env标志改显式参数 ③heartbeat非重启唯一触发+阈值)。改完可进 Owner 方向决。**C 的 H3a(活进程持旧路径副本,搬家后须显式广播重 arm + 杀孤儿 monitor)设计已认,保留 —— 它和 ③ 同源:活进程状态不随文件搬家刷新。**

## 附:复核命令(只读)
- `command -v flock`(NOT FOUND,本机 Git-Bash 无)
- `grep -rn KANET_SUPERVISED .`(新 flag,全库现无)
- `ls logs/heartbeat-*.json`(现无 heartbeat 机制)
- `grep -n Start-Process _bettor_launch_agents.ps1`(:35 盲开窗,无判重无心跳)
