# TN12 节点"READY 后掉队"与"剪枝点循环冻结"复盘 · D-c/D-d 上线（v0.1 · 2026-09-07 · Bettor）

权威记录：`docs/iteration/COORD-LEDGER.md` (947)–(990)；红队 `docs/2026-09-05-NWT-redteam-db-ibd-request-pipelining-v0.1.md` §14–§21、`docs/2026-09-07-NWT-redteam-dd-syncer-pp-lag-tolerance-review-v0.1.md`；设计 `docs/2026-09-06-bettor-dc-relay-mode-self-trigger-ibd-design-v0.1.md`（§9 v0.1.1）；provenance `docs/provenance/2026-09-07-kaspad-dd-syncer-pp-lag-tolerance/`。本文只汇总，数字均可在上述文件 grep 到。

## 1. 两个事故，一条根因链

| 事故 | 时段 | 表现 | 根因 |
|---|---|---|---|
| **A. READY 后掉队** | 09-06 20:18Z 起（每轮） | isSynced 只维持 11–17 min，然后 ~60 min 中继爬行（0.75 bps），再由孤儿超 locator 自触发一次 30–45 min 的 IBD ⇒ **synced 占比 ≈10%**，console 全部 ③ 门随之只开 10% | 唯一 syncer 136.243.93.17 的中继投递是每 ≈7 s 一簇 3–5 块（inv 随簇到达）；kaspad 中继流串行单 hash 请求；IBD 只由孤儿超 locator（9 层 ≈51 s 链）触发，**没有"落后超阈就追"的机制** |
| **B. 剪枝点循环冻结** | 09-07 00:57→03:06Z（129 min） | 与 syncer 的每轮 IBD 在 ~60 s 内以 `pruning point could not be easily recognized` 失败 → 断连 → 5–28 s 回连 → 再起；IBD 期 relay inv 被丢 ⇒ **进块 0、sink 冻结** | 我们的剪枝点 00:05:59Z 全史首次推进（621138c1 → 783f3ece，一步跳 9 个 finality 索引）；syncer 的 pp 停滞在我们过去索引 41（56db5830…，它 08-26 给我们的 proof pp 是索引 60，pp 还倒退了）；`determine_ibd_type` 的 SyncerSkew 只容忍最近 4 个过去 pp ⇒ 每轮 Err |

A 的修法 D-c 落地前，B 先发作；B 的修法 D-d 叠在 D-c 之上同一 exe，一次切换。

## 2. 修了什么

- **D-c（a39c60d2）**：`IbdFlow::start_impl` 把 `relay_receiver.recv()` 包 timeout；空闲检查读本机 sink 块头时间戳落后 ≥ 阈（默认 480 s）⇒ 向 syncer 要 locator(None,None) 取其 sink → 取块 → blue_work 严格大 ∧ daa ≥ 本机 + 600 才争 CAS → `ibd(block)`；每 peer 退避 ×2 上限 30 min、CAS 失败不排队、只对完成过 IBD 的 peer 自触发、自触发路径逐字打 canonical `IBD started with peer` / `completed successfully` 两行（否则所有仪器都看不见）；协议类错误仍断连，网络类退避。
- **D-d（3d017b6d）**：`--ibd-syncer-pp-lag-tolerance`（默认 4 = 上游语义；≥4 表内命中 ∧ 链祖先关；0 = 全表）+ MUST-1 拒绝路径 warn 印 syncer pp / 表位 / window / ancestor / flag。部署值 **0**（16 不够：真差 28 索引）。
- 产物 `D:\kaspad-live\dc-3d017b6d\kaspad.exe` sha256 `6D5BCEBE…D5106F`，真 clone 构建（worktree / detached HEAD 都不嵌 git hash，build.sh 加"内嵌 hash=0 即 exit 4"门）。

## 3. 上线过程与结果

| 时刻（Z） | 动作 | 结果 |
|---|---|---|
| 03:00:32 | 步①：换 dc-3d017b6d，`lag-secs=0`（D-c 关）+ `tolerance=16` + 4096（Owner 03:00Z 前未拍，按 980 默认动作） | 03:03:20 首轮拒：`table position none (window 16)`——**首次拿到对端 pp 哈希** |
| 03:04:41 | 步①′：`tolerance=0` | 03:05:54 `lags … lag 28` 接受 → `syncing ahead` → **03:06 进块恢复**；六轮几何收敛 81/33/14/5.4/2.4/1.2 min → READY 05:25:42，isSynced 05:19:19 |
| 05:19–06:19 | 影子窗（D-c 关） | self-trigger 0 / 回滚串 0 / not-recognized 0 = PASS；基线 isSynced 真态 17 min 后掉回爬行 |
| 06:20:05 | 步②：去 `lag-secs=0`（D-c 默认 480）留 `tolerance=0` | 常规追平 4 轮 → 07:04:32 READY → **07:10:43 首个自触发**（lag 503 s）→ 07:14:35 完成（3 min 52 s，isSynced 全程 true）；此后每 ≈9–10 min 一轮 4–5 min，五轮全成功；**isSynced 自 06:58Z 连续 true >50 min**（此前最长 17 min） |

每次 kaspad 重启后都跟一次 console 重启（G-2 落地前共享 RpcClient 不自愈）。三次 kaspad 重启由 Bettor 非提权完成。

## 4. 收获 / 教训

**判据与仪器**
- **形状判别量否定不了总量假设**：pktmon 簇间 2 帧/s 与 p2pBytesRx 团间 102 B/s 两台"独立"仪器量的是同一种东西（时间形状），我据此裁 B（inv 不到达），40 min 后节点在 A 模型预测窗内自触发。守恒量（簇内 inv 条数）才能裁；预测窗写了就等它过完。
- **叠判据前先核每个合取项的隐含界**：G-1 我裁 S2 = sink 落后 ≤900 s，而 isSynced 本身 ⇒ <661 ⇒ 900 恒真一笔不拦；真判别量是 RPC 原生 `headerCount − blockCount`。队友稿里"X 不单独绑定"= 判据是空的。
- **getBlock 找不到 ≠ 不在本机**：RPC 不服务当前 pp 以下的过去剪枝点 header（虽永久保留）。J2/NWT 据此推"tolerance=0 无用、事故升级"，我按"一次重启一举分辨"照做，实测翻案。判某 hash 是否过去 pp 只看 past_pruning_points 表（D-d 的 warn 行）。
- **仪器静默失败**：J2 的 isSynced 探针前 30 次输出为空被当作静默；KANet-UI 把 IbdFlow 错误单行判"良性"而漏了"进块 0"这个模式——判"良性"要看总量（intake），不看单行。

**运维**
- **kaspad 不需要提权**；"必须提权"链的来源只是首个实例由管理员 PowerShell 起的。SSH 里 `Start-Process` 起的子进程随会话被收（9416 死在 UPnP 行）；SSH 起长进程用 WMI `Win32_Process.Create` 或一次性 schtasks；判"起全"看 `WRPC Server starting on` + 17210 监听。
- **共享 RpcClient 对节点重启无自愈**：rpc-health 回退公网端点（发现列表硬编码 mainnet），③ 门 `reason=rpc-fail` 静默放行 52 min；审计：状态变更 1 行（jepu1 退避簿记）+ 35 笔门外 UTXO 再平衡真 tx + 1 笔 settle-tx 被拒；无资金推进。修 = G-2（已 GREEN-final 待 apply）+ G-1（钱路闸，待 Owner）。
- **活主机起构建先看 free 与 kaspad WS，默认 -j 2**：12 rustc 并行 + IBD 峰值把 free 压到 4.5 GB，harness 在 free≈5.5 GB 就杀 shell 型后台任务（tail 型 Monitor 存活）。
- **产物构建必须在 `.git` 为目录、HEAD 为分支 ref 的检出里做**，否则不嵌 git hash，全队按首行 hash 判活的产物不可用。
- **审计 pattern 要先对着日志行形穷举**：relay/broadcaster 行不带 ISO 戳，首报漏了 35 笔真交易。

**流程**
- 事故窗内 Owner 不在，按全自动授权设"默认动作 + 否决窗"（980）并逐字记账，Owner 一句 NO 即回滚——这比等更好，也比不声明就做更好。
- 推送闸的 hash 必须看过队列后手打；用 `$(git log …)` 生成参数等于把闸架空（撞过一次）。

## 5. 未闭合项（按优先级）
1. **G-1 钱路闸**（Owner 批）：34 条 submit 路径接同一闸（networkId 核 + `hdr−blk ≤ 50` 判 IBD 中 + rpc-fail fail-closed），先 shadow 24 h。
2. **G-2 apply**（12:20Z 后与 6c-α 同一次 console 重启）：落地后 kaspad 重启不再需跟 console 重启。
3. **D-c 6 h 验收页**（NWT 12:20Z）：自触发次数 / 单次 ≤8 min / false 总时长 ≤10% / 回滚串 0 / 剪枝单调。
4. **S-1**：jepu1 47 天每小时真广播被拒 1116 次（GIVEUP 永不进），随 6c-β/γ 一起批。
5. **R-1**：IBD 体相位 relay 扇入 ⇒ ingest 超时（relay `post()` fire-and-forget 无重发），有界重发队列另案。
6. **上游 PR**：D-d flag（PR-1，默认 4）；D-c 自触发（PR-2，先修 not-eligible 通知每轮重打的 SHOULD）。
7. READY 后暂缓项：llama 恢复、scanner 重启、T+0 只读第一小时——等 6 h 验收页后按 synced 占空比决定。
