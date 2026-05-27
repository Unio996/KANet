// Dim 6.4 (J1 #59c add) — market started at protocol v0.3-full; mid-cycle config switches to v0.3-mid-a.
// Verify settler.js dispatch branch picks the right spec for the started market (= 不 cross-contaminate).
// pending_dep: ui_baea285_handler + real_chain_market_create

export default {
  id: 'dim6_race_04_protocol_version_migrate',
  description: 'Dim 6.4: market in flight + protocol_version cfg change → settler dispatches correct branch',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim6', 'race', 'real_chain', 'protocol_version', 'ship_block', 'j1_59c_add', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'real_chain_market_create'],
  skip_in_batch: true,
  steps: [
    { action: 'todo', note: 'pre: market m1 created at v0.3-full; entered MATCHED' },
    { action: 'todo', note: 'change env PREDICTION_PROTOCOL_VERSION=v0.3-mid-a; restart Console (live config drift)' },
    { action: 'todo', note: 'create market m2 at v0.3-mid-a; both m1 + m2 deadline arrive' },
    { action: 'todo', note: 'assert: m1 settle uses v0.3-full dispatch branch (settler.js consensual phase 2 ConsensualSS path), '
        + 'm2 uses v0.3-mid-a branch. Cross-contamination = state corrupt (= test FAIL).' },
    {
      action: 'query_db',
      sql: `SELECT id, protocol_status, settle_txid FROM pool_markets
            WHERE id IN (?, ?)`,
      params: ['${env.MIGRATE_M1_ID}', '${env.MIGRATE_M2_ID}'],
      expect: { must: { rows_min: 2 } },
    },
  ],
};
