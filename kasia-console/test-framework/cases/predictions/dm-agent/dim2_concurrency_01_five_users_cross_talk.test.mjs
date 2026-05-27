// Dim 2.1 — 5 distinct users DM "/predict" within 1 sec; each gets correct response addressed to themselves.
// Validates dispatcher routes by peer + handler reads sender_address fresh per call.
// pending_dep: ui_baea285_handler + nwt_27aa21a_dispatcher

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim2_concurrency_01_five_users_cross_talk',
  description: 'Dim 2.1: 5 concurrent users /predict → 5 distinct replies, 0 cross-talk leak',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim2', 'concurrent', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher'],
  skip_in_batch: true,
  steps: [
    {
      action: 'parallel',
      actions: Array.from({ length: 5 }).map((_, i) => ({
        action: 'http_post',
        url: `${TN12_CONSOLE}/api/agent/reply`,
        body: {
          relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}',
          peer: `${'${env.CONCUR_USER_'}${i}}`,
          message: '/predict',
        },
      })),
      expect: {
        must: {
          // Each of 5 must return 200; no two replies should reference the same other user's address.
          // (Runner assertion 'parallel_all_status_200' + 'parallel_no_cross_leak' to be added in lib.)
          row_assert: { 'results.length': 5 },
        },
      },
    },
  ],
};
