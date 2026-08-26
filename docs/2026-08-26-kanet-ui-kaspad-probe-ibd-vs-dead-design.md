# kaspad 探针「IBD 进行中」vs「真死」判据设计 — kaspad-rpc-probe.mjs / kaspad-watchdog.ps1（设计稿 · 零改码）

> **Status**: DRAFT **v0.4** · KANet-UI 2026-08-26 · Bettor 派工 · **v0.1 NWT = PASS-WITH-MUST-FIX**; v0.2 应两必修 + 优先级重排 + llm-watchdog; **v0.3 = 用 J2 源码答案(@rusty-kaspa 7b1e18cc live 二进制)对齐 F-B/F-C**; **仍不落码, NWT 终核读 v0.4**。
> **v0.4.1(填址收口)**: F-C 对照集第 2 项由 J2 定值 = `kaspatest:pzrhg8y8n3txuk39vxnvpe5da2spnmgfhknumlwcyh6t7nkqv449ql4swe79q`(盘 ext-pool-v07-1782816783831-cn5xn 的 spine_p2sh, 100 KAS; 出处 = covenant-funded.json:2315 + ledger(112):4930/:4931, 详见 §10; **"未花"唯一出处是 covenant-funded.json 非 ledger**; 两边脚本同尺)。
> **v0.4 changelog(NWT 终核前, 三处)**: ①KNOWN 残余(§3.2c 新节)— `service.rs:257-275 unwrap_or_default` 是 per-query, 索引健康时某址某次查询遇瞬时 store 错仍返 [], A1/A2/探针都挡不住 ⇒ ALIVE 只证"索引建好"不证"某址这次读得对", 钱路关键读必须二源交叉。②MF-2 范围(§0.5)— 内存闸装**每个重进程 spawn 点**(不只 kaspad-watchdog, 它根本不 spawn llama; 加两份 start 脚本 llama 段 + llm-watchdog)且**每 tick 重查**(IBD 内存会涨, "kaspad 需 ~2GB"锚改掉)。③crash-loop 告警到达性(§0.5)— 加本地红旗文件(探针每 tick 读, 红旗在就不拉)+ 不依赖 console 的通道(owner-bot 直发 TG / Windows 事件日志 Error 级)。
> **v0.3 changelog(仅两处)**: F-B — R6 由 [MUST-VERIFY] 改「已核: 节点重建对读者原子(write 锁, 无半建态), 但 RPC 闸只盖 UTXO 导入段、header 阶段合法答 []、helper 吞 store 错成空集 ⇒ 节点给不了『索引建成』的牙, R6 承重全在外锚 A1∧A2」; 删 isUtxoIndexed 交叉(= 配置开关非建成状态); 负例交叉改 J2 三态。F-C — 不可花费永久 UTXO 不存在(J2 三候选全否), 对照改「≥2 独立长期持币址, 任一非空即过, 全空=UNKNOWN 永不 DEAD」。
> **v0.2 changelog**: ①MF-1 加「共识计数器 60min 硬停滞层」(diskWrite 可被 RocksDB compaction 伪造, 不能单独判 SYNCING) + 预注册 V8。②MF-2 §6 crash-loop 刹车从可选升 **REQUIRED** + **内存感知拒拉**(8/23 形态: 进程已 OOM 崩退, "看不到进程就放行"会再拉 30GB 砸缺内存机)。③**优先级重排(NWT 纠正)**: 危害大的 crash-loop/OOM 提到 §0.5(最高优先), 危害小的 IBD 假 DEAD 降为次要。④加 §9 llm-watchdog 双开跟进。⑤§0 一句话按 8/23 真根因(OOM 主因)重写。
> **域**: 运维/watchdog(KANet-UI 域, J1 在 ledger (624) 明确移交)。改动对象 = `scripts/kaspad-rpc-probe.mjs`(退码/判据) + `scripts/kaspad-watchdog.ps1`(消费退码)。**不碰任何钱路/产品码/console。**
> **触发**: 8/26 J1 换全新库后 kaspad 22428 IBD 中, 探针稳定回 `DEAD:empty-data:daa=0`; watchdog 按此 3 tick 判 DEAD 反复 Start-Process(第一手实录见 §1)。与 8/23 事故「崩→watchdog 拉起→再崩」同形(不同根因, 同一个 watchdog 缺"别拉"的判断)。
> **证据纪律**: 每条判据标 `[MEASURED·今日实测]` / `[READ·读码]` / `[INFERRED]` / `[DESIGN-CHOICE]`。实测全部为只读 RPC/日志/进程枚举, 命令与原始输出在 §7。

## §0 一句话（v0.2 重写）

**watchdog 最危险的失效不是"漏拉死节点", 是"在缺内存的机器上又拉一个大进程"**——8/23 整机崩的真根因是 OOM(18:39 commit 撑顶, 主体是 llama-server ~30GB; kaspad 首崩晚 73 分钟、是 OOM abort 的**症状**不是原因, NWT 推翻旧判、Bettor 在 ledger (625) 收回)。所以本设计**两个层级、优先级分明**:
- **§0.5 最高优先(危害大)**: 任何"拉起 kaspad"的动作都必须**内存感知 + crash-loop 刹车**——commit 余量不足时**拒拉**, 反复拉起活不过 M 秒时**停手告警**。这直接防 8/23 那类"崩→拉→再崩→撑顶"放大器。
- **§2+ 次要(危害小)**: 现探针把「节点未同步」塌进「数据空=死」(`virtualDaaScore>0` 在 IBD header 阶段恒为 0), watchdog 把健康同步的节点当尸体反复拉。修法 = 二态升三态(ALIVE / SYNCING / DEAD)。**这个假 DEAD 之所以危害小, 是因为"只启不杀"下每次误拉都撞 DB LOCK 秒死**——除非机器同时缺内存, 那就退化成 §0.5 的 OOM 放大器。⇒ §0.5 是 §2 的安全网。

## §0.5 最高优先: OOM / crash-loop 防护（MF-2, NWT 升 REQUIRED）
`[MEASURED 2026-08-26]` 本机: 物理 RAM **61.6 GB**, commit 上限 **99.6 GB**(页文件补 ~38GB), 当前 commit 已用 **59.2 GB** / 空闲 **40.4 GB**; 单个 llama-server 私有 commit **30.2 GB**。⇒ **再拉一个 llama 需 ~30GB commit; 8/23 那种 console cycling + 多进程时, 空闲 commit 会跌破 30GB, 第二个大进程把 commit 顶穿 = "分页文件太小" = 整机失响。**

**两道硬闸(watchdog 在任何 Start-Process 之前都要过, 缺一不拉)**:
1. **内存感知拒拉(REQUIRED, v0.4 扩范围)**: 任何 spawn 前查 `Get-CimInstance Win32_OperatingSystem` 的 `FreeVirtualMemory`(= 空闲 commit), 低于阈值 ⇒ **拒拉 + 告警 `refuse-start:low-commit:<free>GB`**。
   - 🔴 **范围(NWT 硬伤修正): 闸必须装在【每个重进程 spawn 点】, 不只 kaspad-watchdog** — kaspad-watchdog **根本不 spawn llama**, 而 8/23 主凶是 **llama 双开**(见 §9)。承重 spawn 点清单: ①`kaspad-watchdog.ps1`(kaspad) ②`kanet-start.sh:232` + ③`kanet-start-headless.sh:106` 的 llama-server 段 ④`llm-watchdog.mjs:45 spawnLlama`(若保留)。每处 spawn 前都要过同一道内存闸。**本稿域只覆盖 ①④(watchdog 域); ②③是 start 脚本改动 = 走报备→NWT 审→Owner 批**(与漂移表 §4 合并那批同批), 本稿只钉出"必须装"。
   - 🔴 **每 tick 重查, 不只 launch 时**: IBD 期内存会涨(坏库曾 25GB / 新库 4GB 起步, 且随同步增长), "kaspad 需 ~2GB"这个 v0.2 锚**作废**(它只是空库启动瞬时值)。阈值按"目标进程当前/预期峰值 commit + margin"定, 不按启动瞬时值。
   - **数值(保留)**: `KASPAD_MIN_FREE_COMMIT_GB` 默认 **8**(kaspad); llama 类默认 **35**(≥ 该进程私有 commit 30 + margin)。
   - **"看不到进程就放行"的旧闸(§3.4)对 8/23 无效**: 进程 OOM 崩退后确实看不到, 但机器仍缺内存, 拉一个 30GB 新进程正是压垮点。⇒ **内存闸在"进程在就不拉"闸之前, 且独立成立**。
2. **crash-loop 刹车(REQUIRED)**: 状态文件记 `starts[]`(每次 Start-Process 时间戳 + 拉起的 PID)。判据: **15 分钟内 Start-Process ≥3 次, 且每次拉起的 PID 在下一 tick 已不存在**(= 拉起即死) ⇒ 进 `CRASH-LOOP` 态: **停止一切 Start-Process + 告警**。这正是 8/23「kaspad 0xc0000409 每次同偏移确定性崩 + watchdog 反复拉」那族。
   - 🔴 **告警到达性(NWT v0.4): "停到人工清零"不能只靠一条会断的通道**。8/23 那条告警若走 dev 频道(:3200 console)= 正断的那条 → "直到人工清零" + 无人值守 = **无限期躺**。三件一起:
     - **本地红旗文件** `D:\kaspa-tn12-data\kaspad-CRASH-LOOP.flag`(写入时刻 + starts[] 快照): 进 CRASH-LOOP 即写; **探针每 tick 先读它, 红旗在就直接拒拉**(不依赖内存里的 starts[] 跨进程, 一次性探针进程本就无记忆)。人工清零 = 删这个文件。
     - **不依赖 console 的告警通道(至少一条)**: (a) owner-bot 直发 Telegram(不经 :3200), 或 (b) 写一条 **Windows 事件日志 Error 级**(`eventcreate /L APPLICATION /T ERROR /ID 823 /SO KANet-kaspad-watchdog /D "CRASH-LOOP ..."`), 运维可 `Get-WinEvent` grep。**不把 dev 频道当唯一告警出口**(= 记忆 reference-the-coordination-channel-dies-with-the-chain 同族: 报告通道与故障源同生共死)。
     - 保留 dev 频道告警作**第三条**(能通时最省事), 但它不是唯一。

**判据(v0.2 立)**: watchdog 的第一要务是**不制造次生 OOM**, 不是"尽快拉活"。宁可一个真死的 kaspad 多躺 10 分钟等操作员, 不可在缺内存的机器上再砸一个大进程把整机带走。原 §0 的三态升级(下文)在此闸之下才谈。

## §1 现象与第一手证据 `[MEASURED]`

### 1.1 watchdog 误判重启实录(`D:\kaspa-tn12-data\kaspad-watchdog.log`, 2026-08-26)
```
16:27:00 kaspad watchdog started (...)
16:29:25 kaspad DEAD (>=3 consecutive probe fails) -> ... starting canonical    → new PID=22428   ← 这个活到现在(IBD 中)
16:32:35 kaspad DEAD (>=3 consecutive probe fails) -> ... starting canonical    → new PID=30936   ← 撞 LOCK 秒死
16:35:44 kaspad DEAD (>=3 consecutive probe fails) -> ... starting canonical    → new PID=31688   ← 撞 LOCK 秒死
16:38:52 kaspad DEAD (>=3 consecutive probe fails) -> ... starting canonical    → new PID=14836   ← 撞 LOCK 秒死
16:39:00 post-start probe still not-alive code=3: DEAD:empty-data:daa=0 (likely still starting / IBD; re-evaluate next tick)
(之后无新条目 = J1 已 Disable 计划任务, 与 ledger (624) 吻合)
```
- 每 3 tick(60s×3=3 分钟)一次, 每次拒因都是 `code=3: DEAD:empty-data:daa=0`。
- 全文件 `kaspad DEAD` 累计 **19,306 行**——历史上同一族误判的规模(与 watchdog.ps1:68 注释里 "18074 次假 DEAD" 是同一条病的延续)。
- 被误拉的进程死因: `kaspad-stderr.log`: `panicked ... Failed to create lock file: ...\datadir\meta/LOCK: being used by another process`。"只启不杀"守住了活节点, **但不是无害**(见 1.3)。

### 1.2 活节点 22428 确实在同步
- 进程: `Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'"` ⇒ 唯一 PID 22428, CreationDate 16:29:25(= watchdog 16:29:25 那次拉起的), 父进程已不在。
- `kaspad-stdout.log` 持续 `Downloaded N headers from the pruning point chain segment`: 16:39:30 N=7000 → 20:32:37 N=233000, 共 227 行, **≈16 headers/s ≈ 58k/h**, 每 ~35s 一行。
- RPC `getConnectedPeerInfo`: 1 个 peer `136.243.93.17:16311` **`is_ibd_peer: true`**, time_connected 14,657s(≈4h, 稳定); 另有 3 个 outbound peer 每 ~10s 被 `connection reset` 循环重连(不影响 IBD peer, 记录备查)。
- **RPC 在这个阶段的读数(全部为 0, 且两次采样 8s 间不变)**:
  | 来源 | 字段 | 值 |
  |---|---|---|
  | getInfo | isSynced | **false** |
  | getInfo | serverVersion / isUtxoIndexed / p2pId | 1.1.1-toc.1 / true / c1d31eca…(有值=RPC 真在答) |
  | getBlockDagInfo | network | testnet-12 |
  | getBlockDagInfo | headerCount / blockCount / virtualDaaScore | **0 / 0 / 0** |
  | getBlockDagInfo | pastMedianTime | 1633687894966(=2021-10-08 genesis ⇒ 「全新库」指纹) |
  | getBlockDagInfo | sink == pruningPointHash | 300fe020…(virtual 还坐在 pruning point 上) |
  | getMetrics.consensusMetrics | nodeHeadersProcessedCount / nodeDatabaseHeadersCount | **0 / 0**(这一阶段下载的 header 不计入) |
  | getMetrics.processMetrics | diskIoReadBytes / diskIoWriteBytes | 9.40 GB / 3.16 GB, diskIoWritePerSec 335(**单调增, 会动**) |
  | getMetrics.connectionMetrics | activePeers | 1 |
  | getSyncStatus | isSynced | false |

  🔴 **结论**: 「两次采样间 headerCount/blockCount 是否增长」在 pruning-point-chain-segment 阶段**不可用**(全 0 不动)。真正会动的只有: ① 进程/连接层(PID 稳定、IBD peer 在)② `diskIoWriteBytes`/`diskIoReadBytes` 累计计数 ③ 非 RPC 的 `kaspad-stdout.log` 增长。后续阶段(header 处理/body 下载/UTXO 导入)那些计数器才开始动——判据必须对**所有阶段**成立, 不能只对今天看到的这一段成立。

### 1.3 误拉不是无害: 活节点日志被截断 `[MEASURED + INFERRED]`
- `kaspad-stdout.log` **首行是 16:38:52 PID 14836 的 LOCK panic**, 而活节点 22428 起于 16:29:25 ⇒ 22428 前 9 分钟的启动日志**不在该文件里**。
- 文件内含 **89,322 个 NUL 字节**(`tr -cd '\000' | wc -c`), `grep` 视其为 binary。`[INFERRED·中置信]` = watchdog 给新进程的 `-RedirectStandardOutput` 指向同一路径并截断了它, 22428 的旧句柄继续按原 offset 写 ⇒ 中间留 NUL 空洞。
- ⇒ "只启不杀, 最坏拉一个秒死进程" 这条安全论证**漏了日志副作用**: 每次误拉都丢活节点一段日志 + 污染文件。8/23 那种真崩溃取证正靠这份日志。

## §2 根因(读码) `[READ]`
- `kaspad-rpc-probe.mjs:75-78`: `if (!(daa > 0n)) die('empty-data:daa=…', 3)`。注释原意是「答了但数据不是合理正数=口通数据没回」, 但 IBD 早期 `virtualDaaScore` **合法为 0**——它是"未同步"不是"没数据"。二者被塌成同一个退码 3。
- `kaspad-watchdog.ps1:103`: `code ∈ {2,3,4,5} → 'Fail'` 计入 `$failCount`; `:132` 满 3 → Start-Process。IBD 期每 tick 必 Fail ⇒ 每 3 tick 必拉一次, 直到 daa>0(可能数小时~一天)。
- `:144` 的 post-start 提示语 "likely still starting / IBD; re-evaluate next tick" 说明作者**知道**有 IBD 态, 但只在日志文案里承认、没进判据——文案与判据脱节。
- 8/23 同形: 那次是真崩(0xc0000409)→拉起→再崩, watchdog 同样没有"连续拉起 N 次都活不过 M 秒就停手"的刹车。本稿主修 IBD 误判, 刹车列为 §6 附带建议(可分开审)。

## §3 判据设计: 三态四层 `[DESIGN-CHOICE]`

### 3.1 四层证据(自下而上, 每层只回答一个问题)
| 层 | 问题 | 采集(非提权即可) | 判定 |
|---|---|---|---|
| L1 进程 | 我们那台 kaspad 进程在不在、是不是同一个 | `Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'"` 取 (PID, CreationDate)。**不用 CommandLine**(SYSTEM 进程非提权读到 null, 今日 35/35 实证) | 无进程 ⇒ **DEAD:no-process**; 有 ⇒ 记 (PID, CreationDate) 入状态文件, 与上次比: 同 ⇒ 稳定; 变 ⇒ 记 `restarted`(不判死, 但计入 §6 刹车) |
| L2 RPC 口 | 端口通不通、会不会答 | 现有 `connect()` + `getInfo()`(+超时) | connect 失败 ⇒ **DEAD:connect-fail**(5); 超时 ⇒ **DEAD:timeout**(4); 答了 ⇒ 进 L3 |
| L3 身份 | 是不是我们那台 TN12 | `getBlockDagInfo().network === 'testnet-12'`(现有) | 不符 ⇒ **DEAD:wrong-network**(2) |
| L4 同步态 | 同步完没有; 没完的话在不在动 + **R6 utxoindex 可读到(外锚)**(3.2b) | `getInfo().isSynced`; 进度计数器(3.2); R6=A1∧A2(**不含 isUtxoIndexed**——它是配置开关非建成状态, F-B) | **ALIVE ⟺ isSynced==true ∧ R6 通过**(见 3.2b 那句话); isSynced==true 但 R6 不过 ⇒ SYNCING(utxoindex-pending); isSynced==false ⇒ 看 3.2 |

### 3.2 SYNCING vs SYNC-STALLED: 「进度」的定义
探针**必须持久化上次采样**(一次性进程没有记忆), 状态文件 `D:\kaspa-tn12-data\kaspad-probe-state.json`(路径可 env 覆盖 `KASPAD_PROBE_STATE`), 内容:
```json
{ "ts": <epoch ms>, "pid": 22428, "created": "2026-08-26T09:29:25Z",
  "headerCount": 0, "blockCount": 0, "daa": 0,
  "hdrProcessed": 0, "dbHeaders": 0, "diskWrite": 3155473835, "diskRead": 9400287517,
  "ibdPeer": true, "activePeers": 1, "lastProgressTs": <epoch ms> }
```
🔴 **MF-1(NWT 必修 + F-D 跨稿统一): 进度分两层, `diskIoWriteBytes` 永不抑制 STALLED。**
NWT 指出 `diskIoWriteBytes` 可被 **RocksDB 后台 compaction 伪造**——一个共识已卡死(不再处理任何块)的节点, 其 RocksDB 仍可能因 compaction 持续写盘 ⇒ 若把 diskWrite 当进度, 卡死 IBD 会**永报 SYNCING、永不 STALLED**。修法 = 两层分离:
- **L-共识(硬判据, 唯一决定 STALLED)**: `headerCount` · `blockCount` · `virtualDaaScore` · `pruningPointHash` · `nodeHeadersProcessedCount` · `nodeDatabaseHeadersCount` · `nodeDatabaseBlocksCount`。**任一相对状态文件严格增大 = 有共识进度** ⇒ `lastConsensusProgressTs = now`。
- **L-io(仅调告警节奏, 不参与 STALLED 判定)**: `diskIoWriteBytes`。它动 ⇒ 说明进程没完全僵死(还在写盘), 可把 SYNC-STALLED 的**告警从 error 降为 warn**(区分"卡但进程活"vs"卡且盘也不动"); 但**不重置** `lastConsensusProgressTs`, 不阻止 STALLED。
- **判定**:
  - **L-共识有进度** ⇒ verdict **SYNCING**(退码 **7**), stdout `SYNCING:phase=<推断阶段> daa=… hdr=… ibdPeer=… since=<lastConsensusProgress 距今秒>`。
  - **L-共识 `now - lastConsensusProgressTs > STALL_MS`**(默认 **60 min**, env `KASPAD_PROBE_STALL_MS`; NWT 定 60min) ⇒ **SYNC-STALLED**(退码 **8**), 告警级别 = diskWrite 也停→error / diskWrite 仍动→warn。
  - **L-共识无进度但未超 STALL_MS** ⇒ 仍 SYNCING(计数器粒度粗, 一两个 tick 不动正常)。
- `[DESIGN-CHOICE]` 为什么 diskWrite 从"兜底进度"降为"仅告警节奏"(v0.1→v0.2): v0.1 拿它当进度信号是错的——它恰恰在"共识卡死但 RocksDB 还在 compaction"这个最需要报 STALLED 的场景下**制造假 SYNCING**。共识计数器才是"节点真在往前走"的唯一硬证。
- `[DESIGN-CHOICE]` **不用** `kaspad-stdout.log` 文件增长做探针判据: 它是 watchdog 重定向的产物, 1.3 证明它会被截断/污染, 且 Bettor 的独立采样进程没有它的所有权语义。可作为**人读**的旁证(§7)。
- 状态文件缺失/损坏 ⇒ 当作第一次采样: 只写不判, 本次回 SYNCING(退码 7, reason `first-sample`)——**fail-open 向 SYNCING 而不是向 DEAD**, 因为误判 DEAD 的代价(拉进程/毁日志)远大于晚一个 tick 判死。

### 3.2b ALIVE 的完整定义 = R6「UTXO 集可用」(Bettor E-bis + NWT F-A/F-B/F-C, 2026-08-26)
🔴 **F-A(NWT headline, 已改退码定义, 不只加段落)**: ALIVE(退码 0)的定义**直接含 R6**——`isSynced && virtualDaaScore>0` **还不够**, 必须 utxoindex 真能读到。§3.2b 与 §3.3 退码 0 **用同一句话**(下方即那句话, §3.3 表格引用它, 不另写):
> **ALIVE(0) ⟺ network==testnet-12 且 isSynced==true 且 R6 通过**; R6 = 「utxoindex 可用」= A1 ∧ A2(下)。R6 不过 ⇒ **SYNCING(7, `phase=utxoindex-pending`)**, 绝不 ALIVE。

`[MEASURED·J2 8/26]` IBD 期 relay `get_address_utxos` 对已知持币地址回 `{"ok":true,"utxos":[]}`(空集不报错), `chain_get_current_daa_score` 回 0 ⇒ **headers 下完 / `isSynced` 翻 true 都不等于 utxoindex 可查**。R6 两条:
- **A1** `virtualDaaScore > 80,095,687`(8/22 实测下界; env `KASPAD_PROBE_MIN_DAA` 可抬, 只许抬不许降);
- **A2** **对照集**任一非空: 对 `KASPAD_PROBE_CONTROL_ADDRS`(≥2 独立长期持币址, 见 F-C)逐个 `getUtxosByAddresses`, **任一 ≥1 条即过**; 全空按 F-C 三态判(不直接 fail)。

✅ **F-B(J2 已核 @rusty-kaspa 7b1e18cc = live 二进制, R6 定性冻结)**: 关键结论 = **节点给不了『索引已建成』的牙, R6 的承重全在外锚 A1∧A2**。J2 源码事实: ① utxoindex 重建对**读者原子**(write 锁持有期间读者拿不到半建态) — 所以不存在我 v0.2 担心的"逐地址异步填充"半建态; ② 但 RPC 同步闸(`service.rs:697-703`)**只盖"UTXO 集导入→anticone 验完"这一段**, header 下载阶段索引"空且自洽"是**合法**的、会正常答 `[]`; ③ helper `unwrap_or_default` 会把 store 层错误**吞成空集**(空集 ≠ 一定没有)。⇒ 综合: 节点**不会**在 RPC 上暴露一个可信的"utxoindex 全量可查"布尔, 所以 R6 不能靠节点内部状态, 只能靠**外锚**(A1 daa 下界 ∧ A2 对照集非空)自己判。⇒ **R6 从 `[MUST-VERIFY]` 改为 `[已核·CONFIRMED]`**, 不再是落码阻塞项。
✅ **F-C(J2 已核, 对照集定义冻结)**: A2 返回 `[]` 分不出"索引没建好"与"地址被花光"。J2 结论: **『不可花费永久 UTXO』不存在**(三候选全否 — xzztw 死 spine / 137 pruned spine / OP_RETURN, 逐个证否)。改用两条:
  1. **对照集 = ≥2 个独立长期持币址**(`KASPAD_PROBE_CONTROL_ADDRS`, 逗号分隔): 默认 = ①矿址 `kaspatest:qrys4yax…`(MiningRelay-tn12-new) + ②pruned spine `kaspatest:pzrhg8y8n3txuk39vxnvpe5da2spnmgfhknumlwcyh6t7nkqv449ql4swe79q`(J2 定, 见 §10); **任一非空即 A2 过**; **全空 = UNKNOWN(不判 DEAD, 也不放行 ALIVE), 告警交操作员**(见下 F-C 三态)。被回收/花掉时换址(运维维护, 非烤死)。**优先不用 MiningRelay-tn12-new 源址做唯一对照**: 它是 1M 转账要花的地址 — 虽然花掉 1M 后它仍持 10 亿级 KAS 不会空, 用它不会假 SYNCING(此点 J2 纠正了我 v0.2 的过度担心), **但它参与钱路、余额会动**, 用一个不参与钱路的址做基准更稳; 保留它作对照集**成员之一**即可。
  2. **负例交叉改 J2 三态**(替代 v0.2 的 isUtxoIndexed 交叉 — isUtxoIndexed 是配置开关非建成状态, **删**): A2 全空时按 RPC 真实信号分三态: (i) RPC 报 `ConsensusInTransitionalIbdState` ⇒ `utxoindex-pending`(SYNCING 7); (ii) `daa ≤ 下界` ⇒ `pre-utxoset`(SYNCING 7); (iii) `daa > 下界 ∧ isSynced ∧ 对照集全空` ⇒ `control-set-drained?`(**UNKNOWN, 告警交操作员核对照址是否被花/换址**, 既不 SYNCING 永卡也不 ALIVE 放行钱路读空)。
- `[DESIGN-CHOICE]` 对照臂的意义 = 区分"索引空"与"地址空": 没有 A2, utxoindex 未建好的节点会对**所有**地址回空集而不报错, 探针把它当 ALIVE 放行, 下游把"没读到"当"没有"。A2 失败不计入 DEAD(节点没坏, 是还没好), 只压 SYNCING。
- 退码: R6 不过仍回 **7 SYNCING**(`utxoindex-pending`), 与 watchdog、runbook §4 P1b 同一把尺。

### 3.2c KNOWN 残余: ALIVE 不证"某址这次读得对"(NWT v0.4·per-query 空集) `[已核·CONFIRMED]`
🔴 **一条 A1/A2/探针都挡不住的残余**: `service.rs:257-275` 的 `.unwrap_or_default()` 是 **per-query** 的 — 即使 utxoindex 健康、A2 对照集非空、探针判 ALIVE, **某个结算址在某一次查询遇到瞬时 store 错误, 那一次仍返 `[]`**, 读成"没钱"。这与"索引没建好"是两码事: 索引全好, 只是这一次读坏了。探针是**节点级/对照址级**的健康证明, 证不了"我关心的这个地址这一次读对了"。
- **判据(v0.4 立)**: **ALIVE 只证"索引建好", 不证"某址这次读得对"**。
- **钱路关键读必须二源交叉**(不接受单次单源):
  - 转账 runbook 的 G1–G4 源余额/UTXO 复读(§4 P1b/P3);
  - settle / refund 前的余额读。
  二源 = **二次独立查询(隔开时间, 都非空且一致)** + **kaspa_tx_log 或直连 kaspad 第二 vantage** 交叉。单次返 `[]` 绝不作为"没有"的结论 — 可能正是这次 store 错。
- **归属**: 探针/watchdog **不**负责消除这条(它是 RPC helper 的 per-query 脆性, 属钱路读取方的纪律); 本节只钉出"ALIVE 的边界"并把二源交叉要求同步进转账 runbook §4。
### 3.3 退码总表(在现有 0/1/2/3/4/5/6 上**只加不改**, 老消费者不被改变语义)
| 码 | 词 | 含义 | watchdog 动作 |
|---|---|---|---|
| 0 | ALIVE | **= 3.2b 那句话**: network==testnet-12 ∧ isSynced==true ∧ R6(A1 daa>下界 ∧ A2 对照址非空)。**不是** isSynced&&daa>0——那漏了 utxoindex 可用 | failCount=0 |
| 2 | DEAD:wrong-network | 连上但不是 TN12 | Fail(计数) |
| 3 | DEAD:empty-data | **收窄**: 答了、isSynced=**true**、但 daa 不是正数(真"数据坏") | Fail(计数) |
| 4 | DEAD:timeout | RPC 超时 | Fail(计数) |
| 5 | DEAD:connect-fail | 连不上 | Fail(计数) |
| 6 | UNKNOWN 依赖缺失 | 探针自身坏 | 不计数(现有) |
| **7** | **SYNCING** | RPC 答、身份对、isSynced=false、有进度或未超 stall 窗 | **failCount=0, 永不 Start-Process, 单独日志行** |
| **8** | **SYNC-STALLED** | isSynced=false 且 > STALL_MS 零进度 | **不 Start-Process**(拉新进程撞 LOCK 无意义); **告警**(日志 WARN + 可选 `j1-watchdog-alert.sh` 通道), 交操作员判 |
| **9** | **DEAD:no-process** | L1 进程枚举为空 | Fail(计数)——这是**唯一**该拉进程的形态, 与 5 并列 |
| 1 | 其它 | 现有 | Unknown |

🔴 退码 3 收窄是**行为变更**(存量 `daa=0 && !isSynced` 从 3 → 7): 这正是本稿要的效果, 但按 lint-域「存量判定逻辑改动 = verdict-before-push」纪律, 落码后须 NWT diff GREEN 才推。

### 3.4 watchdog 消费端最小改动(spec, 不落码)
- `Probe-Tn12Node` 返回增加 `Verdict='Syncing'`(code 7) / `'Stalled'`(code 8); `:103` 映射表加两行; 主循环: Syncing ⇒ `$failCount=0` + `Log "kaspad SYNCING ..."`(每 tick 一行太吵 ⇒ 每 10 tick 或 verdict 变化时记一次); Stalled ⇒ `Log WARN` + 不计数 + 不拉。
- **Start-Process 前的闸序(v0.2·MF-2 顺序修正)**: 三道闸**依次**过, 任一不过就不拉——
  1. 🔴 **内存闸(§ 0.5 闸1, 最先)**: `FreeVirtualMemory < KASPAD_MIN_FREE_COMMIT_GB` ⇒ `refuse-start:low-commit`, 不拉。**必须排在进程闸前**——8/23 形态是进程已 OOM 崩退(进程闸看不到它=放行), 但机器仍缺内存, 这时拉一个新进程正是压垮点。内存闸独立于"进程在不在"成立。
  2. **crash-loop 闸(§ 0.5 闸2)**: 处于 CRASH-LOOP 态 ⇒ 不拉 + 告警。
  3. **进程闸**: `if (Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'") { continue }`(kaspad.exe 在就不拉)。今天四次误拉全撞 LOCK 秒死, 这道闸零成本挡掉整族。`[DESIGN-CHOICE]` 它单独牺牲的场景 = "进程在但完全僵死(RPC 永不答)"——只启不杀本来也拉不起来(LOCK), 真解是提权 kill(J1/Owner), watchdog 该**告警**不硬拉。
  🔴 **v0.1 只有第 3 道闸, NWT 指出它对 8/23 无效(进程崩退后看不到→放行→再拉 30GB)。v0.2 把内存闸放到最前是本次 MF-2 的核心。**
- 日志重定向: 新进程的 stdout/stderr 路径改为带 PID/时间戳(`kaspad-stdout.<yyyyMMdd-HHmmss>-<pid>.log`), 不再复用同一路径 ⇒ 根治 1.3 截断。旧路径可留 symlink/最新副本给现有读者(J2 sampler 等读 `kaspad-stdout.log` 的脚本需列清单: `grep -rl "kaspad-stdout.log" scripts/ scratch/` 落码前做)。

## §4 IBD 阶段推断(给 SYNCING 的 `phase=` 字段, 纯展示、不参与判定) `[INFERRED]`
| 观测 | phase |
|---|---|
| headerCount=0 && blockCount=0 && sink==pruningPointHash | `pp-chain-headers`(今日所在) |
| nodeHeadersProcessedCount>0 && blockCount==0 | `headers-processing` |
| blockCount>0 && daa 增长 && !isSynced | `bodies/utxo` |
| isSynced ∧ daa>0 ∧ R6 通过 | (ALIVE) —— isSynced∧daa>0 但 R6 未过 = utxoindex-pending, 仍 SYNCING |
只做展示是因为 rusty-kaspa 的 IBD 内部阶段没有 RPC 字段直接暴露(`getSyncStatus` 只回 bool), 推断表若错只影响文案不影响 verdict。

## §5 采样节奏与阈值 `[DESIGN-CHOICE]`
- watchdog tick 60s 不变; STALL_MS=30min ⇒ 最快 30 tick 后才可能报 STALLED。今日实测每 ~35s 一次 1000-header 进度, diskIoWrite 每 tick 必动 ⇒ 正常 IBD 下 STALLED 误报概率极低。
- Bettor 5 分钟一采的独立采样与 watchdog 共用状态文件是安全的: 进度定义是「相对**上一次任何人**的采样严格增大」, 交错采样只会让 `lastProgressTs` 更新更频繁, 不会制造假 STALLED。**但状态文件写入须原子**(写临时文件再 rename), 防两个采样者互相读到半截 JSON。
- 状态文件由 SYSTEM(watchdog)写、ADMIN(Bettor)也写 ⇒ 落码时验一次 ACL(SYSTEM 建的文件 ADMIN 能否覆写); 不能则各用各的路径(env 覆盖), 判据不受影响。

## §6 附带建议(可分开审, 不阻塞本稿)
- 🔴 **拉起刹车(原列为可选)已升 REQUIRED 并移至 § 0.5 闸2**(NWT 纠正: 这是危害最大的一条, 不是附带)。§ 0.5 是本稿最高优先层, 不再放这里。
- `kanet-start.sh` llama-server `--ctx-size 1048576` 是 (624) 点名的内存放大器, 不在本稿域, 只记一句提醒。

## §7 验证方法与测试计划(落码前预注册, 供 NWT 审判据)
### 7.1 今日实测命令(全部只读, 可复跑)
- 进程/父子: `Get-CimInstance Win32_Process -Filter "ParentProcessId=27412"`(35 子进程 CommandLine 全 null ⇒ 非提权盲区实证); 反查法 = `logs/console.log` 启动段 `[relay-manager] Started <name> relay (PID n)` 等行逐 PID 对表(35/35 对上: 1 adapter + 32 relay + tg-bot + broker-bot), 与 `relay_nodes` 32 行 1:1。**这条方法要进 watchdog/探针的排障手册: 非提权环境判 SYSTEM 子进程身份, 用启动日志的 PID 记录, 别用 CommandLine。**
- kaspad 进程: `Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'" | Select ProcessId,ParentProcessId,CreationDate`。
- RPC 字段: `scratch/_kanetui_rpc_fields.mjs`(kaspa-wasm Borsh, ws://127.0.0.1:17210; getInfo/getBlockDagInfo/getConnectedPeerInfo/getMetrics/getSyncStatus, 两次采样间隔 8s)。原始输出见 §1.2 表。
- 日志: `grep -a "Downloaded .* headers" D:\kaspa-tn12-data\kaspad-stdout.log | sed -n '1p;$p'`; `tr -cd '\000' < kaspad-stdout.log | wc -c`。
### 7.2 落码后的验收(预注册, 零 inconclusive)
| # | 场景 | 构造 | 预期 |
|---|---|---|---|
| V0 对照臂 | 当前 IBD 节点(22428) | 直接跑新探针两次, 间隔 ≥60s | 第 1 次 `SYNCING first-sample`(7), 第 2 次 `SYNCING`(7, diskWrite 增); **绝不**出 3 |
| V1 | 真 DEAD: 无进程 | 用 `KASPAD_PROBE_URL=ws://127.0.0.1:1` 指向空端口 **且** 探针进程枚举 mock 为空(单测层)——**不停活节点** | 9 或 5 |
| V2 | ALIVE 完整态 | isSynced=true ∧ daa>0 ∧ R6 通过(对照址非空) — 等 IBD 完成 / J1 :3400 已同步节点 | ALIVE(0) |
| V2-rev(F-A 反例臂) | isSynced=true ∧ daa>0 但 **utxos=[]**(utxoindex 未建好) | 单测/半建态节点: R6 的 A2 空 | **SYNCING(7, utxoindex-pending)**, **绝不 ALIVE(0)** — 这正是今天钱路读空的态 |
| V3 | STALLED | 单测: 喂状态文件 `lastProgressTs = now-31min` 且所有计数器相同 | 8 |
| V4 | 收窄后的 3 | 单测: isSynced=true, daa=0 | 3 |
| V5 | 状态文件损坏 | 写入非 JSON | 7 `first-sample`, 且文件被重建 |
| V6 | watchdog 硬闸 | 单测 PS: mock 探针回 5 但 kaspad.exe 存在 | 日志 `refuse start`, 无 Start-Process |
| V7 | 变异臂(diskIo 不再兜底) | 单测: 共识计数器全冻 60min + `diskIoWriteBytes` **持续增**(模拟 RocksDB compaction) | **必报 SYNC-STALLED(8)** — 证明 diskIo 抑制不了 STALLED(MF-1); 若出 SYNCING = 回归 |
| V8(MF-1, NWT 点名) | 共识冻 + diskWrite 涨 → 必 STALLED | `hdr/blk/daa/pp` 60min 零增长, diskWrite 涨 | 8, 告警级=warn(diskWrite 仍动) |
| V-mem(MF-2 内存闸) | 缺内存拒拉 | 单测 PS: mock `FreeVirtualMemory` < 阈值 且探针回 9(no-process) | **日志 `refuse-start:low-commit`, 无 Start-Process** |
| V-loop(MF-2 刹车) | crash-loop 停手 | 单测 PS: 喂 `starts[]` = 15min 内 3 次且每次 PID 次 tick 即失 | 进 CRASH-LOOP, **停止 Start-Process + 告警** |
单测层用 `scripts/j1-watchdog-*.test.sh` 同族形态(已有 mutants/test 约定), 不新造框架。

## §8 边界 / 不做
- 不改 `--enable-unsynced-mining` 等 kaspad 参数; 不动 `KANet-KaspadWatchdog` 计划任务注册(提权, J1 域); 不做"自动 kill 僵死进程"(提权 + 铁律: 探针判错即杀活节点, 不可接受)。
- 不用 `kaspad-stdout.log` 做机器判据(§3.2 理由)。
- 本稿不解决 IBD 本身慢(58k headers/h)或 peer 每 10s reset 的问题——只记录, 归节点运维另议。
- **仍不做"自动 kill 僵死进程"**(提权 + 铁律)。但 v0.2 **新增**了"内存不足时拒拉"(§0.5)——这是"少做一个危险动作", 不是"多做一个动作", 与不 kill 的保守取向一致。

## §9 跟进: llm-watchdog 与 8/23 双开 llama(NWT 指派, 只读) `[MEASURED 2026-08-26]`
**问题**: NWT 报 8/23 19:14–19:16 llama-server 一度双开(≈65GB), 第二个谁 spawn 未坐实; 疑 `scripts/llm-watchdog.mjs` 的 `spawnLlama` 无端口守卫。
**结论: llm-watchdog 不是 8/23 双开的原因, 但它是潜伏隐患。**
- **它当时没在跑, 且本机无任何自动启动路径**: ① 现在没跑(进程枚举空); ② `logs/*.log` 无 `[watchdog] starting` / `llama-server spawned` / `[watchdog]` broadcast 任何一行(它一启动就打这些); ③ 无计划任务引用(schtasks 全量扫过, 只有 OS 任务); ④ 三个 launcher(kanet-start.sh / kanet-start-headless.sh / `scripts/kanet-boot-sequence.ps1`)都**不**起它——boot-sequence 只起 kaspad-watchdog + tn12-mining-watchdog; ⑤ 唯一引用它的是 test-framework(读源码做 anti-pattern 静态检查, 不运行它)。⇒ **它是一段"存在但没接线"的代码。**
- **但它确实是隐患(若被起)**: `spawnLlama`(llm-watchdog.mjs:45-56)**无 :8000 端口守卫**(两支 start 脚本起 llama 前都先 `netstat`/`curl` 判"已在跑就复用", 它没有), 且硬编码 `--ctx-size 1048576`。probe 用 3s 超时(:24)——OOM/重载压力下一次瞬时 fetch 超时就会误判 down → spawn 第二个 llama(加载 30GB 后才在 bind 上失败, 但那 30GB 的瞬时加载已经发生)。它的默认还全指向主网树(`KANET_ROOT=C:/kanet`, `CONSOLE_URL=:3100`)。⇒ **建议: 不要起它; 若将来要复用, 先补 :8000 守卫(照 start 脚本)+ 内存闸(同 §0.5)+ 改默认。**
- **8/23 真正的第二个 spawner 从 D: 树日志坐实不了**: supervisor 8/23 18–20h 只有一次 headless invoke(19:22Z, **晚于** 19:14 双开窗), 不是它。剩余候选(未坐实): (a) `C:/KANet` 主网树的 start 脚本(独立部署, 同机同 GPU 共用 :8000, ctx=262144)、(b) 手动/会话拉起、(c) 旧实例 OOM 后 Windows 未及时回收 30GB, 与一次重启的新实例瞬时叠加=65GB。**结构性根因 = :8000 有多个潜在 owner(两棵树×两脚本 + llm-watchdog)彼此不协调, 只有 start 脚本有守卫、而那守卫在负载致 curl 超时时 fail-open。** 这反过来又支撑 §0.5: 任何拉大进程的路径都必须内存感知。

## §10 请 NWT 重点打的地方(v0.2)
1. ~~**F-B(R6 MUST-VERIFY)**~~ **已由 J2 源码答复关闭**(见 §3.2b): 节点重建对读者原子(无半建态), 但 RPC 给不了"索引建成"的牙 ⇒ R6 承重全在外锚 A1∧A2, `[已核]`, 非阻塞。
2. ~~**F-C 对照集选址**~~ **已填(J2 定值, v0.4.1)**: `KASPAD_PROBE_CONTROL_ADDRS` = ①矿址 `kaspatest:qrys4yax…`(MiningRelay-tn12-new) + ②`kaspatest:pzrhg8y8n3txuk39vxnvpe5da2spnmgfhknumlwcyh6t7nkqv449ql4swe79q`。②是什么: 盘 `ext-pool-v07-1782816783831-cn5xn`(protocol_status=pruned_expired_waived, v0.7, 2026-06-30 建)的 `spine_p2sh` = spine_lock_tx `27dc482d…c68438` 的原始 100 KAS 输出。为什么合格: 100 KAS 中等、140 盘里 134 独占 spine 中最早建的、0 逻辑键注、claim-auto 候选零命中、不在 stuck 地图 §5 任何"要动"项; 只有 Owner 批的 pruned 回收会花它, 花了换下一个独占 spine(还剩 133 个)。出处(J2 自纠·逐字贴): ① `docs/iteration/COORD-LEDGER.md` 段(112):4930「33,735 KAS 卡在 137 个 protocol_status='pruned_expired_waived' 的盘里」② 同段:4931「140/140 命中,改 1 sompi ⇒ 0/140」——**这两条记的是【金额对合约字节】验证, 不是"链上未花"**; ③ `scratch/settle-truth/covenant-funded.json:2315`(2026-07-29~31 只读链查产物, 我 grep 核过该址在此行且全文件唯一命中)——**"未花"的唯一可引出处是 ③, 不是 ledger**。🔴 **ledger 不含"137/137 spine UTXO 仍是原始输出"那句**(我原稿抄错, 那句出自 J2 memory 非 ledger; grep COORD-LEDGER 零命中已证)。"134 独占 spine/最早建/还剩 133"是 J2 分析结论(非 ledger 逐字)。J2 已放进脚本包 `POSITIVE_CONTROLS` 第 3 项, 两边同尺。⚠ **是 7/30 链态; UTXO 集可用后须 run.cjs step4 重核这两址仍非空**(F-C 三态里"对照集全空=UNKNOWN 告警换址"正是为此)。
3. **MF-2 阈值**: `KASPAD_MIN_FREE_COMMIT_GB` 默认 8(kaspad)、35(llama 类)是否合理? crash-loop 判据"15min≥3 次且拉起即死"窗口/次数是否够严?
4. **MF-1 STALL_MS=60min**: 对 UTXO 导入等长时间无共识计数器变化的阶段是否偏短? 那时哪个共识计数器仍应在动未实测。
5. 退码 3 收窄 + 退码 0 含 R6 = 改存量语义, 须 verdict-before-push——我判是。
