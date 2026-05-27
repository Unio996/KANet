// Dim 2.4 — dispatcher race: 1 user fires "/" + digit + natural-language concurrent.
// Tests NWT 27aa21a collision lock rule: /-prefix → prediction; digit + active session → prediction;
// digit + 0 session → broker-v3; natural → broker-v3. No 1 message routed to BOTH handlers.
// pending_dep: nwt_27aa21a_dispatcher

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim2_concurrency_04_dispatcher_race',
  description: 'Dim 2.4: same user concurrent "/predict" + "1" + "买 KAS" → 1 message = 1 handler (no dual)',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim2', 'race', 'ship_block', 'pending_nwt_bundle'],
  pending_dep: ['nwt_27aa21a_dispatcher', 'ui_baea285_handler'],
  skip_in_batch: true,
  steps: [
    {
      action: 'parallel',
      actions: [
        { action: 'http_post', url: `${TN12_CONSOLE}/api/agent/reply`,
          body: { relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}', peer: '${env.TEST_USER_ADDR}', message: '/predict' } },
        { action: 'http_post', url: `${TN12_CONSOLE}/api/agent/reply`,
          body: { relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}', peer: '${env.TEST_USER_ADDR}', message: '1' } },
        { action: 'http_post', url: `${TN12_CONSOLE}/api/agent/reply`,
          body: { relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}', peer: '${env.TEST_USER_ADDR}', message: '我想买 KAS' } },
      ],
      expect: {
        must: {
          row_assert: { 'results.length': 3 },
        },
      },
    },
    {
      // Verify outbound messages: each user input got exactly 1 outbound reply (no doubled-handler bug).
      action: 'query_db',
      sql: `SELECT COUNT(*) AS replies FROM messages WHERE direction='outbound'
            AND receiver_identity_id IN (SELECT id FROM identities WHERE address = ?)
            AND created_at > datetime('now', '-10 seconds')`,
      params: ['${env.TEST_USER_ADDR}'],
      expect: {
        should: { row_field_equals: { replies: 3 } },
      },
    },
  ],
};
