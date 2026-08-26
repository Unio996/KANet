# NWT 红队 — §6-3 gate (d) v0.7 终核签字

> 作者 NWT · 2026-08-27 · 被审 = `docs/2026-08-27-j2-s63-gate-d-conservative-bounds-v0.1.md`（**c1b7bb4e** v0.7）
> 承 v0.5 签字（6afb111d）+ B_win 反驳弧（我 sim v0.2 = 9a4f4127 反驳 J2 v0.6"无界"，J2 反向核后认）。Bettor 点名判：3-C 是否把守恒当主论证（不能只靠 sim 表）。
> **总评：守恒实质【在】（L146 机制 + L147(i) 接收方墙钟判）= 过 Bettor 判据、非 MUST；§6 改"保守闸"正确、§7 k_max 诚实标弱假设、"无界"只剩审查(out-of-model) = GREEN。** 两非阻塞注。

## 1 · Bettor 点名：守恒是不是主论证 —— ✅ 实质在，非只 sim
- **L146 机制（结构论证，非 sim 依赖）**：压 `measured≥expected` 需新戳超前真实、超前量累积 ⇒ 撞 +132s 未来硬封 ⇒ 之后 claimed 速率被钉回真实速率；过去侧落后戳压小 measured=自败 ⇒ **未来预算一次性 +132s ⇒ B_win 有界=f(k)**。
- **L147(i) 守恒的接收方形式（我那句的实质）**："未来封按**接收方**墙钟判，攻击者自己节点不受限但进不了诚实 DAG=pump 没发生；等真实追上再释放 ⇒ 公共 DAA 速率=claimed ≤ 真实+132s 一次性 ⇒ 仍 f(k)"。**= 守恒不变量在，boundedness 不只靠 sim 表。**⇒ **过 Bettor 判据、非 MUST。**
- sim（L148）正确降为**数值佐证**（J2 逐格复现）。

## 2 · 其余 v0.7 变更核 —— 全对
- ✅ **§6 固定期改"保守闸"（L203）**：禁用理由从"无界"改为"f(k) 界依赖'难度已按完整窗响应'，入场前须一个完整采样窗历史 ⇒ 之前 fail-closed 不入场"。26,440=661×40（比 6,000 保守），起算 `TESTNET12_GENESIS.daa_score=0`（genesis.rs:187），always() 软 fork 不重置窗、不作起算点（我 v0.5 措辞收紧已纳）。**正确——闸从'挡无界'变'保 f(k) 前提成立'，与我 sim v0.2 一致。**
- ✅ **§7 1-bis（L214）**：(甲) 降级为具名 `k_max` 信任假设，**诚实标弱**（"TN12 现网基线算力极小，k=1000 绝对量便宜 ⇒ 弱假设，成立与否 Owner/Codex 决"）；(乙) 撤回（有界无须换锚，仅留"k_max 拍不出才重上桌 + 与 v0.15 §5@L321 冲突"提醒）。**姿态正确：占位 55,200⟺k≤1000，且明说这在小算力测试网是弱保证。**
- ✅ **"无界"清理**：只剩版本历史头（L3-4）+ L217 审查信道"无界但 out-of-model"（bounded-inclusion，与 pump 互斥，Codex 承认不可绝对证）。DAA-pump 全改"有界 f(k)"。
- ✅ 三攻法鲁棒（L147）：(i) 私挖释放被 publish-wait 抵消；(ii) 控 min_ts 不成（PMT 下限 > 窗 min）；(iii) 审查与 pump 互斥。

## 3 · 两非阻塞注
- 🔵 **注1（强化，建议非 MUST）**：守恒现散在 L146（live）+ L147(i)（私挖），读起来像"测了三种攻法都不破"（枚举）。建议**提升为一条显式【全称不变量】**："∀ 攻击者策略：每个块都须过某诚实节点收块时的 +132s 未来封 ⇒ 已发布链的 stamp-elapsed ≤ real-time+132s（任一诚实接收方）⇒ pump 速率 ≤ 真实 + 一次性 132s"。这样 boundedness 是**闭式（覆盖所有策略）**而非**枚举（三攻法）**——堵"第四种攻法呢"。同我一贯 composite/枚举非全称判据。
- 🔵 **注2（事实修，安全方向）**：L147(ii) 说新戳过去下限"PMT+1 ≈1,320s 前"——**数偏大**。PMT 窗 = `MEDIAN_TIME_SAMPLED_WINDOW_SIZE = (2×132−1)/interval`（`config/constants.rs:29-31`）跨 ≈263s ⇒ PMT ≈ 当前 −131s，**过去下限 ≈131s 前**、不是 1,320s。**结论不变且更强**（下限更新=更够不到窗 min 2,641s，更压不低 min_ts）。改数即可。

## 4 · 交付判词
- **§6-3 gate (d) v0.7（c1b7bb4e）= GREEN（设计/证据层）。** 守恒实质在（过 Bettor 判据、非 MUST）；§6"保守闸"、§7 k_max 诚实标弱、审查=out-of-model 全对；三攻法鲁棒。
- **两非阻塞注**：注1 守恒提升为全称不变量（强化 boundedness 闭式）；注2 L147(ii) PMT 下限改 ≈131s（结论更强）。落码/交 Codex 时顺手，不阻塞推。
- **GREEN 边界**：设计/证据闭合；数仍 PROVISIONAL-PLACEHOLDER（B_win 待 k_max、N_claim n=1、S_unalloc 待散度、W_dis 坏节点数）；(d) 仍 OPEN/PROVISIONAL（Codex 口径）。审查 out-of-model 是**声明边界**不是遗漏。
- 待 fee-source v0.2 到一起终核（我 (18) 三须改：H2 拥塞时延限定 / H3 死区效率 vs F>min_O 结构死 / H4 watchtower 符号）。
