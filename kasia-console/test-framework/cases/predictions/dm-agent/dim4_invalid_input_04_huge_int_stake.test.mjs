// Dim 4.4 — huge int stake (10^20) → handler rejects (= stake > available UTXO + numeric overflow guard).
// pending_dep: ui_baea285_handler + real_chain_market_create

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim4_invalid_input_04_huge_int_stake',
  description: 'Dim 4.4: DM stake "99999999999999999999" → reject; numeric overflow + UTXO check',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim4', 'security', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher', 'real_chain_market_create'],
  skip_in_batch: true,
  steps: [
    { action: 'todo', note: 'walk /predict → 1 → 1 → reach SELECT_STAKE' },
    {
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/agent/reply`,
      body: {
        relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}',
        peer: '${env.TEST_USER_ADDR}',
        message: '99999999999999999999',
      },
      expect: {
        must: {
          http_status: 200,
          reply_contains_one_of: ['too large', 'overflow', 'insufficient', 'invalid', '过大'],
          reply_does_not_contain: ['stake_lock', 'broadcast', 'publish-v2'],
        },
      },
    },
  ],
};
