# #28 结算+状态同步架构评审 — 状态收敛地基(J1 域分卡)

> **Status**: CURRENT(设计草案 v0.1 · 2026-07-20 · J1tn 起草)
> **定位**: 本卡是 Bettor 组织的 #28 架构评审的 **J1 域分卡**(状态收敛地基 + 结算侧 enforce/state 具体修复项),不是 #28 全案。#28 全案(现状/目标架构图、模块化边界、迭代路线、fireworks-tech-graph 出图)由 Bettor 主编,本卡作为其"真相源层/结算状态"部分的技术输入。
> **触发**: 2026-07-20 世界杯决赛(85fit)结算 firefight——`consolidated_pool` 字段被 evidence 写回整块覆盖清掉→resume 用预测值→续接地址全错→claim 卡死。Owner 复盘直指"多状态不统一"根病。
> **审批**: 本卡 → NWT 红队 → Bettor 审 → Owner 批(涉钱路改动的项单独 money-path 签发)。

---

## 0. 一句话根病(Owner 2026-07-20 诊断,团队四方坐实)

结算把**本地 DB / evidence JSON** 当"池里有什么"的真相源,但它们会跟**链上真值**脱节,且脱节后无可靠对账机制。状态散在三处(**链上 covenant = 绝对真相** / `settle_evidence` = 进度检查点 / DB 各表 = 逐项记录),互相漂移,"哪个消费者读到对不上的旧视图就单独打个补丁改它读别处"(头痛医头),不是根上把状态收敛成一份。

## 1. 收敛原则(#28 目标态,焊死)

**链上 = 唯一权威真相源。`evidence` 和所有 DB 表一律降级为"可随时从链重建的缓存/视图",不再各自存一份可能对不上的独立状态。**

- 任何"关键派生值"(如 `consolidated_pool`、`payoutRoot`、claim thread 续接点)在使用点**优先从链重新派生**(re-derive-from-chain),而不是读一份可能陈旧/被覆盖的存储值。
- 缓存(evidence/DB)只做**加速**,且每次使用前带**一致性校验**(re-derive 后跟缓存比对,不符 fail-closed,不瞎跑)。J2 观察:大多数 evidence 字段(如 `payout_root`)今晚**已经**是这个模式(resume 独立重算再比对,不符 fail-closed)——这套纠错机制是好的、全程 work;`consolidated_pool` 是**唯一漏了这层**的字段(既没 re-derive、也没 durable persist,靠 formula fallback,巧合掩盖到 85fit 才炸)。
- **收敛=把"re-derive-from-chain + 一致性校验"从个别字段推广成结算全状态的统一纪律**,而非把三处状态物理合并成一张表。

## 2. 今晚 + 历史漂移点清单(证据链,#28 inventory 的 J1 域部分)

| 漂移点 | 现象 | 根因 | 修法方向 | money-path |
|---|---|---|---|---|
| **consolidated_pool 被覆盖** | resume 读 undefined→formula 2021→续接地址全错(prhlzepg≠ppdveg9ay)→claim 卡死 | evidence 写回**整块 replace 非 merge**,新加字段被冲;且该字段没 re-derive-from-chain | ①evidence 写改 preserve-merge(见下);②使用点改 re-derive: fresh-close(`bshard-auto-settler.mjs:397` formula)+ resume 都从链上真实 consolidated pool 取(跟 enforce 侧 `line385 ps.consolidatedPool` 同源) | 🔴 是(改结算构造值) |
| **evidence 整块 replace** | daemon 每 tick 重写整个 settle_evidence 对象,任何新加字段漏进 writeback 白名单就被冲(NWT 坐实通用坑) | `bshard-settle-daemon.mjs:744-761` writeback 是全新 construct 非 merge | 改 `json_set` merge(spread 旧值+覆盖特定字段),或更彻底走 §1 re-derive | 🟠 否(纯持久化机制) |
| **fresh-close 用 formula pool** | `bshard-auto-settler.mjs:397` fresh-close `consolidatedPool=(poolSompi+seed)` 是预测值;未来孤儿盘 fresh close 会 build+持久化预测值(重演今晚) | claim-threading 起点 curRedeem 用 formula,不读链上真实 `ps.consolidatedPool`(enforce 侧 a86af952 已用真值,两侧对孤儿盘会裂) | fresh-close 改读 `ps.consolidatedPool`(psState 链上真值,与 line385 同源) | 🔴 是 |
| **claim_txid 列语义废弃 for bshard** | `pool_bettor_sides.claim_txid` 对 bshard 盘永远 NULL(只 V1 退款路写);内部审计端点 `audit-prediction.js` 读它会显"未claim" | bshard claim 只写 `settle_evidence.winner_details` JSON,不写这张表列;/mybets 已 #48 补丁改读 evidence(用户面没破),但 audit-prediction.js 漏了 | 标注该列 for bshard 废弃 + audit-prediction.js 改读权威源(evidence) | 🟠 否(审计工具/语义) |
| **broker 佣金通知漏 emit(#30)** | bshard 盘 broker fee 落链但无 `broker_fee_landed` 事件→tg-bot 查不到→不通知 | `broker-fee-emit.mjs` 候选 match 只查 V1 settle_txid outputs + ZK zk_escape_audit;bshard committee-sig 盘 broker fee 是独立 claim tx(85fit=d428e97d),两处都不覆盖 | broker-fee-emit 扩 bshard 分支:从 settle_evidence.winner_details/claim_txids 找 broker 地址那笔 claim,链验金额后 emit(D-007 chain-truth 口径,daemon 全灭照样准);+ broker 投递通道(内部 agent 非 tg 用户) | 🟠 否(通知层) |

> 注:D-001 covenant 编译 bug 族(jepu1/212 pre-0706 盘)是**另一族**(编译器 codegen,已 7/6 修 8065184),不在本状态同步卡内,归 #28 单列。

## 3. 模块化边界(#28 目标图的 J1 域切分)

顺着 §1 目标态切三层(对应 Bettor #28 模块化边界的"真相源层"):

1. **真相源层(链上读写)= J1 chain-read loader 域**:`getUtxosByAddresses` / redeem splice / `spliceLeafState` / C1 complete-set 重建 / broker fee chain 匹配——统一的"从链读真值/重建状态"入口。**这是 §1 re-derive-from-chain 的落点,是我(J1)的核心承接项。**
2. **缓存视图层(evidence + DB,可重建)**:evidence/payout_shards/pool_bettor_sides 全部降级为可从真相源层随时重建的缓存,带一致性校验(re-derive vs cache,不符 fail-closed)。
3. **结算引擎层(close→claim→complete)**:只从真相源层拿状态、往缓存层写(preserve-merge),不再自己维护会漂的独立状态。

## 4. 迭代路线(渐进 vs 大改,排优先级)

- **P0 低风险渐进(先收敛一个漂移点验证机制)**: consolidated_pool re-derive(§2 行1/行3)——它是今晚炸点,先把它改成"使用点从链 re-derive + 一致性校验",作为收敛纪律的第一个样板,验证模式可行。带回归测试(**孤儿盘 + 重启穿越结算中途**两个今晚缺的场景)。
- **P1 通用机制**: evidence 写回改 preserve-merge(堵"新字段被冲"通用坑,一次性防未来所有同款)。
- **P2 结构性**: 全状态推广 re-derive+校验纪律 + 真相源层模块化(§3 第1层统一入口)。大改,分批走。
- **卫生项**: claim_txid 语义废弃标注 + audit-prediction.js 改源;broker-fee-emit bshard 覆盖(#30)。

## 5. DoD / 验收

1. **回归测试(今晚缺的盲区,必补)**: ①带孤儿盘(consolidatedPool≠注册和)的结算 e2e;②daemon 重启穿过结算中途(close 后、claim 中途)的 resume 正确续接。这两个场景今晚都没覆盖=测试盲区,是潜伏 bug 长期不暴露的根。
2. consolidated_pool re-derive 落码后:三源 co-verify(链上真值 vs re-derive vs 一致性校验),孤儿盘/正常盘各跑一遍。
3. evidence preserve-merge 落码后:构造"新加字段"用例,验证不被 writeback 冲掉。
4. 每项涉钱路(🔴)单独 money-path 签发(Owner),非钱路(🟠)走正常报备审批。

## 6. 承接分工(建议,待 Bettor 派)

- **真相源层 + consolidated_pool re-derive + 状态收敛纪律 = J1(本卡作者,enforce/state/chain-read 域)**
- evidence writeback preserve-merge = J2(settler daemon 域)+ J1 审(state 序列化)
- broker-fee-emit bshard(#30)= J1
- 回归测试框架(孤儿/重启穿越)= J1+J2 共建
- 现状/目标架构图(fireworks-tech-graph)= Bettor 主编,本卡 §1-§3 供内容

— J1tn 2026-07-20
