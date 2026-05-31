# Phase-2 (d) Variable-Stake — committee-attest-totals 启动备忘

> Owner P0 #2 真解. 上午 (2026-05-31) 三方收敛, ②CLOSE 后启动. 等 J1 SS 专家终审 + Bettor 写正式 spec.
>
> 文件目的: 落地讨论, Bettor (新接位) 读 handoff 后看此一页即可拍板进 Phase-2.

---

## 0. TL;DR (60 秒)

**Owner 痛点**: 现 v0.6 合约把 stake amount 烤进 P2SH (PoolSide ctor L62). 用户必须**精确**转那个金额, 多/少都失败:
- 少付 → 资金被合约**永久锁死**, refund 也救不了
- 多付 → 超出部分被矿工吃掉

这是 UX 灾难 + 资金安全风险, Owner 钦定方向: **"按实际锁仓额押注, 不烤精确金额"**.

**解 (d) committee-attest-totals**: PoolSide ctor 不烤 amount; settle 时 committee 链下算 totalPool/winnerPool (实际 UTXO 值求和) + 签 totals; SS 用 committee 签的 totals 算 payout. 0 新 sign 原语 (复用 ① vote committee + sig pattern).

**收敛**: Bettor r122 1/2 — **三方共识 ✓**. 等 J1 SS 终审 + Bettor 写正式 spec.

---

## 1. 三方讨论 (源)

| 轮次 | Agent | 关键贡献 |
|---|---|---|
| **Bettor r119 1/2-2/2** | Bettor | Owner 钦定问题 2. 候选 (a)/(b)/(d). Bettor 推 (d), pressure-test ask |
| **J2 r148 1/2-2/2** | J2 | 否 (a) (storage mass + N-cap 砸自家脚). 推 (d) 复用 ① committee+sig (kaspa ecdsa_sign + verifyMessage 已实证), 0 新 sign 原语. SS 只新加 1 个 input: totalsAttestation |
| **NWT r119** | NWT | 方向认可 (d) + 5 spec 必清 (= 见下 §3) |
| **Bettor r120** | Bettor | 顺手 lock ② schema, 顺带 ack J2 r148 (d) 支持 |
| **Bettor r122 1/2-2/2** | Bettor | **收敛 (d) 定**. 统一洞: (d) == v0.6 runtime spec §F1 (committee 签 NET totals) 同机制. 排 Phase-2 (排 ② ship 后) |
| **Bettor r151** | Bettor | 接位后启 (d), ping J1 索 SS 现状 (4 问) |

---

## 2. 方案 (d) committee-attest-totals 机制

### 2.1 核心思路

```
Phase-1 (现状):                    Phase-2 (d):
PoolSide ctor 烤 stakeAmount   →   PoolSide ctor 不烤 stake
SS 用烤的 amount 验 payout    →   committee 链下算 totals + 签
                              →   SS 用 committee 签的 totals 算 payout
```

### 2.2 三段流程

1. **建仓** (register-external/confirm + new bet flow):
   - 用户转 KAS 到 PoolSide P2SH (= 不含烤金额, 一仓位一 P2SH)
   - Relay/Scout 监到 UTXO → 读 `tx.outputs[i].value` (实际锁入额) → 写 `pool_bettor_sides.stake_amount` (= 真实值)
   - **取消现"精确金额必同 prep 给的 exact_sompi"硬要求** (= 现 register-external/confirm 那条 amount==exact_sompi 校验删)

2. **结算时 committee 链下算 totals** (settle 路径):
   - settler 扫 `pool_bettor_sides WHERE market_id = ? AND side_lock_tx IS NOT NULL`
   - 各 side P2SH UNSPENT UTXO value 求和 → totalPool, yesPool, noPool
   - 5-of-N committee 同 ① vote 同一组, 对 `{totalPool, yesPool, noPool, perWinnerAmount?, ...}` 签
   - sig pattern 复用 ① vote 已实证 (kaspa ecdsa_sign over JSON.stringify(payload minus sig))

3. **SS 用 attest totals 算 payout**:
   - settle TX scriptSig 新增 1 个 input: `totalsAttestation` (= 5 个 oracle sig + signed totals)
   - SS 验 5-of-N 签 + counter (复用 ① threshold) → 接受 totals
   - payout = 自身实际 UTXO value × totalPool / winnerPool (silverc 能读 tx.inputs[i].value)
   - SS **不在链上求和** (绕开 silverc no-loop 限制, 原 PoolSpine 注释 "OpTxInputAmount loop deferred" 的 blocker)

### 2.3 "免费" / 一石二鸟

Bettor r122 关键洞:

> (d) == v0.6 runtime spec §F1 (committee 签 NET totals) — **同一机制**!
> 变量金额 stake = "免费", 不加新原语:
> - PoolSide ctor 不再烤 amount
> - 每 side 读自己 UNSPENT P2SH input value (silverc 能读)
> - payout = 自身实际 value × committee-attested totalPool / winnerPool
> - SS 0 求和

= Owner 要的 "elegant 解 + SS 能很好支持" 坐实.

---

## 3. NWT 5 Spec (r119, 必清)

Bettor r122 全收纳 至 §F1:

| # | NWT 项 | 状态 | 备注 |
|---|---|---|---|
| 1 | attest 时点: settle 时 attest 必锁 cutoff block (防 late stake) | TBD | settle TX deadline / poolSettlerTick trigger 当锚 |
| 2 | 粒度: per-side totals (yes/no_pool), 不 per-bettor (爆 KIP-9 mass). side P2SH UNSPENT 当真相 | ✅ 纳入 | 设计本就如此 |
| 3 | 错 attest dispute: dispute_reveal 必含 attest sig 个体 forfeit (Owner 经济兜底命门) | TBD | 现 dispute_reveal 含 vote sig, 扩 attest sig 字段 |
| 4 | 兼容 path A: attest_totals 是 settle TX arg 不烤 ctor (保 binding). attest sig 复用 5-of-N + counter pattern | ✅ 纳入 | F1 设计本就如此 |
| 5 | NWT verifier: attack-static 现 check 5 checkSig + merkle, 加 attest_totals = scriptSig 多 2 字段, verifier 可扩 不阻 spec | ✅ verifier 扩 | NWT 自己说"不阻 spec" |

经济: committee 多 1 round 链下 attest = 同一 settle 内多签 1 字段 (非额外 round-trip), oracle_fee 100bps 可 cover.

---

## 4. 改动范围 (按层)

| 层 | 文件 | 改动 |
|---|---|---|
| **SS 合约** | `kasia-console/src/lib/PoolSide_v06.sil` | ctor 删 stakeAmount 烤入. 新增 `totalsAttestation` input + 验 5-of-N sig + counter. payout 读 `tx.inputs[i].value` 而非烤值 |
| **SS 合约** | `kasia-console/src/lib/PoolSpine_v06.sil` | scriptSig 多 1 input: attest_totals (signed JSON). 验 5-of-N sig |
| **Relay** | `kasia-relay/src/...` | register-external/confirm 接 amount: 不校验 `amount == exact_sompi`, 改读 UTXO 实际 value 写 DB |
| **Console** | `kasia-console/src/api/pool.js` | `/api/pool/market/:id/bettor/register-external/prep` 返 `recommended_amount_sompi` 而非 `exact_stake_sompi`. `/confirm` 删 amount-exact match check, 改"用 UTXO 实值" |
| **Console** | `kasia-console/src/services/pool-market-settler.js` | dispatchPhase2: settle 前 committee 算 totals + 签, settle TX 多 1 attest input |
| **Console** | `kasia-console/src/services/bettor-prediction-voter.js` | voter 多签 1 类: pool_totals_attest_v1 (与 pool_oracle_vote_v1 同 sign pattern) |
| **Bot** | `tg-bot/prediction-menu.mjs` | **[条件锁: SS v0.7 ship + Relay/Console 适配齐 + P2-6 e2e PASS 后才改, 文案先行 = 用户被骗 (§5.3b #3)]** confirm 文案: "建议金额" → "任意金额都行, 系统按你实际转的算". 去 sompi 精确语言. 删 "少付永久锁死" 警告. + 加 settle-poller 聚合通知 (§5.3b #2 #1) + formatMyBets partial-claim 二字段 (§5.3b #2 #2) + detail 阶段 consolidate 提示 (§5.3b #2 #3) |
| **Bot** | `tg-bot/console-api.mjs` | poolRegisterPrep 调 endpoint 返字段更新 (recommended_amount_sompi 替 exact_stake_sompi) |
| **DB** | migrate.js 加 v??? | pool_bettor_sides 增 `recommended_stake_sompi` (= 建议值, 历史/分析用), keep stake_amount = 真实锁入额 |

---

## 5. J1 SS 现状回答 (r198 1/2/3/4) — Blocker 已清

**Bettor r151 ping J1, J1 r198 给现状 + design ✓**

### 5.1 现 stakeAmount 烤位置 (r198/2)
- `PoolSide_v06.sil` L62 ctor `int stakeAmount` baked
- `pool-p2sh-v06.mjs` L107 `intExpr(stakeAmount)` 包进 P2SH
- 用途:
  - L240 payout = `stakeAmount * totalPool / winnerPool` (claim_winner)
  - L259 refund = `stakeAmount - 1000` (refund_market_cancelled)
- 结论: P2SH 烤 stake → 同 bettor 同 side 不同金额 → 不同 P2SH. 变量金额必须改这

### 5.2 SS 改 (PoolSide_v06.sil v0.7 — J1 r198/3 设计 ✓)

```
ctor 删 stakeAmount
  → side P2SH 只 bind (bettorPk, spineP2shHash, poolMerkleRoot, metaHash, direction, deadline)
L240 payout: stakeAmount → tx.inputs[bettorInputIdx].value   (silverc 支持)
L259 refund: 同款 tx.inputs[i].value - 1000
claim_winner totalYes/NoPool 仍 runtime arg (committee 签)    (0 新原语 ✓)
register: drop exact_stake 等检, 任意金额接, INSERT 真 UTXO 值
```

silverc `tx.inputs[i].value` 支持 ✓ (J1 r198/3 确认, PredictionEscrow*/Pool* 4+ 合约在用).

### 5.3 残留风险 (J1 r198/4) — 待定

**风险**: 同 bettor 同 side 多次 deposit 出现 N UTXOs @ same P2SH. claim_winner spend 全 N → tx.inputs 多 input. silverc 无 loop, 难求和.

**选项**:
| 方案 | 描述 | 评 |
|---|---|---|
| (a) single UTXO claim | bettor consolidate first, 或 1 claim per UTXO 重复跑 | **J1 推 — 简单, 不限 UX** |
| (b) max-N (e.g. 4) unrolled 求和 | 静态 unroll N input value | 限 UX (= 同 side 加注 ≤ 4 次), 不爽 |

**基于 §5.3 选 (a) 后子变体定义** — Bettor r152 草案 (待全体对抗性评审, 非定稿): (a) 的 "per-UTXO 独立 claim" 子变体 (零 UX 限制).

> Owner 方法论 (2026-05-31): 重大问题定版前, Bettor 出草案 → J1/J2/NWT 对抗性+建议性讨论 → 收敛才 LOCK。本节即草案, 请各 agent 挑刺 (尤其 §5.3a 攻击面)。

理由 (Bettor 实证 .sil L217-234 后提):
- sides leaf = `blake2b(bettorPk)` (L221), 是 **per-bettorPk**, 与金额无关。merkle 证明只证 "bettorPk ∈ sidesMerkleRoot" → **同一 bettor 的 N 个 UTXO 可复用同一份 merkle proof**。
- 故不需 "拒第二次 deposit / 强制 consolidate"。改为: **N 个 UTXO = N 次独立 claim_winner TX**, 每次 `tx.inputs[bettorInputIdx]` spend 其中 1 个 UTXO, `tx.outputs[0].value == 该 UTXO value × totalPool / winnerPool`。
- claim_winner 现已 `require(tx.outputs.length == 1)` (L243) + 读单 input value → **天然就是 per-UTXO 语义**, SS 一行不用改求和逻辑。
- 代价: bettor 付 N 笔 claim 矿工费 (可接受); 收益: 加注/多次下注 UX **完全不受限** (Owner 变量金额初衷)。
- 否决 "强制 single deposit": 违背 Owner "用户需求第一" (用户想加仓应允许)。
- 否决 (b) max-N unroll: 复杂 + 有上限, 违背 "简单>复杂"。

⚠️ 仍需 J1 实证 1 点 (OPEN, ship 前必清): silverc `tx.inputs[bettorInputIdx].value` 中 `bettorInputIdx` 如何指定 / 默认。若 SS 只能读固定 input[0], 则每次 claim 须把目标 UTXO 放 input[0] (TX-builder 约束, 非 SS 改动)。J1 确认。

**✅ J1 r199/2b CLOSED**: SS 加 `require(tx.inputs.length == 1)` 强制 per-UTXO 1 input (= claim_winner spend 单一 UTXO). L240 `stakeAmount → tx.inputs[0].value` 算 payout. TX-builder 无需选 input 索引 (永远 input[0]).

#### §5.3a NWT r120 对抗评审吸收 (4 件, Bettor r154 全收, 非盲从)

NWT 认 (a) per-UTXO 方向, 提 4 个 ship-blocking gap, Bettor 逐条判定成立并入 spec:

1. **fee 倍数 UX (成立)**: bettor N 笔押 → N claim TX = N× (miner fee + storage mass + sig)。
   spec 明文: "想省 fee 的 bettor 可自行 consolidate 自己的 UTXO (协议不强求, 不限默认行为)"。bot 文案需提示 "多次加注 = 中奖时多笔领取 (各付小额矿工费)"。

2. **settle_via_spine 的 KIP-9 mass (成立, 命门级)**: 合作路径 (`settled_via_spine`, .sil L66) 下, spine settle TX 同时 spend 全部 side UTXO。N=50 bettor × 多 deposit ≈ 250 input/output → **必超 KIP-9 storage mass 上限**。
   spec 增 **split-on-mass 策略**: settler 按 mass 预算把 settle 拆成多个 TX (每 TX ≤ mass cap), 跨 TX 保持 per-side UTXO 完整性。settler 复杂度 ~N 倍 (J2 实施时评估)。
   → 这是 per-UTXO 子变体引入的**新负担**, 之前只算了 self-claim 路径的 fee, 漏了 spine 合作路径的 mass。NWT 抓得对。

3. **partial-claim 中间态语义 (成立)**: bettor 3 UTXO, 1 claim 成 / 1 pending / 1 拒 = 中间态必须 spec 明确。
   `/mybets` 与 my-positions 需区分 **successful 笔数 + pending 笔数** 两字段 (现只 open/won/lost/refund 四态, 不足以表达 "同仓位部分领取")。KANet-UI UX 改。

4. **verifier / cross-node derive 共识 (成立)**: NWT verifier structural check 不破; 但 cross-node 视角**必含 derive 函数 (computeSideP2SH_v06 删 stakeAmount 后) 两节点 byte-match 共识 + 跨节点 e2e test**。
   → 并入 §7 测试方案第 5 项 (P2SH redeem byte-match 命门回归)。

**结论 (Bettor r156 收敛 ✅)**: (a) per-UTXO 是 minimum-viable 良好基底, ship-ready 前必补 [1 fee UX 文案 + 3 partial 二字段 + 4 cross-node derive 共识] 3 件 (#1/#3/#4 入本 spec).

**关键 spine-mass (#2) 张力解** (Bettor r155/r156 + J2 r158 共识):
- spine mass 爆是 v0.6 既存问题, **UTXO 数与烤不烤金额无关** (= max-N=50 bettor 已天然存在)
- 变量金额 (per-UTXO) **mass-中性** — 不引入 mass 回归, 跟现 v0.6 同负担
- **不回退 single-deposit 约束** (= 否 NWT 担心的"退回锁 UX")
- settler split-on-mass 是**独立 backlog** (= v0.6 + variable 两路径都需要), 不是本 spec blocker

**(a) per-UTXO 独立 claim 子变体 → 三方收敛 LOCK 候选**. 待 §5.3b/c 收 + J1 r199/3+4 加约束后 LOCK.

#### §5.3b KANet-UI 对抗 (Bettor r153 派活)

**(1) 结构语气**: §5.3.a 草案接 §5.3 末尾, 语气一致 (实证 + 行号 + 否决逻辑), **不推回**. **轻微 nit**: 我原文 "倾向 (a). 选 (a) 即解决 silverc no-loop blocker" Bettor 直跳 (a) 子变体, 隐 (a) vs (b) 决策树. **建议** §5.3.a 首行加 "基于 §5.3 选 (a) 后子变体定义" 防后来者误读绕过决策.

**(2) UX (per-UTXO N 笔 claim) — bot 呈现 3 件 (我窄门)**:

| 件 | 现状 | 改法 | 文件 |
|---|---|---|---|
| **聚合通知** | settle-result poller 每 claim TX 1 条通知, N 笔 = N 条骚扰 | 同 (market, bettor) N 个 claim TX 聚合 1 条: "🎉 你赢了 NO, 3 笔押注共 X KAS 已分 3 笔到账完成". Map `<{marketId, bettorAddr}, {got, expected, totalKas}>` 直到 got === expected 才推, 或超时 fallback 推已收 | `tg-bot/prediction-menu.mjs` settle poller |
| **/mybets partial-claim 状态** (= NWT r120 #3) | 现 statuses 4 态 (won/lost/refund/open) 不够 | 加 `claimedCount` / `pendingClaimCount` / `claimedKas` 字段. 显 "💰 已分 K/N 笔 claim 到账 Y KAS / N-K 笔待 claim" | `tg-bot/prediction-menu.mjs` formatMyBets + `kasia-console/src/api/pool.js` my-positions 返字段 |
| **Consolidate 提示 (= NWT r120 #1 省 fee)** | bot 不知 bettor 已有同 side UTXO | bot /bet detail 阶段查 my-positions, 有同 (market, direction) 已 open 仓 → 提示 "你已有 X 个 UTXO 同 side, 再加注会变 X+1 笔领取. 想省 fee 可先 /consolidate (待实现)". 信息透明不强求 | `tg-bot/prediction-menu.mjs` _handleReplyImpl `detail` stage |

**(3) Bot 文案删时点把关 (Bettor r153 #3)**:

现 efe86a2 "建议金额" + 提下版规划 + 保留"少付永久锁死"警告 = **正确**, 因当前 SS 仍烤 stake. 删 `prediction-menu.mjs` L395-400 "少付永久锁死/多付被矿工吃" **必须等三件齐全才改**:

1. SS v0.7 (= PoolSide ctor 删 stakeAmount) ship + 2-node 真链测过
2. Relay UTXO-value reader 接入 + Console register-external 取消 amount-exact check
3. Settler attest-totals 全栈跑过 (J2 P2-3 + J1 P2-4 + NWT P2-5 + P2-6 e2e ✓)

**任一未齐**, 文案保留警告. 文案先行 = 用户被骗付 (用户读"任意金额都行"但合约仍烤 → 多/少付被锁死). **§4 bot 文件行加 cond 条件锁** (见下).

→ 我提议 §4 改: bot 文件行 prefix `[条件: SS v0.7 ship + relay/Console 适配齐 + P2-6 e2e PASS 后才改]`. 防 P2-7 提前 ship 误导用户.

#### §5.3c J1 r199/3+4 两 SS-层约束 (Bettor r156 派整合)

J1 r199 后两 part (3 + 4) 加 SS-层关键约束, Bettor r156 钦定并入 spec:

1. **注册前转账必 forfeit 警告 (r199/3)**: bettor 知 `side_p2sh` 后绕过 `/register-external` 直送 KAS → 该 UTXO **无 sides_merkle 位** → claim_winner 永卡 (= 钱锁死). 与现"少付锁死"风险同源.
   - **缓解**: register-external `/prep` endpoint 返 side_p2sh 时, bot 必须显著警告 "**先走 /register, 不能直接转 KAS 到此地址**" (= 注册路径写 sides_merkle 位才能 claim).
   - bot 文件行加: prediction-menu.mjs 显示 side_p2sh 处补警告 "⚠ 必须经 /bet 流程注册再付款, 直送 = 钱锁死".
   - 状态: 现 efe86a2 文案已写 "经 /bet 复核流程" 隐含此意, 改 (d) 后需 **显式强化** (= 写成红字铁律).

2. **min_stake_sompi floor (r199/4)**: 防 dust 稀释 winner — committee scan 时低于阈值 (e.g. 10000 sompi = 0.0001 KAS) 的 UTXO **不计 totalPool/sidePool**.
   - 实现: settler 计算 totals 时 filter `UNSPENT UTXO.value >= MIN_STAKE_SOMPI`. min 值由 spec 锁定 (默认 10000 sompi, 可配置).
   - 攻击场景防: 恶意 bettor 发 1000 笔 1-sompi UTXO → settler 计 1000 个 → 稀释 totalPool → 正常 bettor 中奖额降. floor 杀此攻击.
   - bot 提示: prep 阶段若 amount 低于 min, 直接拒 + 提示 "最少 X KAS".
   - DB: pool_markets 新增 `min_stake_sompi` 列 (per-market 可配, 默认全局), 写入 spine ctor / 同 committee attest.

```
J1 r198 ✓ → Bettor 写正式 spec (folded NWT 5 + J1 design + 拍板风险方案)
         → J2 实施 (settler + voter + register-external)
         → J1 实施 SS 合约改 (PoolSide v0.7 + PoolSpine 接 attest input)
         → NWT verifier 扩 attest_totals 2 字段
         → 2-node attest 真链 e2e 测
```

---

## 6. 排期

| Phase | 内容 | Blocker | ETA |
|---|---|---|---|
| **P2-0** | Bettor 接位 + push (d) (r349 + r151 已 ack) | ✅ done | — |
| **P2-1** | J1 SS 终审 4 件 (Bettor r151 ping) | ✅ J1 r198 done | — |
| **P2-2** | Bettor 写正式 (d) spec 折叠 NWT 5 + J1 SS 现状 + 拍板 §5.3 风险方案 (a/b) | ⏳ Bettor | 半天 |
| **P2-3** | J2 实施: voter 加 pool_totals_attest_v1 + settler 算 totals + register-external 接变量 amount | P2-2 done | 1-2 天 |
| **P2-4** | J1 实施: PoolSide_v06.sil + PoolSpine_v06.sil 合约改 | 并行 P2-3 | 1-2 天 |
| **P2-5** | NWT verifier 扩 attest_totals 2 字段 check | 并行 P2-4 | 半天 |
| **P2-6** | 2-node attest 真链 e2e (跨节点 ③ vote-spread 同期跑) | P2-3/4/5 done | 半天 |
| **P2-7** | Bot 文案改 "建议金额" + 现版本兼容 (软发布) | 并行 P2-6 | 1 小时 (KANet-UI) |

---

## 7. 风险 / 攻击面 (Bettor r119 pressure-test ask)

| 风险 | 缓解 |
|---|---|
| committee 签错 totals (恶意/失误) | NWT #3 dispute_reveal 含 attest sig 个体 forfeit (= 经济兜底, Owner 钦定命门) |
| late stake (settle TX broadcast 后又有人 register) | NWT #1 cutoff block (settle 触发时锁 block height, 之后的 UTXO 不算) |
| KIP-9 storage mass 爆 | 复用 ① 5-of-N sig + counter, scriptSig 仅多 1 input + 5 sig, NWT r119 #5 verifier 可扩, 不爆 |
| silverc no-loop 求和 | (d) 的核心 — 链下算, SS 不求和. blocker 化解 |
| 现合约不兼容 | 新合约新建市场用 (d), 旧合约现存市场继续 (Phase 0 = 现版本). 不破已 ship |
| 用户 confirm 阶段 UX 变 | bot 文案改: "建议金额" + "任意金额都行" + "下版自动建仓" (efe86a2 已 ship 部分 — 当前文案已"建议金额" + 提下版规划) |

---

## 8. 对 (a) / (b) 的否定 (Bettor r119 + J2 r148)

| 候选 | 否决理由 |
|---|---|
| (a) fixed max-N unroll | J2 r148 反对: 每仓 1 P2SH unroll storage mass 爆 + N=50 cap 砸自家脚 (= 未来 popular market > 50 bettor 不让进) |
| (b) per-side claim 各 winner 独立 read input value | totals 仍要来源 → 退回 (d) |

---

## 9. 附: 现 ed355da / efe86a2 (Phase 0 缓解) 角色

KANet-UI 在 ②CLOSE 前 ship 的 bot UX 改进:
- ed355da: HTML `<code>` tap-to-copy 地址/金额/sompi/URI
- efe86a2: 文案软化 "建议金额" + 加 "🔧 下版本规划 (Bettor r119/r122 收敛, J1 终审中): 改成按实际转入额自动建仓"

**角色**: 当前合约仍烤 stake 状态下的 UX 缓解 (= 防手抄错地址/金额). **不替代 (d)**, 但语气已为 (d) 铺垫 — 用户不会被"必须精确"的铁律语气误导.

(d) ship 后, efe86a2 文案再改: 去"建议金额"语言, 改"任意金额都行, 系统按你实际转的算".

---

## 10. References

- Bettor r119 1/2-2/2 (问题 2 + 候选)
- Bettor r120 (② schema lock + 支持 d)
- Bettor r122 1/2-2/2 (收敛 (d) + §F1 统一洞)
- Bettor r151 (接位后 ping J1 4 件)
- NWT r119 (5 spec)
- J2 r148 1/2-2/2 (consumer 视角 + 否 a 推 d)
- KANet-UI r348/r349 (Owner P0 列 + push Bettor)
- Owner 钦定: 5 铁律 (用户需求第一 / 简单高效 / 不重复 / 必要 / 充分理由)

---

**最终状态行**: 等 J1 reply r151. Bettor 接位读此文件 + handoff = 可直接进 Phase-2 协调 P2-1 → P2-7. 不需要再回顾上午讨论, 此文件即是 single source of truth.
