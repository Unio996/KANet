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
//
// excludeSideLockTx (optional, 2026-07-11, 28mln shard9 phantom-leaf recovery, docs/2026-07-10-
//   shard9-recovery-design.md): array of side_lock_tx (bettor payment txid, chain-anchored) to
//   exclude from the result. Default null/empty = current behavior, zero change for every existing
//   caller. Filters on side_lock_tx (NOT the local `id` primary key) because enforceCloseAttest runs
//   independently per committee-voter node (separate machines, no shared filesystem/DB) — a local
//   SQLite id is insert-order-dependent per node and would NOT identify the same row across nodes;
//   side_lock_tx is a chain value and is identical everywhere.
// ────────────────────────────────────────────────────────────────────────────
export function getSidesByShard(shardMarketId, db, excludeSideLockTx = null) {
  if (excludeSideLockTx && excludeSideLockTx.length) {
    const placeholders = excludeSideLockTx.map(() => '?').join(',');
    return db.prepare(
      `SELECT * FROM pool_bettor_sides WHERE market_id = ? AND side_lock_tx NOT IN (${placeholders}) ORDER BY id ASC`
    ).all(shardMarketId, ...excludeSideLockTx);
  }
  return db.prepare(
    'SELECT * FROM pool_bettor_sides WHERE market_id = ? ORDER BY id ASC'
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
//
// excludeSideLockTx (optional, 2026-07-11, 28mln shard9 phantom-leaf recovery): see getSidesByShard
// doc above — threaded through unchanged to every getSidesByShard call. Applying the same set across
// all shards of a multi-shard market is safe: a txid absent from a given shard simply matches nothing
// there (no-op), so this only affects the shard(s) that actually contain those side_lock_tx values.
// ────────────────────────────────────────────────────────────────────────────
export function getMarketBets(logicalMarketId, db, excludeSideLockTx = null) {
  const mkt = db.prepare('SELECT protocol_version FROM pool_markets WHERE id = ?').get(logicalMarketId);
  const isBshard = !!mkt && String(mkt.protocol_version || '').startsWith('v0.7');

  let rows;
  let multiShard = 0;
  if (isBshard) {
    // v07 bshard: 押注在 shard_market_id 键·只取 shard (排 maker_stake/commingled 杂质)。
    // manual_recovery_refunded(2026-07-06, lv3rz shard6 phantom-leaf 事故同款排除·见 pool-shard-settle.mjs
    // consolidateAllShards 同一次改动): 这个 shard 的 stake 已经手动退还给 bettor, 不再是池子里的钱,
    // 必须排除, 否则总池计算会比链上 PayoutShard 实际值多出这个 shard 的金额(守恒对不上)。
    const shards = db.prepare(
      "SELECT shard_market_id FROM market_shards WHERE logical_market_id = ? AND status != 'manual_recovery_refunded' ORDER BY shard_index"
    ).all(logicalMarketId);
    if (shards.length === 0) { rows = []; }
    else if (shards.length > 1) {
      // 多片 rolling shard fold-gather (J2 2026-06-30 Phase 1·Owner 钦定装配无限+ZK):
      //   union 跨全片 getSidesByShard (每注属唯一 shard_market_id·无重叠·nnd1g 实证 52=32+20 distinct overlap=0)。
      //   settle 需全片 winner 全进 payoutRoot (命门·四源 co-verify Σ各片 winner 无掉片)。multiShard 保留作 info。
      multiShard = shards.length;
      rows = shards.flatMap((s) => getSidesByShard(s.shard_market_id, db, excludeSideLockTx));
    }
    else { rows = getSidesByShard(shards[0].shard_market_id, db, excludeSideLockTx); }
  } else {
    // v06 anonymous: 押注直接在 logical 键 (保旧·v06 PoolSide 模型独立)。
    rows = db.prepare('SELECT * FROM pool_bettor_sides WHERE market_id = ?').all(logicalMarketId);
  }

  const bets = rows.map((r) => ({ pk: String(r.bettor_pk), stake: String(r.stake_amount), direction: Number(r.direction) }));
  const poolSompi = bets.reduce((s, b) => s + BigInt(b.stake || 0), 0n).toString();
  return { bets, betCount: bets.length, poolSompi, isBshard, multiShard };
}
