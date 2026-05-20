// hedge_router_capability_routing — Phase 5-2.5 KI 35 regression (NWT N19.73 F-2)
//
// Verifies hedge-router 5 routing paths + failover chain logic.
// Pure unit-level — no real chain, no CEX API call.

export default {
  id: 'hedge_router_capability_routing',
  description: 'hedge-router 5 routing paths + failover chain (KI 35 regression守护)',
  domain: 'exchange',
  tags: ['regression', 'p1', 'ki-35', 'hedge-router', 'phase-5-2-5'],

  async run() {
    const router = await import('../../../src/services/hedge-router.js');
    const cfg = await import('../../../src/data/settings/configs.js');

    // Snapshot original config (restore after test)
    const original = {};
    for (const k of [
      'hedge_router_enabled', 'hedge_router_default_cex', 'hedge_router_auto_e2e_cex',
      'hedge_router_small_order_cex', 'hedge_router_small_order_threshold_usd',
      'hedge_router_kas_floor_for_default', 'hedge_router_failover_chain',
    ]) original[k] = await cfg.getConfig(k);

    const failures = [];

    // Test 1: router disabled → default account (backward compat — Phase 1a 不破)
    await cfg.setConfig('hedge_router_enabled', 'false');
    let r = await router.selectHedgeAccount({ orderValueUsdt: 100, side: 'SELL' });
    if (r.route !== 'router_disabled') failures.push(`T1: route=${r.route} expected router_disabled`);
    if (!r.account) failures.push('T1: no account returned');

    // Test 2: caller override always honored
    r = await router.selectHedgeAccount({ preferredCex: 'gateio', orderValueUsdt: 100, side: 'SELL' });
    if (r.route !== 'caller_override') failures.push(`T2: route=${r.route} expected caller_override`);
    if (r.account?.exchange !== 'gateio') failures.push(`T2: exchange=${r.account?.exchange} expected gateio`);

    // Enable router for path tests
    await cfg.setConfig('hedge_router_enabled', 'true');
    await cfg.setConfig('hedge_router_default_cex', 'bybit');
    await cfg.setConfig('hedge_router_auto_e2e_cex', 'gateio');
    await cfg.setConfig('hedge_router_small_order_cex', 'kucoin');
    await cfg.setConfig('hedge_router_small_order_threshold_usd', '5');
    await cfg.setConfig('hedge_router_kas_floor_for_default', '5000');

    // Test 3: small order (< $5) → kucoin
    r = await router.selectHedgeAccount({ orderValueUsdt: 1, side: 'SELL' });
    if (r.route !== 'small_order') failures.push(`T3: route=${r.route} expected small_order (val $1)`);
    if (r.account?.exchange !== 'kucoin') failures.push(`T3: exchange=${r.account?.exchange} expected kucoin`);

    // Test 4a/4b — KI 42 Weak Test #4 fix (NWT N19.82): setup treasury_snapshot row to force determined route.
    // Use raw sqlite to inject snapshot rows (bypass treasury monitor 5min cycle).
    const Database = (await import('better-sqlite3')).default;
    const db = new Database('C:/kanet/kasia-console/data/console.db');
    const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
    // T4a: K-pool high (> floor 5000) → default route forced
    db.prepare(`INSERT INTO treasury_snapshot (relay_node_id, chain, asset, balance_raw, balance_human, source) VALUES (?, 'kaspa', 'KAS', ?, ?, 'test_inject')`)
      .run(BROKER_RELAY_ID, String(10000 * 1e8), 10000);
    r = await router.selectHedgeAccount({ orderValueUsdt: 100, side: 'SELL' });
    if (r.route !== 'default') failures.push(`T4a (K-pool=10000>floor): route=${r.route} expected default`);
    if (r.account?.exchange !== 'bybit') failures.push(`T4a: exchange=${r.account?.exchange} expected bybit`);
    // T4b: K-pool low (< floor 5000) → k_pool_low → gateio route forced
    db.prepare(`INSERT INTO treasury_snapshot (relay_node_id, chain, asset, balance_raw, balance_human, source) VALUES (?, 'kaspa', 'KAS', ?, ?, 'test_inject')`)
      .run(BROKER_RELAY_ID, String(1000 * 1e8), 1000);  // newest row (most recent ts wins per L37 DESC query)
    r = await router.selectHedgeAccount({ orderValueUsdt: 100, side: 'SELL' });
    if (r.route !== 'k_pool_low') failures.push(`T4b (K-pool=1000<floor): route=${r.route} expected k_pool_low`);
    if (r.account?.exchange !== 'gateio') failures.push(`T4b: exchange=${r.account?.exchange} expected gateio`);
    // Cleanup test_inject rows
    db.prepare(`DELETE FROM treasury_snapshot WHERE source='test_inject'`).run();
    db.close();

    // Test 5: auto_e2e mode → gateio (regardless of size)
    r = await router.selectHedgeAccount({ orderValueUsdt: 100, side: 'SELL', mode: 'auto_e2e' });
    if (r.route !== 'auto_e2e') failures.push(`T5: route=${r.route} expected auto_e2e`);
    if (r.account?.exchange !== 'gateio') failures.push(`T5: exchange=${r.account?.exchange} expected gateio`);

    // Test 6: failover chain — bybit → [gateio, kucoin]
    await cfg.setConfig('hedge_router_failover_chain', 'bybit,gateio,kucoin');
    const chain = await router.getFailoverChain('bybit');
    if (chain.length !== 2 || chain[0] !== 'gateio' || chain[1] !== 'kucoin') {
      failures.push(`T6: failover chain after bybit = ${JSON.stringify(chain)} expected [gateio,kucoin]`);
    }

    // Test 7: failover chain — unknown cex returns full chain
    const fullChain = await router.getFailoverChain('unknown_cex_xyz');
    if (fullChain.length !== 3) failures.push(`T7: failover chain for unknown = ${JSON.stringify(fullChain)} expected [bybit,gateio,kucoin]`);

    // Restore original config (backward compat critical — never leave router_enabled=true after test)
    for (const [k, v] of Object.entries(original)) {
      if (v !== null && v !== undefined) await cfg.setConfig(k, v);
    }

    if (failures.length > 0) {
      return { ok: false, error: failures.join('; '), failures };
    }
    return { ok: true, summary: '7 router paths verified (T1-T7): disabled / override / small / large / auto_e2e / failover chain' };
  },
};
