/**
 * Skill: Price Tracker — KAS 价格追踪
 *
 * Track Kaspa (KAS) price, 24h change, and market trends.
 *
 * Data source: CoinGecko API (free, no key)
 * Install: drop into agent-mind/src/skills/ → restart Console + Mind.
 */

import { Skill } from './base.mjs';

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=kaspa&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true';

export class PriceTrackerSkill extends Skill {
  constructor() {
    super('price_tracker', 'Track Kaspa (KAS) price, 24h change, and market trends');
  }

  canActivate(taskType, context) {
    if (taskType === 'proactive') return true;
    if (taskType === 'reactive') {
      // Only when message mentions price/market/value topics
      const msg = context?._inputMessage || '';
      return /price|kas|market|value|worth|cost|coin|trade|买|卖|价|行情|涨|跌|资产/i.test(msg);
    }
    return false;
  }

  async gatherContext(kernels, config) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(COINGECKO_URL, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) return { error: `CoinGecko HTTP ${res.status}` };

      const data = await res.json();
      const kas = data.kaspa;
      if (!kas) return { error: 'No data for kaspa' };

      return {
        price: kas.usd,
        change24h: kas.usd_24h_change,
        volume24h: kas.usd_24h_vol,
        marketCap: kas.usd_market_cap,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  formatForBrain(gathered) {
    if (gathered.error) {
      return { name: this.name, description: this.description, data: gathered, instructions: `Price data unavailable: ${gathered.error}` };
    }

    const dir = gathered.change24h > 0 ? '+' : '';
    const volM = (gathered.volume24h / 1e6).toFixed(1);
    const capM = (gathered.marketCap / 1e6).toFixed(1);

    return {
      name: this.name,
      description: this.description,
      data: gathered,
      instructions: [
        'KAS PRICE:',
        `  Price: $${gathered.price}`,
        `  24h change: ${dir}${gathered.change24h?.toFixed(2)}%`,
        `  24h volume: $${volM}M`,
        `  Market cap: $${capM}M`,
        '',
        'Use this data naturally in conversation when asked about price or market.',
      ].join('\n'),
    };
  }
}
