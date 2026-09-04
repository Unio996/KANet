# NWT 红队预列 — IBD 加速（Owner 812 直令）路 A / B 的清单 + 一条被漏掉的路 C

> NWT · 2026-09-04 17:0xZ · 输入 = ledger (811)(812) + Bettor 17:0xZ 派工 · 读数全我亲手跑（`/d/kaspa-tn12-data/kaspad-stdout.log`、`scripts/kaspad-watchdog.ps1:47`、`/d/rusty-kaspa` `git show 7b1e18cc:`、`scratch/_ibd_monitor.log`）。**只列判据不裁执行；执行 = Owner GO + 提权。**

## 0. 先于 A/B 的机制事实（改变问题形状）
| # | 事实 | 出处 |
|---|---|---|
| M1 | **TN12 剪裁窗 = 30 h**（`PRUNING_DURATION=108_000 s`），finality 12 h | `git show 7b1e18cc:consensus/core/src/config/constants.rs:70-73` |
| M2 | 本机 lag = 62 h（D 行 16:41Z）⇒ **任何正常同步的 TN12 节点，其剪裁点比我们的 tip 领先约 30 h** | `_ibd_monitor.log` 尾行 + M1 |
| M3 | 活二进制的 IBD 类型判定（`protocol/flows/src/ibd/flow.rs:245-310`）：先要求本地剪裁点是 syncer 已知链的祖先；再按 syncer 剪裁点分 **Aligned / Leading（syncer 剪裁点是本地剪裁点的后代）/ Lagging（在本地最近 4 个剪裁点内）**，都不是 ⇒ 错误 `…pruning point could not be easily recognized`。**Leading ∧ 本地无该剪裁点块体 ⇒ `IbdType::PruningCatchUp`**（:305/:308，handler :198）；Aligned/Lagging ⇒ `IbdType::Sync` = 从本地剪裁点起逐块下载（现状慢路） | 源码原文 |
| M4 | 本机 08-28 06:18Z 起库时：对 152.53.236.224 两次 `completed with error: …could not be easily recognized`，对 136.243.93.17 成功且 `syncing ahead from current pruning point` ⇒ **唯一能当 syncer 的是剪裁点与我们对齐/滞后的那台**（它多半是懒剪裁/归档形），**它成功恰恰因为它把我们锁进最慢的 Sync 模式** | log :21-82 |
| M5 | 09-03 起 87 条 `P2P, got reject message: …could not be easily recognized from peer: 70.178.95.86`（及同伴）——`got reject message` = **对方**在它的 IbdFlow 里把**我们**当 syncer 后拒绝 ⇒ 这三台（152.53.236.224 / 86.48.24.208 / 70.178.95.86，每小时被 reset 78–92 次）**不是已同步近端候选，而是想从我们同步、又认不出我们剪裁点的节点**（或同样落后的节点） | log 09-04 23:44 行 + `flow.rs:273` |
| M6 | 活二进制的 flag 名是 **`--add-peers` / `--connect-peers`**（`kaspad/src/args.rs:517-518`），不是 `--addpeer`；`--ram-scale`（:545）、`--reset-db`（:524）存在 | 源码 |
| M7 | 当前启动参数（watchdog 脚本形）`--testnet --netsuffix=12 --appdir=D:/kaspa-tn12-data --utxoindex --rpclisten-borsh=127.0.0.1:17210 --enable-unsynced-mining`，**无 ram-scale**（811 记漂移）；kaspad 35384 SYSTEM 起于 08-28 06:18Z，命令行非提权读不到 | `kaspad-watchdog.ps1:47` + CIM |
| M8 | datadir `D:\kaspa-tn12-data\kaspa-testnet-12` = 117 G（consensus 115 G · utxoindex 1.2 G · meta 24 M）；旁有 `kaspa-testnet-12.corrupt-20260826` 与两份 archive | `du` |

⇒ **问题形状**：不是"换个近的 syncer 把 191 ms 变 20 ms"，而是"**换一个 Leading 的 syncer 让活二进制走 `PruningCatchUp`，跳过中间 ~32 h 的块体**"。A 的收益上限取决于哪个 IbdType 会触发，不取决于 RTT。

## 1. 路 A（`--add-peers=<节点>:16311` 重启）红队清单
- A1 **候选须证明"已同步"且"我们认得它的剪裁点"**：`is_chain_ancestor_of(本地剪裁点, syncer 剪裁点)` 要成立，我们的 **header 链必须已含它的剪裁点**（本机 hdr 11.18 M vs blk 9.68 M，header 领先——先用 RPC `getBlock(其剪裁点 hash)` 在本机确认 header 存在）。候选必须走本机可验证的判据：对方 RPC `getServerInfo().isSynced==true` ∧ `getBlockDagInfo().pruningPointHash` 在本机查得到 header。**M5 那三台不合格**（除非另证）。J1 的 younio 节点：先答"isSynced / 二进制 commit / 剪裁点 hash"三项再上榜。
- A2 **预判 IbdType**：按 M3 手推：Leading ∧ 本机无其剪裁点块体 ⇒ PruningCatchUp（大赢）；Leading ∧ 有块体 ⇒ Sync（只省 RTT）；Aligned/Lagging ⇒ Sync（白赔相位）。设计稿须写出预判与"重启后 log 第一行 IBD 类型"的验收（`IBD started with peer X` 后跟 `syncing ahead`=Sync；PruningCatchUp 的日志形先从 `flow.rs:198` 段 grep 出来写进验收）。
- A3 **`--add-peers` ≠ 指定 syncer**：只是加进池；syncer 由谁先触发 IBD 决定。要"只用它"须 `--connect-peers`（排他）——排他又失去 M4 那台兜底。设计稿二选一并写清失败回退（连不上 ⇒ 回原参数）。
- A4 **相位代价与"不回退"**：08-28 重启精确先例 = "current pruning point 不变 + syncing ahead"，块不倒退（789 同）；header 相位 3.5–5.35 h（787/778）。但 **PruningCatchUp 路径会移动剪裁点**——"块不倒退"在这条路上不是承诺（老块体按设计被剪），验收改写为"新剪裁点 ≥ 旧剪裁点 ∧ sink 单调"。
- A5 **参数漂移一次修全**：重启参数以**提权读到的当前命令行**为基线（811 说 ram-scale 现漂移），`--ram-scale` 要不要带须 J1 量化结论；`--utxoindex` 必带（console/relay 依赖）；`--rpclisten-borsh=127.0.0.1:17210` 不变（M5/防火墙收窄同批）。
- A6 **谁重启、谁被杀**：kaspad 是 SYSTEM，非提权 `taskkill` 会 Access denied（08-30 教训）；用与起它同源的机制（J1 CIM Create / 计划任务）起，起前先确认 `KANet-KaspadWatchdog` 保持 Disabled，别让 watchdog 与人手抢。
- A7 **console 侧连坐**：kaspad 重启 ⇒ console 共享 RpcClient 断连 —— `reference-isolate-rpcclient-failure-from-node-failure`、08-30 wasm 中毒形；重启后核 console `getServerInfo` 恢复、heap-sample 续、M2/M-scout 门（若已落）读到 `isSynced=false` 正确跳过。hb_guard/supervisor 不因 kaspad 重启误判 console 死（curl 仍通）。
- A8 **Modern Standby / 断连** 老病照旧（`reference-win11-…modern-standby-kills-ibd`）；重启窗内别让机器睡。
- A9 **验收读数**：重启后 D 行 `blk` 不倒退（Sync）或剪裁点前移（CatchUp）、`IBD started with peer <目标>`、blkRate 两段不重叠窗对比现状 10–15 blk/s；30 min 内没进 IBD ⇒ 回原参数。

## 2. 路 B（整拷已同步同版本 datadir）红队清单
- B1 **源在哪**：812 未定；J1 的 younio 节点是唯一同域候选，但其自述 IBD 循环/内存病，且 D-015 注记它用过 `cfafeb4`（比 7b1e18cc 新 47 提交）——**二进制 commit 不逐字同 ⇒ RocksDB 列族/版本可能不兼容 ⇒ 直接否**。源须给 `kaspad --version` + 二进制 sha256（J1 r2 曾证 younio 7b1e18cc+sha `6D995C48…`，但那是 08-27，要重证）。
- B2 **一致性只认停机拷**：RocksDB 目录热拷 = 撕裂（WAL/sst 不同快照）；停源节点 → 拷 → 起。**源停机 = 源方也停服务**，代价归源方。热拷若不可避免须用 RocksDB checkpoint（源侧 `--` 无此 CLI，不成立）。
- B3 **拷什么**：整个 `kaspa-testnet-12/`（consensus + meta + utxoindex）一起；只拷 consensus 不拷 utxoindex ⇒ utxoindex 与 consensus 不一致 ⇒ 起不来或索引重建（`--utxoindex` 会重建？以源码为准，设计稿查 `utxoindex` 启动重建条件）。`meta` 含 multi-consensus 元数据（staging/active 指针）必须一起。
- B4 **网络后缀 / appdir 结构**：目标路径 `D:\kaspa-tn12-data\kaspa-testnet-12\{datadir,logs}` 与源逐层同名；`--netsuffix=12` 同；源若是 `--appdir` 不同只是父路径，子结构须同。
- B5 **剪裁点语义**：源是正常剪裁节点 ⇒ 拷来的库剪裁点 ≈ 源 tip − 30 h；console 侧 `spc_daa_index_coverage` 的 floor（settle-daemon `_coverageFloor` :532）与 pre-gate（deadline<floor 判不可达）会**前移** ⇒ 更多老盘被判不可达（现 11 个已被挡）——这是钱路可见后果，设计稿要列"floor 前移影响面"，不是零成本。`reference-tn12-pruning-wall-and-archival-semantics`：拷不回已剪的。
- B6 **校验**：文件数 + 总字节 + 逐文件 sha256（117 G 逐文件哈希是小时级，至少 sst 抽样 + `CURRENT`/`MANIFEST` 全哈希）；传输走 LAN 校验后再起。
- B7 **回滚**：旧目录 `mv` 为 `kaspa-testnet-12.pre-copy-<UTC>`，不删；起新库失败 ⇒ 改回名。磁盘：117 G × 2 + 拷贝中间态，D: 现余 768 G 够。
- B8 **起后**：与 A7/A9 同的 console 连坐核；`getBlockDagInfo` 剪裁点 hash 与源一致；utxoindex 可查（`getUtxosByAddresses` 对一个已知地址阳性对照）。

## 3. 被漏掉的路 C（`--reset-db` / 改名旧库 + 近端已同步 peer 全新 IBD）
- 与 B 同结果（剪裁点跳到近端 peer 的 −30 h），**不需要停任何别人的节点、不拷 117 G、不要求源二进制逐字同**（只要协议兼容）。成本 = headers proof + 剪裁点 UTXO 集 + ~30 h 块体（~1.08 M 块）——用近端 syncer 在 30–40 blk/s 量级是 **~8–10 h**，对比现状 ~5 天。
- 与 A 的关系：**A 若触发 PruningCatchUp ≈ C 的效果而不丢现有库**；A 若只触发 Sync 则 C 更快。设计稿应把 A 的 IbdType 预判作为分叉：CatchUp ⇒ A；Sync ⇒ C（旧库改名保留）。
- C 的红队项 = A1（peer 合格判据）+ A5–A9 + B5（floor 前移）+ B7（旧库保留）；另加 C1：全新 IBD 的 headers-proof 门（`flow.rs:322-336`）在**新库**上不会触发"spam 保护"拒绝（那段只对成熟的本地共识生效）。

## 4a. 17:1xZ 追加：Bettor 新读数（kaspad 1.05 核·内核态 66%·25.6k 读/s·145 MB/s·盘 idle 96%）的红队
- **结论先行**：CPU 钉在 ~1 核且 2/3 内核态 ⇒ 每块处理成本是瓶颈；**任何换 peer 的路都改不了 net ≈ 处理率 − 链速 ≈ 15 − 10 = 5 blk/s**；剪裁点跳跃（A2 CatchUp / 路 C）只是**一次性把缺口从 ~42 h 重置到 ~30 h**（省 ~1 天），不是持续加速。持续杠杆只有两个：每块 CPU 成本（内核态那 2/3）与并行度（rusty-kaspa 验证流水线是否真单线程 = J1 763 "单线程钉死"须以 CPU 计数器分核证）。
- **内核态 66% 的解释候选（按可判别性排）**：
  1. **每次 ReadFile 的固定开销**：0.69 核 / 25.6k 次/s ≈ **27 µs/次**——Win32 ReadFile 系统调用 + 过滤驱动栈 + 页缓存→用户态拷贝，这个量级本身就说得通（盘 idle ⇒ 全是缓存命中，不是等盘）。
  2. **Defender WdFilter 在栈上**：RTP 开、零排除（H4 已证）⇒ 每次读都过 minifilter。**判别 = M5 排除后同一计数器两窗对比**（零重启、可逆，正是该先做的实验）；预期量级我不给数——数据库型负载文献区间 10–40%，本机只认实测。
  3. **软页错误（Page Faults/sec）**：进程 5.2 GB WS 的 RocksDB 块缓存分配/释放会产生大量软缺页，计入 Privileged 时间。判别：`\Process(kaspad)\Page Faults/sec`——高 ⇒ 缓存尺寸/分配器问题（ram-scale 方向）；低 ⇒ 是 I/O 系统调用（Defender/pread 方向）。**这一个计数器把 (1)(2) 与 (3) 分开，先跑它。**
  4. RocksDB Windows env 的 `GetFileSize`/`NtQueryInformationFile` 风暴（每次读附带元数据查询）：判别 = ETW 或 `\Process(kaspad)\IO Other Operations/sec` 与 Read Ops 同量级。
  5. 网络栈：15 blk/s 收包量级可忽略；页缓存 memcpy 145 MB/s ≈ 0.02–0.05 核，不够解释 0.69。
- **`--ram-scale` 抬高的风险（源码 + 本机史）**：`storage.rs:84` 与 `daemon.rs:246` 把共识存储 LRU 缓存与 RocksDB 基础缓存按倍数放大，上限 10.0（`daemon.rs:110`）。本机在 3.0 下 kaspad WS 曾 12.5→14.7 GB、**系统 commit 58–60 GB / 总 61.6 GB**（supervisor 日志 08-28）⇒ 当时已贴顶；现在 26.7 GB free 是因为 console wasm 泄漏已治。**抬到 >3.0 = 先赌 commit 不过顶**；过顶 = 换页/内存压缩 = 内核态更高、更慢，且是 08-23 整机崩溃的同一方向。建议：先**恢复漂移丢掉的 3.0**（M7）而不是加码；加码只在 (3) 软缺页被证为主因且 commit 余量 ≥ 2× 增量时考虑；任何 ram-scale 变更都要重启赔相位（3.5–5.35 h），须与 A/C 的重启合并成一次。
- **顺序建议**：① Page Faults/sec + IO Other Ops 分核（10 min，零动作）→ ② M5 排除 kaspad 数据目录（零重启，两不重叠窗）→ ③ 若仍 CPU 钉死，把 ram-scale 恢复 3.0 与剪裁点跳跃合并为**一次**重启（A2 预判定 A 或 C）。

## 4b. 17:3xZ 追加：Bettor 分核读数（Page Faults 118/s 低 · IO Read 22.8k/s · **IO Other 29.8k/s** · MsMpEng 5%）⇒ 打开/关闭风暴假设 **成立（源码算术 + 句柄数两证）**
- **算术（全 `git show 7b1e18cc:`）**：Windows `fd_budget::limit()` = CRT `getmaxstdio`，`main.rs:27` 起动时 `setmaxstdio(DESIRED_DAEMON_SOFT_FD_LIMIT = 8*1024)`（`daemon.rs:53`；MSVC CRT 上限恰 8192）⇒ `fd_total_budget = 8192 − rpc_max_clients 128 − inbound_limit 128 − outbound_target 8 = 7,928`（`main.rs:28`，默认值 `args.rs:115-117`）⇒ `--utxoindex` 取 1/10 = 792（`daemon.rs:281-283`）⇒ 剩 7,136 ⇒ consensus factory `with_files_limit(fd_budget / 2)` = **3,568**（`factory.rs:329/367`，active 与 staging 均分）⇒ RocksDB `set_max_open_files(3568)`（`conn_builder.rs:158`）。
- **本机**：`consensus-006/` **17,402 个 .sst**（`find`）；kaspad 进程句柄总数 **4,144**（CIM，含线程/套接字/事件）⇒ 表缓存最多驻留 ~20% 的 SST ⇒ 其余每次读 = CreateFile + QueryInformation + Cleanup/Close 三四个 IRP，全计入 IO Other，与 29.8k/s ≈ 1.3× Read 吻合；Defender minifilter 在 **open** 时介入（MsMpEng 自身 5% 但过滤成本记在 kaspad 内核态）。
- **杠杆（按代价排）**：
  1. **M5 排除 kaspad 数据目录**：零重启；打在 30k 次/s 的 open 路径上，预期收益比"每读扫描"模型大得多——仍以两窗实测为准。
  2. **减少 SST 数量**：`--rocksdb-preset=hdd`（`rocksdb_preset.rs:94-95`：SST 目标 256 MB、各层同尺寸）会让 115 GB 收敛到 ~450 个文件 ≪ 3,568 ⇒ 表缓存全命中、open 风暴消失。**但**：只对新压实生效（存量 6.6 MB 小文件要等压实或手动 compact，115 GB 全压实 = 小时级 I/O）；`level_compaction_dynamic_level_bytes(true)`（:97）对既有库可能触发一次大重整；预设名叫 hdd 但 SST 尺寸那一条与介质无关，其余（写缓冲 256 MB、L0 一文件即压实、4 MB 预读）要逐条评估对 NVMe 的副作用。需重启。
  3. ~~`--rocksdb-cache-size=<MB>` 抬块缓存~~ **撤回（17:4xZ · J2 抓回、我核 `daemon.rs:238-256`）**：`configure_rocksdb` 只在 `matches!(preset, Hdd)` 时才算 `cache_budget`，`apply_default`（`rocksdb_preset.rs:60/66-73`）根本不收它 ⇒ **默认预设下 `--rocksdb-cache-size` 与 ram-scale 的块缓存倍率都是死开关**，块缓存 = RocksDB 库默认（小，具体值随 librocksdb 10.4 版本定，我未核数）。"256 MB × ram-scale"那句是我把 hdd 分支读成了通用分支，错。ram-scale 仍真实作用于**共识层 LRU 缓存**（`storage.rs:84-85`），那是应用层对象缓存，减 DB get 次数，不是块缓存。
  3′. **`--rocksdb-preset=hdd` 整包不宜作加速包**（J2 判、我核）：除 SST 256 MB 外还带 bottommost **ZSTD level 22**（`rocksdb_preset.rs` :39-48，极慢压缩，在 CPU 钉死的节点上是压实毒药）、bloom 18 bits、256 KB 块、dynamic-level 重整；J2 另报后台写限速 12 MB/s（我在 :76-170 grep 未见 `rate_limiter`，行号待 J2 指）。⇒ 减 SST 数这条在**钉版二进制**上没有干净的运行时开关。
  4. **抬 fd 预算**：Windows CRT 8192 是硬顶（`setmaxstdio` 上限），且 8192 是二进制里的常数 ⇒ 改它 = 重编译 = 换二进制（D-005 / 7b1e18cc 钉版）⇒ **不在本轮**。
- **顺序修正**：先 1（零重启、两窗），若 IO Other 与内核态同降 ⇒ 假设坐实；再把 2+3+ram-scale 3.0 恢复 + A2 预判合成**一次**重启。

## 4. 与 Owner 口径相关的一句
"换近端 peer 提速"的真实杠杆是 **IBD 模式（PruningCatchUp 跳块体）**而不是 RTT；现在唯一肯当 syncer 的那台正是把我们锁在慢模式里的那台。判 A 值不值，第一步不是测 RTT，是回答 A2。
