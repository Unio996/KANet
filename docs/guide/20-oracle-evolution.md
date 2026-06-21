# 20. Oracle 演进系统 (Oracle Evolution — 并行判定 / 执照 / 吊销)

> **最近更新: 2026-06-21** (§20.18 bshard 命门链上收官: deadline-gate CLTV + 跨节点 settle-enforce 防假赢家 LIVE; 复活 §20.14 PARKED 状态 → 命门全链上证毕) — 早: §20.17 oracle wave1 四正交闸+核心 LIVE / §20.12-16

> Owner 钦定 thesis: **正确性不是一次保证, 是长期激励涌现**. 不求"保证不作恶", 求"作恶经济上越来越蠢 / 声誉上越来越致命 / 诚实越来越有利" → 系统随积累自选向可信.
>
> 来源: dev-coord-testnet round 1+2 对抗讨论 (Bettor r133-r152, J1tn R14-R28, Owner r139/r146/r148). 本章是该 thesis 的工程落地权威文档.

## 20.1 三 Phase 迁移路径

| Phase | 名 | 状态 | 说明 |
|-------|-----|------|------|
| 1 | 借信任 | 可独立 ship | 输赢紧贴 Polymarket/UMA (`derivePolymarketVote`). KANet 0 正确性负担. **不等 Phase 2/3** |
| 过渡 | 攒信任 | 引擎 ready | KANet 预言机在能被 UMA 对照的市场上**并行判定** (= 不决定钱, 只记会怎么判), UMA finalized 当 ground-truth 打分攒战绩 |
| 2 | 发执照 | 硬 gate 锁 | 毕业预言机判 UMA 覆盖不了的长尾. 执照 = 客观自动算, 0 主观 (Owner r139) |
| 3 | 持续吊销 | `post_settle_audit` | 正式期持续后验, 作恶模式 → frozen+slash. **Phase 2 发执照前必先 ready (硬 gate)** |

## 20.2 并行判定架构 (Owner r148 — 非纯影子)

**关键认知钉死**: 并行**加速积累**(每单都练预言机), **不加速结算**(钱仍 UMA 48h 节奏). 结算提速靠 Phase 2 毕业后原生市场即时/乐观清算.

```
KANet 5 预言机独立判真实市场 (deriveKanetNativeVote 从独立源)
  ‖ UMA 镜像也判 (derivePolymarketVote + 48h finalization gate)
  ‖ UMA = 最终决策基准 (钱跟 UMA 走)
  ‖ KANet 判定被 UMA finalized 打分 → oracle_history 攒战绩
  不一致 → oracle_disagreement_queue 人工复核, 不直接记 KANet 错
           (UMA 是"最终基准"非"永远对", KANet 在 UMA 错处判对 = 提拔信号)
```

### 两类市场 (J1 R23b 设计洞 → Bettor r149)

**独立判定必须有独立源。无独立源 = 不可能真并行 = 只能镜像。**

| 类 | 判别 (condition_id_mapping) | 行为 |
|----|---------------------------|------|
| 有独立源 | `independent_source` set AND `mirror_only=0` | KANet 从独立源 (e.g. ESPN/BBC) 判 → 对比 UMA → 真打分 |
| mirror-only | `mirror_only=1` (仅 gamma/UMA token) | 诚实标 mirror-only, **不打分** (拿答案考自己无意义) |

⚠ **防假并行铁律** (Bettor r150): KANet 独立判**必须读 `independent_source`, 严禁读 gamma/UMA**. `judgeFn` 内置 assertion: source 含 `polymarket.com|gamma-api` → `throw`. 否则 KANet 永远跟 UMA 一致 = 0 信号 = thesis 落空.

## 20.3 三支柱 (量化)

| 支柱 | 防什么 | 量化 (Owner-locked) |
|------|--------|---------------------|
| 能力 | 无心失 | 影子准确率 vs UMA, 毕业线 ≥90% over ≥100 单, **分域各算** (sports/finance/crypto) |
| 声誉 | 让好的被发现 | `trust_score` 按在险金额加权, 近期权重>远期 (防养肥再杀) |
| 经济 | 故意作恶 | **阈值感知 bond**: `sum(翻结算所需 oracle 的 bond) ≥ pot×1.5`. strict 5-of-5 → bond_each≥pot×0.3; 极限 1-of-5 → pot×1.5 |

发执照收窄 (J1 domain-shift 洞): **域内不跨域** — sports 影子高分只发 sports 执照 (判"X队赢没"技能域内可迁移, 跨域 0 迁移). 真新域 (无 UMA analog) 不能影子打分 → 永久 shadow-only OR 人工抽检.

## 20.4 Schema (J1tn v150-152 + J2 v153)

| 表/列 | 版本 | 用途 |
|-------|------|------|
| `oracle_history` += `shadow_flag`/`uma_resolved_outcome`/`shadow_correct`/`domain`/`uma_assertion_id`/`offer_id` | v150 | 并行+真票 vs UMA 打分记录 (`shadow_flag` 区分 parallel/real) |
| `oracle_registry` += `licensed_domains` (JSON)/`frozen` | v151 | 执照=auto-earned 域; frozen=Owner 安全刹车 (brake≠grant) |
| `oracle_disagreement_queue` | v152 | UMA herding 防误罚: 分歧入队 review (upheld 罚/dismissed 不罚) |
| `condition_id_mapping` (`condition_id` PK + `uma_assertion_id` + `independent_source` + `mirror_only` + `domain`) | v153 (J2) | 两类市场判别 + 独立源锚 + Owner-approved domain |

⚠ `oracle_history.shadow_flag`: `1`=并行(判前演练, 不结算), `0`/NULL=真票(settle). 两者共用 `uma_resolved_outcome`/`shadow_correct` 语义 ("vs UMA outcome"), `shadow_flag` 分流.

## 20.5 引擎 (`services/prediction-parallel-judgment.mjs`)

纯模块, 依赖注入 (`judgeFn`/`umaResolveFn` 由 voter cron 传入, 防 circular import).

| 函数 | Phase | 作用 |
|------|-------|------|
| `getGradingConfig(conditionId)` | — | 读 v153 → `{gradable, independentSource, domain, mirrorOnly}` |
| `recordParallelJudgment(offer, oracle, judgeFn)` | A | KANet 独立判 → `oracle_history shadow_flag=1` (幂等, skip mirror/unmapped) |
| `scoreParallelJudgments(umaResolveFn)` | B | vs UMA finalized → `shadow_correct`; 分歧 → v152 queue (不直罚) |
| `postSettleAudit(umaResolveFn, opts)` | 3 | 真票 vs UMA 交叉核; 单偏离→queue, 持续 >30% over ≥10 → `frozen=1` |
| `isRevocationEngineReady()` | gate | 硬 gate 谓词: ≥1 真票 cross-check 即 ready |
| `shadowAccuracyByDomain(oracle)` | 能力 | per-domain 准确率 agg (read-only) |
| `evaluateAutoGrantCandidates(oracle, thresholds)` | gate | **HARD_GATED**: 返候选但**不发证** |

wire (`bettor-prediction-voter.js` voterTick, best-effort 非 fatal):
```
judgeFn(independentSource, offer)  = deriveKanetNativeVote(offer, {data_source_canonical: independentSource})  // 防假并行 assert
umaResolveFn(offer)                = derivePolymarketVote(offer)  // J2 cea78b1 48h gate
每 5min tick: parallelJudgmentTick (A+B) + postSettleAudit
```

## 20.6 硬 gate (Bettor — 永不违反)

**Phase 2 license 发放 = `post_settle_audit` 吊销引擎 ready + 真测过 之前禁止.**

- 理由: 执照能发不能收 = 大额作恶无 backstop.
- 代码化: `evaluateAutoGrantCandidates` 返 `HARD_GATED: true`, **绝不写 `licensed_domains`**. 解锁需 `isRevocationEngineReady()` true (= 引擎 proven-live, 非仅 code exists) + Bettor reviewer 真测签字.
- 执照机制 (解锁后): 域 D 影子准确率 ≥90%/≥100单 + bond posted → 系统 auto-grant `licensed_domains += D`. **无"谁"发证** (0 主观, 防变信任第三方). Owner 仅 `frozen` 刹车不能 grant.

## 20.7 slash 机制 (待 Owner 拍)

J1 实现 `frozen`(auto 可逆刹车) + 偏离入 `disagreement_queue` 待 review 才 slash. 理由: slash 不可逆没收 bond, 单窗口 auto-slash 会冤杀 UMA-herding 时判对的诚实 oracle (违 "UMA 错处判对=提拔"). 若 Owner 要纯 auto-slash → 加 `SLASH_MODE=auto|review` 开关 (默 review).

## 20.8 关键沉淀 (对抗讨论挖出)

| 洞 | 来源 | 修 |
|----|------|-----|
| domain-shift (sports 90% ≠ 长尾靠谱) | J1 R14 | 域内发执照 + 持续抽检 |
| **PROD bug**: `derivePolymarketVote` gamma `closed` ≠ UMA finalized (24-48h reverse) | J1 R15 放大 | J2 `cea78b1` 48h finalization gate (ship-block mainnet) |
| 假并行 (无独立源 KANet 抄 UMA = 0 信号) | J1 R23b | 两类市场 + `independent_source` + 防假并行 assert |
| UMA herding (UMA 自己错时误罚诚实 oracle) | Bettor 修3 | `disagreement_queue` 不直罚, review/confidence gate |

## 20.9 跨节点委员会 determinism + 规模化 (2026-06-14)

**真分布式委员会 = 链上派生, 永不本地 flag** (`project-crossnode-cosmetic-committee-chain-derive-fix`):
- 委员会从池采样, 池**必从链上派生** (`scanAndDerivePool` 读 stake lock UTXO + enrollment envelope), 不读 node-local `relay_nodes.active` flag。本地 flag override 塑池 = 两节点 root 分歧 → :3300 采不到委员 → 名义委员投不了票 → ~50% zombie。详见 [ANTI-PATTERNS 规则 47](../ANTI-PATTERNS.md)。
- settler self-heal `ensurePoolSnapshotByRoot`: 非 producer 节点按 market 的 `pool_merkle_root` 从本节点 `oracle_pool_chain_view` bake snapshot (saveable=root 链上可复现→bake / doomed=root 只本地人为→null→refund) + `quorum-timeout-refund` 救 zombie。
- 2026-06-14 J1-majority 委员真投票真 settle 四方两 vantage 链验 PASS = 首个真分布式 settle 实证。

**破单市场押注上限 = bshard 滚动分片 + 链上 fold trustless 聚合** (设计完成, 实施 gate 在 demo 后):
- 一个市场切 1→∞ 片 (mass-aware 封片), 各片独立并行结算; 跨片全局赔率靠**链上层次 fold 树** introspection 强制求和 (OpInputCovenantId 输入白名单防伪造 + commit 硬校验, 零 committee-sig)。
- 设计权威: [`docs/2026-06-14-bshard-fold-trustless-§4-consensus.md`](../2026-06-14-bshard-fold-trustless-§4-consensus.md) + KB `products/03-prediction-pool.md` §2.B。

## 20.10 复杂市场 = binary 分解 + 组合 (统一纲领, 2026-06-14)

**任意复杂预测市场 = 一组精确 binary YES/NO 谓词 + 组合层** (Owner 洞察, Polymarket 实证)。让分/大小球/角球阶梯/球员 props 全是 binary("净胜≥2?"/"总进球≥3?"/"角球≥7?"/"Ueda 进球≥1?"); 连续标量拆阶梯/分桶。**我们的 binary YES/NO 池(PoolSpine_v07 + PoolSide)就是普适原语**, 不需新市场类型; 各 binary 池**独立结算**(耦合 ΣYES≈1 是显示/定价上层)。

复杂度搬到两处 = 两条主线:
- **谓词定义 + oracle 判定力** → UMA 引擎(#25): oracle 能力分层 **L1**(终场比分+算术=moneyline/让分/大小球, **现在就够得着**, 一个比分源解锁一批)→ **L2**(半场明细=BTTS/谁先进)→ **L3**(统计级源=角球/球员 props)。
- **组合 + 多池效率** → bshard(#26): 一赛事炸出几十上百 binary 池, 各池无界+并行结。

镜像(seeder)必 verbatim 搬每个 binary 完整谓词(类型+线值+球员/统计目标+时间窗+规则+源), 少搬一项=判错。设计权威: [`docs/2026-06-14-prediction-market-binary-decomposition-charter.md`](../2026-06-14-prediction-market-binary-decomposition-charter.md) + KB `architecture/2026-06-14-binary-decomposition-charter.md`。

## 20.11 委员会 byte-equal determinism 硬化 — daa-anchor 排除 + forward-break 修 (batch2, 2026-06-15)

§20.9 把**池**链上派生; 本节把**委员排除集 (excludePks)** 也链上锚定 → 两节点 committee_pk_hash **全 64 字节 byte-equal** (五方多 vantage 链验 PASS)。

**#27a-v2 — bettor-exclude 链锚 side_lock_daa** (`pool-market-settler-v06.mjs` sampleAndStoreCommittee):
- 委员排除集要排掉「市场内既是 oracle 又下了注」的 pk (oracle∩bettor 防自判)。旧版读 live `pool_bettor_sides` → 跨节点 bet 集分歧 (晚传播的边界 bet) → excludePks 漂 → committee_pk_hash fork。
- v2: bet 计入排除集 **iff `side_lock_daa <= deadline_daa`** (deadline_daa = committee endBlock 用的同一个)。`side_lock_daa` = bet 的 side_lock UTXO **accepting-block daaScore** (链共识, 跨节点 byte-equal; (a) 测 20/20 共享 bet daa 逐笔 byte-equal)。→ 各节点算出同 excludePks → committee byte-equal。
- 单源: 全 repo **仅一个** `captureSideLockDaa` (`trade-protocol-filter.js`), ingest + recapture 都 import 它 (防双实现漂)。
- `side_lock_daa IS NULL` = 歧义 → **fail-loud throw** (绝不静默 include/exclude)。
- **关键性质**: 排除只对 **oracle∩bettor** 起作用。被排 bettor 若**不是 oracle 池成员** → 排不排都同委员 (no-op) → 即使两节点 bet 集不对称, 非-oracle bettor 的有无不影响 committee。

**forward-break 修 (#27a v2.1, e0ktm live repro)** — 新市场的命门:
- bet 注册时 side_lock UTXO 还在 **mempool** (无 accepting-block daaScore) → `side_lock_daa=NULL` at ingest → 到 deadline 采样时 #27a fail-loud on NULL → **新市场永远采不到委员 → 卡到 quorum-timeout-refund = 破新市场/demo 流**。backfill 只救 historical (UTXO 早确认), forward 新 bet 不救。
- 修: `recaptureSideLockDaaForMarket(marketId)` (settler-v06, async) 在 `sampleAndStoreCommittee` **前** await — 对每个 NULL-daa bet 用**同一单源** `captureSideLockDaa` 从链重取 (此时 UTXO 已确认)。idempotent (只填 NULL 行, `UPDATE ... WHERE side_lock_daa IS NULL` 双 guard, 永不覆盖)。truly-unresolvable (spent/从未确认) 仍 NULL → fail-loud as designed (transient: 下 tick 重试, 否则 quorum-timeout-refund)。
- determinism-safe: blockDaaScore 是链共识, 确认后所有节点取同值; fail-loud-until-all-recaptured = eventual consistency (node A 先 recapture 先出 X-committee / node B NULL 时 fail-loud 等下 tick → 同 X-committee, 绝不产出分歧 committee)。
- e0ktm 端到端实证: mempool-NULL bet → recapture (NULL→38458736) → committee sample → vote → settle (8403d585 landed)。

**#28 — oracle_bond clamp** (`api/pool.js` create-v05/06/07): `Math.max(1, Math.round(oracleBondKas*1e8))`。bond=0 撞 SS PoolSpine ctor 强制 `oracleBondAmount ∈ [1,MAX]` (compile-time) → create HTTP 500 = 建市破。clamp 到 **1 sompi** (≈0% → oracle take ≈ feeShare 1%, #28 目标保住; v0.5 bond≥1KAS clamp no-op)。⚠ 码审 + spend-side require 审都漏了 ctor 约束, **只 trial-ramp 实跑建市抓到** (SS ctor [min,MAX] 约束 ≠ spend-side require)。

**跨节点验证方法论** (接位/审计必用):
- 比 bet daa 跨节点: key = **`side_lock_tx`** (唯一 UTXO; `side_p2sh` 非唯一, 同地址多 UTXO)。同 bet 同 daa = PASS。
- 比 committee 跨节点: **同 bet 集前提下**比 `committee_pk_hash` 全 64 字节。bet 集差 (ingestion gap) → excludePks 差 → pk_hash 合法不等**非 determinism bug** → 要 #27d-synced fresh 市场才是干净测 (或 non-oracle-bettor case 排除 no-op 也可比)。
- 比码跨节点: `git rev-parse <sha>^{tree}` 两节点 byte-identical。**committed≠deployed**: 验**运行进程** PID CreationDate post-FF, 非只 git (running source = 进程内存非 working-tree; FF≠restart)。
- 链上验 tx: relay `check_utxo_landed` 走本地 kaspad 看整链, 别用挂掉的公链 API。

**残留/局限** (诚实分级, 守 milestone-非-finish): item② 跨节点 byte-equal 目前实证的是 **non-oracle-bettor (排除 no-op) case**; oracle∩bettor **真咬**的跨节点 live e2e 由 unit test (`test_27a_committee_exclude` starve 路) + daa-byte-equal 论证覆盖, fresh-市场 biting live e2e 作 belt-suspenders (J2 域)。#27d catch-up 的 regression 待补。

设计/实证权威: commit `959acd21`(#27a-v2) + `c3582a05`(#27d) + `d2d11a2f`(forward-break+regression) + `ee483f20`(#28)。接位手册 `docs/2026-06-15-{KANet-UI-operator,NWT-verifier}-handoff.md`。

## 20.12 W1 用户路机制闭环 PASS — Telegram /bet → 跨节点 5-of-5 → winner 实收 (2026-06-16)

**DoD #5 用户路机制闭环验通 = 一条完整用户路从 Telegram-bot 走到 winner 链上实收奖**(parimutuel 赢家分账, 非 refund)。

路径: Telegram-bot `/bet` → v0.7 register → 跨节点 5 委员**自主**判 (5-of-5) → settle 落链 → winner 实收。

链上实证: settle_txid `6460bae0d4d17b4cf6d871e30eea0d2f1ea60c462511218c3c78f2dcc7987d6e` landed (block `eb382786`)。市场 = WSH 10-1 SEA (`ext-pool-v07-1781569728255-fgx2k`, ESPN event 401815755, outcome=YES)。winner = AutoBetter-1 收 **7.1568 KAS** (押 5 → +43%)。池 155 (YES 105 / NO 50) 守恒, 分出 154.94。5 委员全受奖。

**W1 修**: bot `/bet` 之前被 L287 filter 掉 v0.7 市场 → 接通 v0.7 register (旧路只认 v0.5/exchange-offer)。

⚠ **诚实定语 (守 milestone-非-finish)**: bettor 是**内部 AutoBetter-1 测试 agent**, 非真·冷启动外部人。此里程碑 = **用户路机制闭环验通、tech ready**, **不是** "外部人已用"。controlled-open 公测 = 真用户上量 = 下一步 (operator 域)。

## 20.13 403 vote-fetch 根治 — 跨节点委员活性 (2026-06-16)

**根因**: 跨节点委员 (:3300) 的 oracle 取证据 fetch 撞 **403** (rate-limit / burst, 多委员齐砸同一源 URL) → 出不了票 → quorum < 4-of-5 → settle 卡死。**注意**: 这是 vote-fetch **失败**, 不是市场没传播 (区别于 §20.9 的 active-flag zombie / §20.11 的 NULL-daa starve)。

**修**: `kasia-console/src/lib/bettor-prediction-voter.js` L819-889 — 缓存 **post-extraction FINAL evidence** (避同源重复 fetch 撞限, TTL 6h)。保 ABSTAIN-not-guess (extractor null 仍弃权)、单源 findExtractor registry (不引第二源, 不破防假并行)。

**验证**: 3 个 :3300 委员 重启前 0 票 (403) → 修后链上各自 1 票**自主**投出 + 受奖 = 真·跨节点自主分布式委员会。

## 20.14 bshard M3 (无限规模押注机制) — 设计 sound + PARKED post-demo (2026-06-16)

§20.9 提到的 "破单市场押注上限 = bshard 滚动分片 + 链上 fold trustless 聚合" 在本会话推进到 **M3 (滚动分片 + 自取 + fold)**, 行级审收口。**结论: 机制设计 sound, 但 live e2e (close/claim 在 2289B PoolRoot) = post-demo; bshard 整体 PARKED** —— controlled-open 公测用 v0.7 委员池足够, 不需 bshard scale。

**route-split 两合约** (解 Kaspa script-units 9999 硬限): redeem 路径切成
- **PoolLeaf** (`register` / `fold` / `seal_to_root`, 4-field, **无 outcome**) — 押注分片 + 链上 fold 聚合
- **PoolRoot** (`close_commit` / `claim_draw` / `refund_draw`, 7-field) — 收口 + 赢家自取 / 取消退本金

**行级审抓+修 2 CRITICAL**:
1. **F2 refund/claim 互斥**: 修 = refund flip `closed=2` write-once latch, close gate `closed==0`。防 winner 取 payout + bettor 又退 stake 的双抽 insolvency (tri-state write-once, 同 root 绝不双开)。
2. **committee-bypass**: covenant / seal **必硬设 canonical outcome 用 literal / ctor-const, 非 witness**。否则 folder / sealer 可在 witness 填伪 outcome 绕过委员会盗结算池。

⚠ **cost-model 教训 (重要, 已折进 §20.15)**: Kaspa spend script-units **∝ 字节数 (size-bound)**, 经链上 **differential probe 实证** (probe-A raw blake2b ~128/64B + probe-B no-fold register 493B)。**禁估 / 凭少量锚拟合** —— 团队一度 mis-model 成 "fixed-per-blake2b" (2 锚 underdetermined), 只有链上受控 probe 能定。route-split (减 redeem 字节数) 是对的修方向。

**跨节点 determinism**: PoolShard / PoolLeaf / PoolRoot 的 P2SH **byte-equal** 5-vantage 证 (同 silverc `9e4dc3a6` + 同 `.sil` + 同 ctor → 同 script)。

设计/实证权威: `docs/2026-06-15-bshard-{M3-money-flow-trace-j1, shard-variant-fold-covenant-structure-j1, payout-commit-design-j2}.md` + `docs/2026-06-15-bshard-known-limitations.md` (L1-L4 trust/liveness 诚实分级)。

## 20.15 cost-model 陷阱 — Kaspa SS spend cost ∝ 字节数, 必链上 probe 不准估 (2026-06-16)

**陷阱**: 估 Kaspa silverscript spend 的 script-units (mass / 费用) 时, 凭印象拟合成 "每个 op / 每个 blake2b 固定成本" → underdetermined → 漂。

**真相 (链上 differential probe 实证)**: spend script-units **∝ redeem script 字节数 (size-bound)**, 不是 per-op fixed。两锚 (probe-A raw blake2b ~128/64B + probe-B no-fold register 493B) 才把模型钉死。

**铁律**: 涉及 SS spend cost / mass / 9999 script-units 硬限的设计决策, **必须链上受控 differential probe 测真值, 禁估 / 禁凭少量锚拟合公式**。这是 §20.14 route-split (减字节降 cost) 决策的依据。配 ANTI-PATTERNS / 调查方法论 "实测非估算" 系。

## 20.16 下一阶段方向 — oracle 强化+拓展 charter (post-W1, Owner 已终裁) (2026-06-16)

**底层洞察 (定掉一切)**: **4-of-5 委员会防节点故障 / 共谋, 不防坏输入。** 5 委员抓同一单源 URL, 污染源同样骗过全部 5 → 4-of-5 同向 → 共识把毒洗成 "全票合法 settle"。今天安全仅因 ESPN/CoinGecko 难污染 = **在信源, 不在验源** —— 缺口不是 "没 backstop", 是更糟: **共识在给污染背书**。

规划 = 5 板块 (A 信息源拓展 / B 多源交叉验证 / C UMA 毕业 / D 确定性谓词引擎 / E 红队) + F determinism 横切。Owner 终裁要点: 多源进 settle 必走**冻结共享快照** (现场多抓破 byte-equal, 不在菜单) · 新源信任锚 **Owner approve** · 主观题 **prevet 建市时拒**不在 settle 弃权 · **D 不是安全改进** (吃被污染字段照样自信判错, 安全压在源完整性)。

**执行 gate = post-W1** (此为下一阶段方向指针, 本章不展开)。charter 全文: [`docs/2026-06-15-oracle-expansion-parallel-board-plan.md`](../2026-06-15-oracle-expansion-parallel-board-plan.md)。

## 20.17 oracle 强化 wave1 — 四正交闸框架 + 核心 LIVE 跑通 (2026-06-19)

post-W1 起 §20.16 的强化拓展。全队**落码前对抗讨论** (Bettor 抛 "白名单是承重墙" 立场被全队正确攻破升级), 收敛出更尖锐框架, 落档 [`docs/2026-06-19-oracle-hardening-adversarial-consensus.md`](../2026-06-19-oracle-hardening-adversarial-consensus.md) + 审 [`docs/2026-06-19-bettor-adversarial-review-wave1.md`](../2026-06-19-bettor-adversarial-review-wave1.md)。

**真承重墙 = settle 前【四个正交闸·缺一即漏】** (白名单降级为 necessary-not-sufficient 的 provenance 腿; 单源进 settle 永远 abstain 或需第二腿):
1. **管源** (证据源完整性): N 委员独立 fetch → content-hash 一致才冻结快照 + canonical-byte cross-check + 链锚取时。
2. **管码** (部署等价): settle 路 oracle 技能跨节点 tree-hash byte-identical 才放行 (防 :3300 差一 commit 算异 verdict 伪装成 "oracle 分歧")。
3. **管指令** (谓词/注入): maker 可控 title/criteria 注入面 → 结构化字段隔离, 禁进 LLM 自由 prompt。
4. **管证据文本** (LLM 在环残留): LLM 只许抽取, 委员抽取字段 byte-equal 才放行。

**核心洞察 (J1)**: *determinism = 跨节点 AGREE 非 CORRECT* —— byte-equal 把污染确定性地洗成共识, 故必先压源完整性再谈确定性判断。**三轴 determinism**: 算术轴 (整数定点, 码轴覆盖) / 源摄入轴 (field_hash) / 码版本轴 (code_manifest_hash)。**统一 abstain-not-guess 三态**: 能结构化+委员同抽=settle / 抽取不一致=abstain / 纯主观=prevet 建市拒。

**核心能力 (wave1 已落+LIVE 跑通)**:
- **D-L1 judgeLine** (`kasia-console/src/lib/judgeline.mjs`): 纯函数, 结构化谓词 `resolution_predicate{metric,op,operand,scale,subject}` (winner/margin/total/score) 交确定性算术判, 自由文本零进 LLM, 消 off-by-one。
- **确定性抽取** (`oracle-evidence-extractors.mjs` extractEspnFields): ESPN summary → 整数字段 {winner_side, home/away_team, home/away_score} + canonical field_hash。
- **wire** (`bettor-prediction-voter.js` deriveKanetNativeVote L926-948): 市场有 `resolution_predicate`→judgeLine; ABSTAIN→落 abstain 不退 LLM; 无 predicate→旧 LLM 路 (additive 继承不替换)。
- **voter-flood-skip(b)**: poll 层 skip 无 data_source/无 known extractor 的结构性无源市场 (两节点同码同 skip determinism-clean)。

**实证链**: 离线生产真函数真赛 **495/495=100%** (winner+让分+大小球定点, 独立 ground-truth) → 部署 canonical **`44f0982c`** 两节点 tree **`ee742325` byte-equal** cutover (旧 Console 孤儿清, scout/连接数护栏) → **LIVE 跑通**: 部署真码跑真 predicate 市场 (真 ESPN SF@ATL 2-7)→judgeLine(winner==ATL)→**verdict=NO 正确** (`extractor_kind_used=judgeline-deterministic` 走算术非 LLM)。记忆 [[project-oracle-core-live-judgeline-verdict]]。

**wave2 (hold, observe-only/deferred, 不卡核心)**: field_hash 众数 quorum gate / code_manifest 双轴 enforce / 谓词冻结 immutable / claimAuto 根治。**仍 GATED 待 Owner 批**: 新活源进 settle (odds 端点)、多源 cross-check 进 settle。

## 20.18 bshard 命门链上收官 — deadline-gate (CLTV) + 跨节点 settle-enforce (防假赢家) LIVE (2026-06-21)

§20.14 把 bshard 标成 "PARKED post-demo"。本会话**复活并链上收官 bshard 命门**：把"机制设计 sound"推进到"**两道命门 + 跨节点 enforce 全链上证毕**"。架构同时从 route-split(PoolLeaf+PoolRoot 撞 9999 SIZE 墙)pivot 到 **(A) self-contained PayoutShard**(§20.15 cost-model probe 证 9999 是 free-tier 非硬墙 → v1+compute_budget 解锁，弃 fold/convert/seam 大简化)。

**部署**: canonical sha **`018df29b`**(silverc `da9fc22` + ShardLeaf.sil blob `25ab4b63`)，**双节点 byte-equal 4-vantage 验**(NWT git+compile / J2 silverc 第二 vantage / Bettor content / KANet-UI operator 单写 canonical+:3200)。`origin/bshard-m3-deploy`。

### 件1 — deadline-gate (rolling-shard 最后一片资金卡死的根治)
**问题**: ShardLeaf 满片(`count==seal_count`)才可 consolidate；若市场永远注不满(最后一片 partial)→ 资金永久卡死。
**修**: `ShardLeaf.sil` consolidate 入口 `if (count != seal_count) { require(tx.time >= deadline * 1000); }` —— partial 片仅 deadline 后可归集，满片随时可。`deadline` ctor-baked **immutable**(spender 不可伪)。
**关键陷阱 (vacuous 假牙 + 单位)**:
- `require(tx.time >= deadline*1000)` 编成 **`OpCheckLockTimeVerify` (CLTV, opcode `0xb0`)** —— **共识层 enforce**(拒 = 'Unsatisfied lock time')，不是 script EvalFalse，不可绕。
- **`tx.time` 单位 = 毫秒**(链上 LANDED refund precedent 证)，`deadline` 烤**秒**(= `market.deadline`) → 合约 `*1000`(= `OpMul` `0x95`)转 ms 比对。**漏 `*1000` = ms ≥ 秒 恒 TRUE = vacuous 假牙**(premature 永不 BUST = 卡死 bug 没修)。`LOCK_TIME_THRESHOLD=5e11`(<5e11=DAA score 模式 / ≥5e11=ms-epoch CLTV 模式)。
- **三处单位必一致**: register-v07 烤【秒】(`pool.js` `deadline:market.deadline`) / 合约 require【`*1000`】/ `settle.mjs` consolidate `lock_time = deadline*1000`【ms-epoch】(`consolidateLockTimeMs`，fail-closed)。缺 handler lock_time = 合法 after-deadline partial 也 BUST(partial teeth)。
- da9fc22 parser 限：`tx.time` 只能进 standalone `require`(不能进 `||` 复合 / if-condition)→ 用 `if`-restructure 拆。
**链上三臂 teeth (非 vacuous，双轴单变量)**: A premature(`lockTime=0` 或 `<deadline*1000`)→**BUST**(consensus 拒) / B after-deadline(`lockTime=deadline*1000`)→**LAND** / C full(`count==seal_count`，闸 skip)→**LAND**(0eba71d2)。A↔B 只差 lockTime(time 轴)、A↔C 只差 count(count 轴)= 证闸**条件性**非只方向。链上拒绝消息 stack locktime = **`1782032987000` = deadline×1000** 自证 `*1000` 落对(vacuous 会是秒值 1782032987)。

### 命门③ — settle-enforce (跨节点防假赢家)
**威胁** (§20.16 "共识洗白污染"): close_attest 只证"4-of-5 distinct 委员签了某 payoutRoot"，**不绑"payoutRoot == 链上 predicate 判定结果"** → 恶意 settler 塞假 payoutRoot(假赢家)→委员盲签→共识洗白盗对侧池。
**修**: `enforceCommitteeSign` (`pool-shard-settle.mjs`) —— 每委员**各自独立 re-derive** payoutRoot：从**链上** `predicate_commit`(PS redeem offset 518，**p2sh-verified** 不信 DB)读 → `computePredicateCommit(predicate)=blake2b(canonicalPredicate(predicate))` 验 claimed predicate 匹配链上承诺(命门①)→ `judgeLine(predicate, frozen ESPN fields)` 算 verdict → 算 payoutRoot → **claimed == re-derive 才签，否则拒**。genesis 烤 `predicate_commit=computePredicateCommit`(single-source coherence)。
**链上四 teeth (market2 isewb，同 5 委员同 PS 单变量)**: ① happy(对 predicate ATL + 对 verdict)→签→close_attest LANDED `bf6bf100`→winner 实领 **100 KAS** ② 假 predicate(传 winner==SF≠链上烤 ATL)→委员命门① `blake2b(SF)≠链上 b9a7d200`→0 签 **BUST** ③ 假 payoutRoot(claim dir0 但 judgeLine dir1)→委员命门③ re-derive `b2a5b8b5(dir1)≠claimed 1a6139e8(dir0)`→0 签 **BUST** ④ cross-node determinism: J1tn-Bob@:3300 与 4 个 :3200 委员行为一致(happy 签 / 两 attack 同拒)。
**⚠ attack BUST 在 off-chain enforce 层**(委员提交前 refuse，0 签 → 无 valid tx → 无 on-chain artifact，设计如此)。独立验 = 部署码 code-read(re-derive 逻辑)+ 链上 happy 假根缺席 + 单变量同委员对比。

### 跨节点 happy 链上铁证 (钦定① 真跨节点)
两市场 close_attest LANDED：`f34c49f1`(14dpa)+ `bf6bf100`(isewb)。独立解 input witness：**5 distinct 委员 pubkey 含 :3300 J1tn-Bob `9e2db8525f`**(= oracle_pool_chain_view 13 成员之一被采进 5 委员且真签)。`bf6bf100` committed **真根 `b2a5b8b5` 在 witness / 假根 `1a6139e8` 缺席**。委员从 `pool_merkle_root`(链上派生)采样，非本地 membership。txid→block 映射经 embedded indexer(`kaspa_tx_log.block_hash`)→`getBlock` 取整 tx 解 witness(TN12 无公共 tx-by-id 索引)。

### 验证方法论 — 异质多 vantage 对抗验证 (本会话沉淀)
单点会看走眼，多异质 vantage 锁死真相。ship 前拦下：deadline 单位错(ms/秒 1000×)、双 canonical(silverc build 字节分歧)、vacuous 假牙(byte[32]<恒 BUST / tx.time-ms≥deadline-秒恒 TRUE)、consolidated 误标、helper genesis-addr 误报。具体手法：
- **重编+反编译+源码 opcode 三证**(deadline-gate)：重编 .sil → bytecode `PUSH deadline ×1000 OpMul OpCheckLockTimeVerify` → 源码 `compile.rs:2510` 确认 opcode。
- **predict==observe**：从源头算 `deadline×1000` == 链上拒绝消息 stack 值。
- **链上 witness 独立解码**(委员 pubkey) + **key-side 私钥派生**(证 pubkey 归属) + **独立 chain-read**(getBlock) + **operator canonical 单写**。
- **NO TX NO TRUTH**：自跑 `getBlock`/`getUtxosByAddresses`/`check_utxo_landed`，不 echo 任何人的 "LANDED"。**非 vacuous 纪律**：happy LAND ≠ enforcement(盲签产同样 LAND)，attack BUST 才 load-bearing。

### 残留 (mainnet-before，testnet 1000-ramp 不触发)
- **RefundClaim 虚高 stake** (洞1，CRITICAL)：refund 读 ctor `tk.stake`(spender 可控)无 merkle 绑 → 造虚高票一笔抽干池。修向 = refund-merkle(close 时 commit `{bettorPk,stake}` 进 refundRoot，refund climb 验)。现 refund gate-off 不 live-exploitable。设计档 [`docs/2026-06-21-bshard-production-trust-gaps-refund-merkle-and-settle-enforce.md`](../2026-06-21-bshard-production-trust-gaps-refund-merkle-and-settle-enforce.md)。
- **NWT 探针(可选最终 rigor)**：直接 query 委员 sign 端点喂假根、亲眼看 refuse(纯 read 无广播)= 亲触发拒签非信 driver 0-签 report。J2 备 market3(`lddjh`)live PS。
- predicate 冻结 immutable / RefundClaim production wire / fee 经济模型 reconcile。

设计/实证权威: 上述 trust-gaps 档 + §20.14 route-split 档(历史) + 记忆 [[project-bshard-3axis-trueinfinite-1000-achieved]] / [[reference-silverscript-txtime-ms-lockfile-threshold]] / [[project-bshard-production-register-settle-wiring]]。
