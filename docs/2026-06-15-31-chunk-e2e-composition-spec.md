# #31 Chunk-Route E2E 组成规格（artifact ②：payoutRoot 链上证）

> 作者 KANet-UI-tn（e2e owner）· 2026-06-15 · 配合 J1 chunk fixture-gen + NWT 逐 chunk 2-impl 验

## 0. 目的与边界

这是 **chunk-route e2e（artifact ②，entry0 settle_chunk）** 的市场组成规格，用于
**链上验证 #31 payoutRoot 创新**（chunk_0 链上 commit payoutRoot == 链下真锚 byte-equal）。

- **artifact ①（8-part aggregate，entry1）** 走 v07-style settle_aggregate，**链上无 payoutRoot**，
  只验 winner output addr+amount + v08 P2SH 集成。见 fixture `31_determinism_8p.json`（锚 b30b1ff3）。
- **artifact ②（本规格）** 走 entry0 settle_chunk，**chunk_0 链上 commit payoutRoot** = #31 唯一链上证。

## 1. chunk 触发原理（实证，非假设）

chunk vs aggregate 路由由 `computeSettleChunks` 的 `fits()` 决定（pool-settle-chunks.mjs L62-66）：

```
fits = estimateMultiOutputStorageMass(inputs, outputs) ≤ 470_000  (STORAGE_MASS_SAFE_THRESHOLD)
       AND chunkComputeMass.compute ≤ 500_000  AND  transient ≤ 1_000_000
aggregate route 用 applyKCap=FALSE → 忽略 47-winner cap → 纯 mass 判定
```

`estimateMultiOutputStorageMass = 1e12 × (Σ 1/output_value − nIn²/Σin)` —— **由最小 output 主导**。

∴ **chunk 触发 = storage mass > 470k，由小 payout 撑起，不是 winner count**。实算佐证：
- 58 个大额 winner（100-700 KAS payout）→ storageMass 261,805 < 470k → **走 AGGREGATE**（测不到 chunk）
- 需 ~110 个小额 winner（payout ~1.2-3 KAS，≥ STORAGE_PAYOUT_FLOOR 1 KAS）→ storageMass > 470k → chunk

`maker_stake ≥ 100 KAS`（create-v07 L962 Owner 钦定 demo 实质押约束）吸走大半 distributable，
maker payout 是单个大 output（低 mass），其余 winner 用小额 stake 维持小 payout 撑 storage mass。

## 2. seed 与派生（与 8-part 同源，byte-equal 前提）

```
SEED = "KANET-31-E2E-FIXTURE-SEED-v1"          (与 8-part fixture 同 seed)
derivePk(i):
  sk_i = blake2b(utf8(SEED) ‖ uint32LE(i))      dkLen=32        (@noble/hashes/blake2b)
  pk_i = kaspa.PrivateKey(sk_i).toPublicKey().toXOnlyPublicKey().toString()
```

e2e 造市用 derivePk(0..118)，treasury 各 side 注资 → 链上 bettor_pk == fixture pk → byte-equal 可达。
（KANet-UI 已独立验 derivePk(0..7) 全 byte-identical 8-part fixture pk，派生法坐实。）

## 3. 确定性组成（119 participant，winner=YES）

**生成规则**（确定性，J1 fixture-gen 必复现完全相同 stake 否则 byte-equal 破）：

```js
const LOSER_MI = new Set([1, 16, 31, 46, 61, 76, 91, 106]);   // 8 losers 均匀夹散 → 散 merkle_index
const comp = [];
for (let mi = 0; mi < 119; mi++) {
  if (mi === 0)            comp.push({ mi, side: 0 /*YES*/, kas: 100, isMaker: true });          // maker
  else if (LOSER_MI.has(mi)) comp.push({ mi, side: 1 /*NO*/,  kas: 1.0 + ((mi*3) % 11) * 0.1 }); // loser 1.0-2.0
  else                    comp.push({ mi, side: 0 /*YES*/, kas: Math.round((1.2 + ((mi*7) % 19) * 0.1) * 100) / 100 }); // winner 1.2-3.0
}
```

- **stake 单位 KAS**，sompi = round(kas × 1e8)
- mi = 注册序 = merkle_index（链锚）
- side: 0=YES（赢）/ 1=NO（输）
- maker = mi 0，YES，100 KAS

## 4. fee / settle 参数（与生产 create-v07 + 8-part 同源）

```
brokerBps = 190   oracleBps = 100   makerBps = 10
oracleBond = 1 sompi   committeeMode = true   oracleCount = 5   unanimous = true
minerFee   = computeChunkFee({nWinners, nFixedOut, hasChange}) PER CHUNK（(B)-uniform 单源, pool-settle-chunks.mjs）
```

⚠ chunk 路每个 chunk 各自 computeChunkFee（chunk_0 含 fixed outputs + change，chunk_i 含 change）。
总 minerFee = Σ per-chunk fee（J1 §1⑥ B-reserve）。**partition 由 computeSettleChunks 实算（变额 mass-aware），非预设 [47,47,17]**。

## 5. 验证属性（KANet-UI 实算，估算 fixed output）

| 属性 | 值 |
|---|---|
| participants | 119（111 winners + 8 losers） |
| pool | ≈ 344 KAS |
| winner stake 范围 | 1.2 – 100 KAS（变额，maker 100） |
| payout 范围 | 1.210 – 100.83 KAS（maker payout 100.8 = winners[0] dust absorber） |
| **minPayout** | **1.210 KAS ≥ 1 KAS floor ✓**（避 under-reserve liveness） |
| **storageMass** | **662,416 > 470k → CHUNK ✓**（margin +192k） |
| 预期 chunks | ≈ ceil(111/47) = 3 |

**4 命门全压**：①re-index（散 merkle_index winners → 全局连续 0..110）②parimutuel 变额
③loser-filter（8 loser stake 入 pot 不入 root）④maker@idx0 = winners[0] = dust absorber。

## 6. 待 J1 / NWT 确认

1. ⚠ **本规格 storage mass 用估算 fixed output**（broker 1.9% / committee oracleFee/5）。
   👉 **J1 fixture-gen 必用真 `computePoolPayouts` 复算 confirm route==chunk + margin** 再锁（实 fixed output 略大 → storage 略小，662k margin 应足，但实证为准）。
2. chunk fixture = **单 payoutRoot 跨全 111 winner**（全局 canonical sort [maker@-1 first + winning bettor merkle_index ASC] → 全局 leaf index 0..110，**非 per-chunk 重置**）+ computeSettleChunks partition。
3. NWT 逐 chunk 2-impl 独立验 payoutRoot + 每 chunk seg/winners/change。

## 7. 操作 scale（gate E，KANet-UI own）

~119 链上 register（各 derivePk 注资 + 注册付 side P2SH）+ 3-chunk settle 广播。
880-wall 正是 chunk 要解的（多 output → 拆块）。顺序：④b wire + 放行 → deploy → 跑 chunk e2e。

## 8. 最终锁定值（J1 fixture b621c8db / commit 69eae574 build 后）

- **chunk payoutRoot 锚 = `69eae57403da9a786e8c9a343aafc3d49501d791dd3772fa4577357fd8c18c26`**
  （我 chunk e2e 链上 chunk_0 commit 的 payoutRoot **必 == 此值 byte-equal** = #31 核心链上证）
- **globalMinerFee = 149,897,660 sompi**（§1⑥ Σ per-chunk computeChunkFee，5-vantage 锁定：J2实现+J1数学+KANet-UI Σ+NWT重写+J1独立算）
- **partition = [47,47,17]**（count-based，FLOOR-safe，per-chunk fee [67346070,60491970,22059620]）
- **committee output = uniform**（fixture 用 oracleBond+oracleFeeTotal/5 ≈ 0.688 KAS，稳区中点）

### 8.1 committee-source 解（KANet-UI e2e setup 域，RESOLVED）

fixture 用 **uniform** committee output，链上 dispatchPhase2 用 **stake-weighted**（getCommitteeStakesCanonical，
源 = pool_snapshots merkle-rooted 快照，跨节点确定）。**解 = e2e oracle pool 委员 enroll 等额 stake**：
stake-weighted split == uniform（每委员 = oracleFeeTotal × S/ΣS = oracleFeeTotal/5）→ 链上 committee output
== fixture uniform → ①partition [47,47,17] 稳 ②payoutRoot 69eae574 byte-equal ③SS §7.4 chunk_0
broker/committee P2PK+value≥oracleBond 结构验也满足 canonical。无需 fixture 改 stake-weighted。

### 8.2 chunk e2e setup checklist（gate E）

1. 119 bettor keypair = derivePk(0..118)，treasury 各注资（按 §3 stake + side P2SH）
2. **oracle pool 委员 enroll 等额 stake**（关键：保 uniform committee output == fixture）
3. create-v07 v0.8 市场（我组成 + pool_merkle_root auto-derive）
4. settle → entry0 settle_chunk → 3 chunk-chain
5. **链上 chunk_0 commit payoutRoot == 69eae574 byte-equal** + 逐 chunk check_utxo_landed + winner output addr==derivePk + value==fixture payout
