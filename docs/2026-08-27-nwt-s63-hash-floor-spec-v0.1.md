# Tier-2 "入场前稳定诚实算力地板" 量法规格 v0.1（设计层 · 无节点 · 数值 PLACEHOLDER）

> **Status**: DESIGN v0.1 · NWT 2026-08-27 · 派工 Bettor (23) · = Codex `k_max` 政策形状**第 2 步**（`docs/…gate-d-conservative-bounds` v0.8 §6：Owner 预算 → **pre-entry 稳定诚实算力地板** → 推 `k_max` → 跌破 fail-closed）。Owner 定 `k_max` 的直接输入。
> 坐标全 `git show 7b1e18cc:<path>`（live 二进制，非工作树 90dbf074）。公式/判据闭合；数全 PLACEHOLDER。J2 反向红队。
> **一句话**：地板 `H_floor` = 一个**墙钟窗**内、由**公开链数据**独立算出的 `min(法1,法2)` 的**低分位**；Owner 给对抗预算 `H_adv`，`k_max = 1 + H_adv/H_floor` 由此**推**（不是拍）；跌破 `H_floor_min = H_adv/(k_baked−1)` ⇒ fail-closed。**承重纪律两条**：窗口用**墙钟不用 DAA**（DAA 可被挖矿对手压缩，回扣 (d)）；地板**第三方可复核、非 operator 自证**（防"绿灯无信息"）。

## §1 估计器 = `min(法1, 法2)`（接 (21) v0.2）
| 法 | 公式 | 坐标 @7b1e18cc |
|---|---|---|
| 法1（难度反推）| `H1 = calc_work(tip.bits) × BPS`，`calc_work = 2^256/(target+1)`，`BPS=10` | `consensus/src/processes/difficulty.rs:261 calc_work`；`math/src/lib.rs:64 from_compact_target_bits`；`config/params.rs:689-691 TenBps` |
| 法2（实际产出）| `H2 = Δblue_work/Δt` over window（node 自算）| `difficulty.rs:46-67 internal_estimate_network_hashes_per_second`（`MIN_WINDOW_SIZE=1000`）；RPC `service.rs:954`（`window ≤ MAX_SAFE_WINDOW_SIZE=10,000` ∧ ≤ pruning_depth，`rpc/core/src/api/rpc.rs:16`）|
| **取值** | 每个采样点 `H_sample = min(H1, H2)` | (21) v0.2 裁：安全=不高估 H_net ⇒ 取小 |
- 🔴 **为什么 min**：地板是**保守下界**（问"攻击成本够不够高"）；高估 H_net ⇒ 误判 k_max 安全。法1（难度）与法2（实际增速）谁小不定（停滞期法2 小、算力刚涨难度没跟法1 小）⇒ 逐点取 min。
- 🔴 **两法都有时间戳依赖，但对【抬高】地板都受 (d) 的 +132 s 未来封约束**：要把地板抬高需 difficulty 高（法1）或 blue_work/Δt 高（法2），两者要么真做功、要么 future-stamp（撞 132 s 硬封，bounded，见 (d)）⇒ **凭时间戳把地板抬高是有界的；真抬高地板须真算力**（§6 承此）。

## §2 窗口 —— 🔴 用【墙钟】不用【DAA】（回扣 (d) DAA-vs-wallclock 纪律）
- **窗口长度 = 墙钟 `T_win`（PLACEHOLDER，量级 = 数小时–数天）**，**不是 DAA-count 窗**。**理由（承重）**：DAA-count 窗可被挖矿对手**压缩**——对手 pump DAA（future-stamp，(d)）在更少真实时间里填满 N DAA ⇒"地板"反映的真实防御时间更短、更易伪造。墙钟窗第三方按自己时钟锚定、对手压不动。
- **采样间隔 `Δ_sample`（PLACEHOLDER，量级 = 数分钟）**：密到能抓"撤算力"的下沉，over `T_win` 看持续防御。
- 🔵 **Δt 本身（法2 分母）用块时间戳**——受时间戳操纵，但 (d) 已证抬高侧 bounded（+132 s）；且我们取 `min(法1,法2)`，法1 不吃 Δt ⇒ 对手压不低法1 到任意（压低 difficulty 需 stamp 慢=未来侧，同样封）。**双估计器 + min 是对时间戳操纵的冗余**。

## §3 "稳定" 判据（三闸，全过才算稳定地板）
| 闸 | 判据 | 为什么 |
|---|---|---|
| (a) 样本充分 | 窗内样本数 `≥ N_min` **且** 覆盖墙钟 `≥ T_win`（PLACEHOLDER）| 证据下限，防短窗侥幸 |
| (b) 地板取**低分位** | `H_floor = p10({H_sample})`（不是均值、不是 max）| 均值/max 让对手用瞬时尖峰把地板抬上去；p10 抓"防御最弱的那 10%" |
| (c) 无深坑 + 波动封顶 | 无任何**连续子窗**（长度 `≥ T_dip`）的样本 `< H_floor × f_dip`；且 `p90/p10 ≤ R_vol`（PLACEHOLDER）| 深坑 = 算力来去 = 撤算力签名；`p10` 若被一段近零拉出来仍不算稳（子窗坑闸补 p10 的盲点）；波动比封顶 = 防"平均够但一直在抖" |
- 🔴 **p10 与子窗坑闸是两道**：p10 是分位（抗单点噪声），子窗坑闸抓"持续下沉"（分位抓不到时序）——**缺一是 vacuous**（同我 (h) CFG-UNIT-DOMAIN"两道都要"族）。

## §4 `H_floor` ↔ `H_adv` → `k_max`（哪项 Owner 给、哪项量）
- **`H_adv` = Owner 给**（对抗算力预算 = 威胁模型："假设对手能动员 ≤ `H_adv`"）。**这是信任假设，Owner 拍。**
- **`H_floor` = 量**（§1–§3，公开链数据算出）。
- **`k_max = 1 + H_adv / H_floor`** = **推**（Owner 给分子、量得分母、比值落出来）。
- 🔴 **回扣 covenant baked 预算（闭环）**：covenant 烤死一个 N，覆盖 `B_win` 到某 `k_baked`（我 sim：k=1000→53,070；占位 55,200 ⟺ `k_baked≈1000`）。**入场要求 `k_max ≤ k_baked`** ⇔ **`H_floor ≥ H_adv/(k_baked−1) =: H_floor_min`**。⇒ **地板有一个绝对最小值 `H_floor_min`，量得的 `H_floor < H_floor_min` ⇒ 入场失败**。这把本规格接死在我 `B_win(k)` 曲线上：`k_baked` 由 baked N + 曲线定，`H_floor_min` 由 `k_baked` + Owner 的 `H_adv` 定。
- **顺序**：Owner 定 `H_adv` + `k_baked`(由 baked N) → `H_floor_min = H_adv/(k_baked−1)` → 量 `H_floor` → `H_floor ≥ H_floor_min`? 过则入场且 `k_max` 记账；否则 fail-closed。

## §5 fail-closed（触发 / 滞回 / 恢复 / 已开仓——只提问不拍）
- **连续再量（承重）**：`H_floor` **不是只入场量一次**——Tier-2 运行期**持续再量**（每 `Δ_recheck`），否则对手入场后撤算力无人管。
- **触发**：量得 `H_floor < H_floor_min`。
- **滞回（防抖，两阈 + dwell）**：**入场阈** = `H_floor ≥ H_floor_min × (1+m_up)` 持续整窗；**退出阈** = `H_floor < H_floor_min × (1−m_down)` 持续 `T_dwell`。两阈间隙 + dwell 防止地板在阈值附近抖动导致 Tier-2 开关抖动（`m_up/m_down/T_dwell` PLACEHOLDER）。
- **恢复**：fail-closed 后**须一个全新的完整稳定窗**（§3 三闸全过 + `≥ H_floor_min×(1+m_up)`）才准重开——**不是地板一回弹就开**（防对手短暂回补算力骗重开）。
- 🔴 **已开仓 Tier-2 头寸处置——【只提问，Owner/Codex 拍】**：链上 N 在**开仓时烤死**，地板中途跌破**改不了已开仓的 N**。⇒ 提三个问题不拍：
  1. fail-closed 只挡**新入场**、在飞头寸**吃开仓时的 baked 保护**——但若地板跌破意味在飞头寸的**真实 k 现已 > k_baked**，其 baked N 可能**不够** ⇒ 反应方可能失。这是"短 covenant 窗 + 保守 k_baked"的论据。
  2. 是否要一个"地板跌破 ⇒ 在飞头寸走加速结算/强制 recovery"的机制？（会改结算语义，重）
  3. 还是接受"在飞头寸承担开仓时的风险、fail-closed 只防新仓"？（最简，但把 §6 forge-withdraw 的伤害留给在飞头寸）
  **本规格不拍，标为 Owner/Codex 决策项。**

## §6 对抗面：伪造地板（forge → 入场 → 撤 → 攻）
- **攻击**：对手先自挖抬高 `H_floor` → 过入场 → 撤算力 → 攻在飞头寸（此时真实防御低，pump DAA 逼 recovery）。
- **窗口长度压制**：地板取**墙钟长窗 p10 + 子窗坑闸**（§2/§3）⇒ 要伪造须**全窗持续**多付真实算力（真金白银挖 `T_win` 那么久），不是瞬时尖峰能骗（p10 + 坑闸滤掉尖峰）。
- **滞回 + 连续再量压制**：入场后撤算力 ⇒ §5 连续再量抓下沉 ⇒ `T_dwell` 后 fail-closed 挡**新仓**。**残余 = 撤算力到 fail-closed 之间对【在飞头寸】的窗口** = §5 的已开仓问题（forge-withdraw 的伤害面 = 在飞头寸，不是新仓）。⇒ **§6 与 §5 是同一残余**，压法 = 短 covenant 窗 + 保守 `k_baked` + 快 `Δ_recheck`/小 `T_dwell`。
- **伪造估计器（非真算力）压制**：抬高 `H_floor` 需 difficulty 高（法1）或 blue_work/Δt 高（法2）——两者**真做功**才成；纯时间戳抬高受 (d) +132 s 未来封 bounded（§1）⇒ **凭时间戳伪造地板是有界的、真伪造须真算力**（= 攻击有真实成本，正是 `H_adv` 要覆盖的）。
- 🔴 **承重结论**：地板**不能被瞬时/时间戳伪造**（p10+坑闸+min(法1,法2)+132s 封）；能被**持续真算力**"抬高"——但那**就是真防御**（对手全窗真挖 = 网络那段真有那么多算力），撤了就被连续再量抓。⇒ forge 攻击退化为"真挖一阵再撤"，伤害限在**在飞头寸窗**（§5 决策项）。

## §7 谁量 / 证据 / 第三方可复核
- **谁量**：入场闸（operator/console）入场时量 + 连续再量守护进程运行期量。**但不止 operator**——
- 🔴 **第三方可复核（承重·防 operator 自证）**：`H_floor` 的全部输入（`tip.bits`、blue_work 窗、块时间戳）都是**公开链数据** ⇒ **任一方（反应方 / watchtower / 审计者）用自己的节点独立重算 `min(法1,法2)` 的 p10**。⇒ 地板**不是 operator 声明的一个数**（那是"绿灯无信息"/自证族），是**公开、可验的链上量**。反应方入场前**自己核**地板 ≥ `H_floor_min`，不信 operator 的绿灯。
- **证据落点（provenance 惯例，同 bwin-sim bundle）**：每次入场决策落一份 artifact：`{采样时刻(墙钟+daa)、tip hash+bits、逐样本 H1/H2/min、窗统计(p10/p90/坑闸结果/样本数/T_win 覆盖)、H_floor、H_adv、k_baked、H_floor_min、k_max、决策(入场/拒)}`；连续再量同样落。第三方按 artifact 里的 daa/tip 从链史重算比对。
- **量法脚本**（同步后写，gitignored scratch → 入库 provenance，同 (22) 纪律）：读 `getBlock(tip)/estimateNetworkHashesPerSecond`，SYNC-GATE（`daa>80,095,687 ∧ isSynced`，IBD 期数据假象，同 (21)）。

## §8 未决 / 边界
- 全数值 PLACEHOLDER（`T_win/Δ_sample/N_min/p10 vs min/f_dip/T_dip/R_vol/m_up/m_down/T_dwell/Δ_recheck/H_adv`）——待 Owner 定 `H_adv` + 同步后量真实 `H_net` 分布定其余。
- §5 已开仓处置 = Owner/Codex 决策项（三问不拍）。
- 审查信道（矿工不打包）仍 out-of-model（bounded-inclusion，Codex）——本规格只管 DAA-pump 侧的 `k_max`，不解审查。
- 本规格是 **Tier-2 开不开的入场闸**，不改任何已 live 结算；真开 = Owner 充分测试后拍（同 D-005 ZK 全隔离纪律）。
