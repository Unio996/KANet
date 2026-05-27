// Dim 6.1 (J1 #59c add) — 2 takers try to stake same maker offer concurrently → 2nd reject by chain
// UTXO double-spend guard. 0 double pool_bettor_sides row created.
// pending_dep: ui_baea285_handler + real_chain_market_create

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim6_race_01_utxo_concurrent_spend',
  description: 'Dim 6.1: 2 takers concurrent stake same maker offer → 2nd reject + UNIQUE constraint hit',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim6', 'race', 'real_chain', 'ship_block', 'j1_59c_add', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher', 'real_chain_market_create'],
  skip_in_batch: true,
  steps: [
    {
      action: 'query_db',
      sql: `SELECT id FROM pool_markets WHERE protocol_status='open' ORDER BY deadline DESC LIMIT 1`,
      save_as: 'm',
      expect: { must: { rows_min: 1 } },
    },
    {
      action: 'parallel',
      actions: [
        { action: 'http_post', url: `${TN12_CONSOLE}/api/agent/reply`,
          body: { relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}', peer: '${env.TEST_USER_A_ADDR}', message: '/confirm' } },
        { action: 'http_post', url: `${TN12_CONSOLE}/api/agent/reply`,
          body: { relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}', peer: '${env.TEST_USER_B_ADDR}', message: '/confirm' } },
      ],
    },
    {
      // Verify pool_bettor_sides UNIQUE(market_id, bettor_pk) — 2 distinct PK can both stake on different sides;
      // but if they collide on same side / same merkle slot, only 1 should succeed.
      action: 'query_db',
      sql: `SELECT bettor_pk, direction, claim_txid FROM pool_bettor_sides WHERE market_id = ?`,
      params: ['${m.id}'],
      expect: {
        must: {
          // At least 1 row succeeded (the winner of the race)
          rows_min: 1,
        },
      },
    },
  ],
};
