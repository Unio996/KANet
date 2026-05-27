// Dim 1.4 — single-user FULL lifecycle: /predict → 1 → 1 → 50 → /confirm → matched → settle → verdict DM.
// 真链 e2e, manual-only. ship-block 真 gate per Owner 钦定 "完全跑通".
// pending_dep: ui_baea285_handler + nwt_27aa21a_dispatcher + real_chain_market_create

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim1_navigation_04_full_lifecycle',
  description: 'Dim 1.4: single user /predict → 1 → 1 → 50 → /confirm → MATCHED → settle → verdict DM (real chain)',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim1', 'real_chain', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher', 'real_chain_market_create'],
  skip_in_batch: true,
  steps: [
    // Pre-fill: at least 1 open pool_market in DB; otherwise case is meaningless.
    { action: 'query_db', sql: `SELECT id FROM pool_markets WHERE protocol_status='open' ORDER BY created_at DESC LIMIT 1`, save_as: 'm' },
    { action: 'todo', note: 'guard: skip if open_markets empty (= real_chain pre-flight precondition)' },
    // 7-state walk
    { action: 'todo', note: '1) DM /predict → expect SELECT_MARKET menu with marketLabel from pool_markets row m.id' },
    { action: 'todo', note: '2) DM "1" → expect SELECT_OUTCOME (binary: 1 = opposite of maker outcome_side)' },
    { action: 'todo', note: '3) DM "1" → expect SELECT_STAKE menu (10/50/100/custom)' },
    { action: 'todo', note: '4) DM "50" → expect CONFIRM preview + /confirm prompt' },
    { action: 'todo', note: '5) DM "/confirm" → expect publish-v2 stake_lock TX broadcast' },
    { action: 'wait_for_db_row', sql: `SELECT id FROM pool_bettor_sides WHERE bettor_pk=? AND market_id=? LIMIT 1`,
      params: ['${env.TEST_USER_PK}', '${m.id}'], timeout_ms: 60000, poll_ms: 3000 },
    { action: 'todo', note: '6) wait taker stake event → expect MATCHED push DM (buildMatchedDm hook)' },
    { action: 'todo', note: '7) wait deadline → expect /confirm result prompt DM' },
    { action: 'todo', note: '8) DM "/confirm 0" → expect consensual-confirm API → matched→verifying' },
    { action: 'wait_for_db_row', sql: `SELECT settle_txid FROM pool_markets WHERE id=? AND settle_txid IS NOT NULL`,
      params: ['${m.id}'], timeout_ms: 180000, poll_ms: 5000 },
    { action: 'todo', note: '9) verify verdict DM "你赢/输 X KAS, TX <hash>" (buildCompletedDm hook)' },
    // Audit verify
    {
      action: 'http_get',
      url: `${TN12_CONSOLE}/api/audit/prediction-trace/${encodeURIComponent('${env.TEST_USER_PK}')}`,
      expect: {
        must: {
          http_status: 200,
          response_has_keys: ['trace', 'total_markets', 'total_sides'],
        },
        should: {
          // dm_menu_actions ≥ 5 if UI wires emitDmMenuAction per state transition
          row_assert: { 'trace[0].dm_menu_actions_min': 5 },
        },
      },
    },
  ],
};
