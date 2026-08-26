# Tier-2 算力地板量法规格 v0.3（吸收 J2 v0.2 三差异 · SUPERSEDES v0.2）

> **Status**: DESIGN v0.3 · NWT 2026-08-27 · SUPERSEDES v0.2（e0b8b3b7）· J2 快核 v0.2 = GREEN-WITH-3-差异（认 ② 机制纠正、撤"块计分母"）→ 本版闭合三差异。设计层无节点，数 PLACEHOLDER。
> **一句话**：v0.2 的结构（`H_floor_total` 客观 + `s_adv` 假设 ⇒ `H_floor_honest`）保留；v0.3 三闭合：**① 法3 窗口用块时间戳 [t−W,t] 且 W≫132 s（戳操纵放大上界=W/132 s）+ R_vol 纳 Poisson 噪声**；**② `s_adv` 后门机械封死——`s_adv:=max(Owner, s_max)`，`s_max`=窗内最大单 coinbase 份额=无假设硬下界 ⇒ 单矿工 s_max=1 自动 fail-closed（机制输出非人拍）**；**③ 披露 s_max+窗（coinbase 可复核）、只 Owner 加严部分是假设**。

## 1 · 估计器 `min(法1, 法2, 法3)` —— ① 法3 闭合
| 法 | 公式 | 坐标 @7b1e18cc | 性质 |
|---|---|---|---|
| 法1 | `calc_work(tip.bits)×BPS` | `difficulty.rs:261`；`math/lib.rs:64`；`config/params.rs:689` | 陈难度、撤后滞后 |
| 法2 | `Δblue_work/window_duration`，`window_duration=(max_ts−min_ts)/1000` s，窗≥1000 块 | `difficulty.rs:46-66`；`MAX_SAFE_WINDOW_SIZE=10,000` @`rpc/core/src/api/rpc.rs:16` | 时间戳分母但窗内容陈旧滞后（~1000 块 flush）|
| **法3** | [t−W, t] 内**按块时间戳落窗**的出块数 × 该窗末 `work_per_block` = 瞬时算力 | calc_work + 块时间戳计数（`getBlock` 链上可复核）| 抓撤算力最快 |
- 🔴 **法3 闭合定义（①）**：窗**按块时间戳** `blockTs∈[t−W, t]`（**链上数据、第三方可复核**），**非按接收时刻**（接收时刻=本地钟非链上 ⇒ 只作 **operator 本地告警**、**不作地板输入**）。**`W ≫ 132 s`（≥10 min 量级）**：`W/132 s` = **该法的时间戳操纵放大上界**（对手用 ±132 s 未来封挪块进/出窗，放大量 ≤ W/132 s；W 越大越稀释）。
- 取 `min(三者)`：保守=不高估总算力。

## 2 · 窗口：墙钟；估计器内部亦墙钟锚定（法2 时间戳跨度 / 法3 块时间戳窗），不靠块选陈旧。DAA-count 窗被 pump 压缩纪律保留。

## 3 · "稳定" 判据（作用于【总】算力）—— ① R_vol 纳 Poisson
- (a) 样本充分（`≥N_min` ∧ 覆盖 `≥T_win`）；(b) 地板取 **p10**；(c) 无深坑（连续子窗 `<p10×f_dip`）+ 波动封顶 `p90/p10≤R_vol`。
- 🔴 **R_vol 须纳法3 的 Poisson 噪声（①）**：撤后低产（如 0.1 块/s）时 10 min 窗仅 ~60 块，块数 Poisson 相对标差 ~1/√60 ≈ ±13% ⇒ **正常统计噪声就有 ±13% 波动**；`R_vol` 阈须设在此噪声之上（如低产档 `R_vol ≥ 1.5`），否则**正常噪声误触"不稳定"**（假 fail）。`R_vol` 按窗内平均出块率动态定（率越低、Poisson 噪声越大、阈越松）。
- 三闸只保证"总算力稳定"，不保证"诚实"——见 §3.5。

## 3.5 · 🔴 诚实份额：`s_adv := max(Owner 假设, s_max)`（② 机械封后门）
- **`H_floor_honest = H_floor_total × (1 − s_adv)`**。
- 🔴 **`s_adv := max(s_owner, s_max)`**，两项：
  - **`s_max` = 窗内【最大单一 coinbase 收款方】的出块份额**（`getBlock→coinbase tx→output 地址`，逐块统计，**链上可复核、无假设**）。**理由**：对手可以是**任何一个矿工** ⇒ 诚实份额 `≤ 1 − s_max` 是**无假设硬上界**（最大那个矿工若是对手，诚实最多剩 `1−s_max`）。**这是 (ii)，v0.3 从 Owner 可选升为【必算项】。**
  - **`s_owner`** = Owner 额外假设（(i)），**只准在 `s_max` 之上【加严】（提高 `s_adv`）、不准放宽**（不得设 `s_adv < s_max`）。
- 🔴 **Sybil 方向（须明标）**：Sybil 分址把一个矿工拆多地址 ⇒ `s_max` **偏低**（看着更分散）⇒ `s_max` 是对手份额的**下界**、真实集中度**更高**。⇒ **`s_max` 机械封的是【可见集中】（s_max 高即自动抬 s_adv→抬 fail-closed 概率），【隐藏集中(Sybil)】须靠 `s_owner` 加严兜**——所以 (i) 加严是**安全必需**不是可选。**只有 `s_max=1`（单矿工，无从 Sybil）是精确的。**
- 🔴 **机制输出（②，§6 底线从"结论"变"机制"）**：TN12 单矿工 ⇒ `s_max=1` ⇒ `s_adv=1` ⇒ `H_floor_honest=0 < H_floor_min` ⇒ **自动 fail-closed，不经任何人拍**。§6 不再是"我判 TN12 该禁"，是**公式对现网 coinbase 数据的直接输出**。

## 4 · `k_max = 1 + H_adv / H_floor_honest`；闭环 `H_floor_honest ≥ H_floor_min = H_adv/(k_baked−1)` 否则 fail-closed（`k_baked` 由 baked N + B_win 曲线定）。

## 5 · fail-closed + 已开仓入场前披露（MUST）—— ③ 补 s_max
- 连续再量 `H_floor_honest`；滞回两阈 + `T_dwell`；恢复须全新完整稳定窗。
- 🔴 **入场前披露（MUST）**：{`k_baked`、入场 `H_floor_total` 采样、**`s_max` 及其采样窗**、`s_owner` 加严量、`H_adv`、在飞期不受再量保护}。
- 🔴 **③ 可复核分层**：**`s_max` 及采样窗随 artifact 落，第三方从 coinbase 独立复算**（客观）；**只有 `s_owner` 加严部分是假设**（须标依据）。⇒ 披露里"链上可核部分"与"Owner 假设部分"分开，反应方对前者复核、对后者自判可信。
- 已开仓政策（跌破⇒在飞加速结算 vs 接受在飞担开仓风险）Owner 拍；**披露 MUST**。

## 6 · 🔴 底线 = 机制输出（不再是结论）
- **现 TN12：`s_max=1`（单矿工 coinbase）⇒ `s_adv=1` ⇒ `H_floor_honest=0` ⇒ fail-closed，公式自动输出、无人拍。** Tier-2 = 禁用/实验-only 是 §3.5 机制对现网数据的直接结果。
- **本规格承重在未来有【独立、可归属、去中心】矿工的网络**（`s_max` 显著 <1 且 Sybil 受 `s_owner` 兜）。与 Codex 北极星一致。

## 7 · 谁量 / 第三方可复核 / 证据
- `H_floor_total`（法1/2/3）+ `s_max` 全是**公开链数据**（difficulty / blue_work / block-ts / coinbase 地址）⇒ 反应方/watchtower **自己重算**，非 operator 自证。`s_owner` 加严是唯一假设、须单独披露依据。
- provenance artifact：入场决策 + 连续再量 + `s_max`/采样窗 + 法3 读数 + `s_owner` 依据。

## 8 · 未决 / 边界
- 数值 PLACEHOLDER（`T_win/W/Δ_sample/N_min/f_dip/T_dip/R_vol(动态)/m_up/m_down/T_dwell/H_adv/s_owner`）。
- 审查信道仍 out-of-model（J2 ①：现 TN12 单矿工下审查才是真杀招非 pump）；本规格只管 pump 侧 k_max。
- 已开仓政策 = Owner/Codex（披露 MUST、策略开放）。
- 🔵 法3 按接收时刻变体、`s_owner` 具体值、二手 ASIC 价/头寸 VaR（接 (21) v0.3）= 后续。
