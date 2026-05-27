// Dim 5.4 — mempool already-spent UTXO race: user's stake UTXO consumed by other parallel TX
// between publish-v2 dry-run and broadcast → handler retries with fresh UTXO → eventually succeeds.
// pending_dep: ui_baea285_handler + real_chain_market_create

export default {
  id: 'dim5_fail_recovery_04_mempool_race',
  description: 'Dim 5.4: UTXO already-spent error → publish-v2 retry → success after UTXO release',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim5', 'recovery', 'real_chain', 'race', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher', 'real_chain_market_create'],
  skip_in_batch: true,
  steps: [
    { action: 'todo', note: 'setup: user has 2 UTXOs (each > stake size).  Fire 2 parallel actions: (a) /confirm stake, '
        + '(b) /api/relay/.../transfer to drain 1 UTXO. mempool will mark consumed → publish-v2 first try sees already_spent.' },
    { action: 'todo', note: 'assert: handler retries with remaining UTXO → eventually pool_bettor_sides row inserts within 30s' },
    {
      action: 'wait_for_db_row',
      sql: `SELECT id FROM pool_bettor_sides WHERE bettor_pk=? AND created_at > datetime('now','-60 seconds') LIMIT 1`,
      params: ['${env.TEST_USER_PK}'],
      timeout_ms: 60000,
      poll_ms: 3000,
      expect: { must: { found: true } },
    },
  ],
};
