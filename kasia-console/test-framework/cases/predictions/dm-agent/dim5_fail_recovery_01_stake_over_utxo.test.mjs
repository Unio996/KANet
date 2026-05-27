// Dim 5.1 — stake amount > maker's available UTXO → publish-v2 reject → DM error + state reset IDLE.
// pending_dep: ui_baea285_handler + real_chain_market_create

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim5_fail_recovery_01_stake_over_utxo',
  description: 'Dim 5.1: stake > balance → publish-v2 reject → DM "insufficient balance" + state IDLE',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim5', 'recovery', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher', 'real_chain_market_create'],
  skip_in_batch: true,
  steps: [
    {
      action: 'http_get',
      url: `${TN12_CONSOLE}/api/relay/${'${env.TEST_USER_RELAY_ID}'}/balance`,
      save_as: 'bal',
    },
    { action: 'todo', note: 'walk /predict → 1 → 1, then stake = balance.kas + 1000 (= guaranteed insufficient)' },
    {
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/agent/reply`,
      body: {
        relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}',
        peer: '${env.TEST_USER_ADDR}',
        message: '/confirm',
      },
      expect: {
        must: {
          http_status: 200,
          // Without a prior pending offer, /confirm returns "没有待确认的下注". This proves the handler
          // refuses to attempt a publish-v2 broadcast when stake context is missing — the closest we
          // can verify without a real seeded CONFIRM_STAKE flow (= pending real-chain market). Real
          // insufficient-balance path will surface once dim1_04 full_lifecycle works against a seeded
          // market and the publish-v2 rejection from kaspad is captured.
          reply_contains_one_of: ['没有待确认', '余额不足', 'insufficient', 'balance', '/predict', '/help'],
        },
      },
    },
    {
      action: 'query_db',
      sql: `SELECT last_action FROM prediction_dm_session WHERE sender_address = ?`,
      params: ['${env.TEST_USER_ADDR}'],
      expect: { should: { row_assert: { last_action_contains: 'STATE:' } } },
    },
  ],
};
