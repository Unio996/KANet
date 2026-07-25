# B0-O1 / B0-O2 — live-fix package【设计稿】

- 作者:KANet-UI(TN 运营者会话),派工人 Bettor
- 时间:epoch **1785014042**(= 2026-07-25T21:14:02Z UTC / 宿主本地 UTC+7 为 2026-07-26)
- 前置:`2026-07-25-B0-O1-O2-first-evidence-snapshot.md`(上一轮 KANet-UI 只读取证,已结束)
- 🔴 **本文件是 package 的设计稿,不是改动本身。本轮零 live 动作。**

---

## 0. 边界声明(先说没做什么)

本轮**只做**:只读代码/配置/日志、只读 SQLite(`readonly:true`)、Win32/MSYS 双命名空间只读查询、离线分析、写本文件。

本轮**没做**(硬边界,逐条点名):

| 禁止项 | 本轮状态 |
|---|---|
| 改任何生产代码 | 未改。主仓 `D:/kanet-tn12` 零写入 |
| 重启 / kill 任何进程 | 未做 |
| 改 env | 未改 |
| 动 arm/unarm | 未动 |
| 触发任何脚本 | 未触发(下文所有"验证"步骤均为**待执行清单**,不是已执行记录) |
| 主仓 git 写操作 | 未做。本文件提交在 `D:/kanet-coord-docs` 独立仓 |

**没有撞到"必须动一下才知道"的阻塞** —— 本轮全部结论都用只读手段拿到了。有 3 处只能靠 live 才能定论的,列在 §7 未决,**没有用推断替代**。

---

## 1. 证据基线(我这一轮独立复核了什么)

证据等级:【实读】= 我本轮亲自读了那个文件那几行;【实跑】= 我本轮亲自跑了只读命令拿到输出;【推论】= 从前两者推,标出可证伪判据;【转述】= 别人读的,点名是谁。

### 1.1 独立复核通过(全部【实读】/【实跑】)

| # | 事实 | 等级 | 手段 |
|---|---|---|---|
| E1 | `relay_nodes` 总 **32** 行,`address IS NOT NULL AND (mnemonic_encrypted IS NOT NULL OR privkey_encrypted IS NOT NULL)` 命中 **32** 行 ⇒ monitor 的 eligible 集 = 全部 relay | 【实跑】 | readonly better-sqlite3 COUNT |
| E2 | `relay-health-monitor.js` 全文 115 行,**零处**出现 intentional / stopped / enabled / desired 语义 | 【实读】 | 全文读 |
| E3 | `_restartHistory` 是模块级 `new Map()`(:20),随 console 进程生灭 | 【实读】 | :20-34 |
| E4 | `_recordRestart` 只在 `result?.ok` 为真时调用(:72-73);失败的 attempt **不进预算** | 【实读】 | :69-84 |
| E5 | console 重启是自动链:supervisor `console_alive()` 连续 3 次假 → `restart_console()`(:127)→ `bash kanet-start-headless.sh`(:94)→ headless:129 起新 console | 【实读】 | supervisor.sh:74-134 + headless:129 |
| E6 | `kanet-start.sh:62` 有 `if [ "$name" = "console-supervisor" ]; then continue; fi`;`kanet-start-headless.sh:64-72` **无**该行,且 :71 `rm -f "$pidfile"` 在 `kill -0` 为假时**照样执行** | 【实读】 | 两文件对读 |
| E7 | headless:149-158:pidfile 不在 **或** `kill -0` 假 ⇒ `bash "$SUPERVISOR_SCRIPT" start` | 【实读】 | :149-158 |
| E8 | `kanet-start.sh:407` **无条件** `bash kanet-console-supervisor.sh start`(不看哨兵不看任何条件) | 【实读】 | :402-407 |
| E9 | `logs/pids/` 8 个文件,MSYS 侧 7 个 `kill -0` 全成立、Win32 侧这 7 个号**全不存在**;`scout.pid`=26500 反过来(MSYS 不存在,Win32 存在且是 node) | 【实跑】 | bash `kill -0` ×8 + PowerShell `Get-Process` ×8 |
| E10 | `console.pid` 240379 → WINPID **40232** = console node 本体 ✅;`console-supervisor.pid` 229331 → WINPID **24564** = bash `_run` = 服务本身 ✅;`owner-bot.pid` 240399 → WINPID **37156** = bash `kanet-start.sh`,而业务进程是 node `_launch_owner_bot.mjs`(Win32 **29468**),父链 29468→39068→37156 ⇒ **记的号在业务进程两层之上** ❌ | 【实跑】 | `ps -W` 双列 + `Win32_Process` 父链 |
| E11 | console(Win32 40232)的 `ParentProcessId` = 35748,而 35748 的 `ParentProcessId` = 40232 ⇒ **该宿主上 pid 复用已经真实发生过** | 【实跑】 | Win32_Process 全表 |
| E12 | `scripts/health-monitor.mjs` 在**全仓零引用**(grep `health-monitor\.mjs` 无匹配) | 【实跑】 | Grep 全仓 |
| E13 | `health_heartbeats` 0 行、`health_alert_log` 0 行、`logs/health-monitor.log` 不存在 | 【实跑】 | readonly COUNT + `ls` |
| E14 | live `kanet.env`:`KANET_ROOT=D:/kanet-tn12`(行 21)、`PORT=3200`(行 25) | 【实跑】 | grep 两个键(未读密钥行) |
| E15 | live DB 迁移态 = **v193 已到**(v190 建表 / v191 `source_scope` 列 / v192 `pilot_rate_limit_log` / v193 `access_mode` 列 四项全在) ⇒ 无 migration 滞后 | 【实跑】 | sqlite_master + PRAGMA table_info |
| E16 | `configs` 表**不存在**,配置真表名是 `config_entries`(`configs.js:7`) | 【实跑】+【实读】 | sqlite_master + 读源码 |
| E17 | `adapter_nodes` 有 `is_enabled INTEGER` 列;`relay_nodes` 38 列**没有**任何 enabled/desired_state 类列 | 【实跑】 | PRAGMA table_info ×2 |
| E18 | 全仓 `startRelay(` 调用点 = **6 个**(见 §2.3 清单) | 【实跑】 | Grep 全 src |
| E19 | **没有** per-relay stop 端点。`api/relay.js` 只有 `/restart`(:164),`stopRelay` 全仓仅 3 处引用(定义 :145 / `stopAll` :199 / restart 端点 :168) | 【实跑】 | Grep |
| E20 | tg-bot 样板的持久化**不在** `tg-bot-manager.js` 里,而在 `api/settings.js:187`(start 后写 `'1'`)/ `:193`(**先**写 `'0'` **再**调 `stopTgBot()`) | 【实读】 | settings.js:184-195 |
| E21 | `health-monitor.mjs:23` 的 `BROADCAST_RELAY='3765cc82-5e20-4e61-bb0a-697277287223'`(Martin J1)在**本节点 `relay_nodes` 中不存在** | 【实跑】 | readonly SELECT by id |
| E22 | `chat.js:34` `COORD_CHANNELS` 已含 `kanet-alert`;`:226` 对 coord 频道做 `OPUS_RELAY_NAMES` 白名单 403 拦截 | 【实读】 | chat.js:30-56, 213-234 |
| E23 | 本机 `adapter_nodes.http_port` 只有 **3031**(1 个);`health-monitor.mjs:45/90-99` 硬编码探 **3018** | 【实跑】+【实读】 | GROUP BY + 读源码 |
| E24 | 宿主**没有**任何 KANet 相关计划任务;自启动是 Startup 文件夹 `KANet-TN12-BootSequence.lnk`(At-logon) | 【实跑】 | `Get-ScheduledTask` 过滤无命中 + Startup 目录列表 |

### 1.2 🔴 本轮新增的硬证据(把 O1-D1 和 O1-D7 焊成一条因果链)

`logs/console-supervisor.log` 全文统计【实跑】:

- `Console death detected` 共 **38** 次
- 最后一次 `Console restarted OK` = **2026-07-07T03:36:04Z**,与 `console-supervisor-restarts.log` 最后一行 **epoch 1783395364** 逐字对上
- 在那之后,`Console death detected` 又发生 **11** 次(7/18 23:38 / 7/19 ×3 / 7/20 ×4 / 7/21 07:37 / 7/24 20:38 ……),**"Console restarted OK" 与 restarts.log 都是 0 条新增**
- 这 11 次里,`Console death detected` 之后 4~11 秒必跟一行 `supervisor start pid=<新号>`(7/20 07:10→07:10:34、7/20 07:26→07:26:33、7/21 07:37:46→07:37:57、7/24 20:38:18→20:38:23)
- 当前活着的 supervisor pid = **229331**,正是 7/24 20:38:23 那一行的号,pidfile mtime epoch **1784925503** 与之吻合

**判读【推论,给可证伪判据】**:
supervisor(:94)同步调用 headless → headless 的 pid 循环(:65-72)把 `console-supervisor.pid` 一并 `kill` + `rm` → **headless 杀掉了自己的父进程** → supervisor 永远走不到 :96-99 的 `console_alive` / `Console restarted OK` / `record_restart` → headless:150 检查 pidfile(已被自己删)为假 → :155 起一个**全新** supervisor。

推论的三条可证伪判据(任一不成立则推论错):
1. 若 7/07 之后某次 death-detected 后出现过 `Console restarted OK` ⇒ 推论错。**实测 0 次**,一致。
2. 若 `supervisor start pid=` 与前一行 death-detected 的间隔不在 headless 的执行时长量级 ⇒ 推论错。**实测 4~11s**,一致。
3. 若 headless 的 pid 循环对 MSYS 号 `kill -0` 不成立 ⇒ 推论错。**实测 229331 在 MSYS 侧 alive**(E9),一致。

**这条因果链的后果比 O1-D1 原描述更重**:不只是"停 supervisor 会被撤销",而是
> **`count_recent_restarts()`(supervisor.sh:81-85)结构性恒返回 0 ⇒ restart-storm 保护(:123 `recent >= RESTART_MAX_IN_WINDOW`)自 7/07 起从未可能触发一次。** 而且每次自愈都换一个新 supervisor 进程 ⇒ `consecutive_fail` / `in_cool_down_until` 两个局部变量也一并归零。**三重风暴保护同时失效,原因都是同一个 pid 循环。**

### 1.3 我**没有**独立复核、属【转述】的部分

- 「7/24 那一次是 relay 反复挂拖挂了 console」的**因果**:上一轮 KANet-UI 会话 + NWT 红队④的判断。**我本轮只复核到"7/24 20:38 确有一次 death-detected"(实跑),没有复核死因。** 我不为死因背书。
- 「红队④ 成环:relay 反复挂 → 拖挂 console → 自愈重启 → 限流器归零 → 32 个 relay 可无限重启」:环的**每一段机制**我都独立复核了(E1/E3/E4/E5),但**这个环在 live 上真跑起来过**这件事我没有证据(需要日志里 relay-health 的 restart 计数,我本轮未查 console.log)。⇒ 我按"机制上成立"设计,不按"已发生"设计。

### 1.4 🔴 对派工书里一处描述的更正(必须先更正才能"照抄样板")

派工书写:「`tg-bot-manager.js:104 / :145` 有 `_intentionalStop` 且**跨重启持久化**」。

实读(E20)是**两半分居两处**:
- `_intentionalStop`(:27 声明 / :68 清零 / :83 读 / :98 读 / :106 置位)= **纯内存**,console 一重启就没。
- 跨重启的那一半 = `config_entries` 里的 `tg_bot_enabled`,由 **`api/settings.js:187/193` 这两个路由**写,`tg-bot-manager.js:154` 在 boot 时读。

⇒ **要照抄的是 `settings.js:193` 那一半,不是 `tg-bot-manager.js:27` 那一半。** 抄错半边 = 抄回同一个 bug。
⇒ 另外 `settings.js:193` 的**顺序**值得原样抄:**先 `setConfig('0')` 再 `stopTgBot()`**。反过来会留一个"已停但意图未落盘"的窗口,正好够 30s tick 抢先拉回。**顺序是设计的一部分。**
⇒ 但样板有一处**不能**抄:它把闸装在**调用点**(`startTgBotIfConfigured` 查 flag,而 `startTgBot()` 自己不查)。tg-bot 只有 2 个调用点还能守住;relay 有 **6 个**(E18),逐点守必漏。⇒ 见 §2.2 的分歧设计。

---

## 2. 【优先级 1】O1-D3 + 红队④ —— relay 自愈闸 + 限流器解耦

### 2.1 缺陷复述(每条都带坐标)

| 编号 | 缺陷 | 坐标 |
|---|---|---|
| D3-a | 30s tick 无差别扫 32/32 个带密钥 relay,不活即 `startRelay` | `relay-health-monitor.js:49-70`,E1 |
| D3-b | 代码中不存在 intentional-stop 概念 ⇒ 手动停任一签名 relay,最多 30s 被拉回 | E2 |
| D3-c(红队④) | 预算 `_restartHistory` 是进程内存 Map,console 重启即归零;而 console 重启是自动的 | E3 + E5 |
| **D3-d(本轮新增)** | `_recordRestart` 只记**成功**的重启(:72-73)⇒ 预算只限得住"能起来的",**限不住"起不来的"**;而"起不来的"才是每 30s 无限重试那一类 | E4 |
| **D3-e(本轮新增)** | `isRelayAlive` 假(如 `lastLogAt` 陈旧 >60s,:229)但 `_relays[id].child` 还在 ⇒ `startRelay` 立刻返回 `already_running`(:29-31)⇒ **既没重启也没计数,每 30s 空转一次,永远修不好** | relay-manager.js:29-31 + :222-231 |
| D3-f | 今天**根本没有** per-relay 停止端点(E19)⇒ "operator 手动停 relay" 目前只能靠外部杀进程,而外部杀完 monitor 必拉回 | E19 |

### 2.2 设计

**FIX-1 意图持久化(落盘,不落内存)**
- `relay_nodes` 加列 `desired_state TEXT NOT NULL DEFAULT 'running'`,取值 `'running' | 'stopped'`。
- migration **v194**(代码 head = v193,live DB 也已到 v193,E15 ⇒ 接 v193 之后无缝)。
- 为什么用列不用 `config_entries`:32 个 relay 的 per-entity 状态放 KV 会造 32 个魔法 key,且没有外键约束;`adapter_nodes.is_enabled`(E17)已是同款先例。
- 幂等:ALTER 前查 `PRAGMA table_info`(照 v191 的写法)。

**FIX-2 闸装在收敛点,不装在调用点**
- 改 `startRelay(relayNodeId, opts = {})`,函数体最前面:
  - 读 `desired_state`;若 `=== 'stopped'` 且 `opts.reason !== 'operator'` ⇒ 直接 `return { ok:false, reason:'intentionally_stopped' }`,**不 fork、不写 identities**。
  - 位置必须在 :44-55 那段"注册 local identity"**之前** —— 那段有 DB 写副作用,闸在它后面 = 每 30s 仍在写库。
- 这是对 tg-bot 样板的**有意分歧**:样板把闸装在 boot 调用点,relay 有 6 个调用点(E18),逐点守 = 下一个新调用点必漏。**闸的强度在调用点** ⇒ 所以把所有调用点收敛成"必经 startRelay"这一个点。

**FIX-3 停止路径必须存在,且先落盘后动手**
- 新增 `POST /api/relay/:id/stop`:
  1. `UPDATE relay_nodes SET desired_state='stopped'`
  2. 再 `await stopRelay(id)`
  - 顺序照抄 `settings.js:193`(E20)。反序 = 留窗口。
- 现有 `POST /api/relay/:id/restart`(:164)与 `/relays/:id/assign`(:155)的语义分工必须显式定死:
  - `/restart` = operator 显式意图 ⇒ 先 `desired_state='running'` 再调 `startRelay(id,{reason:'operator'})`
  - `/assign` = 意图是"分配 adapter",**不是**"我要它跑" ⇒ **不解除** stopped,走普通闸

**FIX-4 限流器不与被限对象同生共死**
- 新表(同 v194)`relay_restart_log(id INTEGER PK AUTOINCREMENT, relay_node_id TEXT, ts_epoch INTEGER, outcome TEXT, initiator TEXT)`,`outcome ∈ {started, failed, already_running, blocked_intentional, blocked_budget}`。
- `_restartHistory` Map 删除;预算判据改为
  `SELECT COUNT(*) FROM relay_restart_log WHERE relay_node_id=? AND ts_epoch >= ?`(窗口 = now_epoch − 3600)。
- **记账口径同时修 D3-d**:**每一次 attempt 都写一行**(含 failed / already_running),不只记 started。
- **为什么这样就解了红队④**:console 重启后新进程读的是**同一个 `console.db`**(headless:128 `DB_PATH="$CONSOLE_DIR/data/console.db"` 固定,【实读】),预算窗口跨重启连续 ⇒ "重启 → 归零 → 再来 32 个" 这一环被打断。
- 🔴 **诚实标注残留耦合**:这不是"消除耦合",是**把耦合下移一层** —— DB 文件与 console 同宿主同磁盘;整树搬迁 / 换 DB 文件 / DB 损坏,预算同样归零。彻底解只有把预算放到宿主之外,那要跨主机基建(§4 出口 3 同一件事)。**本 package 不假装解决了它。**

**FIX-5 D3-e 只加 tripwire,不改行为**
- `already_running` 这条分支目前被计成 `errored`(:77-79),看不出来。改成单独 outcome 写进 `relay_restart_log`,**行为一个字不改**。
- 理由:D3-e 的正解是"先 stopRelay 再 start",但那会让 monitor 变成**主动杀 relay 的东西**,风险等级完全不同,且它今天是 working code。族纪律:**同 bug 族只修 confirmed-broken,working 代码先加 tripwire**。先取证一周,再单独开卡。

### 2.3 `startRelay` 调用点清单(必须逐个点名,不许"应该都覆盖了")

| # | 坐标 | 性质 | 过闸后行为 |
|---|---|---|---|
| 1 | `services/relay-health-monitor.js:70` | 30s 自愈 | 被闸 ⇒ 写 `blocked_intentional` |
| 2 | `services/relay-manager.js:185`(`startAll`,console boot) | 自动 | 被闸 |
| 3 | `api/relay.js:155`(`/relays/:id/assign`) | 半自动 | 被闸(意图是 assign 不是 start) |
| 4 | `api/relay.js:170`(`/api/relay/:id/restart`) | operator 显式 | 先置 running,`reason:'operator'` 放行 |
| 5 | `api/relay.js:1705`(onboarding 建号后立即起) | 新建 | 新行 default `'running'`,天然放行 |
| 6 | `services/system-repair.js:224`(`restart_relay_*` 自动修复) | 自动 | 被闸 |

### 2.4 改什么 · 怎么回滚 · 装载后怎么验

**改什么(文件级清单)**
1. `kasia-console/src/db/migrate.js` — 追加 v194(加列 + 建表,幂等)
2. `kasia-console/src/services/relay-manager.js` — `startRelay` 签名 + 闸(≈8 行)
3. `kasia-console/src/services/relay-health-monitor.js` — Map → 表,每次 attempt 记账(≈25 行)
4. `kasia-console/src/api/relay.js` — 新增 `/stop`,`/restart` 置 running(≈15 行)
5. `docs/DATABASE.md` — 新列 + 新表同步(改表必同步文档,项目硬规)

**怎么回滚**
- 代码:单 commit ⇒ `git revert` 一次到底。**回滚后必须重启 console 才生效**(commit ≠ live:这几个模块是长驻进程 import 的,记忆里已有这条族)。
- DB:**不回滚**。加列(有 DEFAULT)+ 建新表都向后兼容;旧码不读 `desired_state` = 完全旧行为。**回滚顺序 = 只回码,不动 DB。**
- 应急降级:`RELAY_INTENTIONAL_STOP_ENFORCE`。⚠️ 必须 **default-deny 方向**:未设 / 设任何值 ≠ `'0'` 都算启用;只有显式 `='0'` 才降级为 no-op,且降级时 **每 tick loud warn**。
  ⚠️ 已知坑:env 值行尾加注释会被当成值的一部分导致 `=== '0'` 判定为假 —— 这里方向是**安全**的(判不出 '0' ⇒ 保持启用),属于 fail-closed,可接受。但**验证时必须读 runtime 值不能读 env 文件**。

**装载后怎么验(负测试形态 —— 没有这几条就等于没验)**

| # | 形态 | 步骤 | 断言 |
|---|---|---|---|
| N1 | **负测试(本体)** | 对一个**非钱路** relay 调 `/api/relay/:id/stop`,记 t0=now_epoch,等到 now_epoch ≥ t0+70(≥2 个 tick) | `isRelayAlive` 仍假 **且** console.log 该 relay 无 `auto-restart attempt` 行 **且** `relay_restart_log` 有 `blocked_intentional` 行 |
| N2 | **负测试(跨重启,这条才是"持久化"的判据)** | N1 之后走正规路重启 console,等 grace 90s + 2 tick(t1+160s) | 仍未被拉起。**只验 N1 = 只验了内存标记,不算过** |
| N3 | **负测试(限流器不归零)** | 制造 3 次 attempt,重启 console,**直接查表** | `SELECT COUNT(*) FROM relay_restart_log WHERE ts_epoch>=now-3600` ≠ 0。🔴 判据必须是**读那张表本身**,不许读进程内计数或 `getStatus()` —— 读副本 = 没验 |
| N4 | **正测试(防闸装死)** | `/api/relay/:id/start`(或 `/restart`) | `desired_state='running'` 且进程真起来。少这条 = 可能造出"停得下再也起不来" |
| N5 | **覆盖边界测试** | 对 §2.3 的 6 个调用点**逐个点名**核 | 每个点要么被闸要么显式 operator 放行;**不接受"grep 了一遍应该都覆盖"这种聚合判据** |
| N6 | **降级开关反向测试** | 设 `RELAY_INTENTIONAL_STOP_ENFORCE=0` 重启,再跑 N1 | 这次**应当**被拉回 + 有 loud warn。证明开关真接线,不是装饰 |

---

## 3. 【优先级 2】O1-D1 / O1-D6 —— 两脚本对齐 + stop-sentinel

### 3.1 缺陷复述

| 编号 | 缺陷 | 坐标 |
|---|---|---|
| D6 | headless:64-72 无差别 kill+rm 所有 `*.pid`,**不排除** `console-supervisor.pid`;`kanet-start.sh:62` 排除 ⇒ 两脚本漂移 | E6 |
| D1 | headless:149-158 pidfile 不在/不活 ⇒ 重起 supervisor ⇒ "停 supervisor" 被任一次 console 重启撤销 | E7 |
| **D1-b(本轮实测升级)** | 上面两条合起来 = **headless 杀掉自己的父 supervisor 再另起一个**,导致 `record_restart` 结构性漏记,**风暴保护三重同时失效** | §1.2,11 次实测 |
| **D2(必须一起改,否则白改)** | `kanet-start.sh:407` **无条件** re-arm supervisor —— 与 headless:158 是**同一个语义漏洞的第二条路径** | E8 |

🔴 只堵 headless:158 而不堵 kanet-start.sh:407 = 没堵。**闸的强度在调用点,两个调用点都要过闸。**

### 3.2 设计

**FIX-A 排除逻辑对齐**
- headless 的 pid 循环里,在 `pid=$(cat "$pidfile")` **之前**加:
  `name=$(basename "$pidfile" .pid); if [ "$name" = "console-supervisor" ]; then continue; fi`
- **必须连 `rm -f` 一起跳过** —— `kanet-start.sh:57-61` 的注释已经把理由写死了:"进程没杀但 pidfile 被删"是更隐蔽的坏状态(会让 supervisor 自己的存活检查误判、拉起第二个实例)。照抄它的位置,不要只跳 kill。

**FIX-B 机制化,不靠记性**
- 这条已经漂移过一次(`kanet-start.sh:62` 修于 2026-07-17,headless 没跟)。同一个病第二次发生前必须上机制。
- 建议:给 `scripts/lint-kanet.mjs` 加一条规则 —— **两个 start 脚本里 pid 排除清单必须逐字相同**,不同即 block commit。
- 不建议抽 `scripts/lib/*.sh` 共享文件:两个脚本都要加 source 行 = 扩大改动面到启动路径本身,收益不抵风险。**lint 卡点是更便宜的同效手段。**

**FIX-C stop-sentinel(盘上哨兵)**
- 文件:`logs/pids/console-supervisor.stop`,内容一行:`<epoch秒> <谁停的> <原因>`。
- 三个 re-arm 点全部受它门控:
  - `kanet-start-headless.sh:150` — 哨兵在 ⇒ 打印 `[supervisor] stop-sentinel present — NOT re-arming` 并跳过
  - `kanet-start.sh:407` — 同上
  - `kanet-console-supervisor.sh` `start` 子命令(:138-152)— 同上(第三道,防有人直接调它)
- `stop` 子命令(:156)⇒ **写哨兵**,然后才 kill。(又是"先落盘后动手")
- `start` 子命令 **不自动删哨兵**。删只能靠新增的显式 `arm` 子命令或人手 `rm`。**default-deny 方向:任何脚本顺手调 start 都不许抹掉 Owner 的意图。**
- `status` 子命令 ⇒ 哨兵在时输出 `STOPPED BY SENTINEL since <epoch>`,不许只报 `supervisor dead`(否则"被 Owner 停的"和"自己死的"两态看起来一样)。

**🔴 FIX-C 的反向风险(必须写进设计,不许只写好处)**
哨兵是 **fail-closed**:它在,console 死了 supervisor 就不会回来 = **失去自愈**。误留一个哨兵 = 静默丧失自愈能力,而现象是"一切正常直到出事"。
缓解(缺一不可):
1. `status` 显式区分两态(上一条)
2. 哨兵纳入 §4 health-monitor 的 watch keys:哨兵存在超过 N 小时 ⇒ WARN 告警
3. 哨兵内容含 epoch + 人 + 原因,让"谁什么时候为什么停的"可取证

**FIX-D(建议但不塞进本包)** `record_restart` 漏记的根治
FIX-A 一旦生效,supervisor 不再被自己的子进程杀 ⇒ :96-99 应当能执行到 ⇒ 风暴计数恢复。**这是 FIX-A 的自然结果,不需要另改代码。** 但它同时是 FIX-A 是否真生效的**最佳判据**(见 N9)。

### 3.3 改什么 · 怎么回滚 · 装载后怎么验

**改什么**
1. `kanet-start-headless.sh` — 排除 1 行 + 哨兵门控 ~3 行
2. `kanet-start.sh` — :407 哨兵门控 ~3 行
3. `scripts/kanet-console-supervisor.sh` — `stop` 写哨兵 / `start` 查哨兵 / `status` 区分 / 新增 `arm` 子命令,~15 行
4. `scripts/lint-kanet.mjs` — 新规则 1 条
5. `.gitignore` 核一下 `logs/pids/*.stop` 不入库

**怎么回滚**
- 三个 shell 脚本纯文本 ⇒ `git revert` 即回。
- 🟢 **本项的优点值得点名:回滚不需要重启任何进程** —— shell 脚本是每次被调用时才读的,revert 落盘即生效(与 §2 的 console 模块不同)。
- 哨兵语义回滚 = `rm logs/pids/console-supervisor.stop`。
- ⚠️ 注意 lint 新规则是"commit 即生效"型 deploy(接主入口),按项目纪律它也算 deploy,要一起进 NWT verdict,不能当"只是个 lint"。

**装载后怎么验(负测试形态)**

| # | 形态 | 步骤 | 断言 |
|---|---|---|---|
| N7 | **负测试(哨兵拦得住)** | 写哨兵 → 跑一次 `kanet-start-headless.sh` | supervisor **没被拉起**(`status` = STOPPED BY SENTINEL),且 console 正常起来 |
| N8 | **负测试(哨兵没装死)** | 删哨兵 → 再跑 headless | supervisor 被拉起。防"停得下再也起不来" |
| N9 | **负测试(D6 本体,唯一直接判据)** | 记下 supervisor MSYS pid `p0` 与 epoch t0 → 跑一次 headless → 再读 | pid **仍等于 p0**。旧行为下必然变号。**这条是"排除逻辑生效"的唯一直接判据** |
| N10 | **负测试(D1-b 因果验证)** | N9 之后查 `console-supervisor-restarts.log` | 出现 ts_epoch > t0 的**新行**。若仍无新行 ⇒ §1.2 的因果推论被证伪,必须回头重查 |
| N11 | **负测试(第二条路径)** | 写哨兵 → 跑 `kanet-start.sh`(不是 headless) | supervisor 仍未被拉起。**只测 headless 不测 kanet-start = 漏了 D2 那条路** |

🔴 N7–N11 **每一条都要真跑启动脚本 = 会重启 console**。它们全部是 live 动作,**本 package 只列不执行**,需要单独授权 + 停机窗口 + 停机前 in-flight 检查(状态型 + 定时器型两类都要枚举,尤其是会周期性广播链上 tx 的 cron)。

---

## 4. 【优先级 3】O2-D1 —— health-monitor 属主 / 挂载 / 心跳 / 日志 / 告警出口

### 4.1 现状(全部【实跑】/【实读】)

`scripts/health-monitor.mjs` 是**死代码**:全仓零引用(E12)、两表 0 行、日志文件不存在(E13)。
⇒ 一个重要推论:**改这个文件的 blast radius 目前是 0**,直到它被挂载那一刻为止。这使 P3 成为三项里**代码风险最低**的一项 —— 但它的**宿主配置**改动(计划任务)风险不为 0。两者必须分开审。

已知常量缺陷,**比"两行"多**:

| 编号 | 缺陷 | 坐标 | 是否"改个常量"能解决 |
|---|---|---|---|
| O2-D4 | `KANET_ROOT` 缺省 `'D:/Anthropic'` = 错树 | :12 | 部分。见 FIX-G |
| O2-D2 | `CONSOLE_URL` 硬编码 `127.0.0.1:3100`,live 是 3200(E14) | :24 | 是,但应派生不应硬编码 |
| **O2-D2b(本轮新增)** | `BROADCAST_RELAY` UUID 在本节点 `relay_nodes` **不存在**(E21) ⇒ 即使端口改对,`chat.js:220-221` 也会 404 `Account not found`,**唯一外发路径仍然是断的** | :23 | **不是**。换个 UUID 还要同时满足 `OPUS_RELAY_NAMES` 白名单(E22),否则 :226 403 |
| O2-D3 | `lan-ip-health` 依赖从不存在的 `logs/lan-ip-health.log` | :44, :77-88 | 见 FIX-H |
| **O2-D3b(本轮新增)** | `adapter-3018` 硬编码 3018,本机 adapter 实际端口 **3031**(E23) ⇒ 上线即恒 FAIL,且它 severity 是 **CRITICAL** | :45, :90-99 | 是,但同样应派生 |

🔴 O2-D3 + O2-D3b 合起来的危害不是"多两条噪声":**5 个 watch key 里 2 个恒 FAIL,其中一个是 CRITICAL** ⇒ 上线第 2 个 tick 就开始告警,一小时打满 `HARD_CAP_PER_HOUR=5` ⇒ **真告警会被自己的噪声挤掉**(:120-126 的 hard cap 不区分 alert_key)。噪声不是体验问题,是**把出口做废**。

### 4.2 设计:属主 = 独立进程 + Task Scheduler「At startup」

| 候选属主 | 判 | 理由 |
|---|---|---|
| 塞进 Console(import 起 cron) | ❌ | console 是它要监的对象之一。同生共死 ⇒ 判别式「它死了谁会说」答案是"没人",直接不过 |
| 挂 `kanet-start.sh` | ❌ | 它起的进程会被 headless:65-72 的 pid 循环杀掉(除非再加一条排除);而 headless 由 supervisor 调 ⇒ **每次 console 自愈都会波及监控者** |
| Startup 文件夹 .lnk | ❌ | 现状自启动就是 At-logon(E24)。未登录/锁屏重登都影响。**监控者必须比被监控者更早、更独立** |
| **Task Scheduler,At startup,独立任务 `KANet-HealthMonitor`** | ✅ | 与 console/supervisor/启动脚本三者**无父子关系、无共同启动机制** |

- 工作目录 / env:任务显式传 `KANET_ROOT=D:/kanet-tn12`,**不依赖 kanet.env 被谁 source**。
- 🔴 这是一次**宿主级配置变更**(新建计划任务),不在任何 git diff 里 ⇒ 必须**单列一条**给 Owner/NWT 过,并附卸载步骤 `Unregister-ScheduledTask -TaskName KANet-HealthMonitor -Confirm:$false`。

**心跳写哪(两处,互为独立判据)**
1. 盘上 `logs/health-monitor-heartbeat.txt`,内容 = epoch 秒。形态照抄 `index.js:486-489` 的 console 心跳,判新鲜照抄 `supervisor.sh:67-72` 的 `heartbeat_fresh`(**复用已被审过的形态,不发明新的**)。
2. DB `health_heartbeats` 加一行 `key='health-monitor-self'` —— 该表已存在(E13),**不需要 migration**。

**日志写哪**
- `logs/health-monitor.log`(:16 已定义,`KANET_ROOT` 修好后自然落到 `D:/kanet-tn12/logs/`)+ Task Scheduler 的 stdout 重定向到同一文件。
- 🔴 必须加**截断/轮转**:现状 :32 是 `flag:'a'` 无上限,1min tick 会无限长。宿主上已经出过"日志把盘写满 0 字节阻断全队"的事故(`kanet-start.sh:24-28` 的注释)。**不加轮转就是重演。**

### 4.3 🔴 告警出口(红队硬要求:出口不许经过 monitor 自身)

判别式:**「如果它死了,谁会说?」** 答案是"它自己"或"没人" ⇒ 不算过。逐条过:

| 出口 | 覆盖什么 | 「它死了谁会说」 | 判 |
|---|---|---|---|
| **出口 1 — 业务告警** monitor → Console `/api/chat/send` → `kanet-alert` 频道 | "被监控对象坏了" | monitor 死了 ⇒ **没人**。 | 单独 ❌,作为业务出口 ✅ |
| **出口 2 — 对侧超时判据** Console 侧新增 30s cron `health-monitor-watchdog`,读 `logs/health-monitor-heartbeat.txt`;`now_epoch − mtime > 180` ⇒ **由 Console** 发 `kanet-alert` | "monitor 自己死了" | **Console 会说**。而 Console 与 monitor 由两套不同机制启动(kanet-start/supervisor vs Task Scheduler)、互不为父子 | ✅ 对 monitor 单点死 |
| **出口 3 — 跨主机 beacon** 本机每 15min 往 `kanet-alert` 发一条正向 beacon(含 epoch);**第二主机**(J1 侧,`OPUS_RELAY_NAMES` 已有 `J1tn-Alice/Bob/Carol/Dave`,E22)设"超过 45min 没见到 beacon 就喊" | "两个都死 / 整机断电 / 断网" | **另一台主机会说** | ✅ 唯一真正的对侧 |

🔴 **总判**:单主机内的**任何**组合都无法回答"整机死了谁会说" ⇒ **出口 3 是必需项,不是加分项**。
但出口 3 需要第二主机配合 = 跨 agent 协调。**本 package 只定义协议**(beacon 文本格式 + 缺失阈值 45min + 谁负责判),**落地要 Bettor 派给 J1**。若只上出口 1+2 就宣称满足红队要求 = 字面为真但省略了对自己不利的那半。

**反循环保护(出口自身的失败不许静默)**
- 出口 1/2 发送失败时**必须落盘** `logs/health-alerts/<epoch>.json`。现状 :155 只 `log()` 一行就吞掉了 ⇒ console 死时告警**连痕迹都不留**。
- 落盘目录也要有上限(同 §4.2 轮转理由)。

### 4.4 常量与 watch key 修正(🔴 属主定下来之后才做,顺序不许颠倒)

| 项 | 改法 | 理由 |
|---|---|---|
| `KANET_ROOT`(:12) | **删掉 `'D:/Anthropic'` 默认值**,改成缺失即 `process.exit(1)` + loud | 改成 `D:/kanet-tn12` 只是把错默认换成对默认;**默认值本身就是这个 bug 的形态** —— 静默指向另一棵树的 DB 比崩溃危险得多 |
| `CONSOLE_URL`(:24) | 从 `kanet.env` 的 `PORT` 派生 | `supervisor.sh:39-44` 已有现成做法,复用不发明 |
| `BROADCAST_RELAY`(:23) | 不硬编码 UUID。按 name 在**本机** `relay_nodes` 查,且 name 必须 ∈ `OPUS_RELAY_NAMES`;查不到 ⇒ 降级落盘 + loud,**不静默** | E21+E22:换 UUID 不够,还有白名单闸 |
| `adapter-3018`(:45,:90-99) | 端口从 `adapter_nodes.http_port` 查(本机 3031,E23) | 硬编码端口同族 |
| `lan-ip-health`(:44,:77-88) | 该日志从不存在 ⇒ **先整条移除**(或改成"日志不存在 = SKIP 不是 FAIL") | 恒 FAIL = 噪声 = 把出口做废 |
| `HARD_CAP`(:22-24,:120-126) | cap 改成 **per alert_key**,不是全局 | 否则一个坏 key 能把全部真告警挤掉 |

### 4.5 改什么 · 怎么回滚 · 装载后怎么验

**改什么**
1. `scripts/health-monitor.mjs` — 常量派生化 + watch key 修正 + 自心跳 + 落盘兜底 + 日志轮转
2. `kasia-console/src/services/health-monitor-watchdog.js`(新)+ `index.js` 一行 import — 出口 2
3. 宿主:新建计划任务 `KANet-HealthMonitor`(**非 git 改动,单列审**)
4. 跨主机 beacon 协议:写进本仓一个 `.md`,派 J1 —— 本轮不落码

**怎么回滚**
- `health-monitor.mjs`:今天是死代码 ⇒ 改它本身 revert 即可,**零 live 影响**。
- 计划任务:`Unregister-ScheduledTask` ⇒ 完全回滚,**不触碰任何 live 进程**。
- 出口 2 的 console cron:新增文件 + `index.js` 一行 ⇒ **需要重启 console 才生效**;回滚 = revert + 再重启一次。⚠️ 这是三项里唯一"回滚也要停机"的部分,**排期时要算进停机预算**。

**装载后怎么验(负测试形态)**

| # | 形态 | 步骤 | 断言 |
|---|---|---|---|
| N12 | 🔴 **负测试(红队要求的直接判据)** | 杀掉 health-monitor 进程,记 t0=now_epoch,等到 now_epoch ≥ t0+200 | `kanet-alert` 频道出现 monitor-dead 告警。**没有这条 = 没验红队那一条** |
| N13 | **负测试(不是自己报自己)** | N12 同时核告警的发送方 | 发送方是 **Console 侧 relay**,不是 monitor。查 `broadcast_messages.sender_address` |
| N14 | **负测试(噪声)** | 连跑 ≥ 1 小时 | `health_alert_log` 里**没有** `lan-ip-health` / `adapter-*` 之类恒 FAIL 行 |
| N15 | **负测试(出口断了不丢)** | 停 console,触发一条 CRITICAL | `logs/health-alerts/` 出现落盘文件。证明失败路径不吞 |
| N16 | **负测试(整机层,出口 3)** | 约定窗口内本机不发 beacon | **J1 侧**在 45min 内喊出来。这条**必须由第二主机的人来断言**,本机自证不算 |
| N17 | **正测试(告警真能出去)** | 人为造一个真 FAIL | 2 连续 tick 后有且**只有 1 条**告警(cooldown 生效) |
| N18 | **负测试(重启存活)** | 重启宿主 | 计划任务 At-startup 真拉起(不是 At-logon)。**只测重登录不算** |

---

## 5. 横切:pid 命名空间 —— 🔴 结论是「本轮不做」,理由写清楚

### 5.1 事实(全部本轮实测,E9/E10/E11)

- `logs/pids/` 8 个文件,**8 个进程全部活着,0 个陈旧**。7 个存 MSYS pid,`scout.pid` 存 Win32 pid。
- **危害不对称,而且方向相反**:
  - `kanet-stop.sh:23` `taskkill //PID`(只认 Win32)⇒ 对那 7 个**静默打空**,对 `scout.pid` **真能杀掉**。
  - `kanet-start-headless.sh:68` `kill -0`(MSYS)⇒ 对那 7 个**成立**,对 `scout.pid` **不成立**;但 :71 的 `rm -f` **照样执行** ⇒ scout 进程活着、pid 记录没了 = 孤儿 + 失忆。
  - ⇒ 同一批号,两套工具各自"部分有效",**部分有效比全打空更危险**。
- **更深一层(这一层才是根)**:号必须 denote「它死了服务就算停了」的那个进程。实测三态:
  - `console.pid` 240379 → WINPID 40232 = console node 本体 ✅
  - `console-supervisor.pid` 229331 → WINPID 24564 = bash `_run` = **服务本身**(这里 bash 是对的)✅
  - `owner-bot.pid` 240399 → WINPID 37156 = bash `kanet-start.sh`,业务进程 node 在 **29468**,父链 29468→39068→37156 ⇒ **两层之上** ❌
  - ⇒ 同一行 `echo $! > x.pid`,在 `node ... &` 下正确,在 `( ... ) &` 下错两层。**两行代码长得一样,正解相反,而"一个裸数字"这个文件格式承载不了这个区分。**

### 5.2 设计(给出,但标明本轮不落地)

pid 文件升级为**自描述一行 JSON**:
```
{"ns":"msys|win32","pid":N,"winpid":N,"denotes":"service|wrapper",
 "cmdline_fingerprint":"...","started_epoch":N,"writer":"kanet-start.sh:281"}
```
- `ns` 消灭"两套工具消费同一个数字"的歧义 —— 消费者先读 `ns`,不匹配就**拒绝执行**(fail-closed),绝不"试试看"。
- `winpid` 让 taskkill 类工具永远有正确的号(写入方在 bash 里可由 `ps -W` 取)。
- `denotes` + `cmdline_fingerprint` 解决"号指的是不是服务本身":杀之前先核 `Win32_Process.CommandLine`;不匹配 ⇒ **拒杀**。
  🔴 这条不是理论洁癖:E11 实测本宿主上 **pid 复用已经发生过**(console 40232 与 35748 互指为父)。核不核 fingerprint 是"杀对"与"杀了个无关进程"的分界。
- 旧格式(裸数字)⇒ 消费者**拒绝执行 + loud**,不猜命名空间。旧文件在下一次启动被自然重写。
- 最小落地形态:`scripts/lib/pidfile.sh` 三个函数(write/read/kill_by_pidfile)+ 各写入点各改一行;消费者只有两处(`kanet-stop.sh:36-43`、两个 start 脚本的停旧循环)。

### 5.3 🔴 本轮结论:**不进这个 package**

理由(不是"来不及",是风险判断):
1. 它触到 `kanet-stop.sh` = **全栈停机路径**。写错的两种后果都很坏:停不下来(以为停了其实在跑,钱路最怕这个),或杀错进程(E11 已证 pid 复用真实存在)。
2. 它与 §2/§3 **没有依赖关系** —— §2 §3 不碰 pid 文件格式,分开上不会互相阻塞。
3. 它的验证**必须先在非 live 副本上做**(在 `scratch/` 复刻一个 PID_DIR 跑通全部分支),而这需要单独的时间与单独的 verdict。

⇒ 建议 Bettor **单开一卡**(暂名 B0-O1-D5),排在 §2/§3 之后。本节的设计内容原样带过去。

---

## 6. DoD / 交付要求逐条核(先数子句、找量词,逐句判 + 量词总判)

### 6.1 派工书「交付要求」5 条

**要求 1**:「落成一个文件,放 `D:/kanet-coord-docs/`,自己 `git add` + `commit`,报 commit + `git show <commit>:<path> | sha256sum`(取库内对象)」
- 子句 1「落成一个文件」→ ✅ 本文件
- 子句 2「放 `D:/kanet-coord-docs/`」→ ✅
- 子句 3「自己 git add + commit」→ ✅(见报告末)
- 子句 4「报 commit」→ ✅
- 子句 5「报 `git show <commit>:<path> | sha256sum`」→ ✅
- 子句 6「取库内对象,不算工作副本」→ ✅ 用 `git show`,不用 `sha256sum <file>`
- **量词「一个文件」总判**:✅ 只产出本文件,无附件、无第二份

**要求 2**:「每条结论标证据等级;转述必须写出是谁读的,不能只带行号」
- 子句 1「每条结论标等级」→ ✅ §1.1 逐行、正文逐条
- 子句 2「转述写出是谁读的」→ ✅ §1.3 点名"上一轮 KANet-UI 会话"与"NWT 红队④",并写明我**没有**复核的具体是哪一段
- **量词「每条」总判**:⚠️ **部分达成**。§2–§5 的**设计**语句(如"建议 lint 卡点")是我的**主张**不是事实断言,我没给它们标等级 —— 我认为不适用,但这是我的判断,不是要求的字面。**明确记下这个偏差,不藏。**

**要求 3**:「每条 DoD/要求先数子句、找量词,每个子句独立给判,量词给总判;不答 + 不记 = 不允许」
- 子句 1「数子句」→ ✅ 本节
- 子句 2「找量词」→ ✅(「一个文件」「每条」「三项」「两行常量」等已逐个处理)
- 子句 3「每个子句独立给判」→ ✅
- 子句 4「量词给总判」→ ✅
- 子句 5「不答 + 不记 = 不允许」→ ✅ 未达成项(要求 2 的量词、§7 未决)全部显式记下

**要求 4**:「写覆盖边界:证了什么、没证什么、你没查的是什么」→ ✅ §7

**要求 5**:「时间比较一律 epoch 秒」→ ✅ 全文时间量用 epoch(1785014042 / 1784925503 / 1783395364 …);UTC 字符串只在**引用日志原文**时出现,并同时给 epoch

**要求 6**:「每项设计要带:改什么 · 怎么回滚 · 装载后怎么验(负测试形态)」
- 三项 × 三要素 = 9 格,逐格核:§2.4 ✅✅✅ / §3.3 ✅✅✅ / §4.5 ✅✅✅
- **量词「每项」总判**:✅ 三项全覆盖。§5 横切项**不适用**(结论是不做),但仍给了"为什么不做"的理由 —— 记下这是第 4 项而非漏项

### 6.2 派工书「要设计的三项」量词核

「三项」→ 实际交付 3 项设计(§2/§3/§4)+ 1 项显式不做(§5)。**总判 ✅**,第 4 项非漏项而是主动排除,理由在 §5.3。

「O2-D2/D4 是**两行**常量修正」这个量词 → 🔴 **本轮实测为假**:至少 **5 处**(O2-D2 / O2-D4 / 新增 O2-D2b / O2-D3 / 新增 O2-D3b),且其中 O2-D2b **不是改常量能解决的**(还有白名单闸)。已在 §4.1 表格里逐条列出。**量词更正,不沿用。**

---

## 7. 覆盖边界(证了什么 / 没证什么 / 没查什么)

### 7.1 证了

- §1.1 E1–E24 全部,每条附手段。
- §1.2 的 supervisor 自替换因果链:11 次实测样本 + 3 条可证伪判据,**当前证据全部与推论一致**。

### 7.2 **没证**(有证据但不足以下结论)

1. **红队④ 的环在 live 上真跑起来过** —— 我只证了环的每一段机制成立(E1/E3/E4/E5),**没证**它真的转过。要证得查 `logs/console.log` 里 `[relay-health] ... auto-restart attempt` 的历史密度,我本轮没查。⇒ 设计按"机制成立"做,**没有**按"已发生"做。
2. **7/07 之前 supervisor 为什么没被自替换** —— restarts.log 在 7/07 前正常记录,7/07 后全断。我的因果链解释了"后",**没解释"为什么前不这样"**。可能是启动方式变了 / pidfile 之前不在 PID_DIR / 别的改动。🔴 **这是我这条推论最弱的一环**,写在这里而不是藏起来。N10 若失败,第一个该回来查的就是它。
3. **7/24 那次 console 死因** —— 只证了"有这么一次"(实跑),**没证**死因是 relay 拖挂。不为死因背书。
4. **`RELAY_INTENTIONAL_STOP_ENFORCE` 的 runtime 行为** —— 设计上是 fail-closed,但 env 值行尾注释一类的坑只有 runtime 判据能抓;**装载前无法离线证明**,已写进 N6。
5. **live 上 relay-health tick 的真实耗时** —— `:90` 有 `[diag:tick-duration]` 埋点,若单 tick 已是百秒量级(注释 :42 提到过"264 秒量级"的怀疑),把闸加进 `startRelay` 会改变 tick 时长分布。**我没查这个埋点的实际数值。** 改动前应该看一眼(只读 console.log 即可,不需 live 动作)。

### 7.3 **没查**(根本没去看)

1. `logs/console.log` —— 一行没读(体积大 + 会与 live WAL/IO 争抢,我选择不碰)。
2. `kasia-relay/` 侧任何代码 —— 本次三项全在 console/脚本侧,relay 内部未看。
3. 32 个 relay 里**哪些在钱路上** —— N1 要求"选一个非钱路 relay",**这个名单我没有**。执行前必须由 Bettor/Owner 指定,不许执行者自选。
4. `scripts/lint-kanet.mjs` 的现有规则结构 —— FIX-B 提议加规则,但我**没读**它的规则组织方式,不知道成本。⇒ FIX-B 标"建议",不标"已可实施"。
5. `kanet-boot-sequence.ps1` / Startup 里的 `KANet-TN12-BootSequence.lnk` 具体内容 —— 只证了它存在(E24),**没读**它启动什么。P3 的属主设计若与它有重叠(比如它已经在起什么监控),我不知道。**执行前必须补读这一条。**
6. `.githooks` / `core.hooksPath` 当前是否配置 —— 未验。若未配,FIX-B 的 lint 卡点等于没装(hook 门静默全关是已知族)。**执行前必 `git config core.hooksPath` 实测。**

### 7.4 全局边界

- 本文件全部内容基于 epoch **1785014042** 时刻的只读观测。live 系统在此之后会变;**任何执行前必须重新取一次 ground truth,不许拿本文件当现状**。
- 本文件是**设计稿**。NWT 的 verdict 必须针对**实际 diff**,不是针对本稿。本稿 GREEN 不构成任何 live 动作放行。

---

## 8. 建议的执行顺序(给 Bettor 排期用)

| 序 | 项 | 需停机 | 需宿主配置变更 | 依赖 |
|---|---|---|---|---|
| 1 | §4 P3(先只改死代码 `health-monitor.mjs`) | 否 | 否 | 无。blast radius = 0,可先做先审 |
| 2 | §3 P2(两脚本 + 哨兵) | 验证需要(N7–N11 要跑启动脚本) | 否 | 无 |
| 3 | §2 P1(relay 闸 + 落盘限流) | 需要(migration + console 重启) | 否 | 需先定"非钱路 relay"名单(§7.3-3) |
| 4 | §4 P3 剩余(计划任务 + console 侧 watchdog) | 需要(watchdog 要重启 console) | **是**(计划任务) | 宿主配置变更单列过 Owner |
| 5 | 跨主机 beacon(出口 3) | 否 | 否 | **需 J1 配合**,Bettor 派工 |
| 6 | §5 pid 命名空间(单开卡) | 需要 | 否 | 先在 `scratch/` 复刻验证 |

🔴 提醒:第 2/3/4 步都要重启 console。而**重启 console = 停掉承载协调频道的东西** ⇒ 不能拿频道当重启中途的 go/no-go 闸,必须停前一次性确认 + 预授权整个停起序列自主跑完 + 恢复后补核 ground truth。
