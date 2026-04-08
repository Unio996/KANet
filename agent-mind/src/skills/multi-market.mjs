/**
 * Skill: Multi Market — 多交易所比价
 *
 * Compares KAS price across exchanges, tracks BTC/ETH correlation,
 * and detects cross-exchange spreads.
 *
 * Data source: CoinGecko API (free, no key)
 * Install: drop into agent-mind/src/skills/ → restart Console + Mind.
 */

import { Skill } from './base.mjs';

const COINGECKO_TICKERS = 'https://api.coingecko.com/api/v3/coins/kaspa/tickers';
const COINGECKO_COMPARE = 'https://api.coingecko.com/api/v3/simple/price?ids=kaspa,bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true';

export class MultiMarketSkill extends Skill {
  constructor() {
    super('multi_market', 'Compare KAS across exchanges, track BTC/ETH correlation, detect spreads');
  }

  canActivate(taskType) {
    return taskType === 'proactive' || taskType === 'reflect';
  }

  async gatherContext(kernels, config) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const [tickerRes, compareRes] = await Promise.all([
        fetch(COINGECKO_TICKERS, { signal: controller.signal }).catch(() => null),
        fetch(COINGECKO_COMPARE, { signal: controller.signal }).catch(() => null),
      ]);
      clearTimeout(timeout);

      // Exchange tickers
      let exchanges = [];
      let spread = null;
      if (tickerRes?.ok) {
        const data = await tickerRes.json();
        const tickers = (data.tickers || [])
          .filter(t => t.target === 'USDT' || t.target === 'USD')
          .slice(0, 10);

        exchanges = tickers.map(t => ({
          exchange: t.market?.name || 'Unknown',
          pair: `${t.base}/${t.target}`,
          price: t.last,
          volume24h: Math.round(t.converted_volume?.usd || 0),
          spread: t.bid_ask_spread_percentage,
        }));

        // Find max spread between exchanges
        if (exchanges.length >= 2) {
          const prices = exchanges.map(e => e.price).filter(Boolean);
          const minP = Math.min(...prices);
          const maxP = Math.max(...prices);
          spread = {
            min: minP,
            max: maxP,
            spreadPercent: ((maxP - minP) / minP * 100).toFixed(2),
            cheapest: exchanges.find(e => e.price === minP)?.exchange,
            priciest: exchanges.find(e => e.price === maxP)?.exchange,
          };
        }
      }

      // Cross-asset comparison
      let comparison = null;
      if (compareRes?.ok) {
        const data = await compareRes.json();
        comparison = {
          kas: { price: data.kaspa?.usd, change24h: data.kaspa?.usd_24h_change },
          btc: { price: data.bitcoin?.usd, change24h: data.bitcoin?.usd_24h_change },
          eth: { price: data.ethereum?.usd, change24h: data.ethereum?.usd_24h_change },
        };

        // Relative performance
        if (comparison.kas?.change24h != null && comparison.btc?.change24h != null) {
          comparison.kasVsBtc = (comparison.kas.change24h - comparison.btc.change24h).toFixed(2);
          comparison.kasVsEth = (comparison.kas.change24h - comparison.eth.change24h).toFixed(2);
        }
      }

      return {
        exchanges: exchanges.slice(0, 6),
        exchangeCount: exchanges.length,
        spread,
        comparison,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  formatForBrain(gathered) {
    if (gathered.error) {
      return { name: this.name, description: this.description, data: gathered, instructions: `Market data unavailable: ${gathered.error}` };
    }

    const lines = [];

    // Exchange comparison
    if (gathered.exchanges.length > 0) {
      lines.push(`KAS listed on ${gathered.exchangeCount} exchange(s):`);
      for (const e of gathered.exchanges.slice(0, 4)) {
        lines.push(`  ${e.exchange}: $${e.price} (vol: $${(e.volume24h / 1e6).toFixed(1)}M)`);
      }
    }

    // Spread
    if (gathered.spread) {
      const s = gathered.spread;
      lines.push(`Cross-exchange spread: ${s.spreadPercent}% (${s.cheapest} $${s.min} → ${s.priciest} $${s.max})`);
    }

    // Relative performance
    if (gathered.comparison) {
      const c = gathered.comparison;
      const kasDir = c.kas?.change24h > 0 ? '+' : '';
      lines.push(`KAS 24h: ${kasDir}${c.kas?.change24h?.toFixed(1)}% | BTC: ${c.btc?.change24h?.toFixed(1)}% | ETH: ${c.eth?.change24h?.toFixed(1)}%`);
      if (c.kasVsBtc) {
        const outperform = parseFloat(c.kasVsBtc) > 0;
        lines.push(`KAS vs BTC: ${outperform ? 'outperforming' : 'underperforming'} by ${Math.abs(c.kasVsBtc)}%`);
      }
    }

    return {
      name: this.name,
      description: this.description,
      data: gathered,
      instructions: [
        'MULTI-MARKET REPORT:',
        ...lines,
        '',
        'Spreads >1% may indicate arbitrage opportunity.',
        'Relative performance vs BTC/ETH shows KAS-specific momentum.',
      ].join('\n'),
    };
  }
}
