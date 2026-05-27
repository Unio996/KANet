// Dim 6.6 (J1 #59c add) — manual SQL UPDATE pool_markets.protocol_status to invalid string →
// DM /status query → handler returns graceful error + state reset, does NOT crash.
// Validates defensive read in UI handler.
// pending_dep: ui_baea285_handler

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim6_race_06_protocol_status_corrupt',
  description: 'Dim 6.6: pool_markets.protocol_status corrupted to "invalid_state" → /status reply graceful',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim6', 'race', 'defensive', 'ship_block', 'j1_59c_add', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher'],
  skip_in_batch: true,
  steps: [
    {
      action: 'query_db',
      sql: `INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_status)
            VALUES (?, ?, ?, ?, ?, 'invalid_state_xyz')`,
      params: [
        'corrupt-test-' + Date.now(),
        '${env.PREDICTION_AGENT_RELAY_ID}',
        'p2sh_placeholder',
        'hash_placeholder',
        Math.floor(Date.now() / 1000) + 3600,
      ],
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
          reply_does_not_contain: ['Unhandled', 'TypeError', 'invalid_state_xyz'],
        },
      },
    },
    {
      // Cleanup: remove the corrupt row
      action: 'query_db',
      sql: `DELETE FROM pool_markets WHERE protocol_status = 'invalid_state_xyz'`,
    },
  ],
};
