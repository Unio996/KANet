# bshard 生产 register — (b-contract) ctor coherence spec + (d) 创世序 (J1)

**日期**: 2026-06-21 | **作者**: J1 | **状态**: SPEC (落码前置契约, 给 J2 (a)/(d) builder + NWT 验)
**配**: `docs/2026-06-21-bshard-production-register-wiring-design.md` (Bettor, §2(b)/(d)/§3) — 本文是该 doc §2(b)/(d) 里 "J1: ctor coherence" 的展开契约。
**scope**: 合约 (ShardLeaf/PayoutShard depth-10) **已部署 + cross-node 1000 demo 链上证**。本 spec **不改 SS**，只钉死生产 genesis-mint / register builder 必须满足的 **ctor 参数 coherence 不变式 + 创世序**，否则 (A) 链 (ShardLeaf→consolidate→PayoutShard→close_attest→claim) 断。

---

## 0. 验证锚 (本 spec 基于的部署合约真码, 非凭印象)

- `PayoutShard.sil` ctor = **21 参**: `poolMerkleRoot` + `init_consolidated_pool` + `init_closed` + `init_payoutRoot` + `init_w0..w16` (17-word nullifier).
- `ShardLeaf.sil` ctor = **10 参**: `market_id, ps_tmpl_hash, shard_pool_id, seal_count, min_bet, payout_cov_id, init_local_yes, init_local_no, init_count, init_pool_value`.
- `ShardLeaf.consolidate_to_payout` (L88-91): `require(count==seal_count)` + `ps_cov=OpInputCovenantId(psInIdx); require(ps_cov==payout_cov_id)` = **destination provenance-bind**.
- `PayoutShard.absorb` (L49-57): `consolidated_pool + tx.inputs[shardInIdx].value`, weld `out.value==consolidated_pool+shard_value`.
- `PayoutShard.close_attest` (L161-167): **SET** `payoutRoot: new_payoutRoot` (委员 4-of-5 sighash 覆盖背书), `closed 0→1` write-once, `out.value==consolidated_pool` (close 不动资金).
- `PayoutShard.claim` (L177-237): `require(closed==1)` + merkle climb ∈ payoutRoot + 17-word nullifier + recipient-bind P2PK + draw-down weld.

---

## 1. 承重不变式 (5 条; 漏一条 = (A) 链断 / theft / circular)

| # | 不变式 | 漏了会怎样 | 验点 |
|---|--------|-----------|------|
| ① | **payout_cov_id coherence**: 每 ShardLeaf bake 的 `payout_cov_id` == 本 market 真 PayoutShard 的 cov_id (genesis-mint 时立) | ShardLeaf consolidate `OpInputCovenantId==payout_cov_id` 永远 mismatch → 归集全 BUST (资金锁死) | NWT: 链上读 ShardLeaf redeem 抽 payout_cov_id == PS 实 cov_id |
| ② | **单向 DAG / 创世序**: PayoutShard genesis-mint **必先** (立 cov_id) → ShardLeaf **后** bake 该 cov_id | 同 tx 出二者 = cov_id=blake2b(outpoint,**outputs**) 含 ShardLeaf spk, 而 ShardLeaf bake cov_id → **circular 算不出** | 见 §2 创世序 (2 tx) |
| ③ | **consolidate destination-bind**: 归集只能进【真 payout_cov_id 的 PS 实例】, 假 template-PS 的 cov_id≠baked → BUST | recreatable 假 PS (同 template 自控 state) 吸输家片 → attacker 自 claim = **真 theft** (#26 championed) | NWT 对抗: 假 PS 导入 → 必 BUST |
| ④ | **per-shard ctor coherence**: 同 market 各片 (shard 0..N) bake **同** `market_id / ps_tmpl_hash / seal_count / min_bet / payout_cov_id`; **异** `shard_pool_id + init state` | 片间 payout_cov_id 不一致 → 部分片归集不进同一 PS → 池碎裂 | NWT: 各片 redeem 抽 5 共享字段 byte-equal |
| ⑤ | **CovenantBinding 续约链不断**: PS **每个** continuation output (genesis + absorb×32 + close_attest + claim×M) 必带 CovenantBinding(payout_cov_id) | 任一步漏续 → cov_id 断 → 后续 consolidate `OpInputCovenantId` 挂 (归集断) | relay 设 binding; J2 probe-not-model 链上双步证 (demo 已证) |

---

## 2. (d) 创世序 — 2 笔 tx (single-direction DAG, 破 circular)

**铁律: 不可一 tx 出 PS + ShardLeaf** (②: cov_id 含 outputs 含 ShardLeaf spk, ShardLeaf bake cov_id → circular)。

```
TX1: PayoutShard genesis-mint (relay)
  • ctor (21 参):
      poolMerkleRoot       = 真委员池树根 (chain-derived oracle pool root, depth-8;
                             ★★ 非 z32 占位 — demo 撞过的 z32-root bug; close_attest 委员 merkle 爬到 z32 = BUST)
      init_consolidated_pool = <PS genesis UTXO seed sompi>   ★ 必 == PS 创世 UTXO value
                             (否则首 absorb weld out==consolidated_pool+shard_value 对不上 Σin/Σout → BUST)
      init_closed          = 0
      init_payoutRoot      = ZERO32  (占位; close_attest 时委员 SET 真 new_payoutRoot, 非创世已知)
      init_w0..w16         = 0,0,...,0  (空 nullifier, 17 个 0)
  • relay 设 output CovenantBinding → cov_id = blake2b(genesis_outpoint, outputs) ≠ 0
  • → 读出 PAYOUT_COV_ID  (= 链上真 cov_id, 喂 TX2)

TX2: ShardLeaf (shard 0) genesis-mint (relay), bake TX1 的 cov_id
  • ctor (10 参):
      market_id        = <logical market id>
      ps_tmpl_hash     = <PoolSide-ticket 模板 hash> (register 造 dust ticket 的 validateOutputStateWithTemplate 锚)
      shard_pool_id    = <shard 0 唯一 id> (各片不同; 决定片地址)
      seal_count       = 32  (SHARD_SEAL_COUNT, shard-allocator 同源)
      min_bet          = <market min bet>
      payout_cov_id    = PAYOUT_COV_ID  ★ == TX1 的 cov_id (①②③ 全靠这条)
      init_local_yes   = (side==0 ? first_stake : 0)
      init_local_no    = (side==1 ? first_stake : 0)
      init_count       = 1                         (首注 baked, 非 register_append)
      init_pool_value  = first_stake               (= 首注 stake; 锁进 ShardLeaf POOL, welded)
  • 首注真 stake lock 进 shard0 ShardLeaf P2SH (genesis count=1)
  • market_shards 首行: logical↔shard0, current_leaf_outpoint=TX2:idx, current_leaf_state={yes,no,count=1,pool}

后续注 → (a) allocateForRegister: use shard0 (有余) → register_append; 满 → open_new shard1 (同 §2 但 PS 已存, 只 TX2-类 ShardLeaf genesis bake 同 PAYOUT_COV_ID)
```

**关键: open_new shard_k (k≥1) 不重 mint PS** — PS 是 per-logical-market 单例 (首注时 TX1 建一次)。shard_k genesis 只 TX2-类 (ShardLeaf bake 同 PAYOUT_COV_ID, 异 shard_pool_id)。④ per-shard coherence 即此。

---

## 3. 现状 builder 缺口 (J2 (d) 落码注意)

- `computeMarketGenesis` = 旧 PoolLeaf (无 PayoutShard, 无 payout_cov_id) — **不是 (A) 模型**, 别直接用。
- `computeConvertSplitGenesis` 注释产 ShardLeaf + **FoldNode** (旧 convert-split cascade, seal-SIZE probe 期) — **ShardLeaf 侧 bake fn_tmpl_hash 非 payout_cov_id** (注释 stale); 但**部署 ShardLeaf.sil ctor 已是 payout_cov_id** (L28) → builder-vs-合约需对齐。
- **(A) 模型 genesis 真参考 = demo 的 `_j2_A_xnode_artifacts.mjs` generator** (产 32 ShardLeaf bake cov_id 7b1b10aa + PayoutShard genesis, 1024-bet 链上证过)。生产 (d) = 把它从 "预分 32 片 harness" 改成 "首注单 market-open" 流 (TX1 PS + TX2 shard0)。

---

## 4. 两 production-trust 钩子 — SHAPE 现在种, LOGIC 分阶段 (NWT raise + Bettor scope + 团队 converge 2026-06-21)

**为什么现在**: cov_id = blake2b(genesis_outpoint, **outputs 含 ctor-baked spk**) → ctor shape 现不留字段、之后补 = ctor 变 → cov_id 变 → **re-mint 全片 re-deploy**。∴ 两钩子的 **字段/entry 槽 (shape) 必现在种**, **behavior (full logic) 分阶段**。配 Owner 反过度工程: minimal shape, 不写死 logic。
**待 Owner 拍 (Bettor 带): 趁 (d) 已动 → shape 现在全种 (避 re-genesis; NWT+Bettor+J1 荐) vs testnet 先 ramp 现 shape、mainnet 前 re-deploy。** 下面是 plant-now 的具体 shape。

### 钩子1 · predicate-commit (命门③, 管"谁赢"; 防 settler 自填 winningSide)
- **shape (现在种)**: PayoutShard ctor **加 1 个 byte[32] `predicate_commit`** (= resolution rule hash; market-create 时 commit; 21→**22 参**)。
- **behavior (分阶段, oracle phase)**: close_attest 绑 `winningSide == judgeLine(predicate_commit 对应 rule, ESPN fields)` — 委员各自 re-derive 非盲签 settler 给的。本 wiring **只种字段**, full oracle 判定 = 预言机 phase。
- ⚠ 与 J2 缺口1 **正交**: 缺口1 管 payout **金额** (pari-mutuel 真算); 命门③ 管 **谁赢** (winningSide 判定)。两条都打 synthetic-blind-sign, 一个钱数一个输赢。

### 钩子2 · refund-path (管 market-cancel; (A) 现仅 absorb/close_attest/claim 三 entry, 零 refund)
- **shape (现在种, Bettor 定)**:
  - `closed` **三态 {0=归集中, 1=attested-claim, 2=cancelled-refund}** (现 0/1 → 加 2; 互斥: 市场要么 settle 要么 cancel, 不并存)。
  - **`refundRoot` 复用 `payoutRoot` 槽** (同一 byte[32] state 位: closed==1 时是 payoutRoot, closed==2 时委员 attest 进的是 refundRoot)。**不加新 state 字段**。
  - **`cancel_attest` entry** (镜像 close_attest): 委员 4-of-5 背书 refundRoot, `closed 0→2` write-once, `out.value==consolidated_pool` (cancel 不动资金)。
  - **`refund_claim` entry** (镜像 claim): `require(closed==2)`, leaf=**blake2b(bettorPk‖ser(stake,8))** (烤 stake 非 payout), 复用 `merkle_index` 单变量驱 climb(∈refundRoot)+ 17-word nullifier(closed==2 与 claim closed==1 互斥 → 复用 w0..w16 无双用), recipient-bind P2PK(bettorPk), draw-down weld `consolidated_pool-=refund`。
- **behavior (分阶段, fold 进 (c))**: cancel 触发 + refundRoot 构造 (全 bettor {pk,stake}, 读 pool_bettor_sides) = (c) settle 的 degenerate→refund 分支 (market_shards 已有 refunded 态)。本 wiring **只种 closed=2+refundRoot 槽+两 entry shape**。
- **防 trust-gaps 洞1**: refund 走 merkle (leaf 绑 committee-attested refundRoot) → 替掉 RefundClaim.sil L54-60 的 ctor-self-fill `tk.stake` (spender 可控 → 造 stake=整池假票抽干)。refund 侧 stake 绑不可伪 refundRoot, 同 claim 的 forge-proof。

### plant-now 的 PayoutShard production shape 汇总
- ctor: 21 → **22 参** (+`predicate_commit`; refundRoot 复用 payoutRoot 槽不加字段)。
- closed: {0,1,2} 三态。
- entries: absorb / close_attest(+predicate-bind, behavior later) / **cancel_attest(new)** / claim / **refund_claim(new)**。
- ⚠ 此 shape ≠ demo 部署 shape (closed 2 态/无 predicate/无 refund) → plant-now = **一次性 re-deploy production shape + re-genesis (d)** (cov_id 变), 然后型定型。Owner 拍。

---

## 5. (c) 阶段 J1 衔接 (本 spec 之后, 备忘)

(c) settle 我另一件 = **pari-mutuel payoutRoot 算 + claim climb coherence**: `pool-payout-root.mjs` DEPTH==10 (pad 1024 叶) + climbProof 与 `PayoutShard.sil claim L186-198` byte-equal; payout = `winner_stake/Σ(winning_side_stake)×pool` 整数 store-payout, dust 余数烤 winners[0]。close_attest 的 `new_payoutRoot` = 此真 payoutRoot。详见 (c) 落码时展开。

---

**DoD (本 spec)**: J2 (d) builder 按 §2 产 TX1+TX2 → NWT 链上验 ①payout_cov_id==PS cov_id ②cov_id≠0 ③poolMerkleRoot 非 z32 ④shard0 ShardLeaf 5 共享字段对 ⑤首注 count=1 pool==stake。happy LAND + 对抗 (假 template-PS 导入 BUST)。
