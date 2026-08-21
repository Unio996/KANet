# §6-3 A：fair-exchange 结算 covenant 完整构造（v0.15 · 报备层 · 零生产码）

> **Status**: CURRENT（v0.15：normative-body 全 sweep 到 Shape-B 实际支集·完备 grep 零命中验证过·非 claim）
> **作者** J1 · **日期** 2026-08-21 · **派工** Bettor checklist ①④⑤ + Codex v0.12（e281a2ca）两 MUST-FIX

> 🔴🔴 **§0.x 全部为【历史变更记录·NON-NORMATIVE】**（Codex v0.12 MUST-FIX 2 要求显式标）：以下所有 §0.x 描述**演化过程**，早期条目（§0.5-§0.10 等）的 Shape-A 文字（`current_daa < X` / `花 O ⟺ 领 LOCKED_F` / `latest O creation <= T_cutoff` / equality-anchor 等）**均已被后版取代、不作规范**。**当前规范正文 = §1 起**（§1.5 假设 / §2 三步 / §2.5 拓扑 / §2.6 焊接点 / §4 covenant 清单 / §6 负测）。读规范只读 §1+；§0.x 只为审计演化史。

## §0.17 v0.15 变更（normative-body 全 sweep·完备 grep 零命中验证）
v0.14 claim"全完成"但三方(J2 grep+NWT 深读+Codex v0.14)逐条抓出残留 Shape-A 死分支/死论证(§4-f F1/F2 表·§4-e latest-O-creation 死论证·§6.2b F2/T_refund_LOCKED_F 负测·§4-d giveup 无效 free-option claim·units 段·§2/§2.6 多处)。= 我第 N 次 partial-sweep 却 claim 完整。
🔨 **终结 partial-sweep 循环**：Bettor/Codex 给强制**可验证完备判据**——规范正文(§1+)grep 以下 token 须全零命中：`F1` `F2` `T_refund_LOCKED_F` `T_O` `花 O ⟺ 领 LOCKED_F` `latest O creation` `current_daa` `退化成真正` `领 LOCKED_F`。**v0.15 已跑 grep = 0**(验证过非 claim)。支集全改 Shape-B 实际(LOCKED_F:transition/giveup·O_AUTHORIZED:claim/recovery 锚 OpTxInputDaaScore(O_AUTHORIZED)+N·O:reciprocal)。

## §0.16 v0.13 变更（Codex v0.12 两 MUST-FIX + Bettor checklist ①④⑤）

Codex 复审 v0.12：多项 PASS（Shape-B 方向 / 四路焊方向 / O↔O_AUTHORIZED 焊 / v0.12 ==0 sweep / 两轴方法论），但两 MUST-FIX：
- 🔴 **MUST-FIX 1（我认：free-option "closed" 证无效，又一次"下界 close 不了对面窗"）**：v0.11 `T_giveup_LOCKED_F >= T_cutoff_LOCKED_R` 我 claim"giveup 只在 reveal 窗关后"——**错**。下界-only 下 `T >= T_cutoff_LOCKED_R` 只让 LOCKED_R refund **可用**、**不 close reveal 窗**（reveal 无上界）⇒ 阈值后首动方仍有 **race-dependent 选择**（reveal vs giveup）。⇒ **诚实**：giveup 排序**降低不消除** free-option；残留 = 阈值后首动方 late-reveal-vs-giveup race，**由 reactive 及时 refund LOCKED_R（reactive-liveness，§1.5 假设 5）bound**，非结构消除。matrix Fb 格须相应改（下界排序≠close 对面支）。
- 🔴 **MUST-FIX 2（我认：normative 残 Shape-A 文字 + oauth_cid provenance 门）**：(a) ①命名 sweep（§2.5 已改，§4-f 续）。(b) **`oauth_cid` provenance 门**：O_AUTHORIZED 在 reveal tx 创建（reveal 前 tx/outpoint 不存在），双方怎么 reveal 前 bake `oauth_cid`？**解（我域；Codex v0.10 已预留"除非 continuity 显式设计+机械证"）**：O_AUTHORIZED **续 LOCKED_F 的 cov_id lineage**（CovenantBinding 续链：`OpInputCovenantId(LOCKED_F)==locked_f_cid → OpOutputCovenantId(O_AUTHORIZED)==locked_f_cid`）⇒ **`oauth_cid ≡ locked_f_cid`（同一 lineage 身份、跨转移稳定、LOCKED_F session-time genesis-mint 时已 bake）**。故 O 反向焊引 `locked_f_cid`（= 续链身份）reveal 前可 bake，provenance 门闭。
- ✅ **checklist ②③ 已 v0.11/v0.12 做**；**①④⑤ 本版**：①命名 sweep · ④四路省略任一路→拒 交易级负测 · ⑤O 侧焊 stale-input/无 O_AUTHORIZED→拒 负测（§6.2 补）。

## §0.15 v0.12 变更（NWT/J2 两轴矩阵逮 3 条 terminal 支漏闸③）
NWT 独立核 v0.11 §4-d：`Fb`（giveup）缺 `OpCovOutputCount==0`——违反闸③（每条非-reveal 支须显式禁续 lineage）。**判据（J2）：新增一支须拿【全部】已确立不变量逐条过，非只想到哪条查哪条**（我/J2 加 giveup 时只想着时序、漏了 lineage-terminal；两轴矩阵的"支×不变量"轴才照得到单支合规）。⇒ 我**扫全 Shape B 支集**（非只 NWT 逮那条），补齐 3 条缺的：**§4-c reactive-claim（`OpCovOutputCount(oauth_cid)==0`）· §4-e O支1（`OpCovOutputCount(cid)==0`）· §4-d giveup（`OpCovOutputCount(locked_f_cid)==0`）**——均 terminal payout 支、应无续链。已有的（LOCKED_R-refund/O_AUTHORIZED-recovery/O支2/C-refund）不动。= 同 clamp-repeat-offender（扫全构造非修一实例）。

## §0.14 v0.11 变更（J2 矩阵 v7 逮 giveup 支 free-option）
J2 据 v0.10 Shape B 重建矩阵（5 对象 10 支=45 对），逮到新支 `Fb`（LOCKED_F giveup）的 `T_giveup_LOCKED_F` 全文只定义一次、**未与 `T_cutoff_LOCKED_R` 排序**。若 `T_giveup < T_cutoff`：非盗窃（giveup 后 reveal 不可构造），但**单方免费期权**（首动方观望到 T_giveup 零成本中止，对手 LOCKED_R 期间被锁）。⇒ 加 baked 排序 `T_giveup_LOCKED_F >= T_cutoff_LOCKED_R`（§4-d，giveup 只在 reveal 窗关后行使）+ 错序负测。🔨 J2 方法论印证："新增任一支矩阵即失效"——`Fb` 一出现带来 9 个新对，排序约束在这些新对里才显形。

## §0.13 v0.10 变更（Codex v0.9：Shape B 重构不完整的两处内部不一致 = MUST-FIX，我认不完整重构）

Codex 复审 v0.9：**Shape B 方向对 + 多项 PASS**（Shape-B pivot / recovery 锚实际后继 / confirm-not-broadcast / 去上界 guard 全 PASS），但读 normative §4 为实际 UTXO 图逮两处内部不一致（我 v0.9 只改了部分节到 Shape B）：

- 🔴 **MUST-FIX 1（reveal 仍能完全省略 LOCKED_F）**：v0.9 声称四路原子，但 `LOCKED_F→O_AUTHORIZED` 的 require **只在 LOCKED_F transition 支内**，而该支**只在 LOCKED_F 实际作 input 时才评估**。⇒ 攻击者 reveal 可**不含 LOCKED_F**：花 `LOCKED_R + C`、造真 O、领反应方本金，同时**首动方原 LOCKED_F 原封不动** ⇒ 后续 giveup/refund 拿回 LOCKED_F = **双拿**。**修**：领 LOCKED_R 的 §4-d transfer 支**自身**必须 force 同笔消费 exact LOCKED_F + 造 exact O_AUTHORIZED（把四路焊到 LOCKED_R 领取路上，非只在可跳过的 LOCKED_F 支内）。= 同"焊在一侧、另一侧可跳"老病（我 v0.9 refactor 不完整）。
- 🔴 **MUST-FIX 2（O 侧反向焊 stale 到 LOCKED_F）**：§4-c 已对（反应方花 **O_AUTHORIZED**），但 §4-e O 的反向焊仍要 `OpInputCovenantId(LOCKED_F_idx)==locked_f_cid`——**Shape B 下 LOCKED_F 已被 reveal 消费、UTXO 不存在** ⇒ happy path 内部矛盾。**修**：§4-e 反向焊改引 `oauth_cid`（O_AUTHORIZED 身份），"花 O ⟺ 领 **O_AUTHORIZED**"，与 §4-c 一致。`oauth_cid` 是 O_AUTHORIZED 的 covenant 身份（非 spent 的 LOCKED_F）。
- 🔵 **§4-f/§2.6 matrix 须据 Shape B 实际支集重建**（LOCKED_F：transition/giveup；O_AUTHORIZED：claim/recovery），旧 F1/F2/LOCKED_F 格不作 closure 证据（J2 重建中）。**PASS 项**（Codex）：Shape-B pivot / 锚实际后继 / confirm 假设 / 去上界，均 PASS DIRECTION。

## §0.12 v0.9 变更（Codex v0.8：删上界塌了 Shape A ordering ⇒ Shape B 必需 + liveness→confirm + 真原语）

Codex 复审 v0.8：**下界-only pivot 方向 PASS**（反向焊/P-SAFE-1/唯一续继/O 相对 recovery 全 PASS），但**竞争支路重构塌了 Shape A 的本金寿命耦合**：

- 🔴 **MUST-FIX 1（T_cutoff_LOCKED_R 不再是最晚 reveal 界，我认自引连锁）**：v0.8 删 reveal `< T_cutoff_LOCKED_R` 上界后，`T >= T_cutoff_LOCKED_R` 只让 refund **可用**、reveal 支**仍有效** ⇒ 首动方**晚 reveal**（cutoff 后若 LOCKED_R 没被 refund 落链，广播晚 reveal 抢赢 once-spend、消费 LOCKED_R+C、**cutoff 后**造真 O）。而 `T_refund_LOCKED_F` 从 `T_cutoff_LOCKED_R+N` 静态导 ⇒ 离**实际** O 创建可能不足 N ⇒ 抢 refund LOCKED_F ⇒ **双拿**。**Shape A v0.4 ordering 整个依赖"T_cutoff_LOCKED_R=最晚 reveal 界"，而那依赖已删的不可 enforce 上界 ⇒ 塌**。🔴 **我 §4-f 漏此**（推理"latest O creation <= T_cutoff_LOCKED_R"前提随上界删除静默失效），grep 也漏 = [[feedback-samples-sharing-a-hidden-precondition-cannot-support-a-necessity-claim]] 又一实例（删上界这动作使一条被依赖前提静默失效）。
- 🎯 **修法 = Shape B 现【必需】**（我早前推 A 是 buildability 发现之前、现 A 塌）：reveal 消费 LOCKED_R+C 造 O 的**同一笔 tx 把 LOCKED_F 转 `O_AUTHORIZED` 后继**，其 recovery 下界 = `OpTxInputDaaScore(O_AUTHORIZED) + N_claim + N_margin`（= reveal DAA = **实际** O 创建坐标，consensus-visible，**无上界依赖**）⇒ 机制保证 `O 于 d 创建 ⟹ 被保护本金在 d+N 前不能回首动方`，不假设 reveal 在任何不可 enforce 上界前。
- 🔴 **MUST-FIX 2（liveness→confirm）**：阈值后 claim 支与 recovery 支都 valid 到一笔落链 ⇒ once-spend 只保唯一、不保**谁赢**。§1.5 假设 5 改：得利方 claim 须在对方 recovery 下界**开之前 LAND/CONFIRM**（bounded-inclusion/抗审查假设，N_claim+N_margin 表征），**非"广播"**（mempool 里未确认仍可能输给变 valid 的 recovery）。watchtower 须**确认**非只广播。
- 🔴 **MUST-FIX 3（真原语，去 phantom）**：normative 里 `current_daa >= X` 是 phantom（语言不暴露 current_daa）⇒ 冻**真 SilverScript 原语**：下界用 `TxTime`（→ `OpCheckLockTimeVerify`/CLTV）语义，相对锚用 `OpTxInputDaaScore(输入)`（读被花输入的历史 DAA）。承重 spec 不留 pseudo-var。

## §0.11 v0.8 变更（`current_daa < X` 上界全不可 enforce ⇒ 竞争支路系统性重构 + 逐对重证）

🔴 **根发现（J2 @canonical `8065184` 实证 + NWT 文档核 + 我编译器核）**：SilverScript 只有两个时间变量 `TimeVar{ThisAge→OpCheckSequenceVerify, TxTime→OpCheckLockTimeVerify}`，**都是下界锁（"不早于"）**；**无任何读【当前/本块 DAA】的量**（唯一 DAA builtin `OpTxInputDaaScore` 读 input 历史值、不前进）。⇒ **`current_daa < X`（"不晚于"）在语言里根本不可表达**。

- 🔴 **我 v0.7 的错（+ 复发根因）**：v0.7 §4-c F1 加的 `require(current_daa < T_refund_LOCKED_F)`、§4-e O支1 的 `< OpTxInputDaaScore(O)+N`、§4-d transfer 的 `< T_cutoff_LOCKED_R`——**三处全是上界，全不可 enforce**。而我**今天 17:28 就已确立"lockTime 只能造'不早于'、造不出'不晚于'"并把 reveal 上界改成竞争支路**——v0.7 却在别处以 `current_daa <` 新名字重犯。🔨 **判据（记）`clamp-repeat-offender`**：**一条已确立的语言限制会在别处以伪装再犯（这次叫 `current_daa <`、上次叫 `tx.time < T_reveal`）；确立限制后必须【扫全构造每一处】，不是修一个实例。**
- ✅ **修法（竞争支路·下界-only，系统性套用我 17:28 pattern）**：**删全部 `< X` 上界**；"必须 X 前行动"改成"**对方的 recovery/refund 支在 `>= X` 开（下界，可 enforce）+ 你须此前行动**"。你的窗独占性**来自对方支的下界**（X 前对方支 lower-bound 不满足=链上直接拒=对方碰不了那 UTXO），**不来自你自己的上界**。once-spend 处理阈值竞态，liveness（§1.5）兜"你须此前动"。
- ✅ **逐对 no-theft 重证见 §4-f**（Bettor 要求：非"once-spend 一句"，须逐对显式）。三对：reveal/`LOCKED_R`-refund · F1/F2 · O1/O2。
- 🟡 **性质微调（诚实）**："X 前行动"从**结构强制**降为**下界独占窗 + liveness**——与标准 HTLC 同（HTLC 只用下界超时）。no-theft 对**活方**仍结构成立（对方 X 前碰不了），惰方自负（已在 reactive-liveness 假设族）。

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

Codex 判 v0.3 **架构 GREEN、4 项已接受全 PASS**（A-absent removal / 唯一续继 ==1 / O-recovery 相对锚 / 两-lineage 焊接），但逮到**对称的一条残留盗窃**：

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
| 5 | 🔴 `reactive-liveness`（v0.5·v0.9 改 confirm） | 得利方 claim 须在对方 recovery 下界**开之前 LAND/CONFIRM**（非只广播）——`[O_creation, O_creation+N_claim+N_margin)` 内确认。**任何人可代广播**（claim payout baked 到反应方，改不了向 ⇒ watchtower/第三方可代，J2 弱化），但**须落链确认**非只进 mempool（MUST-FIX 2：未确认的 claim 阈值后仍可能输给变 valid 的 recovery）。N_claim+N_margin = bounded-inclusion/抗审查表征 | 未在窗内确认 ⇒ 对方 recovery 落链 ⇒ 得利方失（**活性假设，结构不保**） |

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
refund: LOCKED_R P-SAFE-1（cutoff 前只 validated-reveal 消费/后退反应方）；LOCKED_F reveal 转 O_AUTHORIZED（Shape B），反应方凭 O 领 O_AUTHORIZED / 首动方 recovery 锚实际 reveal DAA 后退；无 A-absent 谓词（详 §2.5/§4-d/§4-e）
```

🔴 **必须 O-REPLACEMENT**：保留 `(A,s)` fallback ⇒ 反应方可凭 `(A,s)` 在**非最终** reveal 上 claim ⇒ C4-FINALITY 原洞照旧。安全性质只能来自**唯一路径**（J2 判据，采纳）。

## §2.5 显式 principal 拓扑（v0.4 厘清命名 + 双向焊接/耦合）

> 钉死"哪个 principal 在哪个 covenant、哪支揭 s、哪支花 O、refund 寿命怎么耦合"。命名：`LOCKED_R`=反应方本金，`LOCKED_F`=首动方本金。

> 🔴 **v0.13 ① Shape-B 命名 sweep**：LOCKED_F 在 reveal 被消费**转成 O_AUTHORIZED 后继**（非反应方直接领首动方原 LOCKED_F 锁）；refund 寿命论证换成锚**实际 reveal DAA**（`OpTxInputDaaScore(O_AUTHORIZED)`）非 baked cutoff。

| 对象 | covenant | 谁的钱 | Shape-B 支路 | 时序（全下界·真原语 TxTime/CLTV） |
|---|---|---|---|---|
| `LOCKED_R` | P-SAFE-1 | **反应方**本金 | transfer（首动方揭 s 领，四路焊 §4-d）/ terminal-refund | refund `TxTime >= T_cutoff_LOCKED_R` 退反应方 |
| `LOCKED_F` | P-SAFE-1 | **首动方**本金 | **transition→O_AUTHORIZED**（reveal 强制，§4-d Fa）/ **giveup**（§4-d Fb） | giveup `TxTime >= T_giveup_LOCKED_F`（baked `>= T_cutoff_LOCKED_R`）退首动方 |
| `O_AUTHORIZED` | LOCKED_F 的 reveal-后继 | = 首动方本金（反应方凭 O 领） | reactive-claim（§4-c，O 作 co-input）/ recovery | recovery `TxTime >= OpTxInputDaaScore(O_AUTHORIZED)+N`（**实际 reveal DAA**）退首动方 |
| `C` | cov_id capability | 无（dust 种子） | reveal 消费造 O（§4-b）/ terminal-refund | refund cutoff 后（无续链） |
| `O` | C 的续继 | 反应方领 `O_AUTHORIZED` 的凭证 | reactive-spend（§4-e 支1，作 §4-c co-input）/ recovery | recovery `TxTime >= OpTxInputDaaScore(O)+N` 退首动方（无续链） |

🔴 **焊接点（Shape B，v0.14 sweep 到 O_AUTHORIZED）**：
1. **领 `LOCKED_R` ⟺ 四路原子**（§4-d transfer 支自身 force）：首动方揭 s 领反应方本金的同笔 tx 必须消费 C 造 O **且**消费 exact LOCKED_F 造 exact O_AUTHORIZED（续 `locked_f_cid`）。省略任一路则领不了 LOCKED_R。
2. **花 O ⟺ 领 `O_AUTHORIZED`**（双向，§4-c 正 + §4-e 支1 反）：反应方 claim 的同笔 tx 花 O 与花 O_AUTHORIZED 互为 co-input、付反应方 baked。O_AUTHORIZED recovery 锚**实际 reveal DAA**（`OpTxInputDaaScore(O_AUTHORIZED)+N`），无上界依赖。
⇒ 首动方拿反应方钱 ⟺ 造 O + O_AUTHORIZED；反应方凭 O 拿首动方钱（O_AUTHORIZED）、首动方 recovery 下界锚实际 reveal DAA 给反应方独占窗。**无单边**（free-option 残留由 reactive-liveness bound，§0.16 MUST-FIX 1）。

## §2.6 两两独立性矩阵（v0.5：defer 到 J2 权威全枚举，本节只留 normative 焊接点）

🔵 **权威全枚举 = J2 `docs/2026-08-21-j2-c4-pairwise-independence-matrix.md`**（Shape B 支集：LOCKED_R{transfer/refund}·C{reveal/refund}·LOCKED_F{transition Fa/giveup Fb}·O_AUTHORIZED{claim/recovery}·O{spend/recovery} = 5 对象 10 支，全归类，**类别方案与每格判定以该文件为准**——本构造不硬拷以免漂，J2 矩阵 v8 两轴+Fb 格已改标）。改本构造支路时**同步更新 J2 矩阵是义务**（新增支即失效，§1.5 方法边界）。

🔨 前 4 洞 + J2 矩阵逼出的第 5 条同一形状：**两个各自合法动作被留成可独立发生**。本节只钉本构造 **normative 的 WELD/EXCL 焊接点**（每条落码配"松开→必挂"负测）：

| 焊接点 | 类 | 机制 |
|---|---|---|
| 领 `LOCKED_R` ⟺ 消费 C 造 O | WELD | §4-d `OpInputCovenantId(C_idx)==cid`（洞①③） |
| 花 O ⟺ 领 `O_AUTHORIZED`（**双向**，v0.10 Shape B） | WELD | §4-c 领 O_AUTHORIZED⟹O co-input（正）+ §4-e 支1 花 O⟹领 O_AUTHORIZED（反）。**LOCKED_F 已被 reveal 消费成 O_AUTHORIZED，反应方领的是后继非 LOCKED_F 本身** |
| 领 LOCKED_R ⟺ 四路（消费 C+LOCKED_F+造 O+O_AUTHORIZED） | WELD | §4-d transfer 支自身 force（v0.10 MUST-FIX 1：省略任一路则领不了 LOCKED_R）|
| C 非-reveal 支 ⇏ 产 lineage | EXCL | terminal `OpCovOutputCount==0`（洞②） |
| reveal-消费-C 与 C-terminal-refund | EXCL | cutoff 排序 `T_cutoff_LOCKED_R <= C_terminal_refund_cutoff`（洞③） |
| 花 O_AUTHORIZED（领 principal）与 `O_AUTHORIZED`-recovery | COUPLED | recovery `>= OpTxInputDaaScore(O_AUTHORIZED)+N`（锚实际 reveal DAA）+ 🔴 依赖 `reactive-liveness`（§1.5 假设 5，confirm-before-recovery） |
| 花 O 与 O 的 O-recovery 回收 | EXCL | 同 O once-spend + `OpTxInputDaaScore(O)+N` 相对锚 |

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

🔴 **=`PayoutShard.sil:26` 病**：这条**漏写就静默开侧门**——若 C 的 refund 支没被显式禁止续链，它照样能产一个"血缘合法但没真 reveal s"的 O ⇒ 伪造面从"外人凭空造"缩成"C 持方走 refund 支绕开 reveal 造 O"。**这正是 J2 自逮的 O-recovery 侧门的一般化**：不止 O 的 O-recovery 回收支要终止 lineage，**C 自己的每一条非 reveal 支也要**。

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

### (c) reactive-claim 支（v0.9 Shape B：`O_AUTHORIZED`（LOCKED_F 的 reveal-后继）的 spend 支，O 作 co-input）
🔴 **v0.9 拓扑（Shape B）**：反应方领的是 **`O_AUTHORIZED`**（reveal 那笔把 LOCKED_F 转成的后继，§4-d），不是 LOCKED_F 本身。`O_AUTHORIZED` 恰两支：
- **reactive-claim 支（本支，无下界，反应方 confirm-before-recovery 领）**：
  ```
  require(checkSigFromStack(A, sig_A));
  require(blake2b(s) == h);
  require(OpInputCovenantId(O_in_idx) == cid);        // 同笔必须花真 O（反向焊）← ShardLeaf.sil:99
  require(OpTxOutputSpkSubstr(payout_idx,0,len) == baked_reactive_payout_spk);  // 付反应方 baked
  require(tx.outputs[payout_idx].value == OAUTH_value);                         // value 焊死
  require(OpCovOutputCount(oauth_cid) == 0);          // 🔴 v0.12 闸③(NWT/J2 逮): 本支 terminal, 禁产 O_AUTHORIZED 续链
  ```
- **recovery 支（首动方超时收回，🔵 解 Codex v0.8 塌）**：`require(TxTime >= OpTxInputDaaScore(O_AUTHORIZED) + N_claim + N_margin)`——**锚在 O_AUTHORIZED 自己的创建 DAA（= 实际 reveal DAA），非 baked cutoff**。⇒ 无论 reveal 早晚，反应方总有从实际 O 创建起的 N_claim+N_margin 窗，**去掉了对"reveal 在上界前"的依赖**。`OpCovOutputCount == 0`。
🔴 **v0.9 无上界（真原语）**：reactive-claim 支无 `TxTime <` 上界（不可 enforce）；独占性来自 recovery 支的 `TxTime >= ...` 下界（CLTV 可 enforce）。no-theft 逐对重证见 §4-f。
🔵 **`OpInputCovenantId(idx)` 读非 active 输入 = 已证**（ShardLeaf.sil:99）——O 作 co-input 按索引点准，可建。

### (d) refund / O-recovery 回收（全部 lineage-terminal，MUST-FIX 1+3+v0.4 耦合）
🔴 **MUST-FIX 1：本金 refund 走 P-SAFE-1 单-live-lineage state machine，不编码 A-absent 谓词**。covenant 证不了链下 A 全局不存在——只能验它自己 LOCKED 对象的**本地正事实**（被没被 validated-reveal 消费过）：

**`LOCKED_R`（反应方本金，首动方揭 s 领）恰两条互斥后继支**：
  - **transfer 支**（🔴 v0.10：本支【自身】强制全四路，MUST-FIX 1）：
    ```
    // 🔴 v0.8: 无上界(不可 enforce); 首动方须在 LOCKED_R-refund(>= T_cutoff_LOCKED_R)开前 reveal
    require(checkSigFromStack(A, sig_A));
    require(blake2b(s) == h);
    require(OpInputCovenantId(C_idx) == cid);              // 焊接①: 同笔消费 C ⇒ 触发 §4-b 造 O
    require(OpInputCovenantId(locked_f_idx) == locked_f_cid);  // 🔴 v0.10 焊接②(MUST-FIX 1): 同笔【必须】消费 exact LOCKED_F
    require(OpOutputCovenantId(oauth_out_idx) == oauth_cid);   // 🔴 v0.10 焊接③: 同笔【必须】造 exact O_AUTHORIZED
    require(tx.outputs[oauth_out_idx].value == LOCKED_F_value);// O_AUTHORIZED 承接 LOCKED_F 全额(不 skim)
    ```
    🔴 **v0.10 关键（MUST-FIX 1）**：领 LOCKED_R 的**本支自身**强制同笔消费 C + 消费 exact LOCKED_F + 造 exact O_AUTHORIZED（**四路焊在 LOCKED_R 领取路上**）。⇒ 攻击者**无法**"花 LOCKED_R+C、领本金、却把 LOCKED_F 留着走 giveup"——省略 LOCKED_F 则本支 `OpInputCovenantId(locked_f_idx)==locked_f_cid` 不过 = 领不了 LOCKED_R。堵住双拿。（v0.9 错把 LOCKED_F→O_AUTHORIZED 只放在 LOCKED_F 支内=可跳过。）
  - **terminal-refund 支**（cutoff 后）：`require(TxTime >= T_cutoff_LOCKED_R)`——still-unspent `LOCKED_R` 转 terminal 明文退**反应方**。互斥由 UTXO once-spend 天然保证。`OpCovOutputCount == 0`。

🔴 **`LOCKED_F`（首动方本金）v0.9 走 Shape B（两条互斥后继，均无上界依赖）**：
  - **transition 支（reveal 强制，四路原子的一路）**：reveal 那笔 tx（消费 LOCKED_R+C 造 O）**同笔必须把 LOCKED_F 转 `O_AUTHORIZED` 后继**。🔴 **v0.13 provenance（MUST-FIX 2b）**：O_AUTHORIZED **续 LOCKED_F 的 cov_id lineage**——`require(OpInputCovenantId(locked_f_idx) == locked_f_cid ∧ OpOutputCovenantId(oauth_out_idx) == locked_f_cid)`（CovenantBinding 续链，同 ShardLeaf/bshard 续链）。⇒ **`oauth_cid ≡ locked_f_cid`（同一 lineage 身份、跨转移稳定）**，而 `locked_f_cid` 是 LOCKED_F session-time genesis-mint 时的 cov_id、**reveal 前双方已 bake**（解 Codex "reveal 前 O_AUTHORIZED 不存在、怎么 bake oauth_cid"）。⇒ 全文 `oauth_cid` 即 `locked_f_cid`（§4-c/§4-e 的引用据此可 enforce）。⇒ **O_AUTHORIZED 与 O 同笔创建，DAA 相同（= 实际 reveal DAA）**。
  - **giveup-refund 支（首动方放弃，reveal 未发生）**：`require(TxTime >= T_giveup_LOCKED_F)`（baked 下界，CLTV）+ 🔴 **`require(OpCovOutputCount(locked_f_cid) == 0)`（v0.12 闸③，NWT/J2 逮我漏）**——本支 terminal 退首动方明文，禁产 LOCKED_F 续链。与 transition 互斥（once-spend）：reveal 发生则 LOCKED_F 已转移、giveup 无 UTXO；反之首动方 giveup 拿回、但也没 claim LOCKED_R（无 reveal）⇒ 反应方 refund LOCKED_R，对称无 theft。
    🔴 **giveup 排序 + free-option 诚实（v0.15 修，Codex v0.12 MUST-FIX 1）**：baked `T_giveup_LOCKED_F >= T_cutoff_LOCKED_R`（giveup 不早于 LOCKED_R-refund 开）**降低但【不消除】** free-option——**下界排序 close 不了 reveal 窗**（reveal 无上界，阈值后 LOCKED_R 未被 refund 则 reveal 仍 valid，首动方仍有 race-dependent 选择 reveal-vs-giveup）。残留 free-option **由 reactive 及时 refund LOCKED_R（reactive-liveness §1.5 假设 5）bound**，非结构消除。非盗窃（giveup 花掉 LOCKED_F 后 reveal 不可构造）。⇒ 诚实标为 liveness-bounded，matrix Fb 格已改标（J2 4d08fdb4）。
  - 🔵 **关键（解 Codex v0.8 塌）**：`O_AUTHORIZED` 的 recovery 下界 = `TxTime >= OpTxInputDaaScore(O_AUTHORIZED) + N_claim + N_margin`（= 实际 reveal DAA + N，见 §4-c）。**无论 reveal 早晚**，被保护本金在实际 O 创建 + N 前不能回首动方 ⇒ 不依赖"reveal 在 T_cutoff_LOCKED_R 前"这条不可 enforce 上界。

🔴 **cutoff 排序不变量（焊接生效前提）**：`T_cutoff_LOCKED_R <= C_terminal_refund_cutoff`（否则同笔走 C 的 terminal-refund 不造 O 绕过 v0.3 焊接）。
🔴 **单位显式标注（NWT 钉）**：`T_cutoff_LOCKED_R` / `C_terminal_refund_cutoff` / `T_giveup_LOCKED_F` / `OpTxInputDaaScore(·)+N`（各 recovery 锚）全部**同为 DAA-score（`< 5e11`）**，与 v1.3 总裁同单位。baked 常量间的排序（如 `T_giveup_LOCKED_F >= T_cutoff_LOCKED_R`）落码时 ctor 参数须显式同单位来源，混单位 ⇒ 比较 vacuous（floor-direction footgun 族）。
- **O 的 O-recovery 回收**（付回首动方）：见 §4-e 的 O 支 2。
- **C 的 terminal-refund**：`OpCovOutputCount == 0`（闸③）。

### (e) O 自己的 covenant 支路（v0.6 显式定义，从 O 的实际 spend 条件导出——反向焊）
🔴 **根因修（Codex v0.5 缝）**：v0.5 从没显式写 O 自己的 covenant 支，只从"意图"（O 被 reactive-claim co-input 消费）推断。⇒ 显式定义 O 恰两支，**均从 O 的实际 spend 条件写死**：

🔴 **v0.7 O 边界纯相对（Shape A1）**：O 的两支边界只用 `OpTxInputDaaScore(O) + N_claim + N_margin`（O 是本支 active input ⇒ 该量可读），**不引 baked 绝对回收常量**（避免"两个 baked 常量各自合法、相对值错"的不可 enforce 陷阱）。

- **O 支 1（pre-timeout：反向焊，🔴 v0.10 改引 O_AUTHORIZED，MUST-FIX 2）**：
  ```
  // 🔴 v0.8: 无下界外无上界; 反应方在 O支2(>= OpTxInputDaaScore(O)+N)开前有独占窗, §4-f
  require(OpInputCovenantId(oauth_in_idx) == oauth_cid);              // 🔴 v0.10 反向焊: 同笔必须也花 O_AUTHORIZED(非已消费的 LOCKED_F)
  require(OpTxOutputSpkSubstr(payout_idx,0,len) == baked_reactive_payout_spk);  // 且付反应方 baked 收款
  require(tx.outputs[payout_idx].value == OAUTH_value);              // value 焊死
  require(OpCovOutputCount(cid) == 0);                               // 🔴 v0.12 闸③: 本支 terminal, 禁产 O 续链
  ```
  ⇒ **花 O ⟹ 必同笔领 O_AUTHORIZED 给反应方**。s/A 公开也没用：独立花 O（不带 O_AUTHORIZED co-input）**过不了本支** ⇒ 外人毁不了 capability。🔴 **v0.10 修（MUST-FIX 2）**：Shape B 下 LOCKED_F 已被 reveal 消费成 O_AUTHORIZED、其 UTXO 不存在 ⇒ 反向焊必须引 `oauth_cid`（O_AUTHORIZED 身份），非已消失的 `locked_f_cid`。与 §4-c（反应方花 O_AUTHORIZED）一致。
- **O 支 2（回收：首动方超时收回）**：`require(TxTime >= OpTxInputDaaScore(O) + N_claim + N_margin)`（与 O_AUTHORIZED-recovery 同锚 reveal DAA，互斥），付首动方，`OpCovOutputCount == 0`（terminal）。

🔵 **双向互焊闭合（v0.10 全 O_AUTHORIZED）**：§4-c（领 O_AUTHORIZED ⟹ O co-input）+ §4-e 支 1（花 O ⟹ 领 O_AUTHORIZED）= **O 与 O_AUTHORIZED 窗内只能一起花**。O 支集 = 恰 2 支；O_AUTHORIZED 支集 = 恰 2 支（claim/recovery）。
🔴 **Shape B 无需 baked ordering（v0.15 sweep，取代已推翻的 Shape-A 论证）**：Shape A 曾靠 baked 不等式（依赖"O 创建早于 reveal-窗上界"、被 Codex v0.8 推翻）。**Shape B 不再需要**：O_AUTHORIZED-recovery 与 O-recovery 都锚 `OpTxInputDaaScore(·)+N`（= **实际 reveal DAA**），机制保证反应方总有从实际 O 创建起的 N 窗，**无论 reveal 早晚、无 baked cutoff 依赖**（详 §4-f 双拿防）。

---

## §4-f 去上界后 no-theft 逐对重证（v0.8·Bettor 要求·非"once-spend 一句"）

🔨 **共同原理**：covenant 只能 enforce 下界。"你须 X 前行动"不靠给你设上界（不可 enforce），靠给**对方**的 recovery/refund 支设 `>= X` 下界 ⇒ **X 前对方支被链上直接拒 ⇒ 对方碰不了那 UTXO ⇒ 你在 [start, X) 有【可 enforce 的独占窗】**。once-spend 定阈值那一刻的竞态，liveness（§1.5 假设 5）兜"你此前动"。逐对：

| 对（Shape-B 实际支） | 须先动方 | 对方下界支（造独占） | no-theft 论证 |
|---|---|---|---|
| reveal-transfer / `LOCKED_R`-refund | 首动方 reveal | `LOCKED_R`-refund `>= T_cutoff_LOCKED_R`（退反应方） | T_cutoff_LOCKED_R 前只首动方能花 LOCKED_R（refund 未开）⇒ reveal 则 LOCKED_R 花掉+四路原子；不 reveal 则反应方 refund 拿回。**无一方既不 reveal 又让对方拿不回**。 |
| `O_AUTHORIZED`-claim / `O_AUTHORIZED`-recovery | 反应方 claim | recovery `>= OpTxInputDaaScore(O_AUTHORIZED)+N`（退首动方，锚**实际 reveal DAA**） | 阈值（reveal_daa+N）前只反应方能花 O_AUTHORIZED（recovery 未开）⇒ 活反应方 claim 领走；惰方超时被 recovery 退首动方（自负）。 |
| O-spend / O-recovery | 反应方 claim（同 O_AUTHORIZED 一笔，双向焊） | O-recovery `>= OpTxInputDaaScore(O)+N`（回收 O 给首动方） | 同上：阈值前只反应方能花 O。 |

🔴 **O↔LOCKED_F/O_AUTHORIZED 双拿防（v0.9 Shape B 重证，取代塌掉的 ordering 论证）**：Codex v0.8 逮到旧论证依赖"O 创建 <= T_cutoff_LOCKED_R"（随 reveal 上界删除失效）。**Shape B 去此依赖**：reveal 那笔**同时**消费 LOCKED_R+C、造 O、**转 LOCKED_F→O_AUTHORIZED**（四路原子）。O_AUTHORIZED 与 O 同笔创建 ⇒ **`OpTxInputDaaScore(O_AUTHORIZED)` = 实际 reveal DAA**。首动方两条 recovery（O支2 `>= OpTxInputDaaScore(O)+N`、O_AUTHORIZED-recovery `>= OpTxInputDaaScore(O_AUTHORIZED)+N`）**都锚在【实际】reveal DAA + N**，无论 reveal 早晚。⇒ **反应方总有从实际 O 创建起的 [reveal_daa, reveal_daa+N) 独占窗**（首动方两 recovery 支此前 lower-bound 不满足=链上拒），窗内一笔（O+O_AUTHORIZED 双向焊）confirm 领两半。**晚 reveal 不再缩短窗**（窗锚实际 reveal 非 baked cutoff）⇒ Codex v0.8 双拿闭。惰方 = reactive-liveness（§1.5 假设 5，须 confirm）自负。🟡 残留 = 阈值那刻 once-spend 竞态，N_margin 缓冲。

---

## §5 min_O / O-recovery锚 / spk∧value 双 require

- **spk∧value 必须一起 require**（reveal-claim 支）：只查 spk 不查 value，首动方可造 dust/0 值形似 O，反应方花它付不起费 = 等价没造（malform 绕过，J2 §2-b）。
- **min_O 口径**：≥ 反应腿 claim 最坏手续费 + KIP-9 存储质量地板。**复用既有常量**（`_BSHARD_FEE_PER_INPUT = 1_000_000n` 等），不新造。🟡 具体数值未拍（§7）。
- **O-recovery 相对锚（MUST-FIX 3）**：回收支 `require(TxTime >= OpTxInputDaaScore(O) + N_claim + N_margin)`——锚在 **O 自己 input 的 DAA**（本地祖先事实），`N_claim`（反应方 claim 落链最坏 DAA 跨度）+ `N_margin` 是**相对时长**，不是绝对 deadline。理由：O-lineage 采纳初衷=不靠外部/模糊 finality 钟；绝对窗会重新引入无锚绝对时间。太早（N 太小）⇒ 首动方抢回 O ⇒ 反应方结构性 claim 不了 = 新洞，故 N 须保守上界（§7）。

---

## §6 deploy 不变量（漏一条静默不存在）+ 负测

1. **genesis-mint 义务**：relay 必 ① 把 C genesis-mint 为 covenant（`cid≠0`）② 每个 continuation output 续 `CovenantBinding(cid)` ③ 建 v1 tx（`TX_VERSION_TOCCATA`）+ compute_budget。**covenant 自己检查不出"当初没 mint"**（`PayoutShard.sil:26` 同款）。
2. **唯一续继变异负测（MUST-FIX 2，承重·J2 验收族 B）**：① 把 reveal 支的 `OpCovOutputCount(cid) == 1` 改成 `>= 1` ⇒ 验收**必须挂**；② 让某条 terminal/refund/cancel 支产出**一个续链 output**（`OpCovOutputCount != 0`）⇒ 验收**必须挂**。⇒ 唯一性靠"改松有人红"，非"记得写 ==1"。**漏则闸③/唯一 capability 静默失效。**
2b. 🔴 **原子焊接负测（v0.3·NWT 缝·【交易级】变异，与上面语句级不同层）**：把 `LOCKED-transfer` 与 `C-consume/O-create` **拆成两笔 tx 分别提交** ⇒ 领本金那笔（LOCKED-transfer）**必须被拒**（因焊接 require `OpInputCovenantId(C_idx)==cid` 在同笔找不到 C）。J2 判据：这条缝的**缺失约束不在任何一行代码里**，故负测改的是【怎么提交】不是【哪一行 require】——J2 验收族 B 已加（`86c04c55`）。附：cutoff 排序负测——令 `T_cutoff_LOCKED > C_terminal_refund_cutoff`，构造"同笔消费 C 走 C 的 terminal-refund（不造 O）"⇒ 必须被拒。
2c. 🔴 **O ↔ 被保护 principal 双向焊接负测（v0.4+v0.6·Codex 逮·交易级 + 配置级）**：
   - **正向**：花 `LOCKED_F`（领 principal）而**不带真 O** input ⇒ **必拒**（§4-c）。
   - 🔴 **反向（v0.6 补 Codex 单向焊缝）**：**独立花真 O**（pre-timeout，**不带 `O_AUTHORIZED` co-input / 不付反应方 baked payout**）⇒ **必拒**（§4-e 支1）。这条是关键：s/A 公开后独立花 O 的 griefing，只有 O 自己的 covenant 反向焊能挡，`O_AUTHORIZED`-claim 侧 co-input 挡不住。
   - 🔴 **边界负测（v0.8·下界-only·全不测上界因上界不可 enforce=不该有）**：
     1. **`O_AUTHORIZED`-recovery@`< OpTxInputDaaScore(O_AUTHORIZED)+N`** → 拒（下界）；
     2. **O2@`< OpTxInputDaaScore(O)+N_claim+N_margin`** → 拒（§4-e 支2 下界）；
     3. **`LOCKED_R`-refund@`< T_cutoff_LOCKED_R`** → 拒（§4-d 下界）；
     4. 🔴 **独占性正测（承重）**：首动方 recovery（O_AUTHORIZED-recovery / O-recovery）在**阈值（`OpTxInputDaaScore(·)+N`）前**提交 ⇒ **必拒**（证独占窗真存在=反应方保护来源）；
     5. 🔴 **giveup 错序负测**：令 baked `T_giveup_LOCKED_F < T_cutoff_LOCKED_R`（giveup 早于 LOCKED_R-refund 开）⇒ free-option 加大（观望套利窗变长）可测；注：free-option 非结构可消（下界 close 不了 reveal 窗，§4-d），此测量的是排序退化程度非"消除"。
     6. 🔴 **不可加上界的静态检查**：源码 grep 全构造**零 `tx.time <` / 零 phantom 当前-DAA 上界写法**（上界不可 enforce，写了=假守卫）。= clamp-repeat-offender 防复发。
2d. 🔴 **Shape B 四路 + O 侧焊交易级负测（v0.13 checklist ④⑤，Codex v0.9 MUST-FIX 1/2）**：
   - ④ **四路省略任一路→拒**：给 §4-d transfer 支合法 A+s，但 reveal tx **省略/错 C、或省略 exact LOCKED_F、或不造 exact O_AUTHORIZED（含续链 `OpOutputCovenantId==locked_f_cid`）**中任一 ⇒ **领 LOCKED_R 的 tx 必拒**（证四路焊在 LOCKED_R 领取路自身、非可跳过的分支）。
   - ⑤ **O 侧焊 stale/无 O_AUTHORIZED→拒**：(a) 花真 O 而**不带 O_AUTHORIZED co-input / 带 wrong oauth（≠locked_f_cid）** ⇒ 拒（§4-e 支1）；(b) 花 O_AUTHORIZED（领 principal）而**不带真 O** ⇒ 拒（§4-c）；(c) O_AUTHORIZED 的 cov_id **不续自 locked_f_cid**（假 continuation）⇒ 拒（provenance）。
3. **A-absent 全清核（MUST-FIX 1）**：全文 grep `A-absent` 必须**零命中**于 normative 构造（只许出现在 §0.5 变更说明里作为"已清除的旧写法"）。refund 只走 §4-d 的 still-unspent LOCKED state machine。
4. **A2 腿 e2e**：`checkSigFromStack` 合法签过 / 改一位拒 —— 必在 canonical `8065184` 树上编 + 上链跑，读 codegen 不算（OP_PICK 教训）。
5. **cov_id 派生 e2e**：造两个不同 funding outpoint 的 candidate C，验其 cid 不同、且只有 baked 那个的 O 过 reactive 检查。

---

## §7 明列未决（不假装闭合）

1. **运营取值三项（min_O / N_claim / N_margin）无权威值，我不拍数字** —— `min_O`（§5，≥反应腿 claim 最坏费+KIP-9 地板）、`N_claim`（反应方 claim 落链最坏 DAA 跨度）、`N_margin`（O-recovery 相对锚安全余量，§4-d）。同链可保守上界（本链费市场/DAA 产出率可读，比 §6-3 B 跨链版好定），仍须落**具名保守常量**（复用既有 `_BSHARD_FEE_PER_INPUT` 等），不硬编经验值。
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

⇒ **净判断（v0.10）**：Codex v0.9 判 **Shape-B 方向对 + 多项 PASS**（pivot / 锚实际后继 / confirm / 去上界）。v0.10 补 Codex 逮的 Shape B 重构**不完整**两处内部不一致：**MUST-FIX 1** reveal 能省略 LOCKED_F（LOCKED_F→O_AUTHORIZED require 只在可跳过的 LOCKED_F 支内）⇒ v0.10 把四路焊到 **§4-d transfer 支自身**（force 同笔消费 exact C+LOCKED_F + 造 exact O_AUTHORIZED，省略任一路则领不了 LOCKED_R）；**MUST-FIX 2** §4-e O 反向焊 stale 引已消失的 LOCKED_F ⇒ 改引 `oauth_cid`（O_AUTHORIZED），"花 O ⟺ 领 O_AUTHORIZED"，与 §4-c 一致。🟡 **残留**：§2.5 拓扑表 + §4-f 部分文字仍 Shape-A-era LOCKED_F 命名，待全 Shape-B 命名 sweep + J2 矩阵据实际支集（LOCKED_F:transition/giveup · O_AUTHORIZED:claim/recovery）重建（J2 已标矩阵 STALE）。**落码前硬前置**（不变）+ 四路省略任一路→拒 的交易级负测。v0.10 送 Codex 复审 ⇒ 同链 design-closed = 无委员 Tier-2（**条件于 §1.5 假设**）。跨链退 R1。落码 Owner 批实现闸。
