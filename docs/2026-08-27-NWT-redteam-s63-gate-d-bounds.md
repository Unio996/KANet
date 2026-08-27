# NWT 红队 — §6-3 gate (d) 保守值提案 v0.1

> 作者 NWT · 2026-08-27 · 派工 Bettor (14) · 被审 = `docs/2026-08-27-j2-s63-gate-d-conservative-bounds-v0.1.md`（**e9c30104**，未推）
> 独立复核对象：v0.15 covenant require 锚 + 四份证据引用 + CFG-UNIT-DOMAIN 一致性。**默认先试打破**；PASS 须"我打了这些没打穿"挣来。
> **总评：参数语义/单位域/保守方向/fail-closed/重采门都站得住 = GREEN-WITH-NOTES（证据层，零落码）。** Bettor 点名两处我各裁如下：M_observe **不打回**（数对，但 J2 漏了真正的降杠杆）；N_claim n=1 **是真弱、但被 N_margin 吸收、不阻塞**。**外加一条两人都没标的 min_O 前提未强制。**

## 0 · 独立核到的承重事实（先钉死）`[v0.15 HEAD 复读 + 常量实读]`
1. **两条 recovery 支链上只 enforce 一个和**：@L250 `require(TxTime >= OpTxInputDaaScore(O_AUTHORIZED) + N_claim + N_margin)`、@L296 O 支 2 同锚——**均取和**。⇒ J2 说"拆两具名常量=审计口径、链上一个数"**属实**。这条决定了下面 N_claim 弱点的 blast radius。✅
2. **min_O 是 value require 不是纯 spk**：@L147 `[造 O：… spk==baked_O ∧ value>=min_O]`、@L236 `require(tx.outputs[O_out_idx].value >= min_O)`。✅
3. **watchtower 代广播在假设 5 原文里**：@L135「**任何人可代广播**（claim payout baked 到反应方，改不了向 ⇒ watchtower/第三方可代）」。⇒ 这是我下面 M_observe 裁决的关键杠杆，不是我发明的。✅
4. **149s = 真实但单点、且是【注资】不是【claim】形状**：`checksigfromstack-e2e-onchain.mjs:175` 注释「实测注资落链 149s」实读命中；上下文是 `check_utxo_landed` 90×2s 轮询窗。⇒ J2 如实标"首见级、源码注释单点"**属实**，且比 J2 承认的更该警惕：它量的是**注资 tx**，非 §6-3 那笔 J2 自己说"更重"的 2-covenant-input claim tx。✅
5. `_BSHARD_FEE_PER_INPUT = 1_000_000n`（p2sh.mjs:1737，覆盖 budget=50 compute mass floor）✅；`REORG_SAFE_MIN_DEPTH = 20`（pool-shard-register.mjs:88，注释自证「claim 确认深度门」）✅。

## 1 · Bettor 点名①：M_observe = 55,200 能不能砍 —— 🟢 **不打回；J2 核心主张成立，但漏了真杠杆**
J2 主张：M_observe 是活性成本大头，**不能砍数，只能收紧包络 + 重采**。**这条我 UPHOLD**，但 J2 的"收紧包络⇒M_observe 随之缩"这半在机制上有洞，且真正能砍它的杠杆 J2 自己引了却没接上。

- **为什么不能直接砍数（J2 对）**：M_observe 兜的是"反应方节点 lag 到看不见/提交不了 O 的最坏窗"。链上 N 部署即固定。砍 M_observe = 任何在窗内 lag 超新值的节点**结构性 claim 不了 = 本金损失 = 安全洞**（v0.15 §5"新洞"）。这与全稿"宁大勿小、N 太小=安全洞"的风险不对称**一致**。⇒ 砍数 = 缩安全包络，不是免费优化。**不打回。**
- 🔴 **但 §6"收紧包络⇒缩 M_observe"这半是【检测-认损】不是【防止】**：§6 入场闸只筛**入场时** lag<M_observe/2 的节点；lag 会**入场后增长**。§6 运行中对"超 M_observe"的处置是「**按已损处理并留证**」——那正是 M_observe 本要防的那个损。⇒ **收紧入场闸并不能让 M_observe 变小**，因为它管不住入场后退化，只能事后认损。J2 §5 ②"重采后 max lag<30min 可提案降 N_margin"隐含"节点会一直健康"，而 §6 自己的机制恰恰承认它不会。**两处自相矛盾，须点破。**
- 🔵 **真正能砍 M_observe 的杠杆 = watchtower 多重性（J2 §3-B 引了"代广播的 watchtower"却没接到 M_observe）**：假设 5（0-3 我核过）明说 **claim payout baked 到反应方、任何人可代广播**。⇒ 若 claim 可由**任一健康 watchtower**（非反应方自己那台可能退化的节点）提交，则 M_observe 应按**best-of-N 独立观察者的 lag** 取，而不是单节点最坏 lag。这才是能合法把 55,200 往下拉的东西——不是拍脑袋砍，是架构上"多观察者取最快"。
- **⇒ 裁决**：M_observe = 55,200 **在"单反应节点"模型下不能砍，J2 对**；**在"watchtower 多重"模型下可合法降到 best-watchtower lag**。**这是一道架构问题（Tier-2 是否纳入 watchtower 多重）而非数值问题，属 Owner/Codex 决**。J2 请把这条写进 §7 未决 2（把"唯一合法降法=收紧包络+重采"改成"…+ 或纳入 watchtower 多重取 best-of-N lag，后者是架构决"），并删掉 §6"收紧入场闸⇒缩 M_observe"的因果（入场闸挡不住入场后退化）。**不整稿打回。**
- 🔵 附带（不阻塞）：M_observe 标签「反应方看见 O 的延迟」**窄于它实际兜的量**——它同时兜了"lag 到看不见 O"∪"near-stall 到 isSynced=false 提交被拒"。J2 §3-C 取 max(85.5min lag, 91min near-stall) 作为"最坏失能窗"是**合理保守代理**，但**标签该改成"反应方失能窗（看不见 O ∪ 提交被拒）"**，否则重采（§5 ②）时不知道该量哪个量。

## 2 · Bettor 点名②：N_claim 用 149s 单点当 2× 基数（n=1）—— 🔴 **弱点真、比 J2 承认的更弱，但被 N_margin 吸收 ⇒ 不阻塞**
- **弱点确认且加重**：149s 是 (i) n=1；(ii) **源码注释**非落库测量；(iii) **注资 tx** 非 J2 自己说"更重"的 2-covenant-input claim tx（更重 ⇒ mass 更大 ⇒ 落链可能更慢，用轻 tx 落链时延兜重 tx 是**乐观方向**）；(iv) 首见级非深度级。**四条叠加 = N_claim 的证据基几乎为零。**
- 🟢 **但 blast radius 低，不该卡稿**：N_claim(3,600) 只占链上 enforce 和(61,200)的 **5.9%**；N_margin(57,600, 16×大)**吸收**它，且 N_margin 的证据基（E3 lag 分布）**独立且更大**。链上只看和（0-1 核过）⇒ N_claim 单点错几倍，被 57,600 兜住。J2 自己说"拆两常量=审计口径"，正是此意。
- 🔴 **但两号会不会同向欠测？** N_claim(claim 落链 span) 与 M_observe(反应方看见 O 前的 lag) 共因 = **同一台退化节点**。所幸 N_claim 是**网络-DAA span**（落链期间链上 DAA 走多少，与本地节点 lag 无关——本地 lag 只让"观察到落链"墙钟迟，不改网络 DAA span），所以 J2 用 10 BPS 把 149s→1490 DAA **方向对**（不能用 E3 的本地 0.82/s，那会**低估** span）。⇒ 两号不同向欠测，N_claim 弱点被隔离在自己 5.9% 里。**这一条我特意验过，J2 换算没错。**
- **⇒ 裁决**：N_claim = **PROVISIONAL-WEAK-BUT-ABSORBED**。**不阻塞**。真修法 = §5 ① 重采（≥30 笔深确认级）——**但必须用 P3 的 claim 形状（2 covenant 输入）跑，不能再用注资 tx**，否则重复 E2 的错。J2 §5 ① 已写"造 O 形状同 P3 的 tx"，**请显式补一句"落链腿也须是 claim-shape 不是 funding-shape"**。

## 3 · 我加的一条（两人都没标）：min_O 的"O 是唯一费源"前提**未被覆盖强制** —— 🟡 **数不危险（超额中性），但理据错、§5④ 承袭错模型**
- J2 §3-A 全部 min_O 理据 = 「**没有第三个手续费输入——手续费只能出自 O 的值（这正是 min_O 存在的理由）**」。**我去 v0.15 查这个前提有没有被 covenant 强制——没有。**
- **anchored claim 支（@L147 react）+ O 支 1（@L288-292）的 require 集**：`checkSigFromStack(A) ∧ blake2b ∧ OpInputCovenantId(O)==cid`（+ 反向焊 oauth + payout spk/value 焊 + `OpCovOutputCount==0`）。**`OpCovOutputCount` 限的是 covenant 输出，不是输入；没有任何 `OpTxInputCount`/输入数 require。** ⇒ **反应方可加一个普通(非 covenant)手续费输入自付费**，O 的值只需兜 O 自己那笔输出的**存储地板**，**不需**兜 2-covenant-input claim 的费。
- **原语存在但没被调**：v0.15 能力表(L371) 有 `OpCovInputCount`/`OpCovInputIdx`——但 (a) 它数 covenant 输入不数全部输入（`OpCovInputCount==2` 仍放行普通费输入）；(b) claim 支根本没调它。要真禁普通费输入还需一个全-输入-数 require（`OpTxInputCount==2` 之类，其存在性我**未确认**，属 silverscript DECL 待查）。
- **方向**：min_O 超额 = 反应方作找零拿回（J2 §3 自证"过大无害"）⇒ **不危险**。但理据错使数**失锚**：若费自反应方输入出，min_O 真实下限 = **O 存储地板 ~2e6 sompi**，而非 SF×(费2e6+储2e6)=1e7 的 5×膨胀。§5 ④"P3 真 mass ⇒ min_O≥2.5×(真费+储)"**承袭了错模型**（把 claim 费算进 min_O）。
  > 🔵 **状态注记（2026-08-28 · NWT）**：此处"真 mass"是**模型量**，非 relay 实算量——**红线 7（relay mass-aware fee floor）自 ≥8-01 因 wasm mass-calc trap（缺 TN12 参数）静默关闭，只 mempool 兜底（`p2sh.mjs:57-60`）；见 `docs/2026-08-28-nwt-s63-redline7-mass-fee-silent-disable-v5.1.md`**。任何"relay 强制 fee≥mass×100"的读法在 enforce 段落地前不成立。
- **⇒ 裁决（非阻塞，须记）**：min_O 落码前**二选一钉死**——(a) covenant **显式加输入-数强制**（`OpTxInputCount==2` 或等价，先验原语存在），则"O 是唯一费源"成立、现公式对；(b) **接受反应方自付费**，则 min_O 重锚为**存储地板 only**（~2e6），§5 ④ 改为"min_O≥SF×存储地板，claim 费不计入"。**现稿 1e7 因超额中性可暂用，但理据须选一条修**。

## 4 · CFG-UNIT-DOMAIN 一致性（§4）—— 🟢 与我 (h) 判据一致，无攻
- J2 §4 三量三域（DAA 绝对 / DAA 相对差值 / sompi）+ 量级带 + **"改成秒(5,760)仍在带内⇒带检查抓不住⇒unit 字段必须同校"** —— **正是我 (h) CFG-UNIT-DOMAIN 的"两道都要、缺一 vacuous"原文**。J2 引对了 @L91，且换算只出现在 §3-D 对照列、常量以原生单位具名不在码里 min↔DAA 换算（避 `reference-dual-mode-field-selected-by-magnitude` 那条手写换算 footgun）。✅
- 🟡 微瑕（不阻塞）：M_congest=1,800 定义为「= N_claim/2」= **循环**（拿弱证据的 N_claim 的一半当拥塞裕度，非独立证据）。占 57,600 的 3%、安全方向，可留，但**标一句"非独立锚、随 N_claim 重采连动"**。

## 5 · 其余格核（PASS）
- 🟢 §0 六条 PASS 条件逐条对表齐；Codex "不能证绝对抗审查、claim 保持 conditional on bounded-inclusion" 这条线没越（§1.5 假设 5 原话）。
- 🟢 §2 四份证据**读法限制全如实标**（E1 首见非深度 / E2 落链时延没逐窗记只有 149s 注释 / E3 是 8/23 反复崩那台、须重采 / reorg 单采 −346 非链上深度）——诚实，无夸大。
- 🟢 §5 五项重采**全带预注册判据**（① ≥30 笔全 span≤N_claim、任一超即作废回算；② 只准降不准低于重采尾部；③ M_reorg≥2×观测 max 且≥400；④ 真费>4e6⇒上调不准降 SF；⑤ 加 landed_daa/depth 字段走报备）——**判据锁死"重采只能收紧不能放宽"方向**，对。
- 🟢 §6 fail-closed：入场闸绑 (5) 稿 R1–R6 + **禁"落链慢就调大 N"自适应**（= Codex silently-widening）——方向对（洞在 §1 已单列，非本节）。
- 🟢 §5 ⑤ 指出 fc925044 上链跑手**不记 landed_daa**、建议下一版加——与我上轮 GREEN 该 commit 时"只记提交体"一致，接得上。

## 6 · 交付判词
- **§6-3 gate (d) 保守值提案 v0.1（e9c30104）= GREEN-WITH-NOTES（证据/设计层，零落码）。** 参数语义、单位域、保守方向、fail-closed、重采门判据全站得住；数值全 PROVISIONAL 且正确 gated 在 §5 重采上。
- **Bettor 点名①（M_observe）**：**不打回**。数在"单反应节点"模型下不能砍（J2 对）；能砍它的是 **watchtower 多重架构**（假设 5 已授权"任何人可代广播"，J2 §3-B 引了没接上），那是 **Owner/Codex 架构决**非数值。**须改**：删 §6"收紧入场闸⇒缩 M_observe"的错因果（入场闸挡不住入场后退化，§6 自己的处置是认损）；M_observe 标签改"失能窗（看不见 O ∪ 提交被拒）"。
- **Bettor 点名②（N_claim n=1）**：弱点**真且比承认的更弱**（源码注释单点 + 注资非 claim 形状 + 首见非深度 + 乐观方向），**但被 N_margin 吸收（占和 5.9%）、两号不同向欠测（我验过换算方向对）⇒ 不阻塞**。**须改**：§5 ① 落链腿显式限"claim-shape(2 covenant 输入)不是 funding-shape"。
- **NWT 加的一条（min_O 前提）**：「O 是唯一费源」**未被 covenant 覆盖强制**（无输入-数 require，反应方可加普通费输入自付）。数超额中性**不危险**，但理据失锚、§5 ④ 承袭错模型。**须二选一**：(a) 加 `OpTxInputCount==2` 强制（先验原语存在）；(b) min_O 重锚存储地板 only。**非阻塞、须记入 §7 未决。**
- **GREEN 边界**：= 证据层闭合（该量什么/怎么量/取值规则/保守方向钉死），**≠ 数值定稿**（Codex P4 要对 P3 真 tx 定稿）、**≠ 执行**。落码/定数在节点同步后重采（§5）+ P3 形状出 + Owner/Codex 收 (d) 之后。
- **回 Bettor**：三条 NOTE（M_observe 因果+标签 / N_claim ①claim-shape / min_O 前提二选一）都是**收敛式修文**，非重做。你要 GREEN 我给 GREEN；这三处 J2 折进 v0.2 后我一眼复核即可，**不必卡在 M_observe/N_claim 数值辩论上**——数值本就 PROVISIONAL、gated 在重采。
