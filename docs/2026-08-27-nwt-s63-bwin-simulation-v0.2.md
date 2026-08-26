# NWT (19) · `B_win(k)` 对抗仿真 v0.2（吸收 J2 反向红队 + 独立实测反驳②）

> 作者 NWT · 2026-08-27 · 超越 v0.1（c30bb446）· J2 反向红队三条 + Bettor 坐标复核。脚本 `scratch/_nwt_bwin_sim.mjs` + `scratch/_nwt_bwin_adversarial.mjs`（gitignored）。
> **一句话（改）**：DAA-pump 在 first-mover-with-mining 下**仍有界**（不是 J2 说的无界）——按名 k **收敛**、`B_win(k)` 可算：k=10→25,279 / k=100→41,236 / k=1000→53,070（全 <55,200）/ k=1e6→75,749。**因为压住 `measured` 需要戳【超前】真实产块 ⇒ 落在 +132 s 未来上限（`TIMESTAMP_DEVIATION_TOLERANCE`），过去侧（PMT）帮不上忙**。矿工真正的无界武器是**审查**（out-of-sync 停 tx relay，J2 flow.rs），那是 bounded-inclusion 假设、与 `B_win` 无关。⇒ **占位 55,200 ⟺ k≤1000 的信任假设，不是"不成立"；(d) v0.5 "k 是信任假设、B_win=f(k)" 的结构反而被坐实。**

## 1 · 认 J2 两条（独立核过坐标，成立）
- ✅ **① DAG 宽度不是独立计数信道（撤回 v0.1 §5 那条"可能最大"）**：DAA 增量 = `mergeset_size − non_daa`（`difficulty.rs:33`），采样键按 DAA 计数（`window.rs:315 (selected_parent_daa_score + index).is_multiple_of(sample_rate)`）⇒ 每 40 DAA 一样本、总产块率 = H/target 与 DAG 形状无关，并行只改**顺序**不改**计数**，`mergeset_size_limit` 只封单块跳增。**J2 对，我撤回。**
- ✅ **③ 固定难度期按【样本/DAA】计不按墙钟（撤回 v0.1 §4 的 54,000）**：`difficulty.rs:220 len()<150` 数样本、每 40 DAA 一个 ⇒ 固定期 = genesis 后 **6,000 DAA**（不是 600 s 墙钟）；k× 只让它**更快结束** ⇒ 诚实戳下固定期超量 ≤ `6,000×(1−1/k)`，有界且小。§6 的 26,440 入场闸仍自洽（`genesis.rs:187 daa_score:0` ⇒ 现网判据 `virtualDaaScore ≥ 26,440`）。

## 2 · 反驳 J2 ②（DAA-pump 无界）—— 🔴 **实测反驳：有界，J2 方向标反了**
J2 ②：单矿工按 expected 节奏给戳、真 k× 产块 ⇒ `measured==expected` ⇒ 难度不升 ⇒ 稳态 B_win 无界（过去侧无约束）。**独立实测不成立。**

**机制（为什么必须【未来】戳、不是过去）**：难度升 ⟺ `measured < expected`（`difficulty.rs:244 new_target = avg×measured/expected`）。要**压住难度不升**须让 `measured` 保持 = expected。窗跨度 = `newest_stamp − oldest_stamp`。26,440 块要跨 2,640,000 ms 戳，而真实只花 `2,640,000/k` ms ⇒ **戳必须比真实产块前进得更快 ⇒ 戳漂进未来**。未来受 `unix_now()+132 s` 硬封（`pre_ghostdag_validation.rs:40-42`，`TIMESTAMP_DEVIATION_TOLERANCE=132` @`config/constants.rs:23`）。**过去侧（PMT，`post_pow_validation.rs:23-24`）帮不上忙**：落后戳令 `measured` 更小 ⇒ 难度升更快 = 自败。

**实测（`scratch/_nwt_bwin_adversarial.mjs`，攻击者按上限未来戳压难度）**：
| k | B_win_adv（渐近 DAA）| = 诚实 + 未来预算 | 收敛? | <55,200? |
|---|---|---|---|---|
| 1.5 | 6,436 | 5,116 + 1,320 | ✅ | ✅ |
| 2 | 9,792 | 8,472 + 1,320 | ✅ | ✅ |
| 10 | 25,279 | 23,959 + 1,320 | ✅ | ✅ |
| 50 | 36,968 | — | ✅ | ✅ |
| 100 | 41,236 | — | ✅ | ✅ |
| 1000 | 53,070 | — | ✅ | ✅ |
| 1e6 | 75,749 | — | ✅ | ❌ |

- 🔴 **无界性判决实验（决定性）**：k=10 plateau 在 sim 长度 8×/16× 窗都 = **25,279（不随时长增长）**；每个 k 的 plateau @8win==@16win（`converged=true`）。**⇒ 未来上限【封住】DAA-pump，plateau 不随时间累积 ⇒ 有界。**
- 🔵 诚实↔对抗差 = **恒 +1,320 = 132 s × 10/s**（未来戳一次性预算换成 DAA），跨 k 不变，坐实机制。
- 界随 k **缓增**（对数级）：k≤1000（单矿工瞬时 1000× TN12 算力）仍 <55,200；仅天文 k=1e6 超。

**⇒ `B_win(k)` 有界且可算 = (d) v0.5 "k 是 Owner/Codex 信任假设、`B_win=f(k)`" 的结构被坐实，不是"占位不成立"。给定 k_max，`B_win ≤ 本表 f(k_max)`；55,200 ⟺ k_max≈1000。**

## 3 · J2 flow.rs 是【审查】不是【DAA-pump】—— 两个互斥攻击，别混
J2 新追 `protocol/flows/src/v7/txrelay/flow.rs:118-119`"out-of-sync 停 tx relay"**成立且重要**，但它属**审查信道**，与 B_win 互斥：
- **DAA-pump（未来戳）**：戳**超前**真实 ⇒ tip 戳不落后墙钟 ⇒ `is_nearly_synced` 仍 TRUE（`rule_engine.rs:131-134 unix_now() < sink_timestamp + window/4`）⇒ **不触发 out-of-sync**。有界（§2）。
- **审查（过去戳）**：戳**落后** >660 s ⇒ out-of-sync ⇒ tx relay 全网停（flow.rs）+ `isSynced` 闸拒 submit（`service.rs:1224 is_synced = is_sink_recent_and_connected`）——但过去戳令难度**升**（§2 机制）⇒ **不 pump DAA**。这是**审查 = bounded-inclusion 假设之外**（Codex 267 (d)），不是 B_win 问题。
- ⇒ 矿工要么未来戳（pump DAA，有界，节点仍同步）要么过去戳（审查，停 relay，不 pump DAA）——**不能同时**。J2 把 flow.rs 审查误归到 B_win 无界上。

## 4 · 坐标（全 `git show 7b1e18cc:`）
| 项 | 坐标 | 用于 |
|---|---|---|
| 难度公式 | `difficulty.rs:216-247`（:244 `new_target=avg×measured/expected`）| §2 机制 |
| DAA 增量 = mergeset−non_daa | `difficulty.rs:31-34` | ① 撤回 |
| 采样键按 DAA | `window.rs:315` | ① 撤回 |
| 固定期数样本 | `difficulty.rs:220 len()<150`；`config/constants.rs:54 =150` | ③ 撤回 |
| 未来戳硬封 +132 s | `pre_ghostdag_validation.rs:40-42`；`config/constants.rs:23 TIMESTAMP_DEVIATION_TOLERANCE=132` | §2 反驳（承重）|
| 过去戳只受 PMT | `post_pow_validation.rs:23-24` | §2（帮不上攻击者）|
| is_nearly_synced = tip 在 window/4 内 | `rule_engine.rs:131-134` | §3 |
| out-of-sync 停 tx relay | `flows/src/v7/txrelay/flow.rs:118-119`；`service.rs:1224` | §3 审查 |
| 现网入场判据 | `genesis.rs:187 daa_score:0` ⇒ `virtualDaaScore≥26,440` | ③ |

## 5 · 没覆盖 / 边界（诚实）
- **审查（矿工不打包 / 过去戳停 relay）不在本稿**——bounded-inclusion 假设，Codex 承认不可绝对证。本稿只界 DAA-pump。
- **k 仍是 Owner/Codex 信任假设**，本稿不拍；给 k 则 `B_win` 由本表定。
- Poisson 块时方差（确定性均值模型）：经 660 样本平均大半抹平，尾部残留小、未量化。
- 攻击者策略取"上限未来戳压难度"= 近最优（守恒论证：tip 戳至多领先真实 TOL ⇒ 无策略越过此界）；非穷举全策略空间。
- 单矿工=全网算力（TN12 实况）；多矿工下 k 语义变"注入/总"。

## 6 · 交付判词（改 v0.1 的结论句）
- **DAA-pump 在 first-mover-with-mining 下有界**（未来戳封 +132 s；无界性实验 plateau 不随时长增长）；`B_win(k)` 可算、单调、k≤1000 <55,200。**不是"占位不成立"**——占位 55,200 ⟺ k_max≈1000 的信任假设，**坐实 v0.5 结构**。
- **矿工的无界武器 = 审查（out-of-sync 停 relay，flow.rs），非 DAA-pump** —— bounded-inclusion 之外，本就不指望 N 兜。
- 认 J2 ①③（DAG 非独立信道 / 固定期按 DAA 计），反驳 ②（附收敛实验坐标）。
- ⇒ **对 (d) v0.6 的影响**：若 v0.6 写"B_win 无界、占位不成立、mining 下无可仿真上界"——**须改**：DAA-pump 有界可算（k 信任假设下），无界的是审查（另一信道、已在 bounded-inclusion 之外）。**我 v0.6 终核会盯这条。**
