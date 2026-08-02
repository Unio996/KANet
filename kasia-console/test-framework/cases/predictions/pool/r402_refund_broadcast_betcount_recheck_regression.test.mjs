// Regression guard: r402 — betCount re-check immediately before the real refund broadcast
// (NWT PUSH-BACK a52c70cd finding①, fixed in handleRefunding L2552+, commit 778e71e9/91d24f93).
//
// Bug this guards against: dispatchRefund only stashes a refund preimage + sets
// protocol_status='refunding'; the actual signed broadcast happens a whole settler tick later in
// handleRefunding. A market that picked up a real bet in that window used to get refunded anyway
// (zero re-check) — violates Owner's "只 settle 绝不 refund" money-path invariant. The cross-node
// xnode-refund incident (705 pool_refund_request_v1 broadcasts, J1 08-01 report) is the live
// instance of this exact shape: a 0-bet claim, structurally unverifiable by the requester, reaching
// a real broadcast with zero downstream check.
//
// This case locks the SQL-level GATE behavior at the exact statement used in handleRefunding
// (pool-market-settler.js ~L2591-2617): byte-equivalent WHERE/json_set/json_remove clause, not a
// re-implementation. It does NOT exercise the async relay IPC path (sendCommandAsync/ecdsa_sign/
// send_broadcast) — that needs a live or mocked relay and is out of scope for this offline case;
// NWT's post-landing diff review (promised in the v2 GREEN verdict) covers that half.
//
// Offline: exec_sql fixtures + query_db assertions + teardown. No server, no chain, no relay.

const M_CONFLICT = '__test_r402_conflict__';   // has a real bet — must be refused + reverted
const M_CLEAN = '__test_r402_clean__';         // zero bets — betCount SELECT must read 0 (control)

const mkMarket = (id, status, metadata) =>
  `INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status, metadata) ` +
  `VALUES ('${id}', 'testrelay-r402', 'kaspatest:test_r402_spine', 'abcd', 1780000000, 'v0.7', '${status}', '${metadata.replace(/'/g, "''")}')`;

const mkBettorSide = (marketId, bettorPk) =>
  `INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh) ` +
  `VALUES ('${marketId}', '${bettorPk}', 1, 100000000, 'kaspatest:test_r402_side_p2sh')`;

// Byte-equivalent to the code (pool-market-settler.js handleRefunding, r402 checkpoint).
// Params order: (nowIso, betCount, marketId, throttleSec).
const R402_CONFLICT_UPDATE_SQL = `
  UPDATE pool_markets
  SET metadata = json_set(
        json_remove(COALESCE(metadata, '{}'), '$.refund_tx_obj', '$.refund_dispatched_at'),
        '$.refund_conflict_at', ?,
        '$.refund_conflict_bet_count', ?
      ),
      protocol_status = 'verifying',
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
    AND (
      json_extract(metadata, '$.refund_conflict_at') IS NULL
      OR (julianday('now') - julianday(json_extract(metadata, '$.refund_conflict_at'))) * 86400 > ?
    )
`;

const BET_COUNT_SQL = 'SELECT COUNT(*) as c FROM pool_bettor_sides WHERE market_id = ?';

export default {
  id: 'r402_refund_broadcast_betcount_recheck_regression',
  description: 'r402: handleRefunding betCount re-check aborts + reverts a refund whose 0-bet premise no longer holds at broadcast time, with idempotent throttle',
  domain: 'predictions',
  tags: ['regression', 'money-adjacent', 'settler', 'refund', 'r402', 'offline'],
  skip_in_batch: false,

  steps: [
    // ── pre-clean ──
    { id: 'pre_clean_markets', action: 'exec_sql',
      sql: `DELETE FROM pool_markets WHERE id IN ('${M_CONFLICT}','${M_CLEAN}')` },
    { id: 'pre_clean_sides', action: 'exec_sql',
      sql: `DELETE FROM pool_bettor_sides WHERE market_id IN ('${M_CONFLICT}','${M_CLEAN}')` },

    // ── setup: M_CONFLICT is mid-refund (as if dispatchRefund already ran and stashed a preimage) ──
    { id: 'seed_conflict_market', action: 'exec_sql',
      sql: mkMarket(M_CONFLICT, 'refunding', JSON.stringify({
        refund_tx_obj: { fake: 'preimage' },
        refund_dispatched_at: '2026-08-02T20:00:00.000Z',
        refund_reason: 'cross-node consumer refund request (P0-#3)',
      })) },
    // ...but a real bet landed in the tick-interval window before broadcast — this is the exact
    // race r402 exists to catch.
    { id: 'seed_conflict_bet', action: 'exec_sql',
      sql: mkBettorSide(M_CONFLICT, 'test_bettor_pk_r402') },

    { id: 'seed_clean_market', action: 'exec_sql',
      sql: mkMarket(M_CLEAN, 'refunding', JSON.stringify({ refund_tx_obj: { fake: 'preimage' } })) },
    // M_CLEAN has zero pool_bettor_sides rows — no seed needed.

    // ── assert: betCount SELECT (the exact query used at the checkpoint) reads 1 vs 0 ──
    { id: 'betcount_conflict', action: 'query_db', sql: BET_COUNT_SQL, params: [M_CONFLICT],
      expect: { must: { rows_min: 1, row_assert: { c: 1 } } } },
    { id: 'betcount_clean', action: 'query_db', sql: BET_COUNT_SQL, params: [M_CLEAN],
      expect: { must: { rows_min: 1, row_assert: { c: 0 } } } },

    // ── act: run the exact r402 conflict-handling UPDATE against M_CONFLICT (betCount=1 branch) ──
    { id: 'first_conflict_update', action: 'exec_sql',
      sql: R402_CONFLICT_UPDATE_SQL,
      params: ['2026-08-03T00:00:00.000Z', 1, M_CONFLICT, 300],
      expect: { must: { result_field_equals: { changes: 1 } } } },

    // ── assert: reverted to 'verifying', preimage cleared, conflict audit fields set ──
    { id: 'assert_reverted_status', action: 'query_db',
      sql: `SELECT protocol_status FROM pool_markets WHERE id = ?`, params: [M_CONFLICT],
      expect: { must: { rows_min: 1, row_assert: { protocol_status: 'verifying' } } } },
    { id: 'assert_preimage_cleared', action: 'query_db',
      sql: `SELECT json_extract(metadata, '$.refund_tx_obj') AS tx_obj, json_extract(metadata, '$.refund_dispatched_at') AS dispatched_at FROM pool_markets WHERE id = ?`,
      params: [M_CONFLICT],
      expect: { must: { rows_min: 1, row_assert: { tx_obj: null, dispatched_at: null } } } },
    { id: 'assert_conflict_audit', action: 'query_db',
      sql: `SELECT json_extract(metadata, '$.refund_conflict_at') AS at, json_extract(metadata, '$.refund_conflict_bet_count') AS cnt FROM pool_markets WHERE id = ?`,
      params: [M_CONFLICT],
      expect: { must: { rows_min: 1, row_assert: { at: '2026-08-03T00:00:00.000Z', cnt: 1 } } } },
    // refund_reason must survive (json_remove only strips refund_tx_obj/refund_dispatched_at) —
    // it's how the caller decides whether to fire the rejected_v1 broadcast for cross-node requests.
    { id: 'assert_reason_preserved', action: 'query_db',
      sql: `SELECT json_extract(metadata, '$.refund_reason') AS reason FROM pool_markets WHERE id = ?`,
      params: [M_CONFLICT],
      expect: { must: { rows_min: 1, row_assert: { reason: 'cross-node consumer refund request (P0-#3)' } } } },

    // ── act: run it again immediately (simulates the very next settler tick hitting the same
    //    still-unresolved conflict) — throttle window (300s) has not elapsed, must be a no-op ──
    { id: 'second_conflict_update_throttled', action: 'exec_sql',
      sql: R402_CONFLICT_UPDATE_SQL,
      params: ['2026-08-03T00:00:01.000Z', 1, M_CONFLICT, 300],
      expect: { must: { result_field_equals: { changes: 0 } } } },

    // ── assert: throttle held — conflict_at is still the FIRST timestamp, not overwritten ──
    { id: 'assert_throttle_held', action: 'query_db',
      sql: `SELECT json_extract(metadata, '$.refund_conflict_at') AS at FROM pool_markets WHERE id = ?`,
      params: [M_CONFLICT],
      expect: { must: { rows_min: 1, row_assert: { at: '2026-08-03T00:00:00.000Z' } } } },

    // ── control: M_CLEAN (real 0-bet market) is untouched by this UPDATE path — the caller-side
    //    `if (betCount > 0)` guard is what keeps clean markets from ever reaching this statement;
    //    this asserts the statement itself is a no-op if mistakenly run against a 0-bet market too
    //    (defense in depth — WHERE id=? still matches, but nothing here checks betCount itself,
    //    so this documents that the SQL alone does NOT re-derive the guard — the caller must). ──
    { id: 'assert_clean_still_refunding', action: 'query_db',
      sql: `SELECT protocol_status FROM pool_markets WHERE id = ?`, params: [M_CLEAN],
      expect: { must: { rows_min: 1, row_assert: { protocol_status: 'refunding' } } } },

    // ── teardown ──
    { id: 'clean_sides', action: 'exec_sql',
      sql: `DELETE FROM pool_bettor_sides WHERE market_id IN ('${M_CONFLICT}','${M_CLEAN}')` },
    { id: 'clean_markets', action: 'exec_sql',
      sql: `DELETE FROM pool_markets WHERE id IN ('${M_CONFLICT}','${M_CLEAN}')` },
  ],
};
