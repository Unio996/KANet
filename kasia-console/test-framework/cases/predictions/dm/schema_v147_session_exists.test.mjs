// Prediction Agent v1 sub-2d test 维度 1 — schema sanity
//
// scope: Bettor r100 R2 + Owner v1 simplify (r104) — 7 维 36 cases ship-block gate
// J1 #59c upgrade — UI cover 1-3 维 (schema + nav e2e + multi-user isolation)
// J2 v147 fd05d33 ship prediction_dm_session table 必 exist 让 DM stateless cache work

export default {
  id: 'prediction_dm_schema_v147_session',
  description: 'prediction_dm_session table v147 (J2 fd05d33) schema sanity smoke',
  domain: 'predictions',
  tags: ['regression', 'prediction_agent', 'v1', 'sub-2d', 'smoke'],
  steps: [
    {
      action: 'query_db',
      sql: `SELECT count(*) as ct FROM sqlite_master WHERE type='table' AND name='prediction_dm_session'`,
      expect: {
        must: { db_row_count: 1 },
      },
    },
    {
      // 5 expected cols: sender_address PK + last_market_id + last_outcome + last_action + updated_at
      action: 'query_db',
      sql: `SELECT count(*) as ct FROM pragma_table_info('prediction_dm_session') WHERE name IN ('sender_address','last_market_id','last_outcome','last_action','updated_at')`,
      expect: {
        must: { db_row_count: 1 },
      },
    },
  ],
};
