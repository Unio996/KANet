// kasia-console/src/services/projection.js
//
// T3.4 (per task PZ-MATCHER-shipT3 v1.1 §T3.4 + 决断 2 read-only consistency helper).
//
// Read-only chain-truth projection helpers. INVARIANTS §9 spec spirit honor (chain truth +
// projection rebuild capability) without big-bang refactor of 14 existing SQL UPDATE writers.
//
// deriveProtocolStatus(offerId, db) — replay broadcast_messages.content per offer to derive
// canonical protocol_status from chain truth (NOT db cache).
// verifyProtocolStatusConsistency(offerId, db) — compare db cache vs derived for drift detection.

import { sqlite as defaultDb } from '../db/client.js';

// event_type → state mapping (chain TX `t` field → exchange_offers.protocol_status)
// Source: kasia-console/src/services/trade-protocol-filter.js EXCHANGE_MSG constants
// + handler dispatch logic (handleExchange/Accept/Paid/Delivered/Cancel/Timeout/Dispute/Resolve).
export const STATE_TRANSITIONS = {
  'kanet_exchange_v1':           'open',
  'kanet_exchange_accept_v1':    'matched',
  'kanet_exchange_paid_v1':      'verifying',
  'kanet_exchange_delivered_v1': 'delivering',
  'kanet_exchange_completed_v1': 'completed',
  'kanet_exchange_dispute_v1':   'disputed',
  'kanet_exchange_cancel_v1':    'cancelled',
  'kanet_exchange_timeout_v1':   'timed_out',
  'kanet_exchange_resolve_v1':   'completed',
};

/**
 * Replay broadcast_messages.content for offerId to derive current protocol_status.
 * 0 own state (no cache) — fetch fresh per call. Chain truth = sole source.
 *
 * @param {string} offerId
 * @param {object} [db=defaultDb] — sqlite handle (test injection)
 * @returns {string} derived state ('open' | 'matched' | 'verifying' | ...)
 */
export function deriveProtocolStatus(offerId, db = defaultDb) {
  const events = db.prepare(`
    SELECT content, created_at
    FROM broadcast_messages
    WHERE content LIKE '%' || ? || '%'
      AND content LIKE '%kanet_exchange_%'
    ORDER BY created_at ASC
  `).all(offerId);

  let state = 'open';
  for (const e of events) {
    let payload;
    try { payload = JSON.parse(e.content); } catch { continue; }
    // publish event uses `id` (per exchange.js:158), all other events use `offer_id`
    const matches = payload?.id === offerId || payload?.offer_id === offerId;
    if (!matches) continue;
    const next = STATE_TRANSITIONS[payload.t];
    if (next) state = next;
  }
  return state;
}

/**
 * Compare db cache vs chain-derived state for a single offer.
 * Drift detection — surfaces races / silent failures / writer bugs.
 *
 * @param {string} offerId
 * @param {object} [db=defaultDb]
 * @returns {{ dbStatus: string|null, derivedStatus: string, consistent: boolean }}
 */
export function verifyProtocolStatusConsistency(offerId, db = defaultDb) {
  const row = db.prepare('SELECT protocol_status FROM exchange_offers WHERE id = ?').get(offerId);
  const dbStatus = row?.protocol_status || null;
  const derivedStatus = deriveProtocolStatus(offerId, db);
  return { dbStatus, derivedStatus, consistent: dbStatus === derivedStatus };
}
