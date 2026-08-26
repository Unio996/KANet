# Tier-2 算力地板量法规格 v0.8（认 J2 红队 v0.7 三点 · SUPERSEDES v0.7）

> **Status**: DESIGN v0.8 · NWT 2026-08-27 · SUPERSEDES v0.7（590092a6）· J2 反向红队 v0.7 三点**全认**（两处是我 v0.7 的公式错）。只改 §3.5(b)（cap 分母来源 + H_self 形）+ §4（`k_max` 分母）。**其余同 v0.7/v0.6。**

## 认 J2 三点（两处公式错，我认）
- ✅ **(a) `H_total_lb` 必须钉为 (21) v0.5 `min(可用法)` 且 `gate_input=OK` 的值**：法1 独用（陈难度过估）撑大分母 ⇒ `s_adv_cap` 偏小 ⇒ 诚实地板偏大 ⇒ 入场太易 = 危险。**规格写死：`H_total_lb` 不得取 (21) 的 `law1_only`/`PROVISIONAL_OVERESTIMATE`/`FAIL_CLOSED` 态**——只认 gate_input=OK 的 min。
- ✅ **(b) s_self/T 错配，改 H_self 形（更干净）**：v0.7 (b) `((1−s_self)·H_total + H_adv_add)/(H_total + H_adv_add)` 的 `s_self` 是份额、须与同一 `T` 同窗，错配则不保守（∂/∂T<0 ⇒ T 取下界才保守；∂/∂s_self<0 ⇒ s_self 取小才保守）。**改用我方自知的绝对 `H_self`（自家矿机读数）**：`s_adv_cap = (max(0, H_total_lb − H_self) + H_adv_add) / (H_total_lb + H_adv_add)`——去掉 s_self/T 错配（`max(0,·)` = 在场非我方算力上界）。
- ✅ **(c) `k_max` 分母错（我 v0.6/v0.7 用诚实地板）**：`k` 是 pump 倍率 = **总**网络算力乘子（我 B_win sim `H_rel=k` 是总算力乘子，实核 README:36）⇒ `k = (H_total + H_adv_add)/H_total = 1 + H_adv_add/H_total`。**`k_max = 1 + H_adv_add / H_total_lb`**（增量/**总**），**不是** v0.6/v0.7 的 `1 + H_adv/H_floor_honest_lb`（用诚实地板作分母错——DAA-pump 是全体矿工的量、不只诚实那份）。

## §3.5(b) 重写：两个量、两个消费者（别混）
🔴 **v0.7 把 (a)/(b) 当"同一 s_adv_cap 的两形式取 max"——不完全对（J2）**：它们**答不同问题、喂不同消费者**：

| 量 | 式 | 喂谁 |
|---|---|---|
| **`s_adv_cap`**（在场对手**份额**上界）| **(a-total)** `min(1, H_adv_cap/H_total_lb)`（`H_adv_cap`=总对手，在场+窗内可动员）**或** **(b-self)** `(max(0, H_total_lb−H_self)+H_adv_add)/(H_total_lb+H_adv_add)`；**两者同可算取 max（更严）** | **诚实地板** `H_floor_honest_lb = H_floor_total_lb × (1 − s_adv_cap)` |
| **`H_adv_add`**（pump **增量**）| Owner 对抗预算里的"入场后可注入增量" | **`k_max = 1 + H_adv_add/H_total_lb`** → `B_win(k_max)`（我 sim 曲线，durable 8310f390）|
- 🔴 **两者独立**：`s_adv_cap`（份额）管"诚实防御还剩多少"；`H_adv_add`（增量）管"pump 能把 DAA 抬多快"（B_win 的 k 只与增量有关、与在场对手份额无关）。**入场须两条都过**：`B_win(k_max) ≤ baked 预算` **且** `H_floor_honest_lb ≥` 该门要的诚实防御下界。
- **`H_total_lb` = (21) v0.5 `min(可用法), gate_input=OK`**（(a) 钉死；law1_only/FAIL_CLOSED 态不得用）。
- **fail-closed 不变**：无可信 `H_adv_cap`/`H_self`+`H_adv_add`/`H_total_lb` ⇒ 无 cap ⇒ 关。TN12：我方持全部 ⇒ `H_self≈H_total_lb` ⇒ (b-self) 分子 ≈ `0+H_adv_add` ⇒ `s_adv_cap≈H_adv_add/(H_total_lb+H_adv_add)`；但**对方视角** `H_self≈0`（对方零算力）⇒ (b-self) 分子 ≈ `H_total_lb+H_adv_add` ⇒ `s_adv_cap≈1` ⇒ 关。fair-exchange 两侧都要 ⇒ 现网关（机制输出）。

## §4 `k_max` 更正
- **`k_max = 1 + H_adv_add / H_total_lb`**（增量/总；`H_total_lb` 同 §3.5 钉死）。作废 v0.6/v0.7 的 `1 + H_adv/H_floor_honest_lb`。
- 入场 `B_win(k_max) ≤ baked B_win 预算`（占位 55,200 ⟺ `k_max ≲ 1000`，Codex 不推荐——弱假设）。

## §7 残余 + 🔴 (d) v0.9 §6 撤双计
- 🔴 **(d) v0.9 §6 step 2 仍写作废的双计式 `H_adv/(H_total_lb+H_adv)` ⇒ v0.10 必撤**，换本版 (a-total)/(b-self) 两式 + `k_max=1+H_adv_add/H_total_lb`（J2 起 (d) v0.10 确定部分时同步）。
- `H_adv_cap`（(a) 用）/ `H_adv_add`（(b)+k_max 用）/ `H_self`（(b) 用）的语义与值 = Owner 冻结项（§8）。

## 未变（同 v0.7/v0.6）
§1 min(法1,法2,法3)（对齐 (21) v0.5，`gate_input=OK` 才作 firm 地板）；§2 墙钟窗；§3 三闸；§3.5 `s_visible_max` payload 归属 + `s_adv_cap≥s_visible_max`=一致性条件；§5 fail-closed + 已开仓披露（在飞暴露窗 132+f×W+T_dwell）；§6 底线机制输出；§7 复核；§8 未决（`H_adv_cap`/`H_adv_add`/`H_self`/`H_total_lb` 来源 = Owner + (21) 工具）；法3 三段（头段≤132s/残余随W衰减/时延132+f×W+T_dwell）。
