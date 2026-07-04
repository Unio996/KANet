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

// Bettor #609yos keep-up soundness catch (2026-07-04): consolidateUtxosRelay already internally loops
// across as many Generator compound rounds as needed to fully merge whatever it fetches (utxo-split.mjs
// L263-268 while loop) — one call handles unbounded ROUND count. The real constraint is the single
// getUtxosByAddresses FETCH at the start of that call (utxo-split.mjs L184): it must stay far below the
// 2.947M count that crashes the wasm client. Math: mining ≈230 coinbase UTXO/min (KANet-UI #5e04ny
// measurement). A 30min tick would let ~6900 accumulate before each fetch — no confirmed crash threshold
// exists below 2.947M (546 is the largest empirically-tested clean fetch in this codebase, utxo-split.mjs
// L232), so 6900 is unverified territory this close to a launch-critical path. 5min tick caps accumulation
// at ~1150/cycle — solidly inside known-safe order of magnitude, ~2600x below the crash point.
const TICK_INTERVAL_MS = Number(process.env.MINING_CONSOLIDATE_TICK_MS) || 5 * 60_000; // 5min (revised from initial 30min per keep-up math)
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
