// Dim 3.5 — gibberish input after /predict → handler re-renders menu + state preserved (not reset).
// Reproduces baea285 UI's "abc" invalid input behavior (= SELECT_MARKET reset hint, NOT IDLE).
// pending_dep: ui_baea285_handler

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim3_state_edge_05_gibberish_preserves_state',
  description: 'Dim 3.5: gibberish "abc" after /predict → re-render hint, last_action stays SELECT_MARKET',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim3', 'edge', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher'],
  skip_in_batch: true,
  steps: [
    { action: 'http_post', url: `${TN12_CONSOLE}/api/agent/reply`,
      body: { relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}', peer: '${env.TEST_USER_ADDR}', message: '/predict' } },
    { action: 'http_post', url: `${TN12_CONSOLE}/api/agent/reply`,
      body: { relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}', peer: '${env.TEST_USER_ADDR}', message: 'abc' },
      expect: {
        must: {
          reply_contains_one_of: ['SELECT_MARKET', 'choose', 'hint', '请输入', 'pick a market'],
        },
      },
    },
    {
      action: 'query_db',
      sql: `SELECT last_action FROM prediction_dm_session WHERE sender_address = ?`,
      params: ['${env.TEST_USER_ADDR}'],
      expect: {
        must: {
          row_assert: { last_action_contains: 'SELECT_MARKET' },
        },
      },
    },
  ],
};
