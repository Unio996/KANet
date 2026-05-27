// Dim 7.5 (J1 #59c add) — Bettor reviewer hat: pull 3 random pool_markets with settle_txid set,
// query /api/audit/prediction-trace per maker + per bettor, verify every step traces真链 (= 钱真到地址).
// Manual case — operator runs after every batch of real e2e.

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim7_audit_05_reviewer_spot_check',
  description: 'Dim 7.5: 3 random settled markets — audit trace covers DM action × publish-v2 × settle TX × balance',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim7', 'audit', 'reviewer', 'ship_block', 'j1_59c_add', 'manual_only'],
  pending_dep: ['real_chain_market_create'],
  skip_in_batch: true,
  steps: [
    {
      action: 'query_db',
      sql: `SELECT id, maker_relay_id, settle_txid FROM pool_markets
            WHERE settle_txid IS NOT NULL ORDER BY random() LIMIT 3`,
      save_as: 'sample',
      expect: { must: { rows_min: 1 } },  // soft floor — if 0 settled markets, case skips
    },
    {
      action: 'todo',
      note: 'for each sample market: '
          + '(a) query audit for maker_relay_id → verify trace.settle_events ≥ 1; '
          + '(b) query pool_bettor_sides for participating bettor_pks → verify audit per bettor returns valid balance_diff; '
          + '(c) confirm settle_txid resolves on kaspad RPC getTransaction → verifies真 chain anchor.',
    },
    {
      action: 'http_get',
      url: `${TN12_CONSOLE}/api/audit/prediction-trace-summary`,
      expect: {
        must: {
          http_status: 200,
          row_assert: { 'market_counts_by_status_includes_status': 'completed' },
        },
      },
    },
  ],
};
