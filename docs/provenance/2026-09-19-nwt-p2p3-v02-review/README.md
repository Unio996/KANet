# P2 v0.2（开机自启 runbook + 脚本草案 v0.2）/ P3 v0.2（内存检测）/ D26-scan 测试 —— NWT 复审

2026-09-19。对象：`origin/coord/kanetui-boot-autostart-and-memory-alert-design` 头 `1d52c7f7`（相对主线 4 文件：P2 runbook v0.2 974 行含附录 A/B/C、P3 v0.2 183 行、`kanet.env.example` 两个注释行、`broadcaster-utxo.test.mjs` +52 的 D26-scan）。方法：逐行读附录 A 脚本；对每条断言用现场只读核（主网库 `readonly`、kaspad 内部日志、relay 源码、`git grep`）复核；D26-scan 用**真实探针文件**在我自己的 worktree（`scratch/_nwt_wt_b90` 切到 `1d52c7f7`，独立 `node_modules`）里实测四种绕过。D-021：无密钥 / 余额 / 地址。

## 结论

- **P2：脚本草案 v0.2 仍不许落码——3 条 MUST（M-A / M-B / M-C），改完再审。** 我在 ba660ae0 提的 M1–M3 与 S1–S6 **全部落到了草案里，方向对**（§一逐条核）；但落点里还留着两处同型缺口和一个"验收工具时序错位"，外加"枚举表能不能当自启门"的判断（§三）。
- **P3：设计与状态机 GREEN**（15 向量 + 12 变异我读过并核了转移逻辑，无错）；宿主迁入哨兵是对的。3 条 SHOULD（CIM 无超时、哨兵自身内存、HRESULT 匹配）。
- **D26-scan：不是空判据，但有 3 处真实绕过（实测）**，SHOULD 改（§五）。
- 我读到的**新事实**（影响 ②）：主网 `config_entries` 里 **`autotake_enabled=true`、`autotake_mode=auto`**（migration v88 于 9/13 播种，非任何人的决定），autoTaker 是**已上膛**的入口触发型路径；今天为零只因 `agent_wallets` 表 0 行——它**不在 §2.6 的空表清单里**，而 §2.6 第 10 行"无 Mind 大脑可下决定"这个安全论据**是错的**（autoTaker 不需要 Mind）。

## 一、我的 M1–M3 / S1–S6 落点核对

| 项 | 落点 | 判 | 备注 |
|---|---|---|---|
| M1 起后无 exit | Phase A/B 分段 | ⚠ **未闭合** | 见 M-A：起后仍有两条能 exit / 终止脚本的路径 |
| M2 认领判据 | `Select-MainnetKaspad` / `Select-ConsoleCandidates` / `Test-ConsoleClaim` + SelfTest 夹具 | ✅ | 按主网 appdir 或 `127.0.0.1:17110` 选 kaspad（simnet 忽略）；console 三条件同时成立才认领；夹具含多 worktree console、simnet+主网并存、只 simnet ⇒ 0 不报 42。我核了 `-like` 大小写不敏感、路径含 `scratch\_x\` 的 worktree 命令行不含生产完整路径子串 |
| M3 连续 ≥3 ALIVE | `Wait-KaspadAlive` `$AliveStreakNeeded=3` | ✅ / ⚠ | 非 0 读数清零连续计数 ✔；**但单次探针异常会中止整个门**（S-A） |
| S1 树检查 | `Test-TreeClean` | ✅ / ⚠ | 分支 + 两个脚本 `diff --quiet HEAD` ✔，只阻断 console；见 S-B（tracked 源码是否干净、git 在 S4U 下的目录属主检查） |
| S2 前次停机干净否 | `Get-LogTail` / `Test-CleanStopMarker` 读**内部日志** | ✅ | 与我读到的 `rusty-kaspa.log` 收尾行 `Kaspad has stopped...` 形状一致；日志不存在按 unknown 也告警 |
| S3 stdout 停写自检 | 哨兵比 mtime | ✅ | 启发式已标 |
| S4 S4U 跨会话可管理 | R2(c) | ✅ | 见 S-C（R2(b) 只测 `git --version`） |
| S5 PID 陈旧 | `Start-ConsolePhase` fresh 检查 | ✅ | `node.exe` ∧ 精确路径 ∧ `CreationDate ≥ 开始−5 s` |
| S6 PID 复用 | `Test-SameProcess`（存活 ∧ 启动时间不变） | ✅ | |

## 二、MUST（P2）

### M-A —— "起后永不 exit"还有两条漏（M1 的落实不完整）
1. **Phase A 内、`Start-Process` 之后仍会抛错 → 外层 `catch { Stop-Boot 99 }` → `exit 99`**：`Invoke-PhaseA` 在 `Start-Process` 返回 kaspad 之后紧接着执行 `Set-Content -LiteralPath …\kaspad.pid`（`$ErrorActionPreference='Stop'`，磁盘满 / 权限 / 文件被占用都会抛）——异常逃出 `Invoke-PhaseA`，被最外层 `try { $ctx = Invoke-PhaseA } catch { Stop-Boot 99 'UNEXPECTED_PRE_START' }` 接住，`exit 99`。此时 kaspad **已经起了**（"PRE_START"这个名字是错的）。按草案自己的最坏假设（任务实例结束会带走子进程），这正是 P2-M1 要消灭的"硬杀刚起的节点 + 每 10 分钟重试再杀"。**修法**：`Start-Process` 之后的一切（写 pid 文件、`New-Item`、取 StartTime）各自 `try/catch`（失败只 `Write-History`），并让 `Invoke-PhaseA` 在 kaspad 已知之后**再也不抛**；或把 pid 文件写入挪进 Phase B。
2. **`Invoke-PhaseB $ctx` 本身没有 try/catch，而末尾的"永不结束"安全网只在它**正常返回**时才可达**：`Invoke-PhaseB` 里任何一条没被自己包住的语句抛错（例如 `Set-BootStatus 'CONSOLE_SKIPPED'` 之外的路径、`Enter-MemoryLock` 之后的语句），异常直接终止脚本（`-File` 模式下退出码非 0）→ 计划任务按 D-D 重启 → 进程带走 kaspad。**修法**：最外层 `while ($true) { try { Invoke-PhaseB $ctx } catch { Write-History …; Start-Sleep 30 } … }` 的形态（异常后**不重入**启动逻辑，只落到常驻睡眠循环）；并在 R3 加向量"Phase B 内注入未捕获异常 ⇒ kaspad PID 不变、脚本仍在"。（`-SelfTest` 现在覆盖不到这一层。）
**验收**：R3 两条注入向量（pid 文件写失败；Phase B 未捕获异常）⇒ kaspad PID 与脚本进程都不变。

### M-B —— 附录 C 的 t0 快照时序错位：它会漏掉它本来要抓的那一笔
附录 C / §4.5 #10 写"`snap`（t0，**在 console 稳定后立刻**）与 `diff`（t0+30 min）"。但 §2.6 第 1 行的启动期 `autoSplitAll()` 在 **console 启动后几秒内**就发（今晚 22:21:24 起、22:21:34 发）——**早于"console 稳定"**。所以 t0 之后再 diff，**恰好看不到启动期那一笔**（它在 t0 之前已花掉）。附录 C 的实测（"t0 后立刻 diff = 0 变化"、"合成变异能检出"）只证明**t0 之后**的花费可检出，并没有覆盖这个时序。
**修法**：t0 必须在**起 console 之前**取——即哨兵在 `KASPAD_ALIVE` 与 `Start-ConsolePhase` 之间自动跑 `snap`；`diff` 在 console 起来 +30 分钟自动跑；判定用 **`spent_outpoints == 0`**（出站证据）而不是"多出任何一笔"（外部**入账**只增加 `new`、无害，会误报）。做成**每次开机自动执行、结果落 `boot-status.json` + Warning 事件**，而不是只在首次真重启时人手跑一次。补充限制（写进文档）：快照完整性依赖 `--utxoindex` 在 t0 时已追平；t0 时索引未追平则 `spent` 可能漏、`new` 可能虚增——快照前可加一次"UTXO 数不再增长"的稳定性读数。
**信号 2 的独立性核对**：`kaspa_tx_log` 只登记"输出含我们地址"的交易——**我复核成立**：主网库 `SELECT COUNT(*), SUM(from_address 为空)` = **74 / 74**（与附录 C 一致）；relay 源码 `rpc-listener.mjs` 的 indexer 只按 `_watchedAddresses`（含各 relay 自己的地址，`:425`）匹配输出。所以信号 2 能覆盖 t0 之前的启动期拆分（输出含自己地址），**但看不见"纯外付、无找零回自己"的出站**；这类只能靠信号 1（因此 t0 必须在 console 前）。

### M-C —— §2.6 枚举表**不足以**作自启门（第 10 行结论要推翻）
**事实（我现场只读核，主网库）**：`config_entries` 里 `autotake_enabled = 'true'`、`autotake_mode = 'auto'`、`autotake_min_discount_pct = '0.5'`（`created_at` 2026-09-13 15:33:53，即 v88 迁移播种，不是任何人的裁定）；`trade-protocol-filter.js:1963-2033` 的 `_evaluateAutoTake`（`getConfig('autotake_enabled')` 在 :1968，`if (!bestRelay) return;` 在 :2033） 在收到入站 exchange offer 时执行：**先查 `autotake_enabled`**，跳过自己的 offer，方向限 KAS↔USDT，价格折扣 ≥ 阈值，金额 ≤ `autotake_max_amount_usdt`，日限 3 笔，最后**取"第一个有 `agent_wallets`(chain='bnb', is_default=1) 的 relay"**——`if (!bestRelay) return;`。`agent_wallets` 在主网库**0 行**，所以今天走不到花钱那步。
**含义**：
1. §2.6 第 10 行的安全论据"`trading_config_json` 非空的 relay 0 个（无 Mind 大脑可下决定）"**对 autoTaker 不成立**——它不依赖 Mind、`agent_wallets`、`trading_config_json`，它是 **`config_entries` 里 `autotake_enabled=true` + `mode=auto` 已上膛**、靠 `agent_wallets` 空表挡着（与第 3–6 行同一类"今天为零由空表保证"）；表里**没有把 `agent_wallets` 列进空表清单**。
2. **无人值守 + 入站消息触发 + 已上膛**，这是最不该靠"表恰好是空的"的组合：任何一次导入把某个 relay 的 bnb 钱包带进 `agent_wallets`（迁移 17 个账号时没带，下一批未必），autoTaker 就会对**任何外部 peer 发布的 offer** 在无人在场时自动接单并付 USDT（`mode=auto`；`approval` 模式才是 Owner 确认）。
3. 转账调用点的盘点也不完整：`git grep` 显示 `type:'transfer'` 的非测试调用点分布在 **14 个文件**（`broker-intake-watcher.js` 8、`episode-builder.js` 6、`submit-intent.mjs` 2、`exchange-machine.js`、`oracle-pool-renewal-cron.mjs`、`settler-router.js`、`prediction-agent-mind.mjs`、`zk-prove-worker.mjs`、`api/trading.js`、`api/chat.js`、`api/relay.js`、`relay-manager.js`、`broker-action-queue.js`、`bshard-close-transport.mjs`）；§2.6 的 11 行覆盖了其中一部分触发面，第 10 行自己也承认"没有逐个读 handler 代码"。
**要求（自启注册门加三条）**：
- **①（治标，需 Owner/Bettor 定，非我动）**：主网 `autotake_enabled` 置 `false`（或 `mode` 置 `approval`）——一个 `config_entries` 写入，不是代码；在此之前它是"只靠空表挡着的已上膛路径"。
- **②第 10 行做到代码级**：把上面 14 个文件的转账调用点逐个分类（定时 / 入站消息 / HTTP / 手动），给每个"入站消息触发"的一个**主网现状阳性证据**（开关日志行或配置值），而不是数据面推断。
- **③每次开机的自动守卫，而不是一次性核**：§2.6 的"今天为零"全靠库里数据；自启后**每次**无人开机时数据可能已变。让哨兵在**起 console 之前**用只读 SQL（node，`readonly`）核一遍守卫集合：`is_oracle=1` 行数、`agent_wallets` 行数、`exchange_offers`/`pool_markets`/`pool_bettor_sides`/`oracle_registry` 等表行数、关键 env 键是否出现、`autotake_*`——**与"预期为零"不符 ⇒ 不起 console（kaspad 照起）、发 Warning 事件、等人**。这样"今天为零"变成"每次开机验证为零"。（运行期漂移——console 在线时有人新增 oracle relay——是另一件事，那是有人在场的显式动作。）

## 三、（Bettor ②）§2.6 作自启门够不够 —— 不够，见 M-C；补充判断
- 表的**结构**是对的（路径 → 触发 → 现状证据 → 是否无人花钱）；D-026 上线后 #1、#2 由默认关的开关保证——这两条我审过实现，成立。
- **不够的是"证据类型"**：#3–#6 是"空表"证据（一次性），#7–#9 是"日志里有 disabled"（对**本次启动**成立），#10 是"数据面推断"。作为**一次性**注册门可以接受"逐项当前为零 + 每次开机守卫（M-C③）"的组合；单靠这张表不行。
- 保险丝（NWT ②-4）"D-026 已定默认关 ⇒ 不适用"同意。

## 四、（Bettor ③）附录 C 的事实与工具
- **事实成立**（§二 M-B 已核）：74/74 `from_address` 为空；`to_address` 全属我们 18 个地址；relay indexer 只匹配输出。
- **工具**：只读（`readonly` 库、节点只读 RPC）、点名 `UNREADABLE`（不当"无变化"）、txid:index 快照不含地址金额——设计对。问题：(1) **t0 时序错位 = M-B**；(2) 验收口径应为 `spent_outpoints==0`，"多出任何一笔=失败"会被外部入账误报；(3) 快照完整性依赖 utxoindex 追平（见 M-B）；(4) 脚本 import 了 console 的 `kaspa-rpc-shared.mjs`——常驻自动化里应做成独立小脚本（不依赖 console 库，否则 console 树被误切分支时工具也坏）；(5) `getUtxosByAddresses` 对超大地址集有 wasm trap 风险（既往记录），对 18 个团队地址目前无碍，但 `UNREADABLE` 处理已覆盖。

## 五、（Bettor ⑤）D26-scan 测试——**不是空判据，但 3 处真实绕过（我用真实探针文件实测）**
基线 15/15。对 `1d52c7f7` 我在临时探针文件里各放一个真实调用，跑 `broadcaster-utxo.test.mjs`（每次还原，`git status` 干净）：

| 探针 | 内容 | D26-scan 结果 |
|---|---|---|
| B（对照） | `src/services/_probe.js` 里 `ensureBroadcasterUtxos(id,30)` | **红**（说明扫描活着） |
| **A** | 同样的调用放在 **`kasia-console/src/data/_probe/a.js`** | **仍绿——漏报** |
| **C** | `/* warm */ export const f = (id) => B.ensureBroadcasterUtxos(id, 30);`（行以 `/*` 开头但含真实调用） | **仍绿——漏报** |
| **D** | 外部调用另一个导出入口 `broadcasterUtxoTick()` | **仍绿——漏报**（扫描只认 `ensureBroadcasterUtxos` 这个名字） |

对应回答：
- **跳过目录名单会不会漏真实调用者**：**会。** `SKIP_DIRS` 含 `data`，按**任意深度的目录名**匹配，而 `kasia-console/src/data/**` 是**真实运行时源码目录**（`discovery/`、`settings/`、`state/`，我数到 tracked 的 `.js/.mjs` 源文件落在 `data/build/dist/logs` 名下共 18 个，`configs.js` / `relay-nodes.js` 都是被 console 广泛 import 的）。`scratch` / `docs` / `logs` / `.claude` / `node_modules` / `.git` 跳过是对的；**`data`、`build`、`dist` 不该按名字全局跳过**——改成只在**仓库根**跳过 `data/logs/scratch/docs`（按相对根路径匹配，而不是按任意层的目录名）。
- **忽略注释行的正则会不会被块注释骗过**：**会，且方向不安全（漏报）。** 逐行前缀判断把 `/* … */ 真实调用`、`*/ 真实调用` 当注释丢掉（探针 C 实证）。**修法**：整文件先剥注释再扫（`src.replace(/\/\*[\s\S]*?\*\//g,'')` + 行注释剥离，J2 的 `utxo-facts.test.mjs` 里 `stripComments` 就是现成写法），不要逐行前缀判断。
- **还漏一个导出入口**（探针 D）：`broadcasterUtxoTick` 与 `ensureBroadcasterUtxos` 同样是导出、同样绕过 cron 入口的闸。扫描应覆盖**两个名字**（同一份"唯一调用者"断言）。
- 其余：`scanned > 50` 阳性对照有效；`selfPath` 用同一 `join` 规范化，等值比较可靠；模块内 `hits.length === 2` 且"调用在 `broadcasterUtxoTick` 体内"是好的结构断言。动态拼名（`B['ensure'+'Broadcaster…']`）任何文本扫描都挡不住，写进已知边界即可。

## 六、P3 v0.2（Bettor ④）
- **进程内 CIM 采样 30 s / 首次耗尽类错误即 CRIT / 文件日志先于事件日志**：方向都对。`Invoke-MemoryWatchTick` 在失败分支先 `Write-MemLine`（文件）再 `Send-BootEvent`；耗尽类错误首次发 9310 Error；状态失败期间**保持**不重置——与我的 §四-③ 要求一致。
- **状态机 15 向量 + 12 变异**：我读了 `Get-MemoryTransition` 全部分支：OK→WARN/CRIT、WARN→CRIT/OK、CRIT→OK 直降（不再说"仍高于恢复线"）、CRIT→WARN、静默带（WARN 的 `[Clear,Warn)`、CRIT 的 `[CritClear,Crit)`）、时间 / +5pp 重报（含"仅在 ≥ 本级入口阈值时重报"）——**逻辑无错**，且 v0.1 我指出的 5 个缺口（OK→CRIT 直跳、CRIT→OK 直降、CRIT 内重报、静默带内不重报、非法配置）都有向量；变异按"标记行"精确命中一处（`applied-exactly-once` 断言），不是空判据。`Test-MemoryConfig` 序 `clear<warn<critClear<crit<100` 正确。
- **CRIT→OK 直降等转移**：✅（V11）。
- **SHOULD-1 CIM 没有操作超时**：`Get-CimInstance Win32_OperatingSystem` 无 `-OperationTimeoutSec`。内存耗尽时 WMI 服务可能**挂住而不是报错**——那么这个 30 s 循环会**卡死在采样上**，**同一循环里的死亡哨兵一起失明**，恰在事故时刻。要求：`-OperationTimeoutSec 10`；采样与死亡哨兵之间互不阻塞（先做死亡检查，已是）；并每轮 `touch` 一个 `sentinel-heartbeat`（mtime）——让 M-6 的消费者能发现"哨兵自己挂了"，否则"没有告警"与"哨兵已死"不可分（这是我一贯要求的"失败值与合法取不到不可分"）。
- **SHOULD-2 耗尽类错误匹配依赖英文文案**：`OutOfMemory|1455|not enough memory|not enough storage|insufficient system resources` 靠 `Exception.Message`；本机 en-US，但换区域 / 换机器会失配。加上 **HRESULT 数值匹配**（`$_.Exception.HResult` / `$_.Exception.InnerException.HResult`：`E_OUTOFMEMORY 0x8007000E`、`0x800705AF`(页面文件太小)、`0x80070008`(存储不足)、`0x800705AA`(系统资源不足)）。
- **SHOULD-3 哨兵自身的内存占用没测**（P3 §6 自己写了"长时间运行的资源占用未测"）：一个 5.1 常驻 PowerShell 每 30 s 做 `Get-CimInstance` + `Get-Process | Sort`，2880 次/天；WinPS 5.1 循环里 CIM 调用的句柄 / 内存缓增有既往先例。要求：`SAMPLE` 行带上**哨兵自己**的 `PrivateMemorySize64` 与句柄数，R0/R1 跑 ≥ 数小时，验收"不单调增长"。讽刺的是一个内存检测器不该成为内存增长者。
- **SHOULD-4 内存锁失败后不重试**：`Enter-MemoryLock` 失败（另一个 `-WatchOnly` 持有）只写一行 history、之后永不再试；若那个 `-WatchOnly` 会话之后结束，boot 哨兵**永久没有内存检测**且不告警。每个哨兵 tick 重试取锁（几乎零成本），取到后写一行 `MEMWATCH-TAKEOVER`。
- **M-6 具名消费者**：写了（Bettor 读数清单 + 会话侧 Monitor + 不依赖事件源的文件读法），接受；配合 SHOULD-1 的 heartbeat 才完整。
- 措辞"检测与取证 / 不是预防"：✅。

## 七、P2 SHOULD
- **S-A 单次探针异常中止整个门**：`Wait-KaspadAlive` 里 `$p = Invoke-Probe` 没有 try/catch；`Invoke-Probe` 会因 `node` 起不来（内存压力下 spawn 失败——正是开机与 AI 服务同时起的时刻）抛错，异常传到 `Invoke-PhaseB` 的 `catch → Warn-Kaspad 98`，`$gateOk=$false`，**本次开机 console 永不启动、门也不再重试**。应在循环内 try/catch，当作探针读数失败（`streak=0; consecErr++`，走既有 ≥5 次告警路径）。
- **S-B 树检查两点**：(1) `git -C <root>` 在 **S4U/Limited** 令牌下可能撞 git 的"目录属主不符（dubious ownership）"检查而失败——那样 `$branch` 变成报错文本、树检查恒不通过、console 永不自启（fail-closed，但开机才发现）。**R2(b) 目前只测 `git --version`，请改测 `git -C D:\kanet-tn12 branch --show-current` 与 `git diff --quiet HEAD -- scripts/…`**；(2) 无人值守应只跑**已提交**的代码：`Test-TreeClean` 只查两个脚本，请加 `git diff --quiet HEAD -- kasia-console/src kasia-relay/src`（tracked 源码干净），否则未提交的本地改动会在无人时上主网。
- **S-C 部署位置**：仍是"建议树外副本"待定——这是 S1 里我提的**核心**，请在 4.1 前定下（`C:\KANetBoot\` 之类 + sha256 记 provenance），否则脚本自身仍随检出的分支漂移。
- **S-D**：R2(a) 里"WMI `Win32_Process.Create` 起法"我上次建议的是让 kaspad/console **脱离任务 Job**；若 R2 证实可行，应直接把起法改成它（此时常驻包装不再承重，M-A 的风险面整体消失），而不是继续依赖"永不 exit"。
- **S-E**：`Get-LogTail` 的 `$n`（`long`）传给 `New-Object byte[] $n` 与 `$fs.Read($buf,0,$n)` ——5.1 通常隐式收窄成功，但请在 `-SelfTest` 里对一个 >8 KB 的样本日志跑一次真读（现有 stop-marker 向量只测字符串函数，没测 `Get-LogTail` 本身）。

## 八、处置一览
| 编号 | 类 | 内容 |
|---|---|---|
| **M-A** | MUST | Phase A 起后的 pid 文件写入 + `Invoke-PhaseB` 未包裹：仍可 exit；R3 加两条注入向量 |
| **M-B** | MUST | 附录 C 的 t0 必须在起 console **之前**由哨兵自动取；判定 `spent==0`；每次开机自动执行 |
| **M-C** | MUST | 推翻 §2.6 第 10 行论据（autoTaker `enabled=true, mode=auto` 已上膛，靠 `agent_wallets` 空表挡）；14 个转账调用点分类；每次开机只读守卫；主网 `autotake` 置关（Owner/Bettor 定） |
| S-A…S-E | SHOULD | 探针异常不中止门 / git 属主与 tracked 源码干净 / 树外副本定案 / 优先 WMI 脱 Job / `Get-LogTail` 真读 |
| P3 SHOULD-1…4 | SHOULD | CIM `-OperationTimeoutSec` + heartbeat / HRESULT 匹配 / 哨兵自身内存 / 内存锁重试 |
| D26-scan | SHOULD | 只在仓库根跳 `data/logs/scratch/docs`；整文件剥注释；两个导出入口都覆盖 |

## 我没做 / 未证
- 没在真环境跑任何 PowerShell 脚本（草案未落码）；没验证 S4U 语义、git 属主检查、关机通知送达；没在真实内存耗尽下验证 CIM 行为（也不该制造）。
- 没逐个读 14 个转账调用点的 handler（M-C② 是要求别人做的盘点，我只给了清单与 `autoTaker` 一条的完整链路）；`autotake_*` 的三个 `config_entries` 值我只读了键与值（非敏感标志），没读任何密钥列。
- D26-scan 的四个探针我全部在自己的 worktree 里创建并删除，`git status` 干净；未向 KANet-UI 的分支提交任何东西。
