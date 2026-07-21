// Regression guard: FINDING-2 main-settler commingled→route-to-refund gate filter (线9 残项⑤ commit 2, 2026-06-28)
//
// NWT FINDING-2 (commit 2): the main pool-market-settler processes NON-bshard commingled v0.7 markets
// (commingled ⊄ bshard — 0-bet/un-sharded commingled markets have no market_shards rows → isBshard-skip
// misses them → they reach the committee settle path = cross-market substitution theft vector, since a
// shared spine_p2sh + market_id-unbound payoutRoot lets market A's close_attest spend market B's UTXO).
//
// Fix: a loop-top gate (adjacent to isBshard-skip) routes commingled settle-state markets to cancel-refund
// (maker dispatchRefund outpoint-precise + per-bettor bettor_refund_available), NOT bare-continue (would
// orphan the maker refund) and NOT touch pending_bettors (would break the deadline-watcher, last night's bug).
//
// This case locks the GATE FILTER semantics (the design decisions co-verified by J1+NWT+Bettor):
//   - fires for commingled + settle-state {verifying, collecting_sigs, disputed}  (disputed = J1 catch)
//   - does NOT fire for commingled + pending_bettors  (deadline-watcher advances it first → avoids the trap)
//   - does NOT fire for a unique-spine market in a settle-state  (not commingled)
// The gate predicate below is byte-equivalent to the code: isCommingledSpine (COUNT>1 over v0.7) AND
// protocol_status IN (verifying, collecting_sigs, disputed).
//
// (The refund DISPATCH itself — dispatchRefund maker + bettor_refund_available — is the proven doomed/MIN_POT
// cancel-refund branch reused verbatim; its outpoint-precise safety is co-verified on-chain by J1, not re-asserted
// here. This case guards the gate's REACH: which markets it fires on, which it must leave alone.)
//
// Offline: exec_sql fixtures + read-only query_db + teardown. No server, no chain, no relay.

const M_VER = '__test_cmr_verifying__';        // commingled + verifying     → GATED
const M_COL = '__test_cmr_collecting__';        // commingled + collecting_sigs → GATED
const M_DIS = '__test_cmr_disputed__';          // commingled + disputed      → GATED (J1 catch)
const M_PEN = '__test_cmr_pending__';           // commingled + pending_bettors → NOT gated (deadline trap)
const M_UNI = '__test_cmr_unique_verifying__';  // unique + verifying         → NOT gated (not commingled)
const SHARED = 'kaspatest:test_cmr_shared_spine';
const UNIQUE = 'kaspatest:test_cmr_unique_spine';

// Byte-equivalent to the code gate: isCommingledSpine(spine) (COUNT>1 over v0.7) AND status in settle-states.
const GATE_SQL =
  "SELECT COUNT(*) AS gated FROM pool_markets pm " +
  "WHERE pm.id = ? " +
  "AND pm.protocol_status IN ('verifying','collecting_sigs','disputed') " +
  "AND ( SELECT COUNT(*) FROM pool_markets x WHERE x.spine_p2sh = pm.spine_p2sh AND x.protocol_version = 'v0.7' ) > 1";

const mkInsert = (id, spine, status) =>
  `INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status) ` +
  `VALUES ('${id}', 'testrelay', '${spine}', 'abcd', 1780000000, 'v0.7', '${status}')`;

export default {
  id: 'commingled_route_to_refund_regression',
  description: '线9 残项⑤ commit2 FINDING-2: main-settler commingled gate fires on settle-states (incl disputed), not pending_bettors/unique',
  domain: 'predictions',
  tags: ['regression', 'bshard', 'commingle', 'finding-2', 'settler', 'money-adjacent', 'offline'],
  skip_in_batch: false,

  steps: [
    // ── pre-clean ──
    { id: 'pre_clean', action: 'exec_sql',
      sql: `DELETE FROM pool_markets WHERE id IN ('${M_VER}','${M_COL}','${M_DIS}','${M_PEN}','${M_UNI}')` },

    // ── setup: 4 markets on the SHARED spine (commingled) in different statuses + 1 unique-spine ──
    { id: 'seed_verifying',   action: 'exec_sql', sql: mkInsert(M_VER, SHARED, 'verifying') },
    { id: 'seed_collecting',  action: 'exec_sql', sql: mkInsert(M_COL, SHARED, 'collecting_sigs') },
    { id: 'seed_disputed',    action: 'exec_sql', sql: mkInsert(M_DIS, SHARED, 'disputed') },
    { id: 'seed_pending',     action: 'exec_sql', sql: mkInsert(M_PEN, SHARED, 'pending_bettors') },
    { id: 'seed_unique',      action: 'exec_sql', sql: mkInsert(M_UNI, UNIQUE, 'verifying') },

    // ── assert: GATED for commingled + verifying ──
    { id: 'gated_verifying', action: 'query_db', sql: GATE_SQL, params: [M_VER],
      expect: { must: { rows_min: 1, row_assert: { gated: 1 } } } },

    // ── assert: GATED for commingled + collecting_sigs ──
    { id: 'gated_collecting', action: 'query_db', sql: GATE_SQL, params: [M_COL],
      expect: { must: { rows_min: 1, row_assert: { gated: 1 } } } },

    // ── assert: GATED for commingled + disputed (J1 catch — disputed is a settle-state) ──
    { id: 'gated_disputed', action: 'query_db', sql: GATE_SQL, params: [M_DIS],
      expect: { must: { rows_min: 1, row_assert: { gated: 1 } } } },

    // ── assert: NOT gated for commingled + pending_bettors (deadline-watcher advances first; avoid the trap) ──
    { id: 'notgated_pending', action: 'query_db', sql: GATE_SQL, params: [M_PEN],
      expect: { must: { rows_min: 1, row_assert: { gated: 0 } } } },

    // ── assert: NOT gated for unique-spine + verifying (not commingled) ──
    { id: 'notgated_unique', action: 'query_db', sql: GATE_SQL, params: [M_UNI],
      expect: { must: { rows_min: 1, row_assert: { gated: 0 } } } },

    // ── teardown ──
    { id: 'clean', action: 'exec_sql',
      sql: `DELETE FROM pool_markets WHERE id IN ('${M_VER}','${M_COL}','${M_DIS}','${M_PEN}','${M_UNI}')` },
  ],
};
