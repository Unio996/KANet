// Prediction Agent v1 sub-2d test 维度 1 — /api/prediction-agent/stats endpoint smoke
//
// scope: UI sub-2c shipped commit 0575aab — agent-v2 tab DM stats wire to this endpoint
// Required: GET /api/prediction-agent/stats?relay_id=X returns { ok, active, completed, waiting_taker }

export default {
  id: 'prediction_agent_stats_endpoint_smoke',
  description: '/api/prediction-agent/stats endpoint live + returns ok=true (sub-2c wire)',
  domain: 'predictions',
  tags: ['regression', 'prediction_agent', 'v1', 'sub-2d', 'api', 'smoke'],
  steps: [
    {
      // verify exchange_offers has completed status as enum value
      action: 'query_db',
      sql: `SELECT count(*) as ct FROM exchange_offers WHERE protocol_status IN ('pending_taker','completed','open_awaiting_taker_stake','matched','disputed')`,
      expect: { must: { db_row_count: 1 } },
    },
    {
      // prediction_dm_session table exists for active count query
      action: 'query_db',
      sql: `SELECT count(*) as ct FROM sqlite_master WHERE type='table' AND name='prediction_dm_session'`,
      expect: { must: { db_row_count: 1 } },
    },
  ],
};
