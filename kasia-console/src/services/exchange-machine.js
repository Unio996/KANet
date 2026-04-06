/**
 * Exchange State Machine — protocol-level free market.
 *
 * Design doc: exchange-state-machine-v1.0.md
 *
 * This state machine does NOT know what asset is being traded.
 * It does NOT know how verification works internally.
 * It only routes between protocol states based on verifier results.
 *
 * Protocol states: open → matched → verifying|awaiting_manual_confirm → completed|disputed|timed_out
 * Cancel: only from open. After matched, cancel is ignored.
 */

import { sqlite } from '../db/client.js';
import { getVerifier } from './exchange-verifiers.js';
import crypto from 'crypto';

// ── Valid Transitions ─────────────────────────────────────────

const VALID_TRANSITIONS = {
  open:                     ['matched', 'cancelled', 'expired'],
  matched:                  ['verifying', 'awaiting_manual_confirm', 'awaiting_oracle'],
  verifying:                ['completed', 'disputed', 'timed_out'],
  awaiting_manual_confirm:  ['completed', 'disputed', 'timed_out'],
  awaiting_oracle:          ['completed', 'failed', 'timed_out'],
};

// Terminal states — no further transitions allowed
const TERMINAL = new Set(['completed', 'disputed', 'timed_out', 'failed', 'cancelled', 'expired']);

// ── State Transitions ─────────────────────────────────────────

/**
 * Transition an offer to a new protocol_status.
 * Enforces valid transitions. Sets timestamps and is_fully_observed.
 */
function transition(offerId, newStatus, extra = {}) {
  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offerId);
  if (!offer) throw new Error(`Offer not found: ${offerId}`);

  if (TERMINAL.has(offer.protocol_status)) {
    console.log(`[exchange-machine] ${offerId.slice(0, 8)} already terminal: ${offer.protocol_status}`);
    return offer;
  }

  const allowed = VALID_TRANSITIONS[offer.protocol_status];
  if (!allowed || !allowed.includes(newStatus)) {
    console.log(`[exchange-machine] Invalid transition: ${offer.protocol_status} → ${newStatus}`);
    return offer;
  }

  const now = new Date().toISOString();
  const updates = ['protocol_status = ?', 'updated_at = ?'];
  const vals = [newStatus, now];

  // Set status-specific timestamps
  const tsMap = {
    matched:                 'matched_at',
    verifying:               'verifying_started_at',
    awaiting_manual_confirm: 'verifying_started_at',
    awaiting_oracle:         'verifying_started_at',
    completed:               'completed_at',
    disputed:                'disputed_at',
    timed_out:               'timed_out_at',
    cancelled:               'cancelled_at',
  };
  if (tsMap[newStatus]) {
    updates.push(`${tsMap[newStatus]} = ?`);
    vals.push(now);
  }

  // Terminal states → is_fully_observed = true
  if (TERMINAL.has(newStatus)) {
    updates.push('is_fully_observed = 1');
  }

  // Extra fields (taker, accept_commitment, etc.)
  for (const [k, v] of Object.entries(extra)) {
    updates.push(`${k} = ?`);
    vals.push(v);
  }

  vals.push(offerId);
  sqlite.prepare(`UPDATE exchange_offers SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

  console.log(`[exchange-machine] ${offerId.slice(0, 8)}: ${offer.protocol_status} → ${newStatus}`);

  return sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offerId);
}

// ── Accept Logic ──────────────────────────────────────────────

/**
 * Process a kanet_accept_v1 message.
 * First-valid-accept wins (per this node's observation).
 *
 * @param {object} msg — { offer_id, _from, _tx, accept_commitment? }
 * @returns {object|null} updated offer or null if rejected
 */
export function processAccept(msg) {
  if (!msg.offer_id) return null;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  if (!offer) {
    console.log(`[exchange-machine] Accept for unknown offer: ${msg.offer_id}`);
    return null;
  }

  // Only open offers can be accepted
  if (offer.protocol_status !== 'open') {
    console.log(`[exchange-machine] Accept rejected: offer ${msg.offer_id.slice(0, 8)} is ${offer.protocol_status}`);
    return null;
  }

  // Check expiry
  if (offer.expires_at && new Date() > new Date(offer.expires_at)) {
    transition(offer.id, 'expired');
    return null;
  }

  // Validate accept_commitment (if provided)
  const commitment = msg.accept_commitment || crypto.createHash('sha256')
    .update(`${msg.offer_id}${msg._from}${Date.now()}`)
    .digest('hex');

  // Transition: open → matched
  const matched = transition(offer.id, 'matched', {
    taker: msg._from,
    taker_tx_id: msg._tx,
    accept_commitment: commitment,
  });

  // Route to verification
  return routeToVerification(matched);
}

// ── Verification Routing ──────────────────────────────────────

/**
 * Route a matched offer to the appropriate verification state.
 * Based on offer.verification field — the verifier defines the next state.
 *
 * @param {object} offer — must be in 'matched' status
 * @returns {object} updated offer
 */
function routeToVerification(offer) {
  if (offer.protocol_status !== 'matched') return offer;

  const vType = offer.verification || 'manual';
  const verifier = getVerifier(vType);

  // Determine target state based on verification type
  let targetState;
  if (vType === 'manual') {
    targetState = 'awaiting_manual_confirm';
  } else if (vType === 'oracle') {
    targetState = 'awaiting_oracle';
  } else {
    targetState = 'verifying';
  }

  const updated = transition(offer.id, targetState);

  // Start the verifier
  const matchContext = {
    offer: updated,
    accept: { taker: offer.taker, tx: offer.taker_tx_id, commitment: offer.accept_commitment },
    matched_at: updated.matched_at,
    timeout_at: updated.expires_at, // reuse offer expiry as verification timeout
  };

  verifier.start(matchContext).then(result => {
    console.log(`[exchange-machine] ${offer.id.slice(0, 8)} verifier ${vType} started: ${result.status} - ${result.message || ''}`);
  }).catch(err => {
    console.error(`[exchange-machine] verifier start error: ${err.message}`);
  });

  return updated;
}

// ── Manual Confirm ────────────────────────────────────────────

/**
 * Process a kanet_confirm_v1 message (manual verification).
 *
 * @param {object} msg — { offer_id, role: 'maker'|'taker', confirmer_address, _tx }
 * @returns {object|null}
 */
export function processManualConfirm(msg) {
  if (!msg.offer_id || !msg.role) return null;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  if (!offer) return null;

  if (offer.protocol_status !== 'awaiting_manual_confirm') {
    console.log(`[exchange-machine] Confirm rejected: offer ${msg.offer_id.slice(0, 8)} is ${offer.protocol_status}`);
    return null;
  }

  // Verify confirmer is the right party
  const isMaker = msg.role === 'maker' && msg.confirmer_address === offer.maker;
  const isTaker = msg.role === 'taker' && msg.confirmer_address === offer.taker;

  if (!isMaker && !isTaker) {
    console.log(`[exchange-machine] Confirm rejected: ${msg.confirmer_address?.slice(-12)} is neither maker nor taker`);
    return null;
  }

  const now = new Date().toISOString();
  if (isMaker && !offer.maker_confirmed_at) {
    sqlite.prepare('UPDATE exchange_offers SET maker_confirmed_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, offer.id);
    console.log(`[exchange-machine] ${offer.id.slice(0, 8)} maker confirmed`);
  }
  if (isTaker && !offer.taker_confirmed_at) {
    sqlite.prepare('UPDATE exchange_offers SET taker_confirmed_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, offer.id);
    console.log(`[exchange-machine] ${offer.id.slice(0, 8)} taker confirmed`);
  }

  // Re-read and check if both confirmed
  const updated = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer.id);
  if (updated.maker_confirmed_at && updated.taker_confirmed_at) {
    return transition(offer.id, 'completed');
  }

  return updated;
}

// ── Cancel ────────────────────────────────────────────────────

/**
 * Process a kanet_cancel_v1 (exchange version).
 * Only valid from 'open' status, only by maker.
 */
export function processCancel(msg) {
  if (!msg.offer_id) return null;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(msg.offer_id);
  if (!offer) return null;

  if (offer.protocol_status !== 'open') {
    console.log(`[exchange-machine] Cancel ignored: offer ${msg.offer_id.slice(0, 8)} is ${offer.protocol_status} (cancel only from open)`);
    return null;
  }

  if (offer.maker !== msg._from) {
    console.log(`[exchange-machine] Cancel rejected: ${msg._from?.slice(-12)} is not maker`);
    return null;
  }

  return transition(offer.id, 'cancelled');
}

// ── Expiry Check ──────────────────────────────────────────────

/**
 * Expire stale offers. Called periodically.
 * @returns {number} count of expired offers
 */
export function expireStale() {
  const now = new Date().toISOString();
  const stale = sqlite.prepare(
    `SELECT id FROM exchange_offers
     WHERE protocol_status = 'open' AND expires_at IS NOT NULL AND expires_at < ?`
  ).all(now);

  for (const { id } of stale) {
    transition(id, 'expired');
  }

  return stale.length;
}

/**
 * Check and timeout verification in progress. Called periodically.
 * @returns {number} count of timed out offers
 */
export function timeoutVerifying() {
  const now = new Date().toISOString();
  const stuck = sqlite.prepare(
    `SELECT id, verification FROM exchange_offers
     WHERE protocol_status IN ('verifying', 'awaiting_manual_confirm', 'awaiting_oracle')
     AND expires_at IS NOT NULL AND expires_at < ?`
  ).all(now);

  for (const { id } of stuck) {
    transition(id, 'timed_out');
  }

  return stuck.length;
}

// ── Payment Submit (cross_chain_tx / kaspa_tx verification) ──

/**
 * Taker submits a payment TX hash for on-chain verification.
 * Writes to verification_meta, kicks off async verification.
 */
export function processPaymentSubmit({ offer_id, payment_tx, payment_chain }) {
  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
  if (!offer) return { error: 'offer_not_found' };
  if (offer.protocol_status !== 'verifying') return { error: 'invalid_status', current: offer.protocol_status };
  if (!payment_tx) return { error: 'payment_tx_required' };

  const now = new Date().toISOString();
  const meta = JSON.parse(offer.verification_meta || '{}');
  meta.payment_tx = payment_tx;
  meta.payment_chain = payment_chain;
  meta.submitted_at = now;

  sqlite.prepare(
    'UPDATE exchange_offers SET verification_meta = ?, updated_at = ? WHERE id = ?'
  ).run(JSON.stringify(meta), now, offer_id);

  // Async verification — does not block API response
  _verifyAndComplete(offer_id, payment_tx, payment_chain).catch(err =>
    console.error(`[exchange] _verifyAndComplete error offer=${offer_id.slice(0,8)}:`, err.message)
  );

  return { ok: true, status: 'verifying', message: 'Payment submitted, verifying on-chain...' };
}

async function _verifyAndComplete(offer_id, payment_tx, payment_chain, attempt = 1) {
  const MAX_ATTEMPTS = 3;
  const RETRY_MS = 60_000;

  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
  if (!offer || offer.protocol_status !== 'verifying') return;

  const meta = JSON.parse(offer.verification_meta || '{}');
  const expectedAmount = parseFloat(offer.want_amount) || 0;
  const expectedTo = meta.receive_address || null;

  try {
    const { verifyCrossChainTx } = await import('./cross-chain-verify.mjs');
    const vr = await verifyCrossChainTx({
      txHash: payment_tx,
      chain: payment_chain,
      expectedAmount,
      expectedTo,
    });

    if (vr.confirmed) {
      meta.verified_tx = payment_tx;
      meta.verified_at = new Date().toISOString();
      meta.confirmations = vr.confirmations;

      sqlite.prepare(
        'UPDATE exchange_offers SET verification_meta = ?, updated_at = ? WHERE id = ?'
      ).run(JSON.stringify(meta), new Date().toISOString(), offer_id);

      transition(offer_id, 'completed', {});
      console.log(`[exchange] offer ${offer_id.slice(0,8)} payment verified → completed (${vr.actualAmount} USDT, ${vr.confirmations}/${vr.required} conf)`);

    } else if (attempt < MAX_ATTEMPTS) {
      console.log(`[exchange] offer ${offer_id.slice(0,8)} not confirmed yet (attempt ${attempt}/${MAX_ATTEMPTS}): ${vr.error}. Retry in 60s`);
      setTimeout(() => _verifyAndComplete(offer_id, payment_tx, payment_chain, attempt + 1), RETRY_MS);

    } else {
      console.log(`[exchange] offer ${offer_id.slice(0,8)} verification failed after ${MAX_ATTEMPTS} attempts: ${vr.error}`);
    }
  } catch (err) {
    console.error(`[exchange] _verifyAndComplete error:`, err.message);
  }
}
