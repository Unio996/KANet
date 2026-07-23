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
// 2026-07-14(Bettor #k2xd1y 第五源排查): 端口从过期 3100 改 3200(同批修正之一)。
const PORT = parseInt(process.env.PORT || '3200');

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

// ── TASK 5a: Seeder BUY deposit watcher ───────────────────────────────────

let _depositWatcherTimer = null;
let _refundWorkerTimer = null;

export function startSeederDepositWatcher() {
  // 每 30s tick: check awaiting_deposit → deposited → published
  _depositWatcherTimer = setInterval(async () => {
    try { await depositWatcherTick(); } catch (err) {
      console.error('[seeder] deposit watcher tick error:', err.message);
    }
  }, 30000);
  console.log('[seeder] seeder deposit watcher started (30s interval)');
}

export function stopSeederDepositWatcher() {
  if (_depositWatcherTimer) { clearInterval(_depositWatcherTimer); _depositWatcherTimer = null; }
}

// ── T5b: Seeder refund worker (timeout refund) ───────────────────────────────────

// Test injection hooks (mirror exchange-machine pattern)
let _sendCommandOverride = null;
let _transferUsdtOverride = null;
export function _testInjectSendCommandAsync(fn) { _sendCommandOverride = fn; }
export function _testResetSendCommandAsync() { _sendCommandOverride = null; }
export function _testInjectTransferUsdt(fn) { _transferUsdtOverride = fn; }
export function _testResetTransferUsdt() { _transferUsdtOverride = null; }
async function _getSendCommandAsync() {
  if (_sendCommandOverride) return _sendCommandOverride;
  const m = await import('./relay-manager.js');
  return m.sendCommandAsync;
}
async function _getTransferUsdt() {
  if (_transferUsdtOverride) return _transferUsdtOverride;
  const m = await import('./evm-transfer.js');
  return m.transferUsdt;
}

export function startSeederRefundWorker() {
  _refundWorkerTimer = setInterval(async () => {
    try { await refundWorkerTick(); } catch (err) {
      console.error('[seeder] refund worker tick error:', err.message);
    }
  }, 30000);
  console.log('[seeder] seeder refund worker started (30s interval)');
}

export function stopSeederRefundWorker() {
  if (_refundWorkerTimer) { clearInterval(_refundWorkerTimer); _refundWorkerTimer = null; }
}

export async function refundWorkerTick() {
  const expired = sqlite.prepare(`
    SELECT * FROM retail_dex_buy_publications
    WHERE state = 'published'
      AND expires_at < datetime('now')
  `).all();

  for (const pub of expired) {
    try {
      const offer = sqlite.prepare("SELECT * FROM exchange_offers WHERE id = ?").get(pub.seeder_publish_offer_id);
      if (!offer || offer.protocol_status !== 'open') continue;

      const now = new Date().toISOString();
      sqlite.prepare("UPDATE retail_dex_buy_publications SET state = 'refunding', updated_at = ? WHERE id = ?").run(now, pub.id);

      const sendCommandAsync = await _getSendCommandAsync();
      const cancelRes = await sendCommandAsync(pub.seeder_relay_id, {
        type: 'send_broadcast',
        payload: { t: 'kanet_exchange_cancel_v1', offer_id: pub.seeder_publish_offer_id, reason: 'timeout' },
      }, undefined, 'internal');
      if (cancelRes.error) throw new Error(`cancel_broadcast_failed: ${cancelRes.error}`);

      const order = sqlite.prepare(`
        SELECT pay_address, pay_chain FROM retail_dex_orders
        WHERE user_kasia_address = ? AND side = 'buy_kas'
        ORDER BY created_at DESC LIMIT 1
      `).get(pub.user_kasia_address);
      const refundAddr = order?.pay_address;
      if (!refundAddr) throw new Error('no_taker_refund_address');

      const transferUsdt = await _getTransferUsdt();
      const wallet = sqlite.prepare(
        "SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1 LIMIT 1"
      ).get(pub.seeder_relay_id, pub.pay_chain);
      if (!wallet?.privkey_encrypted) throw new Error('no_seeder_privkey');

      const { txHash, error } = await transferUsdt(pub.pay_chain, wallet.privkey_encrypted, refundAddr, parseFloat(pub.total_usdt));
      if (error) throw new Error(`refund_transfer_failed: ${error}`);

      sqlite.prepare("UPDATE retail_dex_buy_publications SET state = 'refunded', usdt_refund_tx = ?, updated_at = ? WHERE id = ?").run(txHash, now, pub.id);
      console.log(`[seeder] refund completed for pub ${pub.id.slice(0,8)}`);
      // T7 push DM
      try {
        const refreshedPub = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE id = ?").get(pub.id);
        const { pushPubTransition } = await import('./retail-dex-pusher.js');
        pushPubTransition({ pub: refreshedPub, newState: 'refunded', brokerRelayId: pub.broker_relay_id }).catch(e => console.warn(`[seeder] push refunded: ${e.message}`));
      } catch {}
    } catch (err) {
      const now = new Date().toISOString();
      sqlite.prepare("UPDATE retail_dex_buy_publications SET state = 'failed', error_reason = ? WHERE id = ?").run(err.message, pub.id);
      console.error(`[seeder] refund failed for pub ${pub.id.slice(0,8)}: ${err.message}`);
      // T7 push DM
      try {
        const refreshedPub = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE id = ?").get(pub.id);
        const { pushPubTransition } = await import('./retail-dex-pusher.js');
        pushPubTransition({ pub: refreshedPub, newState: 'failed', brokerRelayId: pub.broker_relay_id }).catch(e => console.warn(`[seeder] push failed: ${e.message}`));
      } catch {}
    }
  }
}

export async function depositWatcherTick() {
  const rows = sqlite.prepare(`
    SELECT * FROM retail_dex_buy_publications
    WHERE state = 'awaiting_deposit'
      AND (expires_at IS NULL OR expires_at > datetime('now'))
  `).all();

  for (const row of rows) {
    // Step 1: check seeder USDT balance
    const { getTokenBalance } = await import('./chain-balance.js');
    const r = await getTokenBalance('bnb', row.seeder_relay_id, 'usdt');
    if (r.error && !r.error.startsWith('no_')) {
      console.warn(`[seeder] balance check fail for pub ${row.id.slice(0,8)}: ${r.error}`);
      continue;
    }
    if (r.balance !== undefined && r.balance >= parseFloat(row.total_usdt) * 0.99) {
      // Step 2: mark deposited
      sqlite.prepare("UPDATE retail_dex_buy_publications SET state = 'deposited', updated_at = datetime('now') WHERE id = ?").run(row.id);
      console.log(`[seeder] pub ${row.id.slice(0,8)} → deposited (bal=${r.balance.toFixed(4)} >= ${row.total_usdt})`);
      // T7 push DM
      try {
        const refreshedPub = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE id = ?").get(row.id);
        const { pushPubTransition } = await import('./retail-dex-pusher.js');
        pushPubTransition({ pub: refreshedPub, newState: 'deposited', brokerRelayId: row.broker_relay_id }).catch(e => console.warn(`[seeder] push deposited: ${e.message}`));
      } catch {}
      // Step 3: publish buy offer next tick (handled by main seeder tick)
    }
  }

  // Step 4: for deposited rows, also trigger publishSeedOrder buy if seeder tick didn't pick it up
  const depositedRows = sqlite.prepare(`
    SELECT * FROM retail_dex_buy_publications
    WHERE state = 'deposited'
      AND seeder_publish_offer_id IS NULL
      AND (expires_at IS NULL OR expires_at > datetime('now'))
  `).all();

  for (const row of depositedRows) {
    try {
      const config = sqlite.prepare('SELECT * FROM market_seeder_config WHERE id = ?').get('default');
      if (!config?.enabled) continue;
      const midPrice = await fetchKasPrice();
      if (!midPrice || midPrice <= 0) continue;
      // publishSeedOrder needs a config with buy_agent_id; use getDefaultAgentId
      const result = await publishSeedOrder(config, midPrice, 'buy');
      if (result.ok) {
        sqlite.prepare(
          "UPDATE retail_dex_buy_publications SET state = 'published', seeder_publish_offer_id = ?, published_at = datetime('now') WHERE id = ?"
        ).run(result?.id || null, row.id);
        console.log(`[seeder] pub ${row.id.slice(0,8)} → published offer=${(result?.id || '').slice(0,8)}`);
        // T7 push DM
        try {
          const refreshedPub = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE id = ?").get(row.id);
          const { pushPubTransition } = await import('./retail-dex-pusher.js');
          pushPubTransition({ pub: refreshedPub, newState: 'published', brokerRelayId: row.broker_relay_id }).catch(e => console.warn(`[seeder] push published: ${e.message}`));
        } catch {}
      } else {
        console.warn(`[seeder] publish buy failed for pub ${row.id.slice(0,8)}: ${result.error || 'unknown'}`);
      }
    } catch (err) {
      console.error(`[seeder] publish buy err for pub ${row.id.slice(0,8)}: ${err.message}`);
    }
  }
}

export async function triggerTick() {
  return tick();
}

// ── Core Tick ─────────────────────────────────────────────

async function tick() {
  const config = sqlite.prepare('SELECT * FROM market_seeder_config WHERE id = ?').get('default');
  if (!config?.enabled) return { skipped: true, reason: 'disabled' };

  // R5 T-NWT-16: 如果 sell_agent_id 或 buy_agent_id 是 service relay (broker), 跳过 seeder
  // tick. broker-intake-watcher 自管 publish (broker 收 user KAS 后), 不需要 seeder 也跑.
  // (migrate v76 ec4367c8: is_dex_broker=1 → is_service=1).
  for (const fld of ['sell_agent_id', 'buy_agent_id']) {
    const id = config[fld];
    if (!id) continue;
    const r = sqlite.prepare('SELECT is_service, is_dex_broker FROM relay_nodes WHERE id=?').get(id);
    if (r?.is_service === 1 || r?.is_dex_broker === 1) {
      console.log(`[seeder] SKIP — ${fld}=${id.slice(0,8)} is service (broker self-manages publish via broker-intake-watcher)`);
      return { skipped: true, reason: `${fld} is service` };
    }
  }

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
    // 2026-07-14(Bettor #k2xd1y 第五源排查): 补 AbortSignal.timeout(本文件 TICK_INTERVAL_MS=5min 常驻循环调此路径, 同族 legacyRefundBuilderTick 自锁风险)。
    const res = await fetch(`http://127.0.0.1:${PORT}/api/exchange/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
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
