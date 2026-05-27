// Dim 1.2 — /predict on empty markets DB → graceful fallback ("0 active markets" + /create hint).
// Reproduces UI baea285 commit 6/6 e2e PASS scenario.
// pending_dep: ui_baea285_handler + nwt_27aa21a_dispatcher

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim1_navigation_02_predict_empty',
  description: 'Dim 1.2: /predict on empty markets → graceful 0 + /create hint',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim1', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher'],
  skip_in_batch: true,
  steps: [
    {
      action: 'query_db',
      sql: `SELECT COUNT(*) AS c FROM pool_markets WHERE protocol_status = 'open'`,
      save_as: 'open_markets',
    },
    {
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/agent/reply`,
      body: {
        relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}',
        peer: '${env.TEST_USER_ADDR}',
        message: '/predict',
      },
      expect: {
        must: {
          http_status: 200,
          response_has_keys: ['reply'],
        },
        should: {
          reply_contains_one_of: ['no active markets', '0 active', '没', '/create'],
        },
      },
    },
  ],
};
