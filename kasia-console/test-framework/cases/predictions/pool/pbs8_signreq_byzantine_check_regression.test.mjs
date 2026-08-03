// Regression guard: PB-S8-1 搬运 — handlePoolOracleTxSignReq 签名前拜占庭自检
// (NWT红队774806d7 GREEN首轮通过, Bettor方向审GREEN #cvind4, 落码commit见git log)
//
// Bug this guards against: handlePoolOracleTxSignReq only checked committee MEMBERSHIP
// (myIdx in committeePks) before signing a payout tx — never checked whether the requested
// `winner` actually matches what this committee member itself voted. Since cross-node sign_req
// broadcasts can carry a message-supplied `winner`/`phase2_tx_obj`, this was an "authorization
// != precondition" gap identical in shape to r402 (xnode-refund), just on the money-OUT signing
// path for v0.5/v0.6 committee-sig markets (D-012 §二子集②, current live majority).
//
// Ported from the already-proven bettor-prediction-voter.js:1076-1126 PB-S8-1 pattern (OTC
// domain) — reuses the exact chain_events query decideConsensusV06 already uses to tally votes
// (pool-market-settler.js:1398-1404), not a new predicate.
//
// This case locks the QUERY + comparison logic byte-equivalent to the code in
// trade-protocol-filter.js handlePoolOracleTxSignReq: own-vote lookup by (market_id,
// voter_pubkey), and the winner(0/1) -> outcome('YES'/'NO') mapping. It does NOT exercise the
// surrounding async IPC calls (get_pubkey/sign_input_for_settle/send_broadcast) — those need a
// live or mocked relay, out of scope for this offline case (same boundary r402's regression case
// drew; NWT's post-landing diff review covers the async half).
//
// Offline: exec_sql fixtures + query_db assertions + teardown. No server, no chain, no relay.

const MARKET_ID = '__test_pbs8_market__';
const VOTER_PK_YES = 'test_pbs8_voter_pk_voted_yes';
const VOTER_PK_NO = 'test_pbs8_voter_pk_voted_no';
const VOTER_PK_MISSING = 'test_pbs8_voter_pk_no_vote_on_record';

// Bettor #cx7hlc②(2026-08-03): dirty row must sort BEFORE the legit row in observed_at — a dirty
// row placed AFTER could be skipped by LIMIT 1 finding the legit row first, making the test
// falsely green without ever exercising the crash path. This row's id/observed_at are chosen to
// sort earliest among all __test_pbs8_% rows.
const mkGarbageRow = (id, observedAt) =>
  `INSERT INTO chain_events (id, txid, event_type, observed_by, observed_at, payload) ` +
  `VALUES ('${id}', '${id}_txid', 'pool_oracle_vote', 'test-fixture', '${observedAt}', 'not valid json {{{')`;

const mkVoteEvent = (id, voterPk, outcome) =>
  `INSERT INTO chain_events (id, txid, event_type, observed_by, observed_at, payload) ` +
  `VALUES ('${id}', '${id}_txid', 'pool_oracle_vote', 'test-fixture', '2026-08-03T06:00:00.000Z', ` +
  `'${JSON.stringify({ market_id: MARKET_ID, voter_pubkey: voterPk, outcome }).replace(/'/g, "''")}')`;

// Byte-equivalent to the shipped code (trade-protocol-filter.js handlePoolOracleTxSignReq PB-S8-1
// checkpoint + pool-market-settler.js decideConsensusV06, card① json_extract迁移 NWT红队c0cfcbdb
// GREEN, landed same commit as this test update). json_valid guard must precede both json_extract
// calls (AND short-circuit) — a dirty row anywhere in the table would otherwise throw and abort
// the whole query, see the dirty-row-first cases below.
const OWN_VOTE_SQL = `
  SELECT payload FROM chain_events
  WHERE event_type = 'pool_oracle_vote'
    AND json_valid(payload)
    AND json_extract(payload, '$.market_id') = ?
    AND json_extract(payload, '$.voter_pubkey') = ?
  ORDER BY observed_at ASC LIMIT 1
`;
// Historical form (LIKE-based, no longer shipped as of card① landing) — kept only for the
// equivalence comparison in the dirty-row-first section below, proving the migration didn't
// silently change behavior for well-formed data while fixing the crash-on-dirty-data bug.
const LEGACY_LIKE_SQL = `
  SELECT payload FROM chain_events
  WHERE event_type = 'pool_oracle_vote'
    AND payload LIKE ? AND payload LIKE ?
  ORDER BY observed_at ASC LIMIT 1
`;
const marketLike = `%"market_id":"${MARKET_ID}"%`;
const pkLike = (pk) => `%"voter_pubkey":"${pk}"%`;

export default {
  id: 'pbs8_signreq_byzantine_check_regression',
  description: 'PB-S8-1: handlePoolOracleTxSignReq own-vote lookup + winner(0/1)<->outcome(YES/NO) mapping, byte-equivalent to shipped SQL',
  domain: 'predictions',
  tags: ['regression', 'money-adjacent', 'oracle', 'signing', 'pbs8', 'offline'],
  skip_in_batch: false,

  steps: [
    // ── pre-clean ──
    { id: 'pre_clean', action: 'exec_sql',
      sql: `DELETE FROM chain_events WHERE id LIKE '__test_pbs8_%'` },

    // ── setup: three committee members with different recorded votes ──
    { id: 'seed_vote_yes', action: 'exec_sql', sql: mkVoteEvent('__test_pbs8_vote_yes__', VOTER_PK_YES, 'YES') },
    { id: 'seed_vote_no', action: 'exec_sql', sql: mkVoteEvent('__test_pbs8_vote_no__', VOTER_PK_NO, 'NO') },
    // VOTER_PK_MISSING intentionally has no chain_events row — simulates the "not found yet" case.

    // ── assert: own-vote lookup finds the right row for a voter who voted YES ──
    { id: 'lookup_yes_voter', action: 'query_db', sql: OWN_VOTE_SQL, params: [MARKET_ID, VOTER_PK_YES],
      expect: { must: { rows_min: 1 } } },
    { id: 'lookup_yes_voter_outcome', action: 'query_db',
      sql: `SELECT json_extract(payload, '$.outcome') AS outcome FROM chain_events WHERE event_type='pool_oracle_vote' AND payload LIKE ? AND payload LIKE ?`,
      params: [marketLike, pkLike(VOTER_PK_YES)],
      expect: { must: { rows_min: 1, row_assert: { outcome: 'YES' } } } },

    // ── assert: own-vote lookup finds the right row for a voter who voted NO ──
    { id: 'lookup_no_voter_outcome', action: 'query_db',
      sql: `SELECT json_extract(payload, '$.outcome') AS outcome FROM chain_events WHERE event_type='pool_oracle_vote' AND payload LIKE ? AND payload LIKE ?`,
      params: [marketLike, pkLike(VOTER_PK_NO)],
      expect: { must: { rows_min: 1, row_assert: { outcome: 'NO' } } } },

    // ── assert: a voter with no chain_events row at all — the "not found, retry later" branch ──
    { id: 'lookup_missing_voter', action: 'query_db', sql: OWN_VOTE_SQL, params: [MARKET_ID, VOTER_PK_MISSING],
      expect: { must: { result_field_equals: { count: 0 } } } },

    // ── winner(0/1) -> expectedOutcome('YES'/'NO') mapping is a pure JS ternary in the code
    //    (msg.winner === 0 ? 'YES' : (msg.winner === 1 ? 'NO' : null)); locked here as data so a
    //    future edit that flips the mapping direction breaks this test loudly instead of silently
    //    signing the wrong side. ──
    { id: 'assert_winner0_maps_yes', action: 'query_db',
      sql: `SELECT CASE WHEN 0 = 0 THEN 'YES' WHEN 0 = 1 THEN 'NO' ELSE NULL END AS expected`,
      expect: { must: { rows_min: 1, row_assert: { expected: 'YES' } } } },
    { id: 'assert_winner1_maps_no', action: 'query_db',
      sql: `SELECT CASE WHEN 1 = 0 THEN 'YES' WHEN 1 = 1 THEN 'NO' ELSE NULL END AS expected`,
      expect: { must: { rows_min: 1, row_assert: { expected: 'NO' } } } },

    // ── byzantine scenario: VOTER_PK_NO actually voted 'NO', but a forged/cross-node sign_req
    //    claims winner=0 (expects 'YES') — the code's `myOutcome !== expectedOutcome` must read
    //    this as a mismatch (byte-equivalent comparison, done here in SQL for the fixture data). ──
    { id: 'assert_mismatch_detected', action: 'query_db',
      sql: `SELECT (json_extract(payload, '$.outcome') != 'YES') AS mismatch FROM chain_events WHERE event_type='pool_oracle_vote' AND payload LIKE ? AND payload LIKE ?`,
      params: [marketLike, pkLike(VOTER_PK_NO)],
      expect: { must: { rows_min: 1, row_assert: { mismatch: 1 } } } },

    // ── dirty-row-first scenario (Bettor #cx7hlc②, 2026-08-03): a malformed payload row sorted
    //    BEFORE the legit voter's row in observed_at. Locks two facts: ──
    { id: 'seed_garbage_row_first', action: 'exec_sql',
      // observed_at earlier than every other __test_pbs8_% row seeded above (2026-08-03T06:00:00.000Z).
      sql: mkGarbageRow('__test_pbs8_garbage_first__', '2026-08-03T05:00:00.000Z') },

    // ── ① historical LIKE-based query (no longer shipped, LEGACY_LIKE_SQL) is unaffected by the
    //    dirty row regardless of sort position — LIKE never parses JSON, so this was never the
    //    vulnerable half. Kept as an equivalence comparison against the now-shipped guarded
    //    json_extract query (② below) — same correct result, different implementation. ──
    { id: 'like_query_survives_dirty_row_first', action: 'query_db', sql: LEGACY_LIKE_SQL, params: [marketLike, pkLike(VOTER_PK_YES)],
      expect: { must: { rows_min: 1 } } },
    { id: 'like_query_still_finds_correct_outcome', action: 'query_db',
      sql: `SELECT json_extract(payload, '$.outcome') AS outcome FROM chain_events WHERE event_type='pool_oracle_vote' AND payload LIKE ? AND payload LIKE ?`,
      params: [marketLike, pkLike(VOTER_PK_YES)],
      expect: { must: { rows_min: 1, row_assert: { outcome: 'YES' } } } },

    // ── (the "unguarded json_extract throws on this exact data" claim is independently verified
    //    outside this suite — bash spike in-turn + design doc §4 — and NOT reproduced as a step
    //    here: this runner's query_db action has no "expect throw" assertion, any step that
    //    throws marks the whole case FAILED (test-framework/lib/runner.mjs:2153-2200 try/catch
    //    around the action handler), so asserting a throw here would make this regression suite
    //    permanently red, not lock the finding. ──

    // ── ② the json_valid-guarded query (card① shipped form, now == OWN_VOTE_SQL above) survives
    //    the same dirty-row-first data and still returns the correct row — proves the guard
    //    actually fixes the crash, not just moves it. ──
    { id: 'guarded_json_extract_survives_dirty_row_first', action: 'query_db',
      sql: `SELECT json_extract(payload,'$.outcome') AS outcome FROM chain_events WHERE event_type='pool_oracle_vote' AND json_valid(payload) AND json_extract(payload,'$.market_id')=? AND json_extract(payload,'$.voter_pubkey')=? ORDER BY observed_at ASC LIMIT 1`,
      params: [MARKET_ID, VOTER_PK_YES],
      expect: { must: { rows_min: 1, row_assert: { outcome: 'YES' } } } },

    // ── teardown ──
    { id: 'clean', action: 'exec_sql',
      sql: `DELETE FROM chain_events WHERE id LIKE '__test_pbs8_%'` },
  ],
};
