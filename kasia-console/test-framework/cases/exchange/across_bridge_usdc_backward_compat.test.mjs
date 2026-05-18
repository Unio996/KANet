// Across V3 USDC backward compat — NWT N18 Owner A 钦定 5/18
// 现 4/24 production usage = USDC default. asset param 加入后 default 必须仍 USDC.

export default {
  id: 'across_bridge_usdc_backward_compat',
  description: 'quoteBridge default asset=USDC (no asset arg) unchanged behavior post-USDT extension',
  domain: 'exchange',
  tags: ['regression', 'bridge', 'across', 'usdc', 'backward-compat'],

  async run() {
    const { quoteBridge, USDC } = await import('../../../src/services/across-bridge-config.js');

    // USDC addr 6 chain (含 base) intact
    const expectChains = ['arbitrum', 'polygon', 'bnb', 'eth', 'base', 'optimism'];
    for (const c of expectChains) {
      if (!USDC[c]) return { ok: false, error: `USDC addr missing for ${c} (post-USDT extension regression)` };
    }

    // Default asset (no arg) → USDC behavior
    try {
      const quoteDefault = await quoteBridge('polygon', 'arbitrum', 1.0); // no asset arg
      if (!quoteDefault.outputAmount) return { ok: false, error: 'default quote missing outputAmount' };
      if (quoteDefault.asset !== 'USDC') return { ok: false, error: `default quote.asset should be 'USDC', got ${quoteDefault.asset}` };
    } catch (err) {
      return { ok: false, error: `default USDC quote (Polygon→Arbitrum) failed: ${err.message}` };
    }

    // Explicit asset='USDC' same as default
    try {
      const quoteExplicit = await quoteBridge('polygon', 'arbitrum', 1.0, null, 'USDC');
      if (!quoteExplicit.outputAmount) return { ok: false, error: 'explicit USDC quote missing outputAmount' };
    } catch (err) {
      return { ok: false, error: `explicit USDC quote failed: ${err.message}` };
    }

    return { ok: true, summary: '6 USDC addr intact, default (no arg) + explicit asset=USDC both real Across API quote success' };
  },
};
