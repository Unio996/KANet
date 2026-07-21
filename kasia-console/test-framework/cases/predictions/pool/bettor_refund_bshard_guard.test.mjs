// Regression guard: bettor-refund-claim #33/#34 bshard-detect safety net (线8, 2026-06-25)
//
// J1 红队 finding (2026-06-25, §11 裁决 Bettor 认错 + KANet-UI/J2 co-verify, ANTI-PATTERNS 规则 50):
// the POST /api/pool/market/:id/bettor-refund-claim endpoint MUST NOT be "shard-aware"-migrated.
// bshard (register-v07) bettors have NO standalone refundable PoolSide — their side row carries the
// SHARED shard pool P2SH + side_redeem_script_hex='' + market_id=shard_market_id; the stake is in the
// fold pool, refundable only via PoolShard_fold refund_draw (lib/pool-refund-builder.mjs). Making the
// lookup cross-shard would route a bshard bettor's refund at the aggregate shard pool. The fix = explicit
// bshard-detect → 409 reject. This case locks the guard's detect SQL (byte-identical to pool.js): it MUST
// fire for a bshard market (queried by logical OR shard id) and MUST NOT fire for a v0.5 non-bshard market
// (the path that refunded 5,608.8 KAS — must stay open).
//
// The guard reads ONLY market_shards, so this case seeds only that table (full deterministic control of
// the detect behavior). The bshard-side SHAPE proof (empty redeem / shard-aware-would-find-it / v0.5 side
// stays refundable) lives in the self-contained scripts/j1-refund-bshard-guard-test.mjs (temp DB, 8/8).
//
// Offline: exec_sql fixtures + read-only query_db + teardown. No server, no chain, no relay.

const BSHARD_L = '__test_refund_guard_bshard_logical__';
const BSHARD_S = '__test_refund_guard_bshard_shard0__';
const V05_L = '__test_refund_guard_v05_logical__';

// Byte-identical to the guard in pool.js bettor-refund-claim.
const GUARD_SQL = 'SELECT 1 FROM market_shards WHERE logical_market_id = ? OR shard_market_id = ? LIMIT 1';

export default {
  id: 'bettor_refund_bshard_guard',
  description: '线8 #33/#34: bettor-refund-claim bshard-detect guard fires for bshard, not for v0.5',
  domain: 'predictions',
  tags: ['regression', 'bshard', 'refund', 'money-adjacent', 'offline'],
  skip_in_batch: false,

  steps: [
    // ── pre-clean (idempotent: clear leftover from a crashed prior run) ──
    { id: 'pre_clean_shards', action: 'exec_sql', sql: `DELETE FROM market_shards WHERE logical_market_id = '${BSHARD_L}'` },
    { id: 'pre_clean_market', action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '${BSHARD_S}'` },

    // ── setup: shard's pool_markets row (FK: market_shards.shard_market_id REFERENCES pool_markets(id)) ──
    // Fills pool_markets NOT-NULL-no-default cols: maker_relay_id, spine_p2sh, market_metadata_hash, deadline.
    { id: 'seed_shard_market', action: 'exec_sql',
      sql: `INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline) VALUES ('${BSHARD_S}', 'testrelay', 'kaspatest:spine', 'abcd', 1780000000)` },

    // ── setup: one bshard shard child (only market_shards is what the guard reads) ──
    // All NOT-NULL-no-default cols filled: logical_market_id, shard_index, shard_market_id, shard_p2sh.
    { id: 'seed_market_shards', action: 'exec_sql',
      sql: `INSERT INTO market_shards (logical_market_id, shard_index, shard_market_id, shard_p2sh) VALUES ('${BSHARD_L}', 0, '${BSHARD_S}', 'kaspatest:sharedshardp2sh')` },

    // ── assert: guard FIRES for bshard by LOGICAL id (isBshard truthy → endpoint 409 reject) ──
    { id: 'guard_fires_bshard_logical', action: 'query_db', sql: GUARD_SQL, params: [BSHARD_L, BSHARD_L],
      expect: { must: { rows_min: 1 } } },

    // ── assert: guard FIRES for bshard by SHARD id (bettor passing a shard id is also caught) ──
    { id: 'guard_fires_bshard_shard', action: 'query_db', sql: GUARD_SQL, params: [BSHARD_S, BSHARD_S],
      expect: { must: { rows_min: 1 } } },

    // ── assert: guard does NOT fire for v0.5 non-bshard (db_row_count exactly 0 → endpoint proceeds) ──
    { id: 'guard_silent_v05', action: 'query_db', sql: GUARD_SQL, params: [V05_L, V05_L],
      expect: { must: { db_row_count: 0 } } },

    // ── teardown (market_shards first — FK child — then pool_markets) ──
    { id: 'clean_shards', action: 'exec_sql', sql: `DELETE FROM market_shards WHERE logical_market_id = '${BSHARD_L}'` },
    { id: 'clean_market', action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '${BSHARD_S}'` },
  ],
};
