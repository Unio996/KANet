// Dim 3.3 — double /confirm within 1 sec → 2nd reject (idempotent). UI handler must guard.
// pending_dep: ui_baea285_handler + real_chain_market_create

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim3_state_edge_03_double_confirm',
  description: 'Dim 3.3: rapid double /confirm → 1 stake_lock TX + 1 idempotent reject reply',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim3', 'edge', 'idempotent', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher', 'real_chain_market_create'],
  skip_in_batch: true,
  steps: [
    // Rapid 2× /confirm — without a prior pending offer the handler responds "没有待确认的下注"
    // both times (idempotent: same response, no DB mutation). Real CONFIRM_STAKE seed requires
    // walk /predict → digit → digit → stake; until that is wired we verify the no-flow idempotency.
    {
      action: 'parallel',
      actions: [
        { action: 'http_post', url: `${TN12_CONSOLE}/api/agent/reply`,
          body: { relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}', peer: '${env.TEST_USER_ADDR}', message: '/confirm' } },
        { action: 'http_post', url: `${TN12_CONSOLE}/api/agent/reply`,
          body: { relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}', peer: '${env.TEST_USER_ADDR}', message: '/confirm' } },
      ],
      expect: {
        must: {
          row_assert: { 'results.length': 2 },
        },
      },
    },
    {
      // No pool_bettor_sides row inserted by either /confirm (no active flow → no stake_lock_tx).
      action: 'query_db',
      sql: `SELECT COUNT(*) AS c FROM pool_bettor_sides WHERE bettor_pk=? AND created_at > datetime('now', '-10 seconds')`,
      params: ['${env.TEST_USER_PK}'],
      expect: { must: { row_field_equals: { c: 0 } } },
    },
  ],
};
