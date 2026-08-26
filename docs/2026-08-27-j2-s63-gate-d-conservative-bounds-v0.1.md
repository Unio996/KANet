# §6-3 gate (d) · `min_O` / `N_claim` / `N_margin` 具名保守值提案 v0.1（证据层 · 零落码 · 不改 v0.15 正文）

> **Status**: DRAFT v0.1 · J2 2026-08-27 · Bettor 派工 (14) · 门定义 = Codex MSG-267 `(d) named conservative min_O / N_claim / N_margin + reactive-liveness`（split gate：**参数语义 = 设计层已闭；数值 + 落链证据 = 部署前运营工程**）· NWT (h) v1.1 CF-4 把 `N_claim`/`N_margin` 归本门。
> **一句话**：三个量各给【定义→约束哪条 require→单位域→证据分布与尾部→保守值 + 为什么保守】。**数值全部标 PROVISIONAL**：Codex P4 明说要对着 P3 产出的真实 tx 形状定稿；且节点现仍 IBD（本稿写作时 `virtualDaaScore=0`），所有落链/停滞数据都是**重启前**那台 kaspad 的（8/23 根因：0xc0000409 反复崩），§5 逐条标"须同步后重采"。
> **不做**：不改 v0.15 正文、不改码、不动任何 ctor/env；本稿只给"具名常量应当是什么、证据是什么、还缺什么"。

---

## §0 门的 PASS 条件逐条对表（Codex MSG-267 原文 → 本稿哪一节答）

| Codex (d) PASS requires | 本稿 |
|---|---|
| each parameter has one canonical unit/domain and one source of truth | §1（单位域）+ §4（CFG-UNIT-DOMAIN 一致性 + 单一来源提案） |
| `min_O` covers worst-case required claim fees/storage floor for the exact input/output shape, with a stated safety factor | §3-A（形状 = v0.15 §4-e O 支 1：**2 covenant 输入 + 1 payout（可带 1 找零）**；SF 显式） |
| `N_claim` justified from target-chain inclusion/finality observations under the declared operating envelope, not target BPS alone | §2 E1/E2 + §3-B（用实测落链，不用 10 BPS 直算） |
| `N_margin` has explicit rationale for variance/reorg/congestion margin | §3-C（三项各有数：节点 lag 尾部 / reorg 实测 / 观察器 tick） |
| adversarial threshold test: entitled claim can LAND/CONFIRM before recovery opens; broadcast/mempool-seen insufficient | §5 ①（预注册，同步后跑；本稿数据里**没有**深确认级证据，如实标） |
| if measured environment violates the bound, Tier-2 must fail closed / be disabled rather than silently widening | §6（fail-closed 规则提案，绑 (5) 稿 R1–R6） |

Codex 同时钉：本门**不能证绝对抗审查**，最终 claim 保持 **conditional on bounded inclusion / reactive-liveness**（v0.15 §1.5 假设 5 原话："活性假设，结构不保"）。本稿不越这条线。

---

## §1 定义：每个量约束哪条 require、单位域

| 量 | v0.15 出处（§行）| 约束的 require | 语义 | 单位域 |
|---|---|---|---|---|
| **`min_O`** | §4-b/§4-e 造 O 的 reveal-claim 支 `[造 O：… spk==baked_O ∧ value>=min_O]`（v0.15 @L147）；构造码 `require(tx.outputs[O_out_idx].value >= min_O); // §5`（@L236）；§5 口径（@L320）| **首动方 reveal 那笔**造 O 输出时的**金额下限**（spk∧value 双 require，只查 spk 不查 value = dust 形似 O 绕过） | O 是反应方 claim 那笔的**手续费来源**（见 §3-A 形状）：O 太小 ⇒ 反应方付不起费 = 等价没造 | **sompi**（整数，`< 2.9e16` 总量）——🔴 **不是 DAA 域**。它是本门三量里唯一的金额量，§4 单位表里单列 |
| **`N_claim`** | §4-c `O_AUTHORIZED` recovery `require(TxTime >= OpTxInputDaaScore(O_AUTHORIZED) + N_claim + N_margin)`（@L250）；§4-e O 支 2 `require(TxTime >= OpTxInputDaaScore(O) + N_claim + N_margin)`（@L296）；§1.5 假设 5 窗 `[O_creation, O_creation+N_claim+N_margin)`（@L135）；§5 定义"反应方 claim 落链最坏 DAA 跨度"（@L321）| 两条 recovery 支的**相对下界**的第一项 | 从 O 创建（= 实际 reveal DAA，`OpTxInputDaaScore` 读 input 自己的 DAA）起，**反应方 claim 那笔在声明的运行包络下 LAND/CONFIRM 所需的最坏 DAA 跨度** | **DAA-score 差值**（相对时长，整数）|
| **`N_margin`** | 同上两处 require 的第二项；§5"O-recovery 相对锚安全余量"（@L321）；§7 未决 1（@L351）| 同上 recovery 支下界的第二项 | `N_claim` 之上的显式余量：方差 / reorg / 拥塞 / **反应方观察到 O 的延迟**（本稿 §3-C 把最后一项列为最大项）| **DAA-score 差值** |

🔴 **两条 recovery 支只看和 `N_claim + N_margin`**：链上只 enforce 一个数。拆成两个具名常量是**审计口径**（各自有独立证据与理由），不是链上两个参数。§4 给"两常量一来源、ctor 只收和"的提案。

🔵 **DAA 单位在两个方向上的性质（决定保守方向）**：
- **网络侧变慢（停矿/整链 halt，memory `reference-tn12-node-mining-outage-recovery` 实录）⇒ 网络 DAA 停 ⇒ 以 DAA 计的窗在墙钟上变长 ⇒ recovery 更晚开 = 安全方向**。DAA 计时对网络停滞自动保守。
- **本地节点 lag（网络在走、我们的节点没跟上）⇒ 网络 DAA 照走，反应方【看不见 O】也【提交被拒】（`isSynced=false` ⇒ submit 硬拒，artifact#3 3/3 excluded 就是这个）⇒ 危险方向**。这不是 DAA 单位能救的，只能靠 `N_margin` 吃掉或靠 §6 fail-closed 把这种节点挡在 Tier-2 外。

---

## §2 证据来源：分布与尾部（全部重启前数据，如实标）

### E1 · artifact#3（8/17 `run-7ac2c2`，approved 06b3bb55；`artifacts/2026-08-17-j1-trough-probe-artifact3-run-7ac2c2.jsonl`）
低产逆境（触发 rate 0.47–0.99 块/s）下向本机 synced 节点提交简单 tx，J1 笔记本观察节点（`100.111.126.10:17210`）同步记 DAA：

| 样本 | 触发 rate | submit→confirmed 墙钟 | 观察节点 DAA @submit → @confirm | **DAA 跨度** |
|---|---|---|---|---|
| 1 | 0.68/s | 32.5 s | 78,013,540 → 78,013,558 | **18** |
| 2 | 0.99/s | 32.5 s | 78,032,082 → 78,032,126 | **44** |
| 3 | 0.47/s | 32.5 s | 78,071,802 → 78,071,842 | **40** |
| 3 次 excluded | — | submit 被拒 `RPC node is not synced` | — | （`isSynced=false` 相位）|

- 🔴 **读法限制（`docs/2026-08-17-j2-artifact3-run-result.md` §二）**：32.5 s 是我们自己发送+轮询流水线（`J1_SEND_SLEEP=5` + 10 s 步长），`firstSeen == confirmed` 三次相同 ⇒ mempool→included 被采样粒度整个吞掉；**"confirmed" 是首见级不是深度级**。
- ⇒ E1 能给的是：**低产逆境 + synced 节点下，"另一台节点看得见"的跨度 ≤ 44 DAA（≤ 33 s）**；给不了深确认跨度。尾部：3 个点，不够谈分布，只当下界侧的 sanity。

### E2 · 8/20 (g) 上链腿（`docs/provenance/2026-08-27-p1g-durable-evidence/04-run-evidence-20260820.json`）
- 8 窗每窗前 `v0Before: PASS`，V0-final / V5c PASS 且 `landed`（跑手 `check_utxo_landed`，`minDepth` 缺省 = 0 = 首见级）。
- 🔴 **落链时延没有逐窗记录**（run-evidence 只有 `window/expect/v0Before/result/reason`）。**唯一一个时延数**在跑手源码注释（`checksigfromstack-e2e-onchain.mjs:175`）："**实测注资落链 149 s**，原本只等 60 s ⇒ 会把已 PASS 的格误判成未落链"，等待窗因此改为 90×2 s = 180 s。
- ⇒ E2 给的是：**同一条流水线（relay `check_utxo_landed` 读本地索引）下观察到的最长落链墙钟 = 149 s**（8/20 当时节点 lag 未记）。@10 BPS ≈ **1,490 DAA**。这是本稿数据里**最大的单笔落链观测值**，是 `N_claim` 的主要输入。

### E3 · (5) 稿 8/22 节点 690 采样（`scratch/_j2_dag_watch.jsonl`，60 s 一点，11.35 h，只读）
本机节点**处理**速率（不是网络出块率）与 lag：

| 统计 | 值 |
|---|---|
| 本地 DAA 增速 分位 p05 / p25 / p50 / p75 / p95 / max | 0.00 / 0.37 / **0.82** / 13.31 / 16.51 / 110.54 DAA/s |
| 分钟里增速 < 1 / < 3 / < 5 DAA/s | 55.9% / 63.6% / 66.9% |
| **最长连续近停滞**（< 3 DAA/s）| **91 min**（止于 23T02:06Z）；< 1 DAA/s 最长 **39 min** |
| sink lag 分位 p50 / p90 / p95 / **max** | 21.3 / 53.4 / 65.5 / **85.5 min** |
| `isSynced=true` 占比 | 252/690 = 36% |
| virtual 重选回退样本 | 23 次，最深 −346 DAA（单采，非链上 reorg 深度）|

- 追回时段本地处理到 11.6 块/s（23T02 小时 +41,669），说明网络出块本身 ≈ 10 BPS 量级，是**节点**跟不上。
- ⇒ E3 给的是 `N_margin` 的两个尾部：**反应方节点可能 85.5 min 看不到链尖**、**可能连续 91 min 近停滞（期间 submit 被拒）**。
- 🔴 这台 kaspad 就是 8/23 判定反复崩（0xc0000409 + watchdog 反复拉起）的那台；修后尾部可能收窄，**未重采前按此尾部取值**。

### E4 · 既有链上/代码常量（不是新拍，只引用）
| 常量 | 值 | 出处 | 与本门关系 |
|---|---|---|---|
| TN12 目标出块 | 10 BPS（`TenBps`） | `/d/rusty-kaspa/consensus/core/src/config/params.rs:727 TESTNET_PARAMS`（`Some(10)` 分支 @:643）| 只做 DAA↔墙钟换算：600 DAA/min，36,000 DAA/h；**不**作为 `N_claim` 的依据（Codex 明禁 target BPS alone）|
| 实测 reorg 回退 | 2 | ledger (9416)"实测回退=2、裕度=50 ⇒ 25× 余量"；`p2sh.mjs:1474` "20 = 20× 实测 max" | `N_margin` 的 reorg 项 |
| `REORG_SAFE_MIN_DEPTH` | 20 DAA | `pool-shard-register.mjs:88`（TN12 实测校准）| 深确认门槛：`N_claim` 里"CONFIRM"按此深度算 |
| `FINALITY_BUFFER` | 60 DAA | `bshard-settle-daemon.mjs:53`（finality depth 50 + 余量）| 同族口径 |
| `_BSHARD_FEE_PER_INPUT` | 1,000,000 sompi/输入（0.01 KAS，覆盖 budget=50 compute-mass 地板） | `kasia-relay/src/lib/p2sh.mjs:1737` | `min_O` 费项基数 |
| `computeSingleOutputFee` minFee/maxFee | 2,000,000 / 100,000,000 sompi | `kip9-mass.mjs:90`；`MAX_TX_FEE_SOMPI=1e8` @:33 | `min_O` 费项上界 |
| KIP-9 单输出存储地板（实测） | 100,000 sompi（0.001 KAS，J2 r108 实测） | `pool.js:55 BETTOR_MIN_STAKE_PHYS_FLOOR` | `min_O` 存储项；纯公式最坏 `C/v ≤ cap ⇒ v ≥ 1e12/5e5 = 2,000,000` sompi（孤立小输出）|

---

## §3 保守值提案（PROVISIONAL）+ 为什么保守

**保守方向先定**（本门三量风险都不对称）：
- `N` 太小 ⇒ 反应方**结构性 claim 不了 = 本金损失 = 安全洞**（v0.15 §5 原话"新洞"）；`N` 太大 ⇒ 只是首动方在"反应方不 claim"这一格里**多等一会儿才能 recovery** = 活性成本。⇒ **取尾部 + 余量，宁大勿小**。
- `min_O` 太小 ⇒ 反应方付不起费 = 同一个洞；太大 ⇒ 首动方多注一点进 O，而 O 支 1 只焊 payout 值、不禁普通找零输出 ⇒ **多出的部分反应方可作找零拿回**，对安全中性。⇒ 同样宁大勿小。

### 3-A `min_O`
- **形状（v0.15 §4-e O 支 1 @L288-292）**：输入 = **O（covenant P2SH）+ O_AUTHORIZED（covenant P2SH 反向焊 co-input）**，输出 = payout（`value == OAUTH_value`，spk 焊死）+ 可选普通找零。**没有第三个手续费输入**——手续费只能出自 O 的值（这正是 `min_O` 存在的理由）。
- **公式**：`min_O = SF × ( fee_claim_worst + storage_floor )`
  - `fee_claim_worst`：2 个 covenant 输入的 compute mass 费。既有口径 `_bshardFeeV1(2) = 2 × 1,000,000 = 2,000,000` sompi 覆盖 budget=50 的输入；**§6-3 covenant 比 bshard 脚本重**（introspection + `OpInputCovenantId` + checksig + substr），P3 前无真 mass ⇒ 上界先取 `computeSingleOutputFee` 的 minFee 与 `_bshardFeeV1(2)` 之大者 = 2,000,000，并在 §5 ④ 列"P3 形状出来后用 `kip9-mass.mjs` 现算"。
  - `storage_floor`：O 作为 reveal 那笔的**一个输出**被创建时的 KIP-9 地板。实测族 100,000 sompi；纯公式孤立小输出最坏 2,000,000 sompi。**取最坏 2,000,000**。
  - `SF = 2.5`（显式安全系数：覆盖 P3 形状比 bshard 重 + TN12 无费市场但 mass 规则可能随 KIP 调整）。
- **提案：`min_O = 2.5 × (2,000,000 + 2,000,000) = 10,000,000 sompi = 0.1 KAS`**。
  - 与既有常量关系：= 10× `_BSHARD_FEE_PER_INPUT`，= 1/10 `MAX_TX_FEE_SOMPI`，= 100× 实测存储地板。

### 3-B `N_claim`
- **声明的运行包络**（本量只在这个包络下成立，出包络走 §6 fail-closed）：反应方（或代广播的 watchtower）节点满足 (5) 稿 R1–R6 健康（`isSynced=true` 且 UTXO 索引可用）；claim 用 `check_utxo_landed(minDepth = REORG_SAFE_MIN_DEPTH=20)` 判 CONFIRM。
- **证据**：E2 最长单笔落链 149 s（首见级）；E1 逆境下另一节点可见 ≤ 44 DAA；CONFIRM 再加深度 20。
- **取法**：`N_claim = 2 × (E2 最坏落链 1,490 DAA) + REORG_SAFE_MIN_DEPTH(20) + FINALITY_BUFFER(60)`，**向上取整到 3,600 DAA（= 6 min @10 BPS）**。
  - 为什么 2×：E2 只有 1 个尾部观测（149 s），没有分布；单点尾部按 2 倍算是本仓既有做法的下限（reorg 用 20–25×，但 reorg 是链物理量，落链时延是流水线量，2× 已是 8/20 实测的 2.4 倍）。
  - 为什么不按 10 BPS 直算：Codex 明禁；且 E3 显示我们节点大半时间处理速率 < 1 DAA/s，"10 BPS"根本不是我们节点的体验。
- **提案：`N_claim = 3,600 DAA`**。

### 3-C `N_margin`
三项**各自具名**、相加：
| 项 | 理由 | 证据 | 值（DAA）|
|---|---|---|---|
| `M_observe` 反应方看见 O 的延迟 | 反应方节点 lag（网络 DAA 照走）+ 观察器 tick（settle-daemon/scanner 60 s） | E3 lag **max 85.5 min**、最长近停滞 91 min（二者重叠，取大者 91 min = 54,600 DAA）+ 60 s tick = 600 | **55,200** |
| `M_reorg` 深度/重选 | 实测 reorg 回退 2；单采回退最深 346（virtual 重选，非链上 reorg，但仍按它取）| E4 + E3 | **400**（> 346，≥ 200× 实测 reorg 2）|
| `M_congest` 拥塞/方差 | TN12 无费市场，拥塞 = 出块/传播方差；E1 三点 18–44 DAA 的 2.4× 离散 | E1/E2 | **1,800**（= `N_claim`/2）|
| **合计** | | | **57,400 → 向上取整 `N_margin = 57,600 DAA`（= 96 min @10 BPS）** |

- **为什么 `M_observe` 是大头且不能砍**：它对应 §1 "危险方向"——网络 DAA 在走、反应方节点没跟上。这是 8/22 实测最常见的病（isSynced 只有 36%）。若嫌大，正确做法不是砍数，是 §6 把"lag > 阈值的节点"挡在 Tier-2 外（包络收紧 ⇒ `M_observe` 才能随之收窄），且必须**先重采**（§5 ②）。

### 3-D 合计与换算
| | DAA | @10 BPS 墙钟 |
|---|---|---|
| `N_claim` | 3,600 | 6 min |
| `N_margin` | 57,600 | 96 min |
| **`N_claim + N_margin`（链上 enforce 的那一个数）** | **61,200** | **≈ 1 h 42 min** |
| 对照：`FINALITY_BUFFER` / `REORG_SAFE_MIN_DEPTH` | 60 / 20 | — |

含义：首动方 reveal 后，若反应方一直不 claim，首动方最早在 **reveal DAA + 61,200** 处 recovery。反应方从 O 创建起有 ≈ 1 h 42 min（DAA 计）把 claim 落到深度 20。**网络停滞时该窗按 DAA 自动延长**（§1）。

---

## §4 与 CFG-UNIT-DOMAIN 的单位一致性（NWT (h) v1.1 @L91）

CFG-UNIT-DOMAIN 判据原文："ctor 参数须带单位标签/单一来源，混域即拒装；或落一条'全部承重时量同为 DAA-score（`< 5e11`）'的显式一致性校验，任一量越出 DAA 量级即拒。" 本门三量对表：

| 量 | 域 | 形态 | 量级带（越出即拒）| 备注 |
|---|---|---|---|---|
| `T_cutoff_LOCKED_R` / `C_terminal_refund_cutoff` / `T_giveup_LOCKED_F` | DAA-score **绝对** | baked 常量 | `(8e7, 5e11)`（8/22 实测 DAA 已 8.03e7，绝对 cutoff 不可能小于当前 DAA）| v0.15 §4-d @L278 |
| `N_claim + N_margin` | DAA-score **相对差值** | baked 常量（和）| `[1e3, 1e7)`（1e7 ≈ 11.6 天；相对量 ≥ 1e7 或 < 1e3 = 拿错尺）| 本稿提案 61,200 落在带内 |
| `min_O` | **sompi** | baked 常量 | `[1e5, 1e9)`（低于实测存储地板 1e5 = 必死；高于 10 KAS = 拿错尺）| 本稿提案 1e7 落在带内 |

- 🔴 **相对量与绝对量同为 DAA 单位却是两个量级带**——这正是 CFG-UNIT-DOMAIN 要的"两个数还在不在同一把尺上"之外的第二道：**同一把尺、两种用法**（差值 vs 绝对）。把 `N` 误填成绝对 DAA（8e7）或把 `T_cutoff` 误填成相对（6e4）都在带检查里必拒。先例：`lockTime` 双模按量级选（memory `reference-dual-mode-field-selected-by-magnitude-with-handwritten-unit-conversion`）——那条教训是"手写单位换算出错"，所以本稿**换算只出现在 §3-D 对照列，常量本身以 DAA/sompi 原生单位具名，不在码里做 min↔DAA 换算**。
- **单一来源提案（不落码，只定形）**：一个具名常量模块（暂名 `s63-operating-constants`）导出 `MIN_O_SOMPI`、`N_CLAIM_DAA`、`N_MARGIN_DAA`，每个带 `unit` 字段；ctor 只收 `n_recovery_delay_daa = N_CLAIM_DAA + N_MARGIN_DAA`（**和**，链上只有一个数）；装载时跑上表的量级带断言，任一越带 ⇒ 拒装（fail-closed，CFG-UNIT-DOMAIN 的第二种 REJECT 判据）。测试臂：把 `N_MARGIN_DAA` 改成秒（5,760）⇒ 和 = 9,360 仍在带内 ⇒ **带检查抓不住** ⇒ 所以 `unit` 字段必须同时校验（两道都要，缺一是 vacuous）。

---

## §5 须节点同步后重采（IBD 前数据全是重启前的）

| # | 要重采什么 | 为什么现在的数不够 | 预注册判据 |
|---|---|---|---|
| ① | **对抗阈值测试**（Codex bullet 5）：造 O 形状同 P3 的 tx，在 `O_daa + (N_claim+N_margin) − δ` 提交 claim，测其 `blockDaaScore(claim) − blockDaaScore(O)`（`check_utxo_landed` 暴露 `virtualDaaScore − blockDaaScore`，可直接量 DAA 跨度）；对照臂：阈值后提交的 claim 输给 recovery | 本稿**没有任何深确认级（depth≥20）证据**，E1/E2 都是首见级 | ≥ 30 笔，全部 `span ≤ N_claim`；p100 < `N_claim`/2 才算余量成立；任一 > `N_claim` ⇒ 数值作废回本稿 §3-B 重算 |
| ② | **节点 lag / 近停滞分布**（(5) 稿采样器 `scratch/_j2_dag_watch_postsync.mjs` 120 min 起步，目标 ≥ 24 h）| E3 是反复崩那台的数据；修后尾部可能收窄，也可能不 | `N_margin` 的 `M_observe` 取重采 max lag 与最长近停滞之大者 ×1 + 600；若重采 max lag < 30 min 可提案 `N_margin` 降到 ~20,000，**但只准降不准低于重采尾部** |
| ③ | **reorg / virtual 重选深度**（Bettor `scratch/_bettor_reorg_depth_sample.mjs` 同法）| 现只有"回退 2"一条与单采 −346 | `M_reorg ≥ 2 × 观测 max`，且 ≥ 400 |
| ④ | **P3 真实 claim tx 的 compute/storage mass**（`kip9-mass.mjs` 现算）| `min_O` 的费项现在按 bshard 口径估的 | `min_O ≥ 2.5 × (真 mass 费 + 存储地板)`；若真费 > 4,000,000 sompi ⇒ `min_O` 上调，不准下调 SF |
| ⑤ | **逐笔落链时延**：上链跑手（fc925044）现记提交体但**不记 `landed_at`/`landed_daa`**，建议下一版加这两字段（改码，走报备）| E2 只有一个 149 s 注释数 | 每窗记 `submit_daa`、`landed_daa`、`depth_at_landed` |

顺序：② 与 ③ 可与 (g) 乙腿同期只读采；① ④ 依赖 P3 形状。

---

## §6 fail-closed 规则提案（Codex 最后一条：环境违约 ⇒ Tier-2 关，不许静默放宽）

- **入场闸**：进入 §6-3 Tier-2 之前，反应方节点须过 (5) 稿 R1–R6（`isSynced=true`、UTXO 索引可用、lag < `M_observe` 的一半），否则**不入场**（不是"入场后放宽 N"）。
- **运行中**：反应方/watchtower 每 tick 记 lag；lag 超 `M_observe` 的一半 ⇒ 告警（此时仍在 N 内，尚可 claim）；超 `M_observe` ⇒ 按已损处理并留证（**不改链上 N**，链上 N 不可改也不该改）。
- **禁止项**：任何"检测到落链慢就把 N 调大"的自适应逻辑——那就是 Codex 说的 silently widening；N 只在**部署前**按 §5 重采改，改一次一个具名版本。

---

## §7 未决（不假装闭合）
1. 三个数全是 PROVISIONAL：① 缺深确认级落链证据；② 节点尾部是坏节点的数；③ P3 形状未出。**本稿的贡献是把"该量什么、怎么量、取值规则、保守方向"钉死**，不是把数拍死。
2. `M_observe = 55,200` 若 Owner/Codex 认为活性成本太高，唯一合法的降法是收紧包络（§6 入场闸）+ 重采（§5 ②），不是改数。
3. `min_O` 多出部分反应方可作找零拿回——这一点依赖"O 支 1 不禁普通输出"（v0.15 §4-e 只 `OpCovOutputCount==0`）；若 P3 收紧输出集，`min_O` 的"过大无害"论证要重看。
4. 本稿未覆盖 (d) 之外的门；`T_cutoff_LOCKED_R`/`T_giveup` 绝对值属另一门，只在 §4 单位表里对照。

**引用锚**（可 grep）：v0.15 `@L135/@L147/@L236/@L250/@L278/@L296/@L320-321/@L351`；NWT (h) v1.1 `@L91 CFG-UNIT-DOMAIN`、`@L107 CF-4`；Codex `RESPONSE-20260822-MSG267-S6-3-PRECODE-GATES-CODEX-REVIEW.md` §(d) 与 P4；`checksigfromstack-e2e-onchain.mjs:175` "实测注资落链 149s"；ledger (9416) "实测回退=2、裕度=50"。
