/**
 * Portfolio Aggregator — Unified view of all assets across chains/platforms.
 *
 * Why: Today's Phase 1 work created separate per-page connection bars but no single
 * place shows "where's all my money" — KANet's own native wallet page was reportedly
 * broken (tab inside /agent?tab=wallet). This endpoint is the backend for a clean
 * dedicated /portfolio page.
 *
 * Data sources (all in parallel, degrade gracefully on failure):
 *   - Kaspa wallet (relay_nodes.address)
 *   - EVM wallets (agent_wallets — BNB/ETH/Polygon/Arbitrum/Optimism/Base/Avalanche)
 *   - SOL/TRON wallets (if configured)
 *   - Hyperliquid account (if Arbitrum wallet exists)
 *   - Aave V3 position (if Arbitrum wallet exists)
 *   - Aevo account (if credentials configured)
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

    // Grand totals
    const totalKas = agentSummaries.reduce((s, a) => s + (a.kaspa?.balance || 0), 0);
    const totalUsdStable = agentSummaries.reduce((s, a) => s + (a.stableTotalUsd || 0), 0);
    const totalDefiUsd = agentSummaries.reduce((s, a) => s + (a.defiTotalUsd || 0), 0);
    const totalPerpEquityUsd = agentSummaries.reduce((s, a) => s + (a.perpEquityUsd || 0), 0);
    const grandTotalUsd = totalUsdStable + totalDefiUsd + totalPerpEquityUsd;
    const openPositionCount = agentSummaries.reduce((s, a) => s + (a.openPositions?.length || 0), 0);

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

  // 2) Compute stable token total across all chains (USDT + USDC)
  let stableTotalUsd = 0;
  for (const c of chains) {
    stableTotalUsd += (c.usdtBalance || 0) + (c.usdcBalance || 0);
  }

  // 3) Find Arbitrum wallet for DeFi lookups
  const arbWallet = chains.find(c => c.chain === 'arbitrum');
  let aave = null;
  let hyperliquid = null;
  let openPositions = [];
  let defiTotalUsd = 0;
  let perpEquityUsd = 0;

  if (arbWallet?.id) {
    // Aave position (parallel with HL)
    const [aaveRes, hlRes] = await Promise.allSettled([
      fetch(`${base}/api/defi/aave/status?walletId=${arbWallet.id}`, { signal: AbortSignal.timeout(10000) }).then(r => r.json()).catch(() => null),
      fetch(`${base}/api/defi/hyperliquid/status?walletId=${arbWallet.id}`, { signal: AbortSignal.timeout(15000) }).then(r => r.json()).catch(() => null),
    ]);

    if (aaveRes.status === 'fulfilled' && aaveRes.value?.ok) {
      const a = aaveRes.value.account || {};
      aave = {
        collateralUSD: a.totalCollateralUSD || 0,
        debtUSD: a.totalDebtUSD || 0,
        availableBorrowUSD: a.availableBorrowUSD || 0,
        healthFactor: a.healthFactor,
        netUsd: (a.totalCollateralUSD || 0) - (a.totalDebtUSD || 0),
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
          };
          perpEquityUsd += aevo.equity;
        }
      } else {
        aevo = { connected: false };
      }
    } catch {}
  }

  return {
    kaspa,
    chains,
    stableTotalUsd,
    defiTotalUsd,
    perpEquityUsd,
    aave,
    hyperliquid,
    aevo,
    openPositions,
  };
}
