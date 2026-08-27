# Tier-2 算力地板量法规格 v0.9（认 Codex MSG-278 b-self REJECT + J2 分解构造 · SUPERSEDES v0.8）

> **Status**: DESIGN v0.9 · NWT 2026-08-27 · SUPERSEDES v0.8（f9467264）· Codex `c6154e89` 裁 278：**b-self REJECTED/MUST-FIX**（J2 提、NWT 认）。**改 §3.5(b)（删 b-self；自持路改 `H_vis`/`H_hidden` 分解构造 + fail-closed 默认）+ §8（Owner 冻结项）+ §7。其余同 v0.8/v0.7/v0.6。**
> 核心构造采 J2 红队预置（`scratch/_j2_redteam_prep_23v09_Htotal_ub.md`，推导不拍）——我逐步核过三点（偏导、法3 修正、H_self 口径），全成立，采纳并署 J2。
> Codex 同批 PASS 不动：时间戳解析器实质修复（**最终证据仍待 harness 真 `submit_ts` + ≥30 同步后样本**）；132 s 三段；份额 cap 与注入增量分开；`k_max ≤ 1 + H_adv_add/H_total_lb`；**(a-total) `min(1, H_adv_cap/H_total_lb)` PASS**。

## 认错（v0.8 的 b-self 公式错，Codex/J2 对）
- **b-self** `(max(0, H_total_lb − H_self) + H_adv_add)/(H_total_lb + H_adv_add)` 里 `max(0, H_total_lb − H_self)` 我标"非我方算力**上界**"——**错，是下界**（下界 `H_total_lb` 减 `H_self` = 非我方量的下界；真总量 > `H_total_lb` 时真非我方量更大）。
- **反例（Codex）**：`lb=100/true=200/self=20/add=0` ⇒ b-self 算 `80/100=0.80`；真在场对手份额可达 `180/200=0.90` ⇒ cap 偏小 ⇒ 诚实地板偏大 ⇒ **非 fail-closed**。
- **根因**：份额上界须 `1 − H_self_lb/H_total_ub`（分母是总算力**上界**）；b-self 用了 `H_total_lb`（下界）作分母，方向反。"下界减精确值仍是下界"——三人初始都没走对，记教训。

## §3.5(b) 重写：分解 `H_total = H_vis + H_hidden`，各取一头

估计器（法1/2/3）只看得见**已发布块** ⇒ 对 withheld（私挖/扣块）算力**全盲** ⇒ 至多给 `H_vis_ub`（可见算力上界）。拆总算力 `H_total = H_vis + H_hidden`：`H_vis` 可从链上给**上界**（下详），`H_hidden` 不可测、只能**具名**上界 `H_hidden_ub`。则

`s_adv ≤ (H_vis − H_self + H_hidden)/(H_vis + H_hidden)`

对 `H_vis`、`H_hidden` 偏导均 `= H_self/D² > 0`（`D=H_vis+H_hidden`）⇒ 两者各取**上界**、`H_self` 取**下界**才保守：

> **`s_adv_cap = (H_vis_ub − H_self_lb + H_hidden_ub) / (H_vis_ub + H_hidden_ub)`**  ……（自持路 i）

- **验反例**：`H_vis_ub=250, H_self_lb=20, H_hidden_ub=0` ⇒ `230/250=0.92 ≥` 真 `0.90` ✓（上界成立）。
- 🔴 **`H_hidden_ub` 与 `H_adv_add` 不是同一符号**（守 Codex "不得混"）：`H_hidden_ub`=入场前 withheld 算力上界（喂**份额** cap）；`H_adv_add`=入场后 pump 注入增量（喂 `k_max`）。二者**默认各自具名**；**唯当** Owner 采"单一可动员对抗预算 `B_adv`"模型时可令 `H_hidden_ub = H_adv_add = B_adv`——这是**显式 Owner 冻结决策（§8）**，不是本规格默认的静默合并。
- **fail-closed 默认**：无具名 `H_hidden_ub`（或无合格 `H_vis_ub`）⇒ 自持路**不出 cap**，回落 **(a-total)** `min(1, H_adv_cap/H_total_lb)`（需 Owner 具名 `H_adv_cap`）；两路都无 ⇒ `s_adv_cap` 无来源 ⇒ **关**。

### 谁是合格 `H_vis_ub`（法3 带修正，非 `max(三法 raw)`）
- **法1 单用不合格**：难度 = 已发布工作率的**滞后均值**（≈44 min 窗），算力**升**时偏**低**——而攻击场景恰是对手加算力（升）⇒ 法1 给的是下偏、非上界方向。
- **法3 合格（带修正）**：块戳 ∈ [到达−132(PMT 过去封), 到达+132(未来封)] ⇒ 到达落**内窗** `[t−W+132, t−132]`（宽 `W−264`）的块，其戳**必**落测量窗 `[t−W, t]`。故 `Σwork(戳∈W)` ≥ 内窗（真实时长 `W−264`）全部工作 ⇒
  > **`H_vis_ub = 法3_raw × W/(W−264) = Σwork(戳∈W)/(W−264)`**
  与入场地板 `÷(1+口径/W)` **反向**（同一 132 s 偏差各取一头）。
- **假设（具名、非硬界）**：本机时钟同步；迟发旧戳块只**抬**计数（对 ub 保守向）；内窗到达率泊松 ⇒ 取 λ 上置信分位（`W=600 s`：`n≈6000`(10 BPS)、`σ≈77`、99.9% ≈ `+4%`）。
- 🔴 **W 短则修正爆炸**：`W/(W−264)`：`600 s ⇒ ×1.786`、`3600 s ⇒ ×1.079` ⇒ **ub 必用 ≥1 h 窗**（264 s 死带占短窗比例过大）。**`max(三法 raw)` 不是 ub**；合格当且仅当**法3（含修正+分位）** 或**法2（加 red work）**。

### `H_self_lb` 口径（同内窗，不用标称）
- 用**自家已发布块工作和**（coinbase 归属，(24) 可抽），**不用设备标称**：掉线/迟发 ⇒ 标称偏高 ⇒ `H_self` 偏大 ⇒ cap 偏小 ⇒ 诚实地板偏大 = **危险向**。∂cap/∂H_self<0 ⇒ 取 `H_self` 小 = `H_self_lb`。
- `H_self_lb = min(已发布工作和, 标称)`，与 `H_vis_ub` **同内窗同口径**（`H_self_lb ≤ H_vis_ub`）。

## §4 `k_max`（Codex PASS，不动）
- **`k_max = 1 + H_adv_add / H_total_lb`**（增量/总；`H_total_lb`=(21) v0.5 `min(可用法), gate_input=OK`，law1_only/FAIL_CLOSED 态不得用）。入场 `B_win(k_max) ≤ baked B_win 预算`（占位 55,200 ⟺ `k_max ≲ 1000`，Codex 弱假设不推荐）。
- **两条独立、入场须都过**：`B_win(k_max) ≤ baked`（增量管 pump 抬速）**且** `H_floor_honest_lb = H_floor_total_lb × (1 − s_adv_cap) ≥` 该门要的诚实防御下界（份额管防御余量）。

## §7 残余
- 🔴 **(d) 侧同步**：(d) v0.10 若引份额式，须只留 (a-total) + 本版自持路分解式，删 b-self/双计残留；`H_adv_add` 只进 `k_max`，`H_hidden_ub` 单独具名（J2 起 (d) 时同步，本版 §3.5 为准）。
- **`H_vis_ub` 未落码/未实测**：法3 修正式 + 泊松分位是设计层；须节点同步后在真链上量（(21)/(24) 工具承接），**W≥1h 才有意义**。
- 时间戳解析器：Codex PASS 属"实质修复"，最终证据待 harness 真 `submit_ts` + ≥30 同步后样本（(27) claim-depth durable 承接）。

## §8 Owner 冻结项（更新）
1. **`H_adv_cap`**（对手算力上界，CAPEX/身份独立论证）—— (a-total) 造 cap；无则该路关。
2. **`H_hidden_ub`**（入场前 withheld 算力上界）—— 自持路造 cap 的**不可测输入**，须 Owner 具名；无则自持路关。
3. **`H_vis_ub`**（可见算力上界）—— 法3（修正 `×W/(W−264)` + 泊松上分位，`W≥1h`）或法2（加 red work）在真链上量；**不许 `max(三法 raw)`/法1 单用冒充**（方向反）。
4. **`H_self_lb`**（我方算力下界）—— 自家已发布块工作和（(24) 抽），非标称。
5. **`H_adv_add`**（pump 注入增量）—— 只进 `k_max`，**不进份额 cap**；是否 `= H_hidden_ub`（单一 `B_adv` 模型）由 Owner **显式**决定，非默认。
6. **`H_total_lb`** = (21) v0.5 `min(可用法), gate_input=OK`（law1_only/PROVISIONAL_OVERESTIMATE/FAIL_CLOSED 态不得作 firm 地板）。

## 未变（同 v0.8/v0.7/v0.6）
§1 min(法1,法2,法3)（对齐 (21) v0.5，`gate_input=OK` 才作 firm 地板）；§2 墙钟窗；§3 三闸；§3.5 `s_visible_max` payload 归属 + `s_adv_cap≥s_visible_max`=一致性条件（仅告警）；§5 fail-closed + 已开仓披露（在飞暴露窗 132+f×W+T_dwell）；§6 底线机制输出；§7 第三方公开链数据可复核（非 operator 自证）+ provenance；法3 三段（头段≤132s/残余随W衰减/时延132+f×W+T_dwell）。
