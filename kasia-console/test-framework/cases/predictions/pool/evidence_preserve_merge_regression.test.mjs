// Regression guard: #28 P1 (2026-07-21, J2) — settle_evidence writeback must preserve-merge, not
// full-replace, so any future field not enumerated in bshard-settle-daemon.mjs's per-tick evidence
// literal survives across ticks instead of being silently wiped (85fit's consolidated_pool loss was
// the first victim of this general footgun — babdaed3 added the field itself but left the replace
// semantics untouched; this test locks the merge semantics, not just that one field).
//
// Scope note: the real fix is a one-line JS object spread (`{ ...(meta.settle_evidence||{}), ...evidence }`)
// inside `_settleOneMarketAttempt`, which is not independently callable without mocking the full settle
// pipeline (relay calls, chain probes). This test instead locks the MERGE PROPERTY the fix depends on —
// "a fresh partial write preserves keys absent from it, fresh keys always win" — using SQLite's
// json_patch() (RFC 7396 merge-patch) as the DB-level stand-in for the JS spread, since neither this
// fix nor the evidence shape ever explicit-nulls a key to mean "delete" (all `?? null` fields are always
// present in both old and new writes, so merge-patch and JS spread agree for this data shape).

export default {
  id: 'evidence_preserve_merge_regression',
  description: '#28 P1: settle_evidence writeback 是 preserve-merge——旧字段(不在本tick字面量里)不被冲掉, 本tick字段fresh值仍赢',
  domain: 'predictions',
  tags: ['regression', 'bshard', 'settle', 'evidence', 'offline'],
  skip_in_batch: false,

  steps: [
    { id: 'setup_clean', action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '__evidence_merge_test-s0'` },
    // tick N: evidence has a legacy/manual field that a future tick's literal won't know about,
    // plus close_txid at its "stale" (about-to-be-superseded) value.
    {
      id: 'setup_tick_n_evidence',
      action: 'exec_sql',
      sql: `INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_status, metadata, created_at, updated_at)
        VALUES ('__evidence_merge_test-s0', 'fake-relay-id', 'fake-spine-p2sh', 'fake-hash', 9999999999, 'settled_partial_claims',
          '{"settle_evidence":{"close_txid":"stale_txid","_legacy_marker":"must_survive","winners":1}}',
          datetime('now'), datetime('now'))`,
    },
    // tick N+1: simulate the writeback's merge — fresh partial evidence (no _legacy_marker key, close_txid updated)
    // applied via json_patch (merge-patch semantics == JS `{...prior, ...fresh}` for this non-null-deletion shape).
    {
      id: 'simulate_tick_n1_merge_writeback',
      action: 'exec_sql',
      sql: `UPDATE pool_markets SET metadata = json_set(metadata, '$.settle_evidence',
              json_patch(json_extract(metadata, '$.settle_evidence'), '{"close_txid":"fresh_txid","winners":2}'))
            WHERE id = '__evidence_merge_test-s0'`,
    },
    {
      id: 'legacy_field_survived',
      description: '不在本tick字面量里的旧字段(_legacy_marker)没被冲掉',
      action: 'query_db',
      sql: `SELECT json_extract(metadata, '$.settle_evidence._legacy_marker') v FROM pool_markets WHERE id = '__evidence_merge_test-s0'`,
      expect: { must: { rows_min: 1, row_assert: { v_one_of: ['must_survive'] } } },
    },
    {
      id: 'fresh_field_wins_over_stale',
      description: '本tick fresh close_txid 覆盖旧值(新鲜度不受merge影响)',
      action: 'query_db',
      sql: `SELECT json_extract(metadata, '$.settle_evidence.close_txid') v FROM pool_markets WHERE id = '__evidence_merge_test-s0'`,
      expect: { must: { rows_min: 1, row_assert: { v_one_of: ['fresh_txid'] } } },
    },
    {
      id: 'fresh_new_value_present',
      description: 'winners 从1(tick N)更新到2(tick N+1), fresh值生效',
      action: 'query_db',
      sql: `SELECT json_extract(metadata, '$.settle_evidence.winners') v FROM pool_markets WHERE id = '__evidence_merge_test-s0'`,
      expect: { must: { rows_min: 1, row_assert: { v_one_of: [2] } } },
    },
    { id: 'teardown', action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '__evidence_merge_test-s0'` },
  ],
};
