// Regression: FINDING-2 commingled-spine detection single-source (J1, 2026-06-28).
//
// isCommingledSpine(spine_p2sh, db) criterion (lib/pool-commingle-detect.mjs): a v0.7 spine_p2sh shared by
// >1 market = commingled (pre-fix FINDING-2 P2SH collapse); a unique spine = isolated (post-fix). This case
// locks the SQL semantics: 2 markets sharing a spine → commingled (count>1); 1 market unique spine → isolated.
// Offline: exec_sql fixtures + query_db assertions + teardown. No server/chain.

const SHARED = '__test_commingle_shared_spine__';   // shared by 2 markets → commingled
const UNIQUE = '__test_commingle_unique_spine__';   // 1 market → isolated
const M_A = '__test_comm_market_A__';
const M_B = '__test_comm_market_B__';
const M_C = '__test_comm_market_C__';

// Byte-identical to isCommingledSpine's COMMINGLE_SQL.
const COMMINGLE_SQL = "SELECT COUNT(*) AS n FROM pool_markets WHERE spine_p2sh = ? AND protocol_version = 'v0.7'";

const seed = (id, spine) =>
  `INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version) ` +
  `VALUES ('${id}', 'testrelay', '${spine}', 'abcd', 1782000000, 'v0.7')`;

export default {
  id: 'commingle_detect',
  description: 'FINDING-2 isCommingledSpine: shared spine → commingled, unique spine → isolated',
  domain: 'predictions',
  tags: ['regression', 'finding-2', 'commingle', 'offline'],
  skip_in_batch: false,

  steps: [
    // pre-clean
    { id: 'pre_clean', action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id IN ('${M_A}','${M_B}','${M_C}')` },

    // 2 markets share SHARED spine → commingled; 1 market has UNIQUE spine → isolated
    { id: 'seed_a', action: 'exec_sql', sql: seed(M_A, SHARED) },
    { id: 'seed_b', action: 'exec_sql', sql: seed(M_B, SHARED) },
    { id: 'seed_c', action: 'exec_sql', sql: seed(M_C, UNIQUE) },

    // SHARED spine → count = 2 (>1 = commingled)
    { id: 'shared_is_commingled', action: 'query_db', sql: COMMINGLE_SQL, params: [SHARED],
      expect: { must: { rows_min: 1, row_assert: { n: 2 } } } },

    // UNIQUE spine → count = 1 (isolated, not commingled)
    { id: 'unique_is_isolated', action: 'query_db', sql: COMMINGLE_SQL, params: [UNIQUE],
      expect: { must: { rows_min: 1, row_assert: { n: 1 } } } },

    // commingledSpineSet criterion: SHARED appears in the HAVING COUNT>1 set, UNIQUE does not
    { id: 'set_includes_shared', action: 'query_db',
      sql: `SELECT spine_p2sh FROM pool_markets WHERE protocol_version='v0.7' AND spine_p2sh='${SHARED}' GROUP BY spine_p2sh HAVING COUNT(*) > 1`,
      expect: { must: { rows_min: 1, row_assert: { spine_p2sh: SHARED } } } },
    { id: 'set_excludes_unique', action: 'query_db',
      sql: `SELECT spine_p2sh FROM pool_markets WHERE protocol_version='v0.7' AND spine_p2sh='${UNIQUE}' GROUP BY spine_p2sh HAVING COUNT(*) > 1`,
      expect: { must: { db_row_count: 0 } } },

    // teardown
    { id: 'clean', action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id IN ('${M_A}','${M_B}','${M_C}')` },
  ],
};
