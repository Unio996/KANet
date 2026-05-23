// marketmaker-kas-refill.js — Phase 6 #4 Sub-3 KI 52 (NWT N19.114 spec)
//
// 1h cron OR K-pool < kas_floor: detect MarketMaker K-pool low → Gate.io withdraw KAS to MarketMaker chain pool.
// Only Gate.io supports API withdraw (Bybit/MEXC/Bitget/KuCoin 手动 per Owner 5/20 校准).
//
// Audit chain_event 'broker_auto_replenish_v2' source='kas_refill_cex'.
// Throttle 1h per (cex+amount).
// DRY_RUN=1 gate: log + skip real withdraw (R-3 spec).
//
// KI 65 A.3.3 wave 3 (5/22): renamed from broker-kas-refill.js (MarketMaker role separation).

import { sqlite } from '../db/client.js';
import { getConfig } from '../data/settings/configs.js';
import { getBrokerRelayIdOrThrow } from './broker-config-resolver.js';

// KI 65 A.3.3 (NWT N19.208): runtime helper, no module-load const.
const TICK_INTERVAL_MS = 60 * 60_000;  // 1h cron
const DEFAULT_KAS_FLOOR = 5000;
const DEFAULT_REFILL_AMOUNT = 2000;
const DEFAULT_REFILL_CEX = 'gateio';   // Only Gate.io API withdraw supported Phase 1
const THROTTLE_MS = 60 * 60_000;

let _tickInterval = null;
let _ticking = false;

async function _getBrokerKasAddress() {
  const r = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(getBrokerRelayIdOrThrow());
  return r?.address || null;
}

async function _getBrokerKasBalance() {
  // Try treasury_snapshot (5min staleness OK)
  const row = sqlite.prepare(`SELECT balance_human FROM treasury_snapshot WHERE chain='kaspa' AND asset='KAS' ORDER BY id DESC LIMIT 1`).get();
  return row ? Number(row.balance_human) : null;
}

async function _runRefillTick() {
  if (_ticking) return;
  _ticking = true;
  try {
    const kasFloor = parseFloat(await getConfig('broker_kas_refill_floor') || String(DEFAULT_KAS_FLOOR));
    const refillAmount = parseFloat(await getConfig('broker_kas_refill_amount') || String(DEFAULT_REFILL_AMOUNT));
    const cex = await getConfig('broker_kas_refill_cex') || DEFAULT_REFILL_CEX;

    const kPool = await _getBrokerKasBalance();
    if (kPool === null) {
      console.log('[kas-refill] no treasury_snapshot KAS row, skip (waiting first snapshot)');
      return;
    }
    if (kPool >= kasFloor) return;  // pool healthy, no refill needed

    // Throttle check
    const throttleKey = `kas_refill_${cex}`;
    const lastSent = sqlite.prepare(`SELECT created_at FROM throttle_log WHERE key=? ORDER BY created_at DESC LIMIT 1`).get(throttleKey);
    if (lastSent && Date.now() - new Date(lastSent.created_at + 'Z').getTime() < THROTTLE_MS) {
      console.log(`[kas-refill] throttled (last fire <1h, K-pool=${kPool.toFixed(0)} < ${kasFloor})`);
      return;
    }

    const brokerAddr = await _getBrokerKasAddress();
    if (!brokerAddr) {
      console.warn('[kas-refill] broker Kaspa address not found, skip');
      return;
    }

    console.log(`[kas-refill] K-pool ${kPool.toFixed(0)} < floor ${kasFloor} → ${cex} withdraw ${refillAmount} KAS → ${brokerAddr.slice(0, 16)}`);

    // DRY_RUN gate
    if (process.env.DRY_RUN === '1') {
      console.log(`[kas-refill DRY_RUN] would withdraw ${refillAmount} KAS from ${cex} → ${brokerAddr} (no real TX)`);
      sqlite.prepare(`INSERT INTO throttle_log (key, created_at) VALUES (?, datetime('now'))`).run(throttleKey);
      return;
    }

    try {
      const { withdrawCex } = await import('./cex-bridge.js');
      const r = await withdrawCex({ cex, asset: 'KAS', amount: refillAmount, toAddr: brokerAddr, chain: 'KAS' });
      if (r.ok) {
        console.log(`[kas-refill] ✓ ${cex} withdraw_id=${r.withdraw_id} txid=${r.txid || 'pending'} amount=${refillAmount} KAS`);
        try {
          const { recordChainEvent } = await import('./chain-event.js');
          recordChainEvent({
            txid: `kas_refill_${cex}_${Date.now()}`,
            eventType: 'broker_auto_replenish_v2',
            fromAddress: `cex:${cex}`, toAddress: brokerAddr, observedBy: 'system',
            payload: { source: 'kas_refill_cex', cex, amount_kas: refillAmount, k_pool_before: kPool, k_pool_floor: kasFloor, withdraw_id: r.withdraw_id, txid: r.txid },
          });
        } catch {}
        sqlite.prepare(`INSERT INTO throttle_log (key, created_at) VALUES (?, datetime('now'))`).run(throttleKey);
      } else {
        console.warn(`[kas-refill] ✗ ${cex} withdraw fail: ${r.error}`);
      }
    } catch (err) {
      console.error(`[kas-refill] err: ${err.message}`);
    }
  } catch (err) {
    console.error(`[kas-refill] tick err: ${err.message}`);
  } finally {
    _ticking = false;
  }
}

export function startBrokerKasRefill() {
  if (_tickInterval) return;
  console.log('[kas-refill] started — 1h cron (Gate.io withdraw KAS to broker pool when low)');
  // Stagger 30 min offset from treasury monitor 5min tick (broker-treasury-monitor.js)
  setTimeout(() => {
    _runRefillTick().catch(() => {});
    _tickInterval = setInterval(() => _runRefillTick().catch(() => {}), TICK_INTERVAL_MS);
  }, 30 * 60_000);
}

export function stopBrokerKasRefill() {
  if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; }
}

export const _internals = { _runRefillTick, _getBrokerKasBalance, _getBrokerKasAddress };
