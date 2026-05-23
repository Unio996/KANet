/**
 * price-oracle.js — Phase B v1.1 (J1, J2 #3 14:55 challenge 3 真 spec)
 *
 * 真根因 (NWT 22:57 _probe-step3-generic-asset bug 3): broker handler 真调
 * fetchKasPrice('BTC') → 真返 0.0342 (KAS 价当 BTC 价误用 — fetchKasPrice silent fallback).
 * 真 production-broken: 真 user 真买 1 BTC 真转 0.0342 USDT 真 underpayment 12000x.
 *
 * 真 fix: generic fetchPrice(give_asset, want_asset?) 多 source dispatch.
 * 真不 silent fallback — 不支持 pair 真返 ok:false, broker handler 真 reject.
 *
 * 真现支持 (v1.1 minimal, 满足 broker 真用 + USDC e2e 真测):
 * - KAS/USDT: market-seeder.fetchKasPrice (cmc-kas, 现有)
 * - USDC/USDT or USDT/USDC: 1.0 peg (真 swap 0.026% slippage 验过 J2 8f1a95dd9 真烧)
 * - BTC/USDT: coingecko (~$60000, lazy fetch, 不 API key)
 * - ETH/USDT: coingecko
 * - 其他: ok:false 真 reject 'unsupported_pair'
 */

/**
 * Fetch price for asset_pair (give → want).
 *
 * @param {string} giveAsset — symbol (KAS / USDT / USDC / BTC / ETH)
 * @param {string} [wantAsset='USDT']
 * @returns {Promise<{ ok: true, price: number, source: string, pair: string } | { ok: false, error: string, pair?: string, supported?: string[] }>}
 */
export async function fetchPrice(giveAsset, wantAsset = 'USDT') {
  if (!giveAsset) return { ok: false, error: 'missing give_asset' };
  const give = giveAsset.toUpperCase();
  const want = (wantAsset || 'USDT').toUpperCase();
  const pair = `${give}/${want}`;

  // Same asset: 1.0 (broker 用极少, 但避 NPE)
  if (give === want) return { ok: true, price: 1.0, source: 'identity', pair };

  // KAS/USDT: 现 market-seeder.fetchKasPrice (CMC) 真有
  if (give === 'KAS' && want === 'USDT') {
    try {
      const { fetchKasPrice } = await import('./market-seeder.js');
      const price = await fetchKasPrice();
      if (!price || price <= 0) return { ok: false, error: 'fetchKasPrice returned 0', pair };
      return { ok: true, price, source: 'market-seeder.cmc-kas', pair };
    } catch (err) {
      return { ok: false, error: `fetchKasPrice err: ${err.message}`, pair };
    }
  }

  // USDC ↔ USDT: peg 1.0 (J2 真烧 swap 验 0.026% slippage, 接近 1:1)
  if ((give === 'USDC' && want === 'USDT') || (give === 'USDT' && want === 'USDC')) {
    return { ok: true, price: 1.0, source: 'peg', pair };
  }

  // BTC/USDT or ETH/USDT: CoinGecko free API (no key needed for low-volume usage)
  const cgIds = { BTC: 'bitcoin', ETH: 'ethereum' };
  if (want === 'USDT' && cgIds[give]) {
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${cgIds[give]}&vs_currencies=usd`;
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return { ok: false, error: `coingecko HTTP ${r.status}`, pair };
      const j = await r.json();
      const price = j?.[cgIds[give]]?.usd;
      if (!price || price <= 0) return { ok: false, error: 'coingecko returned no price', pair };
      return { ok: true, price, source: 'coingecko', pair };
    } catch (err) {
      return { ok: false, error: `coingecko err: ${err.message}`, pair };
    }
  }

  // 不支持 pair — 真 reject (不 silent 0 / 0.0342 fallback)
  return {
    ok: false, error: 'unsupported_pair', pair,
    supported: ['KAS/USDT', 'USDT/USDC', 'USDC/USDT', 'BTC/USDT', 'ETH/USDT'],
  };
}

/**
 * List supported asset_pairs (for SYSTEM_PROMPT broker LLM + UI).
 * @returns {string[]}
 */
export function listSupportedPairs() {
  return ['KAS/USDT', 'USDT/USDC', 'USDC/USDT', 'BTC/USDT', 'ETH/USDT'];
}
