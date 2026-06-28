// Regression guard: FINDING-2 commingled-spine detection (线9 残项⑤, 2026-06-28)
//
// NWT FINDING-2: pre-fix PoolSpine_v07.sil didn't bake market_id into the redeem (unused ctor param dropped)
// → markets differing only in market_id collapsed to the SAME spine_p2sh (funds commingled, cross-market
// substitution risk: market A's close_attest could spend market B's same-address spine UTXO). Fix (88797d88)
// bakes market_id → post-fix markets have a UNIQUE spine_p2sh. The on-chain signature of a commingled market =
// its spine_p2sh is shared by >1 v0.7 market; an isolated (post-fix or single) market's spine is unique.
//
// Single source of the criterion: kasia-console/src/lib/pool-commingle-detect.mjs (J1). The SQL below is
// byte-identical to that helper — three entry-gates import it (trending-exclude / register-v07 reject /
// bshard-close-voter skip). This case locks the detection semantics:
//   - isCommingledSpine fires (COUNT>1) for a shared v0.7 spine, silent (COUNT=1) for a unique one.
//   - the protocol_version='v0.7' filter MUST hold — a v0.6 row sharing the spine must NOT inflate the count
//     (dropping that filter is a real regression risk; this proves it stays excluded).
//   - commingledSpineSet (GROUP BY HAVING COUNT>1) contains the shared spine, not the unique one.
//
// Offline: exec_sql fixtures + read-only query_db + teardown. No server, no chain, no relay.

const V07_A = '__test_cm_v07_shared_a__';
const V07_B = '__test_cm_v07_shared_b__';
const V06_X = '__test_cm_v06_shared_x__';   // v0.6 sharing the spine — must be excluded by the v0.7 filter
const V07_U = '__test_cm_v07_unique__';
const SHARED_SPINE = 'kaspatest:test_commingled_shared_spine';
const UNIQUE_SPINE = 'kaspatest:test_unique_postfix_spine';

// Byte-identical to pool-commingle-detect.mjs COMMINGLE_SQL (isCommingledSpine).
const COMMINGLE_SQL = "SELECT COUNT(*) AS n FROM pool_markets WHERE spine_p2sh = ? AND protocol_version = 'v0.7'";
// Byte-identical to pool-commingle-detect.mjs COMMINGLE_SET_SQL (commingledSpineSet), wrapped to test membership.
const SET_MEMBER_SQL =
  "SELECT COUNT(*) AS in_set FROM (" +
  "SELECT spine_p2sh FROM pool_markets " +
  "WHERE protocol_version = 'v0.7' AND spine_p2sh IS NOT NULL " +
  "GROUP BY spine_p2sh HAVING COUNT(*) > 1" +
  ") WHERE spine_p2sh = ?";

const mkInsert = (id, spine, ver) =>
  `INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version) ` +
  `VALUES ('${id}', 'testrelay', '${spine}', 'abcd', 1780000000, '${ver}')`;

export default {
  id: 'commingled_spine_detect_regression',
  description: '线9 残项⑤ FINDING-2: isCommingledSpine fires for shared v0.7 spine, silent for unique; v0.7 filter holds',
  domain: 'predictions',
  tags: ['regression', 'bshard', 'commingle', 'finding-2', 'money-adjacent', 'offline'],
  skip_in_batch: false,

  steps: [
    // ── pre-clean (idempotent: clear leftover from a crashed prior run) ──
    { id: 'pre_clean', action: 'exec_sql',
      sql: `DELETE FROM pool_markets WHERE id IN ('${V07_A}','${V07_B}','${V06_X}','${V07_U}')` },

    // ── setup: two v0.7 markets sharing one spine (= commingled) ──
    { id: 'seed_v07_a', action: 'exec_sql', sql: mkInsert(V07_A, SHARED_SPINE, 'v0.7') },
    { id: 'seed_v07_b', action: 'exec_sql', sql: mkInsert(V07_B, SHARED_SPINE, 'v0.7') },
    // ── setup: a v0.6 market ALSO on the shared spine — must be excluded by the v0.7 filter ──
    { id: 'seed_v06_x', action: 'exec_sql', sql: mkInsert(V06_X, SHARED_SPINE, 'v0.6') },
    // ── setup: a v0.7 market with a unique spine (= isolated / post-fix) ──
    { id: 'seed_v07_unique', action: 'exec_sql', sql: mkInsert(V07_U, UNIQUE_SPINE, 'v0.7') },

    // ── assert: isCommingledSpine FIRES for shared spine — COUNT = 2 (the two v0.7 rows; v0.6 excluded) ──
    { id: 'fires_for_shared', action: 'query_db', sql: COMMINGLE_SQL, params: [SHARED_SPINE],
      expect: { must: { rows_min: 1, row_assert: { n: 2 } } } },

    // ── assert: isCommingledSpine SILENT for unique spine — COUNT = 1 (not >1 → not commingled) ──
    { id: 'silent_for_unique', action: 'query_db', sql: COMMINGLE_SQL, params: [UNIQUE_SPINE],
      expect: { must: { rows_min: 1, row_assert: { n: 1 } } } },

    // ── assert: commingledSpineSet CONTAINS the shared spine ──
    { id: 'set_contains_shared', action: 'query_db', sql: SET_MEMBER_SQL, params: [SHARED_SPINE],
      expect: { must: { rows_min: 1, row_assert: { in_set: 1 } } } },

    // ── assert: commingledSpineSet does NOT contain the unique spine ──
    { id: 'set_excludes_unique', action: 'query_db', sql: SET_MEMBER_SQL, params: [UNIQUE_SPINE],
      expect: { must: { rows_min: 1, row_assert: { in_set: 0 } } } },

    // ── teardown ──
    { id: 'clean', action: 'exec_sql',
      sql: `DELETE FROM pool_markets WHERE id IN ('${V07_A}','${V07_B}','${V06_X}','${V07_U}')` },
  ],
};
