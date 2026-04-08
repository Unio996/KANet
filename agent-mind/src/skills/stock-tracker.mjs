/**
 * Skill: Stock Tracker — 股市情报 + 技术信号 + 财报感知
 *
 * 四层情报架构（对标 trade-sense）：
 *   L1 — 原始数据：价格、成交量、K 线、基本面
 *   L2 — 计算信号：趋势、动量、波动率、支撑/阻力
 *   L3 — 组合视角：行业对比、组合健康、财报日历
 *   L4 — 宏观关联：指数、商品、情绪、经济事件
 *
 * 不执行交易，只提供情报给 Brain 决策。
 */

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

const DIVERGENCE_THRESHOLD = 3;

const KEYWORDS = [
  'stock', 'stocks', '股票', '股市', '美股', '大盘', '指数',
  'spy', 'qqq', 'nasdaq', 's&p', '纳斯达克', '标普',
  '苹果', 'apple', 'nvidia', 'tsla', 'tesla',
  'macro', '宏观', '经济', 'economy',
];

// ── Signal Computation (L2) ────────────────────────────────────────────────

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length);
}
function round4(n) { return Math.round(n * 10000) / 10000; }

/**
 * Compute technical signals from daily klines.
 * Requires >= 5 candles; SMA20 needs >= 20.
 */
function computeStockSignals(klines) {
  if (!klines || klines.length < 5) return null;

  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const latest = closes[closes.length - 1];

  // Simple Moving Averages (daily)
  const sma5 = avg(closes.slice(-5));
  const sma20 = closes.length >= 20 ? avg(closes.slice(-20)) : null;

  // Trend direction
  const trend = latest > sma5 ? 'UP' : latest < sma5 ? 'DOWN' : 'FLAT';
  const bias = sma20 !== null
    ? (sma5 > sma20 ? 'BULLISH' : sma5 < sma20 ? 'BEARISH' : 'NEUTRAL')
    : null;

  // Volatility (stddev of daily returns)
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const volatility = stddev(returns);
  const volatilityLevel = volatility > 0.03 ? 'HIGH' : volatility > 0.015 ? 'MEDIUM' : 'LOW';

  // Momentum (5-day Rate of Change)
  const roc5 = closes.length >= 6
    ? ((latest - closes[closes.length - 6]) / closes[closes.length - 6]) * 100
    : null;

  // Volume trend (last 3 days vs prior 3 days)
  let volTrend = 'unknown';
  if (volumes.length >= 6) {
    const recentVol = avg(volumes.slice(-3));
    const olderVol = avg(volumes.slice(-6, -3));
    if (olderVol > 0) {
      volTrend = recentVol > olderVol * 1.5 ? 'SURGING'
        : recentVol > olderVol * 1.1 ? 'RISING'
        : recentVol < olderVol * 0.7 ? 'DECLINING'
        : 'STABLE';
    }
  }

  // Support / Resistance (10-day high/low)
  const window = klines.slice(-10);
  const resistance = Math.max(...window.map(k => k.high));
  const support = Math.min(...window.map(k => k.low));

  return {
    trend,
    bias,
    sma5: round4(sma5),
    sma20: sma20 !== null ? round4(sma20) : null,
    volatility: round4(volatility * 100),
    volatilityLevel,
    momentum: roc5 !== null ? round4(roc5) : null,
    volTrend,
    support: round4(support),
    resistance: round4(resistance),
    distToResistance: round4(((resistance - latest) / latest) * 100),
    distToSupport: round4(((latest - support) / latest) * 100),
  };
}

// ── Earnings helpers ───────────────────────────────────────────────────────

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return Math.ceil(diff);
}

// ── RSS News helpers ───────────────────────────────────────────────────────

function _extractTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

function _parseRss(xml) {
  const items = [];
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = _extractTag(block, 'title');
    const pubDate = _extractTag(block, 'pubDate');
    if (title) {
      items.push({
        title: title.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
        date: pubDate ? new Date(pubDate).getTime() : null,
      });
    }
    if (items.length >= 2) break;
  }
  return items;
}

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function fetchStockNews(symbols) {
  if (!symbols?.length) return {};
  const top = symbols.slice(0, 3);
  const results = await Promise.all(top.map(async (sym) => {
    try {
      const res = await fetch(`https://finance.yahoo.com/rss/headline?s=${encodeURIComponent(sym)}`, {
        signal: AbortSignal.timeout(3000),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!res.ok) return { sym, items: [] };
      const xml = await res.text();
      return { sym, items: _parseRss(xml) };
    } catch {
      return { sym, items: [] };
    }
  }));
  const news = {};
  for (const r of results) {
    if (r.items.length > 0) news[r.sym] = r.items;
  }
  return news;
}

// ── Skill Class ────────────────────────────────────────────────────────────

export class StockTrackerSkill extends Skill {
  constructor() {
    super('stock_tracker', 'Track stock markets, indices, commodities — macro context for trading decisions');
  }

  canActivate(taskType, context) {
    if (taskType === 'proactive') return true;
    if (taskType === 'reflect') return true;
    if (taskType !== 'reactive') return false;
    const msg = (context._inputMessage || '').toLowerCase();
    return KEYWORDS.some(k => msg.includes(k));
  }

  async gatherContext(kernels, config) {
    const { consoleUrl } = config;

    const [overview, fundamentals, klines, crypto, cryptoGlobal, calendar] = await Promise.all([
      fetchJson(`${consoleUrl}/api/stocks/overview`).catch(() => null),
      fetchJson(`${consoleUrl}/api/stocks/fundamentals`).catch(() => null),
      fetchJson(`${consoleUrl}/api/stocks/klines`).catch(() => null),
      fetchJson(`${consoleUrl}/api/market/crypto`).catch(() => null),
      fetchJson(`${consoleUrl}/api/market/crypto-global`).catch(() => null),
      fetchJson(`${consoleUrl}/api/market/calendar`).catch(() => null),
    ]);

    if (!overview) return { error: 'stock data unavailable' };

    // Fetch stock news in parallel (non-blocking, 3s timeout per symbol)
    const watchlistSymbols = (overview.watchlist || []).map(w => w.symbol);
    const stockNews = await fetchStockNews(watchlistSymbols).catch(() => ({}));

    const quotes = overview.quotes?.data || {};
    const watchlist = overview.watchlist || [];
    const commodities = overview.commodities?.data || {};
    const funding = overview.funding?.data || {};
    const sentiment = overview.sentiment?.data || {};

    // 异动检测（涨跌 > 3%）
    const movers = Object.entries(quotes)
      .filter(([, v]) => v.change24h && Math.abs(v.change24h) > 3)
      .map(([sym, v]) => ({ symbol: sym, name: v.name, change: v.change24h }));

    // crypto 关联
    const kasPrice = crypto?.data?.KAS?.price;
    const btcPrice = crypto?.data?.BTC?.price;
    const btcChange = crypto?.data?.BTC?.change24h;

    // CoinGecko crypto macro
    const cg = cryptoGlobal?.ok ? cryptoGlobal.data : null;

    // Economic calendar — today's high-impact events
    const calToday = (calendar?.ok ? calendar.data?.today : []) || [];
    const calHigh = calToday.filter(e => e.impact === 'High');

    // Fundamentals
    const stockFundamentals = fundamentals?.stocks || null;
    const industryPeers = fundamentals?.peers || null;
    const health = fundamentals?.health || null;

    // Compute technical signals from klines
    const stockSignals = {};
    if (klines?.ok && klines.data) {
      for (const [sym, klineArr] of Object.entries(klines.data)) {
        stockSignals[sym] = computeStockSignals(klineArr);
      }
    }

    return {
      watchlistCount: watchlist.length,
      quotes,
      movers,
      commodities,
      funding,
      sentiment,
      crypto: { kasPrice, btcPrice, btcChange },
      cryptoGlobal: cg,
      calendarToday: calToday,
      calendarHighImpact: calHigh,
      stockFundamentals,
      industryPeers,
      health,
      stockSignals,
      stockNews,
    };
  }

  formatForBrain(gathered) {
    if (gathered.error) return { name: this.name, description: this.description, data: {}, instructions: 'Stock data unavailable.' };

    const sections = ['--- STOCK MARKET & MACRO (live) ---'];
    const q = gathered.quotes;
    const fund = gathered.stockFundamentals;
    const peers = gathered.industryPeers;
    const health = gathered.health;
    const signals = gathered.stockSignals || {};
    const hasFundamentals = fund && Object.keys(fund).length > 0;
    const fng = gathered.sentiment?.fearGreed;

    // Collect signal summaries for aggregation
    const bullish = [];
    const bearish = [];
    const earningsSoon = [];

    // ── Panel 1: WATCHLIST + SIGNALS + FUNDAMENTALS ──
    if (Object.keys(q).length > 0) {
      sections.push(`\nWATCHLIST (${gathered.watchlistCount} stocks):`);
      for (const [sym, v] of Object.entries(q)) {
        const ch = v.change24h != null ? ` ${v.change24h > 0 ? '+' : ''}${v.change24h.toFixed(1)}%` : '';
        const f = hasFundamentals ? fund[sym] : null;
        const sig = signals[sym];

        // Line 1: price + industry + valuation
        if (f) {
          const industry = f.industry || 'N/A';
          const fwdPE = f.forwardPE != null ? `FwdPE ${f.forwardPE.toFixed(0)}` : '';
          const peg = f.pegRatio != null ? `PEG ${f.pegRatio.toFixed(1)}` : '';
          const valParts = [industry, fwdPE, peg].filter(Boolean).join(' | ');
          sections.push(`  ${sym} $${v.price}${ch} | ${valParts}`);
        } else {
          const range = v.high52w ? ` (52w: ${v.low52w?.toFixed(0)}-${v.high52w?.toFixed(0)})` : '';
          sections.push(`  ${sym} $${v.price}${ch}${range} — ${v.name || ''}`);
        }

        // Line 2: technical signals
        if (sig) {
          const trendStr = `Trend: ${sig.trend} (vs SMA5)`;
          const biasStr = sig.bias ? `Bias: ${sig.bias} (SMA5 vs SMA20)` : '';
          sections.push(`    ${[trendStr, biasStr].filter(Boolean).join(' | ')}`);

          const volStr = `Volatility: ${sig.volatilityLevel} (${sig.volatility.toFixed(1)}%)`;
          const momStr = sig.momentum != null ? `Momentum: ${sig.momentum > 0 ? '+' : ''}${sig.momentum.toFixed(1)}% (5d)` : '';
          sections.push(`    ${[volStr, momStr].filter(Boolean).join(' | ')}`);

          const supStr = `Support $${sig.support.toFixed(2)} (${sig.distToSupport.toFixed(1)}%)`;
          const resStr = `Resistance $${sig.resistance.toFixed(2)} (${sig.distToResistance.toFixed(1)}%)`;
          sections.push(`    ${supStr} | ${resStr}`);

          // Aggregate for summary
          if (sig.trend === 'UP' && (sig.bias === 'BULLISH' || sig.bias === null)) {
            const detail = sig.momentum != null ? `momentum ${sig.momentum > 0 ? '+' : ''}${sig.momentum.toFixed(1)}%` : 'uptrend';
            bullish.push(`${sym} (${detail})`);
          } else if (sig.trend === 'DOWN' || sig.bias === 'BEARISH') {
            const reasons = [];
            if (sig.bias === 'BEARISH') reasons.push('SMA5 < SMA20');
            if (sig.volTrend === 'DECLINING') reasons.push('vol declining');
            if (sig.trend === 'DOWN') reasons.push('downtrend');
            bearish.push(`${sym} (${reasons.join(', ') || 'bearish'})`);
          }
        }

        // Line 3: earnings
        if (f?.earningsDate) {
          const days = daysUntil(f.earningsDate);
          const epsStr = f.earningsEPSEstimate != null ? ` — EPS est $${f.earningsEPSEstimate.toFixed(2)}` : '';
          const revStr = f.earningsRevenueFmt ? `, Rev est ${f.earningsRevenueFmt}` : '';
          if (days != null && days > 0) {
            sections.push(`    Earnings: ${f.earningsDate} (${days}d)${epsStr}${revStr}`);
            if (days <= 7) earningsSoon.push(`${sym} (${f.earningsDate})`);
          }
        }

        // Line 4: analysts + deep fundamentals
        if (f) {
          const parts = [];
          const rec = f.recommendationKey ? f.recommendationKey.toUpperCase() : '';
          const analysts = f.numberOfAnalysts ? `(${f.numberOfAnalysts})` : '';
          const target = f.targetMeanPrice != null ? `target $${f.targetMeanPrice.toFixed(0)}` : '';
          if (rec) {
            const upside = (v.price && f.targetMeanPrice) ? ` (${((f.targetMeanPrice - v.price) / v.price * 100).toFixed(0)}%)` : '';
            parts.push(`Analysts: ${rec} ${analysts} ${target}${upside}`.trim());
          }
          const roe = f.returnOnEquity != null ? `ROE ${f.returnOnEquity.toFixed(1)}%` : '';
          const de = f.debtToEquity != null ? `D/E ${f.debtToEquity.toFixed(1)}` : '';
          const fcf = f.freeCashflowFmt ? `FCF ${f.freeCashflowFmt}` : '';
          const deepParts = [roe, de, fcf].filter(Boolean);
          if (deepParts.length > 0) parts.push(deepParts.join(' | '));
          if (parts.length > 0) sections.push(`    ${parts.join(' | ')}`);
        }
      }
    }

    // ── Panel 2: SIGNALS SUMMARY ──
    if (bullish.length > 0 || bearish.length > 0 || earningsSoon.length > 0) {
      sections.push('\n--- STOCK SIGNALS SUMMARY ---');
      if (bullish.length > 0) sections.push(`Bullish: ${bullish.join(', ')}`);
      if (bearish.length > 0) sections.push(`Bearish: ${bearish.join(', ')}`);
      if (earningsSoon.length > 0) sections.push(`⚠ Earnings within 7d: ${earningsSoon.join(', ')} — expect volatility spike`);
    }

    // ── Panel 3: STOCK NEWS ──
    const news = gathered.stockNews || {};
    if (Object.keys(news).length > 0) {
      sections.push('\n--- STOCK NEWS (latest) ---');
      for (const [sym, items] of Object.entries(news)) {
        const headlineParts = items.map(item => `"${item.title}" (${relativeTime(item.date)})`);
        sections.push(`${sym}: ${headlineParts.join(' | ')}`);
      }
    }

    // ── Panel 4: COMPETITOR MAP ──
    if (hasFundamentals && peers && Object.keys(peers).length > 0) {
      sections.push('\n--- COMPETITOR MAP (auto-discovered) ---');
      const industryToWatchlist = {};
      for (const [sym, f] of Object.entries(fund)) {
        if (!f.industry) continue;
        if (!industryToWatchlist[f.industry]) industryToWatchlist[f.industry] = [];
        industryToWatchlist[f.industry].push(sym);
      }

      for (const [industry, peerList] of Object.entries(peers)) {
        const mySymbols = industryToWatchlist[industry] || [];
        if (mySymbols.length === 0) continue;

        sections.push(`${industry} (your: ${mySymbols.join(', ')}):`);

        const lineParts = [];
        for (const sym of mySymbols) {
          const v = q[sym];
          if (v) {
            const ch = v.change24h != null ? ` ${v.change24h > 0 ? '+' : ''}${v.change24h.toFixed(1)}%` : '';
            lineParts.push(`${sym} $${v.price}${ch}`);
          }
        }
        for (const p of peerList) {
          const ch = p.change24h != null ? ` ${p.change24h > 0 ? '+' : ''}${p.change24h.toFixed(1)}%` : '';
          lineParts.push(`${p.symbol} $${p.price}${ch}`);
        }
        sections.push(`  ${lineParts.join(' | ')}`);

        // Divergence warning
        const peerChanges = peerList.map(p => p.change24h).filter(c => c != null);
        if (peerChanges.length > 0) {
          const peerAvg = peerChanges.reduce((a, b) => a + b, 0) / peerChanges.length;
          for (const sym of mySymbols) {
            const stockChange = q[sym]?.change24h;
            if (stockChange == null) continue;
            const divergence = stockChange - peerAvg;
            if (Math.abs(divergence) > DIVERGENCE_THRESHOLD) {
              sections.push(`  ⚠ ${sym} ${stockChange > 0 ? '+' : ''}${stockChange.toFixed(1)}% vs peers avg ${peerAvg > 0 ? '+' : ''}${peerAvg.toFixed(1)}% → divergence ${divergence > 0 ? '+' : ''}${divergence.toFixed(1)}%`);
            }
          }
        }

        // Phase 3: Relative valuation vs peers
        const peerPEs = peerList.map(p => p.forwardPE).filter(pe => pe != null && pe > 0);
        if (peerPEs.length >= 2) {
          const peerAvgPE = peerPEs.reduce((a, b) => a + b, 0) / peerPEs.length;
          for (const sym of mySymbols) {
            const f = fund[sym];
            if (f?.forwardPE != null && f.forwardPE > 0) {
              const premium = ((f.forwardPE - peerAvgPE) / peerAvgPE * 100).toFixed(0);
              const label = premium > 0 ? `${premium}% premium` : `${Math.abs(premium)}% discount`;
              sections.push(`  ${sym} FwdPE ${f.forwardPE.toFixed(0)} vs peers avg ${peerAvgPE.toFixed(0)} → ${label}`);
            }
          }
        }
      }
    }

    // ── Panel 5: PORTFOLIO HEALTH ──
    if (health) {
      sections.push('\n--- PORTFOLIO HEALTH ---');

      if (health.sectorConcentration && Object.keys(health.sectorConcentration).length > 0) {
        const topSectors = Object.entries(health.sectorConcentration)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        const maxPct = health.maxSectorPct || topSectors[0]?.[1] || 0;
        const riskLabel = maxPct >= 0.8 ? 'HIGH RISK' : maxPct >= 0.6 ? 'MODERATE' : 'diversified';
        const sectorLine = topSectors.map(([s, pct]) => `${s} ${(pct * 100).toFixed(0)}%`).join(', ');
        sections.push(`Sector concentration: ${sectorLine} — ${riskLabel}`);
      }

      if (health.avgBeta != null) {
        const volLabel = health.avgBeta >= 2.0 ? 'HIGH VOLATILITY' : health.avgBeta >= 1.5 ? 'ABOVE AVERAGE' : 'normal';
        sections.push(`Avg beta: ${health.avgBeta.toFixed(2)} — ${volLabel}`);
      }

      if (health.analystSummary) {
        const a = health.analystSummary;
        const parts = [];
        if (a.buy) parts.push(`${a.buy} BUY`);
        if (a.hold) parts.push(`${a.hold} HOLD`);
        if (a.sell) parts.push(`${a.sell} SELL`);
        if (parts.length > 0) sections.push(`Analyst consensus: ${parts.join(', ')}`);
      }

      if (hasFundamentals) {
        for (const [sym, f] of Object.entries(fund)) {
          if (f.targetMeanPrice == null) continue;
          const price = q[sym]?.price;
          if (price != null && f.targetMeanPrice < price) {
            sections.push(`  ⚠ ${sym}: analyst target $${f.targetMeanPrice.toFixed(0)} < current $${price} — overvalued?`);
          }
        }
      }
    }

    // ── Panel 6: MACRO ──
    sections.push('\n--- MACRO ---');

    if (gathered.movers.length > 0) {
      sections.push('Big movers (>3%):');
      for (const m of gathered.movers) {
        sections.push(`  ${m.symbol} ${m.change > 0 ? '+' : ''}${m.change.toFixed(2)}% — ${m.name}`);
      }
    }

    if (Object.keys(gathered.commodities).length > 0) {
      const parts = Object.entries(gathered.commodities).map(([k, v]) => `${k} $${v.price?.toFixed(0)}`);
      sections.push(`Commodities: ${parts.join(' | ')}`);
    }

    if (fng) sections.push(`Fear & Greed: ${fng.value} (${fng.label})`);

    if (gathered.funding?.BTC) {
      sections.push(`Funding Rate: BTC ${(gathered.funding.BTC.rate * 100).toFixed(4)}% (${gathered.funding.BTC.sentiment})`);
    }

    if (gathered.cryptoGlobal) {
      const g = gathered.cryptoGlobal;
      const mcap = g.totalMarketCap > 1e12 ? '$' + (g.totalMarketCap / 1e12).toFixed(2) + 'T' : '$' + (g.totalMarketCap / 1e9).toFixed(0) + 'B';
      sections.push(`Crypto macro (CoinGecko): Total ${mcap} (${g.marketCapChange24h > 0 ? '+' : ''}${g.marketCapChange24h?.toFixed(1)}%) | BTC dominance ${g.btcDominance?.toFixed(1)}% | ${g.activeCryptos?.toLocaleString()} coins`);
    }
    if (gathered.crypto?.btcPrice) {
      sections.push(`Crypto prices: BTC $${Math.round(gathered.crypto.btcPrice).toLocaleString()} ${gathered.crypto.btcChange > 0 ? '+' : ''}${(gathered.crypto.btcChange * 100)?.toFixed(1)}% | KAS $${gathered.crypto.kasPrice}`);
    }

    if (gathered.calendarHighImpact?.length > 0) {
      sections.push(`TODAY'S HIGH-IMPACT EVENTS (${gathered.calendarHighImpact.length}):`);
      for (const e of gathered.calendarHighImpact) {
        const actual = e.actual ? ` → ${e.actual}` : e.forecast ? ` (exp ${e.forecast})` : '';
        sections.push(`  ${e.time || '--:--'} ${e.country} ${e.title}${actual}`);
      }
    }
    if (gathered.calendarToday?.length > 0 && gathered.calendarHighImpact?.length === 0) {
      sections.push(`Today: ${gathered.calendarToday.length} economic events (none high-impact)`);
    }

    // ── Risk alerts + Signal interpretation ──
    const hints = [];
    if (health?.avgBeta >= 2.0) hints.push('WARNING: Portfolio avg beta >= 2.0 — high volatility exposure, consider hedging');
    if (health?.maxSectorPct >= 0.8) hints.push('WARNING: >80% in one sector — extreme concentration risk');
    if (fng) {
      const fngVal = fng.value;
      if (fngVal <= 20) hints.push('Fear & Greed at EXTREME FEAR — potential buying opportunity but high risk');
      if (fngVal >= 80) hints.push('Fear & Greed at EXTREME GREED — market euphoria, consider taking profits');
    }
    if (gathered.calendarHighImpact?.length > 0) {
      hints.push(`${gathered.calendarHighImpact.length} high-impact event(s) today — warn owner before trading`);
    }
    if (hints.length > 0) {
      sections.push('\n--- RISK ALERTS ---');
      for (const h of hints) sections.push(`⚠ ${h}`);
    }

    // Signal interpretation guidance (like prediction-sense)
    sections.push(
      '\nStock signal interpretation:',
      '- Price above SMA20 + rising momentum = established uptrend',
      '- Earnings within 7 days = avoid new positions (vol spike likely)',
      '- Divergence from peers >3% = stock-specific catalyst, investigate',
      '- Volume surge + trend reversal = potential breakout/breakdown',
      '- PEG < 1 with rising momentum = undervalued growth stock',
    );

    return {
      name: this.name,
      description: this.description,
      data: {
        watchlistCount: gathered.watchlistCount,
        movers: gathered.movers.length,
        fng: fng?.value,
        hasFundamentals: !!hasFundamentals,
        hasHealth: !!health,
        hasSignals: Object.keys(signals).length > 0,
      },
      instructions: sections.join('\n'),
    };
  }
}

export default StockTrackerSkill;
