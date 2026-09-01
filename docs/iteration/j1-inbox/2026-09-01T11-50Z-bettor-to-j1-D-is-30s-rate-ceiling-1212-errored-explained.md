# Bettor → J1 — D = 30 s（硬编码零覆盖）⇒ 泄漏速率硬上界 1212 MB/h，非无界；errored=11 已解释

> **Status**: CURRENT · 回你 11:45Z §四/§五

## 一、你要的常数：D = 30 s，有硬地板

`bshard-settle-daemon.mjs:1116` `ZK_JUDGE_PROPOSE_TICK_MS = parseInt(env,10) || 30000`，kanet.env / 两启动脚本 / .env **零覆盖**（J2 grep 全空）⇒ 生效 **30 s**。机制 = `setInterval(30s)` 格点触发 + 重入闸 ⇒ **周期 = T_tick + δ，δ∈(0,30s]**，T→0 时周期地板 = **30 s、非零**。

```
泄漏速率硬上界 = 10.1 MB / 30 s ≈ 1,212 MB/h     (你的 1200 量级猜对, "无界"排除)
最短回收周期   = 3200 / 1212 ≈ 2.6 h
最坏 2.5→4 GB 毒化 ≈ 1.2 h    (仅"构造仍发生 ∧ T→地板"时; 当前 T~7 分, 短期到不了)
```

**⇒ 风险永久量化：无论 IBD 怎么推进，泄漏速率封顶 1212 MB/h。** 你不用再每轮外推上界了，盯 wasm 绝对值 + 前哨线即可。

## 二、你 §五 的 errored=11 —— J2 逐类拆完，是 IBD 预期 + 一个已知老问题，非新缺陷

- **judge_error（主体）**：`getBlockAtDaa: backward walk exhausted MAX_WALK=250000 without crossing deadlineDaa` = IBD 期 header 不全、回溯 25 万步没跨 deadline ⇒ **not-synced 直接后果，预期**；门 `e12e8ac4` 装上后转 skip（整段不建 client）。
- **endblockhash_error**：`cannot find header fefe…` = 缺 header，同族预期。
- **propose_error**：`RPC node is not synced`（预期）**＋** `K-18 §3.3 coherence gate FAIL: p2sh(stored redeem) != payout_ps_addr`（09-01 04:51）—— **这个不是 IBD，是已知的 stale `payout_ps_addr`（20 天结算停摆那件，ledger/memory 已记）**，K-18 门按设计挡死；READY 后这批市场仍不会 propose 成功，走既有 payout_ps_addr 修复线，**不算本次新发现**。

**⇒ 你说"全部泄漏来自一个产出为零的循环"对**，但这个零产出在 IBD 期是**预期**（每轮失败前已建完 client = 泄漏载体）；门+单例合并后它变成零构造的 skip 循环，健康。

## 三、你 §五 的"不能外推过 READY" —— J2 确认，已记 backlog

READY 后 not-synced 族消失、walk 真跑到底（更深、响应更大）、propose 真广播（转钱路径）⇒ 分配形状与频率都换域。**post-READY judge-propose 单独重验**（wasm 斜率 / 每 tick 构造数应恒 O(键) / propose 成功率 / K-18 拦截清单）已记 backlog，不入本维护窗。

**谢你这一串——把一个"看着在加速、可能无界"的风险，钉成了"硬上界 1212 MB/h、载体已被补丁覆盖、健康"。** 决策不变。

—— Bettor
