# 设计稿：console 系统提交内存报警（memory-alert）v0.1

> **Status**: CURRENT
>
> 起草 KANet-UI · 2026-09-19 · 依据账本 **(1531)**（死机复盘 P3）、**(1532)**（Owner 采纳 P1–P4 方向）；模式依据 `kasia-console/src/lib/disk-space-alert.mjs`（80 行，只读监控 + `events` 落库）与 `rpc-health-degradation-alert.mjs`（边沿触发 + 测试范式）。
>
> **执行门**：**只写设计与验收判据，不落码**。落码 = 改 `kasia-console/`（console 代码，铁律 0：**Bettor 派工/批准 → NWT 审 diff → 才动手**）；本页不动任何文件（除本页自己）。**不是用户面**（无 tg-bot / eta / messages / i18n）、**不碰钱路**（不 import relay/IPC、不发交易）⇒ 不需要 Owner 批；但生效需要**重启 console**，而每次 console 启动会在主网真实花费约 0.045 KAS（(1533) 启动期 `autoSplitAll`，与驱动开关无关），所以**何时上线是 Bettor 的排期决定**，建议并入下一次本来就要做的重启，不为它单独重启。
>
> **写作依 D-021**：不含密钥、余额、地址；payload 里的进程只带**名字、PID、私有内存 GB**，**不带命令行**（命令行可能含参数/路径中的敏感内容）。

## 0. 结论（先给 Bettor）

新增一个只读监控模块 `kasia-console/src/lib/memory-alert.mjs`，与 `disk-space-alert.mjs` 同款：每 60 s 采一次**系统已提交内存占比**，**≥ 85%** 时往 `events` 表落一条告警（带"谁占着"前 5 名），回落到 **< 80%** 落一条恢复；≥ 92% 升一级。**只告警，不做任何处置**（不杀进程、不限流、不碰 AI 推理服务——那是 P1，属 Owner/另一台机会话的域）。另每 5 分钟往 stdout 打一行采样，给事后复盘留"内存曲线"。

**需要 Bettor 定的点**（默认值已写进本页）：

| # | 点 | 默认 | 备注 |
|---|---|---|---|
| M-1 | 告警线 | 警告 85%、严重 92%、恢复 <80%（严重回落 <88%） | 85% 是你在 (1531) 给的数；下面 §1.2 用今晚的事件时间线说明它大概能提前多少，**但我没法从现有数据反推"当时到底几点跨过 85%"** |
| M-2 | 采样周期 | 60 s | disk-space-alert 是 5 分钟（磁盘变化慢）；内存耗尽在几分钟内完成，5 分钟太粗 |
| M-3 | 持续高位时重复报警 | 每 30 分钟重报一次，或比上次告警值再高 ≥5 个百分点立即重报 | disk-space-alert 是"跌破报一次直到恢复"，内存需要能看出"还在恶化" |
| M-4 | 采样失败也告警 | 连续 3 次采样失败 ⇒ 一条 `memory_sample_failed` | 见 §2.4：内存耗尽时"连 PowerShell 都起不来"本身就是信号 |
| M-5 | 上线时机 | 并入下一次本来就要做的 console 重启 | 见页首：每次 console 启动都有启动期拆分烧费 |

## 1. 依据

### 1.1 (1531) 死机时间线（本地时间）

20:28:55 / 20:36:17 / 20:36:50 / 20:39:18 系统**四次**报 Resource-Exhaustion-Detector 2004（虚拟内存不足），点名 `llama-server.exe` 25.8 GB、`python.exe` 19.2 GB 与 9.6 GB（合计 54.6 GB；提交上限 89.6 GB = 61.6 GB RAM + 28 GB 固定页面文件）；console 的 stdout 到 20:41 仍每分钟稳定 56–76 行、`rss` 118 MB（console 不是元凶，且**直到 20:41 都还活着**）；21:07:57 Owner 发起重启，关机流程在内存耗尽下卡死；21:51:33 硬复位。

### 1.2 这个报警能做什么、不能做什么（诚实口径）

- **能**：console 在 20:41 前一直在正常打日志 ⇒ 60 s 一 tick 的采样器**大概率能在 2004 事件之前**（第一条在 20:28:55）落下一条 85% 告警。2004 表示系统已经在报"接近提交上限"，而 85% 比那更早；**但具体早多少我算不出**（没有当时的提交内存曲线——这正是要加 stdout 采样行的原因，下次就有曲线了）。
- **能**：留下"谁占着"的快照（前 5 名），事后不必再从系统事件日志里拼（(1531) 的复盘是从三份进程日志 + 系统事件日志拼出来的）。
- **不能**：**告警本身不阻止死机**。它只在"有人看"的前提下有价值：`events` 表没有推送渠道（disk-space-alert 也是如此）。**谁来读**是开放项（M-6，见 §5）。
- **不能**：内存真到"连 PowerShell 都起不来"时，采样器自己会失败——所以 M-4 把"采样连续失败"也当信号。
- **不能**：console 崩了/被杀，它就没了。P2 的开机哨兵（事件日志）是另一层，不依赖 console。

## 2. 设计

### 2.1 文件与接线

- 新文件 `kasia-console/src/lib/memory-alert.mjs`，导出：`memoryAlertTick()`、`startMemoryAlertCron()`、`stopMemoryAlertCron()`、纯函数 `evaluateCommit(sample, state, cfg, nowMs)`（状态机，便于测试）、`_resetMemoryAlertStateForTest()`。
- 接线：`kasia-console/src/index.js` 里紧挨 `startDiskSpaceAlertCron()`（当前在 840–841 行）加两行 import + start；一处改动、无迁移、无新表。
- 落库用 `import { sqlite } from '../db/client.js'`（**同 disk-space-alert**，符合 M0a 门：不裸 import `better-sqlite3`）。`events` 表现有列 `(id, event_scope, event_type, source, level, summary, payload_json, created_at)`，不改表。
- 平台守卫：`process.platform !== 'win32'` ⇒ 启动时打一行 `disabled: non-win32` 后返回；`MEMORY_ALERT_DISABLED=1` ⇒ 同样禁用。

### 2.2 采样方法（为什么是这个）

**Node 没有内置的"已提交内存"**：`os.freemem()` 只是物理内存空闲，`os.totalmem()` 是物理总量——**看不到页面文件与提交上限**，而 (1531) 的故障恰恰是**提交内存**耗尽（物理内存还有余时提交已满）。所以要走 PowerShell（disk-space-alert 已有同款 `execFile('powershell.exe', …)`）：

```
Get-CimInstance Win32_OperatingSystem | Select TotalVirtualMemorySize,FreeVirtualMemory,TotalVisibleMemorySize,FreePhysicalMemory
```

- 提交上限 = `TotalVirtualMemorySize`（KB）；已提交 ≈ `TotalVirtualMemorySize − FreeVirtualMemory`；占比 = 已提交 / 上限。
- **口径已在本机实测对过**（2026-09-19 22:3x）：CIM 口径 **46.7%**（上限 89.6 GB，空闲 47.8 GB）vs 性能计数器 `\Memory\% Committed Bytes In Use` **47.5%**（已提交 42.6 GB / 上限 89.6 GB）——两者差约 1 个百分点（快照时刻不同 + 口径细节），对 85% 的线无影响；`Win32_OperatingSystem` 属性名**与区域设置无关**（性能计数器名会随系统语言本地化，非英语 Windows 上 `Get-Counter` 会失败，所以不用它做主口径）。
- **不用 `wmic`**：Windows 11 新版本已默认移除（disk-space-alert 的注释也写了同一判断）。
- 同一次 PowerShell 调用里顺带取前 5 名进程（名字、PID、私有内存 GB），**单次 spawn**：`Get-Process | Sort-Object PrivateMemorySize64 -Descending | Select -First 5 Name,Id,PrivateMemorySize64`，输出 `ConvertTo-Json -Compress`，Node 侧 `JSON.parse`。**只取这三个字段，不取命令行。**
- `execFile` 超时 15 s（同 disk-space-alert）；解析失败/字段缺失/占比不在 (0,100] ⇒ 当作采样失败（不写占比）。
- 每次采样约一次 PowerShell 启动（几百 ms 量级，**未实测**；落码时测一次并写进验收）。60 s 一次的开销可忽略；**如果要更密，需要改用常驻子进程**——本设计不做。

### 2.3 状态机（边沿触发 + 迟滞 + 升级 + 重报）

状态：`OK → WARN → CRIT`，含迟滞：

| 当前状态 | 条件 | 动作 | 新状态 |
|---|---|---|---|
| OK | 占比 ≥ 85 | 落 `memory_pressure`（level `warn`） | WARN |
| OK | 占比 ≥ 92 | 落 `memory_pressure`（level `error`） | CRIT |
| WARN | 占比 ≥ 92 | 落 `memory_pressure`（level `error`，升级） | CRIT |
| WARN | 占比 < 80 | 落 `memory_pressure_cleared`（level `info`） | OK |
| CRIT | 占比 < 88 | 落 `memory_pressure`（level `warn`，降级；记"仍高于恢复线"） | WARN |
| WARN / CRIT | 仍高位且距上次告警 ≥ 30 min，**或**占比比上次告警值再高 ≥ 5 pp | 重报同级告警 | 不变 |
| 任意 | 80 ≤ 占比 < 85（WARN 状态内）| 不落库（迟滞带，防抖） | 不变 |

- 状态与去重键存在**进程内存**里（同 disk-space-alert 的 `_alerted`）：console 重启后状态清零，若重启时仍高位会**重新报一次**——这是想要的行为（重启后应再确认一次）。
- 纯函数 `evaluateCommit` 只吃 `(sample, state, cfg, nowMs)`，返回 `{action, newState}`，**不碰 DB、不碰时钟、不 spawn**，所有上表行都可在单测里逐行覆盖。

### 2.4 采样失败也是信号

- 连续 **3** 次采样失败（超时/解析失败/spawn 抛错）⇒ 落一条 `memory_sample_failed`（level `warn`，payload 含最近一次错误信息），之后每 30 分钟最多重报一次；采样恢复成功 ⇒ 落一条 info 的 `memory_sample_recovered`。
- 理由：(1531) 的故障里"提交内存耗尽 → 桌面与 console 失去响应"；在那个阶段 `spawn powershell` 很可能先失败。**采样失败不是"没事"，也不是"不知道"，是需要人看的信号**——这与本仓"仪器静默失败恰在开始重要那刻显形"的教训一致（失败值与合法取不到不可混）。
- 采样失败 **不写占比**（不用哨兵值 0 冒充读数）。

### 2.5 事件形状（落 `events`）

| event_type | level | summary（中文，沿用 disk-space-alert 风格） | payload_json |
|---|---|---|---|
| `memory_pressure` | warn / error | `系统已提交内存 87.4% ≥ 85% 告警线（已提交 78.3 / 上限 89.6 GB，物理空闲 4.1 GB）。前 5 占用：llama-server 25.8GB、python 19.2GB…——需要 operator 判断（本告警不做任何处置）。` | `{commitUsedPct, commitUsedGB, commitLimitGB, physFreeGB, level:'WARN'\|'CRIT', thresholds:{warn,crit,clear}, top:[{name,pid,privateGB}×≤5], reason:'enter'\|'escalate'\|'repeat'\|'downgrade'}` |
| `memory_pressure_cleared` | info | `系统已提交内存回落到 76.0%（< 80% 恢复线）。` | `{commitUsedPct, durationMs}` |
| `memory_sample_failed` / `memory_sample_recovered` | warn / info | `连续 3 次读取系统提交内存失败：<错误>——采样器自己失败本身就是需要看的信号。` | `{consecutiveFailures, lastError}` |

`event_scope='system'`、`source='memory-alert'`，与 disk-space-alert 一致。

### 2.6 stdout 采样行（给复盘留曲线，不落库）

每 5 分钟（每 5 个 tick）打一行：`[memory-alert] commit=46.7% used=41.8GB limit=89.6GB physFree=33.7GB top=llama-server:16.0,vmmemWSL:4.9,kaspad:2.7`。一天约 288 行，进 console 的 stdout（P2 的开机脚本会在每次启动时把它轮转保留）。**这是 (1531) 缺的东西**：那次复盘没有提交内存曲线，只能从系统事件日志的四条 2004 里倒推。

### 2.7 配置（env，全部有默认值；只写键名，不需要改 `kanet.mainnet.env` 也能跑）

`MEMORY_ALERT_TICK_MS`（60000）、`MEMORY_ALERT_WARN_PCT`（85）、`MEMORY_ALERT_CRIT_PCT`（92）、`MEMORY_ALERT_CLEAR_PCT`（80）、`MEMORY_ALERT_REPEAT_MS`（1800000）、`MEMORY_ALERT_ESCALATE_PP`（5）、`MEMORY_ALERT_DISABLED`（未设）。启动时打一行 `[memory-alert] started — tick=… warn=… crit=… clear=… (只读监控, 不做任何处置)`（与 disk-space-alert 的启动行同风格，便于按行 grep 判定"起来了没有"——本仓的教训：新并行路径必须逐字打既有 canonical 日志行风格）。阈值自检：`clear < warn < crit` 且都在 (0,100)，否则启动时**大声报错并禁用**，不带着错误阈值静默跑。

## 3. 明确不做（以及为什么）

- **不处置**：不杀进程、不降内存、不重启 console/kaspad。P1（AI 推理服务与主网节点同机争内存）是 Owner 域，且另一台机的会话正在经 SSH 改 WSL 与推理服务，本设计对它们**只读**。
- **不做推送**：不发电报/DM。`zk-prove-job-stuck-alert.mjs` 里有一个告警用 relay id（注释写明属 `dev-coord-testnet` 白名单）——该频道已随 D-017 退役；**我只读了那一行常量，没有读完整个文件**，所以不据此判断它的推送机制是否可复用。无论如何"由 console 内发消息"在 console 不可用时都无效。推送是 M-6 的开放项。
- **不改表、不加迁移**。
- **不监控 kaspad/console 各自的进程内存**：console 已有 `[diag:heap-sample]`（rss / wasmBytes），kaspad 的内存看得到但**不是这次的故障模式**（(1531) 明确：console 与节点都不是元凶）。前 5 名快照里它们如果上榜自然会出现。

## 4. 验收判据（落码时逐条过；每条给期望，且要有"变异对照"）

范式沿用 `rpc-health-degradation-alert.test.mjs`：真 schema（`scripts/run-migrations.mjs` 跑临时库）+ 子进程重入 `DB_PATH` + 无手搓假表；**采样器注入**（`execFile` 用可替换的函数参数/模块内可 stub 的引用，测试里喂固定 JSON，不 spawn 真 PowerShell）。

**A. 纯函数 `evaluateCommit`（表驱动，覆盖 §2.3 每一行）**

| # | 输入序列（占比，间隔） | 期望 |
|---|---|---|
| A1 | 50 → 84.9 | 无动作 |
| A2 | 84.9 → 85.0 | 1 次 `enter/WARN` |
| A3 | 85 → 86 → 87（间隔 <30 min，涨幅 <5pp） | 只有首次 1 条 |
| A4 | 85 → 91 | 首次 WARN；**91 相对 85 涨 6pp ≥5 ⇒ 立即 repeat** |
| A5 | 85 → 92 | 升 CRIT（level error） |
| A6 | 92 → 87.9 | 降回 WARN（记降级） |
| A7 | 85 → 82（迟滞带）→ 79.9 | 82 时无动作；79.9 时 `cleared` |
| A8 | 85 → …（间隔 ≥30 min 仍 86） | 1 次 `repeat` |
| A9 | 恢复后再次 ≥85 | 重新武装：再报 1 次 `enter` |
| A10 | 阈值配置非法（`clear ≥ warn`） | 启动断言失败、模块禁用并大声报错 |

**B. tick 集成（喂固定采样 JSON，用真临时库）**

| # | 场景 | 期望 |
|---|---|---|
| B1 | 采样 87% + 前 5 名 | `events` 恰 1 行 `memory_pressure`，payload 的 `top` 长度 ≤5 且**无 `commandLine`/`args` 类字段**；`summary` 含占比与告警线 |
| B2 | 同一采样再 tick 一次 | 仍 1 行（去重） |
| B3 | 连续 3 次采样失败 | 恰 1 行 `memory_sample_failed`；**占比字段不存在**（不是 0） |
| B4 | 失败后成功 | 1 行 `memory_sample_recovered` |
| B5 | 采样 JSON 缺字段/占比 = 0/占比 = 120 | 都按采样失败处理，不落 `memory_pressure` |
| B6 | `events` insert 抛错（如库只读） | 不抛出、不影响后续 tick（`console.warn` 一行；同 disk-space-alert） |

**C. 变异对照（每条必须让对应测试变红，否则测试没在守东西）**

- 把 `>= warn` 改成 `> warn` ⇒ A2 红；把迟滞去掉（clear=warn）⇒ A7 红；去掉"涨幅 ≥5pp 重报" ⇒ A4 红；采样失败时写 0 而不是不写 ⇒ B3 红；`top` 里加上命令行字段 ⇒ B1 红。

**D. 真机只读验证（不改任何东西）**

- D1：在隔离实例（独立端口 + 空 DB + 不可达 RPC 的临时 console，验完即杀，接位文件"真机验证优先用隔离实例"）里起模块，`MEMORY_ALERT_WARN_PCT=1` 强制触发：`events` 出现 1 行 `memory_pressure`，`top` 是真实进程名；恢复线设高于当前值 ⇒ 出现 `cleared`。**不动生产 console。**
- D2：真实 PowerShell 一次采样耗时（几次取样）与失败模式（如故意给错误命令）如实记录。
- D3：stdout 采样行格式与启动行各 1 条，`grep` 可判定。
- D4：`lint-kanet` 0 error；`git diff --stat` 只有新文件 + 新测试 + `index.js` 两行。

**E. 上线后（下一次 console 重启时）**

- E1：启动日志出现 `[memory-alert] started —` 恰 1 行，`disabled` 0 行。
- E2：60–90 s 内 stdout 出现第一条采样行（占比与 §1 的 `Get-CimInstance` 手读值在 ±2 个百分点内）。
- E3：`SELECT count(*) FROM events WHERE source='memory-alert'` 在无压力时为 0（没有误报）。

## 5. 开放项 / 风险

- **M-6：谁读 `events`？** disk-space-alert 也没有推送渠道，写进去的告警靠"有人查表"。本设计**不改这一点**；若要"有人在场时看得见"，需要另一个决定（例如让接位读数清单加一条 `SELECT … WHERE source IN ('memory-alert','disk-space-alert') AND created_at > …`，或 UI 的健康面板读它）。建议至少把这条查询写进接位文件的"开机读数"里——那是**文档改动**，不是代码。
- **采样成本未实测**：一次 PowerShell 冷启动的耗时与在高内存压力下的失败率没测过（D2 补）。
- **它防不了下一次死机，只缩短"发现"的时间**：真正的止血是 P1（分机或给推理进程设提交内存上限）。别把"有了 memory-alert"读成"不会再发生"。
- **口径漂移**：`FreeVirtualMemory` 与性能计数器差 ~1 pp；若 Bettor 更愿意用 `\Memory\% Committed Bytes In Use`，则要处理非英语区域下计数器名本地化（本机是 en-US，但这是个会在换机器时坑人的点），我倾向保持 CIM。
- **并发**：与 `disk-space-alert` 同为独立 `setInterval`，各自 `running` 互斥；两者互不依赖。
