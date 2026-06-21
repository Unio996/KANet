// shard-allocator.mjs — rolling-shard sequential-fill allocation + mass-aware封片 + register race-lock.
//
// Part of bshard B (UNLIMITED betting). Owner 2026-06-15 #1 directive: 分片(sharding)+自取(self-claim).
// One logical market = N physical shards; each shard is its OWN pool_markets row (independent market_id +
// spine_p2sh) holding a conservative ≤SHARD_SEAL_COUNT bettors, settling in ONE settle_aggregate TX (no
// chunking, no mass-cap hit). Shard count is unlimited → total capacity unlimited. Cross-shard global odds
// come from the trustless fold tree (J1 fold covenant); winners self-claim (PoolSide_v07 claim_winner).
//
// This module is the OFF-CHAIN coordination layer over the v171 market_shards registry:
//   - 顺序填分配 (sequential fill): route each new bettor to the current open shard (highest index, status=open)
//   - 封片 (seal): when a shard reaches a conservative cap → seal it, next bettor opens a new shard
//   - 注册竞态锁 (register race lock): UNIQUE(logical_market_id, shard_index) serializes "open new shard"
//
// Authority note: market_shards is the LOCAL index of the chain-anchored shard set (like pool_markets is the
// local cache of on-chain markets). The logical_market_id↔shard linkage is baked in the shard PoolSpine ctor
// (J1 shard variant) so every node derives the same shard set (by-root determinism). Leaf localYes/No
// integrity is covenant-enforced at register (J1/NWT PoC-1b: 叶.local 增量 == introspect PoolSide output value).
// This module does NOT touch chain — it records/coordinates; the on-chain shard create + register TX are built
// by the caller (relay). NO TX NO STATE: onBettorRegistered is called only after the bettor's side_lock landed.

import { estimateStorageMass, STORAGE_MASS_SAFE_THRESHOLD } from './kip9-mass.mjs';

// ──────────────────────────────────────────────────────────────────────────────
// Conservative seal thresholds. Owner 2026-06-15: 单片容量无所谓(片数无限→总容量无限), 卡点是 settle mass,
// 设保守值留大余量, 别为塞满把合约/mass 搞复杂。Bettor 钦定 ~32。
// ──────────────────────────────────────────────────────────────────────────────
export const SHARD_SEAL_COUNT = 32;                 // binding cap; < PoolSide depth-6 = 64 merkle slots, 留半余量
export const SHARD_MASS_CEILING = 380_000;          // backstop; < 470k SAFE / 500k cap, 90k+ margin (kip9-mass)

/**
 * Conservative projected settle-aggregate STORAGE mass for a shard, from its bettor stakes.
 * Dominant risk = dust outputs: each bettor → ~1 winner output ≈ their stake; estimateStorageMass(small)
 * blows up (≈ C/value), so Σ over stakes scales with both count AND dust → seals dust-heavy shards EARLY.
 * Reuses the canonical kip9-mass estimateStorageMass (design §2 "复用 estimateStorageMass"; the settler's
 * own dynamic fee covers the few committee/broker fee outputs — not double-counted here).
 *
 * @param {Array<number|bigint|string>} stakeValuesSompi  current bettor stakes in the shard
 * @returns {number} estimated storage mass
 */
export function projectShardSettleMass(stakeValuesSompi) {
  let mass = 0;
  for (const s of stakeValuesSompi) mass += estimateStorageMass(s);
  return mass;
}

/** Would adding one more bettor (with `nextStakeSompi`) keep the shard within both caps? */
export function shardHasRoom(shard, currentStakes, nextStakeSompi) {
  const nextCount = (shard.bettor_count || 0) + 1;
  if (nextCount > SHARD_SEAL_COUNT) return false;
  const projMass = projectShardSettleMass([...currentStakes, nextStakeSompi]);
  if (projMass > SHARD_MASS_CEILING) return false;
  return true;
}

/** Current open shard (highest index, status='open') for a logical market, or null. */
export function findOpenShard(db, logicalMarketId) {
  return db.prepare(
    `SELECT * FROM market_shards WHERE logical_market_id = ? AND status = 'open' ORDER BY shard_index DESC LIMIT 1`
  ).get(logicalMarketId) || null;
}

/** Highest shard_index for a logical market (any status); -1 if none yet. */
export function maxShardIndex(db, logicalMarketId) {
  const r = db.prepare(`SELECT MAX(shard_index) AS mx FROM market_shards WHERE logical_market_id = ?`).get(logicalMarketId);
  return (r && r.mx != null) ? r.mx : -1;
}

/** Bettor stakes currently registered in a physical shard (sompi). */
export function shardStakes(db, shardMarketId) {
  return db.prepare(`SELECT stake_amount FROM pool_bettor_sides WHERE market_id = ?`).all(shardMarketId)
    .map(r => Number(r.stake_amount) || 0);
}

/**
 * 顺序填分配: decide where a new bettor (staking `nextStakeSompi`) registers.
 * Returns one of:
 *   { action: 'use', shard }                       — register into this open shard (has room)
 *   { action: 'open_new', nextIndex, sealPrevId }  — caller must create a new ON-CHAIN shard at nextIndex
 *                                                     (and seal sealPrevId if non-null), then registerShard()
 */
export function allocateForRegister(db, logicalMarketId, nextStakeSompi) {
  const open = findOpenShard(db, logicalMarketId);
  if (open && shardHasRoom(open, shardStakes(db, open.shard_market_id), nextStakeSompi)) {
    return { action: 'use', shard: open };
  }
  const nextIndex = maxShardIndex(db, logicalMarketId) + 1;
  return { action: 'open_new', nextIndex, sealPrevId: open ? open.shard_market_id : null };
}

/**
 * 注册竞态锁: register a freshly-created on-chain shard into the registry.
 * Throws on UNIQUE(logical_market_id, shard_index) — concurrent open_new losers catch this and re-run
 * allocateForRegister (which now sees the winner's open shard). This serializes shard opening across nodes/reqs.
 */
export function registerShard(db, { logicalMarketId, shardIndex, shardMarketId, shardP2sh, currentLeafOutpoint = null, currentLeafState = null, shardRedeemHex = null, nowSec = null }) {
  db.prepare(
    `INSERT INTO market_shards (logical_market_id, shard_index, shard_market_id, shard_p2sh, current_leaf_outpoint, current_leaf_state, shard_redeem_hex, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`
  ).run(logicalMarketId, shardIndex, shardMarketId, shardP2sh, currentLeafOutpoint, currentLeafState ? JSON.stringify(currentLeafState) : null, shardRedeemHex, nowSec);
}

/** Mark the previous open shard sealed when a new shard supersedes it (atomic part of open_new). */
export function sealShard(db, shardMarketId, nowSec = null) {
  db.prepare(`UPDATE market_shards SET status = 'sealed', sealed_at = ? WHERE shard_market_id = ? AND status = 'open'`)
    .run(nowSec, shardMarketId);
}

/**
 * Called AFTER a bettor's side_lock (ShardLeaf register_append 续约) landed (NO TX NO STATE): bump count, recompute
 * projected mass from real on-chain stakes, record the NEW leaf renewal UTXO + state (buildRegisterCommand 下一笔
 * register 要这个), eager-seal if a cap is reached (so findOpenShard skips it next). Atomic transaction.
 * @param {object} [opts] { currentLeafOutpoint:'txid:idx', currentLeafState:{count,local_yes,local_no,pool_value}, nowSec }
 *   — (A) 模型续约: 本笔 register 产的续约 UTXO + state, 下一笔 spliceLeafState 重算 redeem (design (b)). null = 不更新该列.
 * @returns {{ sealed:boolean, bettor_count:number, projected_settle_mass:number }}
 */
export function onBettorRegistered(db, shardMarketId, opts = {}) {
  const { currentLeafOutpoint = null, currentLeafState = null, nowSec = null } = (typeof opts === 'number' ? { nowSec: opts } : opts);   // back-compat: 旧 positional nowSec
  const tx = db.transaction(() => {
    const s = db.prepare(`SELECT * FROM market_shards WHERE shard_market_id = ?`).get(shardMarketId);
    if (!s) throw new Error(`market_shards: no registry row for shard ${shardMarketId}`);
    const stakes = shardStakes(db, shardMarketId);          // = real landed stakes (count already reflects this bet)
    const newCount = stakes.length;
    const projMass = projectShardSettleMass(stakes);
    const seal = (newCount >= SHARD_SEAL_COUNT) || (projMass > SHARD_MASS_CEILING);
    db.prepare(
      `UPDATE market_shards SET bettor_count = ?, projected_settle_mass = ?, status = ?, sealed_at = ?,
         current_leaf_outpoint = COALESCE(?, current_leaf_outpoint), current_leaf_state = COALESCE(?, current_leaf_state)
       WHERE shard_market_id = ?`
    ).run(newCount, projMass, seal ? 'sealed' : s.status, seal ? nowSec : s.sealed_at,
      currentLeafOutpoint, currentLeafState ? JSON.stringify(currentLeafState) : null, shardMarketId);
    return { sealed: seal, bettor_count: newCount, projected_settle_mass: projMass };
  });
  return tx();
}

/** All shards of a logical market in canonical fold order (shard_index ASC) — for fold调度 by-root + UI aggregation. */
export function listShards(db, logicalMarketId) {
  return db.prepare(`SELECT * FROM market_shards WHERE logical_market_id = ? ORDER BY shard_index ASC`).all(logicalMarketId);
}

// re-export the safe threshold so callers can sanity-check SHARD_MASS_CEILING < STORAGE_MASS_SAFE_THRESHOLD.
export { STORAGE_MASS_SAFE_THRESHOLD };
