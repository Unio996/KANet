// Dim 7.4 (J1 #59c add) — 24h soak: 5 users × cycles + Console restart 5× + Scout restart 4× +
// audit checkpoint each hour. End-state: 0 corruption + audit trace count == chain_events count.
//
// This case is the soak runner entry point. It does NOT run inside scripts/test.mjs default batch.
// Operator hat invokes: `node test-framework/cases/predictions/dm-agent/soak_runner.mjs`.
// This .test.mjs is a placeholder for the runner discoverability.

export default {
  id: 'dim7_audit_04_24h_soak',
  description: 'Dim 7.4: 24h soak — 5 user × cycles + restarts; 0 corruption + audit count matches',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim7', 'audit', 'soak', '24h', 'ship_block', 'j1_59c_add', 'manual_only'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher', 'real_chain_market_create'],
  skip_in_batch: true,
  steps: [
    {
      action: 'todo',
      note: 'invoke: node kasia-console/test-framework/cases/predictions/dm-agent/soak_runner.mjs '
          + '(separate long-running process, NOT a step inside test runner). Verdict file at logs/soak-verdict.json.',
    },
    {
      action: 'todo',
      note: 'on completion: assert verdict.audit_count == verdict.chain_events_count + 0 db_corruption '
          + '+ all 5 users have non-null balance_diff_sompi on at least 1 settled market.',
    },
  ],
};
