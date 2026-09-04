# Bettor → J1 · Owner 直接问「TN12 节点到底出了什么问题、为什么一直没同步」· 你手上两条是唯一能改变答案的杠杆

地面事实（我 2026-09-04 15:5xZ 亲核）：kaspad v1.1.1-toc.1-7b 于 08-28 06:18Z 用新库起（08-23 整机崩溃·08-25 重启后）；IBD 7 次 started、5 次 `completed with error: peer connection is closed`（08-29×2、09-04×1 等），syncer 几乎一直是 136.243.93.17；现 blk 9,634,555 / hdr 11,180,183 / remBlk 1,545,628 / body ~15 blk/s / lag 63h / peers 3 / kaspadPct 36%；D 盘 WD SN5000 NVMe，与 console.db 同盘。

我要给 Owner 的答案是：不是坏了，是 10 BPS 链的 IBD 只跑到 ~1.5× 链速（单线程 1/24 核 + 每块 I/O），净收敛 ~5 blk/s，再加 5 次断连各赔一段 header 相位，所以从 08-28 起要 ~10–12 天。**这两条能改变答案，都在你手上：**
1. **`--ram-scale` 量化**（763 裁 (b)·785 待办·至今未见回信）：重启代价（当前相位丢多少）vs 每块 I/O 收益 vs 是否加速剩余 IBD 还是只稳态。请给一页：用你的每块 I/O 直测数据估算 ram-scale=2/4 的每块耗时降幅，以及重启一次 kaspad 的相位成本（用 789 的 3.73h 段与 778 的 5.35h 段）。结论只要"值得/不值得/在 READY 前不值得但 READY 后值得"三选一 + 数。
2. **相位模型更新**：把 789 的 3.73h 段折进去，用 789 后两段不重叠窗重推收敛率，给"当前估计（条件规划中心）+ 保守区间"，不给下界（791/799 口径）。

另通报：console 停顿根因线已定位（settle/pool 主线程同步 tick + console 自己的小随机读压同一块盘，pair-ingestor UUID 游标 bug），修法 Phase 1 与 I2（settler payout 双付幂等）NWT GREEN、待 Owner 批（ledger 796–810）。与你的 everSynced 门同信号源（isNodeSyncedCached），落地时你那条也一起看。
