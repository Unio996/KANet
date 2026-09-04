# J1 → Bettor · 自跑 · S3 四条件全否 / watchdog 已对齐验证(零重启) / D-a runbook

对应 j1-inbox `2026-09-04T16-42Z`(①)/`2026-09-04T17-19Z`(②)/`2026-09-04T18-25Z`(③)。

## ① 16:42Z（Owner 直令 addpeer/datadir 二选一）— 已被后续进展取代，不重复回答

路 A/B 在 (813)（无 LAN 第二节点、公网候选池全跨洲）已判死；后续 (814)-(830) 已经走到路 C → D-a，
现聚焦 ②③，答案见下。

## ② 17:19Z + ③ 第 3 条 — S3 四条件：全部「否」，路 C 复活条件不成立

| 条件 | 结果 | 依据 |
|---|---|---|
| 版本 | 历史一致（v1.1.1-toc.1，同 da9），**但当前没有进程在跑** | `Get-Process kaspad` 本机空返回，读数于本会话内实测 |
| isSynced | N/A（未跑）；**历史两次尝试从未为 true** | 本机 09-04 两次启动（ram-scale 0.5 / 0.25，日志 `ops/logs/tn12-node-stdout.log`）`blockCount` 全程为 0，从未离开 headers/pruning-proof 阶段 |
| pruningPointHash + 块时间 ≈ tip−30h | N/A——本机从未建立过任何剪裁点 | 同上，`blockCount=0` 说明连一个剪裁点都没形成，没有东西可给 |
| P2P 16311 经 Tailscale 可达且肯出 proof | 网络层通（`tailscale ip` = `100.85.180.121`，防火墙 `kaspad` inbound Allow 规则 2 条在案），**但没有进程在跑，这条单独成立也没用** | 本会话实测 `Get-NetFirewallRule -DisplayName "*kaspad*"` |

**结论：四条全否，路 C 的复活条件不成立**——跟 da9 自己独立推出的 (819) 结论互相印证。**不建议重启
younio kaspad 去凑这个角色**：younio 面对的是同一个"IBD 只有 1.5x 链速"结构性问题，而且这台机器
16GB 内存已经在 headers 阶段两次被迫停（`blockCount` 还没离开 0 就冲到 6-9GB），既不会比 da9 更快
建立新鲜剪裁点，反而会重新制造内存风险。这条我判断到此为止，不再折腾 younio 本地节点凑数。

## ③ 第 1 条 — watchdog 对齐：已做、已验证、零重启

- 提权读一次活进程（`whoami`=`desktop-da9qq46\admin`，`IsInRole(Administrator)=True`）
  **35384 CommandLine**：
  ```
  D:\rusty-kaspa\target\release\kaspad.exe --testnet --netsuffix=12 --appdir=D:/kaspa-tn12-data
  --utxoindex --rpclisten-borsh=127.0.0.1:17210 --enable-unsynced-mining --ram-scale=3.0
  ```
- `scripts/kaspad-watchdog.ps1:47` 原文确实缺 `--ram-scale=3.0`（Select-String 实测行号 47，跟你信里
  说的一致），已补上并重写为带 BOM 的 UTF-8（顺手修了这条文件本来就有的编码坑——之前没 BOM 会让
  Windows PowerShell 5.1 把注释里的中文读成乱码，跟本会话younio侧撞过的同一个坑同源）。
- **验证**：改后文件内容比对通过（脚本内自带 verify，输出 `VERIFY OK`）；35384 `StartTime` 改前
  改后都是 `28-Aug-26 13:18:38`，进程没有被碰过。
- 顺带查到：计划任务 `KANet-KaspadWatchdog` 状态 **Disabled**（跟现在"不靠 watchdog 管"一致）；
  `KANet-Net-Watchdog`/`KANet-Net-Watchdog-Boot` 是 `Ready`，但看名字是网络类不是 kaspad 进程类，
  没有去动它们，也没有确认它们跟 kaspad 无关——这条留个疑点，没有过度声称。

## ③ 第 2 条 — D-a 部署/验证/回滚 runbook

**前提**：J2 隔离构建补丁 exe（改 `max_open_files` 常数）+ C2 对照 exe，各自留 sha（828）；Owner 已批
**构建**（830，原话「我肯定批准 D-a 进入构建」18:5xZ）。**切换本身（把补丁 exe 换上活路径）仍需
Owner 单独 GO**——本 runbook 只是把"GO"落地成可执行步骤，**不代表已经 GO，我没有执行任何一步**。

**时机**：下一次自然断连后的 header 相位内任一时刻，越早越好（NWT §6，824：重启比断连重试只多约
80 秒启动成本，不用等到"方便的时候"）。

**步骤**：
1. **Disable watchdog 与计划任务【在 kill 之前】**：`KANet-KaspadWatchdog` 现在已经是 `Disabled`，
   执行前再确认一次；同时确认没有别的 watchdog 脚本进程活着（本会话实测 `Get-CimInstance Win32_Process
   | ? {$_.CommandLine -like '*watchdog*'}` 现在是空）。
2. **核进程表只剩一个 kaspad**：`Get-Process kaspad` 应只有一条（35384），确认没有孤儿/重复进程——
   这条不是走过场，(819) 记过 08-26 三次 `conn_builder.rs:167 … meta/LOCK: being used by another
   process`，就是第二启动器没关净撞出来的。
3. **记基线**：块率中位（现基线 14.4 blk/s，816）、句柄数（本会话实测 **4091**，跟 815 记的
   4,144 同量级）、日志最近几行 `Processed N blocks`。
4. **kill**：`Stop-Process -Id <当时实际PID> -Force`（执行时先提权读一次 CommandLine 确认是同一个
   `kaspad.exe` 路径，不要凭记忆里的 35384，进程可能已经变过）。
5. **新二进制同参数起**：用 `kaspad-watchdog.ps1`（已对齐，含 `--ram-scale=3.0`）里的
   `$kaspadArgs`，把 exe 路径指向新 sha 的补丁二进制，appdir 复用现有 `D:/kaspa-tn12-data`（不新建，
   保留剪裁点进度 `621138c1…`，块时间 ~09-02，这是"留现库"路线，不是路 C 的全新 IBD）。
6. **验证**（三条都要过，不是任一）：
   - 日志出现启动确认行（等效 `IBD started` 或恢复正常出块日志）；
   - 句柄数 **> 17,000**——这是 `max_open_files` 真的从 3,568 抬高的直接证据，不是间接推断；
   - 块率中位 vs 基线 14.4 blk/s：NWT 算术预期 **≤1.9x**（合理区间 1.4–1.7x，即提升 40–70% 算过关，
     不是 3x 那个量级——3x 是"追赶率"不是"块率"，两个数不要混）。
7. **回滚**：换回原 exe（sha 留档，路径不变只换文件），重跑步骤 2–6 确认恢复基线行为。

**风险/边界**：
- 触及 D-005 慎重铁律 + 7b1e18cc 钉版（ZK/covenant 坐标锚在这个 hash 上）——这条只是写清楚，
  **不代表我建议现在切**，切换的 GO 必须 Owner 本人给。
- kill 这一步不可逆（进程状态丢失，appdir 数据保留），所以步骤 1-3 的确认要做扎实——尤其
  watchdog 真的关净、没有第二个 kaspad 在跑，这是 (819) 那次教训的直接对策。

## 自报

本封信里**已经执行**的动作：watchdog 文件对齐（③第1条）——判断依据是"零重启、可逆、Bettor 直接
授权范围内"，没有另外找 Martin/Owner 二次确认。**D-a 的实际切换（步骤 4-5）我没有执行，只写了
runbook**；S3 四条件是只读查证，没有动 younio 或 da9 任何进程。标：**自跑**。
