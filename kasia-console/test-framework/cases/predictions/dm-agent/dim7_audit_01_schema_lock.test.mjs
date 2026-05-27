// Dim 7.1 (J1 #59c add) — schema lock invariants for v147 + audit tables.
// Runs WITHOUT any UI bundle pulled — proves DB-side guarantees are baseline.

export default {
  id: 'dim7_audit_01_schema_lock',
  description: 'Dim 7.1: v147 prediction_dm_session + pool_markets + chain_events schema invariants',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim7', 'audit', 'schema', 'ship_block', 'j1_59c_add', 'dm_agent_now'],
  // No pending_dep — pure schema check.
  steps: [
    // prediction_dm_session: 5 cols + sender_address PK + idx_updated
    {
      action: 'query_db',
      sql: `SELECT count(*) AS c FROM pragma_table_info('prediction_dm_session')`,
      expect: { must: { row_field_equals: { c: 5 } } },
    },
    {
      action: 'query_db',
      sql: `SELECT name FROM pragma_table_info('prediction_dm_session') WHERE pk = 1`,
      expect: {
        must: {
          db_row_count: 1,
          row_field_equals: { name: 'sender_address' },
        },
      },
    },
    // pool_markets: required cols for prediction agent
    {
      action: 'query_db',
      sql: `SELECT name FROM pragma_table_info('pool_markets') WHERE name IN
            ('id','maker_relay_id','outcome_market_source','outcome_condition_id','outcome_side',
             'protocol_status','settle_txid','refund_txid','deadline','maker_stake_amount')`,
      expect: { must: { db_row_count: 10 } },
    },
    // pool_bettor_sides: required cols
    {
      action: 'query_db',
      sql: `SELECT name FROM pragma_table_info('pool_bettor_sides') WHERE name IN
            ('market_id','bettor_pk','bettor_relay_id','direction','stake_amount','claim_txid')`,
      expect: { must: { db_row_count: 6 } },
    },
    // chain_events: required cols + UNIQUE(txid,event_type)
    {
      action: 'query_db',
      sql: `SELECT name FROM pragma_table_info('chain_events') WHERE name IN
            ('id','txid','from_address','to_address','event_type','payload','observed_by','observed_at')`,
      expect: { must: { db_row_count: 8 } },
    },
  ],
};
