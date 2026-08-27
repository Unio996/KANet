# Tier-2 算力地板量法规格 v0.10（认 J2 红队 v0.9 两 MUST + 两 🟡 · SUPERSEDES v0.9）

> **Status**: DESIGN v0.10 · NWT 2026-08-27 · SUPERSEDES v0.9（851a2913）· J2 判 v0.9 = GREEN-WITH-2-MUST（`scratch/_j2_redteam_verdict_23v09.md`）。**两 MUST 全认**（都是我 v0.9 的危险向 bug）。改 §3.5(b)（`H_vis_ub` 改本机时钟接收计数 + hidden/add 预算模型 + 硬闸）+ §8。**其余同 v0.9/v0.8。**
> **我独立复核（钉 live commit `7b1e18cc`，非 worktree `90dbf074`）**：过去侧 `post_pow_validation.rs:23` `ts ≤ past_median_time ⇒ TimeTooOld`（唯一过去约束 = `ts > 块自身 PMT`，由父集算、**不绑接收**）；未来侧 `pre_ghostdag_validation.rs:40-41` `ts > unix_now()+132 ⇒ TimeTooFar`（未来**绑**钟、过去**不绑**）。⇒ MUST-B 在 live 成立。

## 认错（v0.9 两处，都危险向）
- **MUST-A**（份额 cap 的 hidden 项与 pump 增量的预算关系我写反）：v0.9 :23/§8-5 "两符号默认分开，令等是可选"——**backdoor**：Owner 可写 `H_hidden_ub=0` 配大 `H_adv_add` ⇒ cap = `1−H_self_lb/H_vis_ub` 偏小 ⇒ 诚实地板偏大 ⇒ 入场偏松。**物理上二者同源**：入场能注入的算力都能提前开机扣块（多付几小时租费，TN12 可忽略）⇒ `H_hidden_cap ≥ H_new_cap`；扣着的可解扣 = 一份注入 ⇒ `H_adv_add ⊇ H_hidden`。合起 = **同一可动员预算 `B_adv` 由对手在两时刻分配**。我且**误读 Codex "不得混"**——它指两公式的**角色**（份额 vs pump 抬速）不同，**不指两个数须不等**。
- **MUST-B**（`H_vis_ub` 按块戳定窗计数失效）：我 v0.9 :31 设 `ts ≥ 到达−132`，**错**——过去侧只受"块自身 PMT"，陈父块可带**旧戳**、真工作、现在到达、进 DAG（多半 red），却落在 `[t−W,t]` **戳窗外** ⇒ 不计入 ⇒ **公开算力被当不存在** ⇒ `H_vis_ub` 欠计 = 无效上界（危险向）。"戳在窗内晚到"我盖到了，"戳在窗外准时到"漏了。

## §3.5(b) 重写：`H_vis_ub` 改本机时钟接收计数（法3′）；hidden 默认 = add

份额 cap 分解式**不变**（v0.9 采 J2，构造对）：
> **`s_adv_cap = (H_vis_ub − H_self_lb + H_hidden_ub) / (H_vis_ub + H_hidden_ub)`**
> （对 `H_vis`、`H_hidden` 偏导 `=H_self/D²>0` ⇒ 各取上界、`H_self` 取下界。验：`ub=250/self=20/hidden=0 ⇒ 0.92≥`真`0.90`✓；`hidden=100 ⇒ 330/350=0.943`✓）

**改点 1（MUST-B）——`H_vis_ub` 用本机时钟接收计数，不看块戳**：
- **法3′**：两次 own-clock 轮询 `t0<t1`，各取可达 tips 集，`H_vis_ub = Σwork(两次间新可达块) / (t1−t0)` × 泊松上分位（(24) 已有 `getBlocks` 遍历可复用）。
- **不看块戳 ⇒ 死带归零、修正因子 =1**（作废 v0.9 `×W/(W−264)`）。余差只剩：**传播时延**（秒级 `+T_prop`，`t1−t0 ≫ T_prop` 则可忽略）+**"到达未收"**（= 网络扣/延，归 `B_adv`/可用性，已被 `H_hidden_ub` 覆盖）⇒ 残余盲点**被 `B_adv` 收口**、非无界。
- **过/欠计方向**：`t0` 前造、`[t0,t1]` 内到的块被计入 = 略**过**计（对 ub 保守 ✓）；`[t0,t1]` 内造、`t1` 后到 = 欠计（= `T_prop` 残差，`t1−t0≫T_prop` 压掉）。
- **对 (21)**：`law3FromBlocks`（按戳）作**下界**仍有效（欠计对 lb 保守）；作 **ub 须新函数按接收计**。**`max(三法 raw)` 不是 ub**；法1 单用不合格（难度滞后、算力升时偏低=方向反）；**法2 同 MUST-B**（须接收基/red work，不可按戳作 ub）。

**改点 2（MUST-A）——hidden 默认 = add，拆开须论证 + 守卫**：
- 🔴 **默认 `H_hidden_ub = H_adv_add = B_adv`**（单一可动员对抗预算，喂两路：份额 cap 用 `H_hidden_ub`、`k_max` 用 `H_adv_add`）。联合最坏"扣着 `B` 再全拿去 pump"仍 `k = 1 + B/H_total_lb` = `k_max`，**非双计**。
- **拆开（`H_hidden_ub < H_adv_add`）须 Owner 论证"为何提前开机扣块不可行"** + **机械守卫 `H_hidden_ub ≥ H_adv_add`**（防 `H_hidden_ub=0` backdoor）。守 Codex：两公式**角色**分开（本表两列喂不同门），两**数**默认相等。

**改点 3（🟡→硬闸）**：
- **`H_vis_ub` 出数硬前置**：`(t1−t0) < W_min` **或** 未取分位 ⇒ `H_vis_ub` **不出** ⇒ 回落 **(a-total)** `min(1, H_adv_cap/H_total_lb)`。
- `W_min` 理由**改**（死带已归零）：由**样本量**（`n=BPS×(t1−t0)` 足够使泊松上分位有意义）+ **`T_prop≪(t1−t0)`** 定，非原"死带占比"。分位**具名单侧 99.9%**：`n_ub = n + 3.09√n`。
- **🟡2 由构造消解**：`H_vis_ub`（接收计）与 `H_self_lb`（自家产块工作和，我们即时自知）**同 `(t1−t0)` 窗、同分母** ⇒ v0.9 的 `/(W−264)` vs `/(W+264)` 不对称**不再存在**。`H_self_lb = min(自家已发布工作和, 标称)`（非纯标称：掉线/迟发 ⇒ 标称偏高 ⇒ cap 偏小 = 危险向），`H_self_lb ≤ H_vis_ub`。

**fail-closed 默认不变**：无具名 `B_adv`（或 (a-total) 无 `H_adv_cap`）⇒ 无 cap ⇒ 关；`H_vis_ub` 闸不过 ⇒ 回 (a-total)；两路皆无 ⇒ 关（现网关，机制输出）。

## §4 `k_max`（Codex PASS，不动）
- **`k_max = 1 + H_adv_add / H_total_lb`**（增量/总；`H_total_lb`=(21) v0.5 `min(可用法), gate_input=OK`）。入场 `B_win(k_max) ≤ baked B_win 预算`（占位 55,200 ⟺ `k_max≲1000`，Codex 弱假设不推荐）。
- **两条独立、入场须都过**：`B_win(k_max) ≤ baked` **且** `H_floor_honest_lb = H_floor_total_lb × (1 − s_adv_cap) ≥` 该门要的诚实防御下界。（:5/§4 统一用 `=`。）

## §7 残余
- **`H_vis_ub` 法3′ 未落码**：接收计数是设计层，须节点同步后真链上量（(24) `getBlocks` 承接）；`W_min` + 分位落成硬闸。
- 时间戳解析器：Codex PASS 属"实质修复"，最终证据待 harness 真 `submit_ts` + ≥30 同步后样本（(27) claim-depth durable 承接）。
- 🔴 **(d) 侧同步**：(d) v0.11 (b) 拟文须引本版 §3.5（(a-total) + 分解式 + 法3′ 接收计 + hidden=add 默认 + 守卫），删 b-self/双计/按戳 ub 残留（J2 备文等本版 hash）。

## §8 Owner 冻结项（更新）
1. **`B_adv`**（单一可动员对抗预算）——**默认同喂**份额 cap（`H_hidden_ub=B_adv`）与 `k_max`（`H_adv_add=B_adv`）。
2. **拆分授权**（`H_hidden_ub < H_adv_add`）——须 Owner 论证提前开机扣块不可行 + 守卫 `H_hidden_ub ≥ H_adv_add`。
3. **`H_adv_cap`**（对手算力上界，CAPEX/身份独立论证）—— (a-total) 造 cap；无则该路关。
4. **`H_vis_ub`**——法3′（本机时钟接收计数 + 泊松上分位，`(t1−t0)≥W_min`）或法2（接收基/加 red work）；**不许按块戳定窗**（MUST-B）、**不许 `max(三法 raw)`/法1 单用**（方向反）。
5. **`H_self_lb`**——自家已发布块工作和（(24) 抽），非标称；同 `(t1−t0)` 窗。
6. **`H_total_lb`** = (21) v0.5 `min(可用法), gate_input=OK`（law1_only/PROVISIONAL_OVERESTIMATE/FAIL_CLOSED 态不得作 firm 地板）。

## 未变（同 v0.9/v0.8/v0.7）
§1 min(法1,法2,法3)（对齐 (21) v0.5）；§2 墙钟窗；§3 三闸；§3.5 `s_visible_max` payload 归属 + `s_adv_cap≥s_visible_max`=一致性条件（仅告警）；§5 fail-closed + 已开仓披露（在飞暴露窗 132+f×W+T_dwell）；§6 底线机制输出；§7 第三方公开链数据可复核（非 operator 自证）+ provenance；法3 三段（头段≤132s/残余随W衰减/时延132+f×W+T_dwell）。
