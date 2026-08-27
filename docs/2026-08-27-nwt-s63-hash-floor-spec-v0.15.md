# Tier-2 算力地板量法规格 v0.15（D-STAT-3 闭合：支配定理 L1–L5 替代穷举验收 · SUPERSEDES 27401ba3）

> **Status**: DESIGN v0.15 · NWT 2026-08-27 · SUPERSEDES v0.14（`27401ba3`）· Codex `713232be`（MSG-282）**MATERIAL PROGRESS**：机制更正 ACCEPTED（Codex 自认前"DAA 域"措辞 imprecise）、`window(SP)∪N_C` PASS 方向、结构性证书三条件"logically sufficient" PASS 设计层、洞归估计器 PASS。**唯一 MUST-FIX**：v0.14 :32 "全部子集 M(|M|≤247) 穷举零 skip" **组合不可执行**（`ΣC(N,k)` 天文数）⇒ 不能作 D-STAT-3 的机械桥。
> **本版闭合（Codex 路线 2）**：把 (i)-(v) 升为**正式引理链 L1–L5 ⇒ 支配定理**"∀ 合法公开子块 C，`work(bits(C)) ≤ w_child_ub(SP)`，**无需枚举**"；生产验收降为可执行 (A)–(E)。J2 推导（`scratch/_j2_wcap_lemma_chain.md`），**NWT 逐核 @7b1e18cc（F3/F4/F8 + L1 前缀/top-K + L4 两保守向）全成立**。（v0.14 的 (i)-(v) 代数本就证了支配；穷举是冗余且不可执行的验收 over-spec，本版删之、把定理写成承重。）
> **Codex 明写：本轮不授权任何 build / 落码 / 部署 / 签名广播 / DB 变更 / 结算退款 / key movement / 生产钱路。** gate (d) 仍 OPEN。
> **FIX-UP（2026-08-27 · J2 COORD-FIX · 同文件不 amend 2f632c91）**：F4 坐标 `ghostdag/ordering.rs:46-48` → **`:38-42`**（我原指到了排序辅助 `sort_blocks`；`impl Ord for SortableBlock` 实在 :38-42，:40 = `blue_work.cmp().then_with(hash.cmp())`，NWT 复核）。语义不变。
> **FIX-UP 2（2026-08-27 · Codex 主动审逮 · 同文件不 amend）**：F2 原只写"节拍按 DAA-index"、**未钉遍历序** —— 补"mergeset 按降序 `SortableBlock`（blue_work then hash）遍历（`descending_mergeset_without_selected_parent` `ghostdag.rs:139-163`）"。**这是我 (c) 审 (21) v0.9 时漏的同族洞的 spec 面**：Codex 逮出 `wcap-window.mjs childWindow()` 预采样 `sort` 只比 blue_work（等值保留输入序）≠ 共识 SortableBlock ⇒ 等 work 兄弟块采样归属可变 ⇒ 非精确。**预采样层与堆层须各自对齐**（堆 `cmpSortable` 已对齐、预采样未）。落码 fix 在 (21) v0.9.1（J2）。

## §3.5(b) 新增「支配定理」小节（替代穷举，承重）

`H_vis_ub = λ_ub(n)·w_cap_window/(t1−t0)`，`w_cap_window = max_{SP∈S} w_child_ub(SP)`。承重 = **∀ 合法公开子块 C（selected parent = SP，`window(SP)` 精确）：`work(bits(C)) ≤ w_child_ub(SP)`**。

**协议事实（F，@7b1e18cc）**：F1 `window(C)=window(SP)⊕push_mergeset(C)`、**继承样本不重过阈值**（`window.rs:138-235/265-282`）；F2 准入按蓝分阈值、节拍按 DAA-index，🔴 **遍历序 = `once(SP)` + mergeset 按【降序 `SortableBlock`（blue_work then hash）】**（`descending_mergeset_without_selected_parent` `ghostdag.rs:139-163`：逆存储序 + `merge_join_by |a,b| b.cmp(a)` = 逆 `SortableBlock`；`Hash: Ord` = `[u8;32]` 字节字典序 `crypto/hashes/src/lib.rs:38-46`）——**等 blue_work 兄弟块跨采样 index 边界时，谁被采由 hash tie-break 决定**，故**预采样遍历层与堆淘汰层须【各自独立】对齐此序**（Codex 主动审 fix-up：只比 blue_work、等值保留输入序 = 非精确）（`window.rs:299-322`）；**F3 `bs(C)=bs(SP)+|mergeset_blues|`，`mergeset_blues` 以 SP 开头（`model/stores/ghostdag.rs:97` push(SP)；`ghostdag/protocol.rs:153`）⇒ `bs(C)≥bs(SP)+1`**；**F4 堆序 = `SortableBlock:Ord = blue_work then hash`（`ghostdag/ordering.rs:38-42`），满时新>最小才 pop 最小（`window.rs:458-468`，`Reverse`）**；F5 `mergeset_size_limit=248`（`bps.rs:75-85`）⇒ 计 index 块≤248 ⇒ 命中 40 倍数 `≤⌊248/40⌋+1=7`；F6 `calculate_difficulty_bits`（`difficulty.rs:216-246`）<150 固定支/去 min_ts/整除向下/`expected=100×40×len`(len≤660)/`min(max_target)`/`compact`；F7 `calc_work` 对 target 非增（`:261-267`）；**F8 `compact_target_bits`（`math/src/lib.rs:83-97`）取高 3 字节 ⇒ `decode(compact(t))≤t` 且对 t 单调不减**；F9 `blue_work` 沿祖先单调不减（`protocol.rs:99-102/:155-161`）。

**定义**：`K_SP := window(SP)` 去掉**按 `SortableBlock` 序（blue_work, hash）最小的 7 个**（**边界蓝功并列者全去** = 更保守）；`m_lb(SP):=max(1, max_ts(K_SP)−min_ts(K_SP))`；`Ncand(SP):={SP}∪{已收 b: bs(b)≥bs(SP)+1−26,440}`；`T_lb(SP):=min target over window(SP)∪Ncand(SP)`；`expected_full:=100×40×660=2,640,000`；`t_lb:=min(⌊T_lb·m_lb/expected_full⌋, max_target)`；`w_child_ub(SP):=max(calc_work(compact(t_lb)), calc_work(bits(SP)))`。

- **L1（`W_C ⊇ K_SP`）**：`push_mergeset(C)` 至多 7 次 `try_push`（F2/F5）；每次至多淘汰 1 个且是当时**最小**（F4）⇒ 被淘汰的原成员按 F4 序是**前缀**（等价：`window(C)` = `window(SP)∪N_C` 的 top-661，掉的是最小 ≤7）⇒ ⊆ 最小 7 个 ⇒ 其余原成员留在 `W_C`；并列边界全去仍是超集子集。∎（F2,F4,F5）
- **L2（`measured(W_C)≥m_lb`）**：`W_C⊇K_SP` ⇒ `max_ts(W_C)≥max_ts(K_SP)`、`min_ts(W_C)≤min_ts(K_SP)` ⇒ 跨度 ≥ 跨度(K_SP)；`max(·,1)` 单调。戳非单调无妨（集合极值）。∎（L1,F6）
- **L3（`average_target(W_C)≥T_lb`）**：F1 `W_C⊆window(SP)∪N_C`；F2 每推入者 `bs≥lowest_daa_blue_score(C)`，F3 `≥bs(SP)+1−26,440` ⇒ `N_C⊆Ncand(SP)`（mergeset 成员已收=模型边界）⇒ `W_C⊆window(SP)∪Ncand(SP)`；F6 均值在 `W_C∖{min_ts 样本}` 上（整除向下 `⌊Σ/len⌋≥min`）≥ 覆盖集最小 target = `T_lb`。∎（F1,F2,F3,F6；**零域换算**——阈值本身蓝分域）
- **L4（单调+舍入方向）**：`new_target=⌊avg·measured/expected⌋` 对 avg、measured 单调不减、对 expected 单调不增；**`expected=100×40×len≤expected_full`（len≤660）** ⇒ `target(C)≥⌊T_lb·m_lb/expected_full⌋`（L2,L3）；`min(·,max_target)` 单调 ⇒ `target(C)≥t_lb`；**F8 `compact` 单调不减 + `decode(compact(t))≤t`** ⇒ F7 `work(bits(C))=calc_work(compact(target(C)))≤calc_work(compact(t_lb))`（且 `calc_work(compact(t_lb))≥2^256/(t_lb+1)` = 再保守一层）。∎（L2,L3,F6,F7,F8）
- **L5（固定支）**：`|window(C)|<150 ⇒ bits(C)=bits(SP)`（F6，SP=genesis⇒genesis bits）；可达性 `|window(C)|≤|window(SP)|+7`；并入 max。∎（F1,F5,F6）
- 🔴 **定理**：C 走 F6 两支之一——固定支 L5、目标支 L4（前提 L2/L3 由 L1/F1–F3 给）——皆 `≤ max(目标支界, 固定支界) = w_child_ub(SP)`。∎ **推论**：`w_cap_window` 支配 `[t0,t1]` 内每个以 `S={已收 b: bs(b)≥bs_top−36,000}` 中块为 SP 的合法公开子块；`S` 外（深 merge depth）/私链/反事实链 = 模型边界 ⇒ B_adv，score-domain 洞不在其列。

## §3.5(b) 实现验收（可执行，替代穷举——Codex MUST-FIX 闭合）
- **(A)** 确定性重建 + 精确证书（甲真 genesis 全史零缺失 / 乙截断根 R：堆满 661 ∧ 堆内最小蓝功 > blue_work(R) ∧ R 后零缺失，证靠 F9）；任一 `SP∈S` 无证书 ⇒ `WINDOW_INEXACT` ⇒ 不出 cap（不静默取过大 `T_lb`、不归 B_adv）。O(N)。
- **(B)** `bitsCalc == 收块 bits` 对**全部**精确窗（镜像 `calculate_difficulty_bits` 与共识同算法的直接验证）。任一不等 ⇒ 实现错 ⇒ fail-closed。O(N)。
- **(C)** 已实现子块断言 `work(bits_B)≤w_child_ub(SP_B)`，**核 B 时 `Ncand(SP_B)` 剔除 B 自身**（`B∉window(B)`，剔后仍超集；否则 B 自喂 `T_lb` ⇒ 空断言）；**负向量**（某收块难度×8）必须真触发 `ASSERTION_FAIL`（否则断言无效 ⇒ fail-closed）。O(N·661)。
- **(D)** **有界穷举对抗模型 = 引理链的机器检验（非生产验收）**：合成小 DAG，池 **`N_small=12` 写死**（⇒ ≤4096 子集 × bs 范围，可执行），覆盖 **red 密（daa/bs 分离）/ non-DAA 排除 / 挤戳 / 固定支 / compact 舍入 / 最大进样 7**；每候选跑镜像 `calculate_difficulty_bits` 断言 `≤w_child_ub`。（J2 重建器 `_j2_wcap_rebuilder.test.mjs` 9 向量全过。）
- **(E)（可选）启发式 smoke，标"非验收·证不了极值"**：对每 `SP∈S` 构贪心极端候选跑镜像断言；**为何证不了极值**：`measured(W_C)`（淘汰哪 7 个 + 新戳落点）与 `average_target`（淘汰/新进组合）**不独立可分**，贪心不保证同时极小 ⇒ 仅 smoke，不作覆盖证明（覆盖由**定理**给，非 (E)）。
- 复杂度：(A)(B)(C) 线性于已收块数（每块建窗增量 ≤7 堆操作），生产规模（≈62,440+ 块）秒级。**穷举 (v0.14 :32) 删**。

## 未变（逐字同 v0.14 = 27401ba3）
结构性精确证书（甲/乙 + F9 证 + 成员缺失 fail-closed 不归 B_adv）；覆盖集 `window(SP)【精确重建】∪N_C`（继承不重过滤 `window.rs:265-282` + 堆按蓝功淘汰 `:458-468` ⇒ 蓝分区间不成立，持久证明）；`λ_ub` Garwood + 夹逼/上括号（D-STAT-1）；`n≥N_min=4000@δ5% ∧ W≥3600s`（D-STAT-2）；接收计不看块戳（MUST-B）；分解式/(a-total)/两式取 max/`B_adv` 单一预算+守卫+窗均值语义+单位=算力；`H_self_lb`/`H_total_lb`；戳操纵不需假设；观测 w_max/层3 降诊断；§8 score-domain 洞不归 B_adv + 三模型边界；TN12 关；§4 k_max/§5/§6/§7 及 §1–§3.5 前段同 v0.14。硬闸同 v0.14（`W<W_min ∨ n<N_min ∨ 未用精确 λ_ub ∨ ∃SP∈S 无证书(WINDOW_INEXACT) ∨ 断言/候选(D)不过 ∨ H_self_lb>H_vis_ub ∨ 无 B_adv ⇒ 回 (a)`；"候选(D)不过"= 引理机器检验失败）。

## 给 J2 的改点清单（对 v0.14，逐核）
1. §3.5(b) 实现验收：**删"全部子集穷举、零 skip"**（Codex：组合不可执行）；改 (A)(B)(C) 生产 + (D) `N_small=12` 有界对抗模型 + (E) 可选 smoke（标非验收）。
2. **新增「支配定理」小节**：F1–F9 + L1–L5 + 定理，每条带坐标（F3 `ghostdag.rs:97`/`protocol.rs:153`；F4 `ordering.rs:38-42`；F8 `math/src/lib.rs:83-97`；余同前）。
3. `K_SP` 定义补"按 `SortableBlock` 序（blue_work, hash）取最小 7；边界并列全去"。
4. L4 补两保守向：`expected≤expected_full`（len≤660）+ `decode(compact(t))≤t`。
5. 其余（证书/INEXACT/自喂剔除/负向量/五类向量/洞不归 B_adv）逐字保留。
6. J2 逐核 L1–L5 坐标 → (d) v0.16 镜像 → 推 → MSG-283。数值待同步后重建器实测。
