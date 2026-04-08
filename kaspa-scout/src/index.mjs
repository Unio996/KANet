/**
 * kaspa-scout — Kaspa Protocol Observatory
 * Passive on-chain protocol detection and intelligence gathering.
 *
 * Three scan modes:
 *   - indexer (default): timed loop querying Kasia Indexer API
 *   - rpc: real-time block subscription via Kaspa node RPC
 *   - backfill: re-scan historical blocks for missed Kasia activity
 *
 * Set SCAN_MODE=rpc|backfill to switch mode.
 */
import { loadState } from './lib/state.mjs';
import { initDetectors } from './protocols/registry.mjs';
import { Reporter } from './reporter.mjs';
import { startChainFundamentals, stopChainFundamentals } from './chain-fundamentals.mjs';
import { startBalanceTracker, stopBalanceTracker } from './balance-tracker.mjs';
import { startWhaleAlert, stopWhaleAlert } from './whale-alert.mjs';

// --- Config ---
const SCAN_MODE      = (process.env.SCAN_MODE || 'indexer').toLowerCase();
const CONSOLE_URL    = process.env.CONSOLE_URL || 'http://localhost:3100';
const INGEST_SECRET  = process.env.INGEST_SECRET;
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS || '30000');

if (!INGEST_SECRET) {
  console.error('[kaspa-scout] INGEST_SECRET is required. Get it from Console startup log.');
  process.exit(1);
}

// --- Boot ---
console.log('[kaspa-scout] Kaspa Protocol Observatory');
console.log(`[kaspa-scout] mode: ${SCAN_MODE}`);
console.log(`[kaspa-scout] console: ${CONSOLE_URL}`);

// Load persisted state
loadState();

// Create reporter (HTTP-only, never direct DB)
const reporter = new Reporter(CONSOLE_URL, INGEST_SECRET);

if (SCAN_MODE === 'backfill') {
  // ── Backfill Mode: re-scan historical blocks ────────────────────────────
  const { runBackfill } = await import('./backfill.mjs');

  const BACKFILL_START = process.env.BACKFILL_START || '2026-03-15T10:00:00Z';
  const BACKFILL_END   = process.env.BACKFILL_END   || '2026-03-15T20:00:00Z';

  console.log(`[kaspa-scout] backfill: ${BACKFILL_START} -> ${BACKFILL_END}`);

  try {
    await runBackfill(reporter, {
      startTime: BACKFILL_START,
      endTime:   BACKFILL_END,
      rpcUrl:    process.env.KASPA_RPC_URL || undefined,
      network:   process.env.KASPA_NETWORK || 'mainnet',
    });
  } catch (err) {
    console.error('[kaspa-scout] backfill error:', err.message);
    process.exit(1);
  }
  process.exit(0);

} else if (SCAN_MODE === 'rpc') {
  // ── RPC Mode: real-time block subscription ────────────────────────────
  const { startRpcScanner, stopRpcScanner } = await import('./rpc-scanner.mjs');
  const { startMessageIndexer, stopMessageIndexer } = await import('./message-indexer.mjs');

  // Pass local addresses so scanner can ingest messages destined for our agents
  const seedAddresses = await fetchSeedAddresses();
  console.log(`[kaspa-scout] local addresses for message ingest: ${seedAddresses.length}`);

  // Start message indexer (loads known addresses + checkpoint, refreshes every 5min)
  await startMessageIndexer();

  // History fetch: 补全停机期间遗漏的 TX（在实时订阅之前运行）
  const { runHistoryFetch } = await import('./history-fetcher.mjs');
  const histResult = await runHistoryFetch(reporter, seedAddresses);
  if (histResult.fetched > 0) {
    console.log(`[kaspa-scout] history fetch: ${histResult.fetched} TX checked, ${histResult.processed} Kasia hits, ${histResult.comms} comm messages`);
  }

  await startRpcScanner(reporter, seedAddresses);

  // Start chain fundamentals collector (independent of protocol scanner)
  await startChainFundamentals(reporter);

  // Start balance tracker (whale + exchange monitoring)
  await startBalanceTracker(reporter);

  // Start real-time whale alert (UTXO subscription for large transfers)
  await startWhaleAlert(reporter);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[kaspa-scout] shutting down...');
    stopWhaleAlert();
    stopBalanceTracker();
    stopChainFundamentals();
    stopMessageIndexer();
    await stopRpcScanner();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    stopWhaleAlert();
    stopBalanceTracker();
    stopChainFundamentals();
    stopMessageIndexer();
    await stopRpcScanner();
    process.exit(0);
  });

} else if (SCAN_MODE === 'light') {
  // ── Light Mode: address-specific UTXO subscription (public RPC) ──────
  // No full-block scanning. Only monitors local agent addresses.
  // Capabilities: handshake/comm/card/bcast detection for local agents.
  // Disabled: full-network scan, whale alerts, balance tracking.
  const { startLightScanner, stopLightScanner } = await import('./light-scanner.mjs');
  const { startMessageIndexer, stopMessageIndexer } = await import('./message-indexer.mjs');

  const seedAddresses = await fetchSeedAddresses();

  // 读取额外监控配置（Console scanner.js 通过环境变量传入）
  const extraAddresses = (process.env.SCOUT_WATCH_ADDRESSES || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const watchSignals = (process.env.SCOUT_WATCH_SIGNALS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const totalAddr = seedAddresses.length + extraAddresses.length;
  console.log(`[kaspa-scout] LIGHT MODE — ${seedAddresses.length} local + ${extraAddresses.length} extra addresses`);
  if (watchSignals.length > 0) {
    console.log(`[kaspa-scout] watch signals: [${watchSignals.join(', ')}]`);
  }
  console.log('[kaspa-scout] capabilities: handshake/comm/card detection for monitored addresses');
  console.log('[kaspa-scout] disabled: full-block scan, whale alerts, balance tracking');

  if (totalAddr === 0) {
    console.error('[kaspa-scout] LIGHT MODE: no addresses — nothing to monitor, exiting');
    process.exit(1);
  }

  await startMessageIndexer();

  // History fetch: 补全停机期间遗漏的 TX
  const { runHistoryFetch } = await import('./history-fetcher.mjs');
  const histResult = await runHistoryFetch(reporter, seedAddresses);
  if (histResult.fetched > 0) {
    console.log(`[kaspa-scout] history fetch: ${histResult.fetched} TX checked, ${histResult.processed} Kasia hits, ${histResult.comms} comm messages`);
  }

  await startLightScanner(reporter, seedAddresses, { extraAddresses, watchSignals });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[kaspa-scout] shutting down (light)...');
    stopMessageIndexer();
    await stopLightScanner();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    stopMessageIndexer();
    await stopLightScanner();
    process.exit(0);
  });

} else {
  // ── Indexer Mode: timed loop (original behavior) ──────────────────────
  const { Scanner } = await import('./scanner.mjs');

  console.log(`[kaspa-scout] interval: ${SCAN_INTERVAL_MS / 1000}s`);

  // Register protocol detectors (only needed for indexer mode)
  initDetectors();

  // Fetch seed addresses from Console (our own relay addresses)
  const seedAddresses = await fetchSeedAddresses();
  console.log(`[kaspa-scout] seed addresses: ${seedAddresses.length}`);

  // Start scanner
  const scanner = new Scanner(reporter, {
    intervalMs: SCAN_INTERVAL_MS,
    seedAddresses,
  });
  scanner.start();

  // Start chain fundamentals collector (independent of protocol scanner)
  await startChainFundamentals(reporter);

  // Start balance tracker (whale + exchange monitoring)
  await startBalanceTracker(reporter);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[kaspa-scout] shutting down...');
    stopBalanceTracker();
    stopChainFundamentals();
    scanner.stop();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    stopBalanceTracker();
    stopChainFundamentals();
    scanner.stop();
    process.exit(0);
  });
}

/**
 * Fetch our own relay addresses from Console to use as seed for graph expansion.
 * Falls back to empty array if Console is unreachable.
 */
async function fetchSeedAddresses() {
  try {
    const res = await fetch(`${CONSOLE_URL}/api/discovery/local-addresses`, {
      headers: { 'x-ingest-secret': INGEST_SECRET },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      return data.addresses || [];
    }
    console.warn(`[kaspa-scout] seed fetch failed: HTTP ${res.status}, starting with no seeds`);
  } catch (err) {
    console.warn(`[kaspa-scout] seed fetch failed: ${err.message}, starting with no seeds`);
  }
  return [];
}
