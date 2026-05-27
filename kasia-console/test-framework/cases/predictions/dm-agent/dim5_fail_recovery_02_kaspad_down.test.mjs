// Dim 5.2 — kaspad RPC unreachable mid /confirm → publish-v2 timeout → DM "chain unavailable, /retry".
// Simulated by setting KASPA_RPC_URL to invalid endpoint OR pause kaspad process via ops API.
// pending_dep: ui_baea285_handler + nwt_27aa21a_dispatcher

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim5_fail_recovery_02_kaspad_down',
  description: 'Dim 5.2: kaspad RPC down → /confirm timeout → DM "/retry" hint, 0 partial state',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim5', 'recovery', 'real_chain', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher', 'real_chain_market_create'],
  skip_in_batch: true,
  steps: [
    { action: 'todo', note: 'pre: pause kaspa-ws-proxy OR set RELAY env KASPA_RPC_URL to 127.0.0.1:1 (loopback to nothing)' },
    { action: 'todo', note: 'walk /predict → 1 → 1 → 10 → /confirm' },
    {
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/agent/reply`,
      body: { relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}', peer: 'kaspatest:dim5_02_' + Date.now(), message: '/confirm' },
      timeout_ms: 30_000,
      expect: {
        must: {
          http_status: 200,
          // No active pending flow → handler returns "没有待确认的下注" rather than attempting a
          // broadcast against the (simulated) down kaspad. The kaspad-down assertion path itself
          // is pending real_chain_market_create + a controllable kaspad pause endpoint.
          reply_contains_one_of: ['没有待确认', 'unavailable', 'retry', 'timeout', 'chain', '/predict'],
        },
      },
    },
    { action: 'todo', note: 'post: restore kaspad; verify next /retry succeeds (= recovery actually works)' },
  ],
};
