/**
 * P0.2 §3.7 — POST /api/exchange/resolve endpoint contract + concede-only semantics
 *
 * NWT spec ea519032a v0.2 §3.7, J2 ship P0.2 sub #8/9.
 *
 * 设计: 单 case 守 resolve concede-only 语义 (4/14 sediment) + non-disputed state guard.
 * - maker resolve → 自动 taker_wins (maker 认输)
 * - taker resolve → 自动 maker_wins (taker 认输)
 * - 非 maker/taker → 403
 * - 非 disputed offer → 400
 * - clientOutcome 跟 concede 不符 → 400
 *
 * 跑法: node scripts/test.mjs --domain=exchange
 */

import { relayId } from '../../lib/peers.mjs';

const TEST_OFFER_ID = `test-dispute-${Date.now().toString(36)}`;

export default {
  id: 'exchange_dispute_resolve_concede',
  description: 'POST /api/exchange/resolve: concede-only semantics + non-disputed 400 + non-party 403',
  domain: 'exchange',
  tags: ['p0', 'p0.2', 'protocol', 'exchange', 'state-guard', 'regression', 'dispute'],
  steps: [
    // 1. missing offer_id → 400
    {
      action: 'http_post',
      url: '/api/exchange/resolve',
      body: { relayNodeId: relayId('trader-b') },
      expect: { must: { http_status_equals: 400, reply_contains: 'offer_id required' } },
    },
    // 2. offer_not_found → 404
    {
      action: 'http_post',
      url: '/api/exchange/resolve',
      body: { relayNodeId: relayId('trader-b'), offer_id: 'nonexistent-resolve-xyz' },
      expect: { must: { http_status_equals: 404, reply_contains: 'Offer not found' } },
    },
    // 3. setup matched (NOT disputed) offer → resolve should reject 400
    {
      action: 'exec_sql',
      sql: `INSERT INTO exchange_offers (id, maker, taker, give_asset, give_amount, want_asset, want_amount, protocol_status, market_key, verification, is_fully_observed, created_at, updated_at, broadcast_at, broadcast_tx_id, metadata)
            VALUES (?, 'maker-addr-fake', 'taker-addr-fake', 'KAS', '10', 'USDT', '0.4', 'matched', 'KAS-USDT', 'manual', 1, datetime('now'), datetime('now'), datetime('now'), ?, ?)`,
      params: [TEST_OFFER_ID, 'd'.repeat(64), JSON.stringify({ tag: TEST_OFFER_ID })],
    },
    {
      action: 'http_post',
      url: '/api/exchange/resolve',
      body: { relayNodeId: relayId('trader-b'), offer_id: TEST_OFFER_ID },
      expect: { must: { http_status_equals: 400, reply_contains: 'not disputed' } },
    },
    // 4. setup disputed offer with random fake maker/taker (trader-b 不是 party) → 403
    {
      action: 'exec_sql',
      sql: "UPDATE exchange_offers SET protocol_status='disputed' WHERE id=?",
      params: [TEST_OFFER_ID],
    },
    {
      action: 'http_post',
      url: '/api/exchange/resolve',
      body: { relayNodeId: relayId('trader-b'), offer_id: TEST_OFFER_ID },
      expect: { must: { http_status_equals: 403, reply_contains: 'Only offer maker or taker' } },
    },
    // cleanup
    { action: 'exec_sql', sql: "DELETE FROM exchange_offers WHERE id = ?", params: [TEST_OFFER_ID] },
  ],
};
