# Tier-2 算力地板量法规格 v0.7（Codex 5d23a4be 两 MUST-FIX · SUPERSEDES v0.6）

> **Status**: DESIGN v0.7 · NWT 2026-08-27 · SUPERSEDES v0.6（b6dbcfd0）· Codex MSG-277（5d23a4be）裁：`s_visible_max`/提取器 PASS、`s_adv_cap` 要求 + 无 cap fail-closed PASS(as policy shape)、`s_adv_cap ≥ s_visible_max` = **一致性条件非推导**、单矿工 fail-closed PASS、法3 live/retro 方向 PASS（Codex 亲核 132/10/采样率）。**两 MUST-FIX**：① 经济 cap (ii) 分母双计；② 132 s 措辞。本版只改这两处 + `s_adv_cap≥s_visible_max` 标"一致性条件"。**其余同 v0.6/v0.4。**

## MUST-FIX ① 经济 cap (ii) 分母双计（Codex）——冻结 `H_adv` 语义
🔴 **Codex 判**：v0.6 (ii) 写 `s_adv ≤ H_adv/(H_total_lb + H_adv)`——**分母 `H_total_lb` 是【总网络】下界、可能已含对手算力**，再把 `H_adv` 加进分母 = **双计**（对手被算两次）。须**冻结 `H_adv` 语义二选一**（Owner 定用哪个，公式随之）：

| 冻结选项 | `H_adv` 语义 | `s_adv_cap` 公式 | 前提 |
|---|---|---|---|
| **(a) 总对手** | `H_adv_cap` = 总对手算力上界（**在场 + 保护窗内可动员**，含已在网络里那部分）| **`s_adv_cap = min(1, H_adv_cap / H_total_lb)`** | 窗口/单位与 `H_total_lb` 一致；不再另加 `H_adv` 进分母 |
| **(b) 仅增量** | `H_adv_add` = 入场后**仅注入增量** | **`s_adv_cap = ((1 − s_self)·H_total + H_adv_add) / (H_total + H_adv_add)`** | 🔴 **须界住现有非我方算力**：用入场时诚实自持份额 `s_self`（= 本形状 (i) 的量），`H_total` 用有依据的界；**无诚实基线/身份假设 ⇒ 增量式【不能界】**（不知现有 `H_total` 里多少是对手）|

- **(a) 更干净**（总对手 / 总网络，一步）；**(b) 依赖 `s_self` 基线**（把 (i) 自持份额路接进来——所以 (i)(ii) 在 (b) 下耦合，非独立）。
- 🔴 **v0.6 的 `H_adv/(H_total_lb+H_adv)` 作废**：它既非 (a)（(a) 分母不含 H_adv）也非 (b)（(b) 有 s_self 项）——是把"H_adv 加在纯诚实 total 上"的错模型，而 `H_total_lb` 不是纯诚实。
- **fail-closed 不变**：(a) 无可信 `H_adv_cap` / (b) 无可信 `s_self`+`H_total` ⇒ 无 `s_adv_cap` ⇒ Tier-2 关。TN12 结论不变（单方持全部算力 ⇒ 对方 `s_self≈0` ⇒ (b) 分子 ≈ `H_total`+add ⇒ `s_adv_cap≈1` ⇒ 关；(a) 亦然）。

## MUST-FIX ② 132 s 措辞——不是"所有掩盖影响的硬上限"，改三段（Codex）
🔴 **Codex 判**：v0.6 称 132 s 为"掩盖时限硬上限（根守卫）"**太宽**——132 s 只硬界**头段**，残余估计器影响随窗衰减、检测时延另有式。改**三段（在声明的速率/统计假设下）**：

| 段 | 量 | 含义 |
|---|---|---|
| **① 全掩盖 / 预戳头段** | **≤ 132 s** | 对手用未来封（+132 s）/预戳能把法3 完全掩盖的**最长头段墙钟**——这一段 132 s 是硬界（共识戳规则给），戳挖时定死、撤后改不了旧块 |
| **② 残余估计器影响** | **随滑动 `W` 窗衰减** | 头段后，预戳块随窗滑过而**老化出窗** ⇒ 法3 对 `H_floor_total` 的残余偏差**随 W 线性衰减**（`H_floor_total_lb(法3)=法3_raw/(1+口径/W)`，口径 live 132/retro 264）——不是"132 s 之后就零"，是衰减 |
| **③ 阈值检测时延** | **`132 + f×W + T_dwell`** | 抓到 fraction `f` 撤算力的时延（**在声明的出块速率 + Poisson 统计假设下**：`W>132/f_detect` ∧ `W≥(1/f)²/R`）⇒ **在飞头寸暴露窗 = 此式**，接 §5 披露 |
- 🔴 **不许再写"132 s = 所有掩盖影响的硬上限"**：132 s 硬界的是**头段①**；总影响 = 头段(≤132 s) + 残余(随 W 衰减②) + 检测时延(③)。真正的守卫是**"戳挖时定死+未来封"这条机制**（给出 ① 的 132 s），W 调 ②③ 的折中。

## 其余认 Codex（非改公式）
- ✅ **`s_adv_cap ≥ s_visible_max` = 一致性条件非推导**（v0.7 措辞收）：`s_visible_max` 不推出 `s_adv_cap`，只**校验**任何独立论证的 `s_adv_cap` 至少盖住可见集中（< 可见集中的 cap 直接否）。
- ✅ 法3 live/retro 方向、132/10/采样率、单矿工 fail-closed、提取器、`s_visible_max` 语义——Codex PASS，不动。

## 未变（同 v0.6/v0.4）
§1 min(法1,法2,法3)；§2 墙钟窗；§3 三闸 + R_vol；§3.5 `s_visible_max` payload 归属（Codex 亲核 coinbase.rs）+ `s_adv_cap` 三源（(i) 1−s_self /(ii) 经济【本版冻结 (a)/(b)】/(iii) 身份路开放匿名网不可用）+ 无 cap fail-closed；§4 `k_max` 用 `H_floor_honest_lb=total_lb×(1−s_adv_cap)`；§5 fail-closed + 已开仓入场前披露 MUST（在飞暴露窗 = 132+f×W+T_dwell）；§6 底线机制输出；§7 第三方复核；§8 未决（`H_adv` 语义 (a)/(b) = Owner 冻结项）。
