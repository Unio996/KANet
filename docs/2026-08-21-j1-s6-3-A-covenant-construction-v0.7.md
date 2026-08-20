# §6-3 A：fair-exchange 结算 covenant 完整构造（v0.7 · 报备层 · 零生产码）

> **Status**: CURRENT（v0.7 取代 v0.6，走 Shape A1：删不可 enforce 的 equality + F1 上界 guard + O 边界纯相对 + ordering 非 equality）
> **作者** J1 · **日期** 2026-08-21 · **派工** Bettor（出/修构造）+ Codex v0.6 复审（MSG-263）逮 anchor 不可 enforce + F1/F2 race

## §0.10 v0.7 变更（Codex v0.6 逮到 anchor 不可 enforce + F1/F2 race = MUST-FIX，我认自引）

Codex 复审 v0.6：**反向焊 PASS AS DESIGN**（`花 O ⟺ 领 LOCKED_F` biconditional 修好），但逮一条 timing/anchor 矛盾 + 一个真 bug：

- 🔴 **MUST-FIX（anchor 不可 enforce，我认自引）**：v0.6 §4-e 称 `T_O == T_refund_LOCKED_F` 且"均锚 `OpTxInputDaaScore(O)+N_claim+N_margin`" = **机制上不可能**。`T_refund_LOCKED_F` 在 **reveal 前就 baked**（那时 O 还不存在，`OpTxInputDaaScore(O)` 取不到）；LOCKED_F 跑 standalone refund 支时 O 非必需 co-input，covenant 读不到 O 的 daa。⇒ "令两 anchor 相等"是**散文/配置断言，非 covenant 可强制的不变量**。**这是我自引的错**（v0.6 §4-e 末尾我写的），没核"LOCKED_F 在其 bake 时刻读不读得到 O"。
- 🔴 **真 bug（F1/F2 race）**：F1（reactive claim §4-c）无 `< T_refund_LOCKED_F` 上界 guard，F2（LOCKED_F terminal-refund）在 `>=` 开 ⇒ UTXO once-spend 只在落一笔后互斥、不使两支 eligibility 窗不重叠 ⇒ 阈值后 **F1/F2 可 race**（反应方 claim 与首动方 refund 抢）。
- 🔴🔴 **四人共错（含 Bettor），我域首责**：我自抓对齐需求、NWT 确认、J2 升矩阵格、Bettor 背书"三角 well-covered"——**四人都没核 `T_refund_LOCKED_F` 在其 bake 时刻 O 还不存在**。Codex（外部对抗）逮出。🔨 **新判据（入册）**：**多个独立 reviewer 三角"同意"一条不变量不使它可 enforce——他们可共享盲点。可 enforce 性须单独核：这个 covenant 在这个执行时刻【读得到】它要比较的量吗？** 关联 [[feedback_read-the-thing-not-a-copy]]、[[feedback-samples-sharing-a-hidden-precondition-cannot-support-a-necessity-claim]] 的对偶。
- ✅ **修法 = Shape A1（Codex 给，最小，保 Shape A）**：① 删假 equality（§4-e）② F1 加 `require(current_daa < T_refund_LOCKED_F)`（§4-c）③ O 边界纯相对：O1 `< OpTxInputDaaScore(O)+N_claim+N_margin` / O2 `>=` 同式（§4-e）④ equality 换 **ordering**：`T_refund_LOCKED_F >= latest_possible_O_creation + N_claim + N_margin`，而 latest O creation `< T_cutoff_LOCKED_R`（covenant 限 reveal 窗）⇒ **v0.4 baked 不等式 `T_refund_LOCKED_F >= T_cutoff_LOCKED_R + N_claim + N_margin` 已保守满足**（§4-d，只须精确 off-by-one）。

## §0.9 v0.6 变更（Codex v0.5 逮到 O↔LOCKED_F 单向焊 = MUST-FIX，我认）

Codex 复审 v0.5：**接受全部 v0.5 修**（Shape A / §4-c 拓扑 / reactive-liveness 假设 / P-SAFE-1 / 唯一续继全 PASS），但逮一条剩余结构缝：

- 🔴 **O↔LOCKED_F 焊接只单向（蕴含非双条件），我认**：v0.5 §4-c 证 `claim LOCKED_F ⟹ 含真 O co-input`，但**没证逆** `花真 O ⟹ 必同笔 claim LOCKED_F 且带精确 baked payout`。⇒ O 若有 pre-timeout spend 支只验本地 witness（`checkSigFromStack(A)∧blake2b(s)`），**reveal 后 s/A 公开 ⇒ 外人/任一方可在独立 tx 消费真 O 不碰 LOCKED_F ⇒ capability 毁 ⇒ 反应方行使不了 ⇒ 首动方 T_refund 后收回 LOCKED_F = 盗窃**。F1 侧 co-input 检查救不了（管不住从不进 F1 的独立 O spend）。
- 🔴 **根因（J2 认，我域同责）**：**O 的支路清单从【意图】导出（"O 被 F1 作 co-input 消费"）而非从 O 自己 covenant 的实际 spend 条件导出**——我 v0.5 从没显式写 O 自己的 covenant 支。⇒ v0.6 **§4-e 显式定义 O 的 covenant 支路**（从实际 spend 条件，非意图）。
- ✅ **修法（反向焊）**：O 的 pre-timeout 支加 `require(OpInputCovenantId(LOCKED_F_idx)==locked_f_cid ∧ payout 到反应方 baked)`——花 O ⟹ 必同笔领 LOCKED_F。与 §4-c（领 LOCKED_F ⟹ O co-input）合成**双向互焊**：O 与 LOCKED_F 在窗内只能一起花，各付各半，无独立 O spend。
- 🔨 **meta（同一"单向焊"形状第 3 次：NWT LOCKED_R↔O创建 / Codex v0.3 O↔LOCKED_F 寿命 / 本次 O↔LOCKED_F spend 权）**：**焊 A⟹B 必同时检查是否需要 B⟹A**；且**支路清单必从 covenant 实际 spend 条件导出，非从意图**。入 [[feedback_read-the-thing-not-a-copy]] 的"验在≠验够"族。

## §0.8 v0.5 变更（J2 矩阵逼出 reactive-liveness 活性假设 + 两矩阵 drift 解）

J2 独立建 8 支穷举矩阵（`docs/2026-08-21-j2-c4-pairwise-independence-matrix.md`），§3 R1×F2 逼出一条 v0.4 **未显式列的活性假设**：

- 🔴 **reactive-liveness（真发现，收）**：v0.4 不等式 `T_refund_LOCKED_F >= T_cutoff_LOCKED_R + N_claim + N_margin` 给反应方一个 claim 窗，但 **no-theft 在这格条件于「反应方在窗内主动 claim」——是活性假设，非结构保证**。反应方离线 ⇒ F 超时 refund 掉 LOCKED_F ⇒ 反应方自负（已被拿走 LOCKED_R、又没及时领 LOCKED_F）。这**不可"修"只可显式声明**（没法强制谁领自己的钱）。⇒ 列作第 5 条硬假设（§1.5）。
- 🔴 **两两穷举 ≠ 全穷举（J2 警示，收）**：矩阵只覆盖 8 支两两关系；**三方以上联合时序看不见**，新增任一支矩阵即失效。⇒ §1.5 标为方法边界，改构造时同步更新矩阵是义务非一次性附录。
- 🔵 **两矩阵 drift 解**：J2 的 matrix doc（8 支全归类，**类别方案以该文件为准**——不在此硬拷，否则 J2 改类别我这份即漂，正是要防的病）= **权威全枚举**；我 §2.6 收缩为"指向 J2 矩阵 + 只列本构造 normative 的 WELD/EXCL 焊接点"，不再各存一份会漂的全表（CLAUDE.md 通则：别处有权威副本⇒删会漂的那份）。

## §0.7 v0.4 变更（Codex v0.3 复审逮到的对称缝 = MUST-FIX + MUST-SPECIFY）

Codex 判 v0.3 **架构 GREEN、4 项已接受全 PASS**（A-absent removal / 唯一续继 ==1 / T_O 相对锚 / 两-lineage 焊接），但逮到**对称的一条残留盗窃**：

- 🔴 **MUST-FIX（真盗窃，Codex 逮对，我 v0.3 没闭）**：v0.3 保证「首动方领反应方 principal ⟹ 同笔造真 O」，但**没保证「真 O 存在 ⟹ 反应方有个不可偷的 principal UTXO 可用 >= N_claim+N_margin」**。**首动方【自己】那个 principal（`LOCKED_F`）的 refund 没跟 O 创建耦合** ⇒ 对抗: 一笔原子 tx 消费反应方 principal(`LOCKED_R`)+C+造真 O（v0.3 焊接全过），但 `LOCKED_F` 已 refund-eligible 或在 `O_creation+N_claim+N_margin` 前变 eligible ⇒ 首动方在反应方用 O 领走前 refund 掉自己的 `LOCKED_F` ⇒ **两个 principal 都拿，O 真但经济无用**。⇒ **O 寿命与被保护 principal 寿命必须耦合**（走 Codex shape A 静态不等式，§4-d）。
- 🔴 **MUST-SPECIFY（拓扑）**：v0.3 §4-c 只列花 O 的检查，**没说它是不是「`LOCKED_F` 的一个 spend 支、O 作 co-input」**。v0.3 实为纯 O-spend 支 ⇒ 又一条两-tx 缝（O 可独立于 principal 被消费）。⇒ v0.4 §4-c 改成 **`LOCKED_F` 的 spend 支 + O 作 co-input + baked payout 焊死**（§4-c）。
- 🔵 **命名厘清（v0.3 §2.5/§4-d LOCKED 混淆）**：`LOCKED_R` = 反应方本金（首动方揭 s 消费）；`LOCKED_F` = 首动方本金（反应方凭 O 领 / 首动方超时退）。全文统一。
- 🔵 shape 选择：走 **shape A（静态 baked 不等式，最小）**——`T_cutoff_LOCKED_R` 本就是可链上 enforce 的 reveal deadline，够且简。shape B（造 O 那笔原子把 `LOCKED_F` 转 `O_AUTHORIZED` 后继）更强但要额外 state weld，记为 §7 备选待 Owner/团队定。
> **上游** J2 O-spec v4（`docs/2026-08-20-j2-o-earmark-construction-spec.md`）+ Codex MSG-260 verdict（`coordination/codex-bridge/responses/RESPONSE-20260820-MSG260-S6-3-O-LINEAGE-CODEX-REVIEW.md`，GREEN DIRECTION 架构接受）。
> **适用** 🔴 **仅同链**（两腿都在 TN12）。跨链退 R1/light-client（O 构造完全不适用 + 仍需正 finalized-reveal 证，Codex MSG-260 附加条件）。

---

## §0.5 v0.2 变更（Codex MSG-260 三条 MUST-FIX + A-absent 全清）

Codex 判**架构 GREEN**（script→cov_id provenance pivot / O-REPLACEMENT 无 (A,s) fallback / terminal 支必终止 lineage 三项 ACCEPTED），但 v0.1 构造**未 design-closed**，三条 MUST-FIX 全在我文档，逐条修：

- 🔴 **MUST-FIX 1（我的真 bug，认）**：v0.1 行 36/98 把 reveal 侧本金 refund 写成 `require(A-absent)` = **回退到 v0.7 已否决错**（covenant 能正验一个提交的 A，**证不了链下 A 全局不存在**）。NWT 逐字核实两处。⇒ 改 **P-SAFE-1 单-live-lineage state machine**（§4-d 新写法），**A-absent 谓词全清**。这是我这 session 反复的错类（验机制在、漏它实际强制不了）+ 回退已否决设计，判据入册 [[feedback_read-the-thing-not-a-copy]]。
- 🔴 **MUST-FIX 2**：`OpCovOutputCount(cid) >= 1` 允许**多个**续链 output → 违反唯一 capability。⇒ reveal 支改 **`== 1`**（恰一续继），每条 terminal/refund/cancel 支 **续链 output == 0** + 变异负测。教训：照搬 `ShardLeaf.sil:101` 的 `>=1` 是"活先例挡住的是它当初那个洞（允许多续继合理），不是我这个洞（要求唯一）"——先例 guard 带着为**别的需求**校准的强度（J2 判据，采纳）。
- 🔴 **MUST-FIX 3**：`T_O` 从绝对 DAA deadline 改**相对 O 创建**：`current_daa >= OpTxInputDaaScore(O) + N_claim + N_margin`。用 O 自己 input 的本地 DAA 事实，不重新引入无锚绝对窗（O-lineage 采纳的初衷就是不靠外部/模糊 finality 钟）。

---

## §0.6 v0.3 变更（NWT 逮到的两-lineage 原子焊接缝 = MUST-FIX）

NWT 红队"P-SAFE-1 lineage ↔ O cov_id-lineage 交互"逮到 v0.2 承重缝，J2/我独立收敛同一修法：

- 🔴 **缝**：`LOCKED`（P-SAFE-1 lineage）与 `C`（cov_id lineage）是**两个独立 covenant UTXO**。§4-b（消费 C 造 O）与 §4-d 的 `LOCKED-transfer` 支**各自独立** require `checkSigFromStack(A)∧blake2b(s)==h`，**两处 witness 字面相同，但 v0.2 没有一句把它们钉到同一笔 tx**。
- 🔴 **精确逻辑断链**：安全依赖 **s 被揭 ⟺ O 被造**。v0.2 有「消费 C ⟹ 造 O」（§4-b）+「领 principal ⟹ 揭 s」（§4-d transfer），但**缺「揭 s ⟹ 消费 C」**——故 s 可在【不消费 C ⇒ 不造 O】的 tx 里被揭。叠加 O-REPLACEMENT 去掉 (A,s) fallback ⇒ 首动方**只广播 LOCKED-transfer 那一笔**（拿本金 + s 公开）、**不广播造 O 那笔** ⇒ 反应方无 O 可花、无 fallback ⇒ **本该被 enforce-O-creation 堵住的 griefing/盗窃重现**。
- ✅ **修法（J2/我同款，源码域我裁可建）**：`LOCKED-transfer` 支加 `require(OpInputCovenantId(C_idx) == cid)`——强制**同一笔 tx 必须也消费 C**，C 被消费即触发其 §4-b 支强制造 O。⇒ 揭 s ⟹ 消费 C ⟹ 造 O 三段原子焊死（§4-d 新写法 + §2.5 拓扑）。
- 🔴 **附带 cutoff 排序不变量（我补，v0.2/J2 提议均未含）**：须 `T_cutoff_LOCKED <= C_terminal_refund_cutoff`。否则 LOCKED-transfer 活窗内，同笔消费 C 可走 C 的 terminal-refund 支（不造 O）绕过焊接。
- 🔨 J2 判据（采纳）：**「生产 X 是领钱的前提」= 必须【同一笔 tx】；拆成两笔，它退化成两个各自独立可分别选择的动作，攻击者只选对自己有利那一个**（= "安全性质只能来自唯一路径"，此处路径被【拆成两步】而分岔）。J2 判据（采纳）：**这条缝的缺失约束【不在任何一行代码里】**——故负测是**交易级变异**（改怎么提交，不改任何 require 行），与族 B 语句级变异不同层（§6.2b）。

---

## §0 本文交付什么（先写死，防被读成别的）

Bettor 16:22 定的 **REDTEAM-HOLD 解除三闸**——本文逐条给**源码级**答案 + 把冻结的三步 lineage 落成**显式 require 清单**，每一条都锚到【活生产合约的 file:line】，不靠"我记得可以"。

> 🔴 **可建性锚定纪律**：cov_id lineage 那几个原语（`OpInputCovenantId`/`OpOutputCovenantId`/`OpCovOutputCount`）的可建性，**证据是它们在 `ShardLeaf.sil:99-105` 已上链跑通且被 NWT 红队过**，不是读 codegen。**但 `checkSigFromStack`（A2 原语）腿必须在 canonical 树 `8065184` 上写 + 上链 e2e**——我这台 `/d/silverscript` 检出 `aedad5b` 无此原语（编译报错），别用它编本构造（见记忆 `j1tn-boot-0819` §0c 树分歧）。

---

## §1 它交付的安全性质

> **反应腿的 claim 在【结构上】不可能早于 reveal 被链收录；且 reveal 一旦被 reorg，反应腿 claim 同时失效。**

不是"等够深度"，是**共存亡**：`O` 由 reveal 交易创造，reactive claim 花掉它、且校验它血缘续自 reveal 侧唯一 capability `C`。
⇒ 专属 finality 预算参数 `F_reveal` **从安全承重位移除**（退化成"每笔交易等自己确认"的通用问题）。⇒ **同链无委员、无深度参数**。

## §1.5 硬假设清单（v0.5 显式化 —— no-theft 之外的承重前提，缺一即性质不成立）

| # | 假设 | 内容 | 违反后果 |
|---|---|---|---|
| 1 | `C4-ENTROPY` | adaptor secret `s` 高熵、不可预测（`h=blake2b(s)` 预像不可求） | s 被猜 ⇒ 任意方伪造 reveal |
| 2 | `s-secrecy` | reveal 前 `s` 只首动方知 | 提前泄露 ⇒ 反应方抢先 |
| 3 | `finality-bound` | 各腿交易在其自身 finality 窗内被收录（同链通用确认，非专属 F_reveal） | 深 reorg 超界 ⇒ 一般性重组风险（非本构造特有） |
| 4 | `honest-reveal` | attestation `A` 的签发遵守协议语义（A2 契约层，§6-1 冻结） | A 被误签 ⇒ 授权语义破 |
| 5 | 🔴 `reactive-liveness`（**v0.5 新，J2 矩阵逼出**） | 反应方在其 claim 窗 `[O_creation, T_refund_LOCKED_F]` 内主动花 O 领 `LOCKED_F`，否则自负 | 反应方离线 ⇒ F 超时 refund `LOCKED_F` ⇒ 反应方失两笔（**活性假设，结构不保**，无法强制谁领自己的钱） |

🔴 **方法边界（J2 警示）**：§2.6 / J2 矩阵是**两两穷举，不等于全穷举**——三方以上联合时序、跨 session 交互看不见。矩阵只在"未新增支路"时有效，**改构造必同步更新矩阵**。

---

## §2 冻结的三步 lineage（Bettor 16:20，O-REPLACEMENT 非 parallel-optional）

```
锁前  : 造唯一 capability C（cov_id 共识派生；把该 cov_id 烤进两腿）
reveal: checkSigFromStack(A) ∧ blake2b(s)==h
        ∧ [消费 C：OpInputCovenantId(C_in)==baked_C_cov_id]
        ∧ [造 O：OpOutputCovenantId(O_out)==baked_C_cov_id ∧ spk==baked_O ∧ value>=min_O]
react : checkSigFromStack(A) ∧ blake2b(s)==h
        ∧ [花一输入 O：OpInputCovenantId(O_in)==baked_C_cov_id]（无 (A,s) fallback）
refund: 两 principal 各走 P-SAFE-1 单-live-lineage（LOCKED_R: cutoff 前只 validated-reveal 消费/后退反应方；LOCKED_F: 反应方花 O 领/首动方 T_refund_LOCKED_F 后退，且退窗耦合 O 寿命，无 A-absent 谓词）；O 侧 T_O 相对 O 创建退首动方（详 §2.5/§4-d）
```

🔴 **必须 O-REPLACEMENT**：保留 `(A,s)` fallback ⇒ 反应方可凭 `(A,s)` 在**非最终** reveal 上 claim ⇒ C4-FINALITY 原洞照旧。安全性质只能来自**唯一路径**（J2 判据，采纳）。

## §2.5 显式 principal 拓扑（v0.4 厘清命名 + 双向焊接/耦合）

> 钉死"哪个 principal 在哪个 covenant、哪支揭 s、哪支花 O、refund 寿命怎么耦合"。命名：`LOCKED_R`=反应方本金，`LOCKED_F`=首动方本金。

| 对象 | covenant | 谁的钱 | 唯一合法消费路径 | refund 支时序 |
|---|---|---|---|---|
| `LOCKED_R` | P-SAFE-1 lineage | **反应方**本金 | **首动方揭 s 领走**（§4-d transfer，焊接消费 C 造 O） | `current_daa >= T_cutoff_LOCKED_R` 后退反应方 |
| `LOCKED_F` | P-SAFE-1 lineage | **首动方**本金 | **反应方花 O 领走**（§4-c，O 作 co-input + baked payout） | `current_daa >= T_refund_LOCKED_F` 后退首动方，且 baked `T_refund_LOCKED_F >= T_cutoff_LOCKED_R + N_claim + N_margin`（§4-d 耦合） |
| `C` | cov_id capability | 无（dust 种子） | 首动方 reveal 消费 C 造 O（§4-b） | cutoff 后 terminal-refund（无续链） |
| `O` | C 的续继 | 反应方领 `LOCKED_F` 的凭证 | 反应方花 O（作 §4-c 的 co-input） | `T_O`（相对 O 创建）后首动方回收（无续链） |

🔴 **两个焊接点（v0.4 双向都焊死，缺一即单边盗窃）**：
1. **领 `LOCKED_R` ⟺ 造 O**（v0.3 焊接，§4-d transfer）：首动方揭 s 领反应方本金的同笔 tx 必须消费 C 造 O。
2. **花 O ⟺ 领 `LOCKED_F`**（v0.4 新，§4-c）：反应方花 O 的同笔 tx 必须是 `LOCKED_F` 的 spend 支（O 作 co-input），且 `LOCKED_F` refund 寿命 >= `T_cutoff_LOCKED_R + N_claim + N_margin`（O 寿命 ↔ 被保护 principal 寿命耦合）。
⇒ 首动方拿反应方钱 ⟺ 造 O；反应方凭 O 拿首动方钱、且首动方不能在反应方来得及花 O 前把 `LOCKED_F` 抢回。**双向无单边。**

## §2.6 两两独立性矩阵（v0.5：defer 到 J2 权威全枚举，本节只留 normative 焊接点）

🔵 **权威全枚举 = J2 `docs/2026-08-21-j2-c4-pairwise-independence-matrix.md`**（8 支 C1/C2/R1/R2/F1/F2/O1/O2，28 格全归类，**类别方案与每格判定以该文件为准**——本构造不硬拷其类别列表以免漂，NWT 红队精化中）。改本构造支路时**同步更新 J2 矩阵是义务**（新增支即失效，§1.5 方法边界）。

🔨 前 4 洞 + J2 矩阵逼出的第 5 条同一形状：**两个各自合法动作被留成可独立发生**。本节只钉本构造 **normative 的 WELD/EXCL 焊接点**（每条落码配"松开→必挂"负测）：

| 焊接点 | 类 | 机制 |
|---|---|---|
| 领 `LOCKED_R` ⟺ 消费 C 造 O | WELD | §4-d `OpInputCovenantId(C_idx)==cid`（洞①③） |
| 花 O ⟺ 领 `LOCKED_F`（**双向**） | WELD | §4-c 领 LOCKED_F⟹O co-input（正）**+ §4-e 支1 花 O⟹领 LOCKED_F（反，v0.6 补 Codex 单向焊缝）** |
| C 非-reveal 支 ⇏ 产 lineage | EXCL | terminal `OpCovOutputCount==0`（洞②） |
| reveal-消费-C 与 C-terminal-refund | EXCL | cutoff 排序 `T_cutoff_LOCKED_R <= C_terminal_refund_cutoff`（洞③） |
| 花 O 领 `LOCKED_F` 与 `LOCKED_F`-refund | COUPLED | 时序 `T_refund_LOCKED_F >= T_cutoff_LOCKED_R + N_claim + N_margin`（洞④）+ 🔴 依赖 `reactive-liveness`（§1.5 假设 5） |
| 花 O 与 O 的 T_O 回收 | EXCL | 同 O once-spend + `T_O` 相对锚 |

🔴 **COUPLED 那格的 no-theft 条件于 `reactive-liveness`**（§1.5 假设 5）——结构给窗，反应方须自己在窗内行动，非结构强制。

---

## §3 三闸的源码级答案

### 🟢 闸① cov_id 必须协议派生不可选 —— **闭**

**实读 `kasia-relay/src/lib/p2sh.mjs:1767`**：cov_id 由 **consensus 重算赋**
`cov_id = covenant_id(funding.outpoint, [psOut])` —— 是**创世 funding outpoint 的派生值（像合约地址由部署 outpoint 决定），不是创建者可填字段**（`:1758` 注 "consensus metadata; UtxoEntry.covenantId"；`_psInputCovId` 只读不写）。

⇒ 攻击者要撞一个 `=baked` 的 cov_id，须同时 (a) 找到 hash 到目标值的 funding outpoint = blake2b 系**原像攻击**；(b) 真控且花掉那个特定 outpoint。两者 = 不可行。**"假 cov_id≠baked→BUST" 成立。**
🔵 补强防呆（活先例）：`ShardLeaf.sil:101 require(OpCovOutputCount(ps_cov) >= 1)`（"NWT 钉"）令**零/非法 cov_id 直接 fail**（cid=0 非 covenant 数据→fail，堵 `0==0` 平凡通过——否则相等检查沦为自洽空话）。🔴 **但本构造 reveal 支收紧到 `== 1`（MUST-FIX 2）**：ShardLeaf 允许多续继故用 `>=1`，capability C 要求**唯一**故须 `==1`（`==1` 同时兼防呆+唯一性）。先例 guard 带的是为**别的需求**校准的强度，不可照搬（§0.5 MUST-FIX 2）。

### 🟢 闸② C 创建流双方可独立验唯一 —— **闭（配一条链下义务）**

因每个 candidate C 的 cov_id = f(其 funding outpoint) **各不同** ⇒ 单方私藏多个不同 cov_id 的 C **没有操控优势**：reactive 支只认 baked 那一个 cov_id，别的 candidate 造的 O 全 `OpInputCovenantId(O)==baked` 不过 → BUST。
**前提（= 链下构造方义务，须落 deploy 核验）**：双方在**两腿锁定之前**，各自独立核 `baked_cov_id` = 一个【真上链存在（genesis-mint，cov_id≠0）且具单出口性（闸③）】的 C。= `PayoutShard.sil:26` "漏一条绑定就静默不存在" 同族义务。

### 🔴 闸③ C 只有唯一出口产合法 lineage —— **承重那条：可建，但是【漏写即静默】的授权义务**

cov_id 续链靠 output 上的 `CovenantBinding`（continuation handler 拿 input cov_id 设 output binding，p2sh.mjs:1759）。**哪条 spend 支能产续链 output，由 C 的脚本逐支控**（bshard `PoolSpine_v08_chunk` 就是 per-branch `validateOutputState` 续 `OpInputCovenantId 本 covenant 身份`）。

⇒ **C 必须写成：只有 reveal-claim 支（`checkSigFromStack(A)∧blake2b(s)==h`）许产 cov_id 续链 output；C 的任何 refund/timeout 支【禁止产带 cov_id 的 output】（只许 terminal 明文出）。**

🔴 **=`PayoutShard.sil:26` 病**：这条**漏写就静默开侧门**——若 C 的 refund 支没被显式禁止续链，它照样能产一个"血缘合法但没真 reveal s"的 O ⇒ 伪造面从"外人凭空造"缩成"C 持方走 refund 支绕开 reveal 造 O"。**这正是 J2 自逮的 T_O 侧门的一般化**：不止 O 的 T_O 回收支要终止 lineage，**C 自己的每一条非 reveal 支也要**。

---

## §4 covenant require 清单（每条锚到活先例）

> 记号：`A` = 公开 attestation pubkey（两腿 baked）；`s` = adaptor secret，`h=blake2b(s)`（两腿 baked）；`cid` = baked_C_cov_id。

### (a) capability C（锁前 genesis-mint）
- genesis-mint 一个 covenant 实例，consensus 赋 `cid = covenant_id(funding.outpoint,[C_out])`（不可选，闸①）。
- **C 的 spend 脚本只有两支**：`reveal-claim`（下 b）与 `terminal-refund`（下 d 的 C 侧）。**无第三支、无任何其它支产续链 output**（闸③）。
- 活先例：`unlockBshardGenesisMintPayout`（p2sh.mjs:1767，genesis-mint cov_id≠0）。

### (b) reveal-claim 支（消费 C、造 O）
```
require(checkSigFromStack(A, sig_A));               // A2 原语，canonical 8065184 树
require(blake2b(s) == h);                           // adaptor 揭示
require(OpInputCovenantId(C_in_idx) == cid);        // 消费的是真 C  ← ShardLeaf.sil:99 同款
require(OpCovOutputCount(cid) == 1);                // MUST-FIX 2: 恰一续继(唯一 capability)。==1 同时兼防呆(cid=0 非 covenant→fail, 堵 0==0 平凡通过)+唯一性; ShardLeaf:101 用 >=1 是因它允许多续继, C 要唯一故收紧到 ==1
require(OpOutputCovenantId(O_out_idx) == cid);      // 造的 O 续 cid  ← ShardLeaf.sil:104
require(OpTxOutputSpkSubstr(O_out_idx,0,len) == baked_O_spk);   // O 形状（格式，不承 provenance）
require(tx.outputs[O_out_idx].value >= min_O);      // §5
```

### (c) reactive-claim 支（v0.4：`LOCKED_F` 的 spend 支，O 作 co-input，焊死花 O ⟺ 领 principal）
🔴 **v0.4 拓扑修正（MUST-SPECIFY）**：本支是 **`LOCKED_F`（首动方 principal）covenant 自己的一条 spend 支**，不是纯 O-spend。花 `LOCKED_F` 付反应方 baked payout，**同笔 tx 必须把 O 作 co-input**：
```
// 本支 = LOCKED_F 的 active spend；O 是同笔 co-input
require(current_daa < T_refund_LOCKED_F);           // 🔴 v0.7 上界 guard(Codex F1/F2 race 修): F1 只在 refund 窗前有效
require(checkSigFromStack(A, sig_A));
require(blake2b(s) == h);
require(OpInputCovenantId(O_in_idx) == cid);        // 同笔必须花真 O（血缘续自 C）← ShardLeaf.sil:99 同款
require(OpTxOutputSpkSubstr(payout_idx,0,len) == baked_reactive_payout_spk);  // 付款给反应方 baked 收款（recipient 焊死）
require(tx.outputs[payout_idx].value == LOCKED_F_value);                       // value 焊死（不 skim）
```
🔴 **v0.7 F1 上界 guard（Codex F1/F2 race 修）**：F1（本支）加 `current_daa < T_refund_LOCKED_F`，F2（§4-d LOCKED_F terminal-refund）在 `>= T_refund_LOCKED_F` 开 ⇒ **两支 eligibility 窗互不重叠**（非只靠 UTXO once-spend 落一笔后互斥）。无上界 guard ⇒ 阈值后 F1/F2 可 race。`T_refund_LOCKED_F` 在 LOCKED_F 锁时 baked（可读），非 O-anchored（O 那时不存在）。
⇒ **花 O ⟺ 领 `LOCKED_F`** 原子焊死：花 O 必在这笔（`LOCKED_F` 的 spend），领 `LOCKED_F` 必带 O co-input。无「O 独立于 principal 被消费」的两-tx 缝。
🔵 **`OpInputCovenantId(idx)` 按任意索引读【非 active 输入】= 已证**（ShardLeaf.sil:99 `psInIdx` 非 active 索引，上链跑通）——O 作 co-input（非 active）按索引点准，可建。

### (d) refund / T_O 回收（全部 lineage-terminal，MUST-FIX 1+3+v0.4 耦合）
🔴 **MUST-FIX 1：本金 refund 走 P-SAFE-1 单-live-lineage state machine，不编码 A-absent 谓词**。covenant 证不了链下 A 全局不存在——只能验它自己 LOCKED 对象的**本地正事实**（被没被 validated-reveal 消费过）：

**`LOCKED_R`（反应方本金，首动方揭 s 领）恰两条互斥后继支**：
  - **transfer 支**（cutoff 前，v0.3 原子焊接）：
    ```
    require(current_daa < T_cutoff_LOCKED_R);
    require(checkSigFromStack(A, sig_A));
    require(blake2b(s) == h);
    require(OpInputCovenantId(C_idx) == cid);   // 🔴 v0.3 焊接: 同笔 tx 必须也消费 C ⇒ 触发 C 的 §4-b 强制造 O ⇒ 揭s⟹消费C⟹造O 原子
    ```
    **焊接 require 强制这笔 tx 同时把 C 作为 input**，C 一被消费其 §4-b 支即强制造 O ⇒ 无法"拿反应方本金却不造 O"。
  - **terminal-refund 支**（cutoff 后）：`require(current_daa >= T_cutoff_LOCKED_R)`——still-unspent `LOCKED_R` 转 terminal 明文退**反应方**。互斥由 UTXO once-spend 天然保证。`OpCovOutputCount == 0`。

**`LOCKED_F`（首动方本金，反应方凭 O 领）恰两条互斥后继支**：
  - **reactive-claim 支**（反应方花 O 领）= §4-c（O 作 co-input + baked payout，花 O ⟺ 领 `LOCKED_F` 焊死）。
  - **terminal-refund 支**（首动方超时收回）：🔴 **v0.4 耦合（MUST-FIX，shape A）**：`require(current_daa >= T_refund_LOCKED_F)`，且 baked 不等式 **`T_refund_LOCKED_F >= T_cutoff_LOCKED_R + N_claim + N_margin`**（同 DAA 域）。⇒ 首动方最早只能在"反应方拿到 O（最晚 `T_cutoff_LOCKED_R` reveal）+ 落链余量"之后收回 `LOCKED_F`，**堵住"造真 O 却抢先 refund 自己 principal"**。`OpCovOutputCount == 0`。

🔴 **cutoff 排序不变量（焊接生效前提）**：`T_cutoff_LOCKED_R <= C_terminal_refund_cutoff`（否则同笔走 C 的 terminal-refund 不造 O 绕过 v0.3 焊接）。
🔴 **单位显式标注（NWT 钉）**：`T_cutoff_LOCKED_R` / `C_terminal_refund_cutoff` / `T_refund_LOCKED_F` / `T_O` 全部**同为 DAA-score（`< 5e11`）**，与 v1.3 总裁同单位。新引入的比较对（尤其 v0.4 的 `T_refund_LOCKED_F >= T_cutoff_LOCKED_R + N_claim + N_margin`）落码时 ctor 参数须显式同单位来源，混单位 ⇒ 比较 vacuous（floor-direction footgun 族）。
- **O 的 T_O 回收**（付回首动方）：见 §4-e 的 O 支 2。
- **C 的 terminal-refund**：`OpCovOutputCount == 0`（闸③）。

### (e) O 自己的 covenant 支路（v0.6 显式定义，从 O 的实际 spend 条件导出——反向焊）
🔴 **根因修（Codex v0.5 缝）**：v0.5 从没显式写 O 自己的 covenant 支，只从"意图"（O 被 F1 co-input 消费）推断。⇒ 显式定义 O 恰两支，**均从 O 的实际 spend 条件写死**：

🔴 **v0.7 O 边界纯相对（Shape A1）**：O 的两支边界只用 `OpTxInputDaaScore(O) + N_claim + N_margin`（O 是本支 active input ⇒ 该量可读），**不引 baked `T_O` 常量**（避免"两个 baked 常量各自合法、相对值错"的不可 enforce 陷阱）。

- **O 支 1（pre-timeout：反向焊，只能与 LOCKED_F reactive-claim 同笔）**：
  ```
  require(current_daa < OpTxInputDaaScore(O) + N_claim + N_margin);   // 纯相对上界(O active⇒可读)
  require(OpInputCovenantId(LOCKED_F_idx) == locked_f_cid);           // 🔴 反向焊: 同笔必须也花 LOCKED_F
  require(OpTxOutputSpkSubstr(payout_idx,0,len) == baked_reactive_payout_spk);  // 且付反应方 baked 收款
  require(tx.outputs[payout_idx].value == LOCKED_F_value);            // value 焊死
  ```
  ⇒ **花 O ⟹ 必同笔领 LOCKED_F 给反应方**。s/A 公开也没用：独立花 O（不带 LOCKED_F co-input）**过不了本支** ⇒ 外人毁不了 capability。
- **O 支 2（回收：首动方超时收回）**：`require(current_daa >= OpTxInputDaaScore(O) + N_claim + N_margin)`（与支 1 上界同式，互斥），付首动方，`OpCovOutputCount == 0`（terminal）。

🔵 **双向互焊闭合**：§4-c（领 LOCKED_F ⟹ O co-input）+ §4-e 支 1（花 O ⟹ 领 LOCKED_F）= **O 与 LOCKED_F 窗内只能一起花**。O 支集 = 恰 2 支。
🔴 **ordering 非 equality（v0.7 Shape A1，取代 v0.6 不可 enforce 的 equality）**：反应方能凭 O 领 LOCKED_F 的窗到 `OpTxInputDaaScore(O)+N_claim+N_margin`（O 支 1 上界，且 F1 §4-c 加了同向 `< T_refund_LOCKED_F` 上界）；首动方能 refund LOCKED_F 从 `T_refund_LOCKED_F`（F2）。安全所需 = **`T_refund_LOCKED_F >= 最晚可能 O 创建 daa + N_claim + N_margin`**。而最晚 O 创建 daa `< T_cutoff_LOCKED_R`（§4-d transfer 支 covenant 限 reveal 窗）⇒ **v0.4 baked 不等式 `T_refund_LOCKED_F >= T_cutoff_LOCKED_R + N_claim + N_margin`（§4-d）已保守满足此 ordering**，且它是 baked 时刻可读的量（`T_cutoff_LOCKED_R` 锁 LOCKED_F 时已知）——**非 equality、非 O-anchored、可 enforce**。落码只须精确 off-by-one（`>=` vs `>`）。

---

## §5 min_O / T_O / spk∧value 双 require

- **spk∧value 必须一起 require**（reveal-claim 支）：只查 spk 不查 value，首动方可造 dust/0 值形似 O，反应方花它付不起费 = 等价没造（malform 绕过，J2 §2-b）。
- **min_O 口径**：≥ 反应腿 claim 最坏手续费 + KIP-9 存储质量地板。**复用既有常量**（`_BSHARD_FEE_PER_INPUT = 1_000_000n` 等），不新造。🟡 具体数值未拍（§7）。
- **T_O 相对锚（MUST-FIX 3）**：回收支 `require(current_daa >= OpTxInputDaaScore(O) + N_claim + N_margin)`——锚在 **O 自己 input 的 DAA**（本地祖先事实），`N_claim`（反应方 claim 落链最坏 DAA 跨度）+ `N_margin` 是**相对时长**，不是绝对 deadline。理由：O-lineage 采纳初衷=不靠外部/模糊 finality 钟；绝对窗会重新引入无锚绝对时间。太早（N 太小）⇒ 首动方抢回 O ⇒ 反应方结构性 claim 不了 = 新洞，故 N 须保守上界（§7）。

---

## §6 deploy 不变量（漏一条静默不存在）+ 负测

1. **genesis-mint 义务**：relay 必 ① 把 C genesis-mint 为 covenant（`cid≠0`）② 每个 continuation output 续 `CovenantBinding(cid)` ③ 建 v1 tx（`TX_VERSION_TOCCATA`）+ compute_budget。**covenant 自己检查不出"当初没 mint"**（`PayoutShard.sil:26` 同款）。
2. **唯一续继变异负测（MUST-FIX 2，承重·J2 验收族 B）**：① 把 reveal 支的 `OpCovOutputCount(cid) == 1` 改成 `>= 1` ⇒ 验收**必须挂**；② 让某条 terminal/refund/cancel 支产出**一个续链 output**（`OpCovOutputCount != 0`）⇒ 验收**必须挂**。⇒ 唯一性靠"改松有人红"，非"记得写 ==1"。**漏则闸③/唯一 capability 静默失效。**
2b. 🔴 **原子焊接负测（v0.3·NWT 缝·【交易级】变异，与上面语句级不同层）**：把 `LOCKED-transfer` 与 `C-consume/O-create` **拆成两笔 tx 分别提交** ⇒ 领本金那笔（LOCKED-transfer）**必须被拒**（因焊接 require `OpInputCovenantId(C_idx)==cid` 在同笔找不到 C）。J2 判据：这条缝的**缺失约束不在任何一行代码里**，故负测改的是【怎么提交】不是【哪一行 require】——J2 验收族 B 已加（`86c04c55`）。附：cutoff 排序负测——令 `T_cutoff_LOCKED > C_terminal_refund_cutoff`，构造"同笔消费 C 走 C 的 terminal-refund（不造 O）"⇒ 必须被拒。
2c. 🔴 **O ↔ 被保护 principal 双向焊接负测（v0.4+v0.6·Codex 逮·交易级 + 配置级）**：
   - **正向**：花 `LOCKED_F`（领 principal）而**不带真 O** input ⇒ **必拒**（§4-c）。
   - 🔴 **反向（v0.6 补 Codex 单向焊缝）**：**独立花真 O**（pre-timeout，**不带 `LOCKED_F` co-input / 不付反应方 baked payout**）⇒ **必拒**（§4-e 支1）。这条是关键：s/A 公开后独立花 O 的 griefing，只有 O 自己的 covenant 反向焊能挡，F1 侧 co-input 挡不住。
   - 🔴 **边界负测 5 格（v0.7 Shape A1，Codex 给·取代 v0.6 不可 enforce 的 equality 负测）**：
     1. **F1@`>= T_refund_LOCKED_F`** → 拒（§4-c 上界 guard）；
     2. **F2@`< T_refund_LOCKED_F`** → 拒（§4-d LOCKED_F terminal-refund 下界）；
     3. **O1@`>= OpTxInputDaaScore(O)+N_claim+N_margin`** → 拒（§4-e 支1 上界）；
     4. **O2@`< OpTxInputDaaScore(O)+N_claim+N_margin`** → 拒（§4-e 支2 下界）；
     5. 🔴 **错序 ⇒ theft race 可达（承重非装饰）**：令 baked `T_refund_LOCKED_F < T_cutoff_LOCKED_R + N_claim + N_margin` ⇒ **F1/F2 抢跑/盗窃攻击必须 LAND**（否则这条 ordering 是装饰，将来会被顺手简化掉）。这是**配置级**（`T_refund_LOCKED_F` 与 `T_cutoff_LOCKED_R` 均 baked、可读，ordering 可 enforce——区别于 v0.6 那条 O-anchored 的不可 enforce equality）。
3. **A-absent 全清核（MUST-FIX 1）**：全文 grep `A-absent` 必须**零命中**于 normative 构造（只许出现在 §0.5 变更说明里作为"已清除的旧写法"）。refund 只走 §4-d 的 still-unspent LOCKED state machine。
4. **A2 腿 e2e**：`checkSigFromStack` 合法签过 / 改一位拒 —— 必在 canonical `8065184` 树上编 + 上链跑，读 codegen 不算（OP_PICK 教训）。
5. **cov_id 派生 e2e**：造两个不同 funding outpoint 的 candidate C，验其 cid 不同、且只有 baked 那个的 O 过 reactive 检查。

---

## §7 明列未决（不假装闭合）

1. **运营取值三项（min_O / N_claim / N_margin）无权威值，我不拍数字** —— `min_O`（§5，≥反应腿 claim 最坏费+KIP-9 地板）、`N_claim`（反应方 claim 落链最坏 DAA 跨度）、`N_margin`（T_O 相对锚安全余量，§4-d）。同链可保守上界（本链费市场/DAA 产出率可读，比 §6-3 B 跨链版好定），仍须落**具名保守常量**（复用既有 `_BSHARD_FEE_PER_INPUT` 等），不硬编经验值。
2. **checkSigFromStack A2 腿的 canonical-树 e2e 尚未跑**（§6.4）—— 本构造落码前硬前置，归 canonical `8065184` 树（非我这台）。
3. **cov_id 协议派生须落 durable 源码/runtime 证（Codex MSG-260 附加条件）** —— §3闸① 引 `p2sh.mjs:1767` 是 relay 侧构造注释；真权威=实际 Toccata path（consensus）的 cov_id 派生规则，须落一份 durable 源码/runtime 证据（同 silverc provenance doc 做法），不停在"relay 注释这么说"。
4. **跨链完全不适用 + 仍需正 finalized-reveal 证** —— 反应腿花不了对手链的 O，退 R1/light-client（Codex MSG-260 明示本轮不闭跨链）。

---

## §8 可建性证据表

| 构造件 | 原语 | 证据（活先例 / 编译器） | 状态 |
|---|---|---|---|
| 读非 active 输入 cov_id | `OpInputCovenantId(idx)` | `ShardLeaf.sil:99`（上链+NWT 红队） | ✅ 已证 |
| 强制续链输出 | `OpOutputCovenantId(idx)==cid` | `ShardLeaf.sil:104` | ✅ 已证 |
| 唯一续继（兼防呆） | `OpCovOutputCount(cid)==1`（MUST-FIX 2） | `ShardLeaf.sil:101` 用 `>=1`（允许多续继），本构造收紧 `==1` | ✅ 原语已证·`==1` 待验收变异负测 |
| terminal 支零续链 | `OpCovOutputCount==0` | `PoolSpine` per-branch 管控同款 | ✅ 原语已证·待变异负测 |
| cov_id 共识派生不可选 | consensus metadata | `p2sh.mjs:1767` `covenant_id(outpoint,[out])` | ✅ 已证 |
| per-branch 续链管控 | `validateOutputState` | `PoolSpine_v08_chunk.sil:93/226` | ✅ 已证 |
| O 形状 | `OpTxOutputSpkSubstr` / `.value` | `compile.rs:3572` + CloseZkV2:125-126 | ✅ 已证 |
| hashlock | `blake2b` | 既有 covenant 普遍用 | ✅ 已证 |
| 时锁下界 | `tx.time >= X`（DAA） | `ShardLeaf.sil:96`、30 处 lower-bound | ✅ 已证 |
| 多 covenant-input 一笔 tx（LOCKED+C 原子焊接） | `OpCovInputCount`/`OpCovInputIdx` + `OpInputCovenantId(C_idx)` | compile.rs:3577-78 + `ShardLeaf:99` 读非 active input cov_id | ✅ 已证（Q① 裁可建） |
| adaptor 揭示签 | `checkSigFromStack(A)` | canonical `8065184`（#132） | 🟡 待 canonical 树 e2e |

⇒ **净判断（v0.7）**：Codex 判**架构 GREEN**，v0.6 反向焊 PASS AS DESIGN。**v0.7 走 Shape A1 修 Codex v0.6 逮到的 anchor 不可 enforce + F1/F2 race**：删假 equality（§4-e）+ F1 上界 guard `< T_refund_LOCKED_F`（§4-c）+ O 边界纯相对 `OpTxInputDaaScore(O)+N_claim+N_margin`（§4-e）+ ordering 非 equality（v0.4 baked 不等式 `T_refund_LOCKED_F >= T_cutoff_LOCKED_R+N_claim+N_margin` 已保守满足，可 enforce）+ 5 边界负测（§6.2c）。**落码前硬前置 = ① 各 WELD/EXCL/COUPLED + 5 边界松开负测（§6.2*+J2 矩阵） ② A2 腿 canonical `8065184` 树 e2e ③ cov_id 派生 durable 证 ④ min_O/N_claim/N_margin 具名保守常量 ⑤ §1.5 五假设兜住 ⑥ quorum 独立 pre-real-funds**。v0.7 送 Codex 复审过 ⇒ 同链 design-closed = 无委员结构 Tier-2（**条件于 §1.5 假设**）。跨链退 R1。落码 Owner 批实现闸。
