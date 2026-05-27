// Dim 3.2 — session stale TTL: NWT 27aa21a dispatcher uses updated_at > -1h for active session
// gate. Mid-flow user idle > 1h → next digit message should NOT route to prediction (falls to broker).
// pending_dep: nwt_27aa21a_dispatcher + ui_baea285_handler

export default {
  id: 'dim3_state_edge_02_session_ttl_expire',
  description: 'Dim 3.2: session updated_at > 1h stale → digit message falls broker (= no prediction hijack)',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim3', 'edge', 'ttl', 'ship_block', 'pending_nwt_bundle'],
  pending_dep: ['nwt_27aa21a_dispatcher', 'ui_baea285_handler'],
  skip_in_batch: true,
  steps: [
    {
      // Seed a stale prediction_dm_session row (updated_at 2 hours ago)
      action: 'query_db',  // mutate via raw SQL ok in test framework (= DB seed)
      sql: `INSERT OR REPLACE INTO prediction_dm_session
            (sender_address, last_market_id, last_outcome, last_action, updated_at)
            VALUES (?, 'stale-market', '0', 'STATE:SELECT_STAKE', datetime('now', '-2 hours'))`,
      params: ['${env.TEST_USER_ADDR}'],
    },
    { action: 'todo', note: 'send DM "1" → expect broker-v3 reply (not prediction handler) because session stale' },
    {
      action: 'query_db',
      sql: `SELECT updated_at FROM prediction_dm_session WHERE sender_address = ?`,
      params: ['${env.TEST_USER_ADDR}'],
      expect: {
        must: {
          // Stale row was not auto-revived to "now" — broker handled, prediction skipped
          row_assert: { 'updated_at_older_than_min': 60 },
        },
      },
    },
  ],
};
