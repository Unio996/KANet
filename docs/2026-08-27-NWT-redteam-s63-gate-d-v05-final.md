# NWT 红队 — §6-3 gate (d) v0.5 终核

> 作者 NWT · 2026-08-27 · 被审 = `docs/2026-08-27-j2-s63-gate-d-conservative-bounds-v0.1.md` **`289af371`**（v0.5，未推）
> 前序：v0.1 GREEN-WITH-NOTES(4a486b5b) → Codex D-1/D-2 打中我"吸收论"(88d8a57f) → v0.3/v0.4 → 我四 MUST + 路径修 → v0.5。本文终核：四 MUST 落齐 + Bettor 点名三处自报项实核。
> **总评：四 MUST + `config/` 路径修全落；三自报项（26,440 算法 + 坐标 / S_unalloc 尺寸规则 / k 信任假设）我独立核过、成立；数值全自标 PROVISIONAL-PLACEHOLDER、部署闸全 fail-closed = GREEN（设计/证据层）。** 一处 §6 措辞微瑕，不阻塞。

## 1 · 四 MUST + 路径修落点核（HEAD 289af371）
| MUST(我 v0.3→v0.5 给) | v0.5 落点 | 核 |
|---|---|---|
| ① B_win 删"实测"、只准仿真/具名信任假设 | L140「B_win 不由观测定」+ (a)对抗算力阶跃仿真 /(b)具名信任假设；§5② 参考节点列**只校 W_dis + sanity，不定 B_win** | ✅ |
| ② 威胁模型 first-mover-with-mining | L142 显式：DAA 加速非网络方差、是首动方可控攻击（走快⇒recovery 墙钟更早开⇒首动方受益；单矿工 TN12 首动方=矿工/共谋）| ✅ |
| ③ §6 固定难度期 Tier-2 禁用（可 enforce） | L194 规则：入场前 `virtualDaaScore − DAA_at_(genesis∨fork) ≥ 26,440`，否则拒 | ✅（算法见 2）|
| ④ S_unalloc 尺寸挂 §5① 散度 | L136：`max(p100−p50, k·σ)` k=3；2× 仅兑现前声明占位、"2"无导出依据 | ✅ |
| ⑤ constants 带 `config/` 前缀 | L3/L141/L194 全 `config/constants.rs`；且点名 `consensus/core/src/constants.rs:57`=UNACCEPTED_DAA_SCORE 不是难度窗（E4 同族陷阱写进稿）| ✅ |

## 2 · Bettor 点名三自报项——独立实核（没信自报，全 `git show 7b1e18cc:`）
### 2.1 §6 入场判据 26,440 的算法 + 坐标 —— ✅ 逐项验过
- `DIFFICULTY_SAMPLED_WINDOW_SIZE = DIFFICULTY_WINDOW_DURATION(2641).div_ceil(DIFFICULTY_WINDOW_SAMPLE_INTERVAL=4)` = ⌈660.25⌉ = **661**（`config/constants.rs:57/60/63` 实读）。
- `difficulty_adjustment_sample_rate() = BPS × DIFFICULTY_WINDOW_SAMPLE_INTERVAL = 10 × 4 = **40**`（`config/bps.rs:115` 实读，函数体 `BPS * DIFFICULTY_WINDOW_SAMPLE_INTERVAL`）。
- **661 × 40 = 26,440** ✅。坐标 `config/params.rs:693-694` = `crescendo_activation: always()` / `covenants_activation: always()` ✅（我读 :691-696）。
- **语义成立**：满 661 样本窗 = 难度已按完整窗调整 ⇒ 出块率受难度封顶 ⇒ DAA 推进有界。**比真·固定难度期（150 样本=6,000 DAA，常量注释自证"10 min fixed difficulty"）保守 ~4.4×**——安全方向（多等=只损活性），J2 明标"比 150 保守"。live TN12（virtualDaaScore≈8e7、genesis≈0）此闸满足 ~3000×＝现网惰性、只对新网/重置生效，J2 "重置时自动重新生效"对。
- 🔵 **措辞微瑕（不阻塞）**：`DAA_at_(genesis ∨ 最近 fork activation)` 里"fork activation"略松——难度采样窗**不因 always() 软 fork 重置**，只因**网络 genesis/重启**或 **BPS-改变的 fork** 重置；TN12 crescendo/covenants 全 always() ⇒ 无链中 BPS 变 ⇒ 只对 genesis 起算，J2 的 TN12 结论对。建议措辞收成"genesis ∨ 最近 **BPS-改变** fork"。纯精度，操作结论无误。

### 2.2 S_unalloc 尺寸规则 = §5① ≥30 笔 max(p100−p50, 3σ) —— ✅ 成立
- L136 正是我 value-add 4 的落地：尺寸由**实测散度**定，非固定 2×；`max(range, 3σ)` 是合理保守散度估计；自动随 N_claim 缩放（大 claim span ⇒ 大模型误差预算）合理；"2× 是占位、'2' 无锚"如实标。与 §5① 硬前置咬合（未跑完 Tier-2 不进真金）。

### 2.3 §7 k（首动方可动员算力比）= 待 Owner/Codex 的信任假设、不自拍 —— ✅ 姿态正确
- L204 明写"k 是一条待 Owner/Codex 给的信任假设,本稿不拍"。**对**：k 是威胁模型参数（首动方能动员多少算力），不是 J2 能挑的数。B_win = f(k, 难度算法)，k 定则 B_win 可由仿真算出。这正是 Codex 要的"证明有效不是数够大"。

## 3 · 终 verdict
- **§6-3 gate (d) v0.5（289af371）= GREEN（设计/证据层，零落码）。** 四 MUST + 路径修全落；26,440 算法与坐标我逐项 `git show 7b1e18cc:` 验过（661×40，config/constants.rs + config/bps.rs + config/params.rs:693-694）；S_unalloc 尺寸挂实测散度；k 作信任假设不自拍。**数值全自标 PROVISIONAL-PLACEHOLDER，部署闸全 fail-closed**（§5① 硬前置 / B_win 仿真或具名假设 / §6 固定难度期禁用 / S_unalloc 待散度 / §5② 参考节点重采）。
- **GREEN 边界**：= 设计闭合、"该量什么/怎么量/取值规则/保守方向/威胁模型"钉死；**≠ 数值定稿**（B_win 无仿真/k、N_claim n=1、S_unalloc 占位、W_dis 是坏节点数）、**≠ 执行**。(d) 仍 OPEN/PROVISIONAL（Codex 口径），升级前须跑 §5①/§5② + 定 B_win 的 k + P3 形状。
- **一处措辞微瑕**（§6 "fork activation"→"BPS-改变 fork"），落码/交 Codex 时顺手收，不阻塞推送。
- **回 Bettor**：三自报项都实核成立，GREEN，推八条 + MSG-273 请 Codex 收 (d)。watchtower 多重架构问题（§7，payout 不可重定向已结构满足 @L135+@L289-290，收窄到故障域独立一条）建议随 MSG-273 单列给 Owner/Codex 定方向。
