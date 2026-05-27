// Dim 4.3 — unicode flood ("💩" × 2000) → handler graceful truncate or reject, 0 server crash.
// pending_dep: ui_baea285_handler

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim4_invalid_input_03_unicode_flood',
  description: 'Dim 4.3: DM 2000-emoji flood → graceful truncate/reject (no 500, no crash)',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim4', 'security', 'fuzz', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher'],
  skip_in_batch: true,
  steps: [
    {
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/agent/reply`,
      body: {
        relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}',
        peer: '${env.TEST_USER_ADDR}',
        message: '💩'.repeat(2000),
      },
      timeout_ms: 10000,
      expect: {
        must: {
          // 200 OK with truncate OR 4xx graceful refuse — both acceptable, but NOT 5xx.
          http_status_one_of: [200, 400, 413, 422],
          reply_does_not_contain: ['Unhandled', 'TypeError', 'stack trace'],
        },
      },
    },
    {
      // Console alive next request after flood (= no leaked file descriptor / hang)
      action: 'http_get',
      url: `${TN12_CONSOLE}/api/audit/prediction-trace-summary`,
      expect: { must: { http_status: 200 } },
    },
  ],
};
