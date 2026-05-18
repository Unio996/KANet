// Across V3 USDT quote — NWT N18 Owner A 钦定 5/18
// verify across-bridge-config.js USDT addr table + quoteBridge asset='USDT' path

export default {
  id: 'across_bridge_usdt_quote',
  description: 'Across V3 quoteBridge asset=USDT (BSC→ETH + Polygon→Arbitrum) real Across API call',
  domain: 'exchange',
  tags: ['regression', 'bridge', 'across', 'usdt', 'external-api'],
  // network-dependent (Across API call) — note: not skip_in_batch but flaky on network down

  async run() {
    const { quoteBridge, USDT, USDT_DECIMALS } = await import('../../../src/services/across-bridge-config.js');

    // 5 chain USDT addr verify (no base)
    const expectChains = ['arbitrum', 'polygon', 'bnb', 'eth', 'optimism'];
    for (const c of expectChains) {
      if (!USDT[c] || !/^0x[a-fA-F0-9]{40}$/.test(USDT[c])) {
        return { ok: false, error: `USDT addr missing/invalid for chain ${c}` };
      }
    }
    if (USDT.base) return { ok: false, error: 'base should NOT have USDT (no native USDT on base)' };

    // BNB 18 decimal, others 6
    if (USDT_DECIMALS.bnb !== 18) return { ok: false, error: `USDT_DECIMALS.bnb should be 18, got ${USDT_DECIMALS.bnb}` };

    // Real API quote: BSC USDT → ETH USDT (18 dec → 6 dec mismatch, allowUnmatchedDecimals guard)
    try {
      const quote = await quoteBridge('bnb', 'eth', 1.0, null, 'USDT');
      if (!quote.outputAmount) return { ok: false, error: 'BSC→ETH USDT quote missing outputAmount' };
      if (quote.asset !== 'USDT') return { ok: false, error: `quote.asset should be 'USDT', got ${quote.asset}` };
    } catch (err) {
      return { ok: false, error: `BSC→ETH USDT quote failed: ${err.message}` };
    }

    // Polygon USDT → Arbitrum USDT (L2-L2, both 6 dec)
    try {
      const quote = await quoteBridge('polygon', 'arbitrum', 1.0, null, 'USDT');
      if (!quote.outputAmount) return { ok: false, error: 'Polygon→Arbitrum USDT quote missing outputAmount' };
    } catch (err) {
      return { ok: false, error: `Polygon→Arbitrum USDT quote failed: ${err.message}` };
    }

    return { ok: true, summary: `5 USDT addr verified (no base), BNB 18-dec, BSC→ETH + Polygon→Arbitrum quote real Across API success` };
  },
};
