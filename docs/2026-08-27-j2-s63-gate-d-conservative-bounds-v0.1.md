# §6-3 gate (d) · `min_O` / `N_claim` / `N_margin` 具名保守值提案 v0.8（证据层 · 零落码 · 不改 v0.15 正文）

> **v0.8（Codex eb4db39c 裁 MSG-273/274 后吸收）**：Codex 判 D-1 *PASS at proof-structure level*、`B_win` 定性有界 *ACCEPTED*、数值曲线 *NOT YET independently auditable*（须入库仿真源 + 参数 + 期望输出，NWT (22) 进行中）、`k_max` 政策 *OPEN — Owner decision; k=1000 not recommended*、审查信道 *out-of-model under bounded-inclusion; wording must allow sequential composition*、P3 结构 *PASS*、设计选择 OPEN 推荐 **(b)**。本版：① 审查措辞改"同一时间戳模式下机制不相容，对手可**顺序组合**，N 仍不覆盖审查"（3-C）；② §6 加 Codex 建议的 `k_max` 政策形状（Owner 定预算 → pre-entry 窗内**稳定诚实算力地板** → 由地板+预算推 `k_max` → 跌破地板 **fail-closed** 不静默沿用旧比值；Owner 若仍选 `k_max ≤ 1000` = **实验性弱信任假设**，非对抗鲁棒的公测安全）；③ P3 交叉引用 fee-source v0.3：(b) 下 `min_O` 只围绕 O/存储/价值地板重定义，claim 费储备归 claimant/watchtower 就绪度（3-A）；④ 第六因改"`k_max` 未具名 + `B_win` 仿真源未入库"；⑤ §7 残余清单按 Codex §6 五项重写；⑥ carry-forward：PMT 下限 ≈132 s、`consensus/core/src/config/constants.rs` 全路径、守恒署名 "NWT 提法，Bettor 转述"。
> **v0.7（NWT sim v0.2 = 9a4f4127 反驳 J2 ②，J2 反向核后【认】）**：🔴 **v0.6 的"首动方=矿工 ⇒ B_win 无界"方向反了。** 压住难度不升需 `measured ≥ expected`（`difficulty.rs:244-245`）；k× 产块时真实只花 `expected/k`，要把 `measured = max_ts − min_ts` 撑到 expected 只能把新块戳**超前**真实时间 ⇒ 撞 **+132 s 未来硬封**（`pre_ghostdag_validation.rs:40-42`，`TIMESTAMP_DEVIATION_TOLERANCE` @`config/constants.rs:23`）；**过去侧落后戳令 measured 更小 ⇒ 难度升更快 = 自败**。⇒ **DAA-pump 有界 = f(k)**（NWT 对抗仿真 `scratch/_nwt_bwin_adversarial.mjs`，J2 逐格复现：k=10→25,279 / 50→36,968 / 100→41,236 / **1000→53,070 < 55,200** / 1e6→75,749；8×窗与 16×窗 plateau 相同 = 不随时长增；诚实↔对抗恒差 +1,320 = 132 s × 10/s，未来预算一次性）。⇒ **占位 55,200 ⟺ 信任假设 `k_max ≲ 1000`**；§7 1-bis 改为"**需具名 `k_max`**"，(甲) 降级为该假设、(乙) 撤回；**审查信道（戳落后 >660 s 停 relay）与 pump 互斥**（落后 ⇒ 难度升 ⇒ 不 pump；pump 时 tip 不落后 ⇒ `is_nearly_synced` 仍 true），审查本身无界但 **out-of-model**（bounded-inclusion 之外，Codex 267 已承认）。J2 反向核的三条攻法都破不了（3-C）。
> **v0.6（J2 红队 NWT (19) 仿真 c30bb446 后，Bettor 裁）**：🔴 **`B_win` 只在"诚实时间戳"假设下有界（≤ 26,440 渐近）；首动方 = 矿工时【无界】**——块时间戳的过去侧只受 past-median-time 约束、无"不得落后墙钟"规则 ⇒ 单矿工可按 expected 节奏给戳而以 k× 产块 ⇒ 难度永不升（3-C 带坐标）。⇒ **§7 新 MUST："`M_observe` 以 DAA 计在 first-mover-with-mining 威胁模型下不可界"**，两条出路只列不拍（甲：信任假设"首动方不控制多数算力/时间戳"，并如实写 TN12 单矿工现网下不成立 ⇒ 现网不能开 Tier-2；乙：`M_observe` 换锚不以 DAA 计 = 架构决）。§6 固定难度期规则保留但"无界"理由换成时间戳信道，`T_fixed` 改按样本计 = 6,000 DAA；26,440 起算点 = `TESTNET12_GENESIS.daa_score = 0`；"最近 fork activation"收成"最近 **BPS-改变** fork"；补 `isSynced` 来源链。总界仍 PROVISIONAL-PLACEHOLDER，第六因 = "`B_win` 在声明威胁模型下不可界"。
> **v0.5（NWT 终核四 MUST + 路径修）**：① `B_win` **删掉"参考节点实测"选项**——危险瞬态恰是良性网络测不到的（良性期实测 ≈10/s = 假信心），`B_win` 只准由**对抗算力阶跃仿真**或**具名信任假设**定；② `M_observe` 威胁模型显式标 **first-mover-with-mining**：DAA 加速不是网络方差，是首动方可控的攻击（DAA 走快 ⇒ recovery 在墙钟上更早开 ⇒ 首动方受益；单矿工 TN12 下首动方 = 矿工/共谋即主动攻击）；③ §6 加可 enforce 规则：**固定难度期**（新网/fork 后头 `MIN_DIFFICULTY_WINDOW_SIZE=150` 样本）内 Tier-2 **禁用**——固定 N 盖不住无界推进，不是调大 N；④ `S_unalloc` 尺寸改由 **§5① 30 笔实测散度**定（p100−p50 或 k·σ），2× 只是兑现前的声明占位；⑤ 所有 constants 引用带 `config/` 前缀（live 树有两个 `constants.rs`：`consensus/core/src/constants.rs:57` 是 `UNACCEPTED_DAA_SCORE`，**不是**难度窗；正确路径 `consensus/core/src/config/constants.rs`）。
> **v0.4（Bettor 裁，不等 NWT）**：① `R_cap = 20 DAA/s` **降级为显式占位（不是保守封顶）**：`M_observe = 10/s × W_dis + B_win + tick`，`B_win` = 一个难度窗的瞬态允许量（v0.4 写"待 §5② 参考节点实测/仿真定"，**v0.5 已删实测选项**）；难度窗结构依据 @7b1e18cc 写进 3-C，并明写两条风险（单矿工体制 ×k 阶跃易得；150 样本固定难度期出块率 ∝ 算力无界）。② `S_unalloc = 2 × N_claim` 标**声明值、非导出值**。⇒ 总界数字改标 **PROVISIONAL-PLACEHOLDER**。

> **v0.3（Codex 桥 88d8a57f：(d) OPEN/PROVISIONAL，两条 D-MUST-FIX）**：**D-1** 不许写"`N_claim` 弱被 `N_margin` 吸收"——`N_margin` 已按名分配、没有 free 余量 ⇒ v0.3 选"联合最坏迹重算总界（顺序相加、不重复计）+ **具名未分配余量 `S_unalloc`**"（3-C/3-D）；**D-2** wall-clock→DAA 不许用 10 BPS 名义值——危险量是"申领方失能期间**网络** DAA 的最大推进"，`M_observe` 改由网络 DAA 推进导出（v0.3 用 `R_cap=20/s` 封顶——**v0.4 已降级为占位 `B_win`**；§5② 重采同时记 wall-clock 与参考节点 DAA 推进，用后者定值）。watchtower best-of-N 补两个独立性条件（§7 ③）。
> **Status**: DRAFT v0.3 · J2 2026-08-27 · Bettor 派工 (14) · 门定义 = Codex MSG-267 `(d) named conservative min_O / N_claim / N_margin + reactive-liveness`（split gate：**参数语义 = 设计层已闭；数值 + 落链证据 = 部署前运营工程**）· NWT (h) v1.1 CF-4 把 `N_claim`/`N_margin` 归本门 · **v0.1 NWT = GREEN-WITH-NOTES（4a486b5b）：`M_observe` 不能砍 = UPHOLD；v0.2 三处收敛修文 = ① 入场闸与 `M_observe` 的错因果删掉、标签改"失能窗"、watchtower 多重单列为架构问题交 Owner/Codex；② `N_claim` 证据基如实标近零（`N_margin` 吸收故不阻塞），§5① 重采限 claim-shape；③ `min_O` 的"费由 O 出"前提**未被 covenant 强制**（claim 支无输入数 require），理据重锚，§7 记二选一。**
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
- 🔴 **D-2（Codex）**：危险方向里要界的量是"**失能期间网络 DAA 推进了多少**"，而 **10 BPS 只是目标、不是硬上界**（难度调整有窗口滞后，短时出块率可高于目标；DAA score 随 mergeset 计入而非严格每秒 10）。⇒ 本稿凡把墙钟换成 DAA 用于**危险方向**（`M_observe`）的，一律写成 `10/s × W_dis + B_win`（3-C）——目标率项之外**显式加一项瞬态超量 `B_win`**，v0.4 起它是**占位待实测/仿真**，不是封顶；10/s 单独出现只在 3-D 对照列做"名义示意"，明标不承重。

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
| TN12 目标出块 | 10 BPS（`TenBps` 族） | `git show 7b1e18cc:consensus/core/src/config/params.rs` `:669-696 TESTNET12_PARAMS`（`:680 with_suffix(Testnet, 12)`、`:689-691 TenBps::…`、`:693-694 crescendo/covenants always()`；选择映射 `:530 Some(12) => TESTNET12_PARAMS`）。🔴 v0.1 引的是工作树 `90dbf074` 的 `:727 TESTNET_PARAMS`——**错检出**（工作树无 TESTNET12 块），v0.2 改以 live 二进制 commit 为准（同 (c)-1 坐标稿纪律）| v0.3：只做 3-D 的**名义示意**换算；**危险方向（`M_observe`）不单用它**，形式为 `10/s × W_dis + B_win`，`B_win` 占位待实测（D-2 / v0.4）；也**不**作为 `N_claim` 的依据（Codex 明禁 target BPS alone）|
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
- `min_O` 太小 ⇒ （在"费只能由 O 出"的前提下）反应方付不起费 = 同一个洞；太大 ⇒ 首动方多注一点进 O，而 O 支 1 只焊 payout 值、不禁普通找零输出 ⇒ **多出的部分反应方可作找零拿回**，对安全中性。⇒ 同样宁大勿小。🔴 **但 v0.2 修：那个前提本身没被 covenant 强制**（见 3-A）。

### 3-A `min_O`
- **形状（v0.15 §4-e O 支 1 @L288-292）**：输入 = **O（covenant P2SH）+ O_AUTHORIZED（covenant P2SH 反向焊 co-input）**，输出 = payout（`value == OAUTH_value`，spk 焊死）+ 可选普通找零。
- 🔴 **v0.2 修（NWT）：v0.1 写"没有第三个手续费输入——手续费只能出自 O"是【错模型】**。claim 支 @L147 与 O 支 @L288-292 的 require 只有 `OpCovOutputCount==0`（**限输出、不限输入**），**没有任何输入数 require** ⇒ 反应方**可以**再加一个普通 UTXO 作费输入自付费。于是"`min_O` 必须覆盖 claim 费"这条理据**失锚**：它是**便利**（O 自带费、反应方零本钱也能 claim），不是**安全**（付不起费 = 结构性 claim 不了）。超额仍中性不危险，但 §5④ 那句"把 claim 费算进 `min_O`"在当前 covenant 下**不是**必要条件。
  - 先验原语核（7b1e18cc）：`OpTxInputCount<0xb3>` @`crypto/txscript/src/opcodes/mod.rs:1119` **存在**（`OpCovInputCount` @(c)-1 坐标稿 4.4 只数 covenant 输入、不数全部）⇒ 若要把前提变成机制，`require(OpTxInputCount == 2)` 有原语可用——**是否加 = §7 未决 ①，本稿不拍**。
- 🔵 **v0.8 交叉引用 fee-source v0.3 §6**：Codex eb4db39c 推荐 **(b)**（允许额外普通费输入——避免"日后 mass/费规则变化把 O 出资的 claim 卡死"这条结构死；recipient/value/covenant provenance 仍由 Shape-B 焊死；代价明示 = claimant/watchtower 须能出费）。**(b) 下 `min_O` 只围绕它真正承担的 O/存储/价值地板功能重定义，claim 费储备归 claimant/watchtower 运营就绪度，不进 `min_O`**（Codex 原句 *"claim fee reserve belongs to claimant/watchtower operating readiness, not to `min_O`"*）。设计选择仍 OPEN 待 Owner。
- **公式（v0.1 原式，保留作为 §7 ① 选 (a) 时的算法；选 (b) 时只剩 `storage_floor` 项）**：`min_O = SF × ( fee_claim_worst + storage_floor )`
  - `fee_claim_worst`：2 个 covenant 输入的 compute mass 费。既有口径 `_bshardFeeV1(2) = 2 × 1,000,000 = 2,000,000` sompi 覆盖 budget=50 的输入；**§6-3 covenant 比 bshard 脚本重**（introspection + `OpInputCovenantId` + checksig + substr），P3 前无真 mass ⇒ 上界先取 `computeSingleOutputFee` 的 minFee 与 `_bshardFeeV1(2)` 之大者 = 2,000,000，并在 §5 ④ 列"P3 形状出来后用 `kip9-mass.mjs` 现算"。
  - `storage_floor`：O 作为 reveal 那笔的**一个输出**被创建时的 KIP-9 地板。实测族 100,000 sompi；纯公式孤立小输出最坏 2,000,000 sompi。**取最坏 2,000,000**。
  - `SF = 2.5`（显式安全系数：覆盖 P3 形状比 bshard 重 + TN12 无费市场但 mass 规则可能随 KIP 调整）。
- **提案（条件于 §7 ①）**：
  - 选 **(a)**（加 `OpTxInputCount==2`，费必由 O 出）⇒ `min_O = 2.5 × (2,000,000 + 2,000,000) = 10,000,000 sompi = 0.1 KAS`（= 10× `_BSHARD_FEE_PER_INPUT`，= 1/10 `MAX_TX_FEE_SOMPI`，= 100× 实测存储地板）。
  - 选 **(b)**（不强制输入数，`min_O` 只锚存储地板）⇒ `min_O = SF × storage_floor = 2.5 × 2,000,000 = 5,000,000 sompi`（≥ 纯公式最坏 2e6 的 2.5×；反应方自备费输入）。
  - 两者都不低于 KIP-9 最坏地板 2e6；差别只在"反应方零本钱可否 claim"这条便利属性。

### 3-B `N_claim`
- **声明的运行包络**（本量只在这个包络下成立，出包络走 §6 fail-closed）：反应方（或代广播的 watchtower）节点满足 (5) 稿 R1–R6 健康（`isSynced=true` 且 UTXO 索引可用）；claim 用 `check_utxo_landed(minDepth = REORG_SAFE_MIN_DEPTH=20)` 判 CONFIRM。
- **证据**：E2 最长单笔落链 149 s（首见级）；E1 逆境下另一节点可见 ≤ 44 DAA；CONFIRM 再加深度 20。
- 🔴 **v0.2 如实标（NWT）：`N_claim` 的证据基【近零】**——四条弱点同时成立：(i) 149 s 是**源码注释里的单点**（n=1，无原始时间戳）；(ii) 它测的是**注资 tx（funding-shape：普通 P2PK 输入）**，不是 claim-shape（2 covenant 输入 + 脚本执行）；(iii) **首见级**不是深度级；(iv) E1 的 ≤44 DAA 在**乐观方向**（低产时 DAA 走得慢，跨度天然小）。⇒ 本量现在是"有名字的占位"，**不阻塞门**只因 3-C 单列了**具名未分配余量 `S_unalloc`**（D-1：`N_margin` 各项已按名分配，**不能**说"被 `N_margin` 吸收"）；§5① 重采前不得把 3,600 当已证。
- **取法（占位算法，重采后按同式重算）**：`N_claim = 2 × (E2 最坏落链 1,490 DAA) + REORG_SAFE_MIN_DEPTH(20) + FINALITY_BUFFER(60)`，**向上取整到 3,600 DAA（= 6 min @10 BPS）**。
  - 为什么 2×：单点尾部按 2 倍是本仓既有做法的下限（reorg 用 20–25×，但 reorg 是链物理量，落链时延是流水线量）。
  - 为什么不按 10 BPS 直算：Codex 明禁；且 E3 显示我们节点大半时间处理速率 < 1 DAA/s，"10 BPS"根本不是我们节点的体验。
- **提案：`N_claim = 3,600 DAA`（PROVISIONAL，证据基近零，模型误差由 3-C 的 `S_unalloc` 兜，不由 `N_margin` 兜）**。
- 🔵 watchtower 与本量的关系：§1.5 假设 5 @L135 "任何人可代广播（payout baked 到反应方，改不了向）"——这只影响**谁**提交，不缩短**单个健康提交者**的落链跨度；它真正影响的是 3-C 的 `M_observe`（见该节的架构问题）。

### 3-C `N_margin`（v0.3：联合最坏迹 + 具名未分配余量，D-1/D-2）

**D-1 三选一显式写**：❌ 选项一"证三者互斥、界取 max"——**不成立**，失能/落链/重选顺序发生不互斥；✅ 选项三"联合最坏迹重算总界不重复计"= 本节主体；✅ 选项二"具名未分配余量"= 表中 `S_unalloc`，只吸 `N_claim` **模型误差**（估值偏差），**不吸"没量过"**——"没量过"由 §5① 硬前置解决。
**联合最坏迹（D-1 选项三：从一条时间线重算，不重复计）**——O 在网络 DAA `D0` 创建后，反应方能输的最坏一条线是**顺序发生**的：
`[失能：看不见 O 或 submit 被拒] → [观察器下一 tick 才看到] → [提交 claim → 落链到深度 20] → [落链后被 virtual 重选退回 → 重落一次] → [拥塞/方差把上两段拉长]`
各段**互不重叠**（失能时不可能在落链；重选发生在落链之后）⇒ 总界 = **各段之和**，不是 max；且各段只计一次：`M_congest` 只加在落链段上，不再在失能段里重复算方差。表：

| 项 | 时间线上的段 | 理由 | 证据 / 导出 | 值（DAA）|
|---|---|---|---|---|
| `M_observe` **失能窗** | 段 1+2 | 反应方节点 lag（看不见 O）∪ 近停滞（`isSynced=false` ⇒ submit 硬拒）+ 观察器 tick 60 s | 🔴 **D-2 导出（v0.4 形式）**：`M_observe = 10/s × W_dis + B_win + tick_DAA`。`W_dis` = 最长失能墙钟 = E3 最长近停滞 **91 min = 5,460 s**（lag max 85.5 min 与之重叠，取大者）⇒ 目标率项 54,600；`B_win` = **一个难度窗内算力阶跃的瞬态超量允许量，只准由【对抗算力阶跃仿真】或【具名信任假设】定（v0.5；良性网络实测不算，见下）**——现填**占位 55,200**（= v0.3 "20/s" 那份余量原样保留，**只是占位不是封顶**）；tick = 60 s × 10 = 600 ⇒ 54,600 + 55,200 + 600 = 110,400。🔴 **威胁模型 = first-mover-with-mining**：失能期间 DAA 走快对**首动方**有利（recovery 在墙钟上更早开），而 TN12 单矿工体制下首动方就是/可共谋矿工 ⇒ 这是**主动攻击面**，不是网络方差 | **110,400（PLACEHOLDER，B_win 未定）** |
| `N_claim` | 段 3 | claim-shape 落链到深度 20 | 3-B（PROVISIONAL）| 3,600 |
| `M_reorg` | 段 4 | 落链后被 virtual 重选退回、须重落 | 实测 reorg 回退 2；E3 单采回退最深 346（virtual 重选） | **400** |
| `M_congest` | 段 3 的方差 | TN12 无费市场，拥塞 = 出块/传播方差；E1 三点 18–44 DAA 的 2.4× 离散 | E1/E2 | **1,800**（= `N_claim`/2）|
| **`S_unalloc` 具名未分配余量**（D-1 选项二）| 不属任何段 | 专门吸 `N_claim` 的**模型误差**（3-B 证据基近零：n=1、funding-shape、首见级、乐观向）；**不得被任何具名项借用**；**不兜"没量过"**（那是 §5① 硬前置的事）| **尺寸规则（v0.5）：由 §5① 的 ≥30 笔 claim-shape 实测散度定 = `max(p100 − p50, k·σ)`（k=3）**；在 §5① 兑现前用 `2 × N_claim` 作**声明占位**（"2" 无导出依据——拿一个 guess 兜另一个 guess，只能是占位）| **7,200（声明占位，待 §5① 散度替换）** |
| **`N_margin` = M_observe + M_reorg + M_congest + S_unalloc** | | | 110,400 + 400 + 1,800 + 7,200 = 119,800 → 向上取整 | **120,000（PROVISIONAL-PLACEHOLDER）** |

**`B_win` / 网络 DAA 推进率的结构依据（@7b1e18cc；路径全带 `config/`——live 树另有 `consensus/core/src/constants.rs`，其 `:57` 是 `UNACCEPTED_DAA_SCORE`，与难度窗无关）**：
- 🔴 **v0.5：`B_win` 不由观测定。** 危险瞬态 = 攻击者/首动方选择的时刻注入算力；良性期的参考节点实测只会得到 ≈10/s，把它当 `B_win` 依据 = 假信心。⇒ `B_win` 只有两条合法来源：(a) **对抗算力阶跃仿真**：按难度调整算法在 2,641 s 采样窗内对 ×k 阶跃算超量，k 取"TN12 首动方可动员的最大算力比"（具名信任假设）；(b) **具名信任假设**直接给界（如"假设首动方算力 ≤ 网络 2×"并写进 §6 包络）。§5② 的参考节点列**只用于校核 `W_dis` 与做 sanity，不定 `B_win`**。
- 难度调整结构：`consensus/core/src/config/constants.rs:57 DIFFICULTY_WINDOW_DURATION = 2641`（秒）、`config/constants.rs:60 DIFFICULTY_WINDOW_SAMPLE_INTERVAL = 4` ⇒ 采样窗 661 样本 ≈ 44 min；`config/constants.rs:54 MIN_DIFFICULTY_WINDOW_SIZE = 150`（新网 / BPS fork 后约 10 min **难度固定**）；`config/bps.rs:115 difficulty_adjustment_sample_rate = BPS × 4`。**采样键按 DAA 计**：`consensus/src/processes/window.rs:315 (selected_parent_daa_score + index).is_multiple_of(sample_rate)`；**DAA 递增 = mergeset 数**：`consensus/src/processes/difficulty.rs:33 sp_daa_score + (mergeset_size − mergeset_non_daa)` ⇒ DAA ≈ 总产块数，**DAG 并行只改顺序不改计数**（NWT (19) 的"DAG 宽度信道"不是独立计数信道）。
- 🔴 **v0.6 · `B_win` 的有界/无界完全取决于时间戳假设**（J2 红队 NWT (19) `c30bb446`，NWT 仿真 `scratch/_nwt_bwin_sim.mjs` 表值 J2 逐格复现）：
  - **诚实时间戳（注入者只加算力、戳=真实到达时刻）**：`difficulty.rs:243-245 new_target = avg_target × measured_duration / expected_duration` 随快块样本进窗而调高难度 ⇒ 超量**有界**，NWT 仿真 k=2→8,472 / k=10→23,959，**渐近 ≤ 26,440**（难度最多滞后一整窗）。
  - **首动方 = 矿工（控制时间戳）——v0.7 修正（v0.6 方向反了）**：块时间戳两条规则——**未来侧** `pre_ghostdag_validation.rs:40-42 timestamp > unix_now() + TIMESTAMP_DEVIATION_TOLERANCE(132 s) ⇒ TimeTooFarIntoTheFuture`；**过去侧** `post_pow_validation.rs:23-24 timestamp <= past_median_time ⇒ TimeTooOld`。v0.6 说"过去侧无约束 ⇒ 可按 expected 节奏给戳"——**错**：k× 产块时真实只过 `expected/k`，要让 `measured = max_ts − min_ts` 达到 expected，新戳必须**超前**真实时间，且超前量随时间累积（claimed 时间以 k× 快于真实）⇒ **撞 +132 s 未来硬封**，之后 claimed 速率被钉回真实速率 ⇒ 难度按真实 k× 调高。**过去侧落后戳只会压小 measured ⇒ 难度升得更快 = 自败**。⇒ 未来预算是**一次性** +132 s ⇒ 恒差 +1,320 DAA（= 132 s × 10/s），其余是难度滞后一窗的瞬态 ⇒ **`B_win` 有界 = f(k)**。
  - 🔴 **主论证 = 守恒（NWT 提法，Bettor 转述；NWT/J2 各自试破未破）**：**"任一诚实节点收块时 `stamp − 其 unix_now ≤ 132 s`"（`pre_ghostdag_validation.rs:40-42` 按【接收方】墙钟判）⇒ 已发布进诚实 DAG 的链，其采样窗能表示的 stamp-elapsed ≤ 真实 elapsed + 132 s ⇒ 难度算法看到的"时间"至多比真实多 132 s（一次性）⇒ 长期 claimed 速率 = 真实速率 ⇒ 难度把 claimed-time 块率钉回 10/s ⇒ 真实块率 → 10/s。** 于是 DAA-pump 的全部超量 = 一次性 132 s × 10/s（+1,320）+ 难度滞后一窗的瞬态（f(k)，≤ 一窗量级对数缓增）。NWT sim v0.2 的表是这条守恒的**数值佐证**，不是论证本身。且 132 s 预算按接收方时钟判，**不一定吃得满** ⇒ +1,320 是上界侧保守。
  - **J2 反向核三条攻法，都破不了**：(i) **私挖整窗再一次性释放**：释放时最新戳若 > 接收节点 `unix_now()+132` 被诚实节点拒（未来封是按**接收方**墙钟判，攻击者自己节点不受限但进不了诚实 DAG = pump 没发生）；若干等到真实时钟到 newest_stamp 再释放：私挖 `2,640,000/k` ms + 干等 `2,640,000(1−1/k)` ms 内推进 26,440 DAA = **净 10/s 零加速**，可重复但**不叠加** ⇒ 仍 f(k)。(ii) **控 min_ts**：窗内 min_ts 是最老样本（≈2,641 s 前），新块戳下限 = PMT+1（**≈132 s 前**——PMT 窗 `MEDIAN_TIME_SAMPLED_WINDOW_SIZE = ceil((2×132−1)/10) = 27` 样本 × 10 s ≈ 270 s，`consensus/core/src/config/constants.rs:26-30`；v0.7 写 ≈1,320 s 是把 PMT 窗当难度窗算的，偏 10×，结论只更强；`post_pow_validation.rs:23`）> 窗 min ⇒ 压不低 min；`swap_remove(min)` 只影响平均不影响 measured。(iii) **审查信道（戳落后 >660 s ⇒ 全网 `is_nearly_synced=false`）**：与 pump **在同一时间戳模式下机制不相容**（v0.8 按 Codex 改：落后 ⇒ measured 变小 ⇒ 难度升 ⇒ 该相位不 pump；pump 相位 tip 戳不落后 ⇒ `is_nearly_synced` 仍 true）——**但对手可顺序组合两相位**（先 pump 后审查，或反之）；这不要求 N 覆盖审查，因审查本就在 bounded-inclusion 之外（Codex：*"mechanistically incompatible in the same phase," not "globally mutually exclusive attacks"*）。审查本身无界但 **out-of-model**（bounded-inclusion 之外，Codex 267 (d) 原句 "cannot prove censorship resistance absolutely"）。
  - **对抗仿真（NWT `scratch/_nwt_bwin_adversarial.mjs` v0.2，攻击者按 +132 s 上限给未来戳；J2 逐格复现）**：`B_win_adv(k)`：k=1.5→6,436 / 2→9,792 / 3→14,178 / 5→19,203 / **10→25,279** / 50→36,968 / 100→41,236 / **1000→53,070** / 1e6→75,749；k=10 在 2×/4×/8×/16× 窗 plateau 25,108→25,279→25,279→25,279（收敛，不随时长增）；对抗−诚实 = 25,279 − 23,959 = **1,320**。⇒ **占位 55,200 ⟺ `k_max ≲ 1000`**。
  - 🔴 **`isSynced` / txrelay 链保留为事实（供 §6 与 R5 引用），但从 pump 论证里摘掉**：`getServerInfo().isSynced` ← `rpc/service/src/service.rs:1224 is_sink_recent_and_connected` ← `protocol/mining/src/rule_engine.rs:118-119, :125-135`（sink 戳 + 窗/4 ≈ 660 s）；我方闸 `kasia-relay/src/lib/transaction.mjs:151`；kaspad P2P `protocol/flows/src/v7/txrelay/flow.rs:119` 在 `!is_nearly_synced` 时停 relay。这条属审查信道。
  - ⇒ **在声明的威胁模型下 `B_win` 有界，界随 k 单调；缺的只是一个具名 `k_max`。** 处置见 §7 ①-bis。🔴 **如实**：k 是"注入后 / 注入前网络算力"之比，TN12 现网基线算力 = 我们自己一两台矿机，**k=1000 在绝对量上很便宜**（几百张卡），所以 `k_max ≲ 1000` 在 TN12 是一条**弱**假设——它成立与否是 Owner/Codex 的信任决定，本稿不拍。
- 🔴 **威胁模型 = first-mover-with-mining（v0.5 显式）**：DAA 加速不是网络方差，是**首动方可控的攻击**——O 创建后首动方拉高算力 ⇒ 网络 DAA 走快 ⇒ `OpTxInputDaaScore(O)+N` 在墙钟上更早到 ⇒ 若反应方恰在失能，recovery 先落。TN12 单矿工体制下首动方 = 矿工或可共谋 ⇒ 这是主动攻击面；`B_win` 的 k 必须按"首动方能动员多少"取，不按"网络平常抖多少"取。
- 🔴 **两条风险（v0.4 明写，v0.6 修正 (ii)）**：(i) **单矿工体制下 k≥2 阶跃易得**——TN12 算力就是一两台矿机，任何人一张卡就能让出块率短时 ≥2×，所以 v0.3 的 "2× 目标 = 封顶" **不成立**；(ii) **150 样本固定难度期**（`difficulty.rs:220 difficulty_blocks.len() < min_difficulty_window_size`）——🔴 **v0.6 修正：固定期按【样本数】计，样本每 40 DAA 一个 ⇒ 固定期 = genesis 后 6,000 DAA，按 DAA 到点即结束，不是 600 s 墙钟**；诚实时间戳下 k× 只让它在 600/k s 内结束 ⇒ 超量 ≤ 6,000 × (1−1/k) < 6,000，**有界且小**（NWT (19) §4 的 `(k−1)×10/s×T` 把 T 当自由墙钟量是错的）。**固定期内难度对任何样本都不响应，时间戳也就无从作用 ⇒ 同样有界**（v0.7）；§6 的入场判据**保留为保守闸**（保证 f(k) 界所依赖的"难度已按完整窗响应"前提成立），不再以"无界"为由。
- 安全方向自检：`B_win` 取大 ⇒ `M_observe` 取大 ⇒ recovery 更晚开 = 只有活性成本，无安全损失；**仿真/信任假设只准把占位上调，不准下调到低于仿真最坏**。

- **为什么 `M_observe` 是大头且不能砍（NWT UPHOLD）**：它对应 §1 "危险方向"——网络 DAA 在走、反应方节点没跟上。这是 8/22 实测最常见的病（isSynced 只有 36%）。🔴 **v0.2 删掉 v0.1 那句"包络收紧 ⇒ `M_observe` 随之收窄"——错因果**：§6 入场闸只筛**入场那一刻**的 lag，管不住入场后的退化（E3 的 91 min 停滞就是运行中发生的），所以入场闸不能作为砍 `M_observe` 的依据。**单节点包络下唯一合法的降法 = §5② 重采出更小的尾部。**
- 🔵 **单列架构问题（交 Owner/Codex 定，本稿不拍）：Tier-2 纳不纳 watchtower 多重？** §1.5 假设 5 @L135 已允许"任何人可代广播、payout baked 到反应方、改不了向"。若 claim 可由**任一健康的** watchtower 提交（N 个独立节点），失能窗按 **best-of-N lag** 取而非单节点 max ——这是**唯一能结构性砍 `M_observe` 的路**；代价 = 反应方须把 claim 材料（witness 除私钥外的部分：O/O_AUTHORIZED outpoint、`s`/A 相关公开材料）预交给 watchtower，且 watchtower 集合的独立性本身成为新的部署假设（同 (e) quorum 的口径）。**未定前 `M_observe` 按单节点 max 取。**

### 3-D 合计与换算
| | DAA | 名义示意（@10/s，**不承重**，D-2）|
|---|---|---|
| `N_claim` | 3,600 | ≈ 6 min |
| `N_margin`（= 110,400 + 400 + 1,800 + 7,200，含 `S_unalloc`）| 120,000 | ≈ 3 h 20 min |
| **`N_claim + N_margin`（链上 enforce 的那一个数）** | **123,600（PROVISIONAL-PLACEHOLDER：`B_win` 占位 55,200 未定、`S_unalloc` 声明值、`N_claim` n=1、v0.8 **`B_win` 有界 = f(k) 但 `k_max` 未具名 + 仿真源未入库**（Codex：数值曲线 *NOT YET independently auditable*）——55,200 ⟺ `k_max ≲ 1000`，本数只在该（Codex 不推荐的）假设下才有意义）** | **≈ 3 h 26 min（名义）** |
| 对照：`FINALITY_BUFFER` / `REORG_SAFE_MIN_DEPTH` | 60 / 20 | — |

含义：首动方 reveal 后，若反应方一直不 claim，首动方最早在 **reveal DAA + 123,600** 处 recovery。反应方从 O 创建起有 123,600 DAA 把 claim 落到深度 20——其中 110,400 是失能窗 = 目标率项 54,600 + `B_win` 占位 55,200 + tick 600。**网络停滞时该窗按 DAA 自动延长**（§1）；**网络加速（算力阶跃）时该窗在墙钟上变短，这正是 `B_win` 要兜的那一头，而它现在是占位**。v0.2 的 61,200 之所以翻倍，全部来自 D-2（加 `B_win`）与 D-1（`S_unalloc` 单列）。

---

## §4 与 CFG-UNIT-DOMAIN 的单位一致性（NWT (h) v1.1 @L91）

CFG-UNIT-DOMAIN 判据原文："ctor 参数须带单位标签/单一来源，混域即拒装；或落一条'全部承重时量同为 DAA-score（`< 5e11`）'的显式一致性校验，任一量越出 DAA 量级即拒。" 本门三量对表：

| 量 | 域 | 形态 | 量级带（越出即拒）| 备注 |
|---|---|---|---|---|
| `T_cutoff_LOCKED_R` / `C_terminal_refund_cutoff` / `T_giveup_LOCKED_F` | DAA-score **绝对** | baked 常量 | `(8e7, 5e11)`（8/22 实测 DAA 已 8.03e7，绝对 cutoff 不可能小于当前 DAA）| v0.15 §4-d @L278 |
| `N_claim + N_margin` | DAA-score **相对差值** | baked 常量（和）| `[1e3, 1e7)`（1e7 ≈ 11.6 天名义；相对量 ≥ 1e7 或 < 1e3 = 拿错尺）| 本稿提案 123,600 落在带内 |
| `min_O` | **sompi** | baked 常量 | `[1e5, 1e9)`（低于实测存储地板 1e5 = 必死；高于 10 KAS = 拿错尺）| 本稿提案 1e7 落在带内 |

- 🔴 **相对量与绝对量同为 DAA 单位却是两个量级带**——这正是 CFG-UNIT-DOMAIN 要的"两个数还在不在同一把尺上"之外的第二道：**同一把尺、两种用法**（差值 vs 绝对）。把 `N` 误填成绝对 DAA（8e7）或把 `T_cutoff` 误填成相对（6e4）都在带检查里必拒。先例：`lockTime` 双模按量级选（memory `reference-dual-mode-field-selected-by-magnitude-with-handwritten-unit-conversion`）——那条教训是"手写单位换算出错"，所以本稿**换算只出现在 §3-D 对照列，常量本身以 DAA/sompi 原生单位具名，不在码里做 min↔DAA 换算**。
- **单一来源提案（不落码，只定形）**：一个具名常量模块（暂名 `s63-operating-constants`）导出 `MIN_O_SOMPI`、`N_CLAIM_DAA`、`N_MARGIN_DAA`，每个带 `unit` 字段；ctor 只收 `n_recovery_delay_daa = N_CLAIM_DAA + N_MARGIN_DAA`（**和**，链上只有一个数）；装载时跑上表的量级带断言，任一越带 ⇒ 拒装（fail-closed，CFG-UNIT-DOMAIN 的第二种 REJECT 判据）。测试臂：把 `N_MARGIN_DAA` 改成秒（5,760）⇒ 和 = 9,360 仍在带内 ⇒ **带检查抓不住** ⇒ 所以 `unit` 字段必须同时校验（两道都要，缺一是 vacuous）。

---

## §5 须节点同步后重采（IBD 前数据全是重启前的）

| # | 要重采什么 | 为什么现在的数不够 | 预注册判据 |
|---|---|---|---|
| ① | **对抗阈值测试**（Codex bullet 5）：造 O 形状同 P3 的 tx，在 `O_daa + (N_claim+N_margin) − δ` 提交 claim，测其 `blockDaaScore(claim) − blockDaaScore(O)`（`check_utxo_landed` 暴露 `virtualDaaScore − blockDaaScore`，可直接量 DAA 跨度）；对照臂：阈值后提交的 claim 输给 recovery。🔴 **显式限 claim-shape（2 covenant 输入 + 脚本执行 + 深度 20）**，**funding-shape（普通 P2PK 输入）的落链数不计入 `N_claim` 证据** | 本稿**没有任何深确认级（depth≥20）证据**，E1/E2 都是首见级，且 E2 是 funding-shape。🔴 **v0.3 升级为【部署硬前置】（NWT 撤回其"`N_claim` 5.9% 被吸收"一句，Codex D-1 打中的正是它）：`N_claim` n=1 不是"被吸收"而是**更承重**——它是联合最坏迹里唯一没有观测的段，`S_unalloc` 只兜模型误差不兜"没量过"** | ≥ 30 笔 claim-shape（2 covenant 输入、脚本执行、深确认 ≥20），全部 `span ≤ N_claim`；p100 < `N_claim`/2 才算余量成立；任一 > `N_claim` ⇒ 数值作废回本稿 §3-B 重算。**未跑完 = (d) 不得从 PROVISIONAL 升级，Tier-2 不得进真金** |
| ② | **节点 lag / 近停滞分布 + 参考节点 DAA 推进**（(5) 稿采样器 `scratch/_j2_dag_watch_postsync.mjs` 120 min 起步，目标 ≥ 24 h；🔴 **D-2：每个 lag/停滞区间同时记两列——wall-clock 时长 和 参考节点（非本机，如 J1 观察节点 / 第二 vantage）的网络 DAA 推进**；采样器现只记本机 DAA，需加参考节点一列——改脚本走报备）| E3 是反复崩那台的数据且**没有网络 DAA 列**；`B_win` 现为占位 55,200，无实测 | **v0.5 收窄用途**：参考节点 DAA 列只用于 (a) 定 `W_dis`（失能区间长度按网络 DAA 计，比墙钟更准）与 (b) sanity（良性期推进率应 ≈10/s，偏离 = 采样器/参考节点有问题）；🔴 **不用于定 `B_win`**（良性实测测不到对抗瞬态，见 3-C）。`B_win` 只由对抗仿真 / 具名信任假设定；若重采最长失能 < 30 min，可提案目标率项 `10/s × W_dis` 降，**只准降到不低于重采尾部**，`B_win` 不随之动 |
| ③ | **reorg / virtual 重选深度**（Bettor `scratch/_bettor_reorg_depth_sample.mjs` 同法）| 现只有"回退 2"一条与单采 −346 | `M_reorg ≥ 2 × 观测 max`，且 ≥ 400 |
| ④ | **P3 真实 claim tx 的 compute/storage mass**（`kip9-mass.mjs` 现算）| `min_O` 的费项现在按 bshard 口径估的 | **条件于 §7 ①**：选 (a) ⇒ `min_O ≥ 2.5 × (真 mass 费 + 存储地板)`，真费 > 4e6 则上调不准下调 SF；选 (b) ⇒ 本项只校 `storage_floor`，**claim 费不进 `min_O`**（v0.1 把它算进去是错模型，见 3-A）|
| ⑤ | **逐笔落链时延**：上链跑手（fc925044）现记提交体但**不记 `landed_at`/`landed_daa`**，建议下一版加这两字段（改码，走报备）| E2 只有一个 149 s 注释数 | 每窗记 `submit_daa`、`landed_daa`、`depth_at_landed` |

顺序：② 与 ③ 可与 (g) 乙腿同期只读采；① ④ 依赖 P3 形状。

---

## §6 fail-closed 规则提案（Codex 最后一条：环境违约 ⇒ Tier-2 关，不许静默放宽）

- **入场闸**：进入 §6-3 Tier-2 之前，反应方节点须过 (5) 稿 R1–R6（`isSynced=true`、UTXO 索引可用、lag < `M_observe` 的一半），否则**不入场**（不是"入场后放宽 N"）。🔴 **它只是入场时的筛子，不是 `M_observe` 的依据**（v0.2 修：入场后的退化它管不住，所以 `M_observe` 不因它缩）。
- **运行中**：反应方/watchtower 每 tick 记 lag；lag 超 `M_observe` 的一半 ⇒ 告警（此时仍在 N 内，尚可 claim）；超 `M_observe` ⇒ 按已损处理并留证（**不改链上 N**，链上 N 不可改也不该改）。
- 🔴 **固定难度期禁用（v0.5 立，v0.6 换理由、钉起算点，可 enforce）**：新网 / **BPS-改变的 fork** 后的头 `MIN_DIFFICULTY_WINDOW_SIZE = 150` 个采样（`config/constants.rs:54`；样本每 40 DAA ⇒ **`T_fixed = 6,000 DAA`（按样本计，非墙钟）**）内难度固定。**理由（v0.7 再修）**：固定期超量本身有界（≤ 6,000×(1−1/k)，且难度不响应 ⇒ 时间戳无从作用），**禁用不是因为无界，而是保守闸**：3-C 的 `B_win = f(k)` 界建立在"难度已按完整窗响应"之上，入场前须有一个完整采样窗的历史 ⇒ 在此之前**不入场**（fail-closed），不是调大 N。**规则**：入场前读 `virtualDaaScore`，须满足 `virtualDaaScore − DAA_at_(genesis ∨ 最近 BPS-改变 fork) ≥ 26,440`（= 一个完整采样窗 661 × 40 DAA，比 6,000 保守），否则拒入场。**起算点**：`TESTNET12_GENESIS.daa_score = 0`（`consensus/core/src/config/genesis.rs:187`，块 `:149` 起）；TN12 的 `crescendo/covenants_activation` 全为 `always()`（`config/params.rs:693-694`）= **软分叉，不重置难度窗，不作起算点**（NWT 措辞收紧）⇒ 现网 = `virtualDaaScore ≥ 26,440`；**网络重启/重置（TN12 有先例）时 genesis 换新，这条自动重新生效**。
- 🔴 **`isSynced` 来源链（v0.6，供 R5 与本节引用）**：`getServerInfo().isSynced` ← `rpc/service/src/service.rs:1224 is_sink_recent_and_connected` ← `protocol/mining/src/rule_engine.rs:118-119 has_sufficient_peer_connectivity() && is_nearly_synced()` ← `:125-135 unix_now() < sink_timestamp + expected_difficulty_window_duration/4`（≈660 s，"Roughly 10mins in all networks"）。它是**时间判据**（sink 块的**时间戳** vs 墙钟），⇒ 矿工把戳压低 660 s 即可让全网 `isSynced=false`；`submitBlock` 也据此拒（`service.rs:306-310`）。
- 🔴 **`k_max` 政策形状（v0.8，Codex eb4db39c 建议、Owner 定；本稿只落形状不拍数）**：
  1. **Owner 定容忍的对抗算力预算 / 信任模型**（不由 Codex/本稿钦定）；
  2. Tier-2 入场额外要求 **具名 pre-entry 窗口内的稳定诚实算力地板**（或等价的网络难度/算力 floor）——量法 = (21) 稿两法 `H_net`（tip `bits` 反推 × 10 BPS；`estimateNetworkHashesPerSecond`）在 pre-entry 窗内的**最小值**；
  3. **由地板 + 预算推 `k_max`**：`k_max = 1 + 预算 / 地板`（k 是"总/原"比），再由 NWT 曲线（入库后）取 `B_win(k_max)`；
  4. **跌破地板 ⇒ Tier-2 fail-closed**，**不静默沿用旧比值**（同 Codex 267 (d) 最后一条 "if the measured environment violates the bound, Tier-2 must fail closed"）。
  - 🔴 **Owner 若在近零基线下仍选 `k_max ≤ 1000`**：按 Codex 原句必须标为 **"experimental weak trust assumption, not adversarially robust public-testnet security"**；Codex 对北极星 Tier-2 的建议 = 等网络有可信稳定算力地板，否则 Tier-2 **禁用 / 只作实验**。
- **禁止项**：任何"检测到落链慢就把 N 调大"的自适应逻辑——那就是 Codex 说的 silently widening；N 只在**部署前**按 §5 重采改，改一次一个具名版本。

---

## §7 未决（不假装闭合）
1. 🔴 **`min_O` 前提二选一（NWT 逮，v0.2 新增，本稿不拍）**：claim 支现无输入数 require ⇒ "费由 O 出"未被强制。
   - **(a)** 在 O 支 1 / claim 支加 `require(OpTxInputCount == 2)`（先验原语 `OpTxInputCount<0xb3>` @7b1e18cc `opcodes/mod.rs:1119` 存在；silverscript 侧 `tx.inputs.length` @`/d/silverscript/docs/TUTORIAL.md:923`，本仓 `PoolSide.sil`/`OracleStake_v1.sil` 已在用；`OpCovInputCount` 只数 covenant 输入不够用）⇒ 费必由 O 出 ⇒ `min_O` 按 3-A 全式（0.1 KAS）；代价 = 改 v0.15 正文 + (h) 矩阵加一条 mutation-id（"删 `OpTxInputCount==2`"）。
   - **(b)** 不强制，`min_O` 只锚存储地板（5,000,000 sompi），反应方自备费输入；代价 = 失去"零本钱可 claim"便利、watchtower 代广播须自带费。
   - 影响面：改 v0.15 正文 = 设计层，须 Codex；本稿只把两条路与各自代价写清。
1-bis. 🔴 **MUST（v0.6 立、v0.7 改、v0.8 按 Codex 定形）：`M_observe` 的 `B_win` 需【具名 `k_max`，且挂在算力地板上】**——`B_win = f(k)` 有界（Codex ACCEPTED 定性；数值曲线待 NWT (22) 入库后才可独立审计）。`k_max` **不是**一个可以凭空拍的比值：Codex 原句 *"The ratio is only meaningful relative to a credible pre-attack honest-hash baseline. On a nearly empty network, '1000× current hash' may still be operationally cheap, so the assumption is weak exactly where the protocol would rely on it most."* ⇒ **政策形状见 §6**（Owner 预算 → pre-entry 稳定算力地板 → 推 `k_max` → 跌破 fail-closed）；(21) 稿给绝对成本表作 Owner 输入。
   - **Owner 若仍选 `k_max ≤ 1000`**：标 **"experimental weak trust assumption"**，非公测安全；Codex 建议北极星 Tier-2 等可信算力地板，否则禁用/实验-only。本稿不拍。
   - **(乙) 撤回**（v0.7）：有界故无须换锚；`k_max` 若拍不出可信值，答案是 "Tier-2 禁用/实验-only"（Codex），不是换锚。
   - **审查信道**：无界、out-of-model（bounded-inclusion 之外）；与 pump **同相位机制不相容、可顺序组合**（3-C v0.8 措辞）；本稿不用 N 兜它。
2. 三个数全是 PROVISIONAL-PLACEHOLDER：① 缺深确认级落链证据（`N_claim` 证据基近零，3-B 已标）；② 节点尾部是坏节点的数；③ P3 形状未出；④ `B_win` 有曲线无定值——**`k_max` 未具名 + 仿真源未入库**（v0.8）；⑤ `S_unalloc` 待 §5① 散度替换；⑥ `W_dis` 91 min 是坏节点数据。
2-bis. 🔴 **残余清单（v0.8 按 Codex eb4db39c §6 五项重写，作为 (d) 从 PROVISIONAL 升级的唯一路径）**：
   1. **≥30 笔真实 claim-shape、深度合格（≥20）的落链观测** → 定 `N_claim` 与散度 → `S_unalloc`（本稿 §5①）。
   2. **同步后 `W_dis` 运行包络证据**，每个区间同时记 wall-clock 时长与参考/网络 DAA 推进（§5②）。
   3. **durable/可复现的 `B_win` 仿真源入库**（NWT (22)：源 + 参数集 + 源 commit + 期望输出 hash/表），然后 **Owner 批准的具名 `k_max`，挂在可信算力/难度地板上**（§6 政策形状；(21) 成本表为输入）。
   4. **P3 终选 (a)/(b)**——Codex 推荐 **(b)**（fee-source v0.3 §6）。
   5. **以上证据齐后具名最终常量**；**环境违约（跌破地板 / 节点不健康 / 落链超界）一律 fail-closed**。**本稿的贡献是把"该量什么、怎么量、取值规则、保守方向"钉死**，不是把数拍死。
3. 🔴 **`M_observe = 110,400` 的唯一结构性降法 = Tier-2 纳入 watchtower 多重（best-of-N 失能窗）——架构问题，交 Owner/Codex 定**（3-C 单列）；单节点包络下只能靠 §5② 重采，**不能靠入场闸**（v0.2 删错因果）。🔴 **Codex 补的两个前提，NWT 收窄为一条**：(ii) **payout 不可重定向**——**已结构满足**（§1.5 假设 5 @L135 "payout baked 到反应方，改不了向"；claim 支 `OpTxOutputSpkSubstr(payout_idx)==baked_reactive_payout_spk` ∧ `value==OAUTH_value` 焊死，v0.15 §4-e @L289-290；任何放宽同时废掉 watchtower 方案）；⇒ **交 Owner/Codex 的架构问题只剩一条：(i) watchtower 的节点 / RPC / 故障域是否真正独立**（不是同一台机、同一 kaspad、同一供电/网络；否则 best-of-N = best-of-1；独立性论证口径同 (e) quorum）。
4. `min_O` 多出部分反应方可作找零拿回——这一点依赖"O 支 1 不禁普通输出"（v0.15 §4-e 只 `OpCovOutputCount==0`）；若 P3 收紧输出集，`min_O` 的"过大无害"论证要重看。
5. 本稿未覆盖 (d) 之外的门；`T_cutoff_LOCKED_R`/`T_giveup` 绝对值属另一门，只在 §4 单位表里对照。

**引用锚**（可 grep）：v0.15 `@L135/@L147/@L236/@L250/@L278/@L296/@L320-321/@L351`；NWT (h) v1.1 `@L91 CFG-UNIT-DOMAIN`、`@L107 CF-4`；Codex `RESPONSE-20260822-MSG267-S6-3-PRECODE-GATES-CODEX-REVIEW.md` §(d) 与 P4；`checksigfromstack-e2e-onchain.mjs:175` "实测注资落链 149s"；ledger (9416) "实测回退=2、裕度=50"。
