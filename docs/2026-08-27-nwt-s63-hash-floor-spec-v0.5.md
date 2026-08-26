# Tier-2 算力地板量法规格 v0.5（Codex f65c1fbe 两 MUST-FIX · SUPERSEDES v0.4）

> **Status**: DESIGN v0.5 · NWT 2026-08-27 · SUPERSEDES v0.4（a4dd959f）· Codex MSG-275/276（f65c1fbe）裁：payload 归属 PASS（Codex 亲核 coinbase.rs 偏移）、单矿工 fail-closed PASS；**两 MUST-FIX**：① `s_adv:=max(s_owner,s_max)` 语义 REJECTED；② 法3 "W/132s" 方向错。本版只改这两处 + 采纳"提取器须入库+确定性向量"（派 J2）。**§3(a-c)/§4/§5/§6/§7/§8 余同 v0.4。**

## MUST-FIX ① 诚实份额语义重做（Codex：`max(s_owner,s_max)` 不成立）
🔴 **Codex 判**：要 `H_floor_honest` 是**保守下界**，须 `s_adv ≥ 真实对手份额`。而 `s_max`（最大可见挖矿身份份额）一般是对手集中的**下界**（Sybil 多 spk、多个可见矿工共谋都让它偏小）⇒ **不能只减 `s_max` 就称余下为诚实下界**。v0.4 的 `s_adv:=max(s_owner,s_max)` 让 `s_max` 可能成操作值 = 把一个**下界**当**上界**用 = 错。

**重做（两个量分开，别混）**：
| 量 | 是什么 | 性质 | 来源 |
|---|---|---|---|
| **`s_visible_max`** | 窗内最大可见挖矿身份份额（= v0.4 的 `s_max`，coinbase payload `miner_data.script_public_key` 逐块归属，v0.4 §3.5/坐标不变）| 🔴 **对手集中的【下界】+ 集中告警信号**——**不是**上界 | 客观、链上可复核（公开 coinbase 数据）|
| **`s_adv_cap`** | 总对手（含**共谋 + Sybil**）份额的**上界** | 🔴 **独立论证的信任假设**（非从 `s_visible_max` 算）| 论证依据见下 |
- **约束**：`s_adv_cap ≥ s_visible_max`（上界至少盖住可见集中；`s_visible_max` 是对 `s_adv_cap` 可信度的**下界校验**：若有人给的 cap < 可见集中，直接否）。
- **诚实下界**：`H_floor_honest_lb = H_floor_total_lb × (1 − s_adv_cap)`（用 cap 不用 s_visible_max）。
- 🔴 **无可信 `s_adv_cap` ⇒ Tier-2 fail-closed，不许静默拿 `s_visible_max` 顶**（那是拿下界当上界）。
- **`s_adv_cap` 谁论证 / 依据类型（Owner/Codex 域，本稿列不拍）**：
  - (a) **有身份归属的矿工集**（KYC 池运营方 / 许可矿工集 / 已证独立的 vantage）⇒ 可从"已知独立方之外的最大可能共谋"论证一个 < 1 的 `s_adv_cap`；
  - (b) **开放匿名矿工网络**（现 TN12）⇒ **任何子集可共谋 / Sybil，`s_adv_cap` 无法可信压到 1 以下** ⇒ **fail-closed**。⇒ **`s_adv_cap < 1` 的可信论证【需要挖矿身份的独立性证据】，而那是链上匿名 PoW 给不了的**——这就是为什么现网（及任何匿名开放矿工网）Tier-2 结构性 fail-closed，不止单矿工退化情形。
- **单矿工退化仍正确**：`s_visible_max=1 ⇒ s_adv_cap ≥ 1 ⇒ H_floor_honest_lb=0 ⇒ fail-closed`。**但多可见身份网络【不能】仅凭 `s_visible_max<1` 证安全**（共谋/Sybil 未排除）——须独立 `s_adv_cap`。

## MUST-FIX ② 法3 偏差推导（替换 v0.3/v0.4 的 "W/132s"）
🔴 **Codex 判**："`W/132s` = 戳操纵放大上界" 与 "W 越大越稀释" 方向不一致；且不能只靠量纲，须按共识戳规则 + 对手出块模式推导 `H_floor_total` 的**最大向上偏差**（危险方向 = 高估总算力）。

**推导（法3 = 窗 `[t−W,t]` 内按块时间戳落窗的块数 × 当前 work_per_block）**：
- 对手要**高估** `H_floor_total`（抬地板）⇒ 让**更多块**的时间戳落进 `[t−W,t]`（实际在窗外产的块塞进来）。
- **低边界塞入**：真实时间在 `[t−W−132s, t−W)` 产的块，可用 **+132s 未来戳**（`pre_ghostdag_validation.rs:40-42`，`TIMESTAMP_DEVIATION_TOLERANCE=132`）把戳推到 `≥ t−W` ⇒ 进窗。⇒ 最多多塞 **`132s × R` 块**（`R` = 真实出块率）。
- **高边界**：`t` 侧要塞入需**过去戳**（把 t 之后的块戳到 t 前），受 PMT 约束（`post_pow_validation.rs:23`）、余量小，取零保守忽略（只算低边界）。
- ⇒ **绝对上偏 ≤ `132s × R` 块**；**相对上偏 ≤ `(132×R)/(W×R) = 132/W`**（**不是 `W/132`——v0.3/v0.4 写反了**；`W` 越大 `132/W` 越小 = 稀释，方向现在一致）。
- **估计器单位的最大向上偏差**：`H_floor_total(法3)` 最坏高估因子 = `1 + 132/W` ⇒ **保守取 `H_floor_total_lb(法3) = 法3_raw / (1 + 132/W)`**（把最大戳塞入偏差折掉，得下界）。
- **W 定尺（新判据）**：要法3 能抓到 fraction `f_detect` 的撤算力（法3 的用途 = 快抓撤），须 `132/W < f_detect` ⇒ **`W > 132 / f_detect`**（如抓 50% 撤 ⇒ `W > 264s`；抓 10% ⇒ `W > 1320s`）。⇒ **W 不是拍脑袋，由"要抓多小的撤"定**。
- 🔵 **min(法1,法2,法3) 对法3-inflation 的部分防护 + 残余**：min 取最小 ⇒ 单纯抬高法3 不成为 min、不抬地板；**但若对手【撤算力后】用戳塞入把法3 抬回**（掩盖撤），min 会被这个假法3 骗——所以 `132/W < f_detect` 的 W 定尺**必须**，不能只靠 min。法1/法2（难度基）的戳偏差是 B_win 那套（+132s 一次性，占难度窗极小份额，见 sim v0.2），更难 inflate。

## 采纳（Codex 其余，非本稿改码）
- 🔴 **`s_visible_max` 提取器脚本仍 gitignored ⇒ 不算证据**：须入库 provenance + **确定性测试向量**（genesis coinbase 等已知 payload → 已知归属）——**Codex 派 J2**（(24) 提取器同办，同 (22) bwin-sim durable 惯例）。本稿 §7 复核路径不变（payload 解析），加"提取器入库 + 向量"待 J2。
- ✅ completeness 锚独立观测：(24) v0.3 已用 `daaScore` 差（非自身 fetch 反推）——Codex 认可。
- (527) 维持、手工签发默认——不影响本稿（本稿是未来 (b)-实现的入场闸设计）。

## 未变（同 v0.4 a4dd959f / v0.3）
§1 估计器 min(法1,法2,法3)（法3 定义 [t−W,t] 块时间戳窗；**偏差折算见上 MUST-FIX ②**）；§2 墙钟窗；§3(a)(b)(c) 三闸 + R_vol 纳 Poisson；§3.5 `s_visible_max` 逐块 payload 归属（坐标 coinbase.rs:158-163 同 v0.4，Codex 亲核）；§4 `k_max`（用 `H_floor_honest_lb` = total_lb×(1−s_adv_cap)）；§5 fail-closed + 已开仓入场前披露 MUST（披露加 `s_adv_cap` 及其论证依据、`s_visible_max` 采样）；§6 底线 = 机制输出（现网/匿名开放网 ⇒ 无可信 s_adv_cap ⇒ fail-closed）；§7 第三方复核（total 与 s_visible_max 客观可复核；s_adv_cap 是假设须披露依据）；§8 未决。
