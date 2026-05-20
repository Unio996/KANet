// broker-stress-pool-replenish.js — Phase 6 #4 Sub-2 (NWT N19.114 spec)
//
// Triggered: KANET_STRESS_MODE=1 (process env).
// Detect: stress test relays (NWT/Trader-M/J2/Trader-A) BSC USDT < floor.
// Action: broker (Trader-B) → relay USDT transfer via /api/relay/.../wallets/.../send.
// Audit: chain_events source='stress_pool_replenish'.
// Throttle: 1h per (relay) to prevent spam tick fire.

import { sqlite } from '../db/client.js';
import { getConfig } from '../data/settings/configs.js';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const TICK_INTERVAL_MS = 5 * 60_000;  // 5 min
const CONSOLE_PORT = process.env.PORT || 3100;
const DEFAULT_FLOOR_USD = 3;
const DEFAULT_TARGET_USD = 5;
const DEFAULT_POOL_RELAYS = 'NWT,Trader-M,J2,Trader-A';
const THROTTLE_MS = 60 * 60_000;  // 1h per relay

let _tickInterval = null;
let _ticking = false;

async function _fetchRelayBnbWallet(relayId) {
  try {
    const res = await fetch(`http://127.0.0.1:${CONSOLE_PORT}/api/relay/${relayId}/wallets`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const d = await res.json();
    const bnb = (d.chains || []).find(c => c.chain === 'bnb');
    return bnb ? { walletId: bnb.id, address: bnb.address, usdt: bnb.usdtBalance ?? 0 } : null;
  } catch { return null; }
}

async function _broker2RelayUsdtTransfer(brokerBnbWalletId, toAddr, amount) {
  try {
    const res = await fetch(`http://127.0.0.1:${CONSOLE_PORT}/api/relay/${BROKER_RELAY_ID}/wallets/${brokerBnbWalletId}/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset: 'usdt', amount: amount.toFixed(3), to: toAddr }),
      signal: AbortSignal.timeout(30_000),
    });
    const d = await res.json().catch(() => ({}));
    return { ok: res.ok && d.txHash, txHash: d.txHash, error: d.error };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function _runReplenishTick() {
  if (_ticking) return;
  // Gate: only act when KANET_STRESS_MODE=1
  if (process.env.KANET_STRESS_MODE !== '1') return;
  _ticking = true;
  try {
    const floor = parseFloat(await getConfig('stress_pool_floor_usd') || String(DEFAULT_FLOOR_USD));
    const target = parseFloat(await getConfig('stress_pool_target_usd') || String(DEFAULT_TARGET_USD));
    const poolRelaysCsv = await getConfig('stress_pool_relays') || DEFAULT_POOL_RELAYS;
    const relayNames = poolRelaysCsv.split(',').map(s => s.trim()).filter(Boolean);

    // Find broker BSC wallet
    const brokerBnb = sqlite.prepare(`SELECT id FROM agent_wallets WHERE relay_node_id=? AND chain='bnb' AND is_default=1`).get(BROKER_RELAY_ID);
    if (!brokerBnb) {
      console.warn('[stress-pool-replenish] broker BSC wallet not found, skip');
      return;
    }

    for (const name of relayNames) {
      const relay = sqlite.prepare(`SELECT id FROM relay_nodes WHERE name=?`).get(name);
      if (!relay) continue;

      // Throttle check
      const lastSent = sqlite.prepare(`SELECT created_at FROM throttle_log WHERE key=? ORDER BY created_at DESC LIMIT 1`).get(`stress_replenish_${name}`);
      if (lastSent && Date.now() - new Date(lastSent.created_at + 'Z').getTime() < THROTTLE_MS) continue;

      const w = await _fetchRelayBnbWallet(relay.id);
      if (!w) continue;
      if (w.usdt >= floor) continue;

      const needed = target - w.usdt;
      console.log(`[stress-pool-replenish] ${name} ${w.usdt.toFixed(3)} < floor ${floor} → fire broker→${w.address.slice(0,10)} +${needed.toFixed(3)} USDT`);
      const r = await _broker2RelayUsdtTransfer(brokerBnb.id, w.address, needed);
      if (r.ok) {
        console.log(`[stress-pool-replenish] ✓ ${name} +${needed.toFixed(3)} USDT TX ${r.txHash.slice(0, 16)}`);
        // Audit chain_event
        try {
          const { recordChainEvent } = await import('./chain-event.js');
          recordChainEvent({
            txid: `stress_pool_replenish_${name}_${Date.now()}`,
            eventType: 'broker_auto_replenish_v2',
            fromAddress: null, toAddress: w.address, observedBy: 'system',
            payload: { source: 'stress_pool_replenish', relay: name, amount_usdt: needed, target_usdt: target, tx: r.txHash, balance_before: w.usdt },
          });
        } catch {}
        // Throttle log
        sqlite.prepare(`INSERT INTO throttle_log (key, created_at) VALUES (?, datetime('now'))`).run(`stress_replenish_${name}`);
      } else {
        console.warn(`[stress-pool-replenish] ✗ ${name} fail: ${r.error}`);
      }
    }
  } catch (err) {
    console.error(`[stress-pool-replenish] tick err: ${err.message}`);
  } finally {
    _ticking = false;
  }
}

export function startStressPoolReplenish() {
  if (_tickInterval) return;
  console.log('[stress-pool-replenish] started — 5min cron (only acts when KANET_STRESS_MODE=1)');
  _tickInterval = setInterval(() => _runReplenishTick().catch(() => {}), TICK_INTERVAL_MS);
}

export function stopStressPoolReplenish() {
  if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; }
}

export const _internals = { _runReplenishTick, _fetchRelayBnbWallet, _broker2RelayUsdtTransfer };
