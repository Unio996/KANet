/**
 * Skill: Stock Tracker — 股市追踪 + 宏观关联
 *
 * 读取用户自选股实时数据，分析：
 *   - 指数走势（SPY/QQQ → 大盘方向）
 *   - 个股异动（涨跌超3%高亮）
 *   - 大宗商品（黄金避险信号）
 *   - 与 crypto 的关联（NASDAQ↓ 通常 BTC 跟跌）
 *   - 恐贪指数 + 资金费率 → 综合市场情绪
 *
 * 不执行交易，只提供宏观视野给 Brain 决策。
 * 用户自己添加股票后，Agent 以此为基线向竞争/供应链扩展。
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

export class StockTrackerSkill extends Skill {
  constructor() {
    super('stock_tracker', 'Track stock markets, indices, commodities — macro context for trading decisions');
  }

  canActivate(taskType, context) {
    if (taskType === 'proactive') return true; // 宏观环境每次都注入
    if (taskType === 'reflect') return true;
    if (taskType !== 'reactive') return false;
    const msg = (context._inputMessage || '').toLowerCase();
    return KEYWORDS.some(k => msg.includes(k));
  }

  async gatherContext(kernels, config) {
    const { consoleUrl } = config;

    const [overview, fundamentals, crypto, cryptoGlobal, calendar] = await Promise.all([
      fetchJson(`${consoleUrl}/api/stocks/overview`).catch(() => null),
      fetchJson(`${consoleUrl}/api/stocks/fundamentals`).catch(() => null),
      fetchJson(`${consoleUrl}/api/market/crypto`).catch(() => null),
      fetchJson(`${consoleUrl}/api/market/crypto-global`).catch(() => null),
      fetchJson(`${consoleUrl}/api/market/calendar`).catch(() => null),
    ]);

    if (!overview) return { error: 'stock data unavailable' };

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

    // Fundamentals — may be null if API is down
    const stockFundamentals = fundamentals?.stocks || null;
    const industryPeers = fundamentals?.peers || null;
    const health = fundamentals?.health || null;

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
    };
  }

  formatForBrain(gathered) {
    if (gathered.error) return { name: this.name, description: this.description, data: {}, instructions: 'Stock data unavailable.' };

    const sections = ['--- STOCK MARKET & MACRO (live) ---'];
    const q = gathered.quotes;
    const fund = gathered.stockFundamentals;
    const peers = gathered.industryPeers;
    const health = gathered.health;
    const hasFundamentals = fund && Object.keys(fund).length > 0;
    const fng = gathered.sentiment?.fearGreed;

    // ── Panel 1: WATCHLIST + FUNDAMENTALS ──
    if (Object.keys(q).length > 0) {
      sections.push(`\nWATCHLIST + FUNDAMENTALS (${gathered.watchlistCount} stocks):`);
      for (const [sym, v] of Object.entries(q)) {
        const ch = v.change24h != null ? ` ${v.change24h > 0 ? '+' : ''}${v.change24h.toFixed(1)}%` : '';
        const f = hasFundamentals ? fund[sym] : null;
        if (f) {
          const industry = f.industry || 'N/A';
          const fwdPE = f.forwardPE != null ? `FwdPE ${f.forwardPE.toFixed(0)}` : 'FwdPE N/A';
          const beta = f.beta != null ? `Beta ${f.beta.toFixed(2)}` : '';
          sections.push(`  ${sym} $${v.price}${ch} | ${industry} | ${fwdPE}${beta ? ' | ' + beta : ''}`);
          // Second line: revenue, margin, analyst consensus
          const rev = f.revenueFmt ? `Revenue ${f.revenueFmt}` : '';
          const revGrowth = f.revenueGrowth != null ? ` (${f.revenueGrowth > 0 ? '+' : ''}${f.revenueGrowth.toFixed(1)}%)` : '';
          const margin = f.profitMargin != null ? `Margin ${f.profitMargin.toFixed(1)}%` : '';
          const rec = f.recommendationKey ? f.recommendationKey.toUpperCase() : '';
          const analysts = f.numberOfAnalysts ? `(${f.numberOfAnalysts})` : '';
          const target = f.targetMeanPrice != null ? `target $${f.targetMeanPrice.toFixed(0)}` : '';
          const parts = [rev + revGrowth, margin, rec ? `Analysts: ${rec} ${analysts}${target ? ' ' + target : ''}` : ''].filter(Boolean);
          if (parts.length > 0) sections.push(`    ${parts.join(' | ')}`);
        } else {
          // Fallback: old flat line when fundamentals unavailable
          const range = v.high52w ? ` (52w: ${v.low52w?.toFixed(0)}-${v.high52w?.toFixed(0)})` : '';
          sections.push(`  ${sym} $${v.price}${ch}${range} — ${v.name || ''}`);
        }
      }
    }

    // ── Panel 2: COMPETITOR MAP ──
    if (hasFundamentals && peers && Object.keys(peers).length > 0) {
      sections.push('\n--- COMPETITOR MAP (auto-discovered) ---');
      // Group watchlist stocks by industry
      const industryToWatchlist = {};
      for (const [sym, f] of Object.entries(fund)) {
        if (!f.industry) continue;
        if (!industryToWatchlist[f.industry]) industryToWatchlist[f.industry] = [];
        industryToWatchlist[f.industry].push(sym);
      }

      for (const [industry, peerList] of Object.entries(peers)) {
        const mySymbols = industryToWatchlist[industry] || [];
        if (mySymbols.length === 0) continue; // skip industries with no watchlist stock

        sections.push(`${industry} (your: ${mySymbols.join(', ')}):`);

        // Build line: watchlist stocks + peers
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

        // Divergence warning per watchlist stock
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
      }
    }

    // ── Panel 3: PORTFOLIO HEALTH ──
    if (health) {
      sections.push('\n--- PORTFOLIO HEALTH ---');

      // Sector concentration
      if (health.sectorConcentration && Object.keys(health.sectorConcentration).length > 0) {
        const topSectors = Object.entries(health.sectorConcentration)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        const maxPct = health.maxSectorPct || topSectors[0]?.[1] || 0;
        const riskLabel = maxPct >= 0.8 ? 'HIGH RISK' : maxPct >= 0.6 ? 'MODERATE' : 'diversified';
        const sectorLine = topSectors.map(([s, pct]) => `${s} ${(pct * 100).toFixed(0)}%`).join(', ');
        sections.push(`Sector concentration: ${sectorLine} — ${riskLabel}`);
      }

      // Avg beta
      if (health.avgBeta != null) {
        const volLabel = health.avgBeta >= 2.0 ? 'HIGH VOLATILITY' : health.avgBeta >= 1.5 ? 'ABOVE AVERAGE' : 'normal';
        sections.push(`Avg beta: ${health.avgBeta.toFixed(2)} — ${volLabel}`);
      }

      // Analyst consensus
      if (health.analystSummary) {
        const a = health.analystSummary;
        const parts = [];
        if (a.buy) parts.push(`${a.buy} BUY`);
        if (a.hold) parts.push(`${a.hold} HOLD`);
        if (a.sell) parts.push(`${a.sell} SELL`);
        if (parts.length > 0) sections.push(`Analyst consensus: ${parts.join(', ')}`);
      }

      // Target price warnings: analyst target < current price
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

    // ── Panel 4: MACRO (preserved) ──
    sections.push('\n--- MACRO ---');

    // 异动
    if (gathered.movers.length > 0) {
      sections.push('Big movers (>3%):');
      for (const m of gathered.movers) {
        sections.push(`  ${m.symbol} ${m.change > 0 ? '+' : ''}${m.change.toFixed(2)}% — ${m.name}`);
      }
    }

    // 大宗商品
    if (Object.keys(gathered.commodities).length > 0) {
      const parts = Object.entries(gathered.commodities).map(([k, v]) => `${k} $${v.price?.toFixed(0)}`);
      sections.push(`Commodities: ${parts.join(' | ')}`);
    }

    // 市场情绪
    if (fng) sections.push(`Fear & Greed: ${fng.value} (${fng.label})`);

    // 资金费率
    if (gathered.funding?.BTC) {
      sections.push(`Funding Rate: BTC ${(gathered.funding.BTC.rate * 100).toFixed(4)}% (${gathered.funding.BTC.sentiment})`);
    }

    // crypto 关联 + 大盘
    if (gathered.cryptoGlobal) {
      const g = gathered.cryptoGlobal;
      const mcap = g.totalMarketCap > 1e12 ? '$' + (g.totalMarketCap / 1e12).toFixed(2) + 'T' : '$' + (g.totalMarketCap / 1e9).toFixed(0) + 'B';
      sections.push(`Crypto macro (CoinGecko): Total ${mcap} (${g.marketCapChange24h > 0 ? '+' : ''}${g.marketCapChange24h?.toFixed(1)}%) | BTC dominance ${g.btcDominance?.toFixed(1)}% | ${g.activeCryptos?.toLocaleString()} coins`);
    }
    if (gathered.crypto?.btcPrice) {
      sections.push(`Crypto prices: BTC $${Math.round(gathered.crypto.btcPrice).toLocaleString()} ${gathered.crypto.btcChange > 0 ? '+' : ''}${(gathered.crypto.btcChange * 100)?.toFixed(1)}% | KAS $${gathered.crypto.kasPrice}`);
    }

    // 今日经济事件
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

    // ── Dynamic risk hints (replace static instructions) ──
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

    return {
      name: this.name,
      description: this.description,
      data: { watchlistCount: gathered.watchlistCount, movers: gathered.movers.length, fng: fng?.value, hasFundamentals: !!hasFundamentals, hasHealth: !!health },
      instructions: sections.join('\n'),
    };
  }
}

export default StockTrackerSkill;
