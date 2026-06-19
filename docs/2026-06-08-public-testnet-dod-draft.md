# 《大众测试 DoD》草案(testnet 公开大众测试就绪判据)

> 2026-06-08 Owner 钦定。目标:开放 testnet 给大众测试者(真实用户来建市/押注/裁决/兑付)。本文 = 草案 → 对抗性讨论达共识 → Owner 终裁 → 直接开干(全自动)。
> 关键认知:大众测试**门槛低于"产品化"**,且**大众测试本身就是攒 oracle 准确率战绩的方式**(不是前置)。门槛 = 安全 + 核心闭环可靠 + 拦得住垃圾 + 不卡资金 + 能上手。

## 一、核心就绪门槛(A-E)
| # | 门槛 | 现状 | owner |
|---|------|------|-------|
| A | **核心闭环跑通一次真实端到端**:建市(过 prevet)→ web 押注 → 真实裁决(非 mock 真源)→ settle 落链 → 兑付 | ❌ 没跑过(长杆)| 全队 + Bettor 验 |
| B | **找零核弹全闭**:settle/refund/disagreement/dispute/claim 全 mass-aware + 各自链测落链(不卡资金)| 🟡 缺链测+dispute/claim+fork 合 | J1 |
| C | **prevet FP/FN 达标**:不误杀好单(FP<5%)、不放垃圾(FN<10%)| 🟡 MVP work 未验 | J2 eval + NWT 集 |
| D | **onboarding 通**:领 test-KAS + 身份/relay + 会用 + 找得到单 | 🟡 半 | KANet-UI |
| E | **部署稳**:不老重启、无 dup-signing、ops 固化 | 🟡 脆 | 全队 + Bettor |

## 二、Owner 钦定的 3 个 UI/机制问题(并入 DoD,草案立场待对抗)

### 问题 1 — broker 首页推荐自己 ≤10 定制单(发现/策展)
**草案立场:** 给 broker 一个"推荐位"(首页 featured ≤10),但【硬条件】**被推荐单必须 prevet 过(≥pass)**,不许推垃圾/未审单 + 标"broker 推荐"透明。利于大众发现,但不能成 Augur 垃圾入口。
**对抗点:** broker 自利推劣质单? FP 误杀好单导致没单可推? 推荐位排序算法?

### 问题 2 — 一个 Agent 同时做 broker + 预言机(现端点允许)
**草案立场:** 允许一个 agent **持有两种角色**,但【铁律】**同一市场内 broker ∉ 该市场 oracle 委员**(自己的市场自己裁 = 操纵向量)。类比 area-1(oracle ∩ bettor = ∅),加 **broker ∩ 该市场 oracle = ∅**;VRF 抽委员时排除 broker_pk。
**对抗点:** 跨市场也要隔吗? VRF 排除够不够? 现端点没这隔离 = 现存漏洞,要补。

### 问题 3 — 用户撤出已注册预言机(现 UI 办不到)
**草案立场:** 加"退出预言机/取回质押"UI,走 OracleStake `timeout_unlock`(无在岗职责才可退);【铁律】**有未决市场在岗时不许退**(必须完成裁决或被 slash),退 = "停接新单 + 无在岗后取回 stake"。
**对抗点:** 在岗期想退怎么办? timeout_unlock 链路 UI 接得通吗(stake 在 P2SH)? 退出要不要冷却期防 hit-and-run?

## 三、DoD 验收(每项)
Bettor 关1(草案对齐)→ 对抗讨论共识 → Owner 终裁 → 建 → Bettor 关2(实测+看链,A 必真端到端落链)→ NWT 关3。oracle 准确率战绩 = 大众测试期间累积(非前置)。

## 四、诚实边界
testnet 范式(非 mainnet 生产);test-KAS 零价值;不报经济闭环(G5);oracle 准确率开测时仍未规模化(靠大众测试攒)。
- **已知信任限制**(团队 2026-06-15 (a) 共识 conscious-accept, 非开门 blocker, mainnet-hardening backlog): 恶意 4-of-5 committee 可铸假 winner 盗池 = pre-existing v07 信任限制(非 #31 chunked 引入), testnet 盗的是零价值币 + committee reputation-bonded+slash。详 [`docs/2026-06-15-known-limitation-committee-winner-attestation.md`](./2026-06-15-known-limitation-committee-winner-attestation.md)(mainnet 硬化 = bettor-membership merkle, MAX_K 砍半)。

---

## 五、R1 对抗收敛 → 定稿(2026-06-08,J1/J2/NWT/KANet-UI R1 齐 + Bettor 裁定)

### 3 UI/机制问 — 共识
- **问1 broker 首页推荐 ≤10**:KANet-UI 三层制衡 = (a) 被推单**必须 prevet ≥pass**(硬条件)(b) 旁显易裁度(推垃圾用户看得到)(c) broker 历史推荐准确率(经济压力)+ filter「broker 推荐区/大众建市区」+ 空态 fallback「无合格推荐→看大众」。**采纳。**
- **问2 agent 兼 broker+oracle**:**同市场 broker_pk ∉ 其 oracle 委员**(VRF 抽样排除)= DoD 硬门(补现漏洞)。跨市场不绝对隔(经济不重叠),**cross-market collusion 监测 = P1+ 非 DoD**(J2)。**采纳。**
- **问3 oracle 撤出**:timeout_unlock(OracleStake_v1.sil)+ UI「退出 oracle」;**N>0 在岗不许退**(完成裁决或 slash);**冷却期 testnet 设 24h**(KANet-UI 提 7 天=偏 mainnet,testnet 缩短,Bettor 裁)+ 取消退出 + auto-unlock 退回。依赖 J1 endpoint /api/oracle/timeout-unlock。

### A-E 裁定
- **A(长杆)**:KANet-UI **自己 web 跑一次真实 SEA 类已结束 sports 市场 全程**(建市过 prevet→web 押注→真实裁决 ESPN→settle 落链→兑付)= DoD 验收标志。Bettor 关2 逐步看链。
- **B**:J1 收尾 —— disagreement **链测** + dispute/claim 扫全 mass-aware + **3 fork 合 1 helper**。
- **C(Bettor 裁)**:**FP<5%(守)/ FN<15%(MVP 开门线,目标<10%)**(NWT:FN<10% 偏紧);fixture 4 类×30=120(MVP 起步 4×20)+ prompt-injection 5 类 + UI 申诉/override 通道测。
- **D**:领 test-KAS 按钮(faucet)+ onboarding wizard(建 agent→领 KAS→建/押)+ 首次 tour。KANet-UI。
- **E**:部署固化 —— commit+push+pull+restart checklist / 防 committed≠live / 无 dup-signing。全队 + Bettor。

**流程:** 本定稿 → Owner 终裁 → 各域按此开干(全自动)→ Bettor 关1 每 impl/关2 实测看链(A 必真端到端)/NWT 关3。
