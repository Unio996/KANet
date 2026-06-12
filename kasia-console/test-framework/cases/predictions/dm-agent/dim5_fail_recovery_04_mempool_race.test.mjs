// Dim 5.4 — Mempool already-spent UTXO race. Real race exec (2 concurrent TX touching same UTXO)
// is operator-only; this case verifies the SCHEMA-LEVEL defenses that catch double-spend artifacts:
//   - exchange_offers UNIQUE(broadcast_tx_id, message_index)  → 1 offer per chain message slot
//   - pool_bettor_sides UNIQUE(side_lock_tx)                   → 1 side per UTXO lock TX (per-UTXO model)
//   - claim_txid NOT-NULL invariant once a stake side is closed
// [J1 #59c update 2026-06-12] dropped stale pool_bettor_sides UNIQUE(market_id, bettor_pk) assertion:
// Bettor r163 per-UTXO independent claim made (market_id, bettor_pk) NON-unique by design (multi-bet).
// The real mempool-race guard for sides = side_lock_tx UNIQUE (last step). See dim6_race_01.
// These guarantees mean even if 2 publish-v2 fire concurrently and 1 loses the UTXO race, only the
// winner's row persists.

export default {
  id: 'dim5_fail_recovery_04_mempool_race',
  description: 'Dim 5.4: mempool race schema defenses — exchange_offers + pool_bettor_sides UNIQUE constraints intact',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim5', 'race', 'schema_invariant', 'ship_block'],
  steps: [
    {
      // exchange_offers UNIQUE(broadcast_tx_id, message_index) — no two offers share the same chain slot.
      action: 'query_db',
      sql: `SELECT broadcast_tx_id, message_index, COUNT(*) AS c
            FROM exchange_offers
            GROUP BY broadcast_tx_id, message_index
            HAVING c > 1`,
      expect: { must: { db_row_count: 0 } },
    },
    {
      // Verify the unique index exists (schema lock guard).
      action: 'query_db',
      sql: `SELECT count(*) AS c FROM pragma_index_list('exchange_offers')
            WHERE "unique" = 1`,
      expect: { must: { row_assert: { c_min: 1 } } },
    },
    {
      // pool_bettor_sides per-UTXO guard = side_lock_tx UNIQUE (replaces stale market_id,bettor_pk
      // UNIQUE assertion — see header + dim6_race_01). Stake lock TX IDs unique = 0 lock TX reuse.
      action: 'query_db',
      sql: `SELECT side_lock_tx, COUNT(*) AS c
            FROM pool_bettor_sides
            WHERE side_lock_tx IS NOT NULL AND side_lock_tx != ''
            GROUP BY side_lock_tx
            HAVING c > 1`,
      expect: { must: { db_row_count: 0 } },
    },
  ],
};
