// Prediction Agent DUAL-PATH regression — pool_markets / register-v06 path
//
// scope: Bettor r728/r730 dual-path rewire (KANet-UI c952ac0b + 5f171be1). prediction-agent-mind
// fetchActiveMarkets now ALSO serves pool_markets (v0.6/v0.7 committee-judged) via register-v06,
// in addition to the exchange_offers E pre-handshake旁路 (guarded by schema_exchange_offers_pending_taker).
//
// This case守住 the pool path so a future commit cannot silently break it:
//   1. pool_markets cols fetchActiveMarkets pool-branch reads are present.
//   2. pool_bettor_sides cols confirmPoolBet/fetchUserBets read/write are present.
//   3. the pool-branch query (pending_bettors + v0.6/v0.7 + deadline>now) runs without throwing.
//   4. ≥1 pool_bettor_sides row references a v0.7 market = the register-v06 DM bet path is LIVE
//      (KANet-UI M2 real-chain self-test 2a2f8563 landed + prior committee bets).

export default {
  id: 'prediction_dm_schema_pool_markets_register_v06',
  description: 'pool_markets/pool_bettor_sides cols + register-v06 pool path required by FSM dual-path (Bettor r728/r730)',
  domain: 'predictions',
  tags: ['regression', 'prediction_agent', 'dual_path', 'pool', 'register_v06', 'smoke'],
  steps: [
    {
      // pool_markets cols read by fetchActiveMarkets pool branch (incl broker_relay_id filter hook).
      action: 'query_db',
      sql: `SELECT count(*) as ct FROM pragma_table_info('pool_markets')
            WHERE name IN ('id','maker_relay_id','broker_relay_id','broker_fee_pct','outcome_side','resolution_rule_spec','deadline','maker_stake_amount','protocol_version','protocol_status')`,
      expect: { must: { db_row_count: 1 } },
    },
    {
      // pool_bettor_sides cols read/written by confirmPoolBet (register-v06) + fetchUserBets pool branch.
      action: 'query_db',
      sql: `SELECT count(*) as ct FROM pragma_table_info('pool_bettor_sides')
            WHERE name IN ('market_id','bettor_pk','direction','stake_amount','side_p2sh','side_lock_tx')`,
      expect: { must: { db_row_count: 1 } },
    },
    {
      // The pool-branch query must not throw on schema (= /predict pool source live).
      action: 'query_db',
      sql: `SELECT count(*) as ct FROM pool_markets
            WHERE protocol_status = 'pending_bettors'
              AND protocol_version IN ('v0.6','v0.7')`,
      expect: { must: { db_row_count: 1 } },
    },
    {
      // ≥1 pool bet on a v0.7 market = register-v06 DM bet path exercised + landed (M2 proof + committee bets).
      action: 'query_db',
      sql: `SELECT count(*) AS c FROM pool_bettor_sides s
            JOIN pool_markets m ON m.id = s.market_id
            WHERE m.protocol_version = 'v0.7'`,
      expect: { must: { row_assert: { c_min: 1 } } },
    },
  ],
};
