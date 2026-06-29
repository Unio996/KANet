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

// ────────────────────────────────────────────────────────────────────────────
// getMarketBets — SHARD-AWARE 单源 for settler/daemon BET-COUNT/POOL/PAYOUT reads (S1, 2026-06-29).
//
// 🔴 根治 shard-blind bug (今晚 3 现形·同根因 = settler/cron 裸读 logical pool_bettor_sides):
//   ① gather 4-vs-2 maker_stake 杂质  ② MIN_POT bettorSum=0 侥幸过  ③ 退款 cron 误判 0-bet 翻 status=refunding。
//   根因: bshard register-v07 押注存 shard_market_id 键·裸 `WHERE market_id=logicalId` 漏全部 shard 押注 → 返 0/错。
//
// 🔴 为何 v07 用 shard-only 而【非】getSidesByLogicalMarket(union):
//   getSidesByLogicalMarket 含 logical 键的 maker_stake(f5bb64c6 = B-model maker bond·非池) + commingled v06 bet
//   (ioaoc f5bb64c6 34KAS) → bshard 池被污染 (今晚 gather 4-vs-2 实证·on-chain bets_root 只 fold shard 押注)。
//   ∴ bshard 池/payout 真集 = shard-key only。commingled v06 bet 走 S5 入口检测 (daemon 跳过)·非混进池。
//
// 用法: const { bets, betCount, poolSompi, isBshard, multiShard } = getMarketBets(logicalMarketId, db);
//   bets = [{ pk, stake, direction }] (stake/direction normalized)·poolSompi = Σstake (BigInt string)。
//   multiShard>0 → 多片 rolling shard (production fold 路·caller 须 fold per-shard·非单读)。
// 所有 settler/daemon 的 bet-count/pool/payout 读必经此·禁裸读 logical pool_bettor_sides 聚合 (lint-kanet 堵)。
// ────────────────────────────────────────────────────────────────────────────
export function getMarketBets(logicalMarketId, db) {
  const mkt = db.prepare('SELECT protocol_version FROM pool_markets WHERE id = ?').get(logicalMarketId);
  const isBshard = !!mkt && String(mkt.protocol_version || '').startsWith('v0.7');

  let rows;
  let multiShard = 0;
  if (isBshard) {
    // v07 bshard: 押注在 shard_market_id 键·只取 shard (排 maker_stake/commingled 杂质)。
    const shards = db.prepare(
      'SELECT shard_market_id FROM market_shards WHERE logical_market_id = ? ORDER BY shard_index'
    ).all(logicalMarketId);
    if (shards.length === 0) { rows = []; }
    else if (shards.length > 1) { multiShard = shards.length; rows = []; }   // 多片 = fold 路·caller 处理
    else { rows = getSidesByShard(shards[0].shard_market_id, db); }
  } else {
    // v06 anonymous: 押注直接在 logical 键 (保旧·v06 PoolSide 模型独立)。
    rows = db.prepare('SELECT * FROM pool_bettor_sides WHERE market_id = ?').all(logicalMarketId);
  }

  const bets = rows.map((r) => ({ pk: String(r.bettor_pk), stake: String(r.stake_amount), direction: Number(r.direction) }));
  const poolSompi = bets.reduce((s, b) => s + BigInt(b.stake || 0), 0n).toString();
  return { bets, betCount: bets.length, poolSompi, isBshard, multiShard };
}
