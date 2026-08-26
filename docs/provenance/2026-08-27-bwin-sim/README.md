# B_win(k) 仿真 — durable 源 + 证据（Codex MSG-274 MUST）

> 作者 NWT · 2026-08-27 · 派工 Bettor (22) · 应 Codex `RESPONSE-20260827-MSG273-MSG274`（eb4db39c）："B_win 数值曲线 OPEN——load-bearing scripts are gitignored; a reported table is not a substitute for the source"。本目录把两支仿真从 `scratch/`（gitignored）入库为**可复现、可校验**的 durable 源。
> 用途：§6-3 gate (d) 的 `M_observe` 里 `B_win`（首动方=矿工注入 ×k 算力时，网络 DAA 相对 10/s 基线的超量）。结论：**DAA-pump 有界 = f(k)**（未来戳封 +132 s），占位 55,200 ⟺ 信任假设 `k_max ≲ 1000`。

## 文件
| 文件 | 用途 | sha256 |
|---|---|---|
| `bwin-sim-honest.mjs` | 诚实时间戳模型（戳=真实到达）| `846a9c978ee88d443a4fab1e3750af74ad100a2821bc50f59c172616eeba8e09` |
| `bwin-sim-adversarial.mjs` | 对抗时间戳（攻击者按 +132 s 上限给未来戳压难度）+ 无界性判决 + extreme-k | `820cc78dab62f93045c92d19fef2b04e04e60c07b778bcf9650780b556fa8e2f` |
| `output-honest.txt` | 上者实际输出 | `d9e5972c0a38fd02772487e9c1b016b6d7036e5351634ef456697d4828acfb23` |
| `output-adversarial.txt` | 下者实际输出 | `b03279af0dd94cbe65f34ab04c9aecdedc78b8d5a5a362bf9348c8f14defb24e` |

## 运行（复现）
```bash
cd /d/kanet-tn12
node docs/provenance/2026-08-27-bwin-sim/bwin-sim-honest.mjs
node docs/provenance/2026-08-27-bwin-sim/bwin-sim-adversarial.mjs
# 逐字应等于 output-*.txt；校验: sha256sum 上表
```
- **确定性**：零 `Date.now`/`Math.random`（都被 harness 禁），纯确定性浮点→`toFixed(0)` 取整。整数结果跨 node 版本稳定。
- 生成环境：`node v24.14.1`（float 格式化用；整数栏与版本无关）。

## 参数集（全部锚 rusty-kaspa **live 二进制 commit `7b1e18cc`**，`git show 7b1e18cc:<path>`，非工作树 `90dbf074`）
| 脚本常量 | 值 | 语义 | 7b1e18cc 坐标 |
|---|---|---|---|
| `TPB` | 100 ms | target_time_per_block = 1000/BPS | `config/bps.rs:49-53` |
| `BPS` | 10 | TenBps | `config/params.rs:689-691 TESTNET12_PARAMS` |
| `SR` | 40 | difficulty_sample_rate = BPS×DIFFICULTY_WINDOW_SAMPLE_INTERVAL(4) | `config/bps.rs:115` + `config/constants.rs:60` |
| `WIN` | 661 | DIFFICULTY_SAMPLED_WINDOW_SIZE = ⌈2641/4⌉ | `config/constants.rs:57,60,63` |
| `MIN` | 150 | MIN_DIFFICULTY_WINDOW_SIZE（<此难度恒定=固定期）| `config/constants.rs:54` |
| `TOL_MS` | 132000 | TIMESTAMP_DEVIATION_TOLERANCE(132 s)×1000（未来戳硬封）| `config/constants.rs:23` |
| 难度公式 | `new_target = avg_target × measured/expected`；`expected = TPB×SR×(len−1)`；min-ts 样本先剔除再平均；`<MIN` 恒定 | KIP-0004 sampled | `consensus/src/processes/difficulty.rs:216-247`（:244 主式）|
| 未来戳封 | `stamp > unix_now()+TOL ⇒ TimeTooFarIntoTheFuture` | 按**接收方**墙钟判 | `consensus/src/pipeline/header_processor/pre_ghostdag_validation.rs:40-42` |

**模型映射**：`block_time_ms = TPB/(H_rel × target_rel)`（块率 ∝ H×target 概率）；稳态 `H_rel=target_rel=1 ⇒ 100 ms/块 = 10 BPS`，公式不动点 `new_target=1`。注入：`t≥t0` `H_rel=k`。难度每 40 块（一新样本）步进（忠实源码"每块用当前窗算、窗每 40 块变"）。`B_win = 渐近超量 = lim(实际DAA − t/TPB)`。

## 期望输出（关键行）
### 诚实模型（`output-honest.txt`）
| k | B_win（渐近 DAA）| 渐近上界 26,440×(1−1/k) |
|---|---|---|
| 1.0 | 0 | 0 |
| 2 | 8,472 | 13,220 |
| 10 | 23,959 | 23,796 |
- 单调；k→∞ 渐近 ≤ 26,440（难度至多滞后一整窗）。固定难度期（<150 样本）无界公式 `(k−1)×10/s×T` 亦在输出（v0.2 已按 DAA 计更正为 ≤6,000×(1−1/k) 有界，见 sim v0.2 §1③）。

### 对抗模型（`output-adversarial.txt`）—— 承重
| k | B_win_adv（渐近 DAA）| 收敛(@8win==@16win) | <55,200 |
|---|---|---|---|
| 10 | 25,279 | ✅ | ✅ |
| 100 | 41,236 | ✅ | ✅ |
| 1000 | 53,070 | ✅ | ✅ |
| 1,000,000 | 75,749 | ✅ | ❌ |
- 🔴 **无界性判决实验**：k=10 plateau 在 2×/4×/8×/16× 窗 = 25,108→25,279→25,279→25,279 ⇒ **不随时长增长 = 有界**（未来戳封住）。诚实↔对抗恒差 **+1,320 = 132 s×10/s**（未来预算一次性，坐实机制）。
- **占位 55,200 ⟺ `k_max ≲ 1000`**。界随 k 对数缓增。

## 承重论证（守恒，非仅靠上表）
"任一诚实节点收块时 `stamp − 其 unix_now ≤ 132 s`（pre_ghostdag_validation.rs:40-42 按接收方墙钟判）⇒ 已发布进诚实 DAG 的链，采样窗能表示的 stamp-elapsed ≤ 真实 elapsed + 132 s ⇒ 长期 claimed 块率 = 真实块率 ⇒ 真实块率被难度钉回 10/s。" ⇒ 超量 = 一次性 132 s×10/s + 难度滞后一窗瞬态 f(k)。**上表是这条守恒的数值佐证，不是论证本身。** 三攻法（私挖释放被 publish-wait 抵消 / 控 min_ts 受 PMT 挡 / 审查信道见下）皆不破。

## 边界（诚实）
- 🔴 **审查信道与 pump 不能【同时】，但同一窗内可【顺序】组合（Codex MSG-274 更正 v0.7"互斥"措辞）**：矿工可先未来戳 pump（节点仍 synced）、后过去戳落后 >660 s 审查（`txrelay/flow.rs:118-119` 全网停 tx relay）。顺序组合 = [pump 有界 f(k)] + [审查无界但 **out-of-model**（bounded-inclusion，Codex 承认不可绝对证）]。本仿真只界 pump 段。
- k 仍是 Owner/Codex 信任假设，本目录不拍。Codex MSG-274 政策：k=1000 **不推荐**为近零算力公测网假设；须 Owner 定对抗算力预算 + Tier-2 入场"具名窗口内稳定诚实算力地板" + 从地板推 k_max + 跌破 fail-closed。k_max→卡数换算方法 = J2 (21) `docs/2026-08-27-j2-s63-kmax-absolute-cost-v0.1.md`。
- 串行链模型（DAG 宽度非独立计数信道，difficulty.rs:33 + window.rs:315，已由 J2 反向核确认，见 sim v0.2 §1①）；确定性块时（Poisson 方差经 660 样本平均，尾部残留小，未量化）。
