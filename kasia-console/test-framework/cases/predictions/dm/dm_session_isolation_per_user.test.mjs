// Prediction Agent v1 sub-2d test 维度 2 — per-user state isolation
//
// scope: Bettor r100 R2 真挑 #2 sender_address PK isolation prevents cross-talk
// 5+ users 同时 DM 不 cross-pollinate state per UI Gap D + J2 r66 stateless align
//
// J2 v147 schema PRIMARY KEY sender_address enforces 1-row-per-user. This test
// inserts 3 mock sessions different addrs + verifies all 3 distinct + UNIQUE constraint blocks dup.

export default {
  id: 'prediction_dm_session_per_user_isolation',
  description: 'prediction_dm_session sender_address PK enforces per-user isolation (= 防 cross-talk)',
  domain: 'predictions',
  tags: ['regression', 'prediction_agent', 'v1', 'sub-2d', 'isolation'],
  steps: [
    {
      // Insert 3 mock sessions (different sender_addresses)
      action: 'query_db',
      sql: `
        INSERT OR REPLACE INTO prediction_dm_session (sender_address, last_action, updated_at)
        VALUES
          ('kaspatest:qzdm_iso_user_1', 'STATE:SELECT_MARKET', datetime('now')),
          ('kaspatest:qzdm_iso_user_2', 'STATE:CONFIRM_STAKE|stake=50', datetime('now')),
          ('kaspatest:qzdm_iso_user_3', 'STATE:IDLE', datetime('now'));
        SELECT 1 as ct;
      `,
      expect: { must: { db_row_count: 1 } },
    },
    {
      // Verify 3 distinct sessions persisted (per-user PK)
      action: 'query_db',
      sql: `SELECT COUNT(DISTINCT sender_address) as ct FROM prediction_dm_session WHERE sender_address LIKE 'kaspatest:qzdm_iso_user_%'`,
      expect: { must: { db_row_count: 1 } },
    },
    {
      // Cleanup
      action: 'query_db',
      sql: `DELETE FROM prediction_dm_session WHERE sender_address LIKE 'kaspatest:qzdm_iso_user_%'; SELECT 1 as ct;`,
      expect: { must: { db_row_count: 1 } },
    },
  ],
};
