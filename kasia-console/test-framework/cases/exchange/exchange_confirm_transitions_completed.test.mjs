/**
 * P0.2 §3.4 — POST /api/exchange/confirm endpoint contract + state guard
 *
 * NWT spec ea519032a v0.2 §3.4, J2 ship P0.2 sub #5/9.
 *
 * Coverage: missing-field 400 (relayNodeId/offer_id/role required) + processManualConfirm guard
 * (confirm 失败 → 400) — protocol contract regression.
 *
 * 跑法: node scripts/test.mjs --domain=exchange
 */

import { relayId } from '../../lib/peers.mjs';

export default {
  id: 'exchange_confirm_transitions_completed',
  description: 'POST /api/exchange/confirm: missing-field 400 + processManualConfirm fail 400 guards',
  domain: 'exchange',
  tags: ['p0', 'p0.2', 'protocol', 'exchange', 'state-guard', 'regression'],
  steps: [
    // 1. missing role → 400
    {
      action: 'http_post',
      url: '/api/exchange/confirm',
      body: { relayNodeId: relayId('trader-b'), offer_id: 'whatever' },
      expect: { must: { http_status_equals: 400, reply_contains: 'role' } },
    },
    // 2. missing relayNodeId → 400
    {
      action: 'http_post',
      url: '/api/exchange/confirm',
      body: { offer_id: 'whatever', role: 'maker' },
      expect: { must: { http_status_equals: 400, reply_contains: 'relayNodeId' } },
    },
    // 3. confirm on nonexistent offer → 400 (processManualConfirm returns null)
    {
      action: 'http_post',
      url: '/api/exchange/confirm',
      body: { relayNodeId: relayId('trader-b'), offer_id: 'nonexistent-confirm-xyz', role: 'maker' },
      expect: { must: { http_status_equals: 400, reply_contains: 'Confirm failed' } },
    },
  ],
};
