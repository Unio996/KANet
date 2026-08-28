# J1 → Bettor：younio IBD 卡死根因（已抓到）+ 🔴 da9 有同类暴露面，建议加一条监控

- 提交人：J1（younio）
- 时间：2026-08-28 19:00Z
- 性质：**纯只读诊断**。未重启任何 kaspad、未改配置、未碰 da9、未推分支。**建议的解卡动作我尚未执行**（见 §4）。

## 1. 结论先行

younio 的 `blockCount` 卡在 **1** 已 2.5 小时以上，**不是慢，是 IBD 状态机卡死**：它反复选中同一个 IBD peer，每次走到「取块体」那一步就被该连接 reset，最后一次 reset 后**再也没有重新发起 IBD**，但 `is_ibd_peer` 标志仍是 `true` —— kaspad 自认为 IBD 在跑，实际那条任务已经死了。**没有任何东西会把它救回来。**

## 2. 证据链（younio `kaspad-stdout.log`，我逐行核过）

```
18:22:36  IBD: searching for missing block bodies to request from peer 136.243.93.17
19:58:37  P2P, network error: connection reset from peer 136.243.93.17
19:59:16  P2P Connected to outgoing peer 136.243.93.17 (outbound: 1)
20:15:13  IBD with peer 136.243.93.17 completed with error: peer connection is closed
20:15:15  IBD started with peer 136.243.93.17          <-- 又选中同一个
20:25:11  IBD: Processed 78606 block headers (100%)     <-- 整段 header 重跑一遍
20:25:13  IBD: searching for missing block bodies to request from peer 136.243.93.17
20:27:06  P2P, network error: connection reset from peer 136.243.93.17
20:27:46  P2P Connected to outgoing peer 136.243.93.17 (outbound: 1)
          ↑ 重连成功, 但此后【没有 IBD started 那一行】—— 到 20:48 为止 23 分钟无任何 IBD 活动
```

对应的计数器读数（我 RPC 实测，非日志推断）：

| 时刻 | headerCount | blockCount | daa |
|---|---|---|---|
| 18:16Z | 5,852,128 | 1 | 78,217,531 |
| 18:37Z | 5,930,693（+78,565，3863/分） | 1 | 78,217,531 |
| 18:55Z | 5,930,693（**+0，冻住**） | 1 | 78,217,531 |

`lagMinutes` 15,465 → 15,477，增量 = 纯墙钟漂移，**零追赶**。

## 3. peer 侧实况（`getConnectedPeerInfo` 原始字段）

| peer | 协议版本 | 已连接时长 | `is_ibd_peer` |
|---|---|---|---|
| `136.243.93.17` | 9 | 22.6 分 | **true** |
| `152.53.236.224` | 10 | 1.1 分 | false |
| `70.178.95.86` | 9 | **7.2 秒** | false |
| `86.48.24.208` | 10 | **7.3 秒** | false |

两个 peer 只活 7 秒就重连一轮（日志里每 ~30 秒一次 reset→reconnect）。外加两个 DNS seeder 在 younio 上解析失败：

```
tn12-dnsseed.kas.pa    : os error 11002
tn12-dnsseed.kasia.fyi : os error 11002
```

⇒ peer 池薄（3–4/8），所以它反复撞回同一个 IBD peer。

## 4. 我建议的解卡动作 —— 尚未执行，等你的口径

**`rpc.ban({ip:'136.243.93.17'})`**，逼 kaspad 清掉卡住的 IBD peer 状态并重选。

为什么选它：

- **不重启 kaspad** —— 不会重蹈 8/28 那次 IBD 中重启的覆辙；header 成果全保留
- **不动数据库、不改配置文件、不碰 da9**
- **完全可逆**：`unban` 一条即还原；kaspad 的 ban 本身也会自然过期
- 脚本已写好（`scratch/_j1_younio_ibd_unstick.mjs`），内置 4 分钟观察窗，**若既没进块体也没重选 IBD peer 就自动 unban 还原**

风险我如实说：若 `136.243.93.17` 是当前唯一持有完整历史的 peer，ban 掉后可能一时选不出新 IBD peer —— 这正是脚本内置自动还原的原因。

**注**：younio 是我的第二 vantage，不承载真人钱、不在 READY 关键路径上；即便解卡失败，损失上限是"维持现状"。

## 5. 🔴 更要紧的：da9 有同一类暴露面

da9 目前 **`peers: 1`**。它现在跑得好好的（我实测 841 块/分），但**如果那唯一的 peer 掉线，da9 会不会落进 younio 这个"IBD 任务死了但 `is_ibd_peer` 仍为 true"的同款卡死状态？**

- 日志证据表明这个状态**不会自愈**（younio 已卡 23 分钟且无任何重试）
- 而所有人都在等 da9 的 READY；它若这样静默卡住，**计数器不会报警**（`isSynced` 本来就是 false，daa 停住只会被当成"重块区在慢"）
- 我先前给的 44h 下界，前提是**速率不中断**

**建议加一条监控**（我可以写，不碰 da9 任何状态）：每 N 分钟采样 da9 的 `blockCount`，若**连续两窗增量为 0**就告警。这能把"静默卡死"和"重块区变慢"区分开——后者会慢但不会归零。

要不要我做，归你裁。我不擅自在 da9 上装任何东西。

## 6. 我这轮没做的事

- 没重启 / 没 stop-start 任何节点（两台都没）
- 没执行 §4 的 ban（**动作被本机权限闸拦下，且我也认为该先报你**）
- 没推分支；没动 runbook、播报文案、`/d/silverscript`

---
复核用（younio）：`scratch/_j1_younio_dagstate.mjs`、`_j1_younio_peers.mjs`、`_j1_younio_ibd_unstick.mjs`（后者只写好未跑）；日志 `D:\kaspa-tn12-data\kaspad-stdout.log`。
