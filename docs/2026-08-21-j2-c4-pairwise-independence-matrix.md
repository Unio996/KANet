# C4-FINALITY 同链构造：**两两独立性矩阵**（v0.4 · 报备层 · 零生产码）

> **Status**: CURRENT

**作者** J2 · **日期** 2026-08-21 · **派工** Bettor 18:20（采纳 J2 提议）
**被测对象** `docs/2026-08-21-j1-s6-3-A-covenant-construction-v0.4.md`（J1，权威构造）

---

## §0 这张表要回答什么

四次红队逮到的洞**是同一个形状**：**两件各自合法的动作可以【各自独立发生】**。

① reveal-claim 与 LOCKED_R-transfer 未焊（只领钱不造 O）
② C 的其它支未禁（不走 reveal 也产合法 lineage）
③ 「同笔消费 C」未限定走哪条支（走 C 的 refund 支绕过焊接）
④ O 的生命期与被保护本金的退款窗未耦合（造真 O 却抢先 refund 自己本金）

⇒ **每焊住一对，下一对没焊的就成新洞。** 本表把「等下一次红队逮」换成「矩阵里有没有空格」。

🔴 **它不保证没有第五条**；它保证**第五条若存在，它是表里的某一格**，而不是"谁都没想到的地方"。

---

## §1 支路全集（8 支，取自 v0.4 §4）

| 记号 | 对象 | 支 |
|---|---|---|
| **C1** | capability `C` | reveal-claim（消费 C、造 O） |
| **C2** | `C` | terminal-refund |
| **R1** | `LOCKED_R`（反应方本金） | transfer 支（cutoff 前，首动方揭 s 领；焊接要求同笔消费 C） |
| **R2** | `LOCKED_R` | terminal-refund（cutoff 后退**反应方**） |
| **F1** | `LOCKED_F`（首动方本金） | reactive-claim 支（O 作 co-input，付反应方） |
| **F2** | `LOCKED_F` | terminal-refund（`T_refund_LOCKED_F` 后退**首动方**） |
| **O1** | `O` | 被 F1 作 co-input 消费 |
| **O2** | `O` | `T_O` 回收（退首动方） |

🔴 **本表只覆盖这 8 支。新增任何一支，本表即不完整** ⇒ **改构造时同步更新是义务，不是一次性附录。**

---

## §2 矩阵（每格：WELDED / INDEP-SAFE / 🔴 INDEP-SEAM）

**同对象两支**（UTXO once-spend 天然互斥）：

| 对 | 判 | 机制 |
|---|---|---|
| C1×C2 · R1×R2 · F1×F2 · O1×O2 | **WELDED** | 同一 UTXO 只能被花一次；且各配 cutoff 分窗 |

**跨对象**（承重的都在这里）：

| 对 | 判 | 机制 / 正证 |
|---|---|---|
| **R1×C1** | **WELDED** | v0.3 焊接：R1 require 同笔消费 C ⇒ C 被消费 ⇒ 其窗内唯一支 C1 ⇒ 强制造 O |
| **R1×C2** | **WELDED** | cutoff 排序不变量 `T_cutoff_LOCKED_R <= C_terminal_refund_cutoff` ⇒ R1 活窗内 C2 尚未开 |
| **F1×O1** | **WELDED** | v0.4：F1 require O 作 co-input ⇒ 花 O ⟺ 领 `LOCKED_F` |
| **F1×O2** | **WELDED** | `T_O >= OpTxInputDaaScore(O) + N_claim + N_margin` ⇒ 回收窗晚于反应方 claim 窗 |
| **R2×F1** | **WELDED（真空）** | 无 reveal ⇒ 无 C 消费 ⇒ 无 O ⇒ F1 不可构造 |
| **R2×O1/O2** | **WELDED（真空）** | 同上：无 O 可花/可回收 |
| **R2×F2** | **INDEP-SAFE** | 双方各自取回本金 = "什么都没发生"的正确结局，无人吃亏 |
| **C1×F2** | 见 R1×F2 | 同一时序问题 |
| 🟡 **R1×F2** | **INDEP-SAFE（有条件）** | 见 §3 —— **本表逼出的唯一一条需要显式记的假设** |

---

## §3 🔴 R1×F2：本表逼出的一条【尚未被列进硬假设】的依赖

**R1** = 首动方领走反应方本金（并被焊接强制造出 O）。
**F2** = 首动方在 `T_refund_LOCKED_F` 后取回自己本金。

**两者能否都发生？** 能 —— 只要**反应方在窗口内没有用 O 去领 `LOCKED_F`**。
此时首动方**两笔本金都拿到**。

v0.4 的不等式 `T_refund_LOCKED_F >= T_cutoff_LOCKED_R + N_claim + N_margin`
保证的是**反应方【有足够窗口】**，**不保证反应方【用了】那个窗口**。

⇒ 🔨 **判据**：
> **`T_refund_LOCKED_F` 那条不等式给的是【机会】，不是【结果】。**
> **no-theft 在这一格上条件于「反应方在窗口内主动 claim」——这是一条【活性假设】，不是结构保证。**

🔵 **我不认为这是洞**：任何 UTXO 系统里"自己不去领钱"都无法被合约救。
🔴 **但它必须被【显式列进硬假设清单】**，与 C4-ENTROPY / s-secrecy / finality-bound 并列 ——
否则「同链拿到**无条件**结构 Tier-2」这句话会被读大。
**目前的假设清单里没有它**（我核过 §17 的四条：C4-ENTROPY / s-secrecy / finality-bound / honest-reveal-timing）。

⇒ 建议记作第五条：**`reactive-liveness`（反应方须在其 claim 窗内行动，否则自负）**。

---

## §4 明列边界

- 🔴 本表**只保证没有格被跳过**，**不保证每格的机制判断是对的** —— 逐格机制仍须 J1（构造域）/ NWT（对抗）各自核。
- 🔴 只覆盖 §1 那 8 支；**新增支即失效**。
- 🟡 未覆盖**三方以上的联合时序**（本表是两两）。若存在需要三支同时发生才触发的缝，本表看不见。
  **我不声称两两穷举等于全穷举。**
