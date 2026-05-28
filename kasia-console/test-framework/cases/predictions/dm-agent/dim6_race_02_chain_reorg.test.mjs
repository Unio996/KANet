// Dim 6.2 (J1 #59c add) — chain reorg guard: every completed pool_markets row MUST have a
// settle_txid (= settler.js commits txid only after kaspad accept; reorg → orphan → settler retries).
// Validates the invariant on real testnet data: 6 completed markets all have non-null settle_txid.
//
// True reorg simulation (kaspad orphan → settler re-broadcast → new txid) is operator-only.

export default {
  id: 'dim6_race_02_chain_reorg',
  description: 'Dim 6.2: completed pool_markets settle_txid invariant — 0 rows with completed status but null settle TX',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim6', 'race', 'reorg', 'invariant', 'ship_block', 'j1_59c_add'],
  steps: [
    {
      // Invariant: completed market → settle_txid OR refund_txid is set. Both null → orphan write.
      action: 'query_db',
      sql: `SELECT id, protocol_status, settle_txid, refund_txid
            FROM pool_markets
            WHERE protocol_status = 'completed'
              AND settle_txid IS NULL
              AND refund_txid IS NULL`,
      expect: { must: { db_row_count: 0 } },
    },
    {
      // Stronger invariant: no market should have BOTH settle_txid AND refund_txid set
      // (= terminal states mutually exclusive; reorg should not leave dual-write artifacts).
      action: 'query_db',
      sql: `SELECT id FROM pool_markets
            WHERE settle_txid IS NOT NULL AND refund_txid IS NOT NULL`,
      expect: { must: { db_row_count: 0 } },
    },
    {
      // Sanity floor: testnet has at least 1 completed market with settle_txid (= settler did fire at least once).
      action: 'query_db',
      sql: `SELECT COUNT(*) AS c FROM pool_markets WHERE settle_txid IS NOT NULL`,
      expect: { must: { row_assert: { c_min: 1 } } },
    },
  ],
};
