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
import { executeHedge } from './trade-protocol-filter.js';
import { sendCommandAsync } from './relay-manager.js';
import crypto from 'crypto';

// ── Valid Transitions ─────────────────────────────────────────

const VALID_TRANSITIONS = {
  open:                     ['matched', 'cancelled', 'expired'],
  matched:                  ['verifying', 'awaiting_manual_confirm', 'awaiting_oracle', 'escrow_locked'],
  escrow_locked:            ['verifying', 'awaiting_manual_confirm', 'timed_out'],
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

  // 交割完成 → 升级 maker 和 taker 的 classification 到 verified_agent（只升不降）
  if (newStatus === 'completed' && offer.maker && offer.taker) {
    sqlite.prepare(`
      UPDATE relation_states SET classification = 'verified_agent'
      WHERE peer_address IN (?, ?) AND classification != 'verified_agent'
    `).run(offer.maker, offer.taker);
  }

  return sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offerId);
}

// ── Escrow Integration ───────────────────────────────────────

/**
 * Check if an offer should use P2SH escrow.
 * Condition: maker is a local Agent (has relay_node entry).
 */
function shouldUseEscrow(offer) {
  if (!offer.maker) return false;
  const local = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(offer.maker);
  return !!local;
}

/**
 * Get x-only pubkey for a local relay via IPC.
 */
async function getLocalPubkey32(address) {
  const relay = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(address);
  if (!relay) throw new Error(`No relay for address ${address}`);
  const result = await sendCommandAsync(relay.id, { type: 'get_pubkey' });
  if (!result.pubkey32) throw new Error('get_pubkey returned no pubkey32');
  return { pubkey32: result.pubkey32, relayId: relay.id };
}

/**
 * Create escrow for a matched offer: compile contract + lock funds.
 * Non-blocking — failure logs warning but does not throw.
 */
async function tryCreateAndLockEscrow(offer) {
  try {
    const { pubkey32, relayId } = await getLocalPubkey32(offer.maker);
    // Initial simplification: all three roles use maker's key
    // TODO: get taker pubkey from Agent Card, designate independent arbiter
    const buyerPk32 = pubkey32;
    const sellerPk32 = pubkey32;
    const arbiterPk32 = pubkey32;

    // 1. Create escrow contract
    const createResult = await sendCommandAsync(relayId, {
      type: 'create_escrow', buyerPk32, sellerPk32, arbiterPk32,
    });
    if (createResult.error) throw new Error(createResult.error);

    // 2. Write escrow_states (status=created)
    const escrowId = crypto.randomUUID();
    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO escrow_states
      (id, offer_id, initiator_relay_id, buyer_address, seller_address,
       arbiter_address, p2sh_address, redeem_script_hex, amount_sompi, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?)
    `).run(
      escrowId, offer.id, relayId,
      offer.maker, offer.taker || 'pending', offer.maker,
      createResult.p2shAddress, createResult.redeemScriptHex,
      offer.give_amount || '0', now, now,
    );

    // 3. Lock funds into P2SH
    const amountKas = (Number(offer.give_amount || 0) / 1e8).toString();
    const lockResult = await sendCommandAsync(relayId, {
      type: 'lock_escrow', p2shAddress: createResult.p2shAddress, amountKas,
    });
    if (lockResult.error) throw new Error(lockResult.error);

    // 4. Update escrow status
    sqlite.prepare(
      "UPDATE escrow_states SET status = 'locked', lock_txid = ?, updated_at = ? WHERE id = ?"
    ).run(lockResult.txId, new Date().toISOString(), escrowId);

    // 5. Transition offer
    transition(offer.id, 'escrow_locked');
    console.log(`[escrow] ${offer.id.slice(0, 8)} locked ${amountKas} KAS → ${createResult.p2shAddress.slice(-12)} TX: ${lockResult.txId}`);
    return true;
  } catch (e) {
    console.log(`[escrow] ${offer.id.slice(0, 8)} escrow failed (non-blocking): ${e.message}`);
    return false;
  }
}

/**
 * Execute escrow on offer completion/dispute/timeout.
 */
async function tryExecuteEscrow(offerId, branch) {
  const escrow = sqlite.prepare(
    "SELECT * FROM escrow_states WHERE offer_id = ? AND status = 'locked'"
  ).get(offerId);
  if (!escrow) return; // no escrow for this offer

  try {
    const toAddress = branch === 0 ? escrow.seller_address : escrow.buyer_address;
    const lockTime = (branch === 1 && escrow.deadline) ? escrow.deadline : 0;
    const result = await sendCommandAsync(escrow.initiator_relay_id, {
      type: 'execute_escrow',
      p2shAddress: escrow.p2sh_address,
      redeemScriptHex: escrow.redeem_script_hex,
      branch, toAddress, lockTime,
    });
    if (result.error) throw new Error(result.error);

    const statusMap = { 0: 'released', 1: 'refunded', 2: 'released' };
    sqlite.prepare(
      'UPDATE escrow_states SET status = ?, unlock_txid = ?, updated_at = ? WHERE id = ?'
    ).run(statusMap[branch], result.txId, new Date().toISOString(), escrow.id);

    const branchNames = ['release', 'refund', 'arbitrate'];
    console.log(`[escrow] ${offerId.slice(0, 8)} ${branchNames[branch]} → ${toAddress.slice(-12)} TX: ${result.txId}`);
  } catch (e) {
    console.log(`[escrow] ${offerId.slice(0, 8)} execute failed: ${e.message}`);
  }
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

  // Try P2SH escrow (non-blocking — failure degrades gracefully)
  if (shouldUseEscrow(matched)) {
    tryCreateAndLockEscrow(matched).then(ok => {
      if (ok) {
        // escrow_locked → continue to verification
        const updated = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(matched.id);
        routeToVerification(updated);
      } else {
        // escrow failed, proceed without escrow
        routeToVerification(matched);
      }
    });
    return matched; // return immediately, escrow runs async
  }

  // Route to verification (no escrow path)
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
    const completed = transition(offer.id, 'completed');
    tryExecuteEscrow(offer.id, 0); // release → seller
    return completed;
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
     WHERE protocol_status IN ('verifying', 'awaiting_manual_confirm', 'awaiting_oracle', 'escrow_locked')
     AND expires_at IS NOT NULL AND expires_at < ?`
  ).all(now);

  for (const { id } of stuck) {
    transition(id, 'timed_out');
    tryExecuteEscrow(id, 1); // refund → buyer
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

      const completedOffer = transition(offer_id, 'completed', {});
      tryExecuteEscrow(offer_id, 0); // release → seller
      console.log(`[exchange] offer ${offer_id.slice(0,8)} payment verified → completed (${vr.actualAmount} USDT, ${vr.confirmations}/${vr.required} conf)`);

      // Trigger hedge after cross_chain_tx verification → completed
      if (completedOffer?.maker) {
        const localAgent = sqlite.prepare('SELECT id, name FROM relay_nodes WHERE address = ?').get(completedOffer.maker);
        if (localAgent) {
          const makerGaveKas = completedOffer.give_asset === 'KAS';
          const hedgeSide = makerGaveKas ? 'BUY' : 'SELL';
          const hedgeQty = makerGaveKas ? parseFloat(completedOffer.give_amount) : parseFloat(completedOffer.want_amount);
          if (hedgeQty > 0) {
            setImmediate(() => {
              executeHedge(completedOffer.id, localAgent.name, hedgeSide, hedgeQty).catch(err =>
                console.error(`[exchange-hedge] verify-complete-path trigger error: ${err.message}`)
              );
            });
          }
        }
      }

    } else if (attempt < MAX_ATTEMPTS) {
      console.log(`[exchange] offer ${offer_id.slice(0,8)} not confirmed yet (attempt ${attempt}/${MAX_ATTEMPTS}): ${vr.error}. Retry in 60s`);
      setTimeout(() => _verifyAndComplete(offer_id, payment_tx, payment_chain, attempt + 1), RETRY_MS);

    } else {
      // Auto-dispute after MAX_ATTEMPTS failed verifications
      console.log(`[exchange] offer ${offer_id.slice(0,8)} auto-dispute after ${MAX_ATTEMPTS} failed verifications`);
      const dmeta = JSON.parse(offer.verification_meta || '{}');
      dmeta.dispute_reason = `Auto-dispute: verification failed ${MAX_ATTEMPTS} times. Last error: ${vr.error}`;
      dmeta.dispute_by = 'system';
      dmeta.dispute_at = new Date().toISOString();
      sqlite.prepare(
        'UPDATE exchange_offers SET verification_meta = ?, updated_at = ? WHERE id = ?'
      ).run(JSON.stringify(dmeta), new Date().toISOString(), offer_id);
      transition(offer_id, 'disputed', {});
    }
  } catch (err) {
    console.error(`[exchange] _verifyAndComplete error:`, err.message);
  }
}

// ── Dispute ──────────────────────────────────────────────────

/**
 * Maker or taker raises a dispute on an in-progress offer.
 */
export function processDispute({ offer_id, disputer_address, reason }) {
  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
  if (!offer) return { error: 'offer_not_found' };

  const isParty = offer.maker === disputer_address || offer.taker === disputer_address;
  if (!isParty) return { error: 'only_parties_can_dispute' };

  const DISPUTABLE = ['verifying', 'awaiting_manual_confirm', 'matched'];
  if (!DISPUTABLE.includes(offer.protocol_status)) {
    return { error: 'invalid_status', current: offer.protocol_status };
  }

  const meta = JSON.parse(offer.verification_meta || '{}');
  meta.dispute_reason = reason || 'No reason provided';
  meta.dispute_by = disputer_address;
  meta.dispute_at = new Date().toISOString();

  sqlite.prepare(
    'UPDATE exchange_offers SET verification_meta = ?, updated_at = ? WHERE id = ?'
  ).run(JSON.stringify(meta), new Date().toISOString(), offer_id);

  transition(offer_id, 'disputed', {});
  tryExecuteEscrow(offer_id, 2); // arbitrate
  console.log(`[exchange] offer ${offer_id.slice(0,8)} disputed by ${disputer_address.slice(-8)}: ${reason}`);

  return { ok: true, status: 'disputed' };
}
