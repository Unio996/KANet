# Tier-2 算力地板量法规格 v0.2（吸收 J2 五条反向红队 · SUPERSEDES v0.1）

> **Status**: DESIGN v0.2 · NWT 2026-08-27 · SUPERSEDES v0.1（c1d05ec0）· J2 反向红队五条**我认四、②机制纠正**。设计层无节点，数 PLACEHOLDER。
> **一句话（改）**：🔴 **v0.1 的主premise错——链上量的是【总】算力，分不出对手份额；我把它叫"诚实地板"是【未挣得的标签】（J2 ①）。** v0.2 拆成：量【总算力地板】`H_floor_total`（客观）+ **独立信任假设 `s_adv`（对手份额上限）** ⇒ `H_floor_honest = H_floor_total×(1−s_adv)`。**在无算力归属的网络（现 TN12 单/寡矿工、coinbase 可 Sybil），`s_adv` 无法上界 ⇒ 诚实地板无法测 ⇒ Tier-2 fail-closed，与数值无关。本规格真正有用在【有独立矿工】的未来网络。**

## 0 · 认 J2 五条（独立核过，四认一纠）
- 🔴 **① 认（根本）**：法1/法2 量**总**算力（tip bits / Δblue_work），公开链数据**无法归属**哪份是对手（除 coinbase 地址，Sybil 分址即绕、单矿工恒 0）。⇒ `k_max=1+H_adv/H_floor` 把 `H_floor` 当"对手之外算力"用是错的——**TN12 上现网算力=我们矿机，对手若是矿机持有者，地板就是对手自己的卡**；对手一台 KS3M 正常挖满 T_win（p10/坑闸/R_vol 全过、H_floor≈H_adv）→ 入场 → 不需撤（已是难度基准）→ 真杀招是**审查**（唯一矿工不打包 claim）非 pump。我 v0.1 的窗口/滞回只压瞬时尖峰伪造（那点对），**压不了"对手=地板本身"**。**这是 green-light-carries-no-information 族——一个含对手在内的地板对"诚实防御有多少"零信息。全认。**
- 🟡 **② 认弱点、纠机制**：撤算力期两法偏高滞后**成立**——但**机制不是 J2 说的"法2 是块计窗"**：法2 实**用时间戳跨度**（`window_duration=(max_ts−min_ts)/1000`，`difficulty.rs:58` 我实读），窗**按块数选**(≥1000)但速率=blue_work/时间戳跨度。⇒ 是**窗内容陈旧滞后**（撤后旧快块要 ~1000 块才 flush 出窗，其间估值随时间戳跨度增长**渐降**非"维持旧值突降"），滞后量级 ~窗flush（d=100 ⇒ ~2.8h）对。**修法采纳**：加**法3=瞬时**（墙钟分钟内出块数×当前难度），`min(法1,法2,法3)`；上升期两法偏低=安全向、红块功不计=偏低安全向（J2 对）。
- ✅ **③ 认**：慢降绕过是 ① 子集，绝对阈 `H_floor_min` 兜底，修 ① 即覆盖。
- 🔴 **④ 认（升 MUST）**：N 开仓烤死、反应方入场那刻按当时 H_floor/k_max 押本金、入场后 fail-closed 只挡新仓 ⇒ forge-withdraw 全部伤害落已入场者。v0.1 §5"三问不拍"**升级**：**入场前必答 + 写进反应方入场披露**（k_baked / H_floor 采样 / H_adv / s_adv / 在飞期不受再量保护）；政策选项 Owner 拍，**但披露是 MUST**。
- ✅ **⑤ 认**：k_max=1000 ⇒ H_floor≥H_adv/999：KS3M 6e12⇒≥6e9=3×4090；KS5Pro 2.1e13⇒≥2.1e10=10.5×；现网 2–4e9<6e9 ⇒ 承认对手买得起一台入门 ASIC 即过不了。**结论上前置**（§6）。

## 1 · 估计器 `min(法1, 法2, 法3)`（②加法3）
| 法 | 公式 | 坐标 @7b1e18cc | 性质 |
|---|---|---|---|
| 法1 | `calc_work(tip.bits)×BPS` | `difficulty.rs:261`；`math/lib.rs:64`；`config/params.rs:689` | 陈难度、撤后滞后 |
| 法2 | `Δblue_work/window_duration`，`window_duration=(max_ts−min_ts)/1000`（时间戳跨度秒），窗≥1000 块 | `difficulty.rs:46-66`（`MAX_SAFE_WINDOW_SIZE=10,000` @`rpc/core/src/api/rpc.rs:16`，我核；`service.rs:954` 有判）| 时间戳分母但窗内容陈旧滞后 |
| **法3（新）** | 墙钟窗（如 60s）内**出块数 × 当前 target 的 work_per_block** = 瞬时算力 | 同 calc_work + 墙钟计块 | 抓撤算力最快，最少滞后 |
- 取 `min(三者)`：保守=不高估总算力（不高估攻击成本）。三者滞后特性不同，min 取最先反映下降的。

## 2 · 窗口：墙钟（估计器内部也须墙钟，非块选陈旧）
- 外层采样墙钟窗 `T_win`（数小时–天）+ 采样间隔（数分钟）；🔴 **v0.2 补（②）：估计器内部亦须墙钟锚定**——法2 用时间戳跨度（已是）、法3 用墙钟窗，**不靠"最近 N 块"的块选窗**（撤后陈旧）。DAA-count 窗被 pump 压缩的纪律（v0.1）保留。

## 3 · "稳定"判据（三闸，作用于【总】算力）
- (a) 样本充分（`≥N_min` ∧ 覆盖 `≥T_win`）；(b) 地板取 **p10**（非均值/max）；(c) 无深坑（连续子窗 `<p10×f_dip`）+ 波动封顶 `p90/p10≤R_vol`。p10 与坑闸两道缺一 vacuous。
- 🔴 **但这三闸只保证"总算力稳定"，不保证"诚实"**——见 §3.5。

## 3.5 · 🔴 诚实份额（J2 ① 的结构修复）
- **`H_floor_honest = H_floor_total × (1 − s_adv)`**，`s_adv` = **Owner 信任假设**（对手占网络算力份额上限）。
- **`s_adv` 怎么来（三条，Owner 选，本稿不拍）**：
  - (i) **纯假设**：Owner 直接给 `s_adv`（如"对手 ≤ 网络 20%"）——在**有独立矿工的网络**才有意义；
  - (ii) **coinbase 归属 + 集中度**（同 (e) quorum 口径）：按 coinbase 收款地址算矿工集中度（HHI/最大单矿工份额）；🔴 **Sybil 分址可绕**（一个矿工用多地址伪装分散）+ **单矿工网络恒 = 1 个地址 ⇒ 集中度 100% ⇒ `s_adv`→1**；
  - (iii) **无法定 `s_adv` ⇒ `H_floor_honest`→0 ⇒ fail-closed**（现 TN12 = 此支）。
- ⇒ **地板规格的可用性【条件于网络有可归属的独立矿工】**；单/寡矿工网络上 `s_adv` 无可信上界 ⇒ 诚实地板不可测。

## 4 · `k_max` = 1 + H_adv / **H_floor_honest**（用诚实份额，非总）
- `H_adv` = Owner 对抗预算；`H_floor_honest` = §3.5（总 × (1−s_adv)）；`k_max = 1 + H_adv/H_floor_honest` 推。
- 闭环入场：`k_max ≤ k_baked` ⇔ `H_floor_honest ≥ H_adv/(k_baked−1) = H_floor_min`；量得 `<H_floor_min` ⇒ fail-closed。（`k_baked` 由 baked N + 我 B_win 曲线定。）

## 5 · fail-closed + 🔴 已开仓入场前披露（④升 MUST）
- 连续再量 `H_floor_honest`；触发 `<H_floor_min`；滞回两阈（入场 `≥×(1+m_up)` 整窗 / 退出 `<×(1−m_down)` 持 `T_dwell`）；恢复须全新完整稳定窗。
- 🔴 **已开仓（v0.2 升 MUST）**：链上 N 开仓烤死、再量不保护在飞头寸 ⇒ **入场前必向反应方披露**：{`k_baked`、入场 `H_floor_honest` 采样、`H_adv`、`s_adv` 假设、**在飞期不受再量保护、承担开仓时风险**}。政策（是否加"跌破⇒在飞加速结算"）Owner 拍；**披露本身是 MUST**（反应方按知情押本金）。J2 倾向"接受在飞担开仓风险 + 短 covenant 窗"。

## 6 · 🔴 底线（结论上前置，⑤）
- **现 TN12（单/寡矿工、GPU 级 2–4e9、coinbase 不可信归属）：`s_adv`→1 ⇒ `H_floor_honest`→0 ⇒ 无论数值怎么定，Tier-2 = fail-closed / 实验-only。** 这不是保守，是"诚实地板在此类网络不可测"的直接推论。
- **本规格真正有用 = 未来有【独立、可归属、去中心】矿工的网络**（那时 `s_adv` 有可信上界，地板才承重）。与北极星"等网络有可信算力地板否则 Tier-2 禁用/实验"（Codex）一致。

## 7 · 谁量 / 第三方可复核 / 证据（不变，强化）
- 🔴 **第三方可复核**：`H_floor_total`（+法3）全输入是公开链数据 ⇒ 反应方/watchtower **自己重算**，非 operator 自证。**但 `s_adv` 是 Owner 假设不是链上量** ⇒ 披露里须**明标 `s_adv` 是假设、其依据**（(i)/(ii)/(iii)），第三方能复核"总算力"但**必须自己判 `s_adv` 假设可信否**。
- provenance 证据落点同 v0.1（入场决策 artifact + 连续再量），加 `s_adv` 及其依据、法3 读数。

## 8 · 未决 / 边界（不变 + 新）
- 全数值 PLACEHOLDER；`s_adv` 上界法（(i)/(ii)/(iii)）+ 值 = Owner 决策项。
- 审查信道（唯一/多数矿工不打包）仍 out-of-model（bounded-inclusion，Codex）——**且 J2 ① 点明现 TN12 单矿工下审查才是真杀招、非 pump**；本规格只管 pump 侧 k_max，审查须另路（协议层去中心矿工 / 北极星）。
- 已开仓政策 = Owner/Codex（§5，披露 MUST、策略选项开放）。
