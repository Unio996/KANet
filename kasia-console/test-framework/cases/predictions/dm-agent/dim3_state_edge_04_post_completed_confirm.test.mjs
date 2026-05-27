// Dim 3.4 — /confirm on already-completed market → graceful error "offer completed".
// Verifies handler reads protocol_status fresh each command (= J2 R1 stateless principle).
// pending_dep: ui_baea285_handler + real_chain_market_create

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim3_state_edge_04_post_completed_confirm',
  description: 'Dim 3.4: /confirm on settled market → error "completed" reply, 0 mutation',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim3', 'edge', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher', 'real_chain_market_create'],
  skip_in_batch: true,
  steps: [
    {
      action: 'query_db',
      sql: `SELECT id FROM pool_markets WHERE settle_txid IS NOT NULL OR protocol_status='completed' ORDER BY created_at DESC LIMIT 1`,
      save_as: 'completed_market',
      expect: { must: { rows_min: 1 } },
    },
    { action: 'todo', note: 'preload prediction_dm_session pointing at completed_market.id with STATE:CONFIRM_STAKE' },
    {
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/agent/reply`,
      body: { relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}', peer: '${env.TEST_USER_ADDR}', message: '/confirm' },
      expect: {
        must: {
          http_status: 200,
          reply_contains_one_of: ['completed', 'settled', 'closed', '已结', '已完'],
          reply_does_not_contain: ['stake_lock', 'publish-v2', 'Unhandled'],
        },
      },
    },
    {
      // No new pool_bettor_sides row created (handler refused stale-state /confirm)
      action: 'query_db',
      sql: `SELECT COUNT(*) AS c FROM pool_bettor_sides WHERE bettor_pk=? AND market_id=? AND created_at > datetime('now', '-30 seconds')`,
      params: ['${env.TEST_USER_PK}', '${completed_market.id}'],
      expect: { must: { row_field_equals: { c: 0 } } },
    },
  ],
};
