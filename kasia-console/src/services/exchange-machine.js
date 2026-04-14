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
import { createExecution, completeExecution } from './execution-state.js';
import { recordChainEvent } from './chain-event.js';
import { executeHedge } from './trade-protocol-filter.js';
import { releaseFunds, spendFunds } from './fund-lock.js';
import crypto from 'crypto';

// ── Valid Transitions ─────────────────────────────────────────

const VALID_TRANSITIONS = {
  open:                     ['matched', 'cancelled', 'expired'],
  matched:                  ['verifying', 'awaiting_manual_confirm', 'awaiting_oracle'],
  verifying:                ['delivering', 'disputed', 'timed_out'],
  delivering:               ['completed', 'verified', 'disputed'],  // verified = revert on delivery failure
  verified:                 ['delivering', 'disputed', 'timed_out'], // delivery retry or manual intervention
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
export function transition(offerId, newStatus, extra = {}) {
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
    delivering:              'delivering_at',
    completed:               'completed_at',
    disputed:                'disputed_at',
    timed_out:               'timed_out_at',
    cancelled:               'cancelled_at',
  };
  if (tsMap[newStatus]) {
    updates.push(`${tsMap[newStatus]} = ?`);
    vals.push(now);
  }

  // Terminal states → is_fully_observed = true + fund lock resolution
  // IMPORTANT: both paths must run for ANY terminal transition. handleExchangeDelivered
  // in trade-protocol-filter.js used to bypass transition() with direct SQL UPDATE,
  // which caused fund_lock leaks on completed. See Phase 1 stress test S9 finding.
  if (TERMINAL.has(newStatus)) {
    updates.push('is_fully_observed = 1');
    if (newStatus === 'completed') {
      // Delivery completed → mark funds as spent (idempotent; safe to call twice)
      try { spendFunds(offerId); } catch (e) { console.error(`[exchange-machine] spendFunds error: ${e.message}`); }
    } else {
      // Cancel/expire/dispute/timed_out/failed → release fund locks
      try { releaseFunds(offerId); } catch (e) { console.error(`[exchange-machine] releaseFunds error: ${e.message}`); }
    }
  }

  // Extra fields (taker, accept_commitment, etc.)
  for (const [k, v] of Object.entries(extra)) {
    updates.push(`${k} = ?`);
    vals.push(v);
  }

  vals.push(offerId);
  sqlite.prepare(`UPDATE exchange_offers SET ${updates.join(', ')} WHERE id = ?`).run(...vals);

  console.log(`[exchange-machine] ${offerId.slice(0, 8)}: ${offer.protocol_status} → ${newStatus}`);

  // ── execution_states: 每次状态变更都记录审计追踪 ──
  try {
    const agentAddr = offer.maker || offer.taker || 'system';
    const execType = `exchange_${newStatus}`;
    const exec = createExecution({
      orderId: offerId,
      type: execType,
      source: 'exchange-machine',
      agentAddress: agentAddr,
      displaySummary: `${offer.give_amount} ${offer.give_asset} → ${offer.want_amount} ${offer.want_asset}: ${offer.protocol_status} → ${newStatus}`,
    });
    if (exec.isNew && TERMINAL.has(newStatus)) {
      completeExecution(exec.id, { summary: `Exchange offer ${newStatus}` });
    }
  } catch (execErr) {
    console.warn(`[exchange-machine] execution_state recording failed: ${execErr.message}`);
  }

  // ── chain_events: 每次状态变更都留链上审计痕迹 ──
  try {
    recordChainEvent({
      txid: extra.txHash || extra.taker_tx_id || null,
      eventType: `exchange_${newStatus}`,
      fromAddress: offer.maker,
      toAddress: offer.taker,
      payload: JSON.stringify({
        offer_id: offerId,
        give_asset: offer.give_asset, give_amount: offer.give_amount,
        want_asset: offer.want_asset, want_amount: offer.want_amount,
        from_status: offer.protocol_status, to_status: newStatus,
      }),
    });
  } catch (evtErr) {
    console.warn(`[exchange-machine] chain_event recording failed: ${evtErr.message}`);
  }

  // 交割完成 → 升级 maker 和 taker 的 classification 到 verified_agent（只升不降）
  if (newStatus === 'completed' && offer.maker && offer.taker) {
    sqlite.prepare(`
      UPDATE relation_states SET classification = 'verified_agent'
      WHERE peer_address IN (?, ?) AND classification != 'verified_agent'
    `).run(offer.maker, offer.taker);
  }

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

  // Self-accept prevention: maker cannot accept own offer
  if (msg._from && msg._from === offer.maker) {
    console.log(`[exchange-machine] Accept rejected: self-accept (maker === taker: ${msg._from.slice(-12)})`);
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

  // Write taker_chain + taker_payment_address from accept message (cross-node sync)
  if (msg.selected_chain || msg.receive_address) {
    const meta = JSON.parse(offer.verification_meta || '{}');
    if (msg.selected_chain) meta.receive_chain = msg.selected_chain;
    if (msg.receive_address) meta.receive_address = msg.receive_address;
    sqlite.prepare('UPDATE exchange_offers SET taker_chain = ?, taker_payment_address = ?, verification_meta = ? WHERE id = ?')
      .run(msg.selected_chain || null, msg.receive_address || null, JSON.stringify(meta), offer.id);
  }

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
/**
 * Check for disputes that have been open too long (72h threshold).
 *
 * 2026-04-14 (stub): 暂时只 log 警告, 不自动 resolve.
 * 下轮需要设计 "原本 outcome" 逻辑:
 *   - 若 dispute 发生时 status=delivering → 默认 taker_wins (KAS 已发)
 *   - 若 dispute 发生时 status=verifying/matched → 默认 maker_wins (钱未到)
 * 需要 verification_meta 里记录 pre_dispute_status, 才能安全地 auto-resolve.
 * 当前只告警, 避免误判.
 *
 * @returns {number} count of aging disputes
 */
export function checkStaleDisputes() {
  const stale = sqlite.prepare(
    `SELECT id, maker, taker,
            json_extract(verification_meta, '$.dispute_at') AS dispute_at,
            json_extract(verification_meta, '$.dispute_by') AS dispute_by
     FROM exchange_offers
     WHERE protocol_status = 'disputed'
       AND json_extract(verification_meta, '$.dispute_at') IS NOT NULL
       AND datetime(json_extract(verification_meta, '$.dispute_at'), '+72 hours') < datetime('now')
       AND json_extract(verification_meta, '$.resolved_at') IS NULL`
  ).all();

  for (const s of stale) {
    console.warn(`[exchange] ⚠ STALE DISPUTE ${s.id.slice(0, 8)} disputed_at=${s.dispute_at} by=${s.dispute_by?.slice(-8)} — 超过 72h 未 resolve, TODO: auto-resolve (下轮实现)`);
  }
  return stale.length;
}

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
  // Original: verifying/awaiting states → timed_out after 30min
  const stuck = sqlite.prepare(
    `SELECT id, verification FROM exchange_offers
     WHERE protocol_status IN ('verifying', 'awaiting_manual_confirm', 'awaiting_oracle')
     AND verifying_started_at IS NOT NULL
     AND datetime(verifying_started_at, '+30 minutes') < datetime('now')`
  ).all();

  for (const { id } of stuck) {
    transition(id, 'timed_out');
  }

  // delivering → verified (revert for retry) after 60min
  // KAS may have been sent but broadcast confirmation slow — revert, don't dispute
  const stuckDelivering = sqlite.prepare(
    `SELECT id FROM exchange_offers
     WHERE protocol_status = 'delivering'
     AND delivering_at IS NOT NULL
     AND datetime(delivering_at, '+60 minutes') < datetime('now')`
  ).all();

  for (const { id } of stuckDelivering) {
    console.log(`[exchange-machine] delivering timeout 60min → verified (revert for retry): ${id.slice(0,8)}`);
    transition(id, 'verified', {});
  }

  // verified → timed_out after 60min (total window 120min from delivering)
  // All retry attempts exhausted — release funds
  const stuckVerified = sqlite.prepare(
    `SELECT id FROM exchange_offers
     WHERE protocol_status = 'verified'
     AND delivering_at IS NOT NULL
     AND datetime(delivering_at, '+120 minutes') < datetime('now')`
  ).all();

  for (const { id } of stuckVerified) {
    console.log(`[exchange-machine] verified timeout (120min total) → timed_out: ${id.slice(0,8)}`);
    transition(id, 'timed_out');
  }

  return stuck.length + stuckDelivering.length + stuckVerified.length;
}

// ── Matched Timeout ──────────────────────────────────────────

/**
 * Check for matched offers that haven't received payment within 30 minutes.
 * Broadcasts kanet_exchange_timeout_v1 and reopens the offer.
 * Does NOT use transition() — timeout revert is an exceptional flow.
 */
export async function checkMatchedTimeout() {
  const stale = sqlite.prepare(`
    SELECT id, maker, taker, taker_chain FROM exchange_offers
    WHERE protocol_status = 'matched'
    AND matched_at IS NOT NULL
    AND datetime(matched_at, '+30 minutes') < datetime('now')
  `).all();

  for (const offer of stale) {
    console.log(`[exchange-machine] matched timeout: offer ${offer.id.slice(0,8)} (taker ${(offer.taker || '').slice(-8)})`);

    // ⑤ NO TX NO STATE CHANGE — Broadcast timeout FIRST, reopen only after TX is on chain.
    const relay = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(offer.maker);

    if (relay) {
      const { sendCommandAsync } = await import('./relay-manager.js');
      const timeoutMsg = JSON.stringify({
        t: 'kanet_exchange_timeout_v1',
        offer_id: offer.id,
        taker: offer.taker,
        reason: 'payment_timeout',
        reopen: true,
      });

      let timeoutTxId = null;
      for (let ta = 1; ta <= 3; ta++) {
        try {
          const tr = await sendCommandAsync(relay.id, { type: 'send_broadcast', channel: 'kanet-exchange', message: timeoutMsg });
          timeoutTxId = tr?.txId;
          if (timeoutTxId) break;
        } catch (te) {
          console.error(`[exchange-machine] timeout broadcast attempt ${ta}/3: ${te.message}`);
          if (ta < 3) await new Promise(r => setTimeout(r, 200));
        }
      }

      if (!timeoutTxId) {
        console.warn(`[exchange-machine] timeout broadcast failed for ${offer.id.slice(0,8)} — staying matched, will retry next tick`);
        continue;
      }
    }
    // Non-local maker (no relay): proceed with local-only timeout

    // Broadcast succeeded (or non-local) → NOW reopen
    // TIMEZONE FIX: use JS toISOString() for Z suffix consistency
    const nowIsoR = new Date().toISOString();
    sqlite.prepare(`
      UPDATE exchange_offers
      SET protocol_status = 'open',
          taker = NULL, taker_chain = NULL, taker_payment_address = NULL,
          payment_tx = NULL, matched_at = NULL,
          updated_at = ?
      WHERE id = ? AND protocol_status = 'matched'
    `).run(nowIsoR, offer.id);

    releaseFunds(offer.id);
  }

  return stale.length;
}

// ── Payment Submit (cross_chain_tx / kaspa_tx verification) ──
// NOTE: processPaymentSubmit is still used by kanet_exchange_paid_v1 handler
// (handleExchangePaid transitions to verifying first, then calls this).
// The old /api/exchange/submit-payment REST endpoint is deprecated.

/**
 * Taker submits a payment TX hash for on-chain verification.
 * Writes to verification_meta, kicks off async verification.
 */
export function processPaymentSubmit({ offer_id, payment_tx, payment_chain }) {
  const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
  if (!offer) return { error: 'offer_not_found' };
  if (offer.protocol_status !== 'verifying') return { error: 'invalid_status', current: offer.protocol_status };
  if (!payment_tx) return { error: 'payment_tx_required' };

  // Security: use taker_chain from offer (set at accept time), fallback to body value for backward compat
  const verifyChain = offer.taker_chain || payment_chain;
  if (!verifyChain) return { error: 'no payment chain on record' };

  const now = new Date().toISOString();
  const meta = JSON.parse(offer.verification_meta || '{}');
  meta.payment_tx = payment_tx;
  meta.payment_chain = verifyChain;
  meta.submitted_at = now;

  sqlite.prepare(
    'UPDATE exchange_offers SET verification_meta = ?, updated_at = ? WHERE id = ?'
  ).run(JSON.stringify(meta), now, offer_id);

  // Async verification — does not block API response
  _verifyAndComplete(offer_id, payment_tx, verifyChain).catch(err =>
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
  const expectedTo = meta.receive_address || meta.expected_address || null;

  try {
    let vr;

    // Kaspa same-chain TX: submitTransaction accepted = TX is real. Trust txId directly.
    if (payment_chain === 'kaspa') {
      console.log(`[exchange] kaspa_tx: trusting txId ${payment_tx.slice(0,16)} (submitTransaction = verified)`);
      vr = { confirmed: true, confirmations: 1, required: 1, actualAmount: expectedAmount, recipient: expectedTo || '', sender: '' };
    } else {
      const { verifyCrossChainTx } = await import('./cross-chain-verify.mjs');
      vr = await verifyCrossChainTx({
        txHash: payment_tx,
        chain: payment_chain,
        expectedAmount,
        expectedTo,
        paymentAsset: meta.payment_asset || 'usdt',
      });
    }

    if (vr.confirmed) {
      meta.verified_tx = payment_tx;
      meta.verified_at = new Date().toISOString();
      meta.confirmations = vr.confirmations;

      sqlite.prepare(
        'UPDATE exchange_offers SET verification_meta = ?, updated_at = ? WHERE id = ?'
      ).run(JSON.stringify(meta), new Date().toISOString(), offer_id);

      // BUY path (give_asset=USDT, want_asset=KAS, kaspa_tx): KAS already received.
      // No delivery needed — go straight to completed.
      if (offer.give_asset !== 'KAS' && payment_chain === 'kaspa') {
        sqlite.prepare('UPDATE exchange_offers SET delivery_tx = ? WHERE id = ?').run(payment_tx, offer_id);
        transition(offer_id, 'delivering', { txHash: payment_tx }); // brief pass-through
        transition(offer_id, 'completed', { txHash: payment_tx });
        try { const { spendFunds } = await import('./fund-lock.js'); spendFunds(offer_id); } catch {}
        sqlite.prepare(`
          INSERT INTO chain_events (id, event_type, from_address, to_address, tx_hash, payload, observed_at)
          VALUES (?, 'exchange_completed', ?, ?, ?, ?, datetime('now'))
        `).run(crypto.randomUUID(), offer.maker, offer.taker, payment_tx, JSON.stringify({
          offer_id, give_asset: offer.give_asset, give_amount: offer.give_amount,
          want_asset: offer.want_asset, want_amount: offer.want_amount,
          payment_tx, verification: 'kaspa_tx',
        }));
        console.log(`[exchange] offer ${offer_id.slice(0,8)} BUY kaspa_tx verified → completed (KAS received, no delivery needed)`);
        // Trigger hedge
        const finalOffer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
        if (finalOffer?.protocol_status === 'completed' && finalOffer.maker) {
          const localAgent = sqlite.prepare('SELECT id, name FROM relay_nodes WHERE address = ?').get(finalOffer.maker);
          if (localAgent) {
            executeHedge(finalOffer).catch(err => console.error(`[exchange-hedge] error: ${err.message}`));
          }
        }
        return;
      }

      const deliveringOffer = transition(offer_id, 'delivering', {});
      console.log(`[exchange] offer ${offer_id.slice(0,8)} payment verified → delivering (${vr.actualAmount} USDT, ${vr.confirmations}/${vr.required} conf)`);

      // Auto-deliver asset to taker (SELL path: give_asset=KAS)
      if (deliveringOffer?.give_asset === 'KAS' && deliveringOffer.taker) {
        const deliveryAgent = sqlite.prepare('SELECT id, name FROM relay_nodes WHERE address = ?').get(deliveringOffer.maker);
        if (deliveryAgent) {
          const MAX_DELIVERY_ATTEMPTS = 3;
          const DELIVERY_RETRY_MS = 10_000;
          let deliveryTxId = null;

          for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
            try {
              const { sendCommandAsync } = await import('./relay-manager.js');
              const sendResult = await sendCommandAsync(deliveryAgent.id, {
                type: 'transfer',
                target: deliveringOffer.taker,
                amount: String(deliveringOffer.give_amount),
              });
              deliveryTxId = sendResult?.txId;
              console.log(`[exchange] KAS delivery attempt ${attempt}: ${deliveringOffer.give_amount} KAS → ${deliveringOffer.taker.slice(-12)} TX: ${deliveryTxId || '?'}`);
              break; // success
            } catch (err) {
              console.error(`[exchange] KAS delivery attempt ${attempt}/${MAX_DELIVERY_ATTEMPTS} FAILED: ${err.message}`);
              if (attempt < MAX_DELIVERY_ATTEMPTS) {
                await new Promise(r => setTimeout(r, DELIVERY_RETRY_MS));
              }
            }
          }

          if (deliveryTxId) {
            // === NO TX NO STATE CHANGE ===
            // KAS delivery TX returned from Relay. Now broadcast delivered_v1.
            // MUST succeed on chain before marking completed.
            const { sendCommandAsync: sendCmd } = await import('./relay-manager.js');
            const deliveredMsg = JSON.stringify({
              t: 'kanet_exchange_delivered_v1',
              offer_id: deliveringOffer.id,
              delivery_tx: deliveryTxId,
              delivery_asset: deliveringOffer.give_asset,
              delivery_amount: deliveringOffer.give_amount,
              receiver: deliveringOffer.taker,
            });

            let deliveredBcastTxId = null;
            for (let ba = 1; ba <= 5; ba++) {
              try {
                const br = await sendCmd(deliveryAgent.id, { type: 'send_broadcast', channel: 'kanet-exchange', message: deliveredMsg });
                deliveredBcastTxId = br?.txId;
                if (deliveredBcastTxId) break;
              } catch (be) {
                console.error(`[exchange] delivered broadcast attempt ${ba}/5: ${be.message}`);
              }
              if (ba < 5) await new Promise(r => setTimeout(r, 200 * ba));
            }

            if (!deliveredBcastTxId) {
              // Delivered broadcast failed — KAS was sent but we can't prove it on chain yet.
              // Stay in delivering, do NOT mark completed. Operator or next tick can retry.
              console.error(`[exchange] offer ${offer_id.slice(0,8)} KAS sent (${deliveryTxId}) but delivered broadcast failed. Staying in delivering.`);
              sqlite.prepare(`
                INSERT INTO chain_events (id, event_type, from_address, to_address, tx_hash, payload, observed_at)
                VALUES (?, 'kas_delivery', ?, ?, ?, ?, datetime('now'))
              `).run(crypto.randomUUID(), deliveringOffer.maker, deliveringOffer.taker, deliveryTxId,
                JSON.stringify({ offer_id: deliveringOffer.id, amount: deliveringOffer.give_amount, broadcast_failed: true }));
            } else {
              // Both KAS delivery AND broadcast succeeded — NOW mark completed
              sqlite.prepare('UPDATE exchange_offers SET delivery_tx = ? WHERE id = ?').run(deliveryTxId, offer_id);
              transition(offer_id, 'completed', { txHash: deliveryTxId });
              sqlite.prepare(`
                INSERT INTO chain_events (id, event_type, from_address, to_address, tx_hash, payload, observed_at)
                VALUES (?, 'kas_delivery', ?, ?, ?, ?, datetime('now'))
              `).run(crypto.randomUUID(), deliveringOffer.maker, deliveringOffer.taker, deliveryTxId,
                JSON.stringify({ offer_id: deliveringOffer.id, amount: deliveringOffer.give_amount, broadcast_tx: deliveredBcastTxId }));
              try { const { spendFunds } = await import('./fund-lock.js'); spendFunds(deliveringOffer.id); } catch {}
              sqlite.prepare(`
                INSERT INTO chain_events (id, event_type, from_address, to_address, payload, observed_at)
                VALUES (?, 'exchange_completed', ?, ?, ?, datetime('now'))
              `).run(crypto.randomUUID(), deliveringOffer.maker, deliveringOffer.taker, JSON.stringify({
                offer_id: deliveringOffer.id, give_asset: deliveringOffer.give_asset, give_amount: deliveringOffer.give_amount,
                want_asset: deliveringOffer.want_asset, want_amount: deliveringOffer.want_amount, taker_chain: deliveringOffer.taker_chain,
                delivery_tx: deliveryTxId, broadcast_tx: deliveredBcastTxId,
                price: parseFloat(deliveringOffer.want_amount) / parseFloat(deliveringOffer.give_amount) || 0,
              }));
              console.log(`[exchange] offer ${offer_id.slice(0,8)} delivering → completed (delivery TX: ${deliveryTxId.slice(0,12)}, broadcast: ${deliveredBcastTxId.slice(0,12)})`);
            }
          } else {
            // 3 attempts failed → revert to verified (retryable, not dispute)
            transition(offer_id, 'verified', {});
            sqlite.prepare(`
              INSERT INTO chain_events (id, event_type, from_address, payload, observed_at)
              VALUES (?, 'exchange_delivery_reverted', ?, ?, datetime('now'))
            `).run(crypto.randomUUID(), deliveringOffer.maker, JSON.stringify({
              offer_id: deliveringOffer.id, reason: 'delivery_failed_3_attempts_reverted',
            }));
            console.warn(`[exchange] offer ${offer_id.slice(0,8)} delivering → verified (3 delivery failures, reverted for retry)`);
          }
        }
      }

      // BUY path (kaspa_tx): taker already sent KAS, maker received it.
      // No separate delivery needed — go straight to completed.
      if (payment_chain === 'kaspa' && deliveringOffer?.give_asset !== 'KAS') {
        sqlite.prepare('UPDATE exchange_offers SET delivery_tx = ? WHERE id = ?').run(payment_tx, offer_id);
        const completedOffer = transition(offer_id, 'completed', { txHash: payment_tx });
        sqlite.prepare(`
          INSERT INTO chain_events (id, event_type, from_address, to_address, payload, observed_at)
          VALUES (?, 'exchange_completed', ?, ?, ?, datetime('now'))
        `).run(crypto.randomUUID(), deliveringOffer.maker, deliveringOffer.taker, JSON.stringify({
          offer_id: deliveringOffer.id, give_asset: deliveringOffer.give_asset, give_amount: deliveringOffer.give_amount,
          want_asset: deliveringOffer.want_asset, want_amount: deliveringOffer.want_amount,
          payment_chain, payment_tx,
        }));
        console.log(`[exchange] BUY kaspa_tx offer ${offer_id.slice(0,8)} delivering → completed (KAS already received)`);
      }

      // Trigger hedge after completed (only if delivery succeeded)
      const finalOffer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
      if (finalOffer?.protocol_status === 'completed' && finalOffer.maker) {
        const localAgent = sqlite.prepare('SELECT id, name FROM relay_nodes WHERE address = ?').get(finalOffer.maker);
        if (localAgent) {
          const makerGaveKas = finalOffer.give_asset === 'KAS';
          const hedgeSide = makerGaveKas ? 'BUY' : 'SELL';
          const hedgeQty = makerGaveKas ? parseFloat(finalOffer.give_amount) : parseFloat(finalOffer.want_amount);
          if (hedgeQty > 0) {
            setImmediate(() => {
              executeHedge(finalOffer.id, localAgent.name, hedgeSide, hedgeQty).catch(err =>
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
      // Record exchange_disputed for audit
      sqlite.prepare(`
        INSERT INTO chain_events (id, event_type, from_address, payload, observed_at)
        VALUES (?, 'exchange_disputed', ?, ?, datetime('now'))
      `).run(crypto.randomUUID(), offer.maker, JSON.stringify({
        offer_id, reason: dmeta.dispute_reason,
      }));
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
  console.log(`[exchange] offer ${offer_id.slice(0,8)} disputed by ${disputer_address.slice(-8)}: ${reason}`);

  return { ok: true, status: 'disputed' };
}
