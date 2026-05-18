// P1.5 KAS price oracle multi-source fallback test — NWT N19.4 5/18
// 验证 /api/trade/kas-price 返 valid price + source field (MEXC primary, KuCoin/Binance fallback, stale cache)

export default {
  id: 'kas_price_multi_source_fallback',
  description: 'P1.5 oracle resilience: /api/trade/kas-price multi-source + valid response shape',
  domain: 'exchange',
  tags: ['regression', 'oracle', 'kas-price'],
  steps: [
    {
      action: 'http_post',
      url: '/api/trade/kas-price',
      method: 'GET',
      expect: {
        must: {
          http_status_equals: 200,
        },
      },
    },
  ],

  async run() {
    const fetch = (await import('node:undici')).fetch ?? globalThis.fetch;
    const res = await fetch('http://127.0.0.1:3100/api/trade/kas-price', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();

    if (typeof data.price !== 'number') return { ok: false, error: `price not number: ${typeof data.price}` };
    if (typeof data.source !== 'string') return { ok: false, error: `source not string: ${data.source}` };

    // Valid response shape: price > 0 with real source OR price=0 with 'unavailable' source
    if (data.price > 0) {
      const validSources = ['mexc', 'kucoin', 'binance'];
      const isLive = validSources.includes(data.source);
      const isStale = data.source.startsWith('cache:') && data.stale === true;
      if (!isLive && !isStale) return { ok: false, error: `unexpected source for price>0: ${data.source}` };
    } else {
      if (data.source !== 'unavailable') return { ok: false, error: `price=0 should have source=unavailable, got ${data.source}` };
    }

    // KAS price sanity (2026: $0.01 - $1.00 range)
    if (data.price > 0 && (data.price < 0.001 || data.price > 10)) {
      return { ok: false, error: `KAS price sanity fail: ${data.price} (expected $0.01-$1.00 range)` };
    }

    return { ok: true, summary: `oracle source=${data.source} price=${data.price}` };
  },
};
