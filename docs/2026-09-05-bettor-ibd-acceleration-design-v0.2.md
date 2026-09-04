# TN12 IBD 加速 · 设计 v0.2

> **Status**: CURRENT · DRAFT-v0.2（Owner 直令 812「全力加快」· 输入 = ledger 811–823 + NWT precheck `docs/2026-09-04-NWT-redteam-ibd-acceleration-precheck.md` §1–§5 + J2 `scratch/_j2_kaspad_rocksdb_options_7b1e18cc_*.md`）· 待 NWT 复核 → Owner 两项决策
> 纪律：不热拷、旧数据不删、每步读数进 ledger、任何重启前 Disable watchdog/计划任务并核进程表只剩一个 kaspad（08-26 LOCK 三连实证）。

## 1. 结构性根因（已证）
- **R1** 08-26 全新 IBD 时全网唯一肯出 proof 的 syncer 136.243.93.17 给的剪裁点陈 9 天（块时间 08-17）⇒ 节点从 9 天前起逐块追，15 blk/s vs 链 10 blk/s，净 5 blk/s ⇒ 天然 2–3 周。（NWT §5·`kaspa-testnet-12/logs/rusty-kaspa.log`）
- **R2** 每块 ~65–70 ms 单线程，2/3 内核态 = 每秒 ~5.2 万次文件 I/O 系统调用：RocksDB `max_open_files=3,568`（二进制常数链 `daemon.rs:53`→`conn_builder.rs:158`）< 17,402 SST ⇒ 每读 open/close 风暴。盘 idle 96%、软缺页低、Defender 排除零效果（816）。
- **R3** syncer 断连 6 次/9.5 天，每次赔 1.5–5 h header 相位（`syncing ahead from current pruning point` 重下 header）；其它 3 台 peer = 对方拒我们，非候选（NWT §1）。
- **R4** header 相位期间 console 主线程停顿加重 ×2–4（823·同盘/RPC 争用·只记）。

## 2. 已判死 / 已试尽
| 路 | 结论 | 出处 |
|---|---|---|
| A `--add-peers` 近端 | 无 <80ms 候选；且收益看 IbdType 非 RTT | 813/814 |
| A2 找 Leading peer 触发 PruningCatchUp | 候选池 4 台全"对方拒我们"；查不到对方高度 | 814/J1 |
| B 整拷 datadir | 无本地/LAN 已同步节点；younio 二进制 cfafeb4≠7b1e18cc 格式不保证 | 813/NWT §3 |
| C 空库全新 IBD | 当前 peer 集只会再拿陈 9 天剪裁点 = 8 天从零重跑 | 819 |
| Defender 排除 | 零效果（Privileged 65.6 vs 64.9） | 816 |
| `--rocksdb-cache-size` / ram-scale 块缓存 | 默认预设下死开关 | 817/J2 |
| `--rocksdb-preset=hdd` | 整包否（12MB/s 写限速·256KB 块·ZSTD-22） | 815/817 |
| CPU 亲和 CCD0+High（窗 B） | kernel/块 −23% 但 user/块 +55%，净 −4%；B 混两变量 | 820/821 |

## 3. 仍在台面上的三项（按代价）
- **S1 B′ 单变量窗**：`0x000555`（每物理核一超线程）+ Normal，**只在 body 相位**做，带自动闸（`scratch/_bettor_affinity_guarded_window.ps1`·断连 60 s 内还原·管理员运行）。阳性判据：user/块回 ~25 ms 且 kernel/块 ~33 ⇒ cpu/块 ≈58 ms（−15%）⇒ 保留（不持久·重启后重设）。阴性 ⇒ 每块 CPU 线在钉版二进制上终结。
- **S2 一次重启包（唯一重启）**：`--ram-scale=3.0` 恢复（watchdog.ps1:47 文件已漂移不含·作用在共识 LRU `storage.rs:84`）+ Scanner 保持停 + 亲和按 S1 结果重设。**前置**：Disable `kaspad-watchdog` 与任何计划任务 → 核进程表只剩一个 kaspad → 记 blk/hdr → 停 → 起 → 验 `IBD started` 与块率。**代价** = 一段 header 相位（1.5–5 h）。**时机** = 与下一次自然断连合并（断连本就赔相位·此时重启边际成本≈0）——即"断连即重启窗"。执行 = J1 角色 B 提权或 Owner。
- **S3 C 复活条件（唯一能省天的路）**：J1 younio 节点 ① 同版本 ② isSynced ③ pp ≈ tip−30h（非从 136.243 拿的陈 pp）④ P2P 经 Tailscale 可达且肯出 proof ⇒ 本机 `--connect-peers=<younio>:16311` 空库全新 IBD ≈ 2.7 天（vs 现状 4.5–8 天）。**待 J1 答**（inbox 09-04T17-19Z）。

## 4. Owner 两项决策（精炼）
- **D-a 重编译（根治 R2）**：改 `daemon.rs:53` fd 预算常数（或 `factory.rs:329` 分配）+ 块缓存后重编 kaspad = **换二进制**。收益上界：内核态 ~43 ms/块 → 大幅降（open/close 风暴消失），块率可能 1.5–2×。代价：D-005 慎重铁律；7b1e18cc 钉版是 ZK/covenant 坐标锚（共识代码不变但二进制 hash 变，所有"按 7b1e18cc 核"的记录要重锚）；构建/验证/回滚 runbook 由 J1 出、NWT 审。**不急于今晚**；若 S1 阴性且 S3 不成立，这是唯一还能把天数砍半的路。
- **D-b 接受现状 + S2**：READY 09-09~09-13 区间（非下界）。

## 5. 验收
S1：cpu_ms/块 分核（脚本 `_bettor_cpu_per_block_window.ps1`）A-B′-A′ 三窗 ≥10 min·同相位。S2：重启后 `IBD started` 一次、header 相位时长、块率中位 vs 14.4、watchdog 参数与进程一致（提权读 CommandLine）。S3：空库 IBD 的 proof 来源日志 = younio、pp 块时间 ≈ tip−30h。
