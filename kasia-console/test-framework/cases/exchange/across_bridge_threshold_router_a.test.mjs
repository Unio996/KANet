// 方案 A threshold router unit test — NWT N18 + Owner A 钦定 5/18
// across % vs stargate fixed: cross-over ~$167, threshold $150
// < $150 → Across (% 便宜), ≥ $150 → Stargate (固定费便宜)

export default {
  id: 'across_bridge_threshold_router_a',
  description: 'selectBridgeProtocol $150 阈值: <150 → across, ≥150 → stargate',
  domain: 'exchange',
  tags: ['regression', 'bridge', 'router', 'threshold'],

  async run() {
    const { selectBridgeProtocol } = await import('../../../src/services/bridge-router.js');

    const checks = [
      { amount: 1, expected: 'across' },
      { amount: 10, expected: 'across' },
      { amount: 50, expected: 'across' },
      { amount: 149, expected: 'across' },
      { amount: 149.99, expected: 'across' },
      { amount: 150, expected: 'stargate' }, // boundary inclusive on Stargate side
      { amount: 200, expected: 'stargate' },
      { amount: 1000, expected: 'stargate' },
      { amount: 10000, expected: 'stargate' },
    ];

    for (const { amount, expected } of checks) {
      const got = selectBridgeProtocol(amount);
      if (got !== expected) {
        return { ok: false, error: `selectBridgeProtocol(${amount}) returned ${got}, expected ${expected}` };
      }
    }

    // Edge case: invalid input throws
    let threwOnNegative = false;
    try { selectBridgeProtocol(-1); } catch { threwOnNegative = true; }
    if (!threwOnNegative) return { ok: false, error: 'selectBridgeProtocol(-1) should throw' };

    let threwOnNaN = false;
    try { selectBridgeProtocol(NaN); } catch { threwOnNaN = true; }
    if (!threwOnNaN) return { ok: false, error: 'selectBridgeProtocol(NaN) should throw' };

    return { ok: true, summary: `selectBridgeProtocol 9 amount + 2 edge: across<$150, stargate≥$150, invalid throws` };
  },
};
