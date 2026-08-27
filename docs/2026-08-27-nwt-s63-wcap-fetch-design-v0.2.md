# NWT — `w_cap_window` 重建器取数设计 v0.2（四闸实测验收清单 · Codex 283 直审 · SUPERSEDES 448469b2）

> 作者 NWT · 2026-08-27 · 派工 Bettor · SUPERSEDES v0.1（`3f7ef2c5` + fix-up `448469b2`）· **Codex `1c7188e2`（MSG-283）直审本取数设计**："direction is sound, but **not part of D-STAT-3 design closure evidence yet**"——**D-STAT-3 数学项已 CLOSED（设计层）；取数/重建【实现】OPEN，须真 RPC 路证四闸**。这四闸是 **implementation / data-provenance 闸，非重开数学项**。
> **Codex 明写：本轮不授权任何 build / 落码 / 部署 / 签名广播 / DB 变更 / 结算退款 / key movement / 生产钱路。** 本稿纯设计层（验收清单，落码另轮）。
> v0.1 的 ①getBlocks 语义 / ②锚点在线判定（含完整性不变量 fix-up）/ ③缓存 / ④失败 / ⑤接口 **逐字保留**（见 448469b2）；本版新增 §四闸实测验收清单 + t0/t1 与 (21) 接口绑定。
> 🔴 **节点约束（NWT 2026-08-27 · J1 r2）**：**四闸真跑 + (23) v0.15 (B) `bitsCalc==收块bits` 全精确窗证据只用本机 da9 单节点**——younio **5 天未同步完**（根因 = S0 Modern Standby，Kernel-Power 506/507 关屏即睡，`PlatformAoAcOverride=0` 待重启，J1 实核）⇒ **younio 同步完成前不作第二链读 vantage**。本取数设计的重建/证书全在**单节点**上成立（不需第二 vantage）；(23) 的 `M_reorg`/`W_dis` 若要参考节点第二 vantage，须等 younio 同步后（另计）。

## 四闸实测验收清单（Codex 283 §4；每条：怎么测 / 证据形态 / 通过判据 / 失败⇒INEXACT）

### 闸1 — 分页到 sink 对所需覆盖【完整且确定】
- **怎么测**：从起锚 R 前向 `getBlocks(lowHash=R→上页 high_hash)` 翻到 `high_hash==sink`；对每 `SP∈S` 增量建 `window(SP)`，跑证书乙在线判定（`blue_work(R) < min_{SP∈S} heapMin` ∧ 各窗满 661 ∧ `antipast(R)∩past(sink)` 全取）。
- **证据形态**：页序列 `[R→h1→…→sink]`、每页块数、总块数、覆盖 blueScore 区间 `[bs(R), bs_top]`；**确定性** = 同 `(R, sink)` 两次独立跑返回**同一 hash 集**。
- **通过判据**：`high_hash==sink`（翻齐）∧ 证书乙每 SP 过 ∧ 两跑同集。
- **失败 ⇒ INEXACT**：未翻到 sink / 任一 SP 覆盖不全 / 两跑不同集 ⇒ `WINDOW_INEXACT`，回 (a-total)。

### 闸2 — sink-anticone 加入不留【未返回 mergeset 闭包洞】
- **怎么测**：`high==sink` 时 handler 附 `filtered_sink_anticone`（`service.rs:459`）；对每 `SP∈S` 建 `window(SP)`，核其 `certificate.missing`（重建时 mergeset 引用未在已取集且**非合法缺席**者计数）。
- **证据形态**：每 `SP∈S` 的 `window(SP).certificate.missing`；未返回引用表**仅作诊断**（不直接判洞）。
- **通过判据（J2 fix-up 修正）**：**`S` 内每个 `window(SP)` 的 `certificate.missing == 0`**（= 该窗所需成员全在）。🔴 **合法缺席豁免**：引用落 `past(R)`（在锚 R 之下）或锚 R 自身 mergeset 的未返回块**不算洞**——它们 `blue_work ≤ bw(R) < heapMin`（F9），进不了任何 `window(SP)`（同 (24) v0.1 ② 完整性不变量：只需 `antipast(R)∩past(sink)` 全取，past(R) 本就不取）。故"anticone tip 的 mergeset 闭包 ⊆ 返回集"是**过严**误判（J2 F7 撞：s3 的 SP `b3∈past(R)` 列诊断但 `window(SP).missing=0`），**改以 per-window `missing==0` 为判据**。
- **失败 ⇒ INEXACT**：某 `SP∈S` 的 `window(SP).certificate.missing > 0`（真洞：`antipast(R)∩past(sink)` 内应取未取）⇒ `WINDOW_INEXACT`。

### 闸3 — 缺失/剪裁/IBD 成员必成 INEXACT，【绝不成更小重建窗】
- **怎么测**：注入或遇到 (i) 成员缺失（mergeset 引用节点亦无的 hash）、(ii) 剪裁点越锚、(iii) IBD 期（`isSynced=false`）；核重建器输出。
- **证据形态**：`missing_count`、`certificate.kind`、`wCapWindow`（须为 `null`）、`inexact_count`。
- **通过判据**：任一缺失 ⇒ `certificate.kind='INEXACT'` ∧ `wCapWindow=null`（回 a-total）——**绝不**用少了成员的窗算出一个（偏小的）`wCapWindow`（偏小 = `T_lb` 偏大 = cap 偏小 = 危险向）。
- **失败（=实现错）⇒ 工具 fail-closed**：缺失时仍出非 null `wCapWindow` ⇒ 危险向 bug ⇒ 断言不过 ⇒ fail-closed（对应 (23) v0.15 (A) 证书 + 洞不归 B_adv）。

### 闸4 — `λ_ub(n)` 的 t0/t1 与 `wCapWindow` 认证的是【同一接收时钟区间】
- **怎么测**：`λ_ub(n)` 的 `n` = own-clock 窗 `[t0,t1]` 内新可达块数（(21) 接收计）；`wCapWindow` 认证的是 `t1` 时刻 sink（`bs_top(t1)`、`S` 取自该 sink）的公开状态。核三者 `t1` 是**同一 own-clock 时刻**。
- **证据形态**：`{t0Ms, t1Ms}`（λ_ub 窗）+ `wCapWindow` 认证时读的 `sink_hash / bs_top / sampled_at`；`sampled_at ≈ t1Ms`（同区间）。
- **通过判据**：`S`/`bs_top` 取自 `[t0,t1]` 的 `t1` 时刻 sink；`hVisUb = λ_ub(n)·wCapWindow / ((t1Ms−t0Ms)/1000)` 用同一 `[t0,t1]`。
- **失败 ⇒ 不出 cap**：`wCapWindow` 用了**异于 t1** 的 sink（如认证时刻晚于/早于 λ_ub 窗）⇒ 单位/窗错配 ⇒ `NO_W_CAP`，回 (a-total)。

## t0/t1 与 (21) `hVisUb` 接口绑定（闸4 的落法）
`hVisUb({ n, wCapWindow, t0Ms, t1Ms })`（(21) v0.9）**必须**：`wCapWindow` 的 `certificate.sampled_at`（认证时刻）落在 `[t0Ms, t1Ms]` 内**且**其 `bs_top` 取自 `t1Ms` 时刻的 sink；否则 `hVisUb` 返 `reason='WINDOW_TIME_MISMATCH'` → 回 (a-total)。即 **(24) 重建器与 (21) `λ_ub` 接收计【同一次 own-clock 窗】驱动**，跑手层保证 `t0/t1` 单一来源（见 (24) v0.1 §⑤ 驱动层字段）。

## Scope（Codex 283 §3，原话进 Owner 面）
- **英**: "D-STAT-3 closes the work-per-public-arrival cap construction under exact reconstructed public state; it does not eliminate the adversarial-capacity model boundary."
- **中**: D-STAT-3 闭的是"**每公开到达 work 上界**构造（在**精确重建的公开状态**下）"；它**不消除**对手容量的模型边界（私链/withheld/反事实/可用性 ⇒ 仍归 `B_adv` 或 fail-closed）。`Ncand(SP)` 是估计器可得块建的，**不魔法覆盖可得公开集之外**的子块/支链。

## 剩余 OPEN（Codex 283 §5）
- w_cap **取数/重建实现**：OPEN，须 exactness/data-acquisition 证据（= 本清单四闸在真 RPC 路证）。
- **gate (d) 整体**：OPEN/PROVISIONAL——非 D-STAT 项（claim-shape 证据、同步后运行证据、对手预算/cap 策略、具名保守常量等）**未由本裁定闭**。
- D-STAT-1/2/3：三条 **CLOSED（设计层）**。(D)=引理/回归检验（非生产覆盖）、(E)=非验收 smoke。
