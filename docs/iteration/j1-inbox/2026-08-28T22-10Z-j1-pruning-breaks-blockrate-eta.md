# J1 → Bettor：🔴 剪枝会让 blockCount 掉 45 万 —— 任何按块速率算的 ETA 在剪枝点会失真

- 时间：2026-08-28 22:10Z
- 性质：**只读观测**。未碰 da9 任何状态、未推分支。

## 1. 实测事件（da9，今夜）

```
05:01:25  Periodic pruning point movement: advancing from 56db5830… to 621138c1…
05:02:12  Performing a sanity check that the new UTXO set has the expected UTXO commitment
05:03:15  Pruning point UTXO commitment was verified correctly (sanity test)
05:03:15  Updated the pruning point UTXO set
05:03:15  Header and Block pruning: preparing proof and anticone data...
```

同一时刻我的采样：

| 时刻 | blockCount | lag |
|---|---|---|
| 23:54:59 | 1,782,037 | 10,561.6 |
| 00:05:35 | **1,327,695**（−454,342） | **10,546.6**（改善 15 分钟）|

**blockCount 掉了 45 万，而 lag 反而变好。** 这不是故障 —— 剪枝点前移会删掉旧块体。

## 2. 为什么这条要报给你

**我们对外播报的 READY 进度，只要是按 `blockCount` 或块速率算的，在剪枝点都会失真**：

- 掉 45 万会被读成"倒退"或"卡死"
- 剪枝后的第一窗速率是负的，任何线性外推都会给出荒谬的 ETA
- 而**同一时刻 lag 是改善的** —— 真实进度是好的

⇒ 再次印证我在 `559b3b9a` 报的那条：**唯一可信的进度度量是 `lagMinutes` 是否收敛**，块速率不行。这次是第二个独立理由（上次是重块区，这次是剪枝）。

**我的监控原来也有这个缺陷**（默认 blockCount 只增不减，把剪枝渲染成 `+-454342`），已修：负增量单独识别为剪枝、记录但不计速率、不触发卡死判定。

## 3. 好消息：da9 进入了新阶段

同一份日志里：

```
Processed 180 blocks and 0 headers in the last 10.00s
  (1832 transactions; 4 UTXO-validated blocks; 10.18 TPB; mass: 0.0s/86730.0c/40015.1t)
```

**首次出现非零的 transactions 与 UTXO-validated blocks** —— 此前一直是 `0 transactions; 0 UTXO-validated blocks`。da9 已从"只堆块"进到"真正做 UTXO 校验"。kaspad 连续运行 16h47m 未重启。

## 4. 工具收获：kaspad 有官方 metrics，别再靠刮日志

`getMetrics` RPC（需传 `processMetrics`/`consensusMetrics`/`bandwidthMetrics` 等参数，缺参数会报 `missing field`）直接给出：

```
consensusMetrics: nodeBodiesProcessedCount / nodeHeadersProcessedCount /
                  nodeDependenciesProcessedCount / nodeDatabaseBlocksCount …
processMetrics:   diskIoReadPerSec / diskIoWritePerSec / residentSetSize / cpuUsage / fdNum
connectionMetrics: activePeers
```

比刮日志和从外部量 CPU/IO 都准。**建议维护窗与播报统一改用它取数**（收不收归你）。

## 5. younio 现况（如实，含我信心的下调）

仍在 `searching for missing block bodies`，已 **72 分钟 = da9 基准（8.3 分钟）的 8.7 倍**。

我用官方 metrics 复核后必须下调说法：**一分钟窗口内所有共识计数器全部静止**，只有磁盘在以 10–11 MB/s 持续读、写为零。
⇒ 「它在忙」有证据（CPU/IO）；「它在推进」**没有证据**。这两件事我先前混为一谈了，现在分开说。

原因诊断（有数据）：机器物理 7.6 GB、空闲 0.45 GB、提交量 16.9 GB（超配 2.2×），kaspad 只拿到 0.36–0.41 GB 驻留内存，于是把 46 GB 的库反复通读（累计已读 75.6 GB）。**这一步是内存瓶颈。**

**我不会再动它**：重启已验证无用（只会重跑 header 回到同一步）；调高 `ram-scale` 就是 8/23 撑爆 da9 那条路。唯一杠杆是腾内存，已报 Owner（其机器上 33 个浏览器进程），归他定。

---
复核：`scratch/_j1_metrics.mjs`、`_j1_metrics_rate.mjs`（younio）；`scratch/j1-remote/prune.ps1`（da9，只读）。
