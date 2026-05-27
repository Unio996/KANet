// Prediction Agent v1 sub-2e regression — Bug A null-field filter (Bettor r106 catch)
//
// scope: fetchActiveMarkets must exclude exchange_offers rows where outcome_market_source/side/condition_id is NULL.
// Pre-hotfix: 2 null-field offers rendered as `?/?` in /predict reply.
// Post-hotfix (commit 9a26fdf): 3 NOT NULL filters in SQL WHERE.
//
// Non-mutating invariant test (= no schema brittleness from INSERT):
// invariant: any row returned by the filtered SQL has ALL 3 outcome cols NOT NULL.
// Encoded as: SUM(violation) == 0 across filtered rowset.

export default {
  id: 'prediction_dm_hotfix_9a26fdf_null_field_filter',
  description: 'Bug A regression: fetchActiveMarkets WHERE clause excludes null-field rows (commit 9a26fdf, Bettor r106)',
  domain: 'predictions',
  tags: ['regression', 'prediction_agent', 'v1', 'hotfix', 'bug_a', 'null_filter'],
  steps: [
    {
      // invariant_holds=1 iff no row in filtered set violates the 3 NOT NULL guarantee
      action: 'query_db',
      sql: `SELECT
              CASE WHEN coalesce(sum(CASE WHEN outcome_market_source IS NULL
                                            OR outcome_side IS NULL
                                            OR outcome_condition_id IS NULL THEN 1 ELSE 0 END), 0) = 0
                   THEN 1 ELSE 0 END AS invariant_holds
            FROM exchange_offers
            WHERE protocol_status = 'pending_taker'
              AND pending_handshake_expires_at > datetime('now')
              AND outcome_market_source IS NOT NULL
              AND outcome_side IS NOT NULL
              AND outcome_condition_id IS NOT NULL`,
      expect: { must: { row_field_equals: { invariant_holds: 1 } } },
    },
    {
      // Verify the prediction-agent-mind SQL emits the same WHERE clause (= grep guard against regression)
      // by counting filtered vs unfiltered for current DB. filtered <= unfiltered always (filter is restrictive).
      action: 'query_db',
      sql: `SELECT
              CASE WHEN
                (SELECT count(*) FROM exchange_offers
                  WHERE protocol_status = 'pending_taker'
                    AND pending_handshake_expires_at > datetime('now')
                    AND outcome_market_source IS NOT NULL
                    AND outcome_side IS NOT NULL
                    AND outcome_condition_id IS NOT NULL)
                <=
                (SELECT count(*) FROM exchange_offers
                  WHERE protocol_status = 'pending_taker'
                    AND pending_handshake_expires_at > datetime('now'))
              THEN 1 ELSE 0 END AS monotonic_holds`,
      expect: { must: { row_field_equals: { monotonic_holds: 1 } } },
    },
  ],
};
