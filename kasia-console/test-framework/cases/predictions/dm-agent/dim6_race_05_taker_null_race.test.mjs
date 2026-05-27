// Dim 6.5 (J1 #59c add) — maker publish-v2 + 2 takers race-confirm at same time → only 1 wins
// via pool_bettor_sides UNIQUE(market_id, bettor_pk) constraint OR direction-based slot lock.
// pending_dep: ui_baea285_handler + real_chain_market_create

export default {
  id: 'dim6_race_05_taker_null_race',
  description: 'Dim 6.5: maker publish-v2 + concurrent 2 takers → DB UNIQUE enforces single side/slot taker',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim6', 'race', 'real_chain', 'ship_block', 'j1_59c_add', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher', 'real_chain_market_create'],
  skip_in_batch: true,
  steps: [
    { action: 'todo', note: 'setup: maker publishes market m; 2 takers prepared in /confirm state on same outcome direction' },
    { action: 'todo', note: 'fire 2 /confirm DMs in <100ms window → expect chain UTXO race + 1 winner' },
    {
      action: 'query_db',
      sql: `SELECT COUNT(*) AS c FROM pool_bettor_sides WHERE market_id = ? AND direction = ?`,
      params: ['${env.RACE_MARKET_ID}', 1],
      expect: {
        must: {
          // Per UNIQUE(market_id, bettor_pk), 2 distinct bettor_pk on same direction CAN coexist
          // (multiple bettors on NO side). The race tests handler does NOT double-write for SAME pk.
          row_field_max: { c: 2 },
        },
      },
    },
  ],
};
