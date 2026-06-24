// pool-bettor-sides-query.mjs — shard-aware helper functions for pool_bettor_sides queries
//
// Rationale (线8 STEP2, 2026-06-24):
// bshard register-v07 stores bettor sides under shard_market_id (not logical_market_id).
// Bare `WHERE market_id = logicalId` queries miss all bshard sides → display 0 / refund 404.
//
// Two distinct access patterns exist — DO NOT unify into one:
//   getSidesByLogicalMarket → cross-shard aggregation (display counts, settler, refund lookup)
//   getSidesByShard         → single-shard access (shard-allocator, shard-level operations)
//
// Escape hatch for callers that intentionally use the raw shard ID:
//   Call getSidesByShard(shardMarketId, db) explicitly — name makes intent visible.

// ────────────────────────────────────────────────────────────────────────────
// getSidesByLogicalMarket
// Returns ALL pool_bettor_sides rows for a logical market:
//   - v06 anonymous path: bettor stored directly under logicalMarketId
//   - bshard path: bettor stored under shard_market_id (one row per shard of this market)
// SQL: logical direct union shard subquery (non-overlapping: a market is either bshard OR v06,
// never both, so OR logic produces correct set with no duplicates).
// ────────────────────────────────────────────────────────────────────────────
export function getSidesByLogicalMarket(logicalMarketId, db) {
  return db.prepare(`
    SELECT pbs.* FROM pool_bettor_sides pbs
    WHERE pbs.market_id = ?
       OR pbs.market_id IN (
         SELECT shard_market_id FROM market_shards WHERE logical_market_id = ?
       )
  `).all(logicalMarketId, logicalMarketId);
}

// ────────────────────────────────────────────────────────────────────────────
// getSidesByShard
// Returns pool_bettor_sides rows for ONE specific shard_market_id.
// Use when you already have the concrete shard ID (e.g. shard-allocator, per-shard settler).
// This is the existing correct pattern — expose it explicitly so callers name their intent.
// ────────────────────────────────────────────────────────────────────────────
export function getSidesByShard(shardMarketId, db) {
  return db.prepare(
    'SELECT * FROM pool_bettor_sides WHERE market_id = ?'
  ).all(shardMarketId);
}

// ────────────────────────────────────────────────────────────────────────────
// getSideByBettorPk
// Finds a single side row by bettor public key within a logical market (cross-shard aware).
// Used by: bettor-refund-claim endpoint (L2730-2733 migration target — clear-headed pass).
// ────────────────────────────────────────────────────────────────────────────
export function getSideByBettorPk(logicalMarketId, bettorPk, db) {
  return db.prepare(`
    SELECT pbs.* FROM pool_bettor_sides pbs
    WHERE (
      pbs.market_id = ?
      OR pbs.market_id IN (SELECT shard_market_id FROM market_shards WHERE logical_market_id = ?)
    )
    AND lower(pbs.bettor_pk) = ?
  `).get(logicalMarketId, logicalMarketId, bettorPk.toLowerCase());
}

// ────────────────────────────────────────────────────────────────────────────
// getSideById
// Finds a single side row by id, validated against a logical market (cross-shard aware).
// Used by: bettor-refund-claim endpoint (L2724-2728 migration target — clear-headed pass).
// ────────────────────────────────────────────────────────────────────────────
export function getSideById(sideId, logicalMarketId, db) {
  return db.prepare(`
    SELECT pbs.* FROM pool_bettor_sides pbs
    WHERE pbs.id = ?
      AND (
        pbs.market_id = ?
        OR pbs.market_id IN (SELECT shard_market_id FROM market_shards WHERE logical_market_id = ?)
      )
  `).get(sideId, logicalMarketId, logicalMarketId);
}
