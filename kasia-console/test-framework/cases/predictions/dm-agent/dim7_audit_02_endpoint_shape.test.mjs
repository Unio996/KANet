// Dim 7.2 (J1 #59c add) — /api/audit/prediction-trace/:user_pk and -summary endpoints exist
// and return well-formed JSON for an arbitrary user (empty trace acceptable).
// Runs WITHOUT UI bundle — proves audit-prediction.js wired & alive.

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim7_audit_02_endpoint_shape',
  description: 'Dim 7.2: /api/audit/prediction-trace + -summary return well-formed JSON shape',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim7', 'audit', 'endpoint', 'ship_block', 'j1_59c_add', 'dm_agent_now'],
  // No pending_dep — once Console restarted with audit-prediction.js wired.
  steps: [
    {
      action: 'http_get',
      url: `${TN12_CONSOLE}/api/audit/prediction-trace-summary`,
      expect: {
        must: {
          http_status: 200,
          response_has_keys: ['last_7_days_dm', 'market_counts_by_status', 'sides', 'dm_sessions', 'generated_at'],
        },
      },
    },
    {
      action: 'http_get',
      url: `${TN12_CONSOLE}/api/audit/prediction-trace/kaspatest:qzss9777test_user_no_data_OK_to_be_empty`,
      expect: {
        must: {
          http_status: 200,
          response_has_keys: ['user_pk', 'total_markets', 'total_sides', 'total_dm_actions',
                              'total_settle_events', 'trace', 'orphan_dm_actions', 'schema_version'],
        },
      },
    },
    {
      action: 'http_get',
      url: `${TN12_CONSOLE}/api/audit/prediction-trace/`,
      expect: {
        must: {
          // Missing user_pk param → 4xx (not 500)
          http_status_one_of: [400, 404],
        },
      },
    },
  ],
};
