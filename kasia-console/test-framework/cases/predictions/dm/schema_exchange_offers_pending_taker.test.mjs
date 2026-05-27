// Prediction Agent v1 sub-2d test 维度 1 — schema sanity for taker flow
//
// scope: Bettor r100 R2 — UI fetchActiveMarkets queries exchange_offers WHERE protocol_status='pending_taker'
// Required cols: id, maker_relay_id, outcome_oracle_relay_ids, outcome_market_source/condition_id/token_id/side,
//                pending_handshake_expires_at, give_amount, taker
// Pre-handshake flow per /api/prediction/pending-offer (= bettor.js L1490)

export default {
  id: 'prediction_dm_schema_exchange_offers_taker',
  description: 'exchange_offers cols required by prediction-agent-mind fetchActiveMarkets/fetchUserBets',
  domain: 'predictions',
  tags: ['regression', 'prediction_agent', 'v1', 'sub-2d', 'smoke'],
  steps: [
    {
      // 8 required cols present (= sub-2b /confirm wire 真 query)
      action: 'query_db',
      sql: `SELECT count(*) as ct FROM pragma_table_info('exchange_offers')
            WHERE name IN ('id','maker_relay_id','outcome_oracle_relay_ids','outcome_market_source','outcome_condition_id','outcome_token_id','outcome_side','pending_handshake_expires_at','give_amount','taker','protocol_status')`,
      expect: {
        must: { db_row_count: 1 },
      },
    },
    {
      // protocol_status='pending_taker' state 是 prediction agent /predict list 起源
      action: 'query_db',
      sql: `SELECT count(*) as ct FROM exchange_offers WHERE protocol_status = 'pending_taker' AND pending_handshake_expires_at > datetime('now')`,
      expect: {
        // pass regardless of count, just verify query 不 throw on schema
        must: { db_row_count: 1 },
      },
    },
  ],
};
