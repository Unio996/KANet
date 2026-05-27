// Dim 1.3 — /my_bets on empty user history → graceful + /predict guidance.
// pending_dep: ui_baea285_handler + nwt_27aa21a_dispatcher

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim1_navigation_03_my_bets_empty',
  description: 'Dim 1.3: /my_bets for user with 0 history → /predict hint',
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
        peer: '${env.FRESH_USER_ADDR}',
        message: '/my_bets',
      },
      expect: {
        must: {
          http_status: 200,
          reply_does_not_contain: ['Unhandled', 'TypeError'],
        },
        should: {
          reply_contains_one_of: ['0 history', 'no bets', '/predict', '没'],
        },
      },
    },
  ],
};
