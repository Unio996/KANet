/**
 * price-engine.mjs — Watch exchange price, calculate bid/ask with spread
 */

const MEXC_BASE = 'https://api.mexc.com/api/v3';

let _lastPrice = null;
let _lastUpdate = 0;

export async function fetchPrice(symbol = 'KASUSDT') {
  const res = await fetch(`${MEXC_BASE}/ticker/price?symbol=${symbol}`, { signal: AbortSignal.timeout(5000) });
  const data = await res.json();
  _lastPrice = parseFloat(data.price);
  _lastUpdate = Date.now();
  return _lastPrice;
}

export function calculateQuote(mexcPrice, spreadPct) {
  const spread = mexcPrice * spreadPct / 100;
  return {
    buyPrice: parseFloat((mexcPrice - spread).toFixed(6)),   // MM buys KAS at this price
    sellPrice: parseFloat((mexcPrice + spread).toFixed(6)),  // MM sells KAS at this price
    mexcPrice,
    spread: parseFloat(spread.toFixed(6)),
    updatedAt: new Date().toISOString(),
  };
}

export function getLastPrice() {
  return { price: _lastPrice, updatedAt: _lastUpdate };
}
