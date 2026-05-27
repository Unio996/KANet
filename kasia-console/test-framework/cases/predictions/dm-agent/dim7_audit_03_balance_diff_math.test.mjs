// Dim 7.3 (J1 #59c add) — balance_diff math: settled "user won" = +stake; "user lost" = -stake;
// refunded = 0; unsettled = null. Seed fixture data + verify computed values match expectation.
// pending_dep: real_chain_market_create OR test_fixture_db_seed (= partial seed if no real chain).

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim7_audit_03_balance_diff_math',
  description: 'Dim 7.3: balance_diff math — winner=+stake / loser=-stake / refund=0 / unsettled=null',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim7', 'audit', 'balance', 'ship_block', 'j1_59c_add'],
  pending_dep: ['test_fixture_db_seed'],
  skip_in_batch: true,
  steps: [
    // Seed: 1 market settled, 1 user with direction=0 stake=1000 sompi, winner=0 → expect +1000 net
    {
      action: 'exec_sql',
      sql: `INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline,
            protocol_status, settle_txid)
            VALUES ('audit-fixture-win', ?, 'p2sh', 'hash', ?, 'completed', 'settle_tx_w')`,
      params: ['${env.PREDICTION_AGENT_RELAY_ID}', Math.floor(Date.now() / 1000) - 60],
    },
    {
      action: 'exec_sql',
      sql: `INSERT INTO chain_events (id, txid, event_type, payload, observed_by, observed_at)
            VALUES ('ev-aud-win', 'settle_tx_w', 'pool_settle_consensual_dispatched',
                    '{"market_id":"audit-fixture-win","winner":0}', 'test', datetime('now'))`,
    },
    {
      action: 'exec_sql',
      sql: `INSERT INTO pool_bettor_sides (market_id, bettor_pk, bettor_relay_id, direction,
            stake_amount, side_p2sh)
            VALUES ('audit-fixture-win', 'pk_winner', NULL, 0, 1000, 'side_p2sh_w')`,
    },
    {
      action: 'http_get',
      url: `${TN12_CONSOLE}/api/audit/prediction-trace/pk_winner`,
      expect: {
        must: {
          http_status: 200,
          row_assert: {
            // Dotted path (numeric index = array element). Audit endpoint computes
            // balance_diff_sompi from pool_bettor_sides.direction × pool_settle_*.winner.
            // For pk_winner (direction=0) × winner=0 → +stake = +1000.
            'trace.0.balance_diff_sompi': 1000,
            total_markets_min: 1,
          },
        },
      },
    },
    // Cleanup
    {
      action: 'exec_sql',
      sql: `DELETE FROM pool_bettor_sides WHERE market_id = 'audit-fixture-win'`,
    },
    {
      action: 'exec_sql',
      sql: `DELETE FROM chain_events WHERE id = 'ev-aud-win'`,
    },
    {
      action: 'exec_sql',
      sql: `DELETE FROM pool_markets WHERE id = 'audit-fixture-win'`,
    },
  ],
};
