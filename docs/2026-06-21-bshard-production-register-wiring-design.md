# bshard 生产 register 路由 wiring design + 分配

**日期**: 2026-06-21 | **作者**: Bettor (协调/验证) | **状态**: DESIGN, 待落码 (gate 已过)
**前置**: claim 轴门 chain-confirmed (四方独立, 见频道 2026-06-21 00:2x 终版分级表)。
**北极星**: 把"用户押一个逻辑市场 → 系统按真实人数自动滚动开片/封片 → deadline 自动 settle"接进生产，**替掉测试用的预分片 harness**。Owner 2026-06-15 #1 directive (分片+自取) + Owner 2026-06-21 ("接进生产 register 路由")。

---

## 0. 为什么需要（Owner 的洞察）

测试是**先分好 32 片再注**（harness 为驱动跨节点并行注入的捷径）。真实逻辑是 Owner 说的**按需滚动分片**：用户不知道也不关心有几片，押注超过单片容量(seal_count)后才自然开下一片。本设计就是把这条自然逻辑接成生产路由。

---

## 1. 现状：组件现成，0 caller，模型对不上

| 组件 | 路径 | 状态 |
|------|------|------|
| 滚动分配器 | `kasia-console/src/lib/shard-allocator.mjs` | ✅ 完整 (allocateForRegister / registerShard / sealShard / onBettorRegistered)，**0 caller** |
| register 命令构造 | `kasia-console/src/lib/pool-register-builder.mjs` | ✅ buildRegisterWitness/buildRegisterCommand (action='bshard_register_bet')，按 leaf 输入构造，**未接 allocator** |
| 创世构造 | `kasia-console/src/lib/pool-bshard-market-setup.mjs` | ✅ computeConvertSplitGenesis / computeMarketGenesis |
| market_shards 表 | DB v171 | ✅ 表建好，**0 行** |
| register-v07 端点 | `kasia-console/src/api/pool.js` L1072 | ❌ "TODO 批3"，未调上面任何一个 |

**🔴 模型对账（关键，不是"调个函数"）**: shard-allocator 的注释假设**旧 settle 模型**（每片 pool_markets row + settle_aggregate + **fold 树** + PoolSpine + PoolSide claim_winner）。我们**链上证通的是 (A) 模型**（ShardLeaf covenant → consolidate fan-in → ONE PayoutShard → close_attest → claim，**无 fold 树**）。allocator 早于 aggregation pivot（fold→committee-sig→(A)）。接线必须先把 intake 层和已证的 (A) 链上模型对齐。

---

## 2. 四件分解 (a/b/c/d)

### (a) register-v07 端点 orchestration ←核心
在 `register-v07/confirm`（或复用 v06 加 shard 分支）里，bettor 押注流程改为：
```
1. allocateForRegister(db, logicalMarketId, stakeSompi)
   → {action:'use', shard}            → 用 shard 的当前 leaf
   → {action:'open_new', nextIndex, sealPrevId}
        a. relay genesis-mint 新 ShardLeaf covenant @nextIndex (computeConvertSplitGenesis, cov_id≠0)
        b. registerShard(db, {...})    ← UNIQUE(logical,index) 竞态锁；输者 catch→重跑 allocateForRegister
        c. sealShard(db, sealPrevId)   ← 封上一片
2. buildRegisterCommand({ leafOutpointTxid: <该片当前 leaf UTXO>, ... }) → relay 广播 register tx
3. NO TX NO STATE: side_lock 落链后才 onBettorRegistered(db, shardMarketId) (bump count + 投影 mass + eager-seal)
```
**域**: J2 (端点 + relay genesis-mint 命令 + 路由)。

### (b) 模型对账: ShardLeaf covenant ↔ market_shards row
- 每 shard (market_shards 行) ↔ 一条 **ShardLeaf covenant 续约链**。
- **🔴 schema 加列**: ShardLeaf 续约地址每 register 变（count 烤进 state→地址变），shard_p2sh(genesis) 只holds 创世。`buildRegisterCommand` 要 leafOutpointTxid = **当前 leaf 续约 UTXO**。market_shards 需加 `current_leaf_outpoint`(txid:idx) 列，每笔成功 register 后更新。→ migrate v172（UI 确认当前最新=v171，v172 接其后=正确序）。
- **J2 缺口2 fold-in**: 续约 redeem 也得能重算（buildRegisterCommand 要 leafRedeemHex/currentLeafState）。存 `current_leaf_state`(count/yes/no/pool_value) 即够 `spliceLeafState` 重算 redeem（J2 已验 byte-equal），**不必存全 redeem_hex**。market_shards 加 `current_leaf_outpoint` + `current_leaf_state`(JSON) 两列。
- shardStakes (mass 投影) 读 pool_bettor_sides——register 仍 insert 一行 ticket，复用 OK。
- 每 logical market 一个 **PayoutShard covenant**（首注创世时 genesis-mint，cov_id 烤进各 ShardLeaf 的 consolidate destination-bind）。
**域**: J2 (DB+记账) + J1 (ShardLeaf↔PayoutShard ctor coherence)。

### (c) settle 自动编排
deadline 到，对 logical market：
```
1. 封所有 open 片 (sealShard 全部)
2. 各 ShardLeaf 续到 count=seal_count 的 sealed leaf → consolidate fan-in 进本 market 的 PayoutShard (32 fan-in, cov_id 续)
2.5 【生产 payoutRoot 构造 — J2 缺口1, 承重】见下
3. close_attest (委员 4-of-5 sighash 背书 payoutRoot, poolMerkleRoot chain-derived)
4. claim: winner 自取 (permissionless covenant spend, recipient-bind P2PK)
```
= 我们手动跑通的那条，变 **deadline 触发的自动编排**（cron/settler）。**替掉 allocator 注释里的 fold-tree**。

**🔴 J2 缺口1 fold-in（最关键，(c) 真 done 的前提）**: demo 用的是 **synthetic 平分 payoutRoot**（16 片 winner 各平分等额，所以都 2.0649）。生产 payoutRoot 必：
1. **从真注册 bettor 建**：读 `pool_bettor_sides`/ticket → 赢家 = oracle 判的赢侧（direction == winningSide）的所有真 bettor。
2. **pari-mutuel 真派彩**：每 winner payout = `winner_stake / Σ(winning_side_stakes) × total_pool`（变量 stake 下非平分；等 stake 退化成平分）。整数运算 store-payout（leaf=blake2b(pk‖ser(payout,8))），dust 余数烤进 winners[0]（见 #31 收敛）。
3. **链下 builder == 合约 climb byte-equal**：`pool-payout-root.mjs` DEPTH 必 ==10（pad 1024 叶），climbProof 与 PayoutShard.sil claim L186-198 byte-equal，否则 root 对不上 claim 全 BUST。
**域**: J2 (settle driver/cron 自动化 + 真 payoutRoot 构造) + J1 (pool-payout-root pari-mutuel 算 + claim climb coherence)。

### (d) 首注创世
logical market 第一注：创建 shard 0 (ShardLeaf genesis-mint) + 该 market 的 PayoutShard covenant genesis-mint + market_shards 首行。后续注走 (a)。
**域**: J2 (relay genesis) + J1 (创世 ctor)。

---

## 3. Race / 安全 / determinism

- **注册竞态**: UNIQUE(logical_market_id, shard_index) 串行化"开新片"，跨节点/并发只一个 INSERT 赢，输者重跑 allocate 看到赢家的 open 片。
- **NO TX NO STATE**: onBettorRegistered 只在 side_lock **真落链后**调（铁律）。genesis-mint 同理，广播没上链不准推进 market_shards。
- **跨节点 determinism**: shard 集**链上派生**（logical↔shard 链接烤在 ShardLeaf ctor），各节点 by-root 派生同一片集，不靠本地 flag（吸取 active-flag determinism 教训）。
- **cov_id provenance**: 每 ShardLeaf bake 本 market PayoutShard 真 cov_id，consolidate 用 OpInputCovenantId 绑（假 template-PS cov_id≠baked→BUST）。承重，不可漏。

---

## 4. 排期 + DoD

**落码顺序 — LOCKED**（Owner 2026-06-21 "按最符合逻辑顺序干" → 我按依赖/数据流定，每件链上验过再下一件，不跳步）:
1. **(d) 首注创世** — 一个 logical market 创建 shard0 ShardLeaf + PayoutShard covenant，链上验 cov_id≠0。**先决**：无创世片，bet 无处可注。
2. **(a)+(b) intake 路由** — 押 N>seal_count 次自动滚到 ≥2 片，链上验各片 ShardLeaf 续约 + market_shards 行准（current_leaf_outpoint/state）。**依赖 (d)**。
3. **(c) settle 自动编排** — deadline 触发自动 consolidate→close→claim，含**真 bettor pari-mutuel payoutRoot**（缺口1）。**依赖 (a)/(b) 有真注册数据可结**。

理由：依赖链 = 数据流 = create→intake→settle，最符合逻辑。(a)+(b) 并轨因 intake 路由与 leaf 续约记账同生共死。

**DoD（接线算完成）**: 一个用户（或测试）押**逻辑市场** N>32 次 → 系统**自动滚动到 ≥2 片**（非预分片）→ deadline **自动 settle** → winner claim 落链。四方链上验。**然后**才是 Owner 要的 DM 测试。

**每件 happy LAND + 失败路（片满开新片竞态/广播失败不推进）都要链上验**（吸取 claim 轴门教训：code-read≠chain-confirmed，对抗路必行使）。

---

## 5. 分配

| 域 | 谁 | 件 |
|----|----|----|
| 端点 orchestration + relay genesis-mint + settle 自动化 + DB 记账 | **J2** (lead) | a, c, d, b-DB |
| ShardLeaf↔PayoutShard ctor coherence + 创世 ctor | **J1** | b-contract, d-ctor |
| 跨节点 deploy + sync + migrate v172 上线 | **KANet-UI** | 部署 |
| 逐件链上验 (happy LAND + 失败路 + 守恒/cov_id) + 对抗红队 | **Bettor + NWT** | 验证 |

待 Owner 拍：落码顺序 1→2→3 OK？还是先 a+d 一起（intake 全通）再 c？

---

## 6. 两个 production-trust 合约 shape 钩子（NWT 代码层核实·必现在 genesis 阶段种）

⚠ **Bettor 自纠**: 我初版把这两个划成"(c) 实现 / (d) reserve 字段"——**太松**。NWT 代码层核实：这是**合约 shape / genesis 烤值**决定，定型后补 = re-mint/re-deploy。原则 = **shape 现在种，behavior 分阶段**。两个都**不阻 testnet ramp**，但合约 shape 必现在落。

### 钩子1 · 命门③ predicate-commit（WHAT 判·防委员盲签 winningSide）
- **现状洞**: `computeMarketGenesis` L44-48 烤了 committeePks+deadline+shardPoolId = **WHO 判** 上链；但 `resolution_predicate`（哪个 ESPN 字段/阈值/winningSide 规则）= **WHAT 判** 一个字没烤。(A) PayoutShard ctor L28-35 只 poolMerkleRoot 无 predicate → **委员现可盲签任意 winningSide，共识洗白**（Owner 早点过的命门③ / 见 project-oracle-consensus-launders-poison-rulings）。
- **⚠ 与 J2 缺口1 不同**: 缺口1 管 payout【金额】(pari-mutuel)；命门③ 管【谁赢】(winningSide 由链上 committed predicate + 委员 re-derive 定，非 settler 说了算)。两条都打 synthetic-blind-sign，一个钱数一个输赢。
- **shape 现在种**: genesis ctor 烤 `predicate_commit`(resolution rule hash)；close_attest 把 winningSide 绑 committed predicate（委员从 predicate re-derive，非自填）。
- **behavior 分阶段**: full predicate→oracle 判定（读 ESPN/deriveKanetNativeVote）= **oracle 扩展主线**，不在本 wiring。本 wiring 只种 commitment 锚。
- **域**: J1 (ctor predicate_commit + close_attest 绑定 shape) + J2 (genesis 烤值)。

### 钩子2 · (A) 模型 refund 路径（现在【没有】）
- **现状洞**: (A) PayoutShard 仅 absorb/close/claim **无 refund entry**。RefundClaim.sil 只活在 cascade(convert_to_refundclaim) 且有**虚高 stake 洞**（L54-60 读 dust-ticket stake，spender 可控 → 造 stake=整池 假票一笔抽干）。→ 生产走 (A) 的退化市场（单侧池/无赢家/片没填满）**钱卡死无法退**。
- **NWT 修向（镜像 winner 侧）**: (A) PayoutShard 加 `refund_claim` entry——委员 attest `refundRoot`(全 bettor {pk,stake}, leaf=blake2b(pk‖stake)) + 走同 merkle+nullifier 机器（复用 claim 的 store-payout climb，只 leaf 换 stake）。`closed=2`=cancelled latch（区分 1=settled）。**虚高 stake 洞根治**：stake 不读 spender 可控 dust-ticket，从 committee-attested refundRoot 取。
- **shape 现在种**: PayoutShard 加 refund_claim entry + closed=2 latch（合约 shape，genesis 定型）。
- **behavior 分阶段**: refund 触发条件判定（哪些市场 degenerate→cancel）= (c) settle 编排逻辑。
- **域**: J1 (PayoutShard refund_claim SS entry) + J2 ((c) refund 触发)。

**∴ 修正 scope**: 两钩子的【合约 shape】(predicate_commit ctor + refund_claim entry + closed=2) 现在 (d)/(b-contract) 阶段种；【behavior】(oracle 判定 / refund 触发) 分阶段。**Owner 决策**: 趁 (d) 已动 genesis，shape 现在种全（避 re-genesis）= NWT 推荐 + 我同意；还是 testnet 先 ramp 现 shape、mainnet 前再 harden（要 re-deploy）。
