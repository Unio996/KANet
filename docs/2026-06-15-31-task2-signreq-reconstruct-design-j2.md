# #31 task#2 — sign_req reconstruct (committee-side rebuild, not transmit) — J2 design

> **日期**: 2026-06-15
> **作者**: J2 (MASS / 880-wall / sign_req domain)
> **性质**: 设计 doc。解 chunk-settle 的 **broadcast-880 side-floor**(committee 收不到大 sign_req 去签）。
> **状态**: design ready; impl gated on J1 two-P2SH SS (aggregate-version / chunk-version) landing.

## 0. 问题 (broadcast 层, 与 on-chain mass 正交)

chunk_0 真 TX = 6 spine inputs (各 reveal PoolSpine redeem) + N side inputs (各 reveal PoolSide redeem 2001B)
+ outputs. SIGHASH_ALL preimage ≈ 整 TX bytes（含全 input redeem reveal）。实测:
- chunk-58 @ maxK=5: TX ≈ 166KB → sign_req preimage ≈ 166KB → **~190 broadcast message-chunk**（>qr733 170 blackout）。
- side-floor (KANet-UI): N×2KB side reveal 是不可压地板（spine=0 极限 chunk-50 仍 114 chunk）。

委员必须**收到 sign_req preimage 才能算 sighash 签名**。relay 直传 166KB → 880-wall（broadcaster UTXO 耗尽 = qr733 42min blackout 二阶效应）。**on-chain mass (maxK↓ 解) 与 broadcast (此 doc 解) 是两层正交。**

## 1. 解 = 委员本地 RECONSTRUCT preimage（非 relay 直传）

委员**已有 canonical market state**（pool_snapshots / sides / ctor params / protocol_version, 全链锚 merkle-rooted）。
relay 只广播 **compact plan**（~few KB），委员**本地重建整 TX → 算 sighash → 签**。

### 1.1 compact plan（relay 广播, 小）
```
{ market_id, protocol_version, chunk_kind, seg_lo, seg_hi,
  payoutRoot, total_winners, prev_change_outpoint(txid+idx),
  committee_pks[5], committee_idx[5] }
```
不含 redeem bytes / 全 input outpoints / winner amounts —— 委员从 market state 派生。

### 1.2 委员重建步骤（each committee member, local）
1. 从 market state 取 sides（全 bettor side outpoints + values + params）+ spine inputs（maker stake + N oracle bonds outpoints）+ ctor params。
2. 用 compact plan 的 seg_lo/seg_hi + 本地 computePoolPayouts（同 settler）算 winner subset + amounts + payoutRoot。
3. 重建整 TX **按 canonical 序（NWT GAP-1, SIGHASH_ALL order-dependent）**:
   - **inputs 序** = `[spine pool-lock(或 prev change), 5 oracle bonds, N sides by merkle_index ASC]`
   - **outputs 序** = `[broker, 5 committee, winners by canonical re-index 0..K-1(= maker@idx0 if winning, then bettors merkle_index ASC), change]`
   两节点同序 → 同 sighash（否则各签不同 preimage → 不 aggregate → 4-of-5 fail/fork）。= 复用 ② canonical winner 序。
   → 算 SIGHASH_ALL sighash。
4. **签 sighash**（committee privkey）→ 回 sig（只 sig 小）。

### 1.3 广播节省
166KB preimage → compact plan ~2-3KB → **~190 chunk → ~3 chunk**。side-floor 解除（side data 不广播, 委员重建）。

## 2. 安全 — 3 步 byte-match 守点 (NWT/J1 必守, load-bearing)

委员重建的 redeem **必 byte-identical 链上 P2SH 锁的 redeem**，否则签**错 preimage** = 无效 sig / 跨节点签不同 TX。
重建-签前**三步缺一不可**:

1. **选对 version 源**: aggregate-version vs chunk-version .sil —— 从 **market-recorded protocol_version 确定选**
   （同 market 两节点同选 = version-select determinism, 锚 market state 非 node-local）。两-P2SH-按路给的新维度 (J1)。
2. **对 ctor**: 从 market params 取 ctor16 —— 同 create-time。
3. **blake2b(reconstructed_redeem) == 链上 p2sh_hash gate**: 不过 = **abort 不签**（= 现有 pool-p2sh-v08.mjs
   byte-match gate(a) 应用到 reconstruct-sign 步, 非新机制）。anti version/ctor 漂。

通过三步 → 算 sighash → sign。= 全程 chain-anchor 原则（重建必锚链上 hash 验, 同 fail-closed HALT 判定锚链 root）。

### 2.1 byte-identical reconstruct 三柱 (NWT co-verify; redeem byte-match 必要不充分)
3 步 gate 守的是 **redeem(合约 code)**；byte-identical sighash 还需 TX 结构确定:
1. **redeem byte-match** [§2 三步 ✅] —— 合约 code 对。
2. **canonical input/output 序** [§1.2 步3, NWT GAP-1] —— SIGHASH_ALL order-dependent, 两节点同序。
3. **input-SET 完整 + fail-closed** [NWT GAP-2] —— 委员重建前 **assert N sides 全 present**(对**链锚 side count**, 非本地 ingest 表行数)；缺一 side(ingest 滞后)→ 重建会少 input → sig 签错 input-set（redeem gate 查不到, redeem≠input-set）→ **HALT 不签**（= degrade-edge fail-closed 应用到 reconstruct, 同 chain-anchor 判定: 链该有本地没→HALT 等 ingest, 非签残缺）。

三柱缺一 → 委员签错 preimage/input-set = 无效 sig / 跨节点漂。NWT co-verify 三柱 byte-equal + cross-node。

## 3. determinism

- compact plan 全字段链锚（market_id / payoutRoot / prev_change_outpoint = confirmed chain UTXO / committee from pool snapshot）。
- 委员重建 = 纯函数 of (canonical market state + compact plan) → 两节点重建 byte-identical TX → 同 sighash → valid 4-of-5。
- version-select + ctor + redeem 全确定 → 无 node-local 漂。NWT co-verify 委员重建 byte-equal + cross-node。

## 4. 分工 / 验收

| 谁 | 责 |
|---|---|
| **J2** | 此设计 + relay sign_req-reconstruct wire（compact plan 广播 + 委员重建 handler）|
| **J1** | two-P2SH SS（version 源）+ 3 步 gate 中 version-select/ctor 一致性 SS 域 |
| **NWT** | 委员重建 redeem byte-equal + cross-node + 3 步守点 co-verify |
| **KANet-UI** | broadcast sign_req size 实测（reconstruct 后 ~3 chunk 验）|

**验收**: chunk-50 e2e, 委员收 compact plan（~3 chunk 非 190）→ 本地重建 → blake2b gate pass → 签 → 4-of-5 → chunk-chain settle landed。broadcast 不撞 880-wall。

---
*J2 task#2 design。impl gated on J1 two-P2SH SS landing（version 源定）。配合 (A) maxWinnersPerChunk=5（on-chain mass）解 chunk demo 两层（on-chain + broadcast）。*
