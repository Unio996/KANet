# bshard shard-variant + fold-covenant — 第一版结构 (J1, 待团队审)

> **日期**: 2026-06-15 (Owner 令: 分片+自取 = #1 首要, 即刻实施)
> **作者**: J1 (SS/determinism)
> **基**: `2026-06-14-bshard-fold-trustless-§4-consensus.md` (fold 设计) + `2026-06-02-bshard-rolling-design-consensus.md` (rolling §2)
> **性质**: **结构提案待审** (design-review before .sil compile). @Bettor 审结构 / @J2 fold调度对齐 / @NWT 攻面对齐 / @KANet-UI UX 依赖确认.

---

## 0. 我 J1 域两件 (§4 L56)
1. **PoolSpine_v07 shard variant** — 片满~64封口 + 携 localYes/No state.
2. **fold covenant** — OpInputCovenantId 输入白名单 + conserve partial-sum (零 committee-sig) + commit 硬校验.

---

## 1. 关键架构决策 (待审)

### 1.1 shard 叶 = covenant-accumulating UTXO (非 v07 spine+sides)
§4 #1b 铁律: `localYes/No 必在 bet-register 时 covenant-enforced 写入 state`. ∴ shard 叶是**有状态 UTXO**, 每注 TX 经 covenant 更新其 `localYes/localNo` state (validateOutputState 续锁同 shard cov + 写新 local). fold 关池后 readInputState 读不可变 local.
- **state 字段**: `localYes` / `localNo` (sompi) + `betCount` (封片判定) + `sealed` (0/1 封口闸).
- **state 编码 (Q2)**: 走 **script state** (validateOutputState/readInputState), 非 UTXO value —— introspection 易读 + 与 fold readInputState 一致. (J2 mass 核: state 读写 op 成本).

### 1.2 fold = 结构 (b) 逐-input 白名单 (避 OpCovInputCount 跨 cov_id 坑)
⚠ J1 memory [[reference-silverscript-covenant-fold-limits]]: `OpCovInputCount 只数同 cov_id`. 设计输入跨两模板 (shard 叶 + 中间 fold), 若靠 OpCovInputCount 数 → 跨 cov_id 失效.
**定 (b)**: fold for-loop `for(i,0,k,MAX_K)` 逐 input:
- `OpInputCovenantId(i)` 读各 input cov-id → `require(cid==SHARD_COV || cid==FOLD_COV)` (白名单, §2#1 SS 层防伪 UTXO).
- `readInputState(i)` 读各 input local → 累加 `sumYes += inYes; sumNo += inNo`.
- 出 1 中间/root UTXO: `require(outYes == sumYes); require(outNo == sumNo)` (conserve, 零 committee-sig = DECL conserve_and_bump).
**叶/fold 可分两合约** (b 不靠 count-across) → 结构更清晰. `k` (fold 叉数) 受 MAX_OPS 201/bytecode<10000B 硬限 (J2 实测定; 我结构最小化 per-input op).

### 1.3 commit 硬校验 (仅 root fold)
中间 fold 只 conserve. **root fold** (出全局 root UTXO) 加:
`require(blake2b(byte[](outYes,16) ‖ byte[](outNo,16) ‖ market_id ‖ byte[](shard_count,?)) == commit_v2)`
- globalYes/No = 链上 fold 派生**真值** (非 settler 算) → 6/02 作废的"委员背书 commit"真上链.
- `byte[](int,16)` int-to-byte 原语 J1 已实证 (DECL). shard_count 来源/编码宽度待定 (witness? root state?).

---

## 2. SS 结构骨架 (entries, 待 .sil 落地)

### 2.1 PoolSpine_v07_shard (叶合约)
```
ctor: makerPk, brokerPk, poolMerkleRoot, deadline, marketMetadataHash, market_id,
      shard_id, oracleBondAmount, makerStakeAmount, ...  (shard_count 移出 → fold/settle witness)
state: localYes=0, localNo=0, betCount=0, sealed=0
entry register_bet(sig bettorSig, int side, int amount, ...):
  require(sealed == 0)                                  // 未封口才收注
  require(side==0 || side==1)
  // 累加 local (covenant 写 state):
  newYes = localYes + amount*(1-side); newNo = localNo + amount*side
  newCount = betCount + 1
  // 封片闸 (mass-aware OR 64; mass 由 settler 预判, SS 守 64 硬上限 + sealed flag):
  newSealed = (newCount >= 64) ? 1 : 0                  // 64 硬上限 (depth-6); mass-aware 软封由 register endpoint
  validateOutputState(outIdx, {localYes:newYes, localNo:newNo, betCount:newCount, sealed:newSealed})
  // + bettor 注入 PoolSide (自取路, claim_winner 已实现) — 或 local-only? 待 §2 自取对齐
entry seal():  // 显式封口 (deadline 或 mass 触发, register endpoint 调)
  require(tx.time >= deadline*1000 || ...)
  validateOutputState(outIdx, {..., sealed:1})
entry settle_aggregate(...): // 复用 v07 (片内 ≤64 自己结) — 或片只 fold 不单结? 待 §2 对齐自取
entry refund / dispute: 复用 v07
```

### 2.2 PoolFold (fold 合约)
```
ctor: market_id, commit_v2, shard_count, maxFanIn(=k 上限编译界), ...
entry fold(int k, byte[32] commit_v2_witness, ...):
  require(k >= 2); require(k <= maxFanIn)
  int sumYes=0, sumNo=0
  for(i,0,k,MAX_FANIN):
    cid = OpInputCovenantId(i)
    require(cid == SHARD_COV_ID || cid == FOLD_COV_ID)         // 白名单
    {localYes:int iY, localNo:int iN, ...} = readInputState(i)
    sumYes = sumYes + iY; sumNo = sumNo + iN
  // 出 1 UTXO conserve:
  require(tx.outputs.length == 1或+fee)
  {localYes:int oY, localNo:int oN} = <out state>
  require(oY == sumYes); require(oN == sumNo)                  // conserve 零 sig
  validateOutputState(0, {localYes:sumYes, localNo:sumNo, isRoot: <derived>})
  // root 分支 (全片聚完):
  if (<isRoot>) {
    require(blake2b(byte[](sumYes,16)+byte[](sumNo,16)+market_id+byte[](shard_count,?)) == commit_v2)
  }
```

---

## 3. 待审/待定 (团队对齐点)
- **@Bettor/@J2**: 自取路 — 片内 winner 走 settle_aggregate 单结(片≤64 用既有 v07 settle)还是 **只 fold 出全局再各 bettor 从 PoolSide 自取**? 影响 shard 叶要不要 settle entry. (Owner: 自取=赢家从 PoolSide claim_winner 已实现 → 倾向**叶不单结, 全局赔率 fold 出后 bettor 自取**).
- **@J2 fold 调度**: (b) 结构 OK? cov-id 白名单值 (SHARD_COV_ID/FOLD_COV_ID) 怎么 derive (编译期常量? P2SH hash?). root 判定 (isRoot) 怎么链锚定 (shard_count 聚满?).
- **@J2 mass**: k 上限实测 (per-input = OpInputCovenantId + readInputState + 2 加 ≈ ? op; < 201).
- **@NWT 攻面**: (b) 白名单是否真挡伪 UTXO (cov-id ∈ 白名单 + by-root outpoint 双层); conserve under-count; commit free-witness 漂.
- **@KANet-UI**: 1 逻辑市场 + 全局赔率从 root UTXO localYes/No 派生显示 — 依赖 root state 可读.
- **Q5 mass / Q4 原子性 / 大池压测**: §4 §3 待办, 实施后必闭.

---
*J1 第一版结构。审过 → 我落 .sil (叶 + fold 两合约 结构(b)) + compile-verify + 2-vantage。先结构对齐再码 = 今天 question-premise 教训。*
