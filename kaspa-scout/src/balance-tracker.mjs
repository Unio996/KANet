/**
 * Balance Tracker — whale + exchange address monitoring
 *
 * Periodically queries the Kaspa RPC node for balances of watched addresses,
 * detects significant changes, and reports to Console.
 *
 * Address sources:
 *   1. Console whale_watchlist table (configured by user)
 *   2. Console identities table (auto-discovered by Scout)
 *   3. Hardcoded known exchange addresses (seed list)
 *
 * Data flow: RPC getBalancesByAddresses → Console POST /api/chain/balances
 *
 * Runs on its own timer, independent of protocol scanner and chain-fundamentals.
 */

import * as kaspa from 'kaspa-wasm';

const { RpcClient } = kaspa;
const Resolver = kaspa.Resolver || null;

function _rpcOpts() {
  const url = process.env.KASPA_RPC_URL;
  if (url) return { url, networkId: KASPA_NETWORK };
  if (Resolver) return { resolver: new Resolver(), networkId: KASPA_NETWORK };
  throw new Error('No RPC URL configured and Resolver unavailable. Set KASPA_RPC_URL env var.');
}

const KASPA_NETWORK = process.env.KASPA_NETWORK || 'mainnet';
// Balance tracking interval: 10 minutes (more frequent than chain-fundamentals)
const TRACK_INTERVAL_MS = parseInt(process.env.BALANCE_TRACK_INTERVAL_MS || '600000');
// Max addresses per RPC batch (avoid overloading)
const BATCH_SIZE = 50;

const SOMPI_PER_KAS = 100_000_000;

// ── External API for address enrichment ──
// api.kaspa.org provides address tags (exchange/fund/pool labels)
// and serves as fallback data source when local RPC is insufficient.
const KASPA_API = 'https://api.kaspa.org';

// Enrichment cache: address → { tag, label, enrichedAt }
const _enrichmentCache = new Map();

let _rpc = null;
let _timer = null;
let _reporter = null;
let _running = false;
let _lastBalances = new Map(); // address → last known balance (sompi)

/**
 * Start the balance tracker.
 */
export async function startBalanceTracker(reporter) {
  _reporter = reporter;

  // Connect to RPC
  try {
    _rpc = new RpcClient(_rpcOpts());
    await _rpc.connect();
    console.log(`[balance-tracker] connected to Kaspa ${KASPA_NETWORK} node`);
  } catch (err) {
    console.error(`[balance-tracker] RPC connect failed: ${err.message}`);
    _rpc = null;
  }

  // First run
  await _trackCycle();

  // Schedule periodic tracking
  _timer = setInterval(() => _trackCycle(), TRACK_INTERVAL_MS);
  console.log(`[balance-tracker] tracking every ${TRACK_INTERVAL_MS / 1000}s`);
}

/**
 * Stop the tracker.
 */
export function stopBalanceTracker() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  if (_rpc) {
    _rpc.disconnect().catch(() => {});
    _rpc = null;
  }
  console.log('[balance-tracker] stopped');
}

/**
 * Single tracking cycle.
 */
async function _trackCycle() {
  if (_running) return;
  _running = true;

  try {
    // Reconnect if needed
    if (!_rpc) {
      _rpc = new RpcClient(_rpcOpts());
      await _rpc.connect();
    }

    // 1. Get addresses to track from Console
    const addresses = await _getTrackedAddresses();
    if (addresses.length === 0) {
      _running = false;
      return;
    }

    // 2. Enrich unknown addresses with tags from api.kaspa.org
    await _enrichAddressTags(addresses);

    // 3. Query balances in batches
    const balanceResults = [];
    for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
      const batch = addresses.slice(i, i + BATCH_SIZE);
      const addrs = batch.map(a => a.address);

      try {
        const result = await _rpc.getBalancesByAddresses({ addresses: addrs });
        if (result?.entries) {
          for (const entry of result.entries) {
            const addr = entry.address;
            const sompi = Number(entry.balance);
            const kas = sompi / SOMPI_PER_KAS;
            const info = batch.find(a => a.address === addr);

            // Detect significant change
            const prev = _lastBalances.get(addr);
            if (prev !== undefined && prev > 0) {
              const changePct = ((sompi - prev) / prev) * 100;
              if (Math.abs(changePct) > 5) {
                const direction = changePct > 0 ? 'INFLOW' : 'OUTFLOW';
                console.log(
                  `[balance-tracker] ${direction} ${Math.abs(changePct).toFixed(1)}%: ` +
                  `${info?.label || addr.slice(-12)} ${(prev / SOMPI_PER_KAS).toFixed(2)} → ${kas.toFixed(2)} KAS`
                );
              }
            }

            _lastBalances.set(addr, sompi);
            balanceResults.push({
              address: addr,
              balanceSompi: sompi,
              balanceKas: kas,
              tag: info?.tag || null,
            });
          }
        }
      } catch (err) {
        console.error(`[balance-tracker] batch query error: ${err.message}`);
      }
    }

    // 3. Report to Console
    if (balanceResults.length > 0) {
      await _reporter._post('/api/chain/balances', { balances: balanceResults });
      console.log(`[balance-tracker] tracked ${balanceResults.length} addresses`);
    }

  } catch (err) {
    console.error(`[balance-tracker] cycle error: ${err.message}`);
    if (_rpc) { _rpc.disconnect().catch(() => {}); _rpc = null; }
  }

  _running = false;
}

/**
 * Get addresses to track from Console + known list.
 * Combines: watchlist (manual) + discovered identities (auto) + known exchanges.
 */
async function _getTrackedAddresses() {
  const addresses = new Map(); // address → { tag, label }

  // 1. Known exchange addresses (hardcoded seed)
  for (const addr of KNOWN_EXCHANGE_ADDRESSES) {
    addresses.set(addr, { address: addr, tag: 'exchange', label: 'known-exchange' });
  }

  // 2. Console whale_watchlist (user-configured)
  try {
    const watchlist = await _reporter._get('/api/chain/watchlist');
    for (const w of (watchlist || [])) {
      addresses.set(w.address, { address: w.address, tag: w.tag, label: w.label });
    }
  } catch {}

  // 3. Top discovered addresses from Console (by interaction count)
  try {
    const discovered = await _reporter._get('/api/discovery/activity?limit=200');
    for (const d of (discovered || [])) {
      if (d.address && !addresses.has(d.address)) {
        addresses.set(d.address, {
          address: d.address,
          tag: 'discovered',
          label: d.name || d.address.slice(-12),
        });
      }
    }
  } catch {}

  return [...addresses.values()];
}

/**
 * Enrich addresses with tags from api.kaspa.org.
 * Only queries addresses that haven't been enriched yet.
 * The API returns entity labels like "MEXC", "Bybit", "Gate.io", etc.
 */
async function _enrichAddressTags(addresses) {
  const toEnrich = addresses.filter(a => {
    if (a.tag !== 'discovered') return false; // Only enrich unknown ones
    const cached = _enrichmentCache.get(a.address);
    if (cached && Date.now() - cached.enrichedAt < 86400000) return false; // Cache 24h
    return true;
  });

  // Limit to 5 enrichments per cycle to avoid rate limiting
  for (const addr of toEnrich.slice(0, 5)) {
    try {
      const res = await fetch(`${KASPA_API}/addresses/${addr.address}/tag`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.name) {
          // Got a label! Update the address info and watchlist
          const isExchange = /exchange|mexc|bybit|gate|bitget|kucoin|uphold|binance|coinbase|okx/i.test(data.name);
          const isFund = /fund|foundation|protocol|team|dev/i.test(data.name);
          const newTag = isExchange ? 'exchange' : isFund ? 'fund' : 'whale';

          addr.tag = newTag;
          addr.label = data.name;

          // Update watchlist in Console
          try {
            await _reporter._post('/api/chain/watchlist', {
              address: addr.address,
              tag: newTag,
              label: data.name,
            });
            console.log(`[balance-tracker] enriched: ${addr.address.slice(-12)} → ${data.name} (${newTag})`);
          } catch {}

          _enrichmentCache.set(addr.address, { tag: newTag, label: data.name, enrichedAt: Date.now() });
        } else {
          _enrichmentCache.set(addr.address, { tag: 'discovered', label: null, enrichedAt: Date.now() });
        }
      }
    } catch {}
  }
}
