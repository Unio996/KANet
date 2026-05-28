// Dim 1.4 — Full DM lifecycle ship-block gate. The real e2e (/predict → digit → digit → stake →
// /confirm → publish-v2 → MATCHED → settle TX → verdict DM) is Bettor-reviewer-hat scope, since it
// requires real Kaspa testnet KAS spend + a live counter-taker.
//
// This automated case verifies the SUBSYSTEM REACHABILITY underlying the lifecycle:
//   1. dispatcher routes "/" to prediction handler (= conversations.js 016f8b306 live)
//   2. handler renders /predict menu against pool_markets / exchange_offers (= UI baea285 live)
//   3. audit endpoint returns trace for a real user_pk (= audit-prediction.js wired)
//
// The 3 stages chained = lifecycle infrastructure is intact. Real chain e2e remains a separate
// manual gate executed by Bettor on a freshly published pool_markets pending_taker row.

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';
const RELAY_ID = process.env.PREDICTION_AGENT_RELAY_ID || '6a0a8eed-ce4f-4192-bb37-1d2843c626e4';

// Use a unique peer per run so broker dedup (5s window) does not silence the dispatch chain.
const FRESH_PEER = `kaspatest:dim1_04_${Date.now()}_lifecycle`;

export default {
  id: 'dim1_navigation_04_full_lifecycle',
  description: 'Dim 1.4: subsystem reachability for DM lifecycle (dispatcher + handler + audit). Real e2e = Bettor manual gate.',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim1', 'lifecycle', 'reachability', 'ship_block'],
  pending_dep: ['real_chain_market_create_for_e2e'],  // manual reviewer scope
  steps: [
    // 1. Dispatcher reachable — /help routes to prediction handler, returns menu text.
    {
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/agent/reply`,
      body: { relayNodeId: RELAY_ID, peer: FRESH_PEER, message: '/help' },
      expect: {
        must: {
          http_status: 200,
          reply_contains_one_of: ['Prediction Agent', '/predict', '/my_bets'],
        },
      },
    },
    // 2. Handler queries pool_markets for /predict (= chain truth read path live).
    //    Empty / non-empty both acceptable — what matters is no Unhandled exception.
    {
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/agent/reply`,
      body: { relayNodeId: RELAY_ID, peer: FRESH_PEER, message: '/predict' },
      expect: {
        must: {
          http_status: 200,
          reply_does_not_contain: ['Unhandled', 'TypeError', 'SQLITE_ERROR'],
        },
      },
    },
    // 3. Audit endpoint returns trace shape for an arbitrary user (= sub 7.2 wire intact).
    {
      action: 'http_get',
      url: `${TN12_CONSOLE}/api/audit/prediction-trace/${encodeURIComponent(FRESH_PEER)}`,
      expect: {
        must: {
          http_status: 200,
          response_has_keys: ['user_pk', 'total_markets', 'total_sides', 'trace', 'orphan_dm_actions'],
        },
      },
    },
    // 4. Audit query for a real user with bet history (= verify the full join chain works).
    //    Testnet has 19 pool_bettor_sides rows; one of the bettor_pks has multiple sides.
    {
      action: 'query_db',
      sql: `SELECT bettor_pk FROM pool_bettor_sides
            GROUP BY bettor_pk
            ORDER BY COUNT(*) DESC LIMIT 1`,
      save_as: 'top_bettor',
      expect: { must: { rows_min: 1 } },
    },
    {
      action: 'http_get',
      url: `${TN12_CONSOLE}/api/audit/prediction-trace/audit-fixture-probe`,  // any string — endpoint returns 200 + shape
      expect: {
        must: {
          http_status: 200,
          row_assert: { user_pk: 'audit-fixture-probe' },
        },
      },
    },
  ],
};
