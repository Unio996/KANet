// Dim 1.1 — /help renders menu (= no DB state needed, smallest happy probe).
// Verifies dispatcher routes "/" prefix → UI handler → returns menu text.
// pending_dep: ui_baea285_handler + nwt_27aa21a_dispatcher

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim1_navigation_01_help',
  description: 'Dim 1.1: DM "/help" → prediction-agent menu rendered',
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
        message: '/help',
      },
      timeout_ms: 8000,
      expect: {
        must: {
          http_status: 200,
          response_has_keys: ['reply'],
          reply_contains_one_of: ['/predict', '/help', '菜单', 'menu'],
          reply_does_not_contain: ['Unhandled', 'undefined', 'TypeError'],
        },
      },
    },
  ],
};
