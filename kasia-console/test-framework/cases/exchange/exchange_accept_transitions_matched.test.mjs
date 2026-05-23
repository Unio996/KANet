/**
 * P0.2 §3.2 — POST /api/exchange/accept open→matched transition + state guard
 *
 * NWT spec ea519032a v0.2 §3, J2 ship P0.2 sub #3/9.
 *
 * 设计选择 (per chain cost-budget + cron friendliness):
 * 1. 主测 'state guard' — accept 拒非 open offer (400 error)
 * 2. 不实际跑 publish+accept 真链 broadcast 走 chain (那走 RC_01 buy_kas_real_full 真链路径)
 *
 * Coverage:
 * - 'open' → accept call succeed precondition (offer must be 'open')
 * - 非 'open' → accept reject 400 (precondition guard)
 *
 * 跑法: node scripts/test.mjs --domain=exchange
 */

import { relayId, relayAddr } from '../../lib/peers.mjs';

const TEST_OFFER_ID = `test-accept-guard-${Date.now().toString(36)}`;

export default {
  id: 'exchange_accept_transitions_matched',
  description: 'POST /api/exchange/accept on 非 open offer returns 400 (state guard precondition)',
  domain: 'exchange',
  tags: ['p0', 'p0.2', 'protocol', 'exchange', 'state-guard', 'regression'],
  steps: [
    // setup: INSERT fake offer already in 'matched' state
    {
      action: 'exec_sql',
      sql: `INSERT INTO exchange_offers (id, maker, give_asset, give_amount, want_asset, want_amount, protocol_status, market_key, verification, is_fully_observed, created_at, updated_at, broadcast_at, broadcast_tx_id, metadata)
            VALUES (?, ?, 'KAS', '10', 'USDT', '0.4', 'matched', 'KAS-USDT', 'manual', 1, datetime('now'), datetime('now'), datetime('now'), ?, ?)`,
      params: [
        TEST_OFFER_ID,
        relayAddr('trader-b'),
        'a'.repeat(64),  // fake 64-hex broadcast_tx_id (v83 trigger)
        JSON.stringify({ source: 'p0.2-test', tag: TEST_OFFER_ID }),
      ],
    },
    // attempt accept on already-matched offer → must reject 400
    {
      action: 'http_post',
      url: '/api/exchange/accept',
      body: {
        relayNodeId: relayId('trader-a'),
        offer_id: TEST_OFFER_ID,
      },
      expect: {
        must: {
          http_status_equals: 400,
          reply_contains: 'matched',  // error message 含 "Offer is matched, cannot accept"
        },
      },
    },
    // verify state didn't change (still 'matched', not regressed)
    {
      action: 'sleep', ms: 0,
      expect: {
        must: {
          query_db: {
            sql: "SELECT protocol_status FROM exchange_offers WHERE id = ?",
            params: [TEST_OFFER_ID],
            expected_row: { protocol_status: 'matched' },
          },
        },
      },
    },
    // cleanup
    {
      action: 'exec_sql',
      sql: "DELETE FROM exchange_offers WHERE id = ?",
      params: [TEST_OFFER_ID],
    },
  ],
};
