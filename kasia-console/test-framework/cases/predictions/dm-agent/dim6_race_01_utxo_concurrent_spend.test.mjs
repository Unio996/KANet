// Dim 6.1 (J1 #59c add) — UTXO concurrent spend guard: pool_bettor_sides UNIQUE(market_id, bettor_pk)
// is enforced by schema, so even 2 parallel /confirm attempts by the same bettor on the same market
// cannot create duplicate side rows. Validates the schema invariant on existing testnet data
// (= 19 sides across 10 markets, 0 duplicates per market_id+bettor_pk).
//
// Real-chain race exec (2 concurrent /confirm + real publish-v2 winner) is dim1.4 full_lifecycle scope.

export default {
  id: 'dim6_race_01_utxo_concurrent_spend',
  description: 'Dim 6.1: pool_bettor_sides UNIQUE(market_id, bettor_pk) invariant — 0 race-induced dup rows',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim6', 'race', 'schema_invariant', 'ship_block', 'j1_59c_add'],
  steps: [
    {
      // Schema enforces UNIQUE INDEX on (market_id, bettor_pk). Even under concurrent /confirm
      // race, no (market_id, bettor_pk) pair can produce > 1 row. Query any violation.
      action: 'query_db',
      sql: `SELECT market_id, bettor_pk, COUNT(*) AS c
            FROM pool_bettor_sides
            GROUP BY market_id, bettor_pk
            HAVING c > 1`,
      expect: {
        must: {
          db_row_count: 0,  // 0 violations = schema invariant intact
        },
      },
    },
    {
      // Verify the UNIQUE index itself exists (schema lock guard against future migration drift).
      action: 'query_db',
      sql: `SELECT count(*) AS c FROM pragma_index_list('pool_bettor_sides')
            WHERE name = 'idx_pool_sides_bettor_market'`,
      expect: { must: { row_field_equals: { c: 1 } } },
    },
  ],
};
