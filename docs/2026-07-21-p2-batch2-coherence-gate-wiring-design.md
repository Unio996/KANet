# P2 第二批 — coherence gate 接线 + 高频零子进程性能实测 + classifier 家族/模板维度拆分(J1 主稿)

> **Status**: DRAFT(v0.1 · 2026-07-21 · J1,待 NWT 红队)
> **依据**: Bettor 批2派工(#uh1h4i.2 后续,2026-07-21):"范围: gate 接线(调用点分级: 高频 `ensurePayoutShard`/`V2` 三步/低频 `consolidateAndBuildPsState` 四步)+ 高频零子进程性能实测 + classifier 家族/模板两维度拆分(你自己拍(a)时列的设计要点),照旧设计先行→NWT 红队→落码"。
> **前置**: `docs/2026-07-21-p2-batch1-truth-source-layer-k18-landing-design.md`(批1,**DEPLOYED & CLOSED**)——`bshard-payout-family-coherence.mjs`(`probeStructuralSignature`/`classifyPayoutShardFamily`/`assertPayoutShardCoherence`/`assertZkNativeImmutable`)已落码上线,`payout_shards.covenant_family` 已 backfill(v1_committee=623/v2_zk=20/unknown=78),但**目前零调用点在读它/靠它做任何判定**——本批要把这套基础设施真正接上,是 K-18 全案"存在但没人用"→"真正生效"的关键一步。

---

## 0. 核心张力(本卡要解决的设计问题,不是照抄批1直接落码)

批1把 `assertPayoutShardCoherence` 做对了、测试覆盖了,但故意没接线——因为接线本身有一个批1没有的新风险维度:**`ensurePayoutShard`/`ensurePayoutShardV2` 的"早返回分支"是每笔下注的必经读路径**(`registerBettorOnShard` → `ensurePayoutShard`,`existing` 命中就立刻返回缓存值)。如果在这条路径上对 gate 失败做**硬 throw**,一旦某个市场的 `payout_shards` 行被(哪怕暂时)误判为 incoherent,**这个市场的全部下注会被硬拦停**——这是批1完全没有的 blast radius(批1的 `assertZkNativeImmutable` 至今零调用点,`assertPayoutShardCoherence` 至今零调用点,都还没有"接错了会拦住活人下注"这个风险敞口)。

**今天刚发生过的教训适用**:同一批代码今天已经出过 2 个真实 bug(`decodeV1State` marker off-by-one + v189 backfill 门禁盲区),都是"看起来测试全绿但实际有问题"。如果直接把 gate 接成硬拦截,任何第 3 个尚未发现的 bug 都会立刻造成真实资金操作被卡(不是"测试少绿一条",是"活人在链上的钱转不出去")。**这个张力必须在设计阶段解决,不能留给落码时随手拍。**

---

## 1. 提案:失效模式分级 rollout(呼应 P0/批1 已有先例,不是新发明)

**先例**:`bshard-settle-daemon.mjs`(P0,`25b3d0a0`)里已经有一条同类型的"新校验先 non-blocking 上线"先例——`consolidateAndBuildPsState` 的 recompile 校验(`bshard-settle-daemon.mjs:~300`,`compilePayoutShardRedeem` recompile 后跟 splice 结果比对)**从不 throw**,不一致只写 `ps_redeem_recompile_mismatch` 事件到 events 表,splice 结果仍照常作为权威使用——这正是 K-18 §3.4 那条"recompile 只作校验,不作花费权威"原则的具体体现,也是"新校验上线先观测再决定要不要升级成硬拦"的实践先例。

**本卡提案沿用同一模式,按调用点风险分级**:

| 调用点 | 频率 | 提案初始模式 | 理由 |
|---|---|---|---|
| `ensurePayoutShard`/`V2` 早返回分支 | 每笔下注 | **non-blocking**:gate FAIL 写事件(`ps_coherence_gate_fail`,含 marketId/failedStep/reason)+ `console.warn`,**不 throw**,`existing` 缓存值照常返回(维持现状行为) | blast radius 最大的点。今天 78 行 unknown 里如果任何一条其实仍可能被下注碰到(需要核实,见 §2),硬拦会立刻造成误伤;non-blocking 先跑一段时间收集真实信号,确认零假阳性后再考虑升级 |
| `consolidateAndBuildPsState` 使用前 | 低频(每个市场结算一次) | **blocking**(tier=full,四步全跑):gate FAIL → throw,不consolidate | 这是即将花费/构造 TX 的节点,已经是 P0 Tier1/Tier2 校验链条的一部分,批1设计文档原本就把这个点定位为"低频完整四步"——花费前硬拦符合"NO TX NO STATE CHANGE"铁律,且这个点本来就已经有 fail-closed 先例(P0 consolidatedPool 验证) |
| close-transport V2 入口(`buildProposeCloseRequestV2`,`bshard-close-transport.mjs`,行号落码时重新 grep 核实) | 低频(每个 V2 市场 close 一次) | **blocking**(tier=full) | 同上,close 是构造即将签名/广播的请求,不是高频读路径 |

**升级路径(non-blocking → blocking 的退出条件,需要 NWT/Bettor 定具体阈值,本卡先给框架)**:`ensurePayoutShard`/`V2` 的 non-blocking 模式运行 N 天(建议至少覆盖一次完整的日常下注量级,具体天数交 Bettor 拍)零 `ps_coherence_gate_fail` 事件(或全部事件都能归因到已知的 78 行 unknown 桶,而不是新出现的意外失配)→ 升级为 blocking。这条不在本卡落码范围内,是后续独立小卡。

---

## 2. 落码前必须核实的问题(不能假设,今天已经吃过"假设线号/假设范围"的亏两次)

1. ~~**78 行 unknown(63 refunded + 15 pruned_expired_waived)是否还可能被 `ensurePayoutShard` 碰到**~~ **已核实,答案=否**:`pool.js` 两处 `registerBettorOnShard` 调用点(`:1547`/`:1802`)上游都有硬门禁——`:1438`/`:1589` 分别是 `if (market.protocol_status !== 'pending_bettors') return reply.code(409)...`,精确挡在两处调用之前。`refunded`/`pruned_expired_waived` 都不是 `pending_bettors`,物理上不可能触发新的 `registerBettorOnShard`→`ensurePayoutShard` 调用。**这是代码验证过的事实,不是假设**——78 行 unknown 对 non-blocking vs blocking 的风险讨论完全不构成影响,唯一会真实触达 `ensurePayoutShard` 早返回分支的是 `pending_bettors` 状态的活跃市场,这些市场按 batch1 backfill 报告应已正确分类(78 unknown 精确 = refunded 63 + pruned_expired_waived 15,不含任何 pending_bettors 市场)。**§1 non-blocking-first 提案仍然保留**(理由改为:防未来第 3 个未知 bug,而非"78 行 unknown 可能被误伤"这个已排除的假设)。
2. `consolidateAndBuildPsState` 内已有的 Tier1/Tier2(P0)校验跟本次要接的 `assertPayoutShardCoherence` tier=full 是否有职责重叠——如果 Tier1/Tier2 已经覆盖了 (c)(d) 步骤的等价校验,直接叠加 `assertPayoutShardCoherence` 可能是重复劳动(不是错,但要说清楚这次改动增量到底是什么,不能笼统写"接进去了")。
3. `buildProposeCloseRequestV2` 的实际入口函数名/行号(落码时重新 grep,不用本卡这个草稿版本的记忆)。

---

## 3. classifier 家族/模板维度拆分(Bettor 批1 收尾时提出,折入本卡)

**问题**(批1 §6 已记录):`classifyPayoutShardFamily` 现在要求"结构签名符合 V1" **且** "recompile byte-equal" 才判定 `v1_committee`——这把"家族身份"(结构签名回答的问题:这份 redeem 的字节布局像不像 V1)和"创世模板字节完全相等"(recompile byte-compare 回答的问题:这份 redeem 是不是恰好跟一个全新 genesis 模板逐字节相同)两个不同维度的问题捆在一起。63 条 refunded 行家族身份其实毫无疑问是 V1(结构签名早就符合),只是因为 refund-close 之后字节已经偏离 genesis 模板(`closed`/`payoutRoot` 甚至 `w0..w16` 都可能变了)才被误判 unknown。

**提案**:
- `classifyPayoutShardFamily` 改为**只依赖 `probeStructuralSignature`**——结构签名符合 V1 → `v1_committee`;符合 V2 → `v2_zk`;两者都不符 → `unknown`。不再要求 recompile byte-equal。
- recompile byte-equal 是独立维度,改名/归位成 `assertPayoutShardCoherence` 步骤 (c) 专属的"genesis-template 一致性"校验,语义上从"这行是不是 V1 家族"变成"这行现在的 state 是不是能被 splice-authority 独立复现"(呼应批1 §1 边界说明:(c) 验的是 structural/家族正确性,不是 value 时效性——这条边界说明本身在拆分后需要重新措辞,因为"structural"这个词批1用来同时指代结构签名和 recompile 两件事,拆分后要分清楚哪句话说的是哪个)。
- **既有 78 行 unknown 的重新分类**:classifier 改法落地后,63 行 refunded 预期会重新分类成 `v1_committee`(结构签名从来就符合)。15 行 pruned_expired_waived 是否也会变化未知(design doc §0 遗留线索,批1 backfill 报告已经证实这 15 行的 detail 签名和 refunded 组不同,需要单独跑一遍才知道结果,不能假设)。**这是一次事后 UPDATE 修正,不是重跑迁移**——用同一套 `classifyPayoutShardFamily`(拆分后版本)对这 78 行重新跑一遍,只 UPDATE 有变化的行,同样走 `K18_BACKFILL_CONFIRMED` 式的显式确认闸(具体机制沿用批1模式,不重新发明)。

---

## 4. 高频零子进程性能实测(DoD 项 7,批1 遗留)

**目标**:证明 `ensurePayoutShard`/`V2` 早返回分支接入 tier=cheap gate 后,单次调用**真的零 silverc 子进程 spawn**(`probeStructuralSignature`/家族分类步骤(a)(b) + 步骤(d) 的 p2sh 计算走 kaspa-wasm,不是 execFileSync)——不能只看代码没写 `execFileSync` 就当作证明了,要实测。

**方法**(草案,落码时细化):在有 silverc + 有测试数据的机器(KANet-UI)上,对已 backfill 的一批真实 v1_committee 行跑 N 次(比如 N=100)`ensurePayoutShard` 早返回路径(mock `rc`/`transfer`/`landed`,只测早返回分支本身,不测 genesis-mint 那半支路径),用 `process.hrtime`/子进程计数(比如 hook `child_process.execFileSync` 在测试范围内计数调用次数,断言恒为 0)双重验证:①耗时量级是否符合"零子进程"预期(silverc 子进程动辄几十到几百 ms,如果 100 次调用总耗时是 ms 级而非秒级,侧面印证没有 spawn)②直接断言 spawn 计数为 0(比耗时更直接,不依赖机器性能波动判断)。

---

## 5. DoD(草案,待 NWT 补充/钉死)

1. §2 三个"落码前必须核实"的问题有明确答案(不是本卡自己猜的),写回本卡再落码。
2. `ensurePayoutShard`/`V2` 早返回分支接 non-blocking gate:回归测试覆盖"gate FAIL 时早返回值不变(向后兼容)+ 事件表有记录"+"gate PASS 时行为不变"两条,不能只测"接进去了"。
3. `consolidateAndBuildPsState`/close-transport V2 接 blocking gate(tier=full):回归测试覆盖"incoherent 行 FAIL → throw,零花费"+"coherent 行 PASS → 正常往下走"。
4. classifier 拆分后,63(+可能更多)行重新分类的实际结果产出报告,人工过一遍(同批1 DoD-0/DoD-4 纪律,不因为是"改进"就跳过审查)。
5. 高频路径零子进程性能实测有真实数据支撑(非"代码看起来没调 execFileSync"这种弱证据)。
6. 装载后活代码复跑(同批1 纪律,不信任装载前结果)。
7. NWT 红队每步"测试覆盖是否够"专项判断。
8. 测试网真金 E2E(如果 gate 真的接进高频下注路径,建议至少一笔真实测试网下注验证 non-blocking 模式下零阻断+事件表按预期写入)。

---

## 6. 风险 / 待 NWT 复核重点

1. **non-blocking 先行的提案本身是否被认可**——这是本卡最核心的设计决策,不是细节,需要 NWT/Bettor 明确表态同意还是有更好的方案(比如"只对已知 78 行不 blocking,其它一律 blocking"这种更精细的分级,也是一个可能的替代方案,本卡先提最简单的"全体 non-blocking 先行"版本,不代表这是唯一选项)。
2. classifier 拆分改动面看起来小,但"改一个已经落地、backfill 过一次真实生产数据的分类函数"本身就是敏感操作(今天刚犯过一次同文件的错),落码后必须有真实数据重新验证,不能只信单测。
3. ~~§2 问题 1~~ 已核实排除(见 §2 更新),non-blocking-first 提案的必要性改立在"防未来未知 bug"这条更弱但仍然成立的理由上,NWT 复核时请一并评估这条理由单独是否足够支撑 non-blocking-first,还是核实完 78 行无风险后应该直接上 blocking(另一种合理立场,不是本卡唯一结论)。

---

**关联**: `docs/2026-07-21-p2-batch1-truth-source-layer-k18-landing-design.md`(批1,已部署)、`docs/2026-07-18-payoutshard-family-coherence-gate-design.md`(K-18 v1.1)、`kasia-console/src/lib/bshard-payout-family-coherence.mjs`+`.test.mjs`(本卡要修改的对象)、`kasia-console/src/services/bshard-settle-daemon.mjs`(P0 non-blocking 先例出处)。
