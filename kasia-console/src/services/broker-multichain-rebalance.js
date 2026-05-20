// broker-multichain-rebalance.js — Phase 6 #4 Sub-1 (NWT N19.114 spec)
//
// 5min cron: snapshot broker BSC/ETH/Polygon/Arbitrum/Optimism USDT balance.
// If any chain < floor: find surplus chain (>= floor + min transfer) → bridge to deficit via selectAndBridge (Across V3 or Stargate).
// Audit: chain_event 'broker_auto_replenish_v2' source='multichain_rebalance'.
// Throttle: 1h per (deficit chain) prevent over-fire.

import { sqlite } from '../db/client.js';
import { getConfig } from '../data/settings/configs.js';
import { decrypt } from './crypto.js';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const TICK_INTERVAL_MS = 5 * 60_000;
const CONSOLE_PORT = process.env.PORT || 3100;
const DEFAULT_FLOOR_USD = 20;       // chain USDT < $20 → trigger
const DEFAULT_TARGET_USD = 100;     // refill target
const DEFAULT_MIN_TRANSFER_USD = 10;  // smallest bridge amount (Across V3 needs >$5 + bridge fee buffer)
const DEFAULT_CHAINS = 'bnb,eth,polygon,arbitrum,optimism';
const THROTTLE_MS = 60 * 60_000;

let _tickInterval = null;
let _ticking = false;

async function _fetchChainUsdt(chain) {
  try {
    const res = await fetch(`http://127.0.0.1:${CONSOLE_PORT}/api/relay/${BROKER_RELAY_ID}/wallets`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const d = await res.json();
    const w = (d.chains || []).find(c => c.chain === chain);
    return w ? { walletId: w.id, address: w.address, usdt: w.usdtBalance ?? 0 } : null;
  } catch { return null; }
}

async function _runRebalanceTick() {
  if (_ticking) return;
  _ticking = true;
  try {
    const floor = parseFloat(await getConfig('broker_multichain_floor_usd') || String(DEFAULT_FLOOR_USD));
    const target = parseFloat(await getConfig('broker_multichain_target_usd') || String(DEFAULT_TARGET_USD));
    const minTransfer = parseFloat(await getConfig('broker_multichain_min_transfer_usd') || String(DEFAULT_MIN_TRANSFER_USD));
    const chainsCsv = await getConfig('broker_multichain_chains') || DEFAULT_CHAINS;
    const chains = chainsCsv.split(',').map(s => s.trim()).filter(Boolean);

    // Snapshot all chains
    const snapshot = [];
    for (const chain of chains) {
      const w = await _fetchChainUsdt(chain);
      if (w) snapshot.push({ chain, usdt: w.usdt, walletId: w.walletId, address: w.address });
    }
    if (snapshot.length === 0) return;

    // Identify deficit + surplus
    const deficits = snapshot.filter(s => s.usdt < floor).sort((a, b) => a.usdt - b.usdt);  // most needy first
    const surplus = snapshot.filter(s => s.usdt >= floor + minTransfer + 5).sort((a, b) => b.usdt - a.usdt);  // richest first (5 buffer for bridge fee)

    if (deficits.length === 0) return;  // all good

    for (const d of deficits) {
      // Throttle per deficit chain
      const throttleKey = `multichain_rebalance_${d.chain}`;
      const lastSent = sqlite.prepare(`SELECT created_at FROM throttle_log WHERE key=? ORDER BY created_at DESC LIMIT 1`).get(throttleKey);
      if (lastSent && Date.now() - new Date(lastSent.created_at + 'Z').getTime() < THROTTLE_MS) continue;

      // Pick richest surplus
      const src = surplus.shift();
      if (!src) {
        console.log(`[multichain-rebalance] no surplus chain for deficit ${d.chain} (${d.usdt.toFixed(2)} < ${floor})`);
        break;
      }

      const needed = Math.min(target - d.usdt, src.usdt - floor - 5);  // don't drain src below floor+buffer
      if (needed < minTransfer) {
        console.log(`[multichain-rebalance] needed ${needed.toFixed(2)} < min ${minTransfer}, skip ${src.chain}→${d.chain}`);
        continue;
      }

      console.log(`[multichain-rebalance] ${src.chain}(${src.usdt.toFixed(2)})→${d.chain}(${d.usdt.toFixed(2)}) bridge ${needed.toFixed(2)} USDT`);

      // DRY_RUN gate
      if (process.env.DRY_RUN === '1') {
        console.log(`[multichain-rebalance DRY_RUN] would bridge ${needed.toFixed(2)} ${src.chain}→${d.chain} (no real TX)`);
        sqlite.prepare(`INSERT INTO throttle_log (key, created_at) VALUES (?, datetime('now'))`).run(throttleKey);
        continue;
      }

      // Get broker private key for src chain
      const wallet = sqlite.prepare(`SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id=? AND chain=? AND is_default=1`).get(BROKER_RELAY_ID, src.chain);
      if (!wallet?.privkey_encrypted) {
        console.warn(`[multichain-rebalance] no privkey for broker ${src.chain}, skip`);
        continue;
      }
      let privateKey;
      try { privateKey = decrypt(wallet.privkey_encrypted); }
      catch (err) { console.warn(`[multichain-rebalance] decrypt fail ${src.chain}: ${err.message}`); continue; }

      // Execute bridge via selectAndBridge (Across V3 or Stargate based on amount)
      try {
        const { selectAndBridge } = await import('./bridge-router.js');
        const r = await selectAndBridge({ privateKey, fromChain: src.chain, toChain: d.chain, amount: needed, recipient: d.address, asset: 'USDT', relayId: BROKER_RELAY_ID });
        if (r.success || r.txHash) {
          console.log(`[multichain-rebalance] ✓ ${src.chain}→${d.chain} +${needed.toFixed(2)} USDT via ${r.protocol} TX ${(r.txHash || r.depositTxHash)?.slice(0, 16)}`);
          try {
            const { recordChainEvent } = await import('./chain-event.js');
            recordChainEvent({
              txid: `multichain_rebalance_${d.chain}_${Date.now()}`,
              eventType: 'broker_auto_replenish_v2',
              fromAddress: src.address, toAddress: d.address, observedBy: 'system',
              payload: { source: 'multichain_rebalance', src_chain: src.chain, dst_chain: d.chain, amount_usdt: needed, protocol: r.protocol, tx: r.txHash || r.depositTxHash, src_balance_before: src.usdt, dst_balance_before: d.usdt },
            });
          } catch {}
          sqlite.prepare(`INSERT INTO throttle_log (key, created_at) VALUES (?, datetime('now'))`).run(throttleKey);
        } else {
          console.warn(`[multichain-rebalance] ✗ bridge fail ${src.chain}→${d.chain}: ${r.error || JSON.stringify(r).slice(0, 200)}`);
        }
      } catch (err) {
        console.warn(`[multichain-rebalance] ✗ bridge err ${src.chain}→${d.chain}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[multichain-rebalance] tick err: ${err.message}`);
  } finally {
    _ticking = false;
  }
}

export function startMultichainRebalance() {
  if (_tickInterval) return;
  console.log('[multichain-rebalance] started — 5min cron (Across V3 / Stargate auto-pick by amount)');
  _tickInterval = setInterval(() => _runRebalanceTick().catch(() => {}), TICK_INTERVAL_MS);
}

export function stopMultichainRebalance() {
  if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; }
}

export const _internals = { _runRebalanceTick, _fetchChainUsdt };
