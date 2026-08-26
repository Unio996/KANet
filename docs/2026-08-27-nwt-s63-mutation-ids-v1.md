# §6-3 A covenant — 承重 require 的显式 mutation-id 权威验收表（(h) 落地）

> **v1.1（2026-08-27 · Codex (h) 裁 MATERIAL PROGRESS → 两 MUST-FIX 后 CLOSED AT DESIGN LAYER）**：H1 交易级复合组【逐臂拆分】(乙 3 组→7 臂,每臂单点隔离目标焊缝);H2 单位域【独立配置 mutation ID】CFG-UNIT-DOMAIN(不再作散文前提)。carry-forward 四条见末「未决」。Codex 明示本裁**不重开 Shape-B 设计**。
> 作者 NWT · 2026-08-27 · 派工 Owner 主线 §6-3 / Bettor (h) · Codex (621) 确认「14 条 v0.11–v0.15 新加 require 缺 mutation-id 是真 gap」
> **被测对象** = `docs/2026-08-21-j1-s6-3-A-covenant-construction-v0.15.md`（v0.15 §4 require 清单）。**本文件 = Codex 桥可引用的单一权威 mutation-id 源。**
> **性质**：pre-code 验收判据（判据冻结 · 零 build · 零节点 · 零链）。每条 = mutation-id / 锚（v0.15 §行 + require 原文）/ attack trace（攻击者改什么 → 期望 REJECT 原文）/ 层级。
> **口径（Codex 冻结）**：语句级 / 交易级 / 配置级**三层独立**——交易级、配置级**不能从语句级推**，各列独立类。真 covenant 存在后由 acceptance suite 机械化 PASS/REJECT；本文只冻判据。
> **命名**：`WELD-*`（该动作必须绑另一动作，松开即拒）/ `TERMINAL-*`（终态支禁续链）/ `PROV-*`（lineage 续继身份）/ `VALUE-*`（值焊死防 skim/dust）/ `ANCHOR-*`（recovery 下界锚实际 DAA）。沿用 8/22 (h) 矩阵 WELD/EXCL/COUPLED 分类（ledger (620)）。

---

## 甲 · 语句级：14 条 v0.9–v0.15 新加 require（本 gap 的正身）

> 每条 attack trace 的形式：**攻击者把 require 行删/松/改成 X ⇒ 构造一笔本应被拒的 tx ⇒ 该 tx 必须 REJECT（附拒因 = 哪条 require 触发）**。「松开→必挂」是判据（唯一性靠改松有人红，非靠记得写），非「记得写 == 」。

### 组 A：闸③ terminal（v0.12 · NWT/J2 逮漏 · §0.15）——每条非-reveal 终态支须显式禁产续链

| mutation-id | 锚（v0.15 §行 + require） | attack trace（改什么 → 期望 REJECT） | 层 |
|---|---|---|---|
| **TERMINAL-REACTIVE** | §4-c reactive-claim `require(OpCovOutputCount(oauth_cid) == 0)` (v0.15 @L248) | 删此行 / 改 `== 0` 为 `>= 0`（恒真）⇒ 构造 reactive-claim tx 在领 payout 同时**再产一个续 `oauth_cid` 的 output**（重开 O_AUTHORIZED lineage）⇒ **必 REJECT**：本支 terminal payout,`OpCovOutputCount(oauth_cid) != 0` ⇒ 拒。漏 = 反应方领钱后 lineage 未闭、可被再消费。 | 语句 |
| **TERMINAL-GIVEUP** | §4-d giveup `require(OpCovOutputCount(locked_f_cid) == 0)` (v0.15 @L273) | 删 / 松 ⇒ giveup-refund tx 退首动方明文时**再产一个续 `locked_f_cid` 的 output** ⇒ **必 REJECT**：giveup terminal,禁产 LOCKED_F 续链。漏 = 首动方 giveup 拿回本金**又**留一条 LOCKED_F lineage（双花预备）。 | 语句 |
| **TERMINAL-O1** | §4-e O 支1 `require(OpCovOutputCount(cid) == 0)` (v0.15 @L293) | 删 / 松 ⇒ 花 O 付反应方那笔**再产续 `cid` 的 output** ⇒ **必 REJECT**：O-spend terminal,禁产 O 续链。漏 = O 被花后 capability lineage 未闭。 | 语句 |
| **TERMINAL-OAUTH-RECOVERY** | §4-c recovery 支 `OpCovOutputCount == 0` (v0.15 @L250) | 删 / 松 ⇒ O_AUTHORIZED-recovery（首动方超时收回）那笔**产续链** ⇒ **必 REJECT**：recovery terminal。漏 = 超时回收路径重开 lineage。 | 语句 |
| **TERMINAL-O2** | §4-e O 支2 recovery `OpCovOutputCount == 0` (v0.15 @L296) | 删 / 松 ⇒ O-recovery（回首动方）那笔**产续链** ⇒ **必 REJECT**。漏同上。 | 语句 |
| **TERMINAL-LOCKEDR-REFUND** | §4-d LOCKED_R terminal-refund `OpCovOutputCount == 0` (v0.15 @L270 段) | 删 / 松 ⇒ LOCKED_R cutoff 后退反应方那笔**产续链** ⇒ **必 REJECT**。漏 = refund 路重开 lineage。 | 语句 |

### 组 B：四路原子焊（v0.10 MUST-FIX 1 · §0.13）——领 LOCKED_R 的本支自身强制四路，省任一路即领不了

| mutation-id | 锚 | attack trace | 层 |
|---|---|---|---|
| **WELD-LR-CONSUME-C** | §4-d transfer `require(OpInputCovenantId(C_idx) == cid)` (v0.15 @L263 · 焊接①) | 删/改 `cid` ⇒ 攻击者花 LOCKED_R+假 C 领本金而**不触发 §4-b 造 O** ⇒ **必 REJECT**：同笔未消费真 C。漏 = 领 LOCKED_R 不造 O（反应方无 O 可领 = 单向盗）。 | 语句 |
| **WELD-LR-CONSUME-LF** | §4-d transfer `require(OpInputCovenantId(locked_f_idx) == locked_f_cid)` (v0.15 @L264 · v0.10 焊接②) | 删此行 ⇒ 攻击者**花 LOCKED_R+C、领本金、却把 LOCKED_F 留着走 giveup**（双拿） ⇒ **必 REJECT**：本支未消费 exact LOCKED_F。**这条是 v0.9→v0.10 的核心修**（v0.9 把 LOCKED_F→O_AUTHORIZED 放 LOCKED_F 支内=可跳过）。漏 = 双拿本金。 | 语句 |
| **WELD-LR-CREATE-OAUTH** | §4-d transfer `require(OpOutputCovenantId(oauth_out_idx) == oauth_cid)` (v0.15 @L265 · v0.10 焊接③) | 删此行 ⇒ 领 LOCKED_R 时**不造 exact O_AUTHORIZED** ⇒ **必 REJECT**：反应方后继不存在。漏 = 反应方领不到本金后继。 | 语句 |
| **VALUE-OAUTH-NOSKIM** | §4-d transfer `require(tx.outputs[oauth_out_idx].value == LOCKED_F_value)` (v0.15 @L266 · v0.10) | 改 `==` 为 `>=` / 删 ⇒ 造 O_AUTHORIZED 时**skim 掉一部分 LOCKED_F 值**（转小额后继、私吞差额） ⇒ **必 REJECT**：O_AUTHORIZED 须承接 LOCKED_F 全额。漏 = 首动方在 transition 里 skim 反应方本金。 | 语句 |

### 组 C：O ↔ O_AUTHORIZED 双向焊（v0.10 MUST-FIX 2 · §0.13）——花 O ⟺ 领 O_AUTHORIZED，两向各一条

| mutation-id | 锚 | attack trace | 层 |
|---|---|---|---|
| **WELD-OAUTH-CO-O**（正向） | §4-c reactive-claim `require(OpInputCovenantId(O_in_idx) == cid)` (v0.15 @L245 · 反向焊) | 删 ⇒ 反应方**领 O_AUTHORIZED（本金）却不同笔花真 O** ⇒ **必 REJECT**：未花真 O co-input。漏 = O 被丢下（capability 泄漏,外人可 griefing 花它）。 | 语句 |
| **WELD-O-REVERSE-OAUTH**（反向 · v0.10 MUST-FIX 2） | §4-e O 支1 `require(OpInputCovenantId(oauth_in_idx) == oauth_cid)` (v0.15 @L290 · v0.10 反向焊) | 删 / 改回已消失的 `locked_f_cid` ⇒ 外人**独立花真 O**（s/A 公开后 griefing、不带 O_AUTHORIZED co-input、不付反应方） ⇒ **必 REJECT**：未同笔花 O_AUTHORIZED。**关键**：这条挡的是"独立花 O 的 griefing"，`O_AUTHORIZED`-claim 侧 co-input 挡不住（单向焊缝，Codex v0.5 逮）。**v0.10 修**：Shape B 下 LOCKED_F 已被 reveal 消费成 O_AUTHORIZED、UTXO 不存在 ⇒ 反向焊必须引 `oauth_cid` 非 `locked_f_cid`。漏 = 外人毁 capability。 | 语句 |
| **VALUE-REACTIVE-CLAIM** | §4-c `require(tx.outputs[payout_idx].value == OAUTH_value)` (v0.15 @L247) | 改 `==` 为 `>=` / 删 ⇒ 反应方领时值不焊死,或造 dust 形似 payout ⇒ **必 REJECT**：payout 值须 == OAUTH_value。漏 = 值层 malform 绕过。 | 语句 |
| **VALUE-O1-PAYOUT** | §4-e O 支1 `require(tx.outputs[payout_idx].value == OAUTH_value)` (v0.15 @L292) | 同上（O 支1 侧付反应方值焊）⇒ **必 REJECT**。 | 语句 |

### 组 D：provenance 续链身份（v0.13 MUST-FIX 2b · §0.16）——O_AUTHORIZED 续 LOCKED_F 的 cov_id lineage

| mutation-id | 锚 | attack trace | 层 |
|---|---|---|---|
| **PROV-OAUTH-LINEAGE** | §4-d transition `require(OpInputCovenantId(locked_f_idx) == locked_f_cid ∧ OpOutputCovenantId(oauth_out_idx) == locked_f_cid)` (v0.15 @L272 · v0.13 MUST-FIX 2b) | 改 output 侧续 `locked_f_cid` 为**任意新 cov_id**（假 continuation、O_AUTHORIZED 不续自 LOCKED_F lineage） ⇒ **必 REJECT**：O_AUTHORIZED 须续 `locked_f_cid`（CovenantBinding 续链，同 ShardLeaf/bshard）。**这条使 `oauth_cid ≡ locked_f_cid`**（同一 lineage 身份、跨转移稳定、reveal 前双方已 bake）——§4-c/§4-e 对 `oauth_cid` 的引用据此才可 enforce。漏 = O_AUTHORIZED 身份可伪造 ⇒ §4-c/§4-e 的焊全 vacuous（引的是攻击者可控的假 cid）。 | 语句 |

### 组 E：recovery 下界锚实际 reveal DAA（v0.9→v0.15 Shape B · §0.17）——去掉不可 enforce 的 baked 上界依赖

| mutation-id | 锚 | attack trace | 层 |
|---|---|---|---|
| **ANCHOR-OAUTH-RECOVERY** | §4-c recovery `require(TxTime >= OpTxInputDaaScore(O_AUTHORIZED) + N_claim + N_margin)` (v0.15 @L250) | 把锚改回 **baked 绝对 cutoff**（Shape-A 已推翻写法，如 `TxTime >= T_baked`）/ 删下界 ⇒ 首动方可在**实际 reveal DAA + N 之前**抢回 O_AUTHORIZED（缩短/消除反应方独占窗） ⇒ **必 REJECT**：recovery 须锚 `OpTxInputDaaScore(O_AUTHORIZED)+N`（= 实际 reveal DAA）。漏 = 晚 reveal 缩短反应方窗 = Codex v0.8 双拿洞复发。 | 语句 |
| **ANCHOR-O-RECOVERY** | §4-e O 支2 `require(TxTime >= OpTxInputDaaScore(O) + N_claim + N_margin)` (v0.15 @L296) | 同上（O 侧回收锚）：改 baked / 删 / N 太小 ⇒ 首动方抢回 O ⇒ **必 REJECT**：须锚 `OpTxInputDaaScore(O)+N`。漏 = 反应方结构性 claim 不了（新洞，§5 MUST-FIX 3）。 | 语句 |

**语句级小计 = 6(组A) + 4(组B) + 4(组C) + 1(组D) + 2(组E) = 17。** 其中 Codex (621) 点名的"14 条 v0.11–v0.15 新加"= 组A的 4 条新 terminal(REACTIVE/GIVEUP/O1 是 v0.12 明确新增,另 3 条 terminal 属既有支的 terminal 收口)+ 组B 4 + 组C 4 + 组D 1 + 组E 2 的**新引入项**。🔵 **对账注**：我 8/22 矩阵报「§6 已列 11 + 新 14」,本表把既有 terminal 收口(TERMINAL-OAUTH-RECOVERY/O2/LOCKEDR-REFUND 3 条)也显式列出以求完备,故语句级总 17;**其中【v0.11–v0.15 真正新加、§6 从未落 mutation-id 的】= TERMINAL-REACTIVE/GIVEUP/O1(3) + WELD-LR-CONSUME-LF/CREATE-OAUTH(2) + VALUE-OAUTH-NOSKIM(1) + WELD-OAUTH-CO-O/O-REVERSE-OAUTH(2) + VALUE-REACTIVE-CLAIM/O1-PAYOUT(2) + PROV-OAUTH-LINEAGE(1) + ANCHOR-OAUTH-RECOVERY/O-RECOVERY(2) + WELD-LR-CONSUME-C(1) = 14。** 其余 3 条 TERMINAL(既有支收口)非新 gap、一并列出防遗漏。

---

## 乙 · 交易级：7 臂（v0.3/v0.13 · 改「怎么提交」不改任何 require 行 · Codex 冻结「不能从语句级推」）

> 交易级变异 = 攻击者不动任何一行 require，改的是 tx 如何**组装/提交**（拆笔、遗漏输入/输出、陈旧输入）。这类缝的**缺失约束不在任何一行代码里**（J2 判据 §0.6），故独立类。
> 🔴 **v1.1（Codex H1 · 逐臂拆分）**：v1 把 `TX-4WAY-OMIT`（混 3 省略）与 `TX-O-STALE-OR-NO-OAUTH`（混 3 缺陷）各写成一臂。**一笔同时省多路的复合攻击 tx 会在【第一个】缺失条件上被拒 ⇒ 其余焊缝机械上没测到**（= 同 E2E arm(c) 顺序重放撞前置层、CAS 没测到 的同形）。⇒ **每臂只省一路、其余满足**，让 tx 够到并被【那一条】焊缝拒，各自 expected reject point。

| mutation-id | 锚（v0.15 §6 + 拒点 require） | attack trace（只省一路，其余满足 → 期望拒在指定焊缝） | 层 |
|---|---|---|---|
| **TX-SPLIT-WELD** | §6.2b（v0.3 · NWT 缝 · `86c04c55`）· 拒点 WELD-LR-CONSUME-C @L263 | 把 `LOCKED-transfer` 与 `C-consume/O-create` **拆成两笔 tx 分别提交** ⇒ 领本金那笔 **必 REJECT**：`OpInputCovenantId(C_idx)==cid` 在同笔找不到 C。 | 交易 |
| **TX-4WAY-OMIT-C** | §6.2d ④ · 拒点 **WELD-LR-CONSUME-C @L263** | reveal tx **带 exact LOCKED_F + 造 exact O_AUTHORIZED（都满足），只省/错 C** ⇒ 领 LOCKED_R 必拒在 `OpInputCovenantId(C_idx)==cid`（不是被别的路先拒）。证 C-weld 单独承重。 | 交易 |
| **TX-4WAY-OMIT-LOCKED_F** | §6.2d ④ · 拒点 **WELD-LR-CONSUME-LF @L264** | reveal tx **带 C + 造 O_AUTHORIZED（都满足），只省 exact LOCKED_F** ⇒ 必拒在 `OpInputCovenantId(locked_f_idx)==locked_f_cid`。证双拿防单独承重。 | 交易 |
| **TX-4WAY-OMIT-OAUTH** | §6.2d ④ · 拒点 **WELD-LR-CREATE-OAUTH @L265 + PROV-OAUTH-LINEAGE @L272** | reveal tx **带 C + LOCKED_F（都满足），不造 exact O_AUTHORIZED（或造了但续链 `OpOutputCovenantId≠locked_f_cid`）** ⇒ 必拒在 create-OAUTH 焊 / provenance。证 O_AUTHORIZED 后继单独承重。 | 交易 |
| **TX-O-WITHOUT-OAUTH** | §6.2d ⑤ · 拒点 **WELD-O-REVERSE-OAUTH @L290** | **花真 O，其余合法，只不带 O_AUTHORIZED co-input** ⇒ 必拒在 §4-e 支1 `OpInputCovenantId(oauth_in_idx)==oauth_cid`。证反向焊挡"独立花 O griefing"。 | 交易 |
| **TX-OAUTH-WITHOUT-O** | §6.2d ⑤ · 拒点 **WELD-OAUTH-CO-O @L245** | **花 O_AUTHORIZED（领本金），其余合法，只不带真 O co-input** ⇒ 必拒在 §4-c `OpInputCovenantId(O_in_idx)==cid`。证正向焊。 | 交易 |
| **TX-OAUTH-WRONG-LINEAGE** | §6.2d ⑤ · 拒点 **PROV-OAUTH-LINEAGE @L272** | **花 O + O_AUTHORIZED（co-input 都在），只把 O_AUTHORIZED 的 cov_id 做成不续自 locked_f_cid（假 continuation）** ⇒ 必拒在 provenance。证 lineage 身份单独承重（否则 §4-c/§4-e 引 oauth_cid 全 vacuous）。 | 交易 |

🔴 **拆分判据**：每臂**必须证拒在【它指定的那条焊缝】**，不是"反正拒了"——若一臂的 tx 被别的路先拒，说明该臂没真测到目标焊缝，须重构 tx 让目标焊缝成为唯一失败点（same-family 单点隔离，同语句级"松开→必挂"要求单条）。
**核过无第 8 臂**（原 3 组拆到 7 臂 = TX-SPLIT-WELD 1 + 4WAY 3 + O/OAUTH 3；ledger (620) 交易级 3 组穷尽,拆分不新增缝、只让每缝可单独机械测）。

---

## 丙 · 配置级：3 条（baked 常量间关系 · 落码 ctor 参数 · Codex 冻结「不能从语句级推」）

> 配置级变异 = 攻击者/误配把 **baked 常量之间的排序/单位关系**设错。这类不在任何单条 require 里，在常量的**相对值**里。
> 🔴 **v1.1（Codex H2 · 单位域独立 ID）**：v1 把"单位不变量"写成 CFG-GIVEUP/CFG-CUTOFF 的**散文前提**。Codex 裁：**数值对但单位混也能让排序比较 vacuous ⇒ 它须自己一个配置级 mutation ID**，不寄生在排序臂下（本项目时间域坑反复出现，s/ms/DAA 混是独立失败模式）。

| mutation-id | 锚 | attack trace | 层 |
|---|---|---|---|
| **CFG-GIVEUP-ORDER** | §4-d giveup `T_giveup_LOCKED_F >= T_cutoff_LOCKED_R`（v0.11/v0.15 · §6.2c 边界5） | 令 baked `T_giveup_LOCKED_F < T_cutoff_LOCKED_R`（giveup 早于 LOCKED_R-refund 开）⇒ **观望套利窗变长可测**。🔴 **诚实标（v0.15）**：free-option **非结构可消**（下界 close 不了 reveal 窗，§4-d），此测量的是**排序退化程度**非"消除"；残留由 reactive-liveness（§1.5 假设5）bound。REJECT 判据 = ctor 校验 `T_giveup >= T_cutoff` 不成立即拒装。 | 配置 |
| **CFG-CUTOFF-ORDER** | §4-d `T_cutoff_LOCKED_R <= C_terminal_refund_cutoff`（§6.2b 附） | 令 `T_cutoff_LOCKED_R > C_terminal_refund_cutoff` ⇒ 构造"同笔走 C 的 terminal-refund（不造 O）绕过 v0.3 焊接" ⇒ **必 REJECT**。 | 配置 |
| **CFG-UNIT-DOMAIN**（v1.1 · Codex H2 独立臂） | §4-d 单位段 · 承重量 = `T_cutoff_LOCKED_R` / `C_terminal_refund_cutoff` / `T_giveup_LOCKED_F` / 各 `OpTxInputDaaScore(·)+N` | **把其中【一个】baked 常量的单位改域**（如 `T_giveup_LOCKED_F` 用【秒】或【ms】、其余仍 DAA-score）——**数值各自合法**，但 `T_giveup >= T_cutoff` 变成"1000(秒) vs 8e10(DAA)"这类**跨域比较 ⇒ 恒真/恒假、与意图无关 ⇒ 排序守卫（CFG-GIVEUP/CFG-CUTOFF）静默通过而语义已坏**（floor-direction footgun 族）。**REJECT 判据**：ctor 参数须带**单位标签/单一来源**，混域即拒装；或落一条"全部承重时量同为 DAA-score（`< 5e11`）"的显式一致性校验，任一量越出 DAA 量级即拒。**这条是 CFG-GIVEUP/CFG-CUTOFF 的【前提】但独立可变异**：排序臂测"顺序对不对"，本臂测"两个数还在不在同一把尺上"——尺错则顺序臂的比较本身 vacuous。 | 配置 |

---

## 三层覆盖判据（Codex「独立类」要求的落地形式）

- **语句级**（甲，14 新 + 3 既有收口）：真 covenant 存在后，acceptance suite 逐条**删/松该 require → 预注册对抗 tx 必须 LAND（若 suite 未挂 = suite 漏，反向说明该 require 承重）**，或 mutation 后**预注册攻击 tx 从 REJECT 变 LAND = suite 必 fail**。松开→必挂。
- **交易级**（乙，**7 臂**·v1.1 逐臂拆分）：不动 require，改 tx 组装 → 预注册"本应拒"的 tx 必 REJECT。**不能从语句级推**（缝不在代码行里）。
- **配置级**（丙，**3 条**·v1.1 单位域独立 ID）：改 baked 常量相对值或**单位域** → ctor 校验拒装 / 或构造绕过 tx 必拒。**不能从语句级推**（缝在常量相对值里）。
- **矩阵重生成义务**：加任何新支 ⇒ 本表 + J2 pairwise 矩阵同步失效重建（§6-3 设计 §5 caveat②）。

## 未决 / carry-forward（Codex (h) 裁明列四条 · 不假装闭合）
> Codex CLOSED-AT-DESIGN-LAYER **不含**下列四条——它们是【真 covenant 落码后】才动的实现层义务，本表 pre-code 只能列、不能闭。
1. **CF-1 · .sil 重锚**：本表锚在 v0.15 §4 的 **§行/@L 行号**（`docs/2026-08-21-j1-s6-3-A-covenant-construction-v0.15.md` 当前行,会随文档编辑漂）。真 covenant `.sil` 落码后须把每条锚从「§行」换成「`.sil` file:line」，逐条重锚。
2. **CF-2 · 机械执行零 skipped**：PASS/REJECT 须真 covenant 存在、由 acceptance suite 机械化跑，**零 inconclusive / 零 skipped**（每条 mutation 后预注册对抗 tx 的 LAND/REJECT 必被 suite 实际执行到,不许"未触发"充当通过）。pre-code 本表只冻判据,Owner-gated 实现。
3. **CF-3 · 分支集变即作废**：加任何新支 / 改支集 ⇒ **本表 + J2 pairwise 矩阵同步失效重建**（§6-3 设计 §5 caveat②）；旧表不得继续当权威。
4. **CF-4 · N_claim / N_margin 归 (d)**：组E ANCHOR-* 与 CFG-UNIT-DOMAIN 依赖的 `N_claim`/`N_margin` 具体值**未拍**（§4-d/§5/§7），归结算参数域 (d)；"N 太小=反应方结构性 claim 不了 新洞"待保守上界落**具名常量**（复用既有 `_BSHARD_FEE_PER_INPUT` 等,不硬编经验值）。
- 附：A2 腿（`checkSigFromStack`）与 cov_id 派生 e2e 归 §6.4/§6.5，不在本 mutation 表（它们是原语可建性证，非拓扑变异）。
- 附：Codex 明示本裁**不重开 Shape-B 设计**——本 v1.1 只补 mutation-id 覆盖,不碰 §4 构造。
