# NWT 红队 — B线落2 落码 diff 审(6f51fbaa)

> **Status**: CURRENT
> **对象**: commit 6f51fbaa(9 文件:migrate v184/pool.js create/enforce/settler/pool-shard-settle/transport/fee-split/phase2.test/DATABASE.md)
> **verdict**: **GREEN-with-notes——代码正确、可部署(同窗装载后);N1/N2/N3 = 诚实口径+潜在接线,非阻塞,报数时必精确 scope**

---

## 五核点(落码前我列的清单)逐条亲验

| 核点 | 结果 |
|---|---|
| ①判别式载荷有无对 null/非 null 统一 | ✅ enforce:287-307 feeRules!=null → computeMarketCommitV2(含 identity 锚);deriveMarketPredicateCommit 镜像。**四分支**(载荷 v2 / legacy predicate-null-metadata / legacy predicate / 缺 metadataHash 拒),对齐 |
| ②computePariMutuelPayout 消费点扫尽第 N+1 | ✅ 全库 15 处:V1 三处(settler:105 computeSettlePlan / resume:181 / enforce:461 tail)全接线;V2 五处 scope 外零触;:314 v0.6 enforceCommitteeSign 不适用。**无第 N+1 处漏配** |
| ③P3 交叉断言实落 enforce 非只设计 | ✅ enforce:305-313 `_hintBroker !== _rulesBroker → 拒签`,phase2.test④(iii) 真 _enforceCloseAttestCore 负例实测(非复刻) |
| ④v184 trigger 实触发负测试 | ✅ phase2.test⑥ 真 run-migrations 隔离库跑,改写/清空 RAISE + NULL→值一次 + 等值放行四断言实测绿 |
| ⑤:3300 委员同窗装载 | ✅ commit message + DoD#4 显式含;部署项非代码项(交 KANet-UI 排窗) |

## 承重一致性(fail-always 风险)——全部 VERIFIED SOUND

**create↔enforce commit 一致**:三个烤点 deriveMarketPredicateCommit(market) 的 `market` 全走 `SELECT * FROM pool_markets`(pool.js:1240 create / 1391 confirm / 1674 admin)→ fee_rules 列必在 → 烤 v2 commit;register 用同一 predicateCommit 建 PS 地址,bettor 注册/settle 用同一 redeem,offset-518 结构自洽。**无"烤 legacy 但持久化 v2"分叉**。

**测试真实性**:phase2.test 用真 _enforceCloseAttestCore / 真 computeSettlePlan / 真 migration,非 hand-faked fixture——P1 第三分支(隐瞒 predicate-null→裸 metadata_hash≠v2 BUST)、P2 早退(poolMembers 零调用断言=证明发生在 selectCommittee 前)、P3 分叉拒签均真函数负例。30 断言我亲跑 exit 0。

## N1 🟡 note(vacuous-teeth / 诚实口径,报数必守): trustless 牙建好但 live 未装

commit-v2 / P1 / P3 的**全部 trustless enforcement 活在 enforceCloseAttest(committee 路径)**,而 `BSHARD_CLOSE_VOTER_ENABLED` **默认 OFF**(voter.js:258)——live 结算走 driver 自结算(settleMarketLive/computeSettlePlan)。driver 路径**正确计算 fee 叶并付 broker**(test⑤(iii)+DoD#3 会实证),但 driver **自授权**:live 路径上没有任何东西阻止恶意 driver 忽略 committed feeRules。**∴ 落2 交付的是"可配 trustless 机制"(spec §3),但牙未装到 live 结算路**。这与 COORD-LEDGER 诚实口径铁律一致("别 claim production-trustless 直到自治 daemon 真落+红队过+双节点同证")。**报数必用级别词:机制证通 < 端到端 demonstrate——禁 claim"分润已 trustless 上链焊死"**,应说"driver 路径 fee 付款 live 可证;committee trustless enforcement 机制证通、live 未行使"。

## N2 🟡 note(潜在 fail-always,V1 committee 装弹前必接): 无活跃 V1 publishCloseRequest 构造点

全库 grep `publishCloseRequest(`:只有定义(transport:22)+ 注释,**零活跃 caller 构造 req**。transport **层**已接 `fee_rules: req.fee_rules ?? null`,但**构造 req 的 propose/publish 上游不存在**(V1 committee 发布当前休眠)。后果:若来日 `BSHARD_CLOSE_VOTER_ENABLED=1` 对非-zk fee 市场装弹、却没先接 req.fee_rules → 委员见载荷 null → legacy 分支 → legacy commit ≠ 链上 v2 → **每个新 fee 市场 BUST(fail-always)**。DoD#3 走 driver 不会撞到。**装弹前必接 publisher + 加"载荷 fee_rules 非空"实弹用例**;记账防将来当新 bug 重查。

## N3 🟢 note(fixture-mirror scope): DoD#3 实弹只行使 driver 路径

DoD#3 建非-zk 小额盘自然结算 = **driver 路径**(VOTER OFF),实证 computeSettlePlan fee 叶 + broker 链上实收 + Σ守恒——这是 live 路径,该测。但它**不行使** enforce commit-v2 / P1 / P3 负路径(那些 unit-only)。可接受(committee 休眠),但 retro/报数 scope 必精确:"driver fee 付款 live-proven;committee 端 unit-proven、live-unexercised"。

## N4 🟢 note(已由 J2 注释披露,确认可接受): resume committeePks=[]

deriveResumePlanFromEvidence 传 committeePks:[] —— interim 规则委员叶 bps=0 天然零叶,吻合;将来委员 bps>0 规则会 root 不吻合 → fail-closed 回退 computeSettlePlan(安全非静默错)。J2 注释已写明,接受。

## 结论

落码质量高:承重一致性自洽、测试真函数非 fixture、P1/P2/P3 忠实落地、消费点枚举我独立扫尽无漏、V1 legacy 字节不动(存量零风险)、单源收敛(三处烤点四行拷贝收敛为 deriveMarketPredicateCommit=顺手消一个"两套并行实现"家族病)。**GREEN,可同窗装载**。N1/N2 是我域的核心把关——不是代码缺陷,是"牙装没装到 live"的口径与装弹前置,**必须进 ledger 防将来把机制证通误报成 live-trustless**。装载后 DoD#3 driver 实弹放行;V1 committee 真装弹另立卡(接 publisher)。

— NWT 2026-07-12
