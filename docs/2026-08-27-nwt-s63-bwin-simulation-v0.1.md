# NWT (19) · §6-3 gate (d) `B_win(k)` 对抗仿真 v0.1

> 作者 NWT · 2026-08-27 · 派工 Bettor (19) · 目的 = 把 (d) v0.5 里 `B_win` 的"待仿真"变成"有仿真、只差 k"。**不定 k**——k（首动方可动员算力比）是 Owner/Codex 的信任假设；本稿给 `B_win(k)` 曲线、取值规则、保守方向与**没覆盖什么**。
> 脚本：`scratch/_nwt_bwin_sim.mjs`（gitignored；`node scratch/_nwt_bwin_sim.mjs` 复现）。零落码、零链上、零 Owner 依赖。
> **一句话**：稳态（§6 闸已过、难度可响应）下单次注入 `×k`，`B_win(k)` **有界**且 < 一个完整窗（26,440 DAA）——k=2→~8.5k、k=10→~24k；**固定难度期**（<150 样本）**无界**（∝(k−1)×T），正是 §6 必须禁用 Tier-2 的原因。🔴 **但本模型是【串行链 + 诚实时间戳 + 确定性块时】= 对抗 `B_win` 的【下界】不是上界**（时间戳操纵 / DAG 宽度两条对抗信道未建模）。

## 1 · 钉坐标（全 `git show 7b1e18cc:`，别信自报）
| 量 | 值 | 坐标 @7b1e18cc |
|---|---|---|
| 难度算法主体 | KIP-0004 sampled `calculate_difficulty_bits` | `consensus/src/processes/difficulty.rs:216-247` |
| 公式 | `new_target = avg_target × measured_duration / expected_duration`；`expected = TPB × sample_rate × (len−1)`；min-ts 样本先剔除再平均；`< min_window ⇒ 难度恒定` | difficulty.rs:236-246（`:239 swap_remove(min)`、`:243 expected`、`:244 new_target`）；`:219-228` 固定难度分支 |
| `target_time_per_block` | 100 ms（10 BPS）| `config/bps.rs:49-53 = 1000 / BPS` |
| `difficulty_sample_rate` | 40（=BPS×4）| `config/bps.rs:115 = BPS × DIFFICULTY_WINDOW_SAMPLE_INTERVAL` |
| 采样窗 | 661 样本 = `2641.div_ceil(4)` | `config/constants.rs:57 DIFFICULTY_WINDOW_DURATION=2641`、`:60 SAMPLE_INTERVAL=4`、`:63 SAMPLED_WINDOW_SIZE` |
| 完整窗 | 26,440 块 = 661×40 | difficulty.rs:187 `difficulty_full_window_size = window_size × sample_rate` |
| 固定难度期 | <150 样本恒定 | `config/constants.rs:54 MIN_DIFFICULTY_WINDOW_SIZE=150`（注释自证"10 min fixed difficulty"）；difficulty.rs:219 `< min_difficulty_window_size` |
| DAA 递增 | `sp_daa + (mergeset_size − mergeset_non_daa)` | difficulty.rs:31-34 `internal_calc_daa_score`（🔴 DAG mergeset，见 §5 未覆盖）|
| 时间戳容差 | `TIMESTAMP_DEVIATION_TOLERANCE`（有界非无界）| `config/params.rs:702`（TESTNET12）→ `config/constants.rs`（见 §5 时间戳信道）|

## 2 · 模型（如何映射到公式）
- 归一：`target_rel = target/D0`（稳态 1）；`block_time_ms = 100 / (H_rel × target_rel)`（块率 ∝ H×target 概率）。稳态 `H_rel=1, target_rel=1 ⇒ 100ms/块 = 10 BPS`，且公式不动点 `new_target=1`（脚本 warm-up 已验：满窗全 1 ⇒ measured=expected ⇒ target 1）。
- 注入：`t<t0` `H_rel=1`；`t≥t0` `H_rel=k`（首动方在 O 创建后 t0 拉高算力）。瞬时块率 →`k×10 BPS`（难度未动），随窗填入快块 measured↓ ⇒ new_target↓（难度↑）⇒ 块率回落，`target_rel→1/k` 时回 10 BPS。
- 难度每 40 块（一个新样本）步进一次（样本间窗不变、难度不变，忠实源码"每块用当前窗算、窗每 40 块变"）。
- **`B_win(k) = 渐近超量 = lim(实际DAA − 基线DAA) = 瞬态期比 10/s 多挤出的块数**（回稳后两者同速、超量成常数 = 永久 DAA 领先）。覆盖到 W_dis：`DAA_during_Wdis = 10/s × W_dis + B_win`（v0.5 §3-C 形式）。W_dis=5,460s，瞬态 26,440 块即便 @10 BPS 也仅 2,644s < W_dis ⇒ 瞬态总在 W_dis 内完成，取渐近超量正确。

## 3 · 结果：`B_win(k)` 稳态曲线（§6 闸已过）
| k | `B_win`（渐近超量 DAA）| 峰值超量 | 回稳块 | 对照粗上界 26,440×(1−1/k) |
|---|---|---|---|---|
| 1.0 | 0 | 0 | — | 0 |
| 1.5 | 5,116 | 5,116 | 33,241 | 8,813 |
| 2 | 8,472 | 8,472 | 41,361 | 13,220 |
| 3 | 12,858 | 12,858 | 45,561 | 17,627 |
| 5 | 17,883 | 17,883 | 48,681 | 21,152 |
| 10 | 23,959 | 23,959 | 60,041 | 23,796 |

- **单调递增于 k**（脚本自检 `monotonic=true`）；**渐近有界**：k→∞ 时 `B_win → 26,440`（至多领先一个完整窗——难度滞后一个窗，超量不可能超过一窗）。
- 粗上界（"整窗 × 速比"）与仿真同量级、仿真多数低于它（k=10 处两者贴合），交叉验证模型无量级错。
- 峰值=渐近（单调逼近、无过冲）⇒ 该模型下无"先超后回"的额外峰。

## 4 · 固定难度期（<150 样本）：无界 → §6 必须禁用
- 难度恒定 ⇒ 注入 `×k` 期间块率恒 `k×10 BPS`，无难度回推。
- **`excess_DAA = (k−1) × 10/s × T_fixed_remaining`**（∝ k、∝ 时长，**无界**）。例：k=10、T=600s（≈150 样本期）⇒ 54,000 DAA，且任何更长的 pin 线性增长。
- ⇒ 固定 N 盖不住 ⇒ **v0.5 §6 的"固定难度期禁用 Tier-2"是唯一正解**（入场闸 `virtualDaaScore − DAA_at_genesis ≥ 26,440`），本仿真是它的量化依据。

## 5 · 假设 / 简化 / **没覆盖什么**（诚实边界，承重）
🔴 **本仿真给的是【串行链 + 诚实时间戳 + 确定性块时】下的 `B_win(k)`，= 对抗真值的【下界】，不是上界。** 三条未建模的对抗信道都只会**加大**真值：
1. **DAG 宽度 / 并行块（未建模，可能最大）**：DAA = mergeset blue count（difficulty.rs:31-34），不是串行块数。首动方产**并行**块可让 mergeset 单步跳增 ⇒ DAA 推进快于串行块率。本模型串行链 ⇒ **系统性低估**。这条须单独建模或以信任假设封（"首动方 DAG 宽度 ≤ X"）。
2. **时间戳操纵（consensus 有界但非零）**：公式用 `max_ts − min_ts`（块时间戳），矿工可在 `TIMESTAMP_DEVIATION_TOLERANCE`（params.rs:702）内把 measured_duration 撑大 ⇒ new_target 偏大 ⇒ 难度保持偏低更久 ⇒ 超量更大。本模型用诚实到达时刻。该信道被 consensus 容差**上界**（不是无界，容差远小于 44min 窗 ⇒ 有限乘数），但**非零**，须在 v0.2 量化。
3. **Poisson 块时方差（未建模）**：本模型确定性均值；真实块时指数分布，短时爆发可再加一点。经 660 样本平均后大半抹平，尾部残留小。
- 其它简化：单矿工=全网算力（TN12 实况，对；多矿工下 k 的语义变"注入 / 总"）；难度每 40 块步进（忠实）；忽略 `max_difficulty_target` clamp（注入是变难方向、不触及最易 clamp，不影响）。

## 6 · 交付判词
- **`B_win(k)` 稳态曲线已给**（§3 表 + 单调 + 有界 26,440），**固定难度期无界公式已给**（§4，佐证 §6 闸），**串行/诚实模型下 v0.5 占位 55,200 对 k≤10 保守**（sim k=10 = 23,959 < 55,200）。
- 🔴 **但不能就此宣布 55,200 是已证上界**：真·对抗 `B_win` ≥ 本仿真值（时间戳 + DAG 宽度未封）。**要把 `B_win` 从占位变定值，除 k 外还须两条信任假设或建模**：(a) DAG 宽度界、(b) 时间戳诚实/容差量化。本稿把"该量什么、模型给到哪、缺哪两条"钉死。
- **k 仍是 Owner/Codex 的信任假设**：给定 k（且给定 DAG 宽度界与时间戳假设），`B_win` 可由本脚本 + 两补建模算出定值；本稿不拍 k。
- **保守方向**：`B_win` 取大 ⇒ M_observe 取大 ⇒ recovery 更晚开 = 只损活性、无安全损失 ⇒ 定值时"仿真下界 → 上调到含 (a)(b) 的封套"只准增不准减。
- J2 反向红队请打：① 模型对 difficulty.rs:236-246 的忠实度（尤其 min-ts 剔除 + expected 用 len−1）；② §5 三条未覆盖里 DAG 宽度是否被我低估了严重性；③ 固定难度期公式的 T_fixed 起算点。
