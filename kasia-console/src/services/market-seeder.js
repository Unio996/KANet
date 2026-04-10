/**
 * Market Seeder — automated seed-order publisher for the free market.
 *
 * Phase 1: sell orders only (KAS → USDT).
 * Reads mid-price from /api/trade/kas-price, applies configured spread,
 * publishes seed orders via /api/exchange/publish.
 * Orders tagged with metadata.source = "seeder" for tracking.
 */

import { sqlite } from '../db/client.js';

let _timer = null;
const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const PORT = parseInt(process.env.PORT || '3100');

// ── Public API ────────────────────────────────────────────

export function startMarketSeeder() {
  // Initial tick after a short delay (let routes register first)
  setTimeout(() => tick().catch(err => console.error('[seeder] initial tick error:', err.message)), 5000);
  _timer = setInterval(() => tick().catch(err => console.error('[seeder] tick error:', err.message)), TICK_INTERVAL_MS);
  console.log('[seeder] Market seeder started (5min interval)');
}

export function stopMarketSeeder() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

export async function triggerTick() {
  return tick();
}

// ── Core Tick ─────────────────────────────────────────────

async function tick() {
  const config = sqlite.prepare('SELECT * FROM market_seeder_config WHERE id = ?').get('default');
  if (!config?.enabled) return { skipped: true, reason: 'disabled' };

  // Step 1: fetch current KAS price
  const midPrice = await fetchKasPrice();
  if (!midPrice || midPrice <= 0) {
    console.log('[seeder] Price unavailable, skip tick');
    return { skipped: true, reason: 'no_price' };
  }

  // Step 2: check active seed orders
  const now = new Date().toISOString();
  const activeSells = sqlite.prepare(`
    SELECT id FROM exchange_offers
    WHERE protocol_status = 'open'
      AND metadata LIKE '%"source":"seeder"%'
      AND give_asset = 'KAS'
      AND (expires_at IS NULL OR expires_at > ?)
  `).all(now);

  const results = {};

  // Step 3: publish sell order if none active
  if (activeSells.length === 0) {
    results.sell = await publishSeedOrder(config, midPrice, 'sell');
  } else {
    results.sell = { skipped: true, reason: 'active_sell_exists', count: activeSells.length };
  }

  // Phase 2: buy orders (when USDT balance available)
  // const activeBuys = sqlite.prepare(`...give_asset != 'KAS'...`).all();

  console.log(`[seeder] tick complete — mid: ${midPrice.toFixed(6)}, sell: ${JSON.stringify(results.sell)}`);
  return results;
}

// ── Publish Seed Order ────────────────────────────────────

async function publishSeedOrder(config, midPrice, side) {
  const agentId = side === 'sell'
    ? (config.sell_agent_id || getDefaultAgentId())
    : (config.buy_agent_id || getDefaultAgentId());

  if (!agentId) {
    console.log(`[seeder] No agent configured for ${side} orders`);
    return { ok: false, error: 'no_agent' };
  }

  let giveAsset, giveAmount, wantAsset, wantAmount, spreadPct;

  if (side === 'sell') {
    spreadPct = config.sell_spread_pct;
    const sellPrice = midPrice * (1 + spreadPct / 100);
    giveAsset = 'KAS';
    giveAmount = String(config.amount_kas);
    wantAsset = 'USDT';
    wantAmount = (config.amount_kas * sellPrice).toFixed(4);
  } else {
    // Phase 2
    spreadPct = config.buy_spread_pct;
    const buyPrice = midPrice * (1 - spreadPct / 100);
    giveAsset = 'USDT';
    giveAmount = (config.amount_kas * buyPrice).toFixed(4);
    wantAsset = 'KAS';
    wantAmount = String(config.amount_kas);
  }

  // Query maker's multi-chain wallets for receive addresses
  // Phase 1: only EVM chains with auto-pay support (BNB/ETH). SOL/TRON added in Phase 2.
  const wallets = sqlite.prepare(`
    SELECT chain, address FROM agent_wallets
    WHERE relay_node_id = ? AND is_default = 1 AND chain IN ('bnb', 'eth')
    ORDER BY CASE chain WHEN 'bnb' THEN 0 WHEN 'eth' THEN 1 ELSE 2 END
  `).all(agentId);

  // Build verification_meta with accepted chains (for cross_chain_tx verification)
  const usesCrossChain = wantAsset === 'USDT' && wallets.length > 0;
  const verificationMeta = usesCrossChain
    ? { accepted_chains: wallets.map(w => ({ chain: w.chain, address: w.address })), expected_asset: 'USDT' }
    : {};

  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/exchange/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relayNodeId: agentId,
        give_asset: giveAsset,
        give_amount: giveAmount,
        want_asset: wantAsset,
        want_amount: wantAmount,
        verification: usesCrossChain ? 'cross_chain_tx' : 'manual',
        verification_meta: verificationMeta,
        expires_minutes: config.expires_minutes,
        metadata: {
          source: 'seeder',
          mid_price: midPrice,
          spread_pct: spreadPct,
          side,
        },
      }),
    });
    const data = await res.json();

    if (data.ok) {
      console.log(`[seeder] ${side.toUpperCase()} seed published: ${giveAmount} ${giveAsset} → ${wantAmount} ${wantAsset} (spread +${spreadPct}%)`);
    } else {
      console.log(`[seeder] ${side.toUpperCase()} seed failed: ${data.error || 'unknown'} — will retry next tick`);
    }
    return data;
  } catch (err) {
    console.error(`[seeder] publish ${side} failed:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ── Helpers ───────────────────────────────────────────────

async function fetchKasPrice() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/trade/kas-price`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return data?.price || null;
  } catch {
    return null;
  }
}

function getDefaultAgentId() {
  const row = sqlite.prepare('SELECT id FROM relay_nodes ORDER BY name LIMIT 1').get();
  return row?.id || null;
}
