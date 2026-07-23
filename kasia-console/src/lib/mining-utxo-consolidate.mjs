// mining-utxo-consolidate.mjs — #34 Direction C: keep the mining payout address's UTXO count bounded.
//
// Root cause (2026-07-04, qzdh7nar protocol-level proof, Bettor/NWT co-verify): kaspad's
// GetUtxosByAddresses has NO pagination at any encoding (Borsh/gRPC/wRPC-JSON) — server-side
// materializes the entire result before responding. The old mining address (FaucetRelay-tn-2)
// accumulated 2.947M UTXOs and can no longer be read (wasm client trap) — this is a protocol-level
// wall, not fixable by consolidating THAT address (consolidate itself needs to read it first).
//
// Fix: mining payout moves to a NEW address (created fresh, near-zero UTXOs). This cron keeps that
// new address's UTXO count low by periodically consolidating fresh coinbase outputs BEFORE it can
// ever approach the crash threshold again. Same command as consolidateUtxosRelay
// (kasia-relay/src/lib/utxo-split.mjs) — this file only adds the always-on schedule.
//
// Pattern copied from broadcaster-utxo.mjs (design-v2 B) — single target relay instead of a list,
// 'consolidate_utxo' command instead of 'split_utxo' (N→1 not 1→N; goal here is FEWER UTXOs, not more).
//
// Strategy (2026-07-04, Bettor #60on4y pivot after KANet-UI gradient-test found split_utxo itself hits
// a mass wall well under 750 outputs, making "find the exact crash threshold" impractical to test
// synthetically): DON'T chase the unknown crash point. Stay inside the known-clean zone instead — 546
// is the largest UTXO count this codebase has empirically fetched without issue (utxo-split.mjs L232
// clean-relay probe). Tick every 1min so mining (~230 UTXO/min) never accumulates past ~230 between
// ticks — comfortably under a 400 alert line, which itself sits under the 546 known-clean ceiling.
// ALERT_THRESHOLD is a tripwire: if the observed pre-consolidate count ever exceeds it (cron stalled,
// mining rate spiked, etc.), write an `events` row so an operator can intervene BEFORE the address
// gets anywhere near the actual (still-unknown, and never to be tested for real) crash point.
const TICK_INTERVAL_MS = Number(process.env.MINING_CONSOLIDATE_TICK_MS) || 60_000; // 1min
const STARTUP_GRACE_MS = 60_000;
const MIN_FRAGMENTS = Number(process.env.MINING_CONSOLIDATE_MIN_FRAGMENTS) || 20; // don't bother consolidating below this count
const ALERT_THRESHOLD = Number(process.env.MINING_CONSOLIDATE_ALERT_THRESHOLD) || 400; // tripwire, well under the 546 known-clean ceiling

import { sendCommandAsync } from '../services/relay-manager.js';
import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';

let timer = null;
let running = false;
let _alerted = false; // de-dupe: one events row per stall episode, not one per tick

function _miningRelayId() {
  return (process.env.MINING_RELAY_ID || '').trim() || null;
}

function _writeAlertEvent(eventType, summary, payload, level = 'warn') {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', ?, 'mining-utxo-consolidate', ?, ?, ?, datetime('now'))
    `).run(randomUUID(), eventType, level, summary, JSON.stringify(payload));
  } catch (e) { console.warn(`[mining-consolidate] events insert fail (non-fatal): ${e.message}`); }
}

function _alertIfOverThreshold(relayId, utxosBefore) {
  if (utxosBefore == null) return;
  if (utxosBefore > ALERT_THRESHOLD) {
    if (_alerted) return; // already alerted this episode
    _alerted = true;
    console.warn(`[mining-consolidate] ALERT: ${relayId.slice(0, 8)} pre-consolidate UTXO count ${utxosBefore} > threshold ${ALERT_THRESHOLD} — cron may be stalled or mining rate spiked, intervene before it approaches the unknown crash zone`);
    _writeAlertEvent('mining_consolidate_utxo_drift',
      `Mining address ${relayId.slice(0, 8)} UTXO count (${utxosBefore}) exceeded the ${ALERT_THRESHOLD} tripwire (known-clean ceiling is 546). Cron may be stalled or mining rate increased — investigate before the address approaches the unverified crash zone.`,
      { relayId, utxosBefore, threshold: ALERT_THRESHOLD });
  } else if (_alerted) {
    _alerted = false; // recovered — clear so a future breach alerts again
  }
}

// NWT #34 final review (2026-07-04): the utxosBefore check above only fires on a SUCCESSFUL
// consolidate_utxo result — but the most dangerous failure mode (the getUtxosByAddresses fetch itself
// starting to fail/crash as the address grows) throws instead, landing in the catch block. That's
// exactly the case this whole alert system exists to catch, so it must not be silent there either.
let _fetchFailAlerted = false;
function _alertOnCommandFailure(relayId, errMessage) {
  if (_fetchFailAlerted) return; // de-dupe: one events row per stall episode
  _fetchFailAlerted = true;
  // Bettor #60y4nx: higher severity than the count-drift warn — a thrown command means the tripwire
  // itself may already be blind (can't read the address to know the count), so this needs 'error'.
  _writeAlertEvent('mining_consolidate_command_failure',
    `Mining address ${relayId.slice(0, 8)} consolidate_utxo command threw (${String(errMessage).slice(0, 160)}) instead of returning a result. This may mean the underlying UTXO fetch is starting to fail as the address grows — the same failure mode the 400-UTXO tripwire exists to prevent. Investigate immediately.`,
    { relayId, error: String(errMessage).slice(0, 300) }, 'error');
}

export async function miningConsolidateTick() {
  if (running) return { skipped: true };
  const relayId = _miningRelayId();
  if (!relayId) return { skipped: true, reason: 'no_mining_relay_id_configured' };
  running = true;
  try {
    const r = await sendCommandAsync(relayId, { type: 'consolidate_utxo', minFragments: MIN_FRAGMENTS }, 60_000, 'internal');
    if (r?.utxosBefore != null) _alertIfOverThreshold(relayId, r.utxosBefore);
    if (r?.consolidated) {
      console.log(`[mining-consolidate] ${relayId.slice(0, 8)} consolidated ${r.utxosBefore}→1 (${r.rounds} round) tx=${(r.txId || '').slice(0, 12)}`);
    }
    if (r?.ok !== false) _fetchFailAlerted = false; // command returned cleanly — clear any prior failure-alert latch
    return r || { ok: false, reason: 'no_result' };
  } catch (e) {
    console.warn(`[mining-consolidate] ${relayId.slice(0, 8)} tick fail (non-fatal, retry next cycle): ${e.message}`);
    _alertOnCommandFailure(relayId, e.message);
    return { ok: false, reason: e.message };
  } finally {
    running = false;
  }
}

export function startMiningConsolidateCron() {
  if (timer) return;
  const relayId = _miningRelayId();
  if (!relayId) {
    console.log('[mining-consolidate] MINING_RELAY_ID not set — cron not started (set in kanet.env once new mining address relay exists)');
    return;
  }
  console.log(`[mining-consolidate] started — tick=${TICK_INTERVAL_MS}ms minFragments=${MIN_FRAGMENTS} alertThreshold=${ALERT_THRESHOLD} target=${relayId.slice(0, 8)} (#34 Direction C — stay inside known-clean zone, never chase the crash point)`);
  setTimeout(() => { miningConsolidateTick().catch(e => console.error('[mining-consolidate] startup tick:', e.message)); }, STARTUP_GRACE_MS);
  timer = setInterval(() => { miningConsolidateTick().catch(e => console.error('[mining-consolidate] tick:', e.message)); }, TICK_INTERVAL_MS);
}

export function stopMiningConsolidateCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
