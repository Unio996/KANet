// broadcaster-utxo.mjs — design-v2 (B): broadcaster N-medium-UTXO management (KANet-UI, 880 域).
//
// Pairs with J2 (A) [pool-broadcast parallel chunk broadcast]. The 880 settle-throughput bottleneck:
// a settle's sign_req is broadcast as a chain of 1-in-1-out chunk txs that SERIALIZE on the broadcaster's
// change-UTXO (each chunk spends a UTXO → change → the next chunk waits for that change to confirm; relay
// getUtxos returns confirmed-only). (A) parallelizes the chunk sends; for N concurrent chunks to not
// double-spend / starve, the broadcaster must already hold N INDEPENDENT spendable UTXOs. (B) maintains
// that pool.
//
// NOT consolidate-to-1 (J2 verified that backfires — 1 big UTXO forces the serial change-chain right back).
// The lever is N MEDIUM UTXOs: enough independent inputs for the parallel batch, each large enough to
// cover a chunk fee without itself fragmenting. Count is capped relay-side by KIP-9 maxSafeOutputs
// (N_max = floor(sqrt(1 + bal/1e7)) - 1).
//
// Timing: split_utxo(force) rebalances in ONE tx, but its N outputs need ~1 confirmation before the relay
// sees them as spendable. So the reliable shape is a PROACTIVE cron that keeps broadcaster relays topped
// up at N confirmed medium UTXOs — then (A)'s parallel broadcast always finds them ready (no per-broadcast
// confirm-wait). An on-demand ensureBroadcasterUtxos() is also exported for callers that can tolerate the
// confirm window (e.g. a pre-batch warm-up before a known burst).

import { sqlite } from '../db/client.js';
import { sendCommandAsync } from '../services/relay-manager.js';

const TICK_INTERVAL_MS = Number(process.env.BROADCASTER_UTXO_TICK_MS) || 180_000;   // 3min
const STARTUP_GRACE_MS = 90_000;
// Target independent UTXOs per broadcaster — sized to send a whole settle's chunks in ~1 wave (no
// confirm-wait between chunks). With J2's payload compression (sign_req ~79→~30 chunks), N=30 covers a
// settle in one wave, so the broadcaster never exhausts mid-burst (J2 r997 gap: all-N-in-flight →
// 'No UTXOs available' hard-fail) — J2's pool-broadcast exhaustion-retry is then just a safety net.
// Capped relay-side by KIP-9 maxSafeOutputs (a low-balance relay gets fewer; high-balance maker gets N).
// Env-tunable. A 79-chunk uncompressed settle still wins big: ~3 waves vs 79 serial steps.
const TARGET_UTXOS = Number(process.env.BROADCASTER_UTXO_TARGET) || 30;

let timer = null;
let running = false;

// Which relays broadcast sign_req chunks: active makers + local oracle voters (they broadcast votes+sigs).
// (env BROADCASTER_RELAY_IDS overrides with an explicit CSV list.)
function _broadcasterRelays() {
  const env = (process.env.BROADCASTER_RELAY_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (env.length) return env;
  // default: local oracle relays (sign_req signers) — the load test showed the settle broadcaster is the
  // contention point; makers are added via env when a specific maker is the hot broadcaster.
  return sqlite.prepare(`SELECT id FROM relay_nodes WHERE is_oracle = 1 AND address IS NOT NULL`).all().map(r => r.id);
}

// On-demand: rebalance one relay to N independent medium UTXOs (force = consolidate dust + split).
// Non-fatal: a failure just means the next broadcast runs with fewer UTXOs (degraded, not broken).
export async function ensureBroadcasterUtxos(relayId, targetN = TARGET_UTXOS, timeoutMs = 60_000) {
  if (!relayId || !Number.isFinite(targetN) || targetN < 2) return { ok: false, reason: 'noop' };
  try {
    const r = await sendCommandAsync(relayId, { type: 'split_utxo', targetCount: targetN, force: true }, timeoutMs);
    if (r?.split) {
      console.log(`[broadcaster-utxo] ${relayId.slice(0, 8)} rebalanced ${r.utxosBefore}→${r.utxosAfter} (target ${targetN}) tx=${(r.txId || '').slice(0, 12)}`);
    }
    return r || { ok: false, reason: 'no_result' };
  } catch (e) {
    console.warn(`[broadcaster-utxo] ${relayId?.slice(0, 8)} ensure fail (non-fatal): ${e.message}`);
    return { ok: false, reason: e.message };
  }
}

export async function broadcasterUtxoTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const relays = _broadcasterRelays();
    let rebalanced = 0, ok = 0, skipped = 0, failed = 0;
    for (const id of relays) {
      const r = await ensureBroadcasterUtxos(id, TARGET_UTXOS);
      if (r?.split) rebalanced++;
      else if (r?.ok) skipped++;          // already at/above target with usable UTXOs
      else if (r?.reason === 'sufficient') { skipped++; }
      else failed++;
      if (r?.ok || r?.split) ok++;
    }
    if (rebalanced > 0) console.log(`[broadcaster-utxo] tick: ${relays.length} relays, rebalanced=${rebalanced} skipped=${skipped} failed=${failed}`);
    return { ok: true, relays: relays.length, rebalanced, skipped, failed };
  } catch (e) {
    console.error('[broadcaster-utxo] tick fail:', e.message);
    return { ok: false, error: e.message };
  } finally {
    running = false;
  }
}

export function startBroadcasterUtxoMaintainerCron() {
  if (timer) return;
  console.log(`[broadcaster-utxo] started — tick=${TICK_INTERVAL_MS}ms target=${TARGET_UTXOS} UTXOs/broadcaster (design-v2 B, pairs with parallel-broadcast A)`);
  setTimeout(() => { broadcasterUtxoTick().catch(e => console.error('[broadcaster-utxo] startup tick:', e.message)); }, STARTUP_GRACE_MS);
  timer = setInterval(() => { broadcasterUtxoTick().catch(e => console.error('[broadcaster-utxo] tick:', e.message)); }, TICK_INTERVAL_MS);
}

export function stopBroadcasterUtxoMaintainerCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
