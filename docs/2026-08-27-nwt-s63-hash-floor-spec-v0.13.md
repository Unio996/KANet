# Tier-2 算力地板量法规格 v0.13 骨架（认 Codex MSG-280：D-STAT-3 改协议推导 `w_cap_window` · SUPERSEDES 0e123323+07fd6306）

> **Status**: DESIGN v0.13 **骨架（未闭合）** · NWT 2026-08-27 · SUPERSEDES v0.12（`0e123323` + fix-up `07fd6306`）· Codex `d7fefb58`（MSG-280）：**D-STAT-1 CLOSED**（Garwood 6 向量 + N_min 3974/10867/24259 Codex 独立复算全对；**条件：泊松到达模型须写成显式假设**）、**D-STAT-2 CLOSED**（`W≥3600s ∧ n≥4000@δ5%`）、**B_adv 窗均值措辞 PASS-dir**（**条件：单位须是算力/容量、与 `H_vis_ub` 同单位**）；🔴 **D-STAT-3 OPEN / MUST-FIX**。
> 🔴 **本版是骨架**：D-STAT-3 的承重量 **`w_cap_window`（协议推导）由 J2 从 `difficulty.rs` @7b1e18cc 推导填**（W 内可达最大难度 + 哪些输入链上可读）。**J2 cap 到手合稿 → J2 逐核 → 推 → (d) v0.14 镜像 → MSG-281**。骨架不足以升级 (d)。
> **Codex 明写：本轮不授权任何 build / 落码 / 部署 / 签名广播 / DB 变更 / 结算退款 / key movement / 生产钱路。**

## 认 Codex D-STAT-3（我 v0.12 `n_ub × 观测 w_max` 不闭，危险向）
- **失效证明（Codex）**：`Σ观测 w_i ≤ n·观测w_max ≤ n_ub·观测w_max` 只对**已观测已实现工作**成立，**不是**对底层可见工作率的 99.9% 上界。`n_ub` 是**潜在均值计数**上限（把计数从实测 `n` 抬到潜在均值上限），多补的**反事实/潜在到达**也需要**确定性/独立有界**的每到达 work 支撑——**样本最大值是随机量，给不了这支撑**。
- **具体失效形**：窗内某段难度/work 升，而**恰无该段块被观测** ⇒ 样本 `w_max` 停在较早的低 work，而该段的计数→算力换算需要更高 work 值。**泊松计数上限管计数不确定性，不魔法封住未观测的 mark/work 分布。**
- ⇒ fix-up 那句"窗内每块 work ≤ 观测 w_max（观测即得）"被 Codex 判**同义反复**（只对真到达的块成立）。**J2 的复合式 `n_eff=Σwork/w_max` 亦被拒**（`n_eff` 一般是分数、非观测泊松计数，喂 Garwood 计数上限**非同证**）。

## §3.5(b) 改点1 重写（D-STAT-3 → 协议推导 `w_cap_window`）

法3′ 本机时钟接收计数**方向不变**（不看块戳，MUST-B）：两次 own-clock 轮询 `t0<t1`，取 `[t0,t1]` 间新可达块，记块数 `n`。**上界式改为**：

> **`H_vis_ub = λ_ub(n) · w_cap_window / W`** ，`W = t1 − t0`

- **`λ_ub(n)` = Garwood 精确泊松单侧 99.9% 上限**（D-STAT-1 CLOSED，不动）：`½·χ²_{0.999}(2n+2)`；实现轨（上括号 / Chernoff 上轨、零静默欠射）= 实现验收项（Codex，非设计-open）。
- 🔴 **`w_cap_window` = 协议推导的确定性每块 work 上界（D-STAT-3 承重·待 J2 填）**：
  - **要求（契约）**：对 `[t0,t1]` 内**任一时刻 / 任一合法块态**（含反事实/未观测到达），`work_per_valid_block ≤ w_cap_window`。**必须覆盖整个暴露过程**（含"没发生的那个到达"的 work 水平），不是只覆盖已观测块。
  - **推导源**：共识难度/DAA 规则——`consensus/src/processes/difficulty.rs:243-245` @7b1e18cc（`new_target = average_target × measured/expected`，且 `.min(max_difficulty_target)` 封顶）作用于**窗起难度**，界定 W 内难度（⇒ 每块 work = 2²⁵⁶/(target+1)）可**合法升到多高**。
  - **输入须链上可读**：窗起 bits + DAA 参数（sample_rate / window_duration / max_difficulty_target）。
  - **`[J2 推导填 · 待 difficulty.rs 推导]`**：W 内可达最大难度的闭式/算法 + 具体读哪些链上量 + `w_cap_window` 表达式。**填入前本版不闭合。**
  - **观测 `w_max` 降为诊断/更紧候选**：仅当**机械证明**其对全区间 ≥ 协议 cap（即等于 cap）时才可作安全因子；否则**不得**作安全因子（默认用 `w_cap_window`）。
  - **`w_cap_window` 从"可选 DAA 幅度上界"升为承重安全界**（Codex：promote from optional fallback to load-bearing）。
- **接收计边界（不变）**：窗内才变可达的旧 work 多计 ⇒ 对上界保守（OK）；`t1` 前本机不可见 work 归 `B_adv`（非字面零）。

### 🔵 ④ 复合式处置（Codex 拒）
v0.12 fix-up 的"复合泊松 `w_max·λ_ub(n_eff)` 可选更紧同证"——**Codex 判非同证**（`n_eff` 非观测泊松计数）。**删该句**；若团队仍要此形，**须一个匹配实现统计量与假设的独立定理/推导**（martingale / bounded-mark 构造），非"exact same-proof"，另立不进本骨架。

## §3.5(b) 改点3（硬闸，`w_max`→`w_cap_window`）
自持路 (b) 出 cap 全部硬前置（任一不满足 ⇒ 回 (a-total) / fail-closed）：
> `W < W_min(=3600s)` **∨** `n < N_min(=4000@δ5%)` **∨** 未用可证上限（Garwood 过夹逼向量 / Chernoff；高斯作硬界即失格）**∨** `w_cap_window` 未协议推导（用观测 w_max 未证 ≥ cap）**∨** `H_self_lb > H_vis_ub` **∨** 无具名 `B_adv`

## §8 Owner 冻结项（更新）
1. 🔴 **② 泊松到达模型 = 显式具名假设（Codex D-STAT-1 CLOSED 的条件）**：`H_vis_ub` 的 `λ_ub(n)` 建在"`[t0,t1]` 内新可达块到达 ~ 泊松过程（速率 = 可见算力/难度）"上；此模型是**具名假设**（非机械保证），偏离（强突发/相关到达）⇒ 界失效 ⇒ 该路 fail-closed。落 §5 同步后验（到达间隔分布抽核）。
2. 🔴 **③ `B_adv` 单位 = 算力/容量（与 `H_vis_ub` 同单位）**（Codex 条件）：非模糊 raw work；对部分呈现的迟上线矿工用**全容量上界** = 可能双计但**保守向**（漏掉窗均值缺失贡献才是危险向）。语义仍"缺席于**窗均值可见估计**"（v0.12 fix-up ②）。
3. **`w_cap_window`**（D-STAT-3 承重）：协议推导（difficulty.rs @7b1e18cc），J2 填；观测 w_max 仅诊断。
4. **`δ_max`=5%⇒N_min=4000** / **`B_adv` 单一预算 + 守卫** / **`H_adv_cap`** / **`H_self_lb`**（自家已发布块工作和）/ **`H_total_lb`**（(21) v0.5 min,gate_input=OK）——同 v0.12。

## 未变（逐字同 v0.12 = 0e123323+07fd6306）
分解式 `s_adv_cap=1−H_self_lb/(H_vis_ub+B_adv)`（Codex 认单调）；(a-total) `min(1,H_adv_cap/H_total_lb)`（PASS）；两式取 max；`s_adv_cap≥s_visible_max`（告警）；TN12 关；法3 按戳 `÷(1+口径/W)` 只作下界；§4 k_max / §5 / §6 / §7 及 §1–§3.5 前段、法3 三段同 v0.12。

## 给 J2 的改点清单（行号锚 + 待填）
1. **§3.5(b) 改点1 主式**：`n_ub×w_max/(t1−t0)` → **`λ_ub(n)·w_cap_window/W`**；`w_cap_window` = **[J2 从 difficulty.rs 推导填]**；观测 w_max 降诊断。
2. **改点3 硬闸**：加"`w_cap_window` 未协议推导 ⇒ 回 (a-total)"；`n<N_min` 位置不变。
3. **§8-1**：② 泊松到达显式假设（新增）。
4. **§8-2**：③ B_adv 单位=算力一句（新增）。
5. **④ 删复合式"同证"句**（Codex 拒）；如留须独立定理另立。
6. **待 J2 填 `w_cap_window`** 后：D-STAT-3 才设计-闭合，合稿升 v0.13 正式版（去"骨架"），J2 逐核 → 推 → (d) v0.14 镜像 → MSG-281。
