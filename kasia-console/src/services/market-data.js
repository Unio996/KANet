/**
 * Market Data Aggregator — 多市场数据源统一接入
 *
 * 每个数据源是一个独立函数，失败不影响其他源。
 * 统一输出格式，供 signal-engine 和 Brain 消费。
 *
 * 数据源：
 *   1. 交易所（KAS/BTC/ETH） — MEXC 公开 API ✅ 已有
 *   2. 股票市场 — Yahoo Finance
 *   3. 预测市场 — Polymarket
 *   4. 大宗商品 — Yahoo Finance (Gold, Oil)
 *   5. 衍生品（资金费率）— 交易所 Futures API
 *   6. 舆情 — Fear & Greed Index + 新闻摘要
 */

const TIMEOUT = 8000;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const _cache = {};

export const DIVERGENCE_WARN_THRESHOLD = 3; // percent — Brain + UI both reference this

// ─── Yahoo crumb singleton ────────────────────────────
const CRUMB_TTL = 4 * 60 * 60 * 1000; // 4 hours
let _crumb = { value: null, cookie: null, ts: 0 };

async function _fetchCrumb() {
  // Step 1: get cookie from fc.yahoo.com
  const consentRes = await fetch('https://fc.yahoo.com', {
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const setCookie = consentRes.headers.get('set-cookie');
  if (!setCookie) throw new Error('Yahoo crumb: no Set-Cookie from fc.yahoo.com');
  // Extract just the cookie value (first part before ;)
  const cookie = setCookie.split(';')[0];

  // Step 2: exchange cookie for crumb
  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': cookie },
  });
  if (!crumbRes.ok) throw new Error(`Yahoo crumb: getcrumb HTTP ${crumbRes.status}`);
  const crumb = await crumbRes.text();
  if (!crumb || crumb.length < 5) throw new Error('Yahoo crumb: empty or invalid crumb');

  _crumb = { value: crumb, cookie, ts: Date.now() };
  return _crumb;
}

async function _getCrumb(forceRefresh = false) {
  if (!forceRefresh && _crumb.value && (Date.now() - _crumb.ts) < CRUMB_TTL) return _crumb;
  return _fetchCrumb();
}

/**
 * Fetch a Yahoo URL that requires crumb auth.
 * Injects cookie + crumb, auto-refreshes on 401 (once).
 * For GET requests, appends crumb as query param.
 * For POST/other, returns { crumb, cookie } for caller to use.
 */
async function _yahooFetchWithCrumb(url, opts = {}) {
  const crumbData = await _getCrumb();
  const sep = url.includes('?') ? '&' : '?';
  const fullUrl = url + sep + 'crumb=' + encodeURIComponent(crumbData.value);

  const res = await fetch(fullUrl, {
    signal: AbortSignal.timeout(TIMEOUT),
    ...opts,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': crumbData.cookie, ...(opts.headers || {}) },
  });

  if (res.status === 401) {
    // Crumb expired — refresh once and retry
    const fresh = await _getCrumb(true);
    const retryUrl = url + sep + 'crumb=' + encodeURIComponent(fresh.value);
    return fetch(retryUrl, {
      signal: AbortSignal.timeout(TIMEOUT),
      ...opts,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': fresh.cookie, ...(opts.headers || {}) },
    });
  }

  return res;
}

function safeJson(res) { return res.ok ? res.json() : null; }

/** 带缓存的数据拉取 (ttlOverride in ms; defaults to CACHE_TTL) */
function cached(key, fetchFn, ttlOverride) {
  const ttl = ttlOverride || CACHE_TTL;
  return async (...args) => {
    const cacheKey = key + (args.length ? ':' + JSON.stringify(args) : '');
    const hit = _cache[cacheKey];
    if (hit && (Date.now() - hit.ts) < ttl) return hit.data;
    const data = await fetchFn(...args);
    if (data?.ok) _cache[cacheKey] = { data, ts: Date.now() };
    return data;
  };
}

// ═══════════════════════════════════════════════════
//  1. 加密货币（已有，封装统一接口）
// ═══════════════════════════════════════════════════

export async function fetchCryptoData() {
  try {
    const [kasTicker, btcTicker, ethTicker] = await Promise.all([
      fetch('https://api.mexc.com/api/v3/ticker/24hr?symbol=KASUSDT', { signal: AbortSignal.timeout(TIMEOUT) }).then(safeJson).catch(() => null),
      fetch('https://api.mexc.com/api/v3/ticker/24hr?symbol=BTCUSDT', { signal: AbortSignal.timeout(TIMEOUT) }).then(safeJson).catch(() => null),
      fetch('https://api.mexc.com/api/v3/ticker/24hr?symbol=ETHUSDT', { signal: AbortSignal.timeout(TIMEOUT) }).then(safeJson).catch(() => null),
    ]);

    return {
      source: 'crypto',
      ok: true,
      data: {
        KAS: kasTicker ? { price: parseFloat(kasTicker.lastPrice), change24h: parseFloat(kasTicker.priceChangePercent), volume: parseFloat(kasTicker.quoteVolume), high: parseFloat(kasTicker.highPrice), low: parseFloat(kasTicker.lowPrice) } : null,
        BTC: btcTicker ? { price: parseFloat(btcTicker.lastPrice), change24h: parseFloat(btcTicker.priceChangePercent), volume: parseFloat(btcTicker.quoteVolume) } : null,
        ETH: ethTicker ? { price: parseFloat(ethTicker.lastPrice), change24h: parseFloat(ethTicker.priceChangePercent), volume: parseFloat(ethTicker.quoteVolume) } : null,
      },
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    return { source: 'crypto', ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════
//  2. 股票市场 — Yahoo Finance v8
// ═══════════════════════════════════════════════════

const DEFAULT_STOCKS = ['SPY', 'QQQ'];

/**
 * 从 Yahoo Finance 拉一个 symbol 的数据
 */
async function fetchYahooQuote(sym) {
  const res = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`, {
    signal: AbortSignal.timeout(5000),
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const prevClose = meta.chartPreviousClose || meta.previousClose;
  return {
    symbol: sym,
    name: meta.longName || meta.shortName || sym,
    price: meta.regularMarketPrice,
    change24h: meta.regularMarketPrice && prevClose
      ? ((meta.regularMarketPrice - prevClose) / prevClose * 100) : null,
    high: meta.regularMarketDayHigh,
    low: meta.regularMarketDayLow,
    volume: meta.regularMarketVolume,
    high52w: meta.fiftyTwoWeekHigh,
    low52w: meta.fiftyTwoWeekLow,
    exchange: meta.exchangeName,
    currency: meta.currency,
  };
}

/**
 * @param {string[]} [symbols] — 自定义 symbols，不传则用默认指数
 */
export async function fetchStockData(symbols) {
  try {
    const syms = symbols?.length ? symbols : DEFAULT_STOCKS;
    const results = await Promise.all(syms.map(s => fetchYahooQuote(s).catch(() => null)));
    const data = {};
    for (const r of results) {
      if (r) data[r.symbol] = r;
    }
    return {
      source: 'stocks',
      ok: Object.keys(data).length > 0,
      data,
      error: Object.keys(data).length === 0 ? 'all stock fetches failed' : undefined,
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    return { source: 'stocks', ok: false, error: e.message, data: {} };
  }
}

// 导出供自选股单独查询
export { fetchYahooQuote };

// ═══════════════════════════════════════════════════
//  3. 预测市场 — Polymarket
// ═══════════════════════════════════════════════════

export async function fetchPredictionData() {
  try {
    // Polymarket Gamma API — active markets sorted by 24h volume
    // Fetch two pages in parallel (Gamma API max 500 per request)
    const [res1, res2] = await Promise.all([
      fetch('https://gamma-api.polymarket.com/markets?closed=false&limit=500&offset=0&order=volume24hr&ascending=false', {
        signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': 'KANet/1.0' },
      }),
      fetch('https://gamma-api.polymarket.com/markets?closed=false&limit=500&offset=500&order=volume24hr&ascending=false', {
        signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': 'KANet/1.0' },
      }).catch(() => null),
    ]);

    if (!res1.ok) return { source: 'prediction', ok: false, error: `HTTP ${res1.status}`, data: [] };

    const page1 = await res1.json();
    const page2 = res2?.ok ? await res2.json() : [];
    const markets = [...(Array.isArray(page1) ? page1 : []), ...(Array.isArray(page2) ? page2 : [])];
    const data = (Array.isArray(markets) ? markets : []).map(m => {
      // Parse outcome prices: ["0.65", "0.35"] → { yes: 65, no: 35 }
      let yes = null, no = null;
      try {
        const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
        if (Array.isArray(prices) && prices.length >= 2) {
          yes = Math.round(parseFloat(prices[0]) * 100);
          no = Math.round(parseFloat(prices[1]) * 100);
        }
      } catch {}

      return {
        id: m.id,
        question: m.question || '?',
        description: m.description || '',
        resolutionSource: m.resolutionSource || '',
        outcomes: m.outcomes || ['Yes', 'No'],
        yes, no,
        outcome: yes != null ? `Yes ${yes}% / No ${no}%` : null,
        volume24h: m.volume24hr || 0,
        volume: m.volumeNum || m.volume || 0,
        liquidity: m.liquidityNum || m.liquidity || 0,
        endDate: m.endDateIso || m.endDate || null,
        slug: m.slug,
        image: m.image,
        lastTradePrice: m.lastTradePrice ? parseFloat(m.lastTradePrice) : null,
        bestBid: m.bestBid ? parseFloat(m.bestBid) : null,
        bestAsk: m.bestAsk ? parseFloat(m.bestAsk) : null,
        spread: m.spread ? parseFloat(m.spread) : null,
        conditionId: m.conditionId || null,
        clobTokenIds: typeof m.clobTokenIds === 'string' ? (() => { try { return JSON.parse(m.clobTokenIds); } catch { return null; } })() : (m.clobTokenIds || null),
      };
    });

    return { source: 'prediction', ok: true, data, fetchedAt: new Date().toISOString() };
  } catch (e) {
    return { source: 'prediction', ok: false, error: e.message, data: [] };
  }
}

// ═══════════════════════════════════════════════════
//  4. 大宗商品 — Gold, Oil, Silver
// ═══════════════════════════════════════════════════

export async function fetchCommodityData() {
  try {
    const commodities = { 'GC=F': 'Gold', 'CL=F': 'Oil', 'SI=F': 'Silver' };
    const data = {};

    for (const [sym, name] of Object.entries(commodities)) {
      try {
        const res = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`, {
          signal: AbortSignal.timeout(5000),
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (res.ok) {
          const json = await res.json();
          const meta = json?.chart?.result?.[0]?.meta;
          if (meta) {
            data[name] = {
              price: meta.regularMarketPrice,
              change24h: meta.regularMarketPrice && (meta.chartPreviousClose || meta.previousClose)
                ? ((meta.regularMarketPrice - (meta.chartPreviousClose || meta.previousClose)) / (meta.chartPreviousClose || meta.previousClose) * 100)
                : null,
              name: meta.shortName || name,
            };
          }
        }
      } catch {}
    }

    return {
      source: 'commodities',
      ok: Object.keys(data).length > 0,
      data,
      error: Object.keys(data).length === 0 ? 'all commodity fetches failed' : undefined,
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    return { source: 'commodities', ok: false, error: e.message, data: {} };
  }
}

// ═══════════════════════════════════════════════════
//  5. 衍生品 — 资金费率（Binance Futures）
// ═══════════════════════════════════════════════════

export async function fetchFundingRates() {
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1', {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const btcFunding = res.ok ? await res.json() : [];

    const res2 = await fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=ETHUSDT&limit=1', {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const ethFunding = res2.ok ? await res2.json() : [];

    const data = {};
    if (btcFunding[0]) data.BTC = { rate: parseFloat(btcFunding[0].fundingRate), time: btcFunding[0].fundingTime };
    if (ethFunding[0]) data.ETH = { rate: parseFloat(ethFunding[0].fundingRate), time: ethFunding[0].fundingTime };

    // 费率 > 0.01% = 多方过热; < -0.01% = 空方过热
    for (const [k, v] of Object.entries(data)) {
      v.sentiment = v.rate > 0.0001 ? 'longs_pay' : v.rate < -0.0001 ? 'shorts_pay' : 'neutral';
    }

    return { source: 'funding', ok: true, data, fetchedAt: new Date().toISOString() };
  } catch (e) {
    return { source: 'funding', ok: false, error: e.message, data: {} };
  }
}

// ═══════════════════════════════════════════════════
//  6. 舆情 — Fear & Greed Index
// ═══════════════════════════════════════════════════

export async function fetchSentiment() {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const json = res.ok ? await res.json() : null;
    const fng = json?.data?.[0];

    return {
      source: 'sentiment',
      ok: true,
      data: {
        fearGreed: fng ? {
          value: parseInt(fng.value),
          label: fng.value_classification, // Extreme Fear / Fear / Neutral / Greed / Extreme Greed
          timestamp: fng.timestamp,
        } : null,
      },
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    return { source: 'sentiment', ok: false, error: e.message, data: {} };
  }
}

// ═══════════════════════════════════════════════════
//  7. 经济日历 — Forex Factory (free, no API key)
// ═══════════════════════════════════════════════════

export async function fetchEconomicCalendar() {
  try {
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': 'KANet/1.0' },
    });
    if (!res.ok) return { source: 'calendar', ok: false, error: `HTTP ${res.status}`, data: { events: [], today: [] } };
    const events = await res.json();

    const today = new Date().toISOString().slice(0, 10); // "2026-04-01"
    const now = new Date();

    const parsed = (Array.isArray(events) ? events : []).map(e => ({
      title: e.title,
      country: e.country,
      date: e.date?.slice(0, 10),
      time: e.date?.slice(11, 16) || '',
      impact: e.impact,              // High / Medium / Low / Holiday
      forecast: e.forecast || null,
      previous: e.previous || null,
      actual: e.actual || null,
    }));

    // Today + upcoming (next 3 days)
    const todayEvents = parsed.filter(e => e.date === today);
    const upcoming = parsed.filter(e => e.date > today).slice(0, 20);
    const highImpact = parsed.filter(e => e.impact === 'High');

    return {
      source: 'calendar',
      ok: true,
      data: {
        events: parsed,
        today: todayEvents,
        upcoming,
        highImpact,
        totalThisWeek: parsed.length,
        highImpactCount: highImpact.length,
      },
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    return { source: 'calendar', ok: false, error: e.message, data: { events: [], today: [] } };
  }
}

// ═══════════════════════════════════════════════════
//  8. 加密大盘 — CoinGecko Global (free, no API key)
// ═══════════════════════════════════════════════════

export async function fetchCryptoGlobal() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/global', {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': 'KANet/1.0', 'Accept': 'application/json' },
    });
    if (!res.ok) return { source: 'crypto_global', ok: false, error: `HTTP ${res.status}`, data: {} };
    const json = await res.json();
    const d = json.data;
    return {
      source: 'crypto_global',
      ok: true,
      data: {
        totalMarketCap: d.total_market_cap?.usd || 0,
        totalVolume24h: d.total_volume?.usd || 0,
        btcDominance: d.market_cap_percentage?.btc || 0,
        ethDominance: d.market_cap_percentage?.eth || 0,
        marketCapChange24h: d.market_cap_change_percentage_24h_usd || 0,
        activeCryptos: d.active_cryptocurrencies || 0,
        markets: d.markets || 0,
        defiMarketCap: d.total_market_cap?.usd ? (d.defi_volume / d.total_volume?.usd * 100) : 0,
      },
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    return { source: 'crypto_global', ok: false, error: e.message, data: {} };
  }
}

// ═══════════════════════════════════════════════════
//  9. 股票基本面 — Yahoo Finance quoteSummary (crumb)
// ═══════════════════════════════════════════════════

/**
 * Fetch fundamental data for an array of stock symbols.
 * Uses Yahoo quoteSummary (requires crumb auth).
 *
 * @param {string[]} symbols - e.g. ['TSLA', 'AAPL']
 * @returns {{ source: 'fundamentals', ok: boolean, data: Object, fetchedAt: string }}
 */
export async function fetchStockFundamentals(symbols) {
  if (!symbols?.length) return { source: 'fundamentals', ok: false, error: 'no symbols', data: {} };

  try {
    const results = await Promise.all(symbols.map(async (sym) => {
      try {
        const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=assetProfile,financialData,defaultKeyStatistics`;
        const res = await _yahooFetchWithCrumb(url);
        if (!res.ok) return null;
        const json = await res.json();
        const result = json?.quoteSummary?.result?.[0];
        if (!result) return null;

        const profile = result.assetProfile || {};
        const fin = result.financialData || {};
        const stats = result.defaultKeyStatistics || {};

        return {
          symbol: sym,
          sector: profile.sector || null,
          industry: profile.industry || null,
          revenue: fin.totalRevenue?.raw || null,
          revenueFmt: fin.totalRevenue?.fmt || null,
          revenueGrowth: fin.revenueGrowth?.raw != null ? +(fin.revenueGrowth.raw * 100).toFixed(2) : null,
          profitMargin: fin.profitMargins?.raw != null ? +(fin.profitMargins.raw * 100).toFixed(2) : null,
          grossMargin: fin.grossMargins?.raw != null ? +(fin.grossMargins.raw * 100).toFixed(2) : null,
          targetMeanPrice: fin.targetMeanPrice?.raw || null,
          recommendationKey: fin.recommendationKey || null,
          numberOfAnalysts: fin.numberOfAnalystOpinions?.raw || null,
          forwardPE: stats.forwardPE?.raw || null,
          trailingPE: stats.trailingPE?.raw || null,
          beta: stats.beta?.raw || null,
          shortRatio: stats.shortRatio?.raw || null,
          marketCap: stats.marketCap?.raw || null,
          marketCapFmt: stats.marketCap?.fmt || null,
        };
      } catch {
        return null; // individual symbol failure — silent
      }
    }));

    const data = {};
    for (const r of results) {
      if (r) data[r.symbol] = r;
    }

    return {
      source: 'fundamentals',
      ok: Object.keys(data).length > 0,
      data,
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    return { source: 'fundamentals', ok: false, error: e.message, data: {} };
  }
}

// ═══════════════════════════════════════════════════
//  10. 行业同行 — Yahoo Finance Screener (crumb)
// ═══════════════════════════════════════════════════

/**
 * Find industry peers via Yahoo Finance screener.
 * Returns up to 5 peer quotes (excluding specified symbols).
 *
 * @param {string} industry - e.g. 'Auto Manufacturers'
 * @param {string[]} excludeSymbols - symbols to exclude (e.g. the stock being analyzed)
 * @returns {{ source: 'peers', ok: boolean, data: Object[], fetchedAt: string }}
 */
export async function fetchIndustryPeers(industry, excludeSymbols = []) {
  if (!industry) return { source: 'peers', ok: true, data: [], fetchedAt: new Date().toISOString() };

  try {
    const crumbData = await _getCrumb();
    const screenerUrl = `https://query2.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(crumbData.value)}`;

    const body = {
      offset: 0,
      size: 10,
      sortField: 'intradaymarketcap',
      sortType: 'desc',
      quoteType: 'equity',
      query: {
        operator: 'and',
        operands: [
          { operator: 'eq', operands: ['industry', industry] },
          { operator: 'eq', operands: ['region', 'us'] },
        ],
      },
    };

    let res = await fetch(screenerUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Cookie': crumbData.cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    // 401 retry with fresh crumb
    if (res.status === 401) {
      const fresh = await _getCrumb(true);
      const retryUrl = `https://query2.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(fresh.value)}`;
      res = await fetch(retryUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT),
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Cookie': fresh.cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    }

    if (!res.ok) return { source: 'peers', ok: false, error: `screener HTTP ${res.status}`, data: [] };

    const json = await res.json();
    const quotes = json?.finance?.result?.[0]?.quotes || [];

    // Exclude specified symbols, take top 5
    const excludeSet = new Set((excludeSymbols || []).map(s => s.toUpperCase()));
    const peerSymbols = quotes
      .map(q => q.symbol)
      .filter(s => !excludeSet.has(s?.toUpperCase()))
      .slice(0, 5);

    // Fetch full quote data for each peer using existing fetchYahooQuote
    const peerQuotes = await Promise.all(
      peerSymbols.map(s => fetchYahooQuote(s).catch(() => null))
    );

    const data = peerQuotes.filter(Boolean);

    return {
      source: 'peers',
      ok: true,
      data,
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    return { source: 'peers', ok: false, error: e.message, data: [] };
  }
}

// ═══════════════════════════════════════════════════
//  统一聚合 — 一次调用拿到所有数据
// ═══════════════════════════════════════════════════

/**
 * Fetch all market data sources in parallel.
 * Each source independently fails — one down doesn't affect others.
 *
 * @returns {{ crypto, stocks, prediction, commodities, funding, sentiment, summary }}
 */
// 带缓存的版本（供 API 路由和技能使用）
export const cachedCrypto = cached('crypto', fetchCryptoData);
export const cachedStocks = cached('stocks', fetchStockData);
export const cachedPredictions = cached('prediction', fetchPredictionData);
export const cachedCommodities = cached('commodities', fetchCommodityData);
export const cachedFunding = cached('funding', fetchFundingRates);
export const cachedSentiment = cached('sentiment', fetchSentiment);
export const cachedCryptoGlobal = cached('crypto_global', fetchCryptoGlobal);
export const cachedCalendar = cached('calendar', fetchEconomicCalendar);

/** Synchronous read of cached KAS price. Triggers async fetch if cache empty. */
export function getCachedKasPrice() {
  const hit = _cache['crypto'];
  if (hit?.data?.data?.KAS?.price) return hit.data.data.KAS.price;
  // Cache miss — trigger background fetch so next call has data
  cachedCrypto().catch(() => {});
  return 0;
}
export const cachedFundamentals = cached('fundamentals', fetchStockFundamentals, 60 * 60 * 1000); // 1 hour
export const cachedIndustryPeers = cached('peers', fetchIndustryPeers, 60 * 60 * 1000); // 1 hour

export async function fetchAllMarkets(stockSymbols) {
  const [crypto, stocks, prediction, commodities, funding, sentiment, cryptoGlobal, calendar] = await Promise.all([
    cachedCrypto(),
    cachedStocks(stockSymbols),
    cachedPredictions(),
    cachedCommodities(),
    cachedFunding(),
    cachedSentiment(),
    cachedCryptoGlobal(),
    cachedCalendar(),
  ]);

  // Build one-line summary for Brain
  const parts = [];
  // Crypto macro first
  if (cryptoGlobal.ok && cryptoGlobal.data.totalMarketCap) {
    const g = cryptoGlobal.data;
    const mcap = g.totalMarketCap > 1e12 ? (g.totalMarketCap / 1e12).toFixed(2) + 'T' : (g.totalMarketCap / 1e9).toFixed(0) + 'B';
    parts.push(`Crypto $${mcap}(${g.marketCapChange24h > 0 ? '+' : ''}${g.marketCapChange24h.toFixed(1)}%)`);
    parts.push(`BTC.D ${g.btcDominance.toFixed(1)}%`);
  }
  if (crypto.ok && crypto.data.KAS) parts.push(`KAS $${crypto.data.KAS.price} ${crypto.data.KAS.change24h > 0 ? '+' : ''}${(crypto.data.KAS.change24h * 100)?.toFixed(1)}%`);
  if (crypto.ok && crypto.data.BTC) parts.push(`BTC $${Math.round(crypto.data.BTC.price).toLocaleString()}`);
  if (sentiment.ok && sentiment.data.fearGreed) parts.push(`FnG ${sentiment.data.fearGreed.value}(${sentiment.data.fearGreed.label})`);
  if (funding.ok && funding.data.BTC) parts.push(`FR ${(funding.data.BTC.rate * 100).toFixed(4)}%`);
  if (calendar.ok && calendar.data.today?.length) {
    const high = calendar.data.today.filter(e => e.impact === 'High');
    if (high.length) parts.push(`TODAY: ${high.map(e => e.title).join(', ')}`);
  }

  return {
    crypto,
    stocks,
    prediction,
    commodities,
    funding,
    sentiment,
    cryptoGlobal,
    calendar,
    summary: parts.join(' | '),
    fetchedAt: new Date().toISOString(),
    sourcesOk: [crypto, stocks, prediction, commodities, funding, sentiment, cryptoGlobal, calendar].filter(s => s.ok).length,
    sourcesTotal: 8,
  };
}
