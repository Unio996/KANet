# settler 误退 bshard 市场 — understand-first 调查文档 (J2 派工①)

> 状态: **understand-first 分析, 零落码零部署** (Owner 2026-06-23 喊停 understand-first, J2 已 revert 之前预写的 guard, 工作树干净)。
> 目的: 交 Bettor review + Owner 拍, **再谈要不要动码**。
> 方法: 走 `docs/kanet-investigation-methodology.md` 六层 (场景→真实数据→协议→执行逻辑→数据流向→存储表), 不跳步。
> 诊断脚本 (只读, 在 `kasia-console/`): `_j2_refund_rootcause.cjs` / `_j2_check_doubleaction.cjs` / `_j2_bshard_lifecycle.cjs` / `_kanetui_seeder_canary_metric.cjs`。

---

## L1 场景
公测就绪 gate 问"settle% 够不够 80%"。canary 实测 (排 0-bet) all-v0.7 **45.1%**、近7天 75.0%、近3天 **16.7%**(2 settled / 12 resolved / 10 refunded)。近3天崖跌触发根因调查 = 这些 refund 是"真该结算却退"还是"0-bet 正确退"。

## L2 真实数据 (链上 DB, 非假设)
`_j2_bshard_lifecycle.cjs` 全量分类 v0.7 (bshard = 有 `market_shards` 行; anon = 无):

| 类 | total | completed | refunded | verifying | other(open/pending) | 有 settle_txid |
|---|---|---|---|---|---|---|
| **bshard** | 115 | **1** (ozzeu) | **11** | 0 | 103 | **0** |
| **anon** | 579 | **117** | 166 | 4 | 292 | (working path) |

近3天 refunded 逐笔 (`_j2_refund_rootcause.cjs`): 13 笔中 **11 = had-bets-but-refunded** (shard count>0, e.g. shard=2/6/31/71), reason 全 = `"0-bet market, refund_maker_unjoined (pre-sample shortcut)"`。仅 2 真 0-bet。

**关键数据点**:
- bshard 市场 **从来没有任何一个拿到过 settle_txid** (0/115)。**settler 从没成功结算过任何 bshard 市场。**
- 唯一 completed 的 bshard (ozzeu) settle_txid=null + status=completed = **driver-side close 脚本直接置 completed** (close_attest 48336f40 LANDED, 非 settler 干)。
- x4kpq 在 11 错退里: 链上既 close (4123de55 + winner claim 15ec3d18 领 19.44 + 6 fee-leaf) **又** refund maker 99.99 (271a5f28) = 双动作上链 (Bettor 资金守恒红旗, 见 L6 + 并行审计线)。

## L3 协议
- **anon (v0.6/v0.7 anonymous-pool)**: bettor 注押写 `pool_bettor_sides` 表 (bettor_pk/side_p2sh/stake/direction)。settler 用 5-委员 + dispatchPhase2 读 `pool_bettor_sides` 算 payout → settle。**这是现在 working 的路 (117 completed)。**
- **bshard (v0.7 rolling-shard)**: bettor 注押 register_append 到链上 ShardLeaf continuation P2SH, 状态记 `market_shards.current_leaf_state` (JSON `{count,local_yes,local_no,pool_value}`, 创世 maker seed count=0)。**bettor 集不在 `pool_bettor_sides`**。结算走 close_attest (委员 4-of-5 enforce-then-sign payoutRoot) + winner merkle-claim, **不走 settler 的 anonymous dispatchPhase2**。

## L4 执行逻辑 — settler 为什么把 bshard 退掉
`pool-market-settler.js` 全程 **从不 query `market_shards`** = systemic shard-blind。三个 (+) 站点全用 `pool_bettor_sides` 判断"有没有 bet":
1. **L143 `getBettorSumSompi`** = `SUM(stake) FROM pool_bettor_sides` → bshard 恒 0。
2. **L350 MIN_POT pre-check** 用它: bshard totalPool = maker_stake + 0; maker_stake < 100KAS → 误 `cancel(min_pot_undersize)`。(x4kpq maker_stake=100KAS 刚好==MIN_POT 逃过)
3. **L463 0-bet pre-sample shortcut** = `COUNT(*) FROM pool_bettor_sides` → bshard 恒 0 → `dispatchRefund(refund_maker_unjoined)`。← **11 笔实际走这条**。
4. **L1573 dispatchPhase2 sides=0** (同 pool_bettor_sides) — 后备同病。
5. L1231 decideConsensusV06 betCount — 同病。

→ 同一病根 (读错表), 5 处症状。

## L5 数据流向 — bshard 怎么"流进" settler 然后被退
1. bshard 市场创建 = `protocol_status='open'/'pending_bettors'` (103 个现在停在这, 未到 deadline)。
2. deadline 过 → **deadline-watcher (`L297`) force-advance v0.6/v0.7 `pending_bettors` → `verifying`** (不分 bshard/anon, 仅改 label 无资金)。
3. 主 loop 选 verifying 市场 → 撞 L350/L463 shard-blind → `refund_maker_unjoined` (只退 **maker** seed, 见 L6) → `status='refunded'` + refund_txid。
4. bshard 的真正结算路 (close_attest) 是 **driver-side 脚本** 另外手动跑 (ozzeu/x4kpq 都是)。两条路无协调 → x4kpq 双动作。

## L6 存储表 / 资金影响
- `refund_maker_unjoined` (`handleRefunding` L2440) 输出 **只到 `makerRow.address`**, amount = makerStake − minerFee。**bettor 的 shard 资金完全不碰** (退或不退, bshard bettor 都不会被这条路 made-whole)。
- ∴ 错退的资金面: 退的是 **maker 自己的 seed** (回 maker 自己地址)。不是退 bettor 的钱, 不是系统直接亏给外人; 但 x4kpq 双动作 = maker seed 既可能被 close 消耗 又被 refund → **需逐 UTXO 核对是否 double-spend/系统亏** (并行审计线, 不在本 understand-first 范围, 但已是已知红旗)。

---

## 回答 Owner 的三个问题

**① legacy settler 对 bshard 到底做了什么、为什么走到 refund?**
答: settler 把 bshard 当 anonymous-pool 处理, 读 `pool_bettor_sides` (bshard bettor 不在那) → 恒判"0 bet" → 走 0-bet/min-pot 退款捷径退 maker seed。**它对 bshard 从来只会误退, 从没成功结算过 (0/115 有 settle_txid)。**

**② skip 掉之后谁来结算 bshard? Track B close 现在真在跑吗? driver-side?**
答: **现在没有全自动的"检测 deadline → 发起 close"路。**
- Track B close-voter daemon **确实已启动** (`index.js:539 startBshardCloseVoterCron`), 但它只是**签名侧** — 只对已经进 `collecting_sigs` 且 metadata 带 `bshard_close_request` 的市场, 每委员自治 enforce-then-sign。它**不会自己发起** close。
- 真正发起 close = **driver-side 脚本** (ozzeu/x4kpq 都是人手跑 close_attest)。
- ∴ skip 后 bshard 市场会停在当前状态 (open/pending/verifying) 等 driver-side close。**这暴露一个真缺口: bshard 自动结算发起方缺失 = Track B 线1 的活, 不是本 settler 能补的。**

**③ 证明 skip 不回归现在 working 的 settle 路:**
- working settle 路 = **anon 市场 (117 completed)**。anon 无 `market_shards` 行 → `isBshard=false` → **不被 skip** → 零影响。链上模拟 (`_j2_bshard_lifecycle` + 选择查询模拟): 当前 settler 待处理 10 市场全 anon, guard 跳 0。
- settler **从没成功结算过 bshard** (0 settle_txid)。skip 移除的**只有误退路**, 回归的 working settle = **零** (本来就没有 bshard 在这成功结算)。
- bettor 资金面: skip 不让 bettor 更糟 (错退本来也不退 bettor; bettor shard 资金两种情况都需 close 或 bshard-aware refund 来 made-whole)。

---

## 提议 (gated — 等 Bettor review + Owner 拍, 现不落码)

**方案 A (止血, surgical)**: per-market loop 最顶单 early-continue:
```js
// after processedCount++, 任何 shard-blind 站之前
const isBshard = !!sqlite.prepare(
  'SELECT 1 FROM market_shards WHERE logical_market_id = ? LIMIT 1').get(market.id);
if (isBshard) { bshardSkipped++; continue; }
```
覆盖全部 5 站 + 未发现站 (Bettor 防打地鼠钦定单点)。
- ✅ 止住误退; ✅ 零回归 working anon 路 (上证)。
- ⚠ **不补**: bshard 自动结算发起 (缺口②, Track B 线1); 已退 11 链上终态不可逆; bettor made-whole。
- ⚠ 副作用: bshard 市场到 deadline 后会停 verifying 等 driver-side close (比"被误退翻 refunded"更接近真相, 但仍需有人/daemon 发起 close 才终结)。

**待 Owner 拍的判断点**:
1. 止血 (方案 A) 现在做, 还是等 Track B 自动结算发起方同时到位再一起动 (避免 bshard 市场停 verifying 无人结算)?
2. deadline-watcher (L297) 要不要也 skip bshard (仅 label, 无资金; 可选)?
3. 双动作审计 (x4kpq UTXO 守恒 + 11 笔 bettor 处置) = 并行 cleanup 线, 谁主审 (我可出账)。

**诚实口径**: 本调查证 = settler 误退 bshard = 真 correctness bug (非度量假象, 11/11 真发 refund tx); 修方向 (skip-to-Track-B) 逻辑成立且零回归 working 路; 但"修完 settle% 会变好"**不成立追溯** — 11 笔真退了, gate 仍真 FAIL, 修后须用 **fresh bshard 市场**重测真 settle%。
