/**
 * Whale Alert — real-time large transfer monitoring
 *
 * Subscribes to UTXO changes for whale + exchange addresses via Kaspa RPC.
 * When a large transfer is detected (>threshold KAS), generates an alert
 * and reports to Console immediately.
 *
 * This is REAL-TIME — not polling. The local node pushes changes to us.
 *
 * Architecture:
 *   RPC subscribeUtxosChanged(whale_addresses)
 *     → utxos-changed event
 *     → calculate delta (balance change)
 *     → if |delta| > threshold → alert
 *     → POST /api/chain/whale-alert to Console
 *
 * Runs alongside rpc-scanner and balance-tracker.
 */

import * as kaspa from 'kaspa-wasm';

const { RpcClient, Resolver, Encoding } = kaspa;

const KASPA_NETWORK = process.env.KASPA_NETWORK || 'mainnet';
const SOMPI_PER_KAS = 100_000_000;

// Alert thresholds — tiered severity levels
// Raised from 100K to 500K: 100K was generating 3000+ alerts/day (noise)
const ALERT_THRESHOLD_KAS = parseInt(process.env.WHALE_ALERT_THRESHOLD_KAS || '500000');
const ALERT_CRITICAL_KAS = parseInt(process.env.WHALE_ALERT_CRITICAL_KAS || '5000000'); // 5M+ = critical

// Refresh watchlist every 30 minutes (pick up new addresses)
const WATCHLIST_REFRESH_MS = 30 * 60_000;

let _rpc = null;
let _reporter = null;
let _running = false;
let _balanceCache = new Map(); // address → last known balance (sompi)
let _addressMeta = new Map(); // address → { tag, label }
let _watchlistTimer = null;

/**
 * Start whale alert monitoring.
 */
export async function startWhaleAlert(reporter) {
  _reporter = reporter;
  _running = true;

  try {
    // Connect to RPC
    const rpcUrl = process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17110';
    _rpc = new RpcClient({
      url: rpcUrl,
      encoding: Encoding.Borsh,
      networkId: KASPA_NETWORK,
    });
    await _rpc.connect({});
    console.log(`[whale-alert] connected to RPC node`);

    // Load watchlist and subscribe
    await _refreshSubscriptions();

    // Listen for UTXO changes
    _rpc.addEventListener('utxos-changed', (event) => {
      _handleUtxoChange(event).catch(err => {
        console.error(`[whale-alert] handler error: ${err.message}`);
      });
    });

    // Handle disconnect
    _rpc.addEventListener('disconnect', () => {
      console.log('[whale-alert] disconnected from RPC');
      if (_running) {
        setTimeout(() => _reconnect(), 10000);
      }
    });

    // Periodically refresh watchlist (new addresses added)
    _watchlistTimer = setInterval(() => _refreshSubscriptions(), WATCHLIST_REFRESH_MS);

    console.log(`[whale-alert] monitoring active, threshold: ${ALERT_THRESHOLD_KAS.toLocaleString()} KAS`);
  } catch (err) {
    console.error(`[whale-alert] startup failed: ${err.message}`);
  }
}

/**
 * Stop whale alert monitoring.
 */
export function stopWhaleAlert() {
  _running = false;
  if (_watchlistTimer) {
    clearInterval(_watchlistTimer);
    _watchlistTimer = null;
  }
  if (_rpc) {
    _rpc.disconnect().catch(() => {});
    _rpc = null;
  }
  console.log('[whale-alert] stopped');
}

/**
 * Load watchlist from Console and subscribe to UTXO changes.
 */
async function _refreshSubscriptions() {
  try {
    const watchlist = await _reporter._get('/api/chain/watchlist');
    if (!watchlist?.length) {
      console.log('[whale-alert] no addresses in watchlist');
      return;
    }

    // Build address list for subscription
    const addresses = [];
    _addressMeta.clear();

    for (const w of watchlist) {
      addresses.push(w.address);
      _addressMeta.set(w.address, { tag: w.tag, label: w.label || w.address.slice(-12) });
    }

    // Subscribe to UTXO changes for all watched addresses
    await _rpc.subscribeUtxosChanged(addresses);
    console.log(`[whale-alert] subscribed to ${addresses.length} addresses`);

    // Seed initial balances
    for (let i = 0; i < addresses.length; i += 50) {
      const batch = addresses.slice(i, i + 50);
      try {
        const result = await _rpc.getBalancesByAddresses({ addresses: batch });
        if (result?.entries) {
          for (const entry of result.entries) {
            _balanceCache.set(entry.address, Number(entry.balance));
          }
        }
      } catch {}
    }

  } catch (err) {
    console.error(`[whale-alert] refresh failed: ${err.message}`);
  }
}

/**
 * Handle a UTXO change event — detect large transfers.
 */
async function _handleUtxoChange(event) {
  const data = event?.data;
  if (!data) return;

  // Process added and removed UTXOs to determine net change per address
  const deltas = new Map(); // address → net change in sompi

  // Added UTXOs = received funds
  if (data.added) {
    for (const utxo of data.added) {
      const addr = utxo?.address?.toString();
      const amount = Number(utxo?.utxoEntry?.amount || 0);
      if (addr && amount > 0) {
        deltas.set(addr, (deltas.get(addr) || 0) + amount);
      }
    }
  }

  // Removed UTXOs = spent funds
  if (data.removed) {
    for (const utxo of data.removed) {
      const addr = utxo?.address?.toString();
      const amount = Number(utxo?.utxoEntry?.amount || 0);
      if (addr && amount > 0) {
        deltas.set(addr, (deltas.get(addr) || 0) - amount);
      }
    }
  }

  // Check each address for significant changes
  for (const [addr, deltaSompi] of deltas) {
    const deltaKas = deltaSompi / SOMPI_PER_KAS;
    const absDelta = Math.abs(deltaKas);

    if (absDelta < ALERT_THRESHOLD_KAS) continue;

    const meta = _addressMeta.get(addr) || { tag: 'unknown', label: addr.slice(-12) };
    const prevBalance = _balanceCache.get(addr) || 0;
    const newBalance = prevBalance + deltaSompi;
    const direction = deltaKas > 0 ? 'INFLOW' : 'OUTFLOW';

    // Update cache
    _balanceCache.set(addr, newBalance);

    // Tiered severity: critical (5M+), warning (500K+)
    const severity = absDelta >= ALERT_CRITICAL_KAS ? 'critical' : 'warning';

    const alert = {
      address: addr,
      label: meta.label,
      tag: meta.tag,
      direction,
      amountKas: Math.abs(deltaKas),
      prevBalanceKas: prevBalance / SOMPI_PER_KAS,
      newBalanceKas: newBalance / SOMPI_PER_KAS,
      severity,
      timestamp: new Date().toISOString(),
    };

    // Log alert
    console.log(
      `[whale-alert] ${direction} ${absDelta.toLocaleString()} KAS | ` +
      `${meta.label} (${meta.tag}) | ` +
      `${(prevBalance / SOMPI_PER_KAS / 1e6).toFixed(1)}M → ${(newBalance / SOMPI_PER_KAS / 1e6).toFixed(1)}M KAS`
    );

    // Report to Console
    try {
      await _reporter._post('/api/chain/whale-alert', alert);
    } catch (err) {
      console.error(`[whale-alert] report failed: ${err.message}`);
    }
  }
}

/**
 * Reconnect after disconnect.
 */
async function _reconnect() {
  if (!_running) return;
  try {
    const rpcUrl = process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17110';
    _rpc = new RpcClient({
      url: rpcUrl,
      encoding: Encoding.Borsh,
      networkId: KASPA_NETWORK,
    });
    await _rpc.connect({});
    await _refreshSubscriptions();

    _rpc.addEventListener('utxos-changed', (event) => {
      _handleUtxoChange(event).catch(() => {});
    });
    _rpc.addEventListener('disconnect', () => {
      console.log('[whale-alert] disconnected');
      if (_running) setTimeout(() => _reconnect(), 10000);
    });

    console.log('[whale-alert] reconnected');
  } catch (err) {
    console.error(`[whale-alert] reconnect failed: ${err.message}`);
    if (_running) setTimeout(() => _reconnect(), 30000);
  }
}
