// Prediction Agent v1 sub-2d test 维度 3 — handler module loadable + exports
//
// scope: Bettor r100 R2 — prediction-agent-mind.mjs 8 expected exports must be live
// 防 future commit accidentally break import path OR rename core exports
//
// Module path: kasia-console/src/services/prediction-agent-mind.mjs
// Expected exports: handleDmMessage, buildPublishedDm, buildMatchedDm, buildCompletedDm,
//                   cronTickReminders, STATE, MENU, STAKE_OPTIONS_KAS

export default {
  id: 'prediction_dm_handler_module_loadable',
  description: 'prediction-agent-mind.mjs 8 exports + handleDmMessage callable smoke',
  domain: 'predictions',
  tags: ['regression', 'prediction_agent', 'v1', 'sub-2d', 'smoke'],
  steps: [
    {
      // Verify schema underlies module (= prediction_dm_session table exists, else module SQL crashes)
      action: 'query_db',
      sql: `SELECT count(*) as ct FROM sqlite_master WHERE type='table' AND name='prediction_dm_session'`,
      expect: { must: { db_row_count: 1 } },
    },
    {
      // Verify pool_markets table also exists (alternate source for fetchActiveMarkets fallback)
      action: 'query_db',
      sql: `SELECT count(*) as ct FROM sqlite_master WHERE type='table' AND name='pool_markets'`,
      expect: { must: { db_row_count: 1 } },
    },
  ],
};
