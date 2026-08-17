# J1 节点健康终判制品 — §6-1 LIVE gate① (Bettor 派工, 三问重构版)

> **Status**: 证据制品 · J1tn · 2026-08-17 17:3xZ · 判词=**节点功能健康、非真降级**。判据/裁定权归 Bettor/Codex, 本文件交测量+定性。
> 方法: 跨窗分布不用单点快照(在册 window/volatility 族); tips 绝对值降为参考, 主判据=isSynced/lag 恢复能力 + DAA 单调性(Bettor (454) 重构问法)。

## 主判定窗(local-J1-:17210, 46 采/53min/60s 间隔)
- 区间 2026-08-17T16:47:51Z → 2026-08-17T17:40:38Z
- **isSynced: 46/46 = 100% true**(console/注册节点可靠同步——重构问法里"比 tips 更真的信号")
- **DAA: 严格单调, 11.05/s, 零回退事件**(降级会伴 DAA 停滞/回退——整窗一次未见)
- **tips: min 191 / max 238 / 中位 193 / 个位数 0 采**
- 判词分布: {"healthy":46}

## 三问逐条(Bettor (454) 重构版)
- **(1) 该 TN12 单矿工体制 tips 健康基线**: 实测 = **isSynced=true 时 tips 稳定在 ~191-238(中位 193)**, 个位数从不出现。⇒ **L140「健康应个位数」前提证伪**(NWT 独立数据 204/218/193 同向)。高 tips = GHOSTDAG 单矿工体制的 DAG 宽度常态, **不是降级信号**。
- **(2) console/注册节点回 isSynced=true/lag=0 能力**: **46/46 全程 true**, 从无翻动。正信号满分。
- **(3) 真 tx 稳定 first-seen+confirmed**: 归探针(v6, 等 Codex FINAL)。本窗不越位答。

## 关键实证: 最长慢产段节点仍健康(反驳"低产=病态")
被动观测器 run2 记到一个 **7 分钟低产段(17:18:57-17:26:37)**——判定窗同期 7 采**全程 isSynced=true / 判词 healthy / DAA 严格单调**(每分钟 +45~64)。⇒ 被动观测器的"trough(DAA<1/s)"标签把**慢产但健康**误记为病态; 真相是慢产期节点不掉。**降级信号(isSynced false / DAA 停滞)在整个 53min 窗零出现。**

## 跨窗佐证(run1 存档)
run1 被动窗 37 段跨 280min: DAA 77720752→77894790 = 净+174038, 严格单调零回退。加本窗 = **~333min 累计零 DAA 回退**。

## 诚实边界
- 单节点(local-J1); §6-1 LIVE 关心的 console/注册节点若是别台, 须在该台重测(同主语纪律)——本窗测的是 J1 笔记本节点。
- lag 未逐采记(脚本用 diag/isSynced 替代: starved/behind+isSynced=false 即 lag>0 的等价信号, 本窗零出现)。
- tx 确认(问 3)归探针, 未含。

## 附: 主窗全量 JSONL
```
{"t":"2026-08-17T16:47:51Z","tips":192,"daa":77916133,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T16:48:06Z","tips":193,"daa":77916165,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T16:49:20Z","tips":192,"daa":77916654,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T16:50:33Z","tips":192,"daa":77916986,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T16:51:44Z","tips":192,"daa":77917180,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T16:52:53Z","tips":192,"daa":77917463,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T16:54:03Z","tips":192,"daa":77922772,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T16:55:16Z","tips":191,"daa":77923276,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T16:56:26Z","tips":192,"daa":77923311,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T16:57:37Z","tips":193,"daa":77923352,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T16:58:50Z","tips":238,"daa":77923445,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T16:59:59Z","tips":192,"daa":77925891,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:01:10Z","tips":192,"daa":77927280,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:02:24Z","tips":192,"daa":77927407,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:03:35Z","tips":193,"daa":77927587,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:04:44Z","tips":192,"daa":77927773,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:05:53Z","tips":193,"daa":77928202,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:07:08Z","tips":191,"daa":77928640,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:08:19Z","tips":192,"daa":77928899,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:09:30Z","tips":192,"daa":77929082,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:10:42Z","tips":193,"daa":77929280,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:11:55Z","tips":192,"daa":77929573,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:13:10Z","tips":192,"daa":77929856,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:14:19Z","tips":213,"daa":77930548,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:15:29Z","tips":196,"daa":77934329,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:16:43Z","tips":194,"daa":77937812,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:17:56Z","tips":198,"daa":77937873,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:19:09Z","tips":200,"daa":77937944,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:20:20Z","tips":201,"daa":77937989,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:21:34Z","tips":201,"daa":77938037,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:22:47Z","tips":201,"daa":77938101,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:24:00Z","tips":202,"daa":77938146,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:25:14Z","tips":202,"daa":77938205,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:26:23Z","tips":193,"daa":77940688,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:27:39Z","tips":192,"daa":77944002,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:28:51Z","tips":196,"daa":77944725,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:30:02Z","tips":196,"daa":77944762,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:31:11Z","tips":198,"daa":77944822,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:32:25Z","tips":199,"daa":77944884,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:33:34Z","tips":200,"daa":77944934,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:34:45Z","tips":193,"daa":77947238,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:35:54Z","tips":193,"daa":77947919,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:37:04Z","tips":191,"daa":77950066,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:38:13Z","tips":191,"daa":77950351,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:39:28Z","tips":194,"daa":77950754,"diag":"healthy","sync":"true"}
{"t":"2026-08-17T17:40:38Z","tips":192,"daa":77951144,"diag":"healthy","sync":"true"}
```
