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

import { sendCommandAsync } from '../services/relay-manager.js';

const TICK_INTERVAL_MS = Number(process.env.MINING_CONSOLIDATE_TICK_MS) || 30 * 60_000; // 30min default (Bettor #5zm2y2)
const STARTUP_GRACE_MS = 60_000;
const MIN_FRAGMENTS = Number(process.env.MINING_CONSOLIDATE_MIN_FRAGMENTS) || 20; // don't bother consolidating below this count

let timer = null;
let running = false;

function _miningRelayId() {
  return (process.env.MINING_RELAY_ID || '').trim() || null;
}

export async function miningConsolidateTick() {
  if (running) return { skipped: true };
  const relayId = _miningRelayId();
  if (!relayId) return { skipped: true, reason: 'no_mining_relay_id_configured' };
  running = true;
  try {
    const r = await sendCommandAsync(relayId, { type: 'consolidate_utxo', minFragments: MIN_FRAGMENTS }, 60_000);
    if (r?.consolidated) {
      console.log(`[mining-consolidate] ${relayId.slice(0, 8)} consolidated ${r.utxosBefore}→1 (${r.rounds} round) tx=${(r.txId || '').slice(0, 12)}`);
    }
    return r || { ok: false, reason: 'no_result' };
  } catch (e) {
    console.warn(`[mining-consolidate] ${relayId.slice(0, 8)} tick fail (non-fatal, retry next cycle): ${e.message}`);
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
  console.log(`[mining-consolidate] started — tick=${TICK_INTERVAL_MS}ms minFragments=${MIN_FRAGMENTS} target=${relayId.slice(0, 8)} (#34 Direction C — keep mining address UTXO count bounded)`);
  setTimeout(() => { miningConsolidateTick().catch(e => console.error('[mining-consolidate] startup tick:', e.message)); }, STARTUP_GRACE_MS);
  timer = setInterval(() => { miningConsolidateTick().catch(e => console.error('[mining-consolidate] tick:', e.message)); }, TICK_INTERVAL_MS);
}

export function stopMiningConsolidateCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
