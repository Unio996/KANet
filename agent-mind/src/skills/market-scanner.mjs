/**
 * Skill: Market Scanner — 跨交易所价差扫描
 *
 * 6 家 CEX + KANet 自由市场实时 bid/ask。
 * 计算价差矩阵，报告套利机会和做市参考价。
 *
 * Layer 1 only：只看不动，零副作用。
 * 公开 API，无需认证。
 */

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

// ── CEX 公开 Ticker 端点 ─────────────────────────────────────────────────────

const CEX = [
  {
    id: 'mexc', name: 'MEXC',
    url: 'https://api.mexc.com/api/v3/ticker/bookTicker?symbol=KASUSDT',
    parse: (d) => ({ bid: +d.bidPrice, ask: +d.askPrice }),
  },
  {
    id: 'gate', name: 'Gate',
    url: 'https://api.gateio.ws/api/v4/spot/tickers?currency_pair=KAS_USDT',
    parse: (d) => {
      const t = Array.isArray(d) ? d[0] : d;
      return { bid: +t.highest_bid, ask: +t.lowest_ask };
    },
  },
  {
    id: 'kucoin', name: 'KuCoin',
    url: 'https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=KAS-USDT',
    parse: (d) => ({ bid: +(d.data?.bestBid), ask: +(d.data?.bestAsk) }),
  },
  {
    id: 'bybit', name: 'Bybit',
    url: 'https://api.bybit.com/v5/market/tickers?category=spot&symbol=KASUSDT',
    parse: (d) => {
      const t = d.result?.list?.[0];
      return { bid: +(t?.bid1Price), ask: +(t?.ask1Price) };
    },
  },
  {
    id: 'bitget', name: 'Bitget',
    url: 'https://api.bitget.com/api/v2/spot/market/tickers?symbol=KASUSDT',
    parse: (d) => {
      const t = d.data?.[0] || d.data;
      return { bid: +(t?.bidPr || t?.buyOne), ask: +(t?.askPr || t?.sellOne) };
    },
  },
  // HTX 排除：Maker 0.20% / Taker 0.20%，阈值 0.40%，不划算
  {
    id: 'binance_perp', name: 'Binance⚡',
    url: 'https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=KASUSDT',
    parse: (d) => ({ bid: +d.bidPrice, ask: +d.askPrice }),
    note: 'perpetual futures — hedge tool with leverage',
  },
  // Kraken 排除：Maker 0.25% / Taker 0.40%，阈值 0.65%，不划算
];

const FETCH_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 30_000;
const PROACTIVE_COOLDOWN_MS = 60 * 60 * 1000; // 1 小时

const REACTIVE_KEYWORDS = [
  'spread', 'arb', '价差', '套利', '做市', 'market making', '挂单',
  'scanner', '扫描', 'opportunity', '机会',
];

let _cache = null;
let _cacheTime = 0;
const _lastProactiveByAgent = {};  // per-agent cooldown

/** Get cached scanner data. Returns null if no data or stale (>60s). */
export function getScannerCache() {
  if (!_cache || Date.now() - _cacheTime > 60_000) return null;
  return _cache;
}

// ── Inventory helpers ────────────────────────────────────────────────────────

function classifyInventory(balances) {
  return balances.map(b => ({
    exchange: b.exchange,
    label:    b.label || b.exchange,
    kas:      b.kas   ?? 0,
    usdt:     b.usdt  ?? 0,
    error:    b.error ?? null,
    state:    b.error              ? 'ERROR'     :
              b.kas > 0 && b.usdt >= 10 ? 'DUAL'      :
              b.kas > 0            ? 'SELL_ONLY'  :
              b.usdt > 0           ? 'BUY_ONLY'   : 'EMPTY',
  }));
}

/** Net price after maker/taker fee. */
function netPrice(bid, exchange, side = 'sell') {
  const FEE = {
    mexc: 0.00, gate: 0.10, gateio: 0.10,
    bybit: 0.10, kucoin: 0.10, bitget: 0.10,
  };
  const feePct = (FEE[exchange] ?? 0.10) / 100;
  return side === 'sell' ? bid * (1 - feePct) : bid * (1 + feePct);
}

/**
 * Calculate safe order quantity based on best-level orderbook depth.
 * Uses bid1_qty (best bid level only) — we only place orders at best price,
 * never cross multiple price levels.
 */
function calcOrderQty(orderbook, side) {
  if (!orderbook || orderbook.error) return 0;
  const levelQty = side === 'sell' ? (orderbook.bid1_qty ?? 0) : (orderbook.ask1_qty ?? 0);
  const depth30  = Math.floor(levelQty * 0.30);   // 不超过最优一档的 30%
  const hardMax  = 2000;                           // 单笔硬上限 2000 KAS
  return Math.max(0, Math.min(depth30, hardMax));
}

function formatKas(n) {
  if (n >= 1_000_000) return (n / 1000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + 'K';
  return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ── Skill Class ──────────────────────────────────────────────────────────────

export class MarketScannerSkill extends Skill {
  constructor() {
    super('market_scanner', 'Cross-exchange KAS/USDT spread scanner — arbitrage and market-making intelligence');
  }

  canActivate(taskType, context) {
    if (taskType === 'proactive') {
      const agentKey = context?.self?.address || context?.config?.address || '_default';
      const now = Date.now();
      const last = _lastProactiveByAgent[agentKey] || 0;
      if (now - last < PROACTIVE_COOLDOWN_MS) return false;
      _lastProactiveByAgent[agentKey] = now;
      return true;
    }
    if (taskType === 'reactive') {
      const msg = (context._inputMessage || '').toLowerCase();
      return REACTIVE_KEYWORDS.some(k => msg.includes(k));
    }
    return false;
  }

  async gatherContext(kernels, config) {
    const now = Date.now();

    // 30s 缓存
    if (_cache && now - _cacheTime < CACHE_TTL_MS) return _cache;

    // 并行拉 6 家 CEX
    const cexResults = await Promise.allSettled(
      CEX.map(async (ex) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const res = await fetch(ex.url, { signal: controller.signal });
          clearTimeout(timer);
          if (!res.ok) return { id: ex.id, name: ex.name, error: `HTTP ${res.status}` };
          const data = await res.json();
          const parsed = ex.parse(data);
          if (!parsed.bid || !parsed.ask || isNaN(parsed.bid) || isNaN(parsed.ask)) {
            return { id: ex.id, name: ex.name, error: 'parse failed' };
          }
          return { id: ex.id, name: ex.name, bid: parsed.bid, ask: parsed.ask };
        } catch (err) {
          clearTimeout(timer);
          return { id: ex.id, name: ex.name, error: err.message?.slice(0, 40) };
        }
      })
    );

    const venues = cexResults
      .map(r => r.status === 'fulfilled' ? r.value : null)
      .filter(Boolean);

    // KANet 自由市场
    let kanet = { id: 'kanet', name: 'KANet', bestBuy: null, bestSell: null, openCount: 0 };
    try {
      const offers = await fetchJson(`${config.consoleUrl}/api/exchange/offers?status=open`);
      const list = offers.offers || offers || [];
      const sellOffers = list.filter(o => o.give_asset === 'KAS' && o.want_asset === 'USDT');
      const buyOffers = list.filter(o => o.want_asset === 'KAS' && o.give_asset === 'USDT');

      if (sellOffers.length > 0) {
        // 最低卖价 = 最便宜的 KAS 来源
        kanet.bestSell = Math.min(...sellOffers.map(o => +o.want_amount / +o.give_amount));
      }
      if (buyOffers.length > 0) {
        // 最高买价 = 最贵的 KAS 买方
        kanet.bestBuy = Math.max(...buyOffers.map(o => +o.give_amount / +o.want_amount));
      }
      kanet.openCount = list.length;
    } catch {}

    // 并行拉取余额、订单簿、日限额
    const [balancesRes, orderbooksRes, dailyUsageRes] = await Promise.allSettled([
      fetchJson(`${config.consoleUrl}/api/trade/balances`),
      fetchJson(`${config.consoleUrl}/api/trade/orderbook?exchanges=mexc,gate,bybit,kucoin,bitget`),
      fetchJson(`${config.consoleUrl}/api/trade/daily-usage`),
    ]);

    const balances   = balancesRes.status   === 'fulfilled' ? (balancesRes.value?.balances   ?? balancesRes.value ?? []) : [];
    const orderbooks = orderbooksRes.status === 'fulfilled' ? (orderbooksRes.value?.orderbooks ?? []) : [];
    const dailyUsage = dailyUsageRes.status === 'fulfilled' ? dailyUsageRes.value : null;
    const inventory  = classifyInventory(Array.isArray(balances) ? balances : []);

    // 计算
    const live = venues.filter(v => !v.error);
    const spotLive = live.filter(v => !v.id.includes('perp')); // 中间价只用现货
    let midPrice = null;
    let bestSpread = null;

    if (spotLive.length >= 2) {
      // 中间价 = 现货 CEX mid 的均值（排除合约）
      midPrice = spotLive.reduce((s, v) => s + (v.bid + v.ask) / 2, 0) / spotLive.length;

      // 最佳价差：最便宜的 ask vs 最贵的 bid
      const cheapestAsk = live.reduce((best, v) => v.ask < best.ask ? v : best, live[0]);
      const highestBid = live.reduce((best, v) => v.bid > best.bid ? v : best, live[0]);

      if (cheapestAsk.id !== highestBid.id) {
        const spreadPct = ((highestBid.bid - cheapestAsk.ask) / cheapestAsk.ask) * 100;
        bestSpread = {
          buyAt: cheapestAsk.name,
          buyPrice: cheapestAsk.ask,
          sellAt: highestBid.name,
          sellPrice: highestBid.bid,
          spreadPct,
        };
      }
    } else if (spotLive.length === 1) {
      midPrice = (spotLive[0].bid + spotLive[0].ask) / 2;
    }

    _cache = { venues, kanet, midPrice, bestSpread, live, inventory, orderbooks, dailyUsage, ts: new Date().toISOString() };
    _cacheTime = now;
    return _cache;
  }

  formatForBrain(gathered) {
    if (!gathered || !gathered.venues) {
      return { name: this.name, description: this.description, data: '', instructions: '' };
    }

    const { venues, kanet, midPrice, live, inventory, orderbooks, dailyUsage } = gathered;
    // 阈值分路径：
    //   MEXC Maker 0% → 对方 Taker 0.10%，盈亏平衡 0.10%，留 0.05% 缓冲
    //   标准双向（各 0.10% Taker），盈亏平衡 0.20%，留 0.05% 缓冲
    const THRESHOLDS = { mexc_buyer: 0.15, standard: 0.25 };
    function getThreshold(buy_from) {
      return buy_from === 'mexc' ? THRESHOLDS.mexc_buyer : THRESHOLDS.standard;
    }
    const lines = [];

    // ── 共享变量 ──
    const inv = inventory || [];
    const obs = orderbooks || [];
    const FEE_LABEL = {
      mexc: 'maker 0% / taker 0.05%',
      gate: 'maker=taker 0.10%', gateio: 'maker=taker 0.10%',
      bybit: 'maker=taker 0.10%', kucoin: 'maker=taker 0.10%', bitget: 'maker=taker 0.10%',
    };
    const hasDual = inv.some(i => i.state === 'DUAL');
    const hasSell = inv.some(i => i.state === 'SELL_ONLY');

    // Best sell venues ranked by net price after fee
    const sellVenues = inv
      .filter(i => (i.state === 'SELL_ONLY' || i.state === 'DUAL') && !i.error)
      .map(i => {
        const exId = i.exchange === 'gateio' ? 'gate' : i.exchange;
        const ob = obs.find(o => o.exchange === exId || o.exchange === i.exchange);
        const bid = ob?.bid1 ?? null;
        const net = bid ? netPrice(bid, i.exchange, 'sell') : null;
        const fee = FEE_LABEL[i.exchange] || 'maker=taker 0.10%';
        return { ...i, bid, net, fee };
      })
      .filter(i => i.net !== null)
      .sort((a, b) => b.net - a.net);

    // ── INVENTORY STATE 区块（Brain 优先看库存状态再看价差）──
    if (inv.length > 0) {
      lines.push('=== INVENTORY STATE ===');
      for (const i of inv) {
        const dn = i.exchange === 'gateio' ? 'Gate' : (i.exchange.charAt(0).toUpperCase() + i.exchange.slice(1));
        if (i.error) {
          lines.push(`${dn.padEnd(8)} ERROR: ${i.error}`);
        } else {
          const kasStr = ('KAS ' + formatKas(i.kas)).padEnd(16);
          const usdtStr = 'USDT ' + i.usdt.toFixed(2);
          lines.push(`${dn.padEnd(8)} ${kasStr} ${usdtStr.padEnd(14)} [${i.state}]`);
        }
      }

      const phase = hasDual ? '1b — Dual position active, arbitrage enabled'
                  : hasSell ? '1a — Building USDT position (sell-only mode)'
                  : 'unknown — check exchange connections';
      lines.push('');
      lines.push(`Current phase: ${phase}`);

      if (sellVenues.length > 0) {
        lines.push('');
        lines.push('Best sell venues (by net price after fee):');
        sellVenues.forEach((v, idx) => {
          const dispName = v.exchange === 'gateio' ? 'Gate' : (v.exchange.charAt(0).toUpperCase() + v.exchange.slice(1));
          lines.push(`  ${idx + 1}. ${dispName.padEnd(8)} bid=${v.bid.toFixed(6)}  net=${v.net.toFixed(6)}  (${v.fee})`);
        });
      }
      // Daily sell limit awareness
      if (dailyUsage?.total) {
        const t = dailyUsage.total;
        const usedStr = `${Number(t.sold_kas).toLocaleString()} / ${Number(t.limit_kas).toLocaleString()} KAS used (${t.pct_used}%)`;
        if (t.pct_used >= 100) {
          lines.push(`DAILY LIMIT REACHED — ${usedStr} — do not issue SELL_MAKER actions today`);
        } else if (t.pct_used >= 80) {
          lines.push(`Daily sell limit: ${usedStr} — ${Number(t.remaining_kas).toLocaleString()} KAS remaining`);
          lines.push('WARNING: limit 80%+ used — reduce SELL_MAKER frequency');
        } else {
          lines.push(`Daily sell limit: ${usedStr} — ${Number(t.remaining_kas).toLocaleString()} KAS remaining`);
        }
      }

      lines.push('');
    }

    // ── ACTIONABLE OPPORTUNITIES 区块 ──
    if (!hasDual && inv.some(i => i.state === 'SELL_ONLY')) {
      // Phase 1a: SELL_ONLY 模式
      lines.push('=== ACTIONABLE OPPORTUNITIES ===');
      lines.push('Mode: SELL_ONLY — place maker sell orders to build USDT position');
      lines.push('');

      const topSellVenues = (sellVenues || [])
        .map(v => {
          const exId = v.exchange === 'gateio' ? 'gate' : v.exchange;
          const ob = obs.find(o => o.exchange === exId || o.exchange === v.exchange);
          const qty = ob ? calcOrderQty(ob, 'sell') : 0;
          const suggestPrice = v.bid ? +(v.bid * 1.0001).toFixed(6) : null;
          const dispName = v.exchange === 'gateio' ? 'Gate' : (v.exchange.charAt(0).toUpperCase() + v.exchange.slice(1));
          return { ...v, qty, suggestPrice, dispName };
        })
        .filter(v => v.qty > 0)
        .slice(0, 3);

      if (topSellVenues.length === 0) {
        lines.push('No sell opportunities available (check exchange connections)');
      } else {
        lines.push('Recommended sell orders (execute independently):');
        topSellVenues.forEach((v, i) => {
          const feeLabel = FEE_LABEL[v.exchange] || 'maker=taker 0.10%';
          lines.push(`  ${i + 1}. ${v.dispName.padEnd(8)} qty=${v.qty} KAS  @bid=${v.bid?.toFixed(6)}  net/KAS=${v.net?.toFixed(6)}  (${feeLabel})`);
          lines.push(`            [ACTION:SELL_MAKER exchange=${v.exchange} qty=${v.qty} price=${v.suggestPrice}]`);
        });
      }

      lines.push('');
      lines.push('Cross-exchange arbitrage: NOT AVAILABLE — need USDT >= 10 on at least one exchange');
      lines.push('ARB mode unlocks automatically when dual position established.');
      lines.push('');
    } else if (hasDual) {
      // Phase 1b+: 在现有 ⚡ opportunity 格式前加 Mode 标识
      lines.push('=== ACTIONABLE OPPORTUNITIES ===');
      lines.push('Mode: DUAL — arbitrage and market-making enabled');
      lines.push('');
    }

    // 计算所有正价差对（buy.ask < sell.bid 的组合），按 spread 降序
    const opportunities = [];
    for (const buyer of live) {
      for (const seller of live) {
        if (buyer.id === seller.id) continue;
        const pct = ((seller.bid - buyer.ask) / buyer.ask) * 100;
        if (pct > 0) {
          const isBasis = buyer.id.includes('perp') || seller.id.includes('perp');
          opportunities.push({
            buyId: buyer.id, buyAt: buyer.name, buyPrice: buyer.ask,
            sellId: seller.id, sellAt: seller.name, sellPrice: seller.bid,
            pct, isBasis,
          });
        }
      }
    }
    opportunities.sort((a, b) => b.pct - a.pct);

    const hasOpportunity = opportunities.some(o => o.pct >= getThreshold(o.buyId));
    const onlineCount = live.length;
    const totalCount = venues.length;

    // KANet 摘要
    const kanetParts = [];
    if (kanet.openCount > 0) kanetParts.push(`${kanet.openCount} open offer${kanet.openCount > 1 ? 's' : ''}`);
    else kanetParts.push('no offers');
    if (kanet.bestSell) kanetParts.push(`best_sell ${kanet.bestSell.toFixed(5)}`);
    if (kanet.bestBuy) kanetParts.push(`best_buy ${kanet.bestBuy.toFixed(5)}`);
    const kanetSummary = kanetParts.join(' | ');

    // 做市参考
    let mmLine = '';
    if (midPrice) {
      const mmSpread = 0.003;
      mmLine = `Make market: sell @${(midPrice * (1 + mmSpread)).toFixed(5)} / buy @${(midPrice * (1 - mmSpread)).toFixed(5)}`;
    }

    if (!hasOpportunity) {
      // ── 情况 A：无机会 ──
      lines.push('=== MARKET SCANNER ===');
      lines.push(`KAS mid: ${midPrice ? midPrice.toFixed(5) : '?'} USDT | ${onlineCount}/${totalCount} CEX online`);
      if (opportunities.length > 0) {
        const top = opportunities[0];
        lines.push(`Max spread: ${top.buyAt}→${top.sellAt} +${top.pct.toFixed(3)}% (no opportunity)`);
      } else {
        lines.push('Max spread: none detected');
      }
      lines.push(`KANet: ${kanetSummary}`);
      if (mmLine) lines.push(mmLine);
    } else {
      // ── 情况 B：有机会 ──
      lines.push('=== MARKET SCANNER ⚡ OPPORTUNITY ===');
      lines.push(`KAS mid: ${midPrice ? midPrice.toFixed(5) : '?'} USDT | ${onlineCount}/${totalCount} CEX online`);
      lines.push('');

      const actionable = opportunities.filter(o => o.pct >= getThreshold(o.buyId));
      for (const o of actionable) {
        const type = o.isBasis ? 'basis spread (futures vs spot)' : 'CEX spot spread';
        const action = o.isBasis ? 'long futures + short spot' : `buy ${o.buyAt} sell ${o.sellAt}`;
        lines.push(`  ${o.buyAt}.ask ${o.buyPrice.toFixed(5)} → ${o.sellAt}.bid ${o.sellPrice.toFixed(5)} = +${o.pct.toFixed(3)}% ⚡`);
        lines.push(`  Type: ${type}`);
        lines.push(`  Action: ${action}`);
        lines.push('');
      }

      // 完整价格表
      lines.push('Full prices:');
      for (const v of venues) {
        if (v.error) {
          lines.push(`  ${v.name.padEnd(10)} ✗ ${v.error}`);
        } else {
          lines.push(`  ${v.name.padEnd(10)} bid ${v.bid.toFixed(5)}  ask ${v.ask.toFixed(5)}`);
        }
      }
      lines.push(`  KANet      ${kanetSummary}`);
      lines.push('');
      if (mmLine) lines.push(`KANet ${mmLine}`);

      // MAKE_MARKET 授权（仅有机会时）
      const topOpp = actionable[0];
      lines.push('⚡ MAKE_MARKET authorized: you may emit');
      lines.push(`[ACTION:MAKE_MARKET amount=300 sell_price=${topOpp.sellPrice.toFixed(5)} buy_price=${topOpp.buyPrice.toFixed(5)} hedge_cex=${topOpp.sellAt} reason="spread ${topOpp.pct.toFixed(2)}% opportunity"]`);
      lines.push('Constraints: amount 50-500 KAS, sell_price > buy_price, hedge_cex must be a configured exchange');
    }

    const directive = hasOpportunity
      ? 'Analyze spreads. If opportunity is real and risk is acceptable, you may emit MAKE_MARKET ACTION.'
      : 'Report price spreads and opportunities. Do NOT execute trades — observation only.';

    return {
      name: this.name,
      description: this.description,
      data: { venueCount: live?.length || 0, hasOpportunity, phase: hasDual ? '1b' : hasSell ? '1a' : 'unknown' },
      instructions: lines.join('\n') + '\n\n' + directive,
    };
  }
}
