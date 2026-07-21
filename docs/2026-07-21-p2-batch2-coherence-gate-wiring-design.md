# P2 第二批 — coherence gate 接线 + 高频零子进程性能实测 + classifier 家族/模板维度拆分(J1 主稿)

> **Status**: **全批(§1/§3/§4)DEPLOYED-READY**(v0.4 · 2026-07-21)。§1(gate 接线+观察者机制)+ 跨机器 fixture/FAIL-inconclusive 拆分修复 → NWT 最终 GREEN(a2a228ea+0505c11a)。§3(classifier 拆分)+ §4(零子进程性能实测)→ Bettor/NWT 双 GREEN(#uiks39)→ 已落码。**唯一未完成的操作步骤**(非代码,见 §8):78 行 unknown 的生产重判(KANet-UI dry-run → 人工过 → 显式重设 `K18_BACKFILL_CONFIRMED=1` 一次性触发)。
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

**升级路径(Bettor 方向审拍定,#uhke6f.1 note①,非本卡落码范围,后续独立小卡)**:non-blocking 模式运行**满 7 天** + 期间**零"未归因"** `ps_coherence_gate_fail` 事件(归因到已知桶——即 78 行 unknown 里那两类——的不算)→ 升级走独立小卡 + NWT 审。

**Bettor 方向审定论(#uhke6f.1,GREEN-with-3-notes,2026-07-21)**:non-blocking-first 在下注路径上成立,且不只是"防未知 bug"这条(本卡草案自己标的)弱理由——是**风险不对称的强论证**:下注路径的 gate 不提供任何钱安全增量(下注本身不从 payout shard 花钱,真正的花费/签名点 consolidate+close 已经按本卡方案上了 blocking,fail-closed 牙齿已经装在对的地方),而它的假阳性代价是**拦死整个市场的下注(liveness 重伤)**。在"安全收益≈0、误伤代价高"的点上上 blocking,是负期望——**non-blocking-first 不是保守妥协,是这个调用点本身的正确终态候选**(升不升级看真实数据说话,不是"迟早要上 blocking"的过渡态)。

**Bettor 三条 note(全折入本卡)**:
1. 升级阈值(已并入上面"升级路径"段)。
2. **【最实质,硬性 DoD 项】事件流必须钉观察者**——non-blocking 模式的信号如果没人读,就是"牙建好没人看"同一类坑(memory 有前科:trustless-teeth-built-not-armed)。要求:`ps_coherence_gate_fail` 必须接入既有 patrol/health 日常监控面,或最低限度**每日计数 check 有明确写清楚归属哪个 domain 负责看**——机制落地,不能靠"以后有人会记得看"这种自觉性假设。参照 `migrate.js v185`(`endpoint_hit_counters`,4 个疑似死端点 7 天观察窗命中计数)同款 observe-only-窗 + 落表计数先例,不重新发明模式。
3. §2.2(Tier1/2 校验链跟四步门职责重叠的实际增量说清楚)+ §2.3(`buildProposeCloseRequestV2` 入口名重新 grep 核实)按 DoD-1 落码前必答,Bettor 无异议直接确认。

**NWT 红队重点(Bettor 指定)**:§6.1 提到的替代方案("只对已知 78 行 unknown 不 blocking,其它一律 blocking"这种更精细的分行分级)是否值得换掉本卡的"全体 non-blocking-first"方案,由 NWT 裁。

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

## 7. 落码状态(2026-07-21,J1,§1 已完成,§3/§4 待续)

**§2.2/§2.3 落码前必答(DoD-1,Bettor 无异议确认后补上正式答案)**:
- §2.2(Tier1/Tier2 与四步门职责重叠说清增量):不重叠。Tier1/Tier2(`verifyRedeemMatchesChainObservedOutput`)验的是"`payout_redeem_hex` 反推地址是否跟链上实际观测一致"(chain-truth 核实);本 gate 的 (a)(b)(d) 三步验的是"`covenant_family` 是否已知 + 字节结构是否符合声明的家族 + `payout_ps_addr` 这个独立 DB 列是否跟 redeem 自洽"(family/DB 自洽性,Tier1/Tier2 完全不检查这三项)。(c) recompile 对 v1_committee 会跟 `consolidateAndBuildPsState` 内已有的 non-blocking 校验(`bshard-settle-daemon.mjs` 原 line ~300)有计算重叠,但那条检查的是 consolidate 完成后**新解出**的 `psRedeemHex`(事后校验"这次 consolidate 出的结果值得信"),本 gate 检查的是 consolidate 开始前的**原始** `ps` 行(事前门禁"要不要开始这次 consolidate 操作"),时序不同、目的不同,不是重复劳动——已写入 `bshard-settle-daemon.mjs` 代码注释。
- §2.3(`buildProposeCloseRequestV2` 入口名重新 grep 核实):确认无误,`kasia-console/src/lib/bshard-close-transport.mjs:217`。

**gate 接线**(commit 待定,本轮批量提交):
- `ensurePayoutShard`/`ensurePayoutShardV2`(`pool-shard-register.mjs`)早返回分支:non-blocking,gate FAIL 写 `ps_coherence_gate_fail` 事件(含 marketId/failedStep/reason)+ `console.warn`,不 throw,`existing` 缓存值照常返回。新增 `_checkCoherenceNonBlocking` 辅助函数,连 `p2sh` 缺失这类契约错误自身抛异常都被 catch 住(non-blocking 意味着连 gate 自己出错也不能让高频读路径崩)。
- `consolidateAndBuildPsState`(`bshard-settle-daemon.mjs`)开头:blocking(tier=full),gate FAIL 直接 throw,零 consolidate/transfer。
- `buildProposeCloseRequestV2`(`bshard-close-transport.mjs`)开头:blocking(tier=full),同上,在任何 relay 命令/签名请求发起前拦下。SELECT 语句补齐了 `logical_market_id`/`payout_ps_addr`/`covenant_family` 三列(原查询没有,gate 需要)。

**🔴 落码时发现并修复的设计缺口(不是本卡原计划,是接线时用回归测试撞出来的真实问题)**:`assertPayoutShardCoherence` 步骤 (c) 原实现把"recompile 真的跑完但字节不等"(= 真 FAIL)和"`compileSil` 子进程本身起不来"(silverc 二进制缺失/路径错 = 环境问题)混在同一个"抛异常"里——这意味着任何缺 silverc 的节点上,tier=full 对**所有** v1_committee 市场都会无差别抛一个跟"这行数据到底 coherent 不 coherent"完全无关的"spawn ENOENT"异常,把"环境没配好"跟"这个市场真的有问题"混为一谈。用 `bshard-consolidated-pool-rederive.test.mjs`(P0 既有回归测试)在本机(无 silverc)重跑时直接暴露——处置:比照 §3.5 `verifyClaimLanded` 三态设计的同一条纪律("kaspa_tx_log 查无 ≠ 确认不符"),环境层面"查不了"归类为 inconclusive,`console.warn` 记录后跳过 (c),只留 (a)(b)(d) 三步的判定结果,不静默放行(不是把 inconclusive 当 pass)。这个修复本身有生产意义,不只是让测试能跑:防止未来任何节点 silverc 路径配置漂移时,把结算功能整体锁死在一个跟真实数据无关的环境错误上。

**测试**:
- `bshard-payout-family-coherence.test.mjs` 新增 5 条断言块,覆盖 `ensurePayoutShard`/`V2` 早返回分支 non-blocking 行为(coherent 无事件/incoherent 有事件仍返回缓存值/p2sh 缺失不崩)。
- 新文件 `bshard-close-transport-coherence-gate.test.mjs`:验证 `buildProposeCloseRequestV2` 在 incoherent 行上于任何 relay 调用前短路 throw(covenant_family=unknown → 步骤(a);结构签名不符 → 步骤(b))。正向路径(coherent → 真正走到构造 close 请求)需要活 relay + committee + 真实链态,留给测试网真金 E2E(DoD 项 8),不在本次离线测试范围内假造。
- 新文件 `bshard-coherence-observability-monitor.mjs` + `.test.mjs`(Bettor note② 观察者要求):镜像 `spc-daa-index-monitor.mjs` 先例,1h tick 统计过去 24h `ps_redeem_recompile_mismatch`+`ps_coherence_gate_fail` 事件计数,分桶(已知 refunded/pruned_expired_waived vs 未归因),未归因非零才写汇总事件。已接入 `index.js` 启动流程。**这条顺带把 NWT 实测坐实的 P0 遗留观察盲区(`ps_redeem_recompile_mismatch` 全库零消费者)也一并补上,不留半吊子。**
- `bshard-consolidated-pool-rederive.test.mjs`(P0 既有回归测试)fixture 修复:原来的 `fakeRedeemHex` 是任意短 buffer,不满足新 gate 的结构签名要求,会在到达测试想验证的 Tier1/Tier2 逻辑前就被新 gate 拦下(步骤(a)/(b))。改用同 `buildFakeV1RedeemHex` 手法的结构有效字节 + 真实 `covenant_family='v1_committee'` + 真实 kaspa-wasm 推导的 `payout_ps_addr`(不再是占位字符串),让 fixture 通过新 gate 后继续测试原本的 Tier1/Tier2 场景。

**全量回归**:5 个测试文件(`bshard-payout-family-coherence`/`bshard-consolidated-pool-rederive`/`bshard-verify-claim-landed-amount`/`bshard-coherence-observability-monitor`/`bshard-close-transport-coherence-gate`)本机全绿;`bshard-auto-settler.test.mjs` 的既有 `getSidesByShard` schema-drift 失败确认跟今天改动无关(pre-existing,P0 阶段已记录)。lint-kanet 全库 0 error。

**2026-07-21 追加(J2 diff 复核发现跨机器不一致,NWT/Bettor 三方跟进,commit 待定,本轮批量提交)**:

1. **根因(J2 抓到)**:上面的"5 个测试文件本机全绿"只在 J1 本机(无 silverc)成立——`bshard-consolidated-pool-rederive.test.mjs` 的 `fakeRedeemHex` 用手搓占位字节,在无 silverc 的机器上 gate 步骤(c) 走 inconclusive 降级跳过,测试全绿;J2 在有 silverc 的机器上复核同一 commit,`compileSil` 真的跑起来,拿手搓字节(不是真实编译产物)去 recompile byte-compare 必然不等,步骤(c) 真 FAIL,在到达测试本来想验证的 P0 Tier1/Tier2 逻辑之前就被拦下——同一个 commit 两台机器不同结果。**不是接线顺序错**(gate 挡在 P0 逻辑之前正是设计意图),是 fixture 本身只对一种运行环境成立。
2. **修复**:`fakeRedeemHex` 改为优先调用真实 `compilePayoutShardRedeem`(有 silverc 就用真实编译产物,两边环境下步骤(c) 都能给出正确、一致的判定),没有才退回手搓字节(原逻辑保留作 fallback)。
3. **NWT 追加发现(更精确的问题)**:`assertPayoutShardCoherence` 步骤(c) 原来的 `catch(e)` 把三类不同性质的异常混在一起——①recompile 真跑完字节不等(真 FAIL)②`compileSil` 子进程本身起不来(execFileSync ENOENT 等,环境问题)③`ctorBytes32` 在调用 compileSil 之前就同步抛"bytes32 must be 32B"(`pool_merkle_root`/`predicate_commit` 列本身 hex 格式损坏,是数据问题不是环境问题)。原实现把②③一并降级成 inconclusive,会让"这两列 DB 数据本身损坏"这种真实该拦的信号被悄悄放过。**修复**:hex 格式校验提到 compile 调用之前独立做(③直接判 FAIL,不进 try/catch),只把"调用 compileSil 本身"包进 try/catch(此时能进来的异常只剩②环境类才降级 inconclusive)。
4. **Bettor 死代码核查裁定要求**:`consolidateAndBuildPsState` 顶部新 gate(blocking)挡在 P0 既有非阻塞 recompile 校验(`ps_redeem_recompile_mismatch`,line ~316)之前,后者是否已经变成不可达死代码——**结论:不是**。逐分支验证已写入 `bshard-settle-daemon.mjs` 代码注释:①`needConsolidate=true` 分支 consolidate 后产出全新 `psRedeemHex`,新 gate 从没见过这份数据;②`needConsolidate=false`+Tier2 命中同理,genesis-walk 重建出的新值新 gate 也没见过;③唯一"两者内容重叠"的子情形是 `needConsolidate=false`+Tier1 命中(沿用原始未变的 `ps.payout_redeem_hex`)——这种情形下两者确实会给出一致结论,但不构成"整条检查路径不可达",继续保留两条检查。
5. **NWT 方法论提醒(今晚第二次撞到同类问题,第一次是 marker bug 的手搓 fixture 自证自洽)**:"全绿"信号在环境不一致时有歧义,不能让"真的验证过"和"环境跳过没验证"长得一样。`bshard-consolidated-pool-rederive.test.mjs` 结尾摘要新增显式报告(真实编译次数 vs 手搓字节退回次数),silverc 不在本机时用 `⚠` 标注"步骤(c) 从未真的执行验证",不再是笼统一行"✅ all checks passed"。

**待续(不在本次提交,§3/§4 后续另行提交)**:classifier 家族/模板拆分(§3)+ 高频路径零子进程性能实测(§4)。

---

## 8. §3 classifier 拆分 — 改动范围说明(落码前先报审,NWT 已 GREEN §1,现在轮到 §3)

**代码改动**(改动面小,但落码纪律同批1"改一个已 backfill 过真实生产数据的分类函数"一样敏感):
- `classifyPayoutShardFamily(row)` 简化为**只依赖 `probeStructuralSignature`**:V1 结构签名符 → `'v1_committee'`;V2 符 → `'v2_zk'`;两者都不符 → `'unknown'`。不再要求 recompile byte-equal。
- 副作用(好的):`classifyPayoutShardFamily` 从此不再需要 silverc,可以在任何机器上完整测试(不再需要 SKIP 分支)。
- recompile byte-equal 逻辑不删除,继续留在 `assertPayoutShardCoherence` 步骤 (c)(§3.3 花费前 gate 专属),只是不再被 `classifyPayoutShardFamily` 重复调用一次。

**生产数据后果(必须说清楚,不是"顺手改改")**:
1. batch1 backfill(migrate v189)已在生产跑过(`K18_BACKFILL_CONFIRMED=1` 装载窗执行),78 行 `unknown`(63 refunded + 15 pruned_expired_waived)仍原样停在 DB 里——这次 classifier 改动**不会自动重跑**它们,除非再次触发 v189 的 backfill 循环(它的条件是 `WHERE covenant_family = 'unknown'`,重启时若 `K18_BACKFILL_CONFIRMED` 仍是 `1` 会再次捡到这 78 行,用新 classifier 重判)。
2. 预期结果(不是猜测,是结构分析):63 行 refunded 的结构签名早就符合 V1(批1 backfill dry-run 报告已经证实"V1 结构签名符但 recompile 不等"),新 classifier 下会变成 `v1_committee`。15 行 pruned_expired_waived 结果未知(结构签名从没单独测过,只知道 recompile 也不等——需要真跑一遍才知道,不能假设)。
3. **需要 Bettor/KANet-UI 确认**:`K18_BACKFILL_CONFIRMED` 这个环境变量装载窗后是否还留在 `kanet.env`(如果是一次性用完就该移除的开关,这次 classifier 落地后需要**显式重新设置**触发一次新的 backfill 循环,不能假设它还留着;如果留着,任何后续重启都会**静默**重跑这 78 行——这本身可能不是期望行为,需要团队确认这个开关的持久化语义)。
4. 沿用 K-18 §5 DoD-0 纪律:即使这次重跑不需要子进程/silverc(纯 JS 结构签名判断,零成本),**仍然要产出一份新的 dry-run 式报告**(78 行 unknown 重判后的新分布)供人工过一遍再让它在生产真正生效,不能因为"这次改动看起来小/不需要 silverc 所以不用那么谨慎"就跳过复核这一步——**这正是本卡自己在 §7 记录的方法论:环境/成本低不等于风险低,数据层面的改动都要走同一套纪律**。

**测试计划**:`classifyPayoutShardFamily` 现有单测(`bshard-payout-family-coherence.test.mjs`)里"两次都不过→unknown"那条断言需要保留(V1/V2 都不符的情形依然存在);新增断言覆盖"结构签名符但 recompile 会不等的历史数据模式"(用 63-refunded 类型的构造:结构签名符合但状态明显非 genesis-shape)现在应该判 `v1_committee` 而不是 `unknown`。

**NWT 复核重点(自提)**:这条简化是否会让 classifier 对"结构签名凑巧符合但实际是损坏/伪造数据"的行更宽松(过去靠 recompile 兜底多一层防线,现在少了这层)——需要评估这个风险是否真实存在,还是理论上存在但结构签名本身(offset 518/1002 双点位匹配)已经足够窄,不容易被"凑巧"符合。

**结论(2026-07-21,全部三方 GREEN)**:Bettor 方向审 GREEN(#uiks39.1/.2,同时拍定 `K18_BACKFILL_CONFIRMED` 一次性窗口开关语义,KANet-UI 已在 kanet.env 里改回注释状态,批1那次 backfill 使命已尽)。NWT 复核 GREEN(#uiks39 后续):概率论证——`probeStructuralSignature` 的四重指纹(marker 位置 + 长度 + 两个独立 32B 字段 byte-exact 匹配)伪造/损坏数据凑巧同时满足的概率可忽略;即便某行真被误标,花费时(consolidate/close)仍会在 `assertPayoutShardCoherence` 步骤 (c) 被 recompile 重新拦一次,安全边界没有变化,只是"标签逻辑"与"花费门禁逻辑"职责正确分离(拆分本意)。**已落码**(commit 待定,本轮批量提交)。

**§3 落码状态**:`classifyPayoutShardFamily` 简化完成,不再调用 `compilePayoutShardRedeem`,不再需要 silverc。测试更新:原来 SKIP-gated 的"V1 结构签名符但非真实编译产物"用例改为直接断言(不再 SKIP,预期 `v1_committee` 而非 `unknown`);新增"batch1 backfill 报告实证案例"回归(结构签名符但 `closed`/`consolidatedPool` 已偏离 genesis 快照,模拟 63 条 refunded 组特征,现在正确判 `v1_committee`)。全量回归 6 个测试文件本机绿 + lint 0 error。**78 行 unknown 的实际生产重判仍未执行**——按 §7 §8 商定流程(KANet-UI 出新 dry-run 报告 → 人工过 → 显式设 `K18_BACKFILL_CONFIRMED=1` 触发一次性重判 → 用完归位),不在本次代码提交范围内,是落码后的独立操作步骤。

---

## 9. §4 高频路径零子进程性能实测 — 落码状态(2026-07-21)

新文件 `bshard-payout-coherence-perf.test.mjs`。两条独立信号(不是只信一条):
1. **直接 spawn 计数拦截(承重断言)**:用 `createRequire` 拿到 `child_process` 的 CJS module.exports 对象,patch 它的 `execFileSync`——`node:child_process` 的 ESM 具名导出是对底层 CJS exports 对象的活绑定,patch 后 `pool-bshard-artifacts.mjs` 里 `import { execFileSync } from 'node:child_process'` 这条既有具名导入会透传到 patch 后的版本(先用一次直接调用验证拦截确实生效,不是"没报错=以为拦住了"这种弱证据)。`ensurePayoutShard`/`V2` 早返回分支跑 200 次,spawn 计数恒为 0——这是**直接证据**,不是推断。
2. **耗时量级(次要, 交叉验证)**:200 次调用本机实测 6.03ms(0.03ms/次)。silverc 子进程按本库其它地方文档记录(pool-bshard-artifacts.mjs ETIMEDOUT 事故注释)是"几十到几百 ms"量级,200 次真 spawn 会是秒级——6ms 总耗时是这条弱信号(受机器负载影响,不作为唯一证据)对(1)的交叉印证。

全量回归 6 个测试文件本机绿(新增 `bshard-payout-coherence-perf.test.mjs`)+ lint 0 error。

---

**关联**: `docs/2026-07-21-p2-batch1-truth-source-layer-k18-landing-design.md`(批1,已部署)、`docs/2026-07-18-payoutshard-family-coherence-gate-design.md`(K-18 v1.1)、`kasia-console/src/lib/bshard-payout-family-coherence.mjs`+`.test.mjs`(本卡要修改的对象)、`kasia-console/src/services/bshard-settle-daemon.mjs`(P0 non-blocking 先例出处)。
