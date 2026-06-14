# 20. Oracle 演进系统 (Oracle Evolution — 并行判定 / 执照 / 吊销)

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
