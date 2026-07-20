// Regression guard: #28 P1 (2026-07-21, J2) — settle_evidence writeback must preserve-merge, not
// full-replace, so any future field not enumerated in bshard-settle-daemon.mjs's per-tick evidence
// literal survives across ticks instead of being silently wiped (85fit's consolidated_pool loss was
// the first victim of this general footgun — babdaed3 added the field itself but left the replace
// semantics untouched; this test locks the merge semantics, not just that one field).
//
// Scope note: the real fix is a one-line JS object spread (`{ ...(meta.settle_evidence||{}), ...evidence }`)
// inside `_settleOneMarketAttempt`, which is not independently callable without mocking the full settle
// pipeline (relay calls, chain probes). This test instead locks the MERGE PROPERTY the fix depends on —
// "a fresh partial write preserves keys absent from it, fresh keys always win, and an explicit null in
// the fresh write stays present as null rather than removing the key" — using SQLite's per-key json_set()
// as the DB-level stand-in for the JS spread.
//
// json_set() was chosen over json_patch()/RFC-7396-merge-patch on purpose (NWT redteam catch,
// 2026-07-21): json_patch treats a null value in the patch as "delete this key", but JS object spread
// just sets the key's value to null — the key stays present. Three of the evidence literal's 12 keys
// (consolidated_pool/win_direction/expected_winners) use `?? null` and are null in real markets that
// haven't reached that state yet, so this divergence is not academic. json_set(json, path, value) was
// verified empirically (better-sqlite3, in-memory table) to set-to-null rather than delete, matching
// spread semantics — that's why every fresh field below is written via its own json_set() call instead
// of one json_patch() call.

export default {
  id: 'evidence_preserve_merge_regression',
  description: '#28 P1: settle_evidence writeback 是 preserve-merge——旧字段(不在本tick字面量里)不被冲掉, 本tick字段fresh值仍赢',
  domain: 'predictions',
  tags: ['regression', 'bshard', 'settle', 'evidence', 'offline'],
  skip_in_batch: false,

  steps: [
    { id: 'setup_clean', action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '__evidence_merge_test-s0'` },
    // tick N: evidence has a legacy/manual field that a future tick's literal won't know about,
    // close_txid at its "stale" (about-to-be-superseded) value, and win_direction already set to a
    // real value (0) — tick N+1 below will explicitly null it out to test null-preservation-not-deletion.
    {
      id: 'setup_tick_n_evidence',
      action: 'exec_sql',
      sql: `INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_status, metadata, created_at, updated_at)
        VALUES ('__evidence_merge_test-s0', 'fake-relay-id', 'fake-spine-p2sh', 'fake-hash', 9999999999, 'settled_partial_claims',
          '{"settle_evidence":{"close_txid":"stale_txid","_legacy_marker":"must_survive","winners":1,"win_direction":0}}',
          datetime('now'), datetime('now'))`,
    },
    // tick N+1: simulate the writeback's merge — one json_set() per fresh key (NOT json_patch on the
    // whole sub-object; see file header). _legacy_marker is untouched (absent from this tick's fresh
    // keys, so no json_set call for it — must survive). win_direction is explicitly nulled (mirrors
    // `win_direction: r.plan?.winDir ?? null` when winDir is genuinely absent this tick) — must stay
    // present as null, not disappear.
    {
      id: 'simulate_tick_n1_merge_writeback',
      action: 'exec_sql',
      sql: `UPDATE pool_markets SET metadata =
              json_set(json_set(metadata, '$.settle_evidence.close_txid', 'fresh_txid'),
                       '$.settle_evidence.winners', 2)
            WHERE id = '__evidence_merge_test-s0'`,
    },
    {
      id: 'null_out_win_direction_tick_n1',
      description: '本tick fresh literal 里 win_direction 因 r.plan?.winDir 缺失走 ?? null 分支——merge 后必须仍是 null(存在的 key), 不是被 json_patch 删掉的缺失 key',
      action: 'exec_sql',
      sql: `UPDATE pool_markets SET metadata = json_set(metadata, '$.settle_evidence.win_direction', NULL) WHERE id = '__evidence_merge_test-s0'`,
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
    {
      id: 'null_field_key_survives_as_null_not_deleted',
      description: 'win_direction key仍存在且值为null(json_extract对存在的null key返回SQL NULL, 对不存在的key也返回NULL——用json_type区分)',
      action: 'query_db',
      sql: `SELECT json_type(metadata, '$.settle_evidence.win_direction') t FROM pool_markets WHERE id = '__evidence_merge_test-s0'`,
      expect: { must: { rows_min: 1, row_assert: { t_one_of: ['null'] } } },
    },
    { id: 'teardown', action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '__evidence_merge_test-s0'` },
  ],
};
