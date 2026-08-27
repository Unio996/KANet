# Tier-2 算力地板量法规格 v0.13（D-STAT-3 闭合：`w_cap_window` = 层1 最紧合法窗不等式形 μ=0 · SUPERSEDES 0e123323+07fd6306）

> **Status**: DESIGN v0.13 · NWT 2026-08-27 · SUPERSEDES v0.12（`0e123323` + fix-up `07fd6306`）· Codex `d7fefb58`（MSG-280）：D-STAT-1/2 CLOSED、B_adv 窗均值 PASS-dir、**D-STAT-3 OPEN**。**本版闭合 D-STAT-3**：承重量 `w_cap_window` = **层 1「对手在已收块上可造的任一合法窗」的最紧不等式形（μ=0、无裕度假设、Codex form-1 精确）**（J2 推导 `scratch/_j2_wcap_window_inequality_form.md`，**NWT 逐核 @7b1e18cc 全成立**）。
> **NWT 红队闭环**：我 v0.12 的 `n_ub×观测w_max` 被 Codex 拒（观测 max 是随机量）；我进而逮出 J2 首版层 3 `μ=1%` **欠界**（`mergeset_size_limit=248 / sample_rate=40 ⇒ 单块最多滚 7 采样，非 1`）；⇒ 弃 μ，改层 1 精确不等式。**μ=0**。
> **Codex 明写：本轮不授权任何 build / 落码 / 部署 / 签名广播 / DB 变更 / 结算退款 / key movement / 生产钱路。** gate (d) 仍 OPEN（数值待同步后实测；本版闭的是设计层构造）。

## §3.5(b) 改点1（D-STAT-3 闭合）——`H_vis_ub = λ_ub(n) · w_cap_window / (t1−t0)`

法3′ 本机时钟接收计数**方向不变**（不看块戳，MUST-B）：两次 own-clock 轮询 `t0<t1`，取 `[t0,t1]` 间新可达块，记块数 `n`。
- **`λ_ub(n)` = Garwood 精确泊松单侧 99.9% 上限**（D-STAT-1 CLOSED，不动）；实现轨（上括号/Chernoff、零静默欠射）= 实现验收项。
- 🔴 **`w_cap_window` = 承重（层 1 不等式形，μ=0）**：对手在已收块上可造的**任一合法子块 C** 的 work 上界。**关键洞见（NWT 核 @7b1e18cc 成立）**：C 的难度 `bits(C)` 由 `calculate_difficulty_bits(window(C), ghostdag)`（`difficulty.rs:216`）**只吃 C 的窗、不吃 C 自身戳**决定，而 `window(C) = window(SP) ∪ sampled({SP}∪mergeset(C))`（`window.rs:138-235/265-282`）按**蓝功**保留最高 661（`BoundedSizeBlockHeap.try_push` :458-468 淘汰蓝功最低）⇒ **窗由已收块确定性重建**。

  **对固定 selected parent `SP`**（`C` = 以 SP 为父的任一合法子块，`mergeset(C) ≤ mergeset_size_limit=248` ⇒ 采样 `once(SP)+按蓝功降序`，`(daa(SP)+index)%40==0` 计样 ⇒ **一块最多进 `⌊248/40⌋+1=7` 采样**，`bps.rs:40 k=124`/`:75-85 limit=248`/`window.rs:299-322`）：
  | 步 | 不等式 | 性质（NWT 核）|
  |---|---|---|
  | (i) | `W_C ⊇ K_SP`，`K_SP := window(SP)` 去蓝功最低 7 个（进 ≤7 ⇒ 挤出 ≤7 蓝功最低）| **协议**（堆按蓝功淘汰 ✓ + once(SP) 计入 ✓）|
  | (ii) | `measured(W_C) ≥ m_lb(SP) := max(1, max_ts(K_SP)−min_ts(K_SP))`（超集 max≥/min≤；**戳非单调无妨，用集合真 min/max**）| 代数 + 可算 |
  | (iii) | `avg_target(W_C) ≥ T_lb(SP) := min_{b∈A_SP} target(b)`，`A_SP := {已收 b: bs(b) ≥ bs(SP)+1−26,440}`（`lowest_daa_blue_score(C)=bs(C)−661×40 ≥ bs(SP)+1−26,440` ⇒ `W_C⊆A_SP`）| 代数 + 可算 |
  | (iv) | `target(C) = avg_target·measured/expected ≥ T_lb·m_lb/2,640,000`（`difficulty.rs:243-245`，`expected=100ms×40×660`；`.min(max_target)` 只往上封不影响下界）| 协议 |
  | (v) | 固定难度支（窗样本<150，`:220-227`）`bits(C)=bits(SP)` 并入 max | 协议 |
  | ⇒ | **`w_child_ub(SP) = max( calc_work(compact_bits(T_lb·m_lb/2,640,000)), calc_work(bits(SP)) )`** | — |

  （`calc_work=2^256/(target+1)` `difficulty.rs:261-267`；`compact_bits` 向下截 target ⇒ work 略偏大 = **保守向**。方向：最小 measured × 最小 avg_target ⇒ 最小 target ⇒ **最大 work = 上界** ✓。）

  > **`w_cap_window = max_{SP ∈ S} w_child_ub(SP)`** ，`S := {已收 b: bs(b) ≥ bs_top(t1)−36,000}`（`36,000 = merge_depth = BPS×3600`，`bps.rs:88-90`）
  > **`H_vis_ub = λ_ub(n) · w_cap_window / (t1−t0)`，μ = 0。**

- **戳操纵不需假设**：`measured` 从已收戳算出，对手挤紧戳 ⇒ `m_lb` 自动变小 ⇒ cap 自动升（**读出来的，非假设**）。
- **观测 `w_max` / 层 3 `(1+μ)·max(收块,virtual@t0/t1)` 降为诊断/快速候选**，**不承重**（层 3 μ 系统性欠界，见头注）。

### 输入清单（全部链上可读，`getBlock(includeTransactions=false)`）
`header.{daaScore, blueWork, timestamp, bits, parents}` + `verboseData.{blueScore, mergeSetBluesHashes, mergeSetRedsHashes, selectedParentHash}`。每块建窗增量 O(1)（父窗 + 采样 ≤7 + 淘汰），全网 O(N)；**不需 mergeset 搜索**。

### 🔴 机械健全性断言（规格要求 ⑤）
每个**已收**块 B 必满足 `calc_work(bits_B) ≤ w_child_ub(SP_B)`（B 就是 SP_B 的一个合法子块）——**实现必跑此断言**，任一不过 ⇒ 实现错 ⇒ **fail-closed**。

## §3.5(b) 改点3（硬闸）
自持路 (b) 出 cap 全部硬前置（任一不满足 ⇒ 回 (a-total) / fail-closed）：
> `W < W_min(=3600s)` **∨** `n < N_min(=4000@δ5%)` **∨** 未用可证 `λ_ub`（Garwood 过夹逼向量 / Chernoff；高斯作硬界即失格）**∨** **已收历史蓝分深度 < 62,440**（`= 36,000 + 26,440`，`A_SP` 最深所需；不足 ⇒ 算不出 `T_lb` ⇒ 回 (a-total)）**∨** **健全性断言 ⑤ 有块不过** **∨** `H_self_lb > H_vis_ub` **∨** 无具名 `B_adv`

## §8 Owner 冻结项 / 模型边界
1. 🔴 **② 泊松到达 = 显式具名假设**（Codex D-STAT-1 CLOSED 条件）：`λ_ub(n)` 建在"`[t0,t1]` 新可达块到达 ~ 泊松过程"上；偏离（强突发/相关到达）⇒ 该路 fail-closed；落 §5 同步后验（到达间隔抽核）。
2. 🔴 **③ `B_adv` 单位 = 算力/容量（与 `H_vis_ub` 同单位）**（Codex 条件）：非 raw work；对部分呈现的迟上线矿工用全容量上界 = 可能双计但**保守向**。语义"缺席于**窗均值可见估计**"（v0.12 fix-up ②）。
3. 🔴 **两条模型边界（`w_cap_window` 只覆盖单块公开 DAG 子块）⇒ 归 `B_adv`**：
   - **(甲) 私链**：C 的窗含未发布祖先 ⇒ withheld ⇒ `B_adv`（缺席于可见集）；
   - **(乙) 深侧链 / 反事实链外推**：`SP` 深于 virtual 的 merge-depth root（`check_bounded_merge_depth` `post_pow_validation.rs:79`）⇒ honest virtual 永不并入 = 死侧链，out-of-model；多块连续外推（反事实块再当父压戳推窗）同样 out-of-model ⇒ 皆 `B_adv`。**规格须显写，否则 `max_{SP∈S}` 被误读成对反事实链也成立。**
4. **`w_cap_window`**（D-STAT-3 承重）= 上式；观测 w_max 仅诊断。**`δ_max`=5%⇒N_min=4000** / **`B_adv` 单一预算+守卫** / **`H_adv_cap`** / **`H_self_lb`**（自家已发布块工作和）/ **`H_total_lb`**（(21) v0.5 min,gate_input=OK）——同 v0.12。

## 未变（逐字同 v0.12 = 0e123323+07fd6306）
分解式 `s_adv_cap=1−H_self_lb/(H_vis_ub+B_adv)`（Codex 认单调）；(a-total) `min(1,H_adv_cap/H_total_lb)`（PASS）；两式取 max；`s_adv_cap≥s_visible_max`（告警）；TN12 关；法3 按戳 `÷(1+口径/W)` 只作下界；§4 k_max / §5 / §6 / §7 及 §1–§3.5 前段、法3 三段同 v0.12。**§0 复合式"同证"句已删**（Codex 拒 `n_eff`，v0.12 fix-up 起）。

## 给 J2 的改点清单（行号锚，逐核）
1. **§3.5(b) 改点1**：`[骨架 J2 填]` → **层 1 不等式形（i)-(v) + `w_cap_window=max_{SP∈S}w_child_ub`**（μ=0）；坐标 `difficulty.rs:216/220-227/243-245/261-267`、`window.rs:138-235/265-282/299-322/458-468`、`bps.rs:40/75-85/88-90`。
2. **输入清单 + 健全性断言 ⑤** 新增。
3. **改点3 硬闸**：加"历史蓝分深度 <62,440 ⇒ (a-total)" + "断言 ⑤ 不过 ⇒ fail-closed"。
4. **§8-3 两模型边界（私链/深侧链→B_adv）** 新增；§8-1 泊松显式、§8-2 B_adv 单位（骨架已有）。
5. **层 3 / 观测 w_max 降诊断**（不承重）。
6. J2 逐核 → 推（含骨架 5f9beecb + (667) 07bc2fa0）→ (d) v0.14 镜像 → MSG-281。**数值待同步后 (21)/(24) `getBlock` 实测；本版闭设计层构造。**
