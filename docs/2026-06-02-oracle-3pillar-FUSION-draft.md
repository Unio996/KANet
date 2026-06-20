# 融合方案(草稿·待 NWT 攻击面填完即定)— oracle 技能支柱活化

> **状态**: 4 家(KANet-UI/J2/J1/NWT)对抗收敛。**Owner review(2026-06-02)认 C2/C3/C4 + framing,钦点必修 2 处(R1 处置太宽容 / A4 小节点 row-diff 是 placebo)+ 深层指引(质押经济模型:持币多≠操控规则,在线时长+声誉=被选关键)。** 本稿已纳必修 + 指引 → 待团队整合 selection 指引 → 交 Owner 终裁。
> **议题源**: `docs/2026-06-02-oracle-3pillar-balance-discussion.md`

## 1. 共识锁定(4 家一致 + 对抗收敛)

| # | 结论 | 来源 |
|---|---|---|
| **C1 只攒不发** | 现在开 Phase2 攒信任(写 oracle_history.shadow_correct + uma_assertion_id),**0 经济影响**(守 G5);auto-grant 发执照**仍硬 gate 锁** | Bettor 草案 + KANet-UI r500 + J2 r293 |
| **C2 三道 gate** | 攒(开)→ frozen 刹车(锁)→ auto-grant 发证(锁)。frozen 真启用 IS 选拔影响(被冻=排除出池),故现阶段 frozen 也锁 | Bettor r194 + J2 r293 ack |
| **C3 双轨不对称(Owner 指引细化)** | **能力(LLM-judge domain accuracy)不进选拔权重、不进 reward**(calibration 未做前不让 LLM judge 驱动经济)。但选拔**不是纯 stake 线性**——见 C6。 | KANet-UI r500 + Bettor + Owner 6/2 |
| **C4 仅 mirror-able 攒** | shadow 积累**只限**外部可验源市场(data_source_canonical=UMA/Polymarket/第三方);纯 kanet_native(self-source=self-judge)**SKIP**(自判自比=刷分非能力) | Bettor r194 攻 + KANet-UI r501 ack + J2 r293 |
| **C5 R1 社交层护栏(Owner 必修)** | R1 极端组合(极低 capability + 极高 stake)**不刹经济权**(守 C3 不破双轨)**但公开标记可见**(UI 红旗 + capability-snapshot 暴露)。理由:testnet 期 R1 一次触发=公开事故挂协议名下叙事冲淡,只"alert+上报"太宽容,须用户侧可见的社交护栏。 | **Owner 6/2 必修** |
| **C6 选拔=经济保险 + 声誉/在线择优(Owner 深层指引)** | **质押 = PoW-like 经济模型 + 给应用系统 PoS 经济保险 + staker 自身收益**;**但持币多≠操控规则权**(whale-cap 护栏#1 已锁)。**被选关键 = 连续在线时长 + 声誉积累**(客观可观察:uptime + 准时参与 + 诚实结算历史,NON-LLM)。∴ 选拔权重 = stake-linear(sybil 基,拆身份不赚)× **声誉/在线因子**(择优 + 防 whale 独大),与 5/30 economic-security-spec "stake线性" 调和(线性防女巫 + 声誉择优 + whale-cap),**不引入 LLM capability**(守 C3)。**待 J2(选拔域)+ economic-security-spec 整合定参。** | **Owner 6/2 指引** |

## 2. 实施分工(待 Owner 钦定后开工)

- **@J2-tn**(引擎): (a) `recordParallelJudgment` 接 `pool-market-settler.js` settle accept 后,`IF outcome_market_source IN ('polymarket','uma',<whitelist 外部源>)` → trigger LLM/UMA-finalization judge 写 `oracle_history` shadow row + uma_assertion_id;native SKIP(source filter SQL)。(b) `postSettleAudit` 同 filter,SQL JOIN committee_vote vs shadow,偏离>threshold → INSERT `oracle_disagreement_queue`。**ETA 4-6h**。testnet 解 record/audit 的硬 gate(攒),保留 auto-grant 硬 gate(发)。
- **@KANet-UI**(信任 UI): (1) `/oracle/:relay_id/audit`:`shadow_rows_external`(mirror-able only,算能力分)vs `shadow_rows_native`(标灰 info-only)+ 30-settle 滑窗准确率 + frozen 距离 + 历史 diff 列表。(2) `/oracle/leaderboard`:准确率排名**仅用 external rows**。(3) `GET /api/oracle/capability-snapshot`:暴 `source_breakdown {external/native}`,NWT verifier 跨节点 diff 防刷分死角。
- **@J1tn**(SS): 能力问责**不进 silverc 链上验**(silverc 单 TX 无法 aggregate 多 settle 历史判累积偏离);dispute_reveal **emit 链上证据**(个体票上链可审),累积冻结决策走链下引擎读链上证据。
- **@NWT-tn**(对抗 verifier): 攻击面缓解(见 §4 待填)+ regression:mirror-able filter 不漏 native、shadow 跨节点一致、capability-snapshot diff。

## 3. 守红线(G5)

- 攒数据 ≠ 发执照 ≠ 经济闭环。本方案只让**能力支柱开始积累可验证数据**(Owner "通过 UMA 积累我们自己预言机经验"),**不**改任何经济/选拔/slash 行为。
- 报口径:"能力支柱攒信任引擎接入 pool 路径 + 仅 mirror-able 市场积累 shadow 数据";**不报**"发执照/吊销/经济通电"。

## 4. 攻击面缓解(NWT r283 对抗 + Bettor 收敛)

**攻击面 top-5(NWT)+ 缓解:**
| # | 攻击 | 缓解 | 守它的 lint |
|---|---|---|---|
| A1 | Cherry-pick 参 settle(只参高把握 mirror,拒难市场 → shadow 虚高) | 准确率算 = 参与率加权 / 跨 oracle 参 settle 比例分布监控 | **L3** cherry-pick stats |
| A2 | mirror 白名单注入(加傀儡 trusted source = 高级自判自比) | **白名单必链上治理**(见下)+ lint 拒非链派生源 | **L2** mirror-source chain-derived only |
| A3 | UMA assertion lag race(settle 时仍在 challenge,shadow 记 stale,后翻不改) | 复用 Phase1 已有 **UMA finalization gate(48h)**:shadow 仅在 finalize 后记;窗内 pending 不记 | (复用 derivePolymarketVote gate) |
| A4 | **DB shadow_correct 篡改(关键)**:本地存非链上 → relay 操控本地 row | **诚实口径(Owner 必修)**:小节点数下跨节点 row-diff 是 placebo——攻击者本身是节点则 diff 不出来。L1 **不报"缓解 A4 完成",报"节点诚实假设下检测"**。A4 = testnet **已知限制,公开标记**。真硬化路(Phase-next,二选一):(A) shadow_correct hash 定期 commit 链上 /(B) dispute_reveal emit shadow_evidence 到链(J1 立场)。 | **L1**(诚实假设下检测,非真防御) |
| A5 | Time-batch 操控(集中高把握批 + 拖低,调 rhythm) | L3 + 参与率时间分布监控 | **L3** |

**3 支柱失衡 top-3 风险(NWT)+ 处置:**
- **R1(最大)高 stake + 低能力反向投** → stake-weighted 劣质主导(G3 silent corruption)。**三层收口(Owner 必修后强化)**:① **C6 选拔择优**——选拔权重含声誉/在线因子(非纯 stake),低声誉 whale 选拔权天然被压(结构性,非事后);② **C5 社交护栏**——R1 极端组合公开标记可见(用户侧红旗),不等 frozen;③ **C2 gate2 收口**——攒够 + calibration proven → 开 frozen 刹车冻掉。**L4 stake×capability matrix 长期 alert** 守着,残留对 Owner 透明上报(G5)。(原稿只"alert+上报"太宽容,Owner 钦点必修。)
- **R2 Sybil 经济堆**(单实体多 oracle 各 5 KAS 同向凑 4-of-5,无 capability filter)→ 同 R1 收口(frozen 开后能力 filter 生效);Owner "让他女巫"+ 线性权重经济层已部分自调(拆身份不赚)。
- **R3 老化 oracle**(早 calibrate 好后漂移,经济权未降 + 没冻)→ frozen 持续吊销(Phase3 引擎)+ L4 alert。

**mirror 白名单源治理(NWT,修正 J2 原"本地 source filter SQL"):**
- 单点风险大(Owner 单签 / community vote 慢 / hardcoded lock-in 都不行)。
- **定案 = 链上 + N-of-M multisig governance**:`config_entries.mirror_sources`,改需 N-of-M 签,root 进 pool snapshot merkle;各 host 从链上 config 派生,NWT regression assert `blake2b==` 跨节点一致。
- **分期(Bettor 收敛,平衡"赶紧攒" vs "治理做对")**:
  - **Now(只攒不发起步,0 经济影响)**:白名单 = 极小显式 config `['polymarket','uma']`(testnet 实际只这俩 mirror 源)。注入风险非 load-bearing(纯 shadow 数据,不碰钱)→ **立刻开攒**。
  - **开 frozen 刹车前(gate2,capability 开始影响经济时)**:白名单升级为链上 N-of-M 治理(此时整性才 load-bearing)。
- NWT **4 lint(L1-L4)从一开始 baked** 进 attack-static suite(现 19/19 PASS + 13 INFO,ship 后扩 4 lint）。

## 5. NWT verifier baked lint(ship 后)

- **L1** shadow_correct 跨节点 row-diff —— **报"节点诚实假设下检测 A4",非"缓解 A4 完成"**(小节点数下是 placebo,攻击者=节点则 diff 不出,Owner 必修口径)。NWT §4 应把"小节点 row-diff 失效"列为真 attack vector,非已覆盖。
- **L2** mirror-source chain-derived only(守 A2)
- **L3** cherry-pick stats:跨 oracle 参 settle 比例分布(守 A1/A5)
- **L4** stake×capability matrix:高 stake + 低 capability 长期 alert(守 R1/R3)

## 6. 工作流模板沉淀(Owner 6/2 建议进 KB)

本议题工作流(**实证表格对照设计 vs 现状 → 4 核心议题 → 点名各 agent 出立场 → 对抗收敛 → 融合**)Owner 评"值得作标准模板"。待沉淀进 `D:\KANet-Knowledge-Base`(架构决策模板),供后续重大设计决策复用。

---
*Bettor-tn 主持。4 家(KANet-UI/J2/J1/NWT)对抗收敛 + Owner 6/2 review(认 C2/C3/C4/framing,必修 R1 处置 + A4 诚实口径,深层指引 C6 选拔=经济保险+声誉择优)。本稿已纳。待团队整合 C6 selection 定参 → 交 Owner 终裁 → §2 分工解冻。*
