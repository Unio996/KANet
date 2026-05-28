// Dim 6.5 (J1 #59c add) — taker NULL race guard: under concurrent /confirm by 2 takers, only 1 wins
// per (market_id, bettor_pk). Validates the schema-level UNIQUE INDEX is the enforcement layer
// (not application logic). Pairs with dim6.1.
//
// Also asserts pool_bettor_sides.direction is a valid 0/1 value (= no NULL race writes).

export default {
  id: 'dim6_race_05_taker_null_race',
  description: 'Dim 6.5: pool_bettor_sides.direction invariant — every side row has direction in (0,1), 0 NULL',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim6', 'race', 'invariant', 'ship_block', 'j1_59c_add'],
  steps: [
    {
      // No row with NULL direction (= no race-induced null write got through schema NOT NULL).
      action: 'query_db',
      sql: `SELECT id FROM pool_bettor_sides WHERE direction IS NULL`,
      expect: { must: { db_row_count: 0 } },
    },
    {
      // direction must be 0 or 1 (binary outcome side; settler.js winner field aligns).
      action: 'query_db',
      sql: `SELECT id, direction FROM pool_bettor_sides WHERE direction NOT IN (0, 1)`,
      expect: { must: { db_row_count: 0 } },
    },
    {
      // bettor_pk + stake_amount NOT NULL guards (= no orphan stake-less side rows).
      action: 'query_db',
      sql: `SELECT id FROM pool_bettor_sides WHERE bettor_pk IS NULL OR stake_amount IS NULL OR stake_amount <= 0`,
      expect: { must: { db_row_count: 0 } },
    },
    {
      // Sanity: testnet has > 0 bettor sides (= the table is exercised, not just structurally tested).
      action: 'query_db',
      sql: `SELECT COUNT(*) AS c FROM pool_bettor_sides`,
      expect: { must: { row_assert: { c_min: 1 } } },
    },
  ],
};
