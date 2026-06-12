// Dim 6.4 (J1 #59c add) — protocol_version migrate guard: pool_markets.protocol_status MUST be
// one of the spec-defined values, even across version upgrades. Verifies the live testnet has
// 0 markets in undefined / legacy status strings (= migration didn't strand any rows).
//
// Real version-drift dispatcher branch test requires live config flip + restart; operator-only.

// [J1 #59c update 2026-06-12] added 'refunding' + 'disputed': both are legit pool_markets.protocol_status
// values written by pool-market-settler.js (refunding = refund-in-progress, L2096, G2-B Bettor r263;
// disputed = dispute 终态 + grace timer, L883). Verified live DB has rows in both (refunding×3, disputed×1)
// and they are settler-produced, NOT stranded/corrupt. Allowlist was stale (KANet-UI M3 FSM-rewire surfaced).
const SPEC_STATUSES = [
  'pending_oracle_sampling', 'pending_oracle_deposits', 'pending_bettors',
  'collecting_sigs', 'verifying', 'refunding', 'completed', 'refunded',
  'disputed', 'doomed', 'errored', 'cancelled',
];

export default {
  id: 'dim6_race_04_protocol_version_migrate',
  description: 'Dim 6.4: pool_markets.protocol_status invariant — all rows in spec-defined status set (0 stranded)',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim6', 'race', 'migration', 'invariant', 'ship_block', 'j1_59c_add'],
  steps: [
    {
      action: 'query_db',
      sql: `SELECT DISTINCT protocol_status FROM pool_markets`,
      expect: {
        must: {
          rows_min: 1,
        },
      },
    },
    {
      // Per-status invariant: no row with status outside the spec list.
      action: 'query_db',
      sql: `SELECT id, protocol_status FROM pool_markets
            WHERE protocol_status NOT IN ('${SPEC_STATUSES.join("','")}')`,
      expect: { must: { db_row_count: 0 } },
    },
    {
      // Deadline invariant: all rows have a valid deadline > 0 (= migration didn't null-out).
      action: 'query_db',
      sql: `SELECT id FROM pool_markets WHERE deadline IS NULL OR deadline <= 0`,
      expect: { must: { db_row_count: 0 } },
    },
  ],
};
