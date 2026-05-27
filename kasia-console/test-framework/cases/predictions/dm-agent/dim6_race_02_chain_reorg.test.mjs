// Dim 6.2 (J1 #59c add) — settle TX broadcast → simulated reorg → orphan TX → settler retry → final accept.
// Tests resilience of state machine to kaspad orphan handling.
// pending_dep: chain_simulate_reorg + ui_baea285_handler

export default {
  id: 'dim6_race_02_chain_reorg',
  description: 'Dim 6.2: simulated reorg orphans settle TX → settler retries → final accept (state recovered)',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim6', 'race', 'real_chain', 'reorg', 'ship_block', 'j1_59c_add', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'real_chain_market_create', 'chain_simulate_reorg'],
  skip_in_batch: true,
  steps: [
    { action: 'todo', note: 'pre: walk full lifecycle to MATCHED → deadline → consensual-confirm → settle TX broadcast' },
    { action: 'todo', note: 'simulate reorg: use kaspad RPC submitTransaction with a competing UTXO spending the same input '
        + '(only possible if reorg control endpoint exists — otherwise mark non-blocking)' },
    { action: 'todo', note: 'assert: settler.js detects orphan + re-broadcasts. final state = completed with NEW settle_txid' },
    {
      action: 'query_db',
      sql: `SELECT settle_txid FROM pool_markets WHERE id = ?`,
      params: ['${env.REORG_TEST_MARKET_ID}'],
      expect: { must: { row_assert: { settle_txid_not_null: true } } },
    },
  ],
};
