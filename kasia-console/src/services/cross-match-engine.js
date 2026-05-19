// C2 Cross-Match Engine (J2 #519 / NWT N19.11 三方共识 5/19, Owner 钦定 "C 是骨架")
//
// 协议层 maker-to-maker 撮合: 30s cron 扫 open exchange_offers, 找数学有交集 BUY+SELL pair,
// emit chain_event 'kanet_cross_match_v1' (Brain + Owner visibility). Phase 1 audit-only,
// Phase 2 可扩 active match-settle. broker 不参与 (跟 broker-as-maker 撮合 hub 模式分离).
//
// 4 risk gates (NWT N19.11):
// 1. oracle midpoint ±3% (防 fat-finger maker fake price)
// 2. chain align (Phase 1 same-chain only, 跨链 Phase 2)
// 3. same-org skip (Trader-A/B/M broker 互不撮合, 避免左手倒右手)
// 4. qty 全配 (Phase 1 ±5% tolerance, partial fill Phase 2)

import { sqlite } from '../db/client.js';
import { recordChainEvent } from './chain-event.js';

const TICK_MS = 30 * 1000;
const PRICE_TOLERANCE = 0.03;  // ±3% oracle deviation
const QTY_TOLERANCE = 0.05;    // ±5% qty deviation (full-fill Phase 1)
const BROKER_ORG_NAMES = ['Trader-A', 'Trader-B', 'Trader-M'];

let _running = false;
let _matchCount = 0;
let _scanCount = 0;
let _lastTickAt = null;

async function _getMarketPrice() {
  try {
    const { getCachedKasPrice } = await import('./market-data.js');
    let p = getCachedKasPrice();
    if (!p) {
      const { getKasPrice } = await import('./broker-v3/exchange-client.js');
      p = await getKasPrice();
    }
    return p || null;
  } catch (err) {
    console.warn(`[cross-match] price fetch err: ${err.message}`);
    return null;
  }
}

function _getBrokerOrgAddrs() {
  const placeholders = BROKER_ORG_NAMES.map(() => '?').join(',');
  return sqlite.prepare(
    `SELECT address FROM relay_nodes WHERE name IN (${placeholders})`
  ).all(...BROKER_ORG_NAMES).map(r => r.address);
}

export function tickCrossMatchOnce(marketPrice = null, brokerAddrs = null) {
  _scanCount++;
  _lastTickAt = new Date().toISOString();
  brokerAddrs = brokerAddrs || _getBrokerOrgAddrs();

  // NWT N19.20 hotfix Issue 4: marketPrice null fail-closed (Risk gate 1 不 bypass).
  // 历史 KI 12 14 silent skip pattern 同款 — null 时 silently continue → fat-finger maker fake price bypass.
  if (!marketPrice) {
    console.warn('[cross-match] tick skipped: marketPrice null (Risk gate 1 fail-closed)');
    try {
      recordChainEvent({
        txid: `cross_match_tick_${_scanCount}_${Date.now()}`,
        eventType: 'kanet_cross_match_tick_v1',
        payload: JSON.stringify({ scanCount: _scanCount, matchCount: _matchCount, skipReason: 'marketPrice_null' }),
      });
    } catch {}
    return { matches: [], scanCount: _scanCount, matchCount: _matchCount, lastTickAt: _lastTickAt, skipReason: 'marketPrice_null' };
  }

  const offers = sqlite.prepare(
    `SELECT id, maker, give_asset, give_amount, give_chain, want_asset, want_amount, want_chain
     FROM exchange_offers
     WHERE protocol_status = 'open' AND expires_at > datetime('now')`
  ).all();

  // group by direction (BUY KAS vs SELL KAS for Phase 1 KAS/USDT pair only)
  const buys = [];   // give USDT want KAS (broker BUY KAS direction)
  const sells = [];  // give KAS want USDT
  for (const o of offers) {
    const g = (o.give_asset || '').toUpperCase();
    const w = (o.want_asset || '').toUpperCase();
    if (g === 'KAS' && w === 'USDT') sells.push(o);
    else if (g === 'USDT' && w === 'KAS') buys.push(o);
  }

  const matches = [];
  for (const buy of buys) {
    for (const sell of sells) {
      // Risk gate 3: same-org skip (Trader-A/B/M 互不撮合)
      // NWT N19.25 / Owner 钦定 5/19 "干!!!": KANET_TEST_MODE=1 bypass for multi-actor real-chain test.
      // Production 默认 (无 var) 保持 same-org skip 不变.
      if (process.env.KANET_TEST_MODE !== '1' && brokerAddrs.includes(buy.maker) && brokerAddrs.includes(sell.maker)) continue;
      // same-maker can't cross self
      if (buy.maker === sell.maker) continue;

      // Risk gate 2: chain align (NWT N19.20 hotfix Issue 3 — fail-closed Phase 1).
      // 历史 P4 audit: production 67% offer NULL chain. wildcard 会撞 settle mismatch (KAS-only ↔ BSC-USDT).
      // Phase 1 strict: 双方都填 + 必 match. Phase 2 加 default chain inference.
      const buyUsdtChain = (buy.give_chain || '').toLowerCase() || null;
      const sellUsdtChain = (sell.want_chain || '').toLowerCase() || null;
      if (!buyUsdtChain || !sellUsdtChain || buyUsdtChain !== sellUsdtChain) continue;

      // price math (normalize to USDT/KAS)
      const buyPrice = parseFloat(buy.give_amount) / parseFloat(buy.want_amount);
      const sellPrice = parseFloat(sell.want_amount) / parseFloat(sell.give_amount);
      if (!isFinite(buyPrice) || !isFinite(sellPrice)) continue;
      // intersection: buy bid >= sell ask
      if (buyPrice < sellPrice) continue;

      // Risk gate 1: oracle midpoint ±3% (防 fat-finger). marketPrice null 早 return 不会到这.
      const midpoint = (buyPrice + sellPrice) / 2;
      if (Math.abs(midpoint - marketPrice) / marketPrice > PRICE_TOLERANCE) continue;

      // Risk gate 4: qty 全配 (Phase 1 ±5%)
      const buyKas = parseFloat(buy.want_amount);
      const sellKas = parseFloat(sell.give_amount);
      if (Math.abs(buyKas - sellKas) / Math.max(buyKas, sellKas) > QTY_TOLERANCE) continue;

      _matchCount++;
      matches.push({ buy, sell, buyPrice, sellPrice, midpoint, kasQty: Math.min(buyKas, sellKas) });

      console.log(`[cross-match] PAIR found: BUY ${buy.id.slice(0,8)} (price ${buyPrice.toFixed(6)}) ↔ SELL ${sell.id.slice(0,8)} (price ${sellPrice.toFixed(6)}) midpoint=${midpoint.toFixed(6)} qty=${buyKas} KAS`);

      try {
        recordChainEvent({
          // NWT N19.20 hotfix Issue 2: 加 _scanCount suffix 避 KI 14 txid UNIQUE collision 重 tick 同 pair.
          txid: `cross_match_${buy.id.slice(0,12)}_${sell.id.slice(0,12)}_t${_scanCount}`,
          eventType: 'kanet_cross_match_v1',
          fromAddress: buy.maker,
          toAddress: sell.maker,
          payload: JSON.stringify({
            buy_offer_id: buy.id, sell_offer_id: sell.id,
            buy_maker: buy.maker, sell_maker: sell.maker,
            buy_price: buyPrice, sell_price: sellPrice,
            midpoint, marketPrice,
            kas_qty: Math.min(buyKas, sellKas),
            buy_chain: buyUsdtChain, sell_chain: sellUsdtChain,
            scan_count: _scanCount,
          }),
        });
      } catch (err) {
        console.warn(`[cross-match] audit emit err: ${err.message}`);
      }
    }
  }

  // NWT N19.20 hotfix Issue 1: heartbeat emit (即使 0 match) 防 KI 18 silent skip (engine fire 不可观察).
  // 同款 KI 16 hedge silent dead 反面 — invariant: every tick → chain_event emit.
  try {
    recordChainEvent({
      txid: `cross_match_tick_${_scanCount}_${Date.now()}`,
      eventType: 'kanet_cross_match_tick_v1',
      payload: JSON.stringify({
        scanCount: _scanCount, matchCount: _matchCount,
        tickMatches: matches.length, buys: buys.length, sells: sells.length,
      }),
    });
  } catch {}

  return { matches, scanCount: _scanCount, matchCount: _matchCount, lastTickAt: _lastTickAt };
}

export function startCrossMatchEngine() {
  if (_running) return;
  _running = true;
  console.log('[cross-match] started — 30s cron, oracle ±3%, same-org skip, full-qty ±5% Phase 1');

  const runTick = async () => {
    try {
      const marketPrice = await _getMarketPrice();
      tickCrossMatchOnce(marketPrice);
    } catch (err) {
      console.error(`[cross-match] tick err: ${err.message}`);
    }
  };

  // Stagger 15s offset (避 market-seeder + treasury-monitor + broker-intake collision)
  setTimeout(() => {
    runTick();
    setInterval(runTick, TICK_MS);
  }, 15_000);
}

export const _internals = {
  TICK_MS, PRICE_TOLERANCE, QTY_TOLERANCE, BROKER_ORG_NAMES,
  _getMarketPrice, _getBrokerOrgAddrs,
  getStats: () => ({ scanCount: _scanCount, matchCount: _matchCount, lastTickAt: _lastTickAt, running: _running }),
};
