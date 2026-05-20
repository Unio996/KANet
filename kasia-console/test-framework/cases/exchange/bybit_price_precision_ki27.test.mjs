// bybit_price_precision_ki27 — Owner 钦定 hotfix after Round 3 hedge_failed
// real_hedge_verify Round 3 完美 fire executeHedgeGuarded but Bybit rejected JS float
// price 0.033912040000000004 ("Order price has too many decimals").

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../src/services/exchange-orders.js');

export default {
  id: 'bybit_price_precision_ki27',
  description: 'Bybit placeOrder price truncate 4 decimals + qty 2 decimals (KI 27 P0)',
  domain: 'exchange',
  tags: ['regression', 'p0', 'ki-27', 'bybit-precision'],

  async run() {
    const src = readFileSync(SRC, 'utf8');

    // L1: 旧 `price: String(price)` raw pass pattern 必删
    const placeBybitIdx = src.indexOf('async function placeBybit');
    if (placeBybitIdx < 0) return { ok: false, error: 'placeBybit function not found' };
    const placeBybitBlock = src.slice(placeBybitIdx, placeBybitIdx + 800);
    if (placeBybitBlock.match(/price:\s*String\(price\)/)) {
      return { ok: false, error: 'placeBybit 仍直 String(price) — JS float decimals overflow Bybit (KI 27 unfixed)' };
    }

    // L2: priceStr truncate to 4 decimals
    if (!placeBybitBlock.includes('Number(price).toFixed(4)')) {
      return { ok: false, error: 'price 未 truncate 4 decimals (Bybit spot tick size)' };
    }

    // L3: qtyStr truncate to 2 decimals
    if (!placeBybitBlock.includes('Number(qty).toFixed(2)')) {
      return { ok: false, error: 'qty 未 truncate 2 decimals (Bybit min lot)' };
    }

    // L4: parseFloat round-trip 去 trailing zeros (e.g. 0.0339 not 0.03390)
    if (!placeBybitBlock.includes('parseFloat(Number(price).toFixed(4))')) {
      return { ok: false, error: 'price 未 parseFloat round-trip (trailing 0 风险)' };
    }

    return { ok: true, summary: 'placeBybit price/qty 4-layer precision truncate PASS (旧 raw 删 + price 4 decimals + qty 2 decimals + parseFloat round-trip)' };
  },
};
