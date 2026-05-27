// Dim 6.3 (J1 #59c add) — Scout offline for 30 min spanning MATCHED → COMPLETED transition.
// Restart Scout → catch-up scan ingests skipped chain_events → state reconciled.
// pending_dep: scout_control + real_chain_market_create

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim6_race_03_scout_outage_matched_to_completed',
  description: 'Dim 6.3: Scout outage spans MATCHED→COMPLETED → restart Scout → catch-up scan reconciles state',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim6', 'race', 'real_chain', 'scout', 'ship_block', 'j1_59c_add', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'real_chain_market_create'],
  skip_in_batch: true,
  steps: [
    { action: 'todo', note: 'pre: market in MATCHED status' },
    {
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/discovery/scanner/stop`,
      expect: { must: { http_status: 200 } },
    },
    { action: 'todo', note: 'parallel: settler broadcasts settle TX while Scout down' },
    { action: 'sleep', ms: 30_000 },
    {
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/discovery/scanner/start`,
      expect: { must: { http_status: 200 } },
    },
    {
      // After Scout catch-up, pool_settle_consensual_dispatched event should be ingested
      action: 'wait_for_db_row',
      sql: `SELECT id FROM chain_events WHERE event_type='pool_settle_consensual_dispatched' AND payload LIKE ? ORDER BY observed_at DESC LIMIT 1`,
      params: [`%${'${env.OUTAGE_MARKET_ID}'}%`],
      timeout_ms: 120000,
      poll_ms: 5000,
      expect: { must: { found: true } },
    },
  ],
};
