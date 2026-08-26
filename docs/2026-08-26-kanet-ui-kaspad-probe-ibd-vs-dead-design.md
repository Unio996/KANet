# kaspad 探针「IBD 进行中」vs「真死」判据设计 — kaspad-rpc-probe.mjs / kaspad-watchdog.ps1（设计稿 · 零改码）

> **Status**: DRAFT v0.1 · KANet-UI 2026-08-26 主笔 · Bettor 派工(对等消息 20:2x) · **待 NWT 审, 过了才落码**。
> **域**: 运维/watchdog(KANet-UI 域, J1 在 ledger (624) 明确移交)。改动对象 = `scripts/kaspad-rpc-probe.mjs`(退码/判据) + `scripts/kaspad-watchdog.ps1`(消费退码)。**不碰任何钱路/产品码/console。**
> **触发**: 8/26 J1 换全新库后 kaspad 22428 IBD 中, 探针稳定回 `DEAD:empty-data:daa=0`; watchdog 按此 3 tick 判 DEAD 反复 Start-Process(第一手实录见 §1)。与 8/23 事故「崩→watchdog 拉起→再崩」同形(不同根因, 同一个 watchdog 缺"别拉"的判断)。
> **证据纪律**: 每条判据标 `[MEASURED·今日实测]` / `[READ·读码]` / `[INFERRED]` / `[DESIGN-CHOICE]`。实测全部为只读 RPC/日志/进程枚举, 命令与原始输出在 §7。

## §0 一句话

**现探针把「节点未同步」塌进了「数据空=死」**: 判据 `virtualDaaScore > 0` 在 IBD 的 header 下载阶段恒为 0(实测), watchdog 于是把一个正在健康同步的节点当尸体反复拉新进程。**修法 = 探针从二态(ALIVE/DEAD)升三态(ALIVE / SYNCING / DEAD), 且 SYNCING 由「进程稳定 + RPC 应答 + 跨采样有进度」三层证据判定; watchdog 对 SYNCING 永不 Start-Process。**

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
| L4 同步态 | 同步完没有; 没完的话在不在动 | `getInfo().isSynced`; 进度计数器(3.2) | isSynced=true 且 daa>0 ⇒ **ALIVE**; isSynced=false ⇒ 看 3.2 |

### 3.2 SYNCING vs SYNC-STALLED: 「进度」的定义
探针**必须持久化上次采样**(一次性进程没有记忆), 状态文件 `D:\kaspa-tn12-data\kaspad-probe-state.json`(路径可 env 覆盖 `KASPAD_PROBE_STATE`), 内容:
```json
{ "ts": <epoch ms>, "pid": 22428, "created": "2026-08-26T09:29:25Z",
  "headerCount": 0, "blockCount": 0, "daa": 0,
  "hdrProcessed": 0, "dbHeaders": 0, "diskWrite": 3155473835, "diskRead": 9400287517,
  "ibdPeer": true, "activePeers": 1, "lastProgressTs": <epoch ms> }
```
**进度 = 下列任一计数器相对状态文件严格增大**(全部是单调计数, 任一动即算动, 覆盖 IBD 全部阶段):
`headerCount` · `blockCount` · `virtualDaaScore` · `nodeHeadersProcessedCount` · `nodeDatabaseHeadersCount` · `nodeDatabaseBlocksCount` · **`diskIoWriteBytes`**(今日阶段唯一会动的 RPC 计数)。

- **有进度** ⇒ `lastProgressTs = now` ⇒ verdict **SYNCING**(退码 **7**), stdout `SYNCING:phase=<推断阶段> daa=… hdr=… ibdPeer=… since=<lastProgress 距今秒>`。
- **无进度且 `now - lastProgressTs > STALL_MS`**(默认 **30 min**, env `KASPAD_PROBE_STALL_MS`) ⇒ **SYNC-STALLED**(退码 **8**)。
- **无进度但未超 STALL_MS** ⇒ 仍 SYNCING(计数器粒度粗, 一两个 tick 不动是正常)。
- `[DESIGN-CHOICE]` diskIoWriteBytes 作为兜底进度信号的理由: 它是节点自报的累计写字节, 任何阶段的持久化都会推它; 代价是"节点在写垃圾也算进度"——所以它只兜底 SYNCING, 不参与 ALIVE 判定(ALIVE 仍要求 isSynced && daa>0)。
- `[DESIGN-CHOICE]` **不用** `kaspad-stdout.log` 文件增长做探针判据: 它是 watchdog 重定向的产物, 1.3 证明它会被截断/污染, 且 Bettor 的独立采样进程没有它的所有权语义。可作为**人读**的旁证(§7)。
- 状态文件缺失/损坏 ⇒ 当作第一次采样: 只写不判, 本次回 SYNCING(退码 7, reason `first-sample`)——**fail-open 向 SYNCING 而不是向 DEAD**, 因为误判 DEAD 的代价(拉进程/毁日志)远大于晚一个 tick 判死。

### 3.2b ALIVE 须含「UTXO 集可用」(Bettor E-bis 补, 2026-08-26)
`[MEASURED·J2 8/26]` IBD 期 relay `get_address_utxos` 对已知持币地址回 `{"ok":true,"utxos":[]}`(空集不报错), `chain_get_current_daa_score` 回 0 ⇒ **headers 下完 / `isSynced` 翻 true 都不等于 utxoindex 可查**。对 KANet 而言"活"的定义是**钱路能读到链上真相**, 所以 ALIVE 判据在 3.1 L4 基础上再加两条(缺一 ⇒ 仍 SYNCING, `phase=utxoindex-pending`):
- **A1** `virtualDaaScore > 80,095,687`(8/22 实测下界; 环境变量 `KASPAD_PROBE_MIN_DAA` 可抬, 只许抬不许降);
- **A2** **阳性对照址**非空: `getUtxosByAddresses([KASPAD_PROBE_CONTROL_ADDR])` 返回 ≥1 条(默认对照址 = `MiningRelay-tn12-new` 源址 `kaspatest:qrys4yax468rrm988kyqjtncvstcelgzktml0m3rvdvvktrll0gdxuyu34fru`, 链上长期持币; 对照址由 env 给、不烤死在码里, 换币址时改 env)。
- `[DESIGN-CHOICE]` 对照臂的意义 = 区分"索引空"与"地址空": 没有 A2, 一个 utxoindex 尚未建好的节点会对**所有**地址回空集而不报错, 探针会把它当 ALIVE 放行, 下游(结算 daemon / 转账前置)就会把"没读到"当"没有"。A2 失败不计入 DEAD(节点没坏, 是还没好), 只压在 SYNCING。
- 退码不变: A1/A2 不过仍回 **7 SYNCING**(reason 带 `utxoindex-pending`), 供 watchdog 与 runbook §4 P1b 同用一把尺。

### 3.3 退码总表(在现有 0/1/2/3/4/5/6 上**只加不改**, 老消费者不被改变语义)
| 码 | 词 | 含义 | watchdog 动作 |
|---|---|---|---|
| 0 | ALIVE | isSynced && daa>0 && network 对 | failCount=0 |
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
- **Start-Process 前加一道硬闸(与退码无关的兜底)**: `if (Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'") { Log "refuse start: kaspad.exe already present (PID …), probe verdict=… -- not starting"; continue }`。理由: 今天四次误拉全部撞 LOCK 秒死, 这道闸零成本挡掉整族, **即使探针判错也不再毁日志**。`[DESIGN-CHOICE]` 它牺牲的场景 = "进程在但完全僵死(RPC 永不答)"——那种情况 只启不杀 本来也拉不起来(LOCK), 真解只能是提权 kill(J1/Owner), watchdog 该做的是**告警**不是硬拉。
- 日志重定向: 新进程的 stdout/stderr 路径改为带 PID/时间戳(`kaspad-stdout.<yyyyMMdd-HHmmss>-<pid>.log`), 不再复用同一路径 ⇒ 根治 1.3 截断。旧路径可留 symlink/最新副本给现有读者(J2 sampler 等读 `kaspad-stdout.log` 的脚本需列清单: `grep -rl "kaspad-stdout.log" scripts/ scratch/` 落码前做)。

## §4 IBD 阶段推断(给 SYNCING 的 `phase=` 字段, 纯展示、不参与判定) `[INFERRED]`
| 观测 | phase |
|---|---|
| headerCount=0 && blockCount=0 && sink==pruningPointHash | `pp-chain-headers`(今日所在) |
| nodeHeadersProcessedCount>0 && blockCount==0 | `headers-processing` |
| blockCount>0 && daa 增长 && !isSynced | `bodies/utxo` |
| isSynced && daa>0 | (ALIVE) |
只做展示是因为 rusty-kaspa 的 IBD 内部阶段没有 RPC 字段直接暴露(`getSyncStatus` 只回 bool), 推断表若错只影响文案不影响 verdict。

## §5 采样节奏与阈值 `[DESIGN-CHOICE]`
- watchdog tick 60s 不变; STALL_MS=30min ⇒ 最快 30 tick 后才可能报 STALLED。今日实测每 ~35s 一次 1000-header 进度, diskIoWrite 每 tick 必动 ⇒ 正常 IBD 下 STALLED 误报概率极低。
- Bettor 5 分钟一采的独立采样与 watchdog 共用状态文件是安全的: 进度定义是「相对**上一次任何人**的采样严格增大」, 交错采样只会让 `lastProgressTs` 更新更频繁, 不会制造假 STALLED。**但状态文件写入须原子**(写临时文件再 rename), 防两个采样者互相读到半截 JSON。
- 状态文件由 SYSTEM(watchdog)写、ADMIN(Bettor)也写 ⇒ 落码时验一次 ACL(SYSTEM 建的文件 ADMIN 能否覆写); 不能则各用各的路径(env 覆盖), 判据不受影响。

## §6 附带建议(可分开审, 不阻塞本稿)
- **拉起刹车**: 状态文件记 `starts[]`(时间戳); 若 15 min 内 Start-Process ≥3 次且每次拉起的 PID 在下一 tick 已不存在 ⇒ 进 `CRASH-LOOP` 态: 停拉 + 告警。这是 8/23 那族(真崩→拉→再崩→commit charge 撑顶)的直接缓解, 与 IBD 误判是不同根因、同一缺口。
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
| V2 | isSynced=true 且 daa>0 | 等 IBD 完成后跑 / 或 J1 :3400 已同步节点 | ALIVE(0) |
| V3 | STALLED | 单测: 喂状态文件 `lastProgressTs = now-31min` 且所有计数器相同 | 8 |
| V4 | 收窄后的 3 | 单测: isSynced=true, daa=0 | 3 |
| V5 | 状态文件损坏 | 写入非 JSON | 7 `first-sample`, 且文件被重建 |
| V6 | watchdog 硬闸 | 单测 PS: mock 探针回 5 但 kaspad.exe 存在 | 日志 `refuse start`, 无 Start-Process |
| V7 | 变异臂 | 把 3.2 进度集合去掉 diskIoWriteBytes 后对今日节点跑 | 30 min 后必报 STALLED ⇒ 证明 diskWrite 兜底是承重的, 不是装饰 |
单测层用 `scripts/j1-watchdog-*.test.sh` 同族形态(已有 mutants/test 约定), 不新造框架。

## §8 边界 / 不做
- 不改 `--enable-unsynced-mining` 等 kaspad 参数; 不动 `KANet-KaspadWatchdog` 计划任务注册(提权, J1 域); 不做"自动 kill 僵死进程"(提权 + 铁律: 探针判错即杀活节点, 不可接受)。
- 不用 `kaspad-stdout.log` 做机器判据(§3.2 理由)。
- 本稿不解决 IBD 本身慢(58k headers/h)或 peer 每 10s reset 的问题——只记录, 归节点运维另议。

## §9 请 NWT 重点打的地方
1. 3.2 「任一单调计数器增大即进度」会不会被某种**假进度**骗过(例如 diskIoWriteBytes 因日志/压缩后台任务持续增长而永不 STALLED)? 若会, 兜底信号是否应改成 `diskIoWriteBytes 增 && (activePeers≥1 或 ibdPeer)` 的合取?
2. STALL_MS=30min 对 UTXO 导入等**长时间无计数器变化**的阶段是否偏短(那时 diskWrite 应仍在动, 但未实测)。
3. 3.4 硬闸「进程在就不拉」是否把某个真需要拉的场景挡死了(我列了一个, 请补)。
4. 退码 3 收窄是否算"改存量语义"须走 verdict-before-push——我判是。
