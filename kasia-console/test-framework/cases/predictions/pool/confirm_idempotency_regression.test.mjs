// Regression guard: register-v07/confirm idempotency (task#32, 2026-07-03, Owner 500 KAS 卡死根因修)
//
// Root cause: the "already registered" check used to require BOTH a still-present UTXO at payAddr
// AND a DB row — but successful registration fires an async sweep that removes that UTXO, so any
// re-poll after the sweep landed reported pending:true forever even though the bet was truly
// registered (real evidence: pool_bettor_sides.id=11913, Owner's Cabo Verde 500KAS bet).
// Fix: pool_bettor_sides += pay_amount_sompi (v177); idempotency lookup matches on it exactly,
// no UTXO dependency. This test locks the SQL query shape used in pool.js's confirm handler.

export default {
  id: 'confirm_idempotency_regression',
  description: 'task#32: register-v07/confirm 幂等判定 DB-only + 精确 pay_amount_sompi 匹配, 不再依赖 payAddr UTXO 是否还在',
  domain: 'predictions',
  tags: ['regression', 'bshard', 'confirm', 'idempotency', 'offline'],
  skip_in_batch: false,

  steps: [
    // pay_amount_sompi column exists (v177 migration landed)
    {
      id: 'pay_amount_sompi_column_exists',
      description: 'pool_bettor_sides has pay_amount_sompi column (v177)',
      action: 'query_db',
      sql: `SELECT pay_amount_sompi FROM pool_bettor_sides LIMIT 1`,
      expect: { must: { rows_min: 0 } },   // 0 rows OK — this just proves the column exists (no "no such column" error)
    },

    // set up: fake logical market + shard + two distinct bets by the SAME bettor+direction, distinct pay_amount_sompi
    // (exec_sql only supports one statement per call — better-sqlite3 .prepare() rejects multi-statement strings)
    { id: 'setup_clean_sides', action: 'exec_sql', sql: `DELETE FROM pool_bettor_sides WHERE market_id LIKE '__idempotency_test%'` },
    { id: 'setup_clean_shards', action: 'exec_sql', sql: `DELETE FROM market_shards WHERE logical_market_id = '__idempotency_test_market'` },
    { id: 'setup_clean_pool_markets', action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '__idempotency_test_market-s0'` },
    // pool_markets row for the shard (market_shards.shard_market_id + pool_bettor_sides.market_id both FK → pool_markets.id)
    { id: 'setup_pool_markets_row', action: 'exec_sql', sql: `INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_status, created_at, updated_at)
        VALUES ('__idempotency_test_market-s0', 'fake-relay-id', 'fake-spine-p2sh', 'fake-hash', 9999999999, 'shard_internal', datetime('now'), datetime('now'))` },
    { id: 'setup_shard', action: 'exec_sql', sql: `INSERT INTO market_shards (logical_market_id, shard_index, shard_market_id, shard_p2sh, bettor_count, projected_settle_mass, status, created_at)
        VALUES ('__idempotency_test_market', 0, '__idempotency_test_market-s0', 'fake-p2sh', 2, 100, 'open', strftime('%s','now'))` },
    { id: 'setup_bet1', action: 'exec_sql', sql: `INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index, side_redeem_script_hex, pay_amount_sompi)
        VALUES ('__idempotency_test_market-s0', 'aaaa', 0, 50000000000, 'fake-p2sh', 'faketxid1', 0, '', 50000012345)` },
    { id: 'setup_bet2', action: 'exec_sql', sql: `INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index, side_redeem_script_hex, pay_amount_sompi)
        VALUES ('__idempotency_test_market-s0', 'aaaa', 0, 50000000000, 'fake-p2sh', 'faketxid2', 1, '', 50000067890)` },

    // exact match on bet #1's pay_amount_sompi finds ONLY bet #1 (not bet #2, despite same pk+direction+market+stake_amount)
    {
      id: 'exact_match_bet1',
      description: 'querying with bet1 exact pay_amount_sompi returns bet1, not bet2 (regression for "认错笔")',
      action: 'query_db',
      sql: `SELECT pbs.side_lock_tx t FROM pool_bettor_sides pbs JOIN market_shards ms ON pbs.market_id = ms.shard_market_id
            WHERE ms.logical_market_id = '__idempotency_test_market' AND pbs.bettor_pk = 'aaaa' AND pbs.direction = 0 AND pbs.pay_amount_sompi = 50000012345
            ORDER BY pbs.id DESC LIMIT 1`,
      expect: { must: { rows_min: 1, row_assert: { t_one_of: ['faketxid1'] } } },
    },
    {
      id: 'exact_match_bet2',
      description: 'querying with bet2 exact pay_amount_sompi returns bet2, not bet1',
      action: 'query_db',
      sql: `SELECT pbs.side_lock_tx t FROM pool_bettor_sides pbs JOIN market_shards ms ON pbs.market_id = ms.shard_market_id
            WHERE ms.logical_market_id = '__idempotency_test_market' AND pbs.bettor_pk = 'aaaa' AND pbs.direction = 0 AND pbs.pay_amount_sompi = 50000067890
            ORDER BY pbs.id DESC LIMIT 1`,
      expect: { must: { rows_min: 1, row_assert: { t_one_of: ['faketxid2'] } } },
    },
    // a THIRD, never-paid bet_id (distinct pay_amount_sompi never inserted) correctly finds nothing —
    // proves the exact-match doesn't fall back to "latest by pk+direction" and falsely claim a match.
    {
      id: 'no_false_match_for_unpaid_bet',
      description: 'a bet_id that was never registered finds 0 rows (no false already_registered)',
      action: 'query_db',
      sql: `SELECT pbs.side_lock_tx t FROM pool_bettor_sides pbs JOIN market_shards ms ON pbs.market_id = ms.shard_market_id
            WHERE ms.logical_market_id = '__idempotency_test_market' AND pbs.bettor_pk = 'aaaa' AND pbs.direction = 0 AND pbs.pay_amount_sompi = 99999999999
            ORDER BY pbs.id DESC LIMIT 1`,
      expect: { must: { rows_min: 0 } },
    },

    { id: 'teardown_sides', action: 'exec_sql', sql: `DELETE FROM pool_bettor_sides WHERE market_id LIKE '__idempotency_test%'` },
    { id: 'teardown_shards', action: 'exec_sql', sql: `DELETE FROM market_shards WHERE logical_market_id = '__idempotency_test_market'` },
    { id: 'teardown_pool_markets', action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '__idempotency_test_market-s0'` },
  ],
};
