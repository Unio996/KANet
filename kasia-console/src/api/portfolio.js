/**
 * Portfolio Aggregator — Unified view of all assets across chains/platforms.
 *
 * Data sources (all in parallel, degrade gracefully on failure):
 *   - Kaspa wallet (relay_nodes.address)
 *   - EVM wallets (agent_wallets — BNB/ETH/Polygon/Arbitrum/Optimism/Base/Avalanche)
 *     · includes native USDC + bridged USDC.e/USDbC variants
 *   - SOL/TRON wallets (if configured)
 *   - Hyperliquid account (if Arbitrum wallet exists)
 *   - Aave V3 position (if Arbitrum wallet exists)
 *   - Aevo account (if credentials configured)
 *   - KANet Exchange locked funds (fund_locks — display-only, not added to totals)
 *   - Polymarket open positions (if API credentials configured)
 */

import { sqlite } from '../db/client.js';
import { decrypt } from '../services/crypto.js';

export async function registerPortfolioRoutes(fastify) {

  // ── GET /portfolio — the page ──
  fastify.get('/portfolio', async (request, reply) => {
    return reply.view('portfolio.eta', { _page: 'portfolio', pageTitle: 'Portfolio — KANet' });
  });

  // ── GET /api/portfolio/unified — aggregate everything ──
  //
  // Query: ?relayId=X (specific agent) OR no relayId (all agents combined)
  fastify.get('/api/portfolio/unified', async (request, reply) => {
    const { relayId } = request.query;

    // Collect target relays
    const relays = relayId
      ? sqlite.prepare('SELECT id, name, address, adapter_node_id FROM relay_nodes WHERE id = ?').all(relayId)
      : sqlite.prepare('SELECT id, name, address, adapter_node_id FROM relay_nodes WHERE address IS NOT NULL ORDER BY name').all();

    if (relays.length === 0) {
      return reply.code(404).send({ error: 'No relays found' });
    }

    // Build aggregate per relay
    const agentSummaries = await Promise.all(relays.map(async (r) => {
      const section = await _aggregateForRelay(r, fastify);
      return { id: r.id, name: r.name, address: r.address, ...section };
    }));

    // Grand totals — single-counting: every USD belongs to exactly one bucket
    const totalKas = agentSummaries.reduce((s, a) => s + (a.kaspa?.balance || 0), 0);
    const totalUsdStable = agentSummaries.reduce((s, a) => s + (a.stableTotalUsd || 0), 0);
    const totalNativeUsd = agentSummaries.reduce((s, a) => s + (a.nativeTotalUsd || 0), 0);
    const totalDefiUsd = agentSummaries.reduce((s, a) => s + (a.defiTotalUsd || 0), 0);
    const totalPerpEquityUsd = agentSummaries.reduce((s, a) => s + (a.perpEquityUsd || 0), 0);
    const grandTotalUsd = totalUsdStable + totalNativeUsd + totalDefiUsd + totalPerpEquityUsd;
    // Open positions: HL (openPositions array) + Aevo + Polymarket + Aave
    const openPositionCount = agentSummaries.reduce((s, a) =>
      s + (a.openPositions?.length || 0)
        + (a.aevo?.positionsCount || 0)
        + (a.polymarket?.positionCount || 0)
        + (a.aave?.positionsCount || 0),
      0,
    );

    // KAS price for unit conversion (read from market-data cache, no external call)
    let kasPriceUsd = null;
    try {
      const { getCachedKasPrice } = await import('../services/market-data.js');
      kasPriceUsd = getCachedKasPrice();
    } catch {}

    // Grand total expressed in KAS for the "count your wealth in KAS" view
    const grandTotalKas = kasPriceUsd && kasPriceUsd > 0
      ? totalKas + (grandTotalUsd / kasPriceUsd)
      : totalKas;

    return reply.send({
      ok: true,
      agents: agentSummaries,
      totals: {
        kas: totalKas,
        stableUsd: totalUsdStable,
        nativeUsd: totalNativeUsd,
        defiUsd: totalDefiUsd,
        perpEquityUsd: totalPerpEquityUsd,
        grandTotalUsd,
        grandTotalKas,
        openPositionCount,
      },
      kasPriceUsd,
      timestamp: new Date().toISOString(),
    });
  });
}

// ── Internal helper ──
async function _aggregateForRelay(relay, fastify) {
  const PORT = process.env.PORT || 3100;
  const base = `http://127.0.0.1:${PORT}`;

  // 1) Base wallet data from existing /api/relay/:id/wallets
  let walletData = null;
  try {
    walletData = await fetch(`${base}/api/relay/${relay.id}/wallets`, { signal: AbortSignal.timeout(15000) }).then(r => r.json());
  } catch {}

  const kaspa = walletData?.kaspa || { address: relay.address, balance: 0 };
  const chains = walletData?.chains || [];

  // 2a) Compute stable token total across all chains (USDT + USDC)
  let stableTotalUsd = 0;
  for (const c of chains) {
    stableTotalUsd += (c.usdtBalance || 0) + (c.usdcBalance || 0);
  }

  // 2b) Compute native token total in USD ("其他资产" — separate from stables).
  // Single-counting principle: native belongs HERE, never folded into stableTotalUsd.
  // Price source: market-data.js cached CoinGecko prices (60s TTL).
  let nativeTotalUsd = 0;
  try {
    const { getCachedNativePrice } = await import('../services/market-data.js');
    for (const c of chains) {
      const amount = c.nativeBalance || 0;
      if (amount <= 0) continue;
      const price = getCachedNativePrice(c.chain) || 0;
      nativeTotalUsd += amount * price;
    }
  } catch {}

  // 3) Find Arbitrum wallet for DeFi lookups
  const arbWallet = chains.find(c => c.chain === 'arbitrum');
  let aave = null;
  let hyperliquid = null;
  let openPositions = [];
  let defiTotalUsd = 0;
  let perpEquityUsd = 0;

  // 3a) KANet Exchange locked funds — money the agent has committed to pending
  // trades. The funds are still physically in the EOA (wallet balance already
  // includes them) so we show as a display-only reservation, NOT summed into totals.
  const exchangeLocks = _getExchangeLocks(relay.address);

  // 3b) Polymarket open positions — these ARE additional to wallet balance because
  // shares are held in the Polymarket CTF contract, not the EOA.
  const polymarket = await _getPolymarketSummary(relay.id);

  if (arbWallet?.id) {
    // Aave position (parallel with HL)
    const [aaveRes, hlRes] = await Promise.allSettled([
      fetch(`${base}/api/defi/aave/status?walletId=${arbWallet.id}`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()).catch(() => null),
      fetch(`${base}/api/defi/hyperliquid/status?walletId=${arbWallet.id}`, { signal: AbortSignal.timeout(15000) }).then(r => r.json()).catch(() => null),
    ]);

    if (aaveRes.status === 'fulfilled' && aaveRes.value?.ok) {
      const a = aaveRes.value.account || {};
      const collateralUSD = a.totalCollateralUSD || 0;
      const debtUSD = a.totalDebtUSD || 0;
      // Aave has no per-asset positions endpoint, only aggregate USD. Treat
      // "having collateral" and "having debt" as separate open positions —
      // approximation but correct in spirit (supplying != borrowing).
      const positionsCount = (collateralUSD > 0 ? 1 : 0) + (debtUSD > 0 ? 1 : 0);
      aave = {
        collateralUSD,
        debtUSD,
        availableBorrowUSD: a.availableBorrowUSD || 0,
        healthFactor: a.healthFactor,
        netUsd: collateralUSD - debtUSD,
        positionsCount,
      };
      defiTotalUsd += aave.netUsd;
    }

    if (hlRes.status === 'fulfilled' && hlRes.value?.ok) {
      const acct = hlRes.value.account || {};
      hyperliquid = {
        accountValue: acct.accountValue || 0,
        available: acct.available || 0,
        marginUsedPct: acct.marginUsedPct || 0,
        unrealizedPnl: acct.unrealizedPnl || 0,
        positionsCount: (hlRes.value.positions || []).length,
      };
      perpEquityUsd += hyperliquid.accountValue;
      openPositions.push(...(hlRes.value.positions || []).map(p => ({ ...p, platform: 'hyperliquid' })));
    }
  }

  // 4) Aevo (if credentials configured for this adapter)
  let aevo = null;
  if (relay.adapter_node_id) {
    try {
      const statusRes = await fetch(`${base}/api/defi/aevo/connection-status?adapterId=${relay.adapter_node_id}`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => null);
      if (statusRes?.ok && statusRes.connected) {
        const acctRes = await fetch(`${base}/api/defi/aevo/account?agentId=${relay.id}`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()).catch(() => null);
        if (acctRes) {
          aevo = {
            connected: true,
            equity: acctRes.equity || 0,
            available: acctRes.available || 0,
            marginPct: acctRes.marginPct || 0,
            portfolioGreeks: acctRes.portfolioGreeks || null,
            positionsCount: acctRes.positionsCount || 0,
          };
          perpEquityUsd += aevo.equity;
        }
      } else {
        aevo = { connected: false };
      }
    } catch {}
  }

  if (polymarket?.approxValueUsd) {
    defiTotalUsd += polymarket.approxValueUsd;
  }

  return {
    kaspa,
    chains,
    stableTotalUsd,
    nativeTotalUsd,
    defiTotalUsd,
    perpEquityUsd,
    aave,
    hyperliquid,
    aevo,
    exchangeLocks,
    polymarket,
    openPositions,
  };
}

// ── KANet Exchange fund locks (display-only) ──
function _getExchangeLocks(agentAddress) {
  if (!agentAddress) return { byAsset: {}, count: 0, hasAny: false };
  try {
    const rows = sqlite.prepare(
      "SELECT asset, SUM(amount) AS total, COUNT(*) AS n FROM fund_locks WHERE agent_address = ? AND status = 'locked' GROUP BY asset"
    ).all(agentAddress);
    const byAsset = {};
    let count = 0;
    for (const r of rows) {
      const k = (r.asset || 'unknown').toLowerCase();
      byAsset[k] = r.total;
      count += r.n;
    }
    return { byAsset, count, hasAny: rows.length > 0 };
  } catch {
    return { byAsset: {}, count: 0, hasAny: false };
  }
}

// ── Polymarket open positions (best-effort) ──
async function _getPolymarketSummary(relayId) {
  try {
    const { getPolygonWallet, getPositions } = await import('../services/polymarket.js');
    const wallet = getPolygonWallet(relayId);
    if (!wallet) return null;
    const hasCreds = !!sqlite.prepare(
      "SELECT 1 FROM config_entries WHERE key = ?"
    ).get(`polymarket_api_${relayId}`);
    // data-api 不需要 creds, 但 'configured' 仍以 CLOB key 是否已设为准.
    const positions = await Promise.race([
      getPositions(wallet.address),
      new Promise(r => setTimeout(() => r([]), 5000)),
    ]);
    const list = Array.isArray(positions) ? positions : [];
    let approxValueUsd = 0;
    for (const p of list) {
      // data-api gives currentValue directly (size × curPrice); fall back if missing.
      const cv = parseFloat(p.currentValue ?? 0);
      if (cv > 0) { approxValueUsd += cv; continue; }
      const sz = parseFloat(p.size ?? 0);
      const pr = parseFloat(p.curPrice ?? p.avgPrice ?? 0);
      if (sz > 0 && pr > 0) approxValueUsd += sz * pr;
    }
    return {
      configured: hasCreds,
      walletAddress: wallet.address,
      positionCount: list.length,
      approxValueUsd,
    };
  } catch {
    return null;
  }
}
