/**
 * P0.2 §3.6 — POST /api/exchange/cancel endpoint contract + state guard
 *
 * NWT spec ea519032a v0.2 §3.6, J2 ship P0.2 sub #7/9.
 *
 * Coverage: missing-field 400 + offer_not_found 404 + processCancel 失败 400 (非 open OR 非 maker).
 *
 * 跑法: node scripts/test.mjs --domain=exchange
 */

import { relayId } from '../../lib/peers.mjs';

const TEST_OFFER_ID = `test-cancel-${Date.now().toString(36)}`;

export default {
  id: 'exchange_cancel_releases_fund_lock',
  description: 'POST /api/exchange/cancel: missing 400 + not_found 404 + non-open 400 guards',
  domain: 'exchange',
  tags: ['p0', 'p0.2', 'protocol', 'exchange', 'state-guard', 'regression'],
  steps: [
    // 1. missing relayNodeId → 400
    {
      action: 'http_post',
      url: '/api/exchange/cancel',
      body: { offer_id: 'whatever' },
      expect: { must: { http_status_equals: 400, reply_contains: 'relayNodeId' } },
    },
    // 2. offer_not_found → 404
    {
      action: 'http_post',
      url: '/api/exchange/cancel',
      body: { relayNodeId: relayId('trader-b'), offer_id: 'nonexistent-cancel-xyz' },
      expect: { must: { http_status_equals: 404, reply_contains: 'not found' } },
    },
    // 3. setup matched offer (非 open) → cancel by maker should fail (only open is cancellable)
    {
      action: 'exec_sql',
      sql: `INSERT INTO exchange_offers (id, maker, give_asset, give_amount, want_asset, want_amount, protocol_status, market_key, verification, is_fully_observed, created_at, updated_at, broadcast_at, broadcast_tx_id, metadata)
            VALUES (?, 'wrong-maker', 'KAS', '10', 'USDT', '0.4', 'matched', 'KAS-USDT', 'manual', 1, datetime('now'), datetime('now'), datetime('now'), ?, ?)`,
      params: [TEST_OFFER_ID, 'c'.repeat(64), JSON.stringify({ tag: TEST_OFFER_ID })],
    },
    {
      action: 'http_post',
      url: '/api/exchange/cancel',
      body: { relayNodeId: relayId('trader-b'), offer_id: TEST_OFFER_ID },
      expect: { must: { http_status_equals: 400, reply_contains: 'Cancel failed' } },
    },
    // cleanup
    { action: 'exec_sql', sql: "DELETE FROM exchange_offers WHERE id = ?", params: [TEST_OFFER_ID] },
  ],
};
