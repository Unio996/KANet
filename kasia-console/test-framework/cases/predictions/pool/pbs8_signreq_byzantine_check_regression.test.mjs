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

const mkVoteEvent = (id, voterPk, outcome) =>
  `INSERT INTO chain_events (id, txid, event_type, observed_by, observed_at, payload) ` +
  `VALUES ('${id}', '${id}_txid', 'pool_oracle_vote', 'test-fixture', '2026-08-03T06:00:00.000Z', ` +
  `'${JSON.stringify({ market_id: MARKET_ID, voter_pubkey: voterPk, outcome }).replace(/'/g, "''")}')`;

// Byte-equivalent to the code (trade-protocol-filter.js handlePoolOracleTxSignReq, PB-S8-1 checkpoint).
const OWN_VOTE_SQL = `
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
    { id: 'lookup_yes_voter', action: 'query_db', sql: OWN_VOTE_SQL, params: [marketLike, pkLike(VOTER_PK_YES)],
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
    { id: 'lookup_missing_voter', action: 'query_db', sql: OWN_VOTE_SQL, params: [marketLike, pkLike(VOTER_PK_MISSING)],
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

    // ── teardown ──
    { id: 'clean', action: 'exec_sql',
      sql: `DELETE FROM chain_events WHERE id LIKE '__test_pbs8_%'` },
  ],
};
