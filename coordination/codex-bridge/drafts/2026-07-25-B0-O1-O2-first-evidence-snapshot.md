# B0-O1 / B0-O2 首份证据快照(只读取证阶段)

> **Status**: CURRENT
> **卡**: `B0-O1-KILL-SWITCH-INTEGRITY` · `B0-O2-HEALTH-MONITOR`(v1.2 `c45acd37` §8.2 / §8.3)
> **DRI**: KANet-UI(顶替会话) · **红队**: NWT · **intake**: Bettor
> **T0** = 2026-07-25T20:17:02Z · 本快照交付于 T0+~0.5h(早于 T0+4h)
> **裁决**: 两卡均 **`NEEDS-LIVE-FIX`**

**本轮零写入**:未改任何文件、未起停任何进程、未动 env/arm、未跑 git 写、未触发任何 start/stop 脚本。
**取证方法**:Win32 CIM 进程表(含 CommandLine + 父链)、`ps -W`(MSYS↔WINPID 映射)、`stat -c %Y`、readonly SQLite、只读 GET 探测、代码实读。
**时间口径**:全部 epoch 秒。⚠️ PowerShell 5.1 `Get-Date -UFormat %s` 在本机(TZ=UTC+7)偏 +25200s,已弃用;进程时间改用 `[DateTimeOffset]::ToUnixTimeSeconds()`。
**取证窗口**:进程表快照 `epoch 1785010601`;最后一次实时读数 `epoch 1785010964`。

---

## 一、O1 — 紧急停机完整性

### 1.1【实测】能重启 / 恢复能力的活进程(快照 1785010601)

| WINPID | 启动 epoch | 命令 | 恢复能力 |
|---|---|---|---|
| 24564 | 1784925503 | `bash scripts/kanet-console-supervisor.sh _run` | 30s tick,连续 3 次判死 → 跑 `kanet-start-headless.sh` |
| 27792 | 1784268453 | `powershell -File scripts\kaspad-watchdog.ps1` | 60s tick,kaspad(netsuffix=12)不在 → 拉起 |
| 25284 | 1784268454 | `powershell -File D:\kaspa-tn12-mining\tn12-mining-watchdog.ps1` | 挖矿侧,**本轮未读其内容** |
| 40232 | 1784973717 | `node kasia-console/src/index.js` | 进程内 cron:relay-health-monitor(30s)、oracle-voter-health-monitor、tg-bot-manager respawn |
| 12100 / 12928 | 1784237553 / 1784237568 | kaspad.exe / stratum-bridge.exe | 被 watchdog 守护 |

【实测】**无任何 KANet 相关 Windows 服务;无任何 KANet 相关计划任务**(已全量枚举非 Microsoft 计划任务 + HKLM/HKCU Run/RunOnce + WOW6432Node)。

### 1.2【实测】开机自启动项(唯一入口 = 登录启动文件夹)

`C:\Users\ADMIN\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\`
- `KANet-TN12-BootSequence.lnk` → `powershell … -File "D:\kanet-tn12\scripts\kanet-boot-sequence.ps1"`,WorkDir=`D:\kanet-tn12`
- `KANet-Brain.lnk` → `C:\KANet\tools\start-brain.bat`(**本轮未读该 bat**)
- `tn10-mining-watchdog.cmd.disabled` — 已停用

⚠️【实测·文档与现实不符】`kanet-boot-sequence.ps1:14` 自述注册为 Task Scheduler **At startup**,实际是**登录启动文件夹**(At logon)。**语义差:无人登录时不会跑。**
【实测】该脚本依次:① 起 kaspad-watchdog ② 等 17210 ③ 起 tn12-mining-watchdog ④ `:3200` 不活才跑 `kanet-start.sh` ⑤ **无条件**跑 `kanet-console-supervisor.sh start`。
【实测】`logs/boot-sequence.log` mtime=1784268456 ⇒ 最近一次开机序在 7/17。

### 1.3【实测】pid 文件真相表 —— 🔴 本节推翻了此前三次广播的结论

**此前说法**(Bettor / 前一会话 / J1 各自"独立"得出)：「8 个里 7 个所指进程不存在 / 是伪 pid」——**错**。

| pid 文件 | 内容 | 是什么 | 指向 WINPID | 判定 |
|---|---|---|---|---|
| console-supervisor.pid | 229331 | MSYS | 24564 | ✅ 正确 |
| console.pid | 240379 | MSYS | 40232 | ✅ |
| kaspa-ws-proxy.pid | 240374 | MSYS | 38112 | ✅ |
| cc-bridge.pid | 240384 | MSYS | 14372 | ✅ |
| qwen-worker.pid | 240391 | MSYS | 41252 | ✅ |
| channel-bridge.pid | 240395 | MSYS | 37708 | ✅ |
| owner-bot.pid | 240399 | MSYS | **37156 = bash 包装层**;真 node 是 MSYS 240401 / WIN 29468 | ⚠️ **差一层** |
| scout.pid | 26500 | **Win32**(node 自写) | 26500 | ⚠️ **命名空间不同** |

【实测】假阳性对照:`kill -0` 对 229330/229332/240380/999999/123456/7 全 FAIL,对 229331/240379 OK ⇒ **不是 Git-Bash 假阳性,是确实的存活信号。**
【实测】pid 文件 mtime 与对应进程启动 epoch 逐一吻合。**pid 文件不陈旧、不伪造 —— 是跨命名空间。**

**写入方(Bettor 补测,关闭 J1 标的未核格)**:`kanet-start.sh` 七处全是 `$!`(`:280 CONSOLE_PID=$!` / `:318` / `:359` / `:372` / `:197` / `:344` / `:383`)、`kanet-console-supervisor.sh:106 echo $$` ⇒ **MSYS**;`kasia-console/src/services/scanner.js:176 String(_child.pid)` ⇒ **WINPID**。
🔴 **⇒ 一个目录混两种编号,文件里无任何标记说明是哪一种。**

**真正的危害**:同一批 pid 文件被**两套互不兼容的杀进程工具**消费。

### 1.4【实测·代码】/【推论】停机路径逐条对账

**(a) `kanet-stop.sh`(canonical 停机)—— 🔴 推论:在本机停不掉 console**
- 【实测】L23 `taskkill //PID $pid //F //T` —— **taskkill 只认 Win32 pid**,而文件里是 MSYS pid
- 【实测】L14 `CONSOLE_PORT=${CONSOLE_PORT:-3400}` —— 兜底 **3400**,而本机 `kanet.env PORT=3200`
- 【实测】L36-42 无论 kill 成败都 `rm -f "$pidfile"`;L93 再 `rm -f "$PID_DIR"/*.pid`
- 【推论·未实测,实测=改状态,已按硬边界放弃】裸跑:阶段1 taskkill 全落空 → 阶段2 打 3400 打不到 3200 → **pid 文件被清空、进程全活**。这是"以为停了其实没停"的最坏形态。

**(b) `kanet-start-headless.sh`(supervisor 的自愈动作)—— 🔴 实测:会把紧急停机撤销**
- 【实测】L64-72 遍历 `$PID_DIR/*.pid` 无差别 `kill` + `rm -f`,**不排除 console-supervisor.pid**(而 `kanet-start.sh:62` 明确排除 —— 两个启动脚本在这条上漂移)
- 【实测】L74-81 用 PowerShell `Stop-Process -Force` 杀 `$CONSOLE_PORT` 占用者(Win32 级,真能杀)
- 【实测】L149-158:pidfile 不在/不活 → **重新 `kanet-console-supervisor.sh start`**
- 【实测·日志坐实】`logs/console-supervisor.log`:`2026-07-24T20:38:18Z Console death detected — invoking kanet-start-headless.sh` → `20:38:23Z supervisor start pid=229331` → `[supervisor] auto-started (r432 wire)`
  ⇒ **老 supervisor 触发 headless → headless 杀掉老 supervisor 自己 → 再拉起新 supervisor(229331,即现在活着的这个)**
- ⇒ **「停掉 supervisor」会被任何一次 console 重启自动撤销。**

**(c) `kanet-start.sh`** —— 【实测】L402-407 每次跑完无条件 `kanet-console-supervisor.sh start`(注释自称"双保险")。

**(d) `kanet-console-supervisor.sh stop`** —— 【实测】pidfile 内容与 bash `kill -0` 一致 ⇒ 从 Git-Bash 跑 `stop` 能真停 24564。**但 (b)(c) 会重新拉起**;且 `kanet-stop.sh` L93 删掉该 pidfile 后,supervisor 自身 `stop`/`status` 全部失明,`start` 会起**第二个实例**。

**(e) console 进程内 relay 自愈 —— 🔴 实测:没有"故意停"的概念**
- 【实测】`relay-health-monitor.js` 30s tick,扫 `relay_nodes WHERE address IS NOT NULL AND (mnemonic_encrypted OR privkey_encrypted)`,不活就 `startRelay()`,上限 3 次/小时/relay
- 【实测·DB】符合条件的 relay = **32 个(全部)**
- 【实测】代码里**不存在 intentional-stop 标记**(对比 `tg-bot-manager.js:104/145` 有 `_intentionalStop` 且跨重启持久化 —— 那条做对了)
- ⇒ **手动停掉任一签名 relay,最多 30 秒被自动拉回。**

**(f) HTTP 面恢复入口**【实测·仅列举,未调用】:`POST /api/relay/:id/restart`(`api/relay.js:164`)、`/api/kanet-broker/bots/stop`、`/api/tg-bot/stop`、`/api/discovery/scanner/stop`。
【实测】`kanet.env:257 ADMIN_IP_ALLOWLIST=127.0.0.1`;⚠️ **本轮未验证该 allowlist 是否真被这些路由 enforce。**

### 1.5【实测】arm/unarm 面(仅文件层)

`kanet.env`(mtime=1784973542,console 启动 1784973717 = env 写入后 175s):
- `ADMIN_M0C1_GATE_ARMED=1` —— 🔴 **文件层为 `1`;运行时的实际值【未知】(阻塞于 `B0-O5`)**
  (`cat -A` 逐字节核过:行尾无注释、无 CR ⇒ 这一句只证**文件内容不会被污染判读**,不证进程读到什么)
  ⚠️ **本行原写作"生效",由 NWT 红队指出并改。** 「生效」是一个**运行时**断言,而本快照的证据只到文件层 —— 而 §1.5 末尾自己就写着"证不到进程内存层"。
  🔵 **这不是造假,是措辞越了一格 —— 而这一格恰好是钱路闸。** Bettor 20:34 刚裁"不许用文件层读数冒充运行时值",而这份交付物里就有一处这么写了。**留此记录,不静默改。**
- `# ADMIN_CAPABILITY_GATEWAY_ENABLED=1` —— **已注释**(7/25 containment)⇒ `capability.js:218` 恒 503
- `# ADMIN_DIAGNOSE_ENABLED=1` —— **已注释**
- 消费点 `kasia-relay/src/lib/authorize.mjs:30`(注释明写:**armed=off 是拆闸不是关闸**;`:70-76` 无条件 allow)
- 【实测】`kanet-start-headless.sh:26-44` 把 kanet.env 每个 key 全量 export;`[[ "$k" =~ ^# ]]` 会正确跳过注释行

🔴【实测·未能取证】`authorize.mjs:44 armReport()` 只经 relay IPC `get_arm_status` 暴露;`capability.js` **只有 POST 路由,无任何 GET**;`/api/capability/status` 实测 **404**。
⇒ **runtime 层 armed 的实际值,当前无任何只读通道可读。只证到文件层,证不到进程内存层**(正是 `B0-O5` 要补的洞)。

### 1.6【实测】孤儿与身份佐证

- `scripts/test-cron.mjs` 有 **2 个活进程**(WIN 952 起于 1784925624、WIN 30584 起于 1784797749),父进程均已消失,且 `logs/pids/` 里**没有 test-cron.pid**(而 `kanet-start.sh:384` 会写)⇒ 跨重启有孤儿残留,且不受任何 pid 文件管辖
- 【实测】live 树 `D:/kanet-tn12` = **detached HEAD**,working tree 脏(9 项,含 `M kasia-console/package-lock.json`)

### 1.7 O1 裁决 — 🔴 `NEEDS-LIVE-FIX`

DoD-1(只读列出所有能 arm/unarm、重启、恢复 gateway 的进程与启动项)—— **已交付**(§1.1–1.5)。
DoD-2/3(机械不变量 + 负测试)—— **当前系统不满足**,取证阶段已能证伪:

| # | 缺陷 | 证据强度 |
|---|---|---|
| O1-D1 | `kanet-start-headless.sh` 杀掉并重建 supervisor ⇒ 紧急停 supervisor 被自动撤销 | 【实测】代码 + 7/24 日志坐实 |
| O1-D2 | `kanet-start.sh:407` 每次跑完无条件 re-arm supervisor | 【实测】代码 |
| O1-D3 | `relay-health-monitor` 对全部 32 个 relay 30s 自愈,**无 intentional-stop 概念** | 【实测】代码 + DB 计数 |
| O1-D4 | `kanet-stop.sh` 用 taskkill 消费 MSYS pid + 兜底端口 3400≠3200 ⇒ 极可能"停了但没停",还顺手清空 pid 文件 | 【推论】→ **NWT 已用双命名空间比对做成实测,见下** |
| O1-D5 | pid 文件跨命名空间混用(7 MSYS + 1 Win32;其中 owner-bot 差一层) | 【实测】ps -W 双列 |
| O1-D6 | headless 与 kanet-start 对 console-supervisor.pid 的排除逻辑漂移 | 【实测】代码对读 |
| O1-D7 | supervisor 7/24 那次自愈**没有写进** `console-supervisor-restarts.log`(最后一条停在 1783395364 / 7/07)⇒ restart-storm 计数器漏记,风暴保护是漏的 | 【实测】日志缺失 |
| O1-D8 | runtime armed 实际值无只读通道 | 【实测】404 + 只有 POST 路由 |
| O1-D9 | 自启动实为 At-logon 而非 At-startup,与脚本自述不符 | 【实测】lnk 位置 |

**O1-D4 的后续(NWT,零杀进程零重启的验证设计)**:不必执行 taskkill —— 只需问文件里那个号在 Windows 命名空间里是什么。结果:7 个 MSYS 号在 Win 侧**无此进程** ⇒ `taskkill` 静默打空;`scout.pid` 是 Win 号 ⇒ `taskkill` **会真杀掉它**。
🔴 **⇒ 比"全打空"更糟,因为它【部分有效】**:无论用哪个工具,都停掉一部分、漏掉一部分,而它看起来像"停机执行了"。

---

## 二、O2 — 健康监控恢复

### 2.1【实测】`scripts/health-monitor.mjs` —— 从未运行过

| 项 | 结论 |
|---|---|
| 进程 | **无**。466 个进程全量扫描,命令行含 health 的只有 `SecurityHealthService` / `SecurityHealthSystray` |
| 属主 | **无**。全仓 grep:不被 `kanet-start.sh` / `kanet-start-headless.sh` / `kanet-boot-sequence.ps1` / 任何 ps1·sh 引用,只在两个 `.claude/worktrees/` 副本里出现 |
| 日志 | `logs/health-monitor.log` **不存在**;`logs/lan-ip-health.log` **不存在**(非陈旧,是从来没有) |
| 心跳 | `health_heartbeats` 表 **0 行** |
| 告警出口 | `health_alert_log` 表 **0 行** |

⇒ 不是"死了",是**从未成功跑过一个 tick**。

### 2.2【实测·代码】即使拉起来也有三处会立刻坏

- `:24 CONSOLE_URL = 'http://127.0.0.1:3100'` —— 本机 console 在 **3200** ⇒ CRITICAL 告警的唯一外发通道打的是空端口
- `:44 lan-ip-health` 检查一个**不存在**的日志 mtime ⇒ 每 tick 恒 FAIL
- `:45 adapter-3018` 硬编码;`:23 BROADCAST_RELAY='3765cc82-…'` —— ⚠️ **两者是否仍存在,本轮未验**
- `:12 KANET_ROOT` 缺省 `'D:/Anthropic'`(错树)

### 2.3【实测】现存的、真在跑的健康面

| 机制 | 属主 | 心跳/日志 | 告警出口 |
|---|---|---|---|
| `logs/console-heartbeat.txt` | console 进程内 2s setInterval | mtime=1785010963,读数时 now=1785010964 ⇒ **age=1s,新鲜** | 无(只被 supervisor 消费) |
| console-supervisor | bash 24564 | `logs/console-supervisor.log`(健康时不写,故陈旧≠故障) | 无外发 |
| `relay-health-monitor.js` | console 进程内 30s cron | console stdout | 无告警,只重启 |
| `oracle-voter-health-monitor.js` | console 进程内 cron | `console.warn` + 写 `events` 表 | events 表,**不广播、不外发** |
| `monitor-service.js` | **已禁用**(`index.js:843` 被注释,Owner 2026-04-29 钦定) | — | — |
| kaspad-watchdog | powershell 27792 | `D:\kaspa-tn12-data\kaspad-watchdog.log`(**本轮未读**) | 无外发 |

🔴 **⇒ 当前系统不存在任何「健康异常 → 主动通知人」的出口。** 所有现存机制要么静默自愈、要么只写本地 log / events 表,等人去看。**这正是卡里"系统对自身健康失明"的准确形态。**

### 2.4 O2 裁决 — 🔴 `NEEDS-LIVE-FIX`

DoD-1(属主 / 启动方式 / 心跳 / 日志 / 告警出口)—— **现状取证已交付,而答案是"四项全空"**。

| # | 缺陷 | 证据强度 |
|---|---|---|
| O2-D1 | 无属主、无启动挂载点,从未跑过(两表 0 行) | 【实测】 |
| O2-D2 | 告警出口 CONSOLE_URL 硬编码 3100 ≠ live 3200 ⇒ 唯一外发路径断 | 【实测】代码 |
| O2-D3 | lan-ip-health 依赖一个从不存在的日志 ⇒ 上线即恒 FAIL 噪声 | 【实测】 |
| O2-D4 | KANET_ROOT 缺省指向错树 `D:/Anthropic` | 【实测】代码 |
| O2-D5 | 全系统零主动告警出口 | 【实测】清单穷举 |
| O2-D6 | 与 O1-D8 同源:`应 armed 却 unarmed` 这条 authorize.mjs 自己点名要的健康探针,**没有探针也没有只读通道** | 【实测】 |

---

## 三、覆盖边界 —— 证了什么 / 没证什么

**证了**:Win32 全进程表(466 个,含 CommandLine + 父链)、非 Microsoft 计划任务全量、HKLM/HKCU Run+RunOnce+WOW6432Node、两个启动文件夹、Win32 服务(kanet/kaspa/kasia/node/stratum/nssm/`D:\` 匹配全空)、`logs/pids/` 8 个文件的内容+mtime+双命名空间解析、5 个控制脚本全文、`health-monitor.mjs` 全文、relay/oracle 两个 in-console monitor 关键段、console.db 中 health/alert/heartbeat 全部 4 张表行数、`relay_nodes` 计数、live 树 git 身份。

🔴 **没证(必须当未知)**:
1. **runtime 层 armed 的实际值** —— 无只读通道,只证到文件层
2. `D:\kaspa-tn12-mining\tn12-mining-watchdog.ps1` 与 `C:\KANet\tools\start-brain.bat` 内容 —— 未读
3. `kanet-stop.sh` 的实际行为 —— 只做代码推理,**未实跑**(实跑=改状态)
4. `ADMIN_IP_ALLOWLIST` 是否真被 restart/stop 类路由 enforce —— 未 grep 到 enforcement 代码
5. adapter `:3018` 是否存在、`BROADCAST_RELAY 3765cc82-…` 是否仍在 `relay_nodes` —— 未查
6. live 树为何是 detached HEAD —— 未追
7. `kaspad-watchdog.log` / `tn12-mining-watchdog` 日志内容 —— 未读
8. supervisor 的 `console_alive()` 负测试 —— 需动进程,本轮禁止
9. `_launch_owner_bot.mjs` / `_launch_tg_bot.mjs` / `_launch_broker_bot.mjs` 各自的自恢复行为 —— 未逐个读

⚠️ **读文件本身会烧掉 atime 证据** —— 本轮读取已污染 §1.4 涉及的 5 个脚本的 atime。

---

## 四、DRI 的提案(未实施,仅提案 —— 处置见下)

1. **O1-D3 优先**(风险最高、最便宜):`relay-health-monitor` 加 intentional-stop 持久化标记,照抄 `tg-bot-manager.js:145` 已有模式
2. **O1-D6/D1**:`kanet-start-headless.sh` 对齐 `kanet-start.sh:62` 排除 console-supervisor.pid;`:158` 的 re-arm 改成受盘上 stop-sentinel 门控
3. **O2-D2/D4** 是两行常量修正,但**在 O2-D1(谁来跑它)定下属主之前修没有意义**
4. **O1-D8 / O2-D6**:建议把 `B0-O5` 提到 O1 DoD-3 之前

**Bettor 对第 4 条的裁定(不整条采纳,拆开)**:
- ✅ 理由成立的那一半:runtime armed 实际值确无只读通道
- 🔴 而 DoD-3 里**大部分负测试不需要它**(进程恢复类是可观测的)
- 🔨 **⇒ DoD-3 拆两半**:进程恢复类负测试现在可做;**涉及 armed 实际值的断言明记【阻塞于 B0-O5】,不许用文件层读数冒充**
