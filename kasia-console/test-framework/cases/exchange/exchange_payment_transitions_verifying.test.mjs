/**
 * P0.2 §3.3 — POST /api/exchange/submit-payment endpoint contract + state guard
 *
 * NWT spec ea519032a v0.2 §3.3, J2 ship P0.2 sub #4/9.
 *
 * Coverage: missing-field guard (offer_id/payment_tx/payment_chain required) + offer_not_found 404 +
 * "only taker can submit" 403 — protocol-level contract regression guards.
 *
 * 跑法: node scripts/test.mjs --domain=exchange
 */

import { relayId } from '../../lib/peers.mjs';

const TEST_OFFER_ID = `test-paymt-${Date.now().toString(36)}`;

export default {
  id: 'exchange_payment_transitions_verifying',
  description: 'POST /api/exchange/submit-payment: missing-field 400 + offer_not_found 404 + non-taker 403 guards',
  domain: 'exchange',
  tags: ['p0', 'p0.2', 'protocol', 'exchange', 'state-guard', 'regression'],
  steps: [
    // 1. missing payment_tx → 400 + error reply_contains 'required'
    {
      action: 'http_post',
      url: '/api/exchange/submit-payment',
      body: { offer_id: 'whatever', payment_chain: 'bsc' },  // missing payment_tx
      expect: { must: { http_status_equals: 400, reply_contains: 'required' } },
    },
    // 2. offer_not_found → 404
    {
      action: 'http_post',
      url: '/api/exchange/submit-payment',
      body: { relayNodeId: relayId('trader-a'), offer_id: 'nonexistent-id-xyz', payment_tx: '0x' + 'a'.repeat(64), payment_chain: 'bsc' },
      expect: { must: { http_status_equals: 404, reply_contains: 'offer_not_found' } },
    },
    // 3. setup matched offer with taker=trader-b (NOT trader-a) → trader-a 提交 payment 应该 403
    {
      action: 'exec_sql',
      sql: `INSERT INTO exchange_offers (id, maker, taker, give_asset, give_amount, want_asset, want_amount, protocol_status, market_key, verification, is_fully_observed, created_at, updated_at, broadcast_at, broadcast_tx_id, metadata)
            VALUES (?, 'wrong-maker', 'wrong-taker', 'KAS', '10', 'USDT', '0.4', 'matched', 'KAS-USDT', 'manual', 1, datetime('now'), datetime('now'), datetime('now'), ?, ?)`,
      // NWT N19.41 KI 24 fix: random hex (was 'b'.repeat(64), UNIQUE collision risk if stale row persists)
      params: [TEST_OFFER_ID, Array.from({length:64},()=>Math.floor(Math.random()*16).toString(16)).join(''), JSON.stringify({ tag: TEST_OFFER_ID })],
    },
    {
      action: 'http_post',
      url: '/api/exchange/submit-payment',
      body: { relayNodeId: relayId('trader-a'), offer_id: TEST_OFFER_ID, payment_tx: '0x' + 'a'.repeat(64), payment_chain: 'bsc' },
      expect: { must: { http_status_equals: 403, reply_contains: 'only taker' } },
    },
    // cleanup
    { action: 'exec_sql', sql: "DELETE FROM exchange_offers WHERE id = ?", params: [TEST_OFFER_ID] },
  ],
};
