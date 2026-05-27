// Dim 1.5 — /cancel mid-flow resets prediction_dm_session to IDLE (= last_action STATE:IDLE).
// pending_dep: ui_baea285_handler

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim1_navigation_05_cancel_resets_idle',
  description: 'Dim 1.5: /cancel after /predict → state IDLE + 0 offer rows created',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim1', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher'],
  skip_in_batch: true,
  steps: [
    {
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/agent/reply`,
      body: {
        relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}',
        peer: '${env.TEST_USER_ADDR}',
        message: '/predict',
      },
      expect: { must: { http_status: 200 } },
    },
    {
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/agent/reply`,
      body: {
        relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}',
        peer: '${env.TEST_USER_ADDR}',
        message: '/cancel',
      },
      expect: {
        must: {
          http_status: 200,
          reply_contains_one_of: ['cancelled', 'IDLE', 'reset', '取消'],
        },
      },
    },
    {
      action: 'query_db',
      sql: `SELECT last_action FROM prediction_dm_session WHERE sender_address = ?`,
      params: ['${env.TEST_USER_ADDR}'],
      expect: {
        must: {
          rows_min: 1,
          row_assert: {
            last_action_contains: 'STATE:IDLE',
          },
        },
      },
    },
    {
      action: 'query_db',
      sql: `SELECT COUNT(*) AS c FROM pool_bettor_sides WHERE bettor_pk = ? AND created_at > datetime('now', '-1 minute')`,
      params: ['${env.TEST_USER_PK}'],
      expect: { must: { row_field_equals: { c: 0 } } },
    },
  ],
};
