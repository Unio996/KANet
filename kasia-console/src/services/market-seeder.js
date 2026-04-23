/**
 * Market Seeder — automated seed-order publisher for the free market.
 *
 * Dual-side: sell orders (KAS → USDT) + buy orders (USDT → KAS).
 * Reads mid-price from /api/trade/kas-price, applies configured spread,
 * publishes seed orders via /api/exchange/publish.
 * Orders tagged with metadata.source = "seeder" for tracking.
 */

import { sqlite } from '../db/client.js';
import { recordChainEvent } from './chain-event.js';

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

  // Step 4: publish buy order if none active
  const activeBuys = sqlite.prepare(`
    SELECT id FROM exchange_offers
    WHERE protocol_status = 'open'
      AND metadata LIKE '%"source":"seeder"%'
      AND want_asset = 'KAS'
      AND give_asset != 'KAS'
      AND (expires_at IS NULL OR expires_at > ?)
  `).all(now);

  if (activeBuys.length === 0) {
    results.buy = await publishSeedOrder(config, midPrice, 'buy');
  } else {
    results.buy = { skipped: true, reason: 'active_buy_exists', count: activeBuys.length };
  }

  console.log(`[seeder] tick complete — mid: ${midPrice.toFixed(6)}, sell: ${JSON.stringify(results.sell)}, buy: ${JSON.stringify(results.buy)}`);
  return results;
}

// ── Publish Seed Order ────────────────────────────────────

async function publishSeedOrder(config, midPrice, side) {
  // BUY side temporarily disabled: maker auto-pay-USDT path is not implemented
  // (exchange-machine.js _verifyAndComplete buy-shortcut marks completed without
  // delivering USDT to taker). Publishing buy offers traps takers — they send KAS
  // but never receive USDT. Skip until the gap is filled.
  if (side === 'buy' && !config.buy_agent_id) {
    return { ok: false, error: 'buy_disabled_until_maker_auto_pay_usdt_implemented' };
  }

  const agentId = side === 'sell'
    ? (config.sell_agent_id || getDefaultAgentId())
    : config.buy_agent_id;

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

  // Build verification config based on side
  let verification, verificationMeta;

  if (side === 'sell') {
    // Sell KAS → want USDT: cross_chain_tx verification (taker pays USDT to our EVM wallet)
    const wallets = sqlite.prepare(`
      SELECT chain, address FROM agent_wallets
      WHERE relay_node_id = ? AND is_default = 1 AND chain IN ('bnb', 'eth', 'sol', 'tron')
      ORDER BY CASE chain WHEN 'bnb' THEN 0 WHEN 'eth' THEN 1 WHEN 'sol' THEN 2 WHEN 'tron' THEN 3 ELSE 4 END
    `).all(agentId);

    if (wallets.length === 0) {
      console.log(`[seeder] No EVM wallets for sell order, skip`);
      return { ok: false, error: 'no_evm_wallets' };
    }
    verification = 'cross_chain_tx';
    verificationMeta = { accepted_chains: wallets.map(w => ({ chain: w.chain, address: w.address })), expected_asset: 'USDT' };
  } else {
    // Buy KAS → want KAS: kaspa_tx verification (taker pays KAS to our Kaspa address)
    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(agentId);
    if (!relay?.address) {
      console.log(`[seeder] No Kaspa address for buy order, skip`);
      return { ok: false, error: 'no_kaspa_address' };
    }
    verification = 'kaspa_tx';
    verificationMeta = { expected_address: relay.address, expected_asset: 'KAS' };
  }

  // P1-A: Price deviation guard — skip if price deviates >N% from cached market price
  const { getConfig } = await import('../data/settings/configs.js');
  const maxDeviationPct = parseFloat(await getConfig('seeder_price_deviation_pct')) || 5;
  const lastPrice = parseFloat(config.last_published_price) || 0;

  if (lastPrice > 0) {
    const deviation = Math.abs(midPrice - lastPrice) / lastPrice * 100;
    if (deviation > maxDeviationPct) {
      console.warn(`[seeder] Price deviation ${deviation.toFixed(1)}% exceeds ${maxDeviationPct}% threshold (mid: ${midPrice.toFixed(6)}, last: ${lastPrice.toFixed(6)}) — skipping ${side}`);
      recordChainEvent({
        eventType: 'seeder_price_skip',
        payload: JSON.stringify({ side, mid_price: midPrice, last_price: lastPrice, deviation_pct: deviation.toFixed(1), threshold_pct: maxDeviationPct }),
      });
      return { ok: false, error: 'price_deviation', deviation: deviation.toFixed(1), threshold: maxDeviationPct };
    }
  }

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
        verification,
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
      // Update last published price for deviation guard
      sqlite.prepare("UPDATE market_seeder_config SET last_published_price = ? WHERE id = 'default'").run(midPrice);
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

export async function fetchKasPrice() {
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
