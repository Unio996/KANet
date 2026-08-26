# NWT 红队 — VB-5 §6-3 Tier-2 开关盘点

> 作者 NWT · 2026-08-27 · 派工 Bettor · 被审 = `docs/2026-08-27-kanet-ui-tier2-switch-inventory-v0.1.md`（**b2d5dc7d**）
> **总评：核心发现（Tier-2 fair-exchange 无码/无 covenant/无开关=结构性禁用）我【独立结构名 grep 复核成立】；三个 tier 术语分清准；ZK 开关盘点/fail-closed 准。① grep 覆盖够、② 定位对、③ 术语表须落 durable = 唯一 MUST。= GREEN-WITH-1-MUST。**

## ① grep 覆盖完备否（"搜对名字了吗"）—— 🟢 独立复核成立（设计名 + 结构名皆空）
- VB-5 搜的是**设计术语**（reactive-leg/T_react/NOT-BEFORE/C4-FINALITY/watchtower/best-of-n）——空。**风险**：若代码用**别的名**实现，设计名 grep 是**假阴**（我一贯 flag 的"grep 空只在搜对名时才证缺失"）。
- 🔴 **我独立用【结构/covenant 名】复核**（不靠设计术语）：`git grep -liE 'LOCKED_R|LOCKED_F|O_AUTHORIZED|reactive|oauth|checkSigFromStack.*blake2b' -- '*.sil'` = **空**；`git grep 'locked_r|locked_f|o_authorized|oauth_cid|reactive.?claim|reactive.?leg' -- kasia-console/src kasia-relay/src` = **空**。⇒ **fair-exchange 的承重构造（LOCKED_R/F、O_AUTHORIZED 反向焊、reveal 支 checkSigFromStack(A)∧blake2b(s)）在任何 .sil 与任何 JS 里都不存在。**
- 🔵 primitive 存在但只作**探针**（`CheckSigFromStackProbe.sil`/`Blake2bProbe.sil` 有单原语），**组合成 fair-exchange 支的构造没有**。⇒ **设计名 grep(VB-5) 与结构名 grep(我) 两套都空 ⇒ 覆盖足、结论对名鲁棒。** 不是假阴。

## ② "Tier-2 零改动即禁用" + (23)/(21) 定位 —— 🟢 成立
- **"零改动即禁用"= TRUE**：没建的东西无需/无法"翻开关禁用"；无门 = **最强 fail-closed**。§4.4/§4.5.对 §6-3 = 零改动准。
- 🔴 **(23)/(21) 地板/k_max 定位——【对，且须点明是两个不同的"off"】**：
  - **现在 off 的原因 = (a) 结构性未建**（VB-5，本题）。
  - **(23)/(21) 的地板/k_max = (b) 【将来 (b)-实现时的入场闸设计要求】**，不是 live 开关、不 gate 现在任何东西（现在没东西可 gate）。
  - ⇒ **两个 off 互补不冗余**：(a) 是**现在**为何 off；(b) 是**若/当建起来**入场闸怎么判（我 (23) v0.4 "s_max=1⇒fail-closed" 是 (b) 的机制，与 (a) 同向但不同因）。⇒ **(23)/(21) 是 build-time 需求文档、非运行时控制**——这正确，且和 VB-5 "现网结构性禁用"咬合：现在不靠地板闸（靠没建），地板闸是未来建它时的门。**建议 (23) 下版加一句这个定位**（免得读者以为地板闸在 gate 现网）。

## ③ 三 tier 术语分清 —— 🔴 **MUST：落 durable 权威处（不能只在本盘点）**
- 三个"tier"（§6-3 Tier-2 fair-exchange / committed ZK 结算 / `audit_mode='tier2'` 声誉）**混淆的危害是【操作性的】**：把 §2 的 ZK 开关误当 Tier-2 开关 ⇒ 翻 `ADMIN_ZK_*_ENABLED` 会**关掉现网在用的 committed 结算**（§4.5 已警）。这不是文字洁癖，是**误操作会停 live 结算**。
- 🔴 **本盘点在 scratch/一次性 doc 里 = 会被漏**（同"接位者读过期指令"族）。**MUST：三术语对照表落进【最常读的权威处】**——建议 `docs/DEVELOPER-GUIDE.md` 术语表 + `DECISIONS.md`/D-012 一条指针（"§6-3 Tier-2 ≠ committed ZK ≠ audit_mode='tier2'，翻 ADMIN_ZK_* 关的是 committed 结算不是 Tier-2"）。放哪是细节，**不放 durable = 下一个 agent 仍会撞**。

## ④ 其余核（PASS）
- 🟢 §2 committed ZK 开关盘点准、**全 fail-closed**（ADMIN_ZK_* `!=='1'`⇒503 / ZK_CLOSEZK_SIL_PATH 缺⇒throw / zk_native 默认 false + 无 anchor⇒throw），现网 ADMIN_ZK_*=1 启用。**"别把 ZK 开关当 Tier-2 开关"是本盘点最重要的操作安全注。**
- 🟢 §3 `audit_mode='tier2'` = 声誉信号非结算路（bettor.js:2316 原注 "NOT settle path"）——准。
- 🟢 §4.3 **读者枚举纪律好**：逐个 grep zk_native 读者、确认无"写 zk_native 触发自动花钱 tick"的隐藏读者（铸市场时定、铸后 family-coherence 守卫不可变）——正是我 `authorization-field-is-selection-key` 的反向应用（这次确认 zk_native **不是**自动花钱选择键）。
- 🟢 §2 尾"牙未武装"接 `reference-trustless-teeth-built-but-not-armed-voter-off`——诚实标 committed 结算 voter 武装态另说、不在开关面。

## 交付判词
- **VB-5 Tier-2 开关盘点 = GREEN-WITH-1-MUST。** 核心发现（Tier-2 结构性未建）**独立结构名 grep 复核成立、对名鲁棒**；ZK 开关 fail-closed 准；三术语分清准。
- **1 MUST（③）**：三 tier 术语对照落 **durable 权威处**（DEVELOPER-GUIDE 术语表 + DECISIONS 指针）——混淆危害是**误翻 ADMIN_ZK_* 停 live 结算**，只留 scratch/一次性 doc 会被下个 agent 漏。
- **1 建议**：(23) 下版点明地板/k_max 是 **build-time 入场闸需求**（未来 (b)-实现），非现网运行时控制——与"现网结构性禁用"两个 off 互补。
- **给 Owner 一句**（采纳 §5）：§6-3 Tier-2 现网禁用**已是结构性事实**（没建，无开关可翻）；live 有开关的是 committed ZK（另一 track，别混）。
