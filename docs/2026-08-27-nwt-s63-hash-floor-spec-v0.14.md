# Tier-2 算力地板量法规格 v0.14（D-STAT-3 闭合：`w_cap_window` = window(SP) 精确重建 ∪ N_C + 结构性证书 · SUPERSEDES v0.13+593ddf93）

> **Status**: DESIGN v0.14 · NWT 2026-08-27 · SUPERSEDES v0.13（`9040b8ec` + fix-up `593ddf93`）· Codex `95d7f354`（MSG-281）判 **D-STAT-3 OPEN / score-domain**。**本版闭合**：覆盖集改 `window(SP)` **精确重建** ∪ N_C（不再用蓝分区间 `A_SP` 刻画），历史闸改**结构性精确证书**。J2 v2 推导（`scratch/_j2_wcap_v2_score_domain_closure.md` + 重建器 `_j2_wcap_rebuilder.mjs` 9 向量全过），**NWT 逐核 @7b1e18cc 两承重成立**（blue_work 单调 / cache 不重过滤）。
> 🔴 **NWT 认错（连栽两层，记）**：v0.13 我把 `W_C ⊆ A_SP` 标 ✓；上轮又补了个"蓝域可证"——**仍不完整**：我只证了"准入时 ≥ 当时阈值"，漏了 **`window(C)` 经 `try_init_from_cache`（`window.rs:265-282`）继承 `window(SP)` 后【不按 C 的阈值重过滤】，且堆淘汰按【蓝功】非蓝分（`:458-468`）** ⇒ 继承成员可存活远超 `bs(C)−26,440`。**Codex 的洞是真的**（其"DAA 域"措辞不准，但指向的洞对）；我该在应用点把继承路径读全，而非只读准入过滤（memory `feedback-verify-the-domain-units-of-a-bound-at-point-of-application-not-derivation`：域对了、路径没读全仍是漏证）。
> **Codex 明写：本轮不授权任何 build / 落码 / 部署 / 签名广播 / DB 变更 / 结算退款 / key movement / 生产钱路。** gate (d) 仍 OPEN。

## §3.5(b) (iii) 重写（覆盖集 = window(SP) 精确重建 ∪ N_C，零域换算）

`H_vis_ub = λ_ub(n) · w_cap_window / (t1−t0)`（λ_ub Garwood 精确，D-STAT-1 CLOSED，不变）。承重 `w_cap_window`：

🔴 **为什么不能用单一蓝分阈值 `A_SP` 刻画 W_C（持久证明，Codex path b 反向）**：`window(C) = try_init_from_cache`（`window.rs:265-282`）**克隆 `window(SP)` 再只 push C 的 mergeset 样本**——**继承自 `window(SP)` 的样本不按 C 的阈值 `lowest_daa_blue_score(C)=bs(C)−26,440` 重过滤**，只受"堆按**蓝功**留最高 661"淘汰（`:458-468`，`Reverse(SortableBlock{blue_work})`）。堆淘汰按蓝功不按蓝分/时间 ⇒ 对手用蓝功低的 red 样本填堆，旧高蓝功样本可在 `W_C` 里存活**远超 26,440 蓝分** ⇒ **`W_C ⊆ {bs ≥ bs(C)−26,440}` 对继承成员不成立**。⇒ **必须精确重建 `window(SP)`，不得用蓝分区间刻画。**

**v2 覆盖集**（`window(SP)` 精确 + 新进用原生阈值 + 计数上限）：
> `W_C = window(SP)【精确重建】 ∪ N_C`，`N_C ⊆ {SP}∪mergeset(C)`、每成员 `bs ≥ lowest_daa_blue_score(C) ≥ bs(SP)+1−26,440`（采样器**原生**蓝分阈值 `difficulty.rs:190-197`；`bs(C)≥bs(SP)+1`）、`|N_C| ≤ ⌊248/40⌋+1 = 7`（`window.rs:313-316` DAA-index 采样 + `mergeset_size_limit=248`）。
> **`T_lb(SP) = min target over ( window(SP)【精确重建】 ∪ Ncand(SP) )`**，`Ncand(SP) = {SP} ∪ {已收 b: bs(b) ≥ bs(SP)+1−26,440}`（N_C 候选超集：只用采样器自己的蓝分阈值，**不搬 DAA 数**）。
> `m_lb(SP) = max(1, 戳跨度( window(SP) 去蓝功最低 7 个 ))`（(i)(ii) 不变：进 ≤7 ⇒ 挤出 ≤7 蓝功最低）。
> **`w_child_ub(SP) = max( calc_work(compact_bits(T_lb·m_lb/2,640,000)), calc_work(bits(SP)) )`**（(iv)(v) 不变）。
> **`w_cap_window = max_{SP∈S} w_child_ub(SP)`**，`S = {已收 b: bs(b) ≥ bs_top(t1)−36,000}`（merge depth）。

**两域各司其职（NWT 核）**：准入阈值 = **蓝分域**（`lowest_daa_blue_score = bs−26,440`，`difficulty.rs:190-197`，代码自己用在蓝分上）；采样节拍 = **DAA 域**（`(selected_parent_daa_score+index)%40`，`window.rs:303/313-316`，只定采样密度）。覆盖集只吃"继承=精确集合 + 新进=原生蓝分阈值 + `|N_C|≤7`"，**无任何 DAA↔蓝分换算**。

## §3.5(b) 硬闸：`window(SP)` 结构性精确证书（撤 62,440 数字闸）

`w_cap_window` 要求 **每个 `SP∈S` 的 `window(SP)` 精确可重建**，否则 **`WINDOW_INEXACT` ⇒ 不出 cap ⇒ 回 (a-total)**（不静默取过大 `T_lb`）。精确证书二选一：
- **(甲) 真 genesis 全史**：重建链从真 genesis（无父 ∧ daa=0 ∧ bs=0，`genesis.rs:187`）起，沿途每链块 mergeset 成员全已收（`missing=0`）。
- **(乙) 截断根 R 后精确**：某块 B 的重建堆**满 661** ∧ **堆内最小蓝功 > blue_work(R)** ∧ R 之后所有 mergeset 成员已收 ⇒ `window(B)` 精确、后代继承精确（若 `missing` 仍 0）。
  🔴 **证明（NWT 核 @7b1e18cc）**：真 `window(B)` = 曾推入样本里蓝功最高 661 个。R 之前推入的样本 ∈ past(R)；**`blue_work` 沿祖先单调不减**——`blue_work(B)=blue_work(SP_B)+added_blue_work`（`ghostdag/protocol.rs:161`，added ≥0），`SP_B = argmax_{parents} blue_work`（`:99-104`）⇒ `blue_work(B) ≥ blue_work(任一父) ≥ blue_work(任一祖先)`（归纳）⇒ 每个 pre-R 样本蓝功 ≤ blue_work(R) < 重建堆内最小蓝功 ⇒ 在真堆里必已被 661 个更高蓝功样本淘汰 ⇒ 真堆 = 重建堆。∎
- **成员缺失**（mergeset 引用未收 hash）⇒ 永不精确 ⇒ fail-closed（不静默取过大 `T_lb`）。
- 生产取数：`getBlocks(includeBlocks=true, includeTransactions=false)` 249 块/页往回翻，直到证书 (乙) 对每个 `SP∈S` 成立；补不到 ⇒ fail-closed。（输入可行性见 `2026-08-27-nwt-wcap-reconstructor-input-feasibility.md`：verboseData 无条件填充。）

## §3.5(b) 实现验收（Codex：断言只核已实现子块不足以证反事实覆盖）
1. **候选窗验收**：`enumerateCandidates(SP)` = 已收 ∖ past(SP) ∖ genesis 且 `blue_work ≤ blue_work(SP)`（否则它才是 selected parent）里，枚举**全部子集** M（|M|≤247）× `bs(C)∈[bs(SP)+1, bs(SP)+1+|M|]` = **合法候选的超集**；对每个候选直接跑 `childWindow` + **镜像 `calculate_difficulty_bits`（`difficulty.rs:216-246`：<150 固定支 / 去 min_ts / `measured≥1` / compact 舍入）** 得 `bits(C)`，断言 `calc_work(bits(C)) ≤ w_child_ub(SP)`，**零 skip**；超集全过 ⇒ 合法全过。
2. **bits 自洽**：完整/精确窗上 `bitsCalc == 收块 bits`（重建器与共识同算法的直接证据）。
3. 🔴 **机械健全性断言（覆盖集剔除被核项）**：核已收块 B 时，`w_child_ub(SP_B)` 的**覆盖集 `Ncand(SP_B)` 必须剔除 B 自身**（`B∉window(B)`，剔后仍超集）——否则 B 自喂 `T_lb` ⇒ 断言恒真 = 空断言（同 selfCheck 缓存失败族）；**须有可失败性**：负向量（某收块难度×8）真触发 `ASSERTION_FAIL`（J2 V3 验）。

## §8 模型边界（Codex：score-domain 洞不归 B_adv）
🔴 **本 score-domain 覆盖缺口 = 公开 DAG 估计器正确性问题，【不归 B_adv】**（Codex 明令）：估计器准入须在**必需共识域历史不完整时 fail-closed**（结构性证书不成立 ⇒ `WINDOW_INEXACT`），不得静默当 `B_adv`。`B_adv` 只覆盖真正 withheld/私链 + 估计器声明的公开/可达模型之外者（§8-3 两模型边界：私链父块 / 深侧链 / 反事实链外推 ⇒ `B_adv`），**不得用来掩盖公开估计器的确定性覆盖洞**。

## 未变（逐字同 v0.13 = 9040b8ec）
`λ_ub` Garwood（D-STAT-1）+ 夹逼向量/上括号实现轨；`n≥N_min=4000@δ5%` ∧ `W≥W_min=3600s`（D-STAT-2）；`H_vis_ub=λ_ub·w_cap_window/W`；接收计不看块戳（MUST-B）；分解式 `s_adv_cap=1−H_self_lb/(H_vis_ub+B_adv)`；(a-total) `min(1,H_adv_cap/H_total_lb)`；两式取 max；`B_adv` 单一预算 + 守卫 + 窗均值可见估计语义 + 单位=算力；`H_self_lb`；`H_total_lb`；戳操纵不需假设；观测 w_max/层3 降诊断；TN12 关；§4 k_max / §5 / §6 / §7 及 §1–§3.5 前段同 v0.13。

## 给 J2 的改点清单（对 v0.13，逐核）
1. **(iii)** `A_SP` 刻画 → **`window(SP) 精确重建 ∪ N_C`**；加"继承样本不重过阈值（`window.rs:265-282`）+ 堆按蓝功淘汰（`:458-468`）⇒ 蓝分区间不成立"持久证明。术语"A_SP 覆盖集"→"`window(SP) ∪ Ncand(SP)`"。
2. **硬闸** 删"历史蓝分深度<62,440"，改**结构性精确证书 (甲/乙)**（blue_work 单调证 `protocol.rs:99-104/:161`）；成员缺失 ⇒ 不精确 ⇒ fail-closed。
3. **实现验收**：候选窗超集穷举/生成 × `calculate_difficulty_bits` 镜像零 skip + bits 自洽 + 断言剔除被核项 + 负向量真失败。
4. **坐标补**：`difficulty.rs:185-197`、`window.rs:303-316/265-282/458-468`、`ghostdag/protocol.rs:99-104/155-163`、`genesis.rs:187`。
5. **§8** score-domain 洞不归 B_adv（估计器 fail-closed）。
6. J2 逐核 → (d) v0.15 镜像 → 批推（v0.14 + 待推 764df1b5 / 593ddf93 / e99e27a8）→ MSG-282。数值待同步后重建器实测。
