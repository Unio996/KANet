// Dim 3.1 — /predict → 1 (SELECT_OUTCOME) → /cancel → state IDLE; 0 offer rows created.
// pending_dep: ui_baea285_handler + nwt_27aa21a_dispatcher

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim3_state_edge_01_cancel_mid_flow',
  description: 'Dim 3.1: /predict → 1 → /cancel mid-flow → state IDLE + 0 pool_bettor_sides',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim3', 'edge', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher'],
  skip_in_batch: true,
  steps: [
    { action: 'http_post', url: `${TN12_CONSOLE}/api/agent/reply`,
      body: { relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}', peer: '${env.TEST_USER_ADDR}', message: '/predict' } },
    { action: 'http_post', url: `${TN12_CONSOLE}/api/agent/reply`,
      body: { relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}', peer: '${env.TEST_USER_ADDR}', message: '1' } },
    { action: 'http_post', url: `${TN12_CONSOLE}/api/agent/reply`,
      body: { relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}', peer: '${env.TEST_USER_ADDR}', message: '/cancel' } },
    {
      action: 'query_db',
      sql: `SELECT last_action FROM prediction_dm_session WHERE sender_address = ?`,
      params: ['${env.TEST_USER_ADDR}'],
      expect: {
        must: {
          row_assert: { last_action_one_of: ['STATE:IDLE', 'STATE:CANCELLED', null] },
        },
      },
    },
    {
      action: 'query_db',
      sql: `SELECT COUNT(*) AS c FROM pool_bettor_sides WHERE bettor_pk=? AND created_at > datetime('now','-30 seconds')`,
      params: ['${env.TEST_USER_PK}'],
      expect: { must: { row_field_equals: { c: 0 } } },
    },
  ],
};
