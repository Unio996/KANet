// Dim 6.1 (J1 #59c add; updated 2026-06-12) — UTXO concurrent spend guard.
//
// [DESIGN UPDATE per Bettor r163 "per-UTXO independent claim"]: (market_id, bettor_pk) is NO LONGER
// unique by design — a bettor stakes N independent UTXOs on the same market (multi-bet), so duplicate
// (market_id, bettor_pk) rows are EXPECTED, not a race violation (live DB: 2774 sides, top bettor 25
// sides on one market). The original "(market_id, bettor_pk) UNIQUE" assertion was stale and the index
// it checked ('idx_pool_sides_bettor_market') never existed.
//
// The REAL per-UTXO concurrent-spend guard = side_lock_tx UNIQUE (idx_pool_sides_side_lock_tx_unique):
// even 2 parallel /confirm cannot produce two side rows sharing the same UTXO lock TX = no double-spend
// of a UTXO into two sides. This is the invariant that actually defends the race.
//
// Real-chain race exec (2 concurrent /confirm + real publish-v2 winner) is dim1.4 full_lifecycle scope.

export default {
  id: 'dim6_race_01_utxo_concurrent_spend',
  description: 'Dim 6.1: pool_bettor_sides side_lock_tx UNIQUE invariant — 0 race-induced UTXO double-claim (per-UTXO model, Bettor r163)',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim6', 'race', 'schema_invariant', 'ship_block', 'j1_59c_add'],
  steps: [
    {
      // Per-UTXO guard: each non-null side_lock_tx (the UTXO lock TX) appears at most once. Even under
      // concurrent /confirm race, no UTXO can be locked into two side rows. Query any violation.
      action: 'query_db',
      sql: `SELECT side_lock_tx, COUNT(*) AS c
            FROM pool_bettor_sides
            WHERE side_lock_tx IS NOT NULL AND side_lock_tx != ''
            GROUP BY side_lock_tx
            HAVING c > 1`,
      expect: {
        must: {
          db_row_count: 0,  // 0 UTXO reused across sides = per-UTXO invariant intact
        },
      },
    },
    {
      // Verify the UNIQUE index itself exists (schema lock guard against future migration drift).
      action: 'query_db',
      sql: `SELECT count(*) AS c FROM pragma_index_list('pool_bettor_sides')
            WHERE name = 'idx_pool_sides_side_lock_tx_unique' AND "unique" = 1`,
      expect: { must: { row_field_equals: { c: 1 } } },
    },
  ],
};
