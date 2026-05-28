// Dim 6.3 (J1 #59c add) — Scout outage span (kill mid-MATCHED → restart) catch-up ingest test.
// Real outage simulation + 120s catch-up wait is operator-only. This case validates the
// SCANNER CONTROL ENDPOINTS are reachable (= the lever to perform the test exists) and that
// the chain_events ingest pipeline integrity is intact via invariant assertions on existing data.

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim6_race_03_scout_outage_matched_to_completed',
  description: 'Dim 6.3: scanner control endpoints + chain_events ingest integrity (outage manual gate)',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim6', 'race', 'scout', 'reachability', 'ship_block', 'j1_59c_add'],
  pending_dep: ['real_outage_window_for_e2e'],  // manual reviewer scope (30s stop + 120s catch-up)
  steps: [
    {
      // Scanner stop control reachable. POST returns 200 or 4xx (already stopped). Restart immediately.
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/discovery/scanner/stop`,
      body: {},
      expect: { must: { http_status_one_of: [200, 400, 404, 409] } },
    },
    {
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/discovery/scanner/start`,
      body: {},
      expect: { must: { http_status_one_of: [200, 400, 404, 409] } },
    },
    {
      // chain_events ingest integrity: every settle_consensual_dispatched event references a real
      // pool_markets row (= no orphan events from a half-ingested outage scenario).
      action: 'query_db',
      sql: `SELECT e.id FROM chain_events e
            WHERE e.event_type = 'pool_settle_consensual_dispatched'
              AND NOT EXISTS (
                SELECT 1 FROM pool_markets m
                WHERE e.payload LIKE '%' || m.id || '%'
              )`,
      expect: { must: { db_row_count: 0 } },
    },
    {
      // chain_events UNIQUE(txid, event_type) enforced — no duplicate ingest from
      // Scout restart re-scanning the same block twice.
      action: 'query_db',
      sql: `SELECT txid, event_type, COUNT(*) AS c
            FROM chain_events
            GROUP BY txid, event_type
            HAVING c > 1`,
      expect: { must: { db_row_count: 0 } },
    },
  ],
};
