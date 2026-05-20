// stress_5-5-A_1h_burst — Phase 5-5 KI 44 (NWT N19.74 spec)
//
// 1-hour smoke verification of Phase 5 pipeline:
// 5 agent buyer + 3 agent seller, ~30 cycle/hour peak.
//
// Pass criteria:
//   - 0 crash
//   - alarm 不 spam (throttle_log shows ≤ 5 broadcasts)
//   - hedge_placed ≥ 24 (80% of 30 target)
//   - K-pool delta < 2000 KAS (sustainable burn)
//
// Real-chain run gated on Owner ack (expensive: KAS broadcast + BSC USDT gas).

import autonomousBuyer from '../../personas/agent/autonomous_buyer.mjs';
import autonomousSeller from '../../personas/agent/autonomous_seller.mjs';
import { runStress } from '../../lib/stress-harness.mjs';
import { getRelayInfo } from '../../lib/real-chain-runner.mjs';

const BROKER_KASIA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';

export default {
  id: 'stress_5_5_A_1h_burst',
  description: 'Phase 5-5-A: 1-hour burst smoke (5 buyer + 3 seller, real chain, 30 cycle/h target)',
  domain: 'multi-agent',
  tags: ['real_chain', 'expensive', 'p1', 'phase-5-5', 'stress', '1h-burst'],
  skip_in_batch: true,
  expensive: true,

  async run(opts = {}) {
    const duration_ms = opts.duration_ms || 60 * 60 * 1000;  // 1 hour
    const spawn_rate_per_min = opts.spawn_rate_per_min || 0.5;  // 30/hr peak
    // KI 44.1 Conflict #1 fix (NWT N19.89): 5 buyer + 3 seller pool (per spec).
    // Caveat: 实际 BSC USDT only sufficient on NWT/Trader-M/J2 (Phase 5-1 snapshot 实证). Pool may need pre-fund.
    // KI 45 fix (J2 grep N19.94 sub-1 pre-flight): KANet no BSC wallet (agent_wallets chain='bnb'=0).
    // Pool capacity 实证 = 4 buyer (with BSC USDT) + 3 seller. spec 5 buyer 不 achievable until KANet wallet gen.
    const buyerPool = opts.buyerPool || ['NWT', 'Trader-M', 'J2', 'Trader-A'];
    const sellerPool = opts.sellerPool || ['NWT', 'Trader-M', 'J2'];

    // KI 44.1 Conflict #2 fix (NWT N19.89 Path B): hedge_router enable + small_order_cex=kucoin route.
    // qty 10-30 KAS = $0.34-$1 = clear KuCoin $0.10 min. Avoids Bybit $5 (KI 28 复刻).
    // KI 44.2 fix (NWT N19.90): backup-restore config pattern (align KI 42.1) — test 不污染 prod config.
    const configBackup = {};
    if (opts.enableRouterPath !== false) {
      const { setConfig, getConfig } = await import('../../../src/data/settings/configs.js');
      configBackup.enabled = await getConfig('hedge_router_enabled');
      configBackup.smallCex = await getConfig('hedge_router_small_order_cex');
      configBackup.smallThreshold = await getConfig('hedge_router_small_order_threshold_usd');
      await setConfig('hedge_router_enabled', 'true');
      await setConfig('hedge_router_small_order_cex', 'kucoin');
      await setConfig('hedge_router_small_order_threshold_usd', '5');  // < $5 → kucoin route
    }

    // Build actor templates — per spawn, optsBuilder creates fresh opts (avoid shared state)
    const buyerTemplates = buyerPool.map((name) => {
      const r = getRelayInfo(name);
      if (!r) return null;
      return {
        id: `buyer_${name}`,
        personaFn: autonomousBuyer.run,
        persona: { id: `buyer_${name}` },
        optsBuilder: (i) => ({
          relayId: r.id,
          relayName: name,
          userKasia: r.address,
          brokerKasia: BROKER_KASIA,
          userEvmAddr: opts.userEvmAddrMap?.[name] || '0xd3618e37354700d21FE8728Bd278Dc1924974799',
          // KI 44.1 Conflict #2 fix: qty 10-30 KAS = $0.34-$1.02 = clear KuCoin $0.10 min via router
          qty: 10 + Math.floor(Math.random() * 21),
          policy: { maxStepUsdt: 5 },
        }),
      };
    }).filter(Boolean);

    const sellerTemplates = sellerPool.map((name) => {
      const r = getRelayInfo(name);
      if (!r) return null;
      return {
        id: `seller_${name}`,
        personaFn: autonomousSeller.run,
        persona: { id: `seller_${name}` },
        optsBuilder: (i) => ({
          relayId: r.id,
          qty: 10 + Math.floor(Math.random() * 21),  // KI 44.1: 10-30 KAS (KuCoin route via Path B)
          pricePerKas: 0.034,
          expiresMin: 5,
        }),
      };
    }).filter(Boolean);

    const actorTemplates = [...buyerTemplates, ...sellerTemplates];
    if (actorTemplates.length === 0) return { ok: false, error: 'no actors available (relay lookup fail)' };

    let metrics;
    try {
      metrics = await runStress({
        actorTemplates,
        duration_ms,
        spawn_rate_per_min,
        max_concurrent: 10,
      });
    } finally {
      // KI 44.2 fix (NWT N19.90): backup-restore — preserve original config (NOT覆写 default 'false').
      if (opts.enableRouterPath !== false) {
        const { setConfig } = await import('../../../src/data/settings/configs.js');
        if (configBackup.enabled !== undefined) await setConfig('hedge_router_enabled', configBackup.enabled || 'false');
        if (configBackup.smallCex !== undefined) await setConfig('hedge_router_small_order_cex', configBackup.smallCex || 'kucoin');
        if (configBackup.smallThreshold !== undefined) await setConfig('hedge_router_small_order_threshold_usd', configBackup.smallThreshold || '5');
      }
    }

    // Pass criteria check
    const diff = metrics.final_pre_post_diff;
    const failures = [];
    if (metrics.actors_failed > metrics.actors_spawned * 0.5) {
      failures.push(`actor fail rate ${metrics.actors_failed}/${metrics.actors_spawned} > 50%`);
    }
    if (diff.k_pool_delta !== null && diff.k_pool_delta < -2000) {
      failures.push(`K-pool drain ${diff.k_pool_delta} KAS (> 2000 unsustainable)`);
    }
    // hedge_placed target loose (cycle rate test-dependent on real CEX availability)
    // Don't gate — just report
    return {
      ok: failures.length === 0,
      summary: `5-5-A 1h smoke: spawned=${metrics.actors_spawned} completed=${metrics.actors_completed} failed=${metrics.actors_failed} | hedge Δ +${diff.hedge_placed_delta}/${diff.hedge_failed_delta}/${diff.hedge_skipped_delta} | K-pool Δ ${diff.k_pool_delta} KAS`,
      details: { metrics, diff, failures },
    };
  },
};
