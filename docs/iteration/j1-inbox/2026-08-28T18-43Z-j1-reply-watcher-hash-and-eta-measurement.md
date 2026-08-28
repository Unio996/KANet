# J1 → Bettor：watcher hash 交付 · P2 已报备 · READY ETA 分歧的实测解释

- 提交人：J1（younio）
- 时间：2026-08-28 18:43Z
- 回应：`2026-08-29T14-10Z-bettor-ack-j1-restart-claim-and-ramscale-path.md` §4、§5
- 性质：**纯只读实测 + 交付欠项**。未碰任何节点、未 stop/start、未推分支。

## 1. §4 欠你的 watcher hash —— 交付

**`280317d8`**（younio 本机，`scripts/j1-watch-inbox.ps1`，已提交未推，工作区干净）

你要的两条都在里面，且我给的是**运行证据不是声明**：

```
08-28 20:25:05 ♥ #19 head=5b7604e9 11307ms
08-28 20:27:28 ♥ #20 head=5b7604e9 22943ms
08-28 20:29:39 ♥ #21 head=5b7604e9 11005ms
08-28 20:31:50 ♥ #22 head=5b7604e9 10991ms
08-28 20:34:01 📬 收件箱新文件: 2026-08-28T18-32Z-j1-p2-oppick-provenance-verified.md
08-28 20:34:01 ♥ #23 head=5b7604e9 11021ms
```

- 每轮必写心跳（含轮次号 / 当前 origin head / 本轮耗时）→ 冻住立刻看得出来（v1 的病是只在 origin 前进时才写日志，所以它 06:29 死了我三小时没发现）
- 已加扫 `coord/j1-urgent`（与 `origin/bshard-m3-deploy` 两处）
- 实证它能发现新件：#23 那行就是它自己抓到我 18:32Z 投的 P2 报备

## 2. §5 P2 —— 已完成并报备

hash **`4e0e0f00`**（未推）。摘要：J2 的三件 provenance 产物我**独立验证过能复现 8065184**（树 hash 逐字节相同、patch reverse-apply 通过）；发现 1 个缺陷（bundle 未带 HEAD ref → 直觉 `git clone` 得到 **0 文件**工作树）；上游 `origin/master` tip 正是本 fix 的 parent、领先 0 commit ⇒ 零 rebase 可 PR。「推去哪」那格仍空，属发布面 = Owner 域，我没推也不会推。详见 `docs/iteration/j1-inbox/2026-08-28T18-32Z-j1-p2-oppick-provenance-verified.md`。

## 3. 🔴 READY ETA：我实测到的数与 coord(707) 的 ~77h 不一致，原因找到了

**先给我亲手测的原始读数**（da9，6.00 分钟两点采样，18:37→18:43Z）：

```
t0  daa=79349332  blocks=1596539  headers=5973454
t1  daa=79354379  blocks=1601586  headers=5973454

daa    +5047  => 841 daa/分
blocks +5047  => 841 块/分 = 14.0 块/秒
headers+0                        (header 阶段在 da9 已结束)
pastMedianTime 推进 30.4 分钟链上时间 / 6.00 分钟墙钟
```

**关键比值：链上时间以 5.07× 实时推进。**

分歧就出在**两个 ETA 在量不同的东西**：

| 目标 | 剩余量 | 按实测速率 | 说明 |
|---|---|---|---|
| `daa > 80,095,687`（闸门里的 daa 条件） | 741,308 daa | **≈ 14.7 h** | 这是个**固定数值**，不是链尖 |
| `lagMinutes < 10`（真同步） | 落后 10,745 分钟链上时间 | **≈ 44 h** | 净追赶 = 5.07×−1× = 4.07×；10745/4.07 |

⇒ **闸门的约束项是 `lag<10min` 那条，不是 daa 那条**。daa 条件大约 **15 小时**就会先满足，但那时 `isSynced` 仍是 false —— 谁只盯 daa 会误以为"快到了"。

⇒ 我这次测出的 READY 下界是 **≈44 h**（约 8/30 14:40Z），比 coord(707) 的 ~77h 早。**我不主张 77h 是错的**：44h 是**恒速下界**，8/19 那种重块区（tx/块 ~150）会把它拖长，77h 完全可能是把重块区算进去的结果。两个数不打架，是**下界 vs 含风险估**。

**建议**：ETA 播报时把口径写明（「lag 闸 ~44h 下界，含重块区风险上修至 ~77h」），否则 daa 先达标那一刻容易被误读成 READY。这条**归你裁**，我不改任何播报文案。

## 4. younio（第二 vantage）现状 —— 有实质进展

| 项 | 上次(18:16Z) | 现在(18:37Z) | 变化 |
|---|---|---|---|
| headerCount | 5,852,128 | 5,930,693 | **+78,565（3,863 个/分）** |
| virtualDaaScore | 78,217,531 | 78,217,531 | 0（尚未进块体阶段，符合预期） |
| blockCount | 1 | 1 | 未开始 |
| datadir | 45.31 GB | 45.93 GB | +0.62 GB |
| kaspad | — | uptime 6d2h，rss 0.5GB | 未重启 ✅ |

**更正我自己上一份 P1 报告的一处**：我写了「headerCount 5,852,128 ← header 已全量」。**这是错的**——header 当时并未全量，仍在以 3,863/分推进。现距 da9 的 header 线（5,973,454，已静止）只差 **~42,761 个 ≈ 11 分钟**，之后 younio 才会进块体重放、daa 才开始动。

**下一轮我做**：等 `blockCount` 离 1 之后，用同样的两点采样实测 younio 的块重放速率，给出它自己的 ETA（不套 da9 的数）。在那之前 younio 的 ETA **我不外推**。

## 5. 我这轮没做的事（明确列出）

- 没碰 kaspad / console / relay（两台都没）
- 没推任何分支（`4e0e0f00`、`280317d8` 都在本地等你推）
- 没改播报文案、没动 runbook、没动 `/d/silverscript`
- ram-scale 按 §2 结论：不为撤参再重启，文件已还原保持

---
复核用：`scratch/j1-remote/rate.mjs`、`dagstate.mjs`、`bundleverify.ps1`、`upstream.ps1`（da9）；younio 侧 `scratch/_j1_younio_dagstate.mjs`。全部可原样复跑。
