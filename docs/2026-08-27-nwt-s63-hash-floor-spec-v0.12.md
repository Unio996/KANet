# Tier-2 算力地板量法规格 v0.12（认 Codex MSG-279 三 D-STAT MUST-FIX · SUPERSEDES v0.11）

> **Status**: DESIGN v0.12 · NWT 2026-08-27 · SUPERSEDES v0.11（abda09f3）· Codex `b4df8328`（MSG-279）判 **MATERIAL PROGRESS / gate (d) OPEN**：b-self 撤 CLOSED、(a-total) PASS-dir、自持路代数 PASS（条件于输入真是界）、接收计基础 PASS-dir、单一 B_adv PASS-dir（条件：B_adv 语义须真是上界）、`H_self_lb>H_vis_ub` 闸对、(21) v0.7 非安全下界对；`W_min=3600s` = **运营最小值、不足以统计收口**。**三 D-STAT MUST-FIX 全在 `H_vis_ub` 的统计/工作上界构造 ⇒ 只改 §3.5(b) 改点1/改点3 + §8。其余逐字同 v0.11 = abda09f3。**
> **Codex 明写：本轮不授权任何 covenant build / 落码 / 部署 / 签名广播 / DB 变更 / 结算退款 / key movement / 生产钱路。** 本稿纯设计层。

## 认 Codex 三点（我 abda09f3 的 `H_vis_ub` 构造统计不严，全危险向或不成立）
- **D-STAT-1**：`n_ub = n + 3.09√n` 是**高斯近似**，不是机械保证的单侧 99.9% 泊松上限——**小 n / 偏离渐近时它 understate**（我实算：n=100 高斯 +30.9% vs 精确 +34.9%；n=1000 +9.8% vs +10.2%；n≥10⁴ 才收敛）⇒ 拿它当硬安全界会**低估上界 = 危险向**。
- **D-STAT-2**：`W≥3600s` **推不出** `n≈36,000`——问题恰在网络偏离 10 BPS 时（慢窗 ⇒ n 小 ⇒ 上面近似更失效）。须**机械 `n≥N_min` 闸**，与 `W≥W_min` 并列。
- **D-STAT-3**：`H_vis_ub` 是**工作率**上界，而分位只写在**块计数**上；窗内每块 work 变（难度移动/异构）时 `Σwork × 计数因子` **不自动**是工作总量上界。**禁**默默用观测均值 work/块作上因子（尾部危险向）。

## §3.5(b) 改点1 重写（D-STAT-1/2/3）——`H_vis_ub` 三项耦合的硬上界

法3′ 本机时钟接收计数**方向不变**（不看块戳，MUST-B）：两次 own-clock 轮询 `t0<t1`，各取可达 tips 集，取 `[t0,t1]` 间**新可达块**集合（(24) 已有 `getBlocks` 遍历）——记其**块数** `n`、各块 **work** `{w_i}`、**最大单块 work** `w_max = max_i w_i`。**上界式**：

> **`H_vis_ub = n_ub × w_max / (t1 − t0)`**

三项各自为界、乘积保守（真可见工作率 `= Σw_i/(t1−t0) ≤ N·w_max/(t1−t0) ≤ n_ub·w_max/(t1−t0)`）：

1. **`n_ub` = 精确泊松单侧上限（D-STAT-1，冻结 Garwood）**：`n_ub = λ_ub = ½·χ²_{1−α}(2n+2)`（等价 `gammaincinv(n+1, 1−α)`），`α = 0.001`（单侧 99.9%）。**机械、全 n 精确**，大 n 收敛到高斯（n=36,000：λ_ub=36,590 ⇒ +1.64%，高斯 +1.63%），小 n 严格 ≥ 高斯（不再 understate）。**弃用 `n+3.09√n`**；若某处仍用正态，须显标"近似"且**不得**升为硬安全界（Codex）。
2. **`w_max` = 同窗每被计块 work 的保守上界（D-STAT-3）**：取窗内被计块的**观测最大单块 work**（非均值——均值 understate 尾部 = 危险向，Codex 禁）。假设显写：**保护相关时域内每块 work ≤ 窗内 `w_max`**；若难度可升破窗内 max，改用 **DAA 最大调整幅度**给的窗内 work 上界（窗起 target × 最大调整因子）——二选一，取更紧/假设更少者并写清（本版默认观测 `w_max`，假设最少）。
3. **`(t1−t0)`** = own-clock 实测窗长。

- **接收计边界（Codex "其他"）**：窗内才变可达的**旧** work 被多计 ⇒ 对上界**保守**（安全向，OK）。**`t1` 前本机不可见的 work 不假设为零**——归**具名对手/可用性模型**（`B_adv` / `H_hidden_ub` 已界 withheld/延迟工作）；**不把传播当字面零**（作废 v0.11 "T_prop≪W 可忽略"的措辞，改为"归 `B_adv` 覆盖，边界显写"）。

## §3.5(b) 改点3 重写（硬闸 = 双闸 + 精确构造）

自持路 (b) 出 cap 的**全部硬前置**（任一不满足 ⇒ (b) 不出 cap ⇒ 回 (a-total)，两路皆无 ⇒ fail-closed）：

> `(t1−t0) < W_min` **∨** `n < N_min` **∨** 未用精确 Garwood 上限（用了近似且未独立量化近似误差）**∨** `H_self_lb > H_vis_ub`（口径错）**∨** 无具名 `B_adv`

- **`W_min = 3600 s`**（运营最小值，abda09f3：保证最小窗长 + 传播占比小；**但不足以统计收口**——Codex，故须并列 `N_min`）。
- **`N_min` = 机械样本闸（D-STAT-2），从 Garwood + 具名"最大可接受相对统计裕度 `δ_max`"推导**：`N_min` = 满足 `λ_ub(n)/n − 1 ≤ δ_max` 的最小 `n`。**`δ_max` = Owner 冻结项（§8），推荐 5%** ⇒ 我实算 `N_min = 3,974`（**闸取 4,000**，向上取整 = 更严 = 保守）。（对照：`δ_max=3% ⇒ N_min=10,867`；`2% ⇒ 24,259`——Owner 若要更紧的 cap 可调小 `δ_max`、`N_min` 随之升。）**`n` 是实测块数，非由 10 BPS × W 推**。

## §4 `k_max`（Codex PASS，不动）
`k_max = 1 + H_adv_add / H_total_lb`（`H_adv_add = B_adv`；`H_total_lb` = (21) v0.5 `min, gate_input=OK`）。入场须 `B_win(k_max) ≤ baked` **且** `H_floor_honest_lb = H_total_lb × (1 − s_adv_cap) ≥` 诚实防御下界。

## §8 Owner 冻结项（更新 D-STAT 相关）
1. **`B_adv`**（单一可动员对抗预算）——**语义须真是上界（Codex 条件）**：= **保护窗内可缺席于可见集、后变有效的【全部】对手容量/工作**的上界；默认同喂 (b) `H_hidden_ub` 与 `k_max` `H_adv_add`；拆开（`H_hidden_ub < H_adv_add`）须 Owner 论证 + 守卫 `H_hidden_ub ≥ H_adv_add`（hidden 不得小于 injected）。
2. **`δ_max`**（H_vis_ub 最大可接受相对统计裕度）——推荐 5% ⇒ `N_min = 3,974`（闸 4,000）；调小则 `N_min` 升、cap 更紧。
3. **`H_vis_ub` 构造**（D-STAT-1/2/3 冻结）：法3′ 接收计 → `n_ub`(Garwood 精确) × `w_max`(观测最大单块 work 或 DAA 幅度上界) / (t1−t0)；双闸 `W≥3600s ∧ n≥N_min`；不许块戳定窗（MUST-B）、不许 `max(三法 raw)`/法1 单用（方向反）、不许均值 work/块作上因子（D-STAT-3）。
4. **`H_adv_cap`**（(a-total)）/ **`H_self_lb`**（自家已发布块工作和，(24) 抽，min 标称，同窗同分母）/ **`H_total_lb`**（(21) v0.5 `min, gate_input=OK`）——同 v0.11。

## 未变（逐字同 v0.11 = abda09f3）
§3.5(b) 分解式 `s_adv_cap = (H_vis_ub − H_self_lb + H_hidden_ub)/(H_vis_ub + H_hidden_ub) = 1 − H_self_lb/(H_vis_ub + B_adv)`（Codex 认单调：增于 H_vis_ub/B_adv、减于 H_self_lb）；两式取 max；(a-total) `min(1, H_adv_cap/H_total_lb)`（Codex PASS，需 Owner 具名 `H_adv_cap`）；`s_adv_cap ≥ s_visible_max`（(24) 校验，仅告警）；TN12 结论（对方 `H_self_lb≈0` ⇒ (b) cap=1 ⇒ fair-exchange 两侧须成立 ⇒ 现网关）；法3 按戳 `÷(1+口径/W)` 只作**下界**（上界只能法3′）；§4/§5/§6/§7 及 §1–§3.5 前段、法3 三段同 v0.11/v0.10/v0.9。

## 给 J2 红队的改点清单（行号锚）
- **§3.5(b) 改点1**：`H_vis_ub = Σwork/(t1−t0)×泊松上分位` → **`n_ub×w_max/(t1−t0)`**，`n_ub`=Garwood 精确、`w_max`=观测最大单块 work。
- **§3.5(b) 改点1 边界注**：删 "T_prop≪W 可忽略"，改 "t1 前不可见 work 归 B_adv、边界显写；旧 work 多计=保守"。
- **§3.5(b) 改点3 硬闸**：加 `n < N_min` 与 "未用精确 Garwood"两条；`W_min=3600s` 降为运营闸之一。
- **§8**：新增 `δ_max`（§8-2）+ `N_min` 推导 + `B_adv` 上界语义（§8-1，Codex 条件）+ `H_vis_ub` 构造冻结（§8-3）。
- 复算锚：Garwood `n_ub=½χ²_{0.999}(2n+2)`；n=36,000⇒36,590(+1.64%)；N_min(δ=5%)=3,974、(3%)=10,867、(2%)=24,259。
