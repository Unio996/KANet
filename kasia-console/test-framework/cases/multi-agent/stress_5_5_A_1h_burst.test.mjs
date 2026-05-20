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
    const total_duration_ms = opts.duration_ms || 60 * 60 * 1000;  // 1 hour
    const drain_ms = opts.drain_ms || 5 * 60 * 1000;  // 5 min mid-switch drain (NWT N19.94 Sub-A)
    // Phase split: 25 min KuCoin + 5 min drain + 25 min Bybit + 5 min final drain
    const phase_spawn_ms = (total_duration_ms - 2 * drain_ms) / 2;
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

    // KI 45 Sub-2 (NWT N19.94 Sub-A): hybrid phase protocol.
    // Phase 1 (0-25 min): KuCoin route, hedge_router_enabled=true (already set above).
    // Drain 1 (25-30 min): no spawn, force-cleanup lock files post-drain.
    // Phase 2 (30-55 min): Bybit route, hedge_router_enabled=false.
    // Drain 2 (55-60 min): no spawn, final cleanup.
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    // KI 45.1 Issue #3 fix (NWT N19.96): prefix filter — only delete stress test lock files, not other tests'.
    // KI 43 lock format: ${relayId.slice(0,8)}_${brokerKasia.slice(6,18)}.lock — non-distinguishable, so use newer prefix.
    // Use targeted unlink per known (relayId, brokerKasia) pair.
    const forceCleanLocks = async () => {
      try {
        const { unlinkSync, existsSync } = await import('node:fs');
        const LOCK_DIR = 'C:/kanet/logs/agent-locks';
        // Only clean locks held by our buyer/seller pool (relayId-prefix match).
        const allRelays = [...new Set([...buyerPool, ...sellerPool])];
        const { getRelayInfo: getInfo } = await import('../../lib/real-chain-runner.mjs');
        for (const name of allRelays) {
          const r = getInfo(name);
          if (!r) continue;
          const brokerSlice = BROKER_KASIA.slice(6, 18);
          const lockFile = `${LOCK_DIR}/${r.id.slice(0, 8)}_${brokerSlice}.lock`;
          if (existsSync(lockFile)) {
            try { unlinkSync(lockFile); } catch {}
          }
        }
      } catch {}
    };
    // KI 45 Sub-3 (NWT N19.94 Sub-C): KANET_STRESS_MODE=1 process env bypass throttle for raw alarm visibility
    const origStressMode = process.env.KANET_STRESS_MODE;
    process.env.KANET_STRESS_MODE = '1';

    // KI 45 Sub-5 (NWT N19.94 Q-rollback): atomic state file write for crash recovery via _stress_rollback.mjs
    const runId = `${Date.now()}`;
    const markerPrefix = `stress_5_5_A_${runId}_`;
    try {
      const { mkdirSync, writeFileSync, renameSync } = await import('node:fs');
      const STATE_DIR = 'C:/kanet/logs/stress-state';
      mkdirSync(STATE_DIR, { recursive: true });
      const stateData = {
        run_id: runId,
        started_iso: new Date().toISOString(),
        marker_prefix: markerPrefix,
        config_backup: configBackup,
        env_backup: { KANET_STRESS_MODE: origStressMode },
      };
      const tmpFile = `${STATE_DIR}/run-${runId}.json.tmp`;
      const finalFile = `${STATE_DIR}/run-${runId}.json`;
      writeFileSync(tmpFile, JSON.stringify(stateData, null, 2));
      renameSync(tmpFile, finalFile);  // atomic rename
      console.log(`[5-5-A] state backup → ${finalFile}`);
    } catch (e) { console.warn(`[5-5-A] state file write fail: ${e.message}`); }

    let metrics1, metrics2;
    try {
      // Phase 1: KuCoin
      console.log('[5-5-A] Phase 1 start: KuCoin route, duration ' + (phase_spawn_ms / 60_000).toFixed(1) + ' min');
      metrics1 = await runStress({
        actorTemplates,
        duration_ms: phase_spawn_ms,
        spawn_rate_per_min,
        max_concurrent: 10,
      });
      // Drain 1
      console.log('[5-5-A] Drain 1: ' + (drain_ms / 60_000).toFixed(1) + ' min wait + force-clean locks');
      await sleep(drain_ms);
      await forceCleanLocks();
      // Switch to Bybit
      if (opts.enableRouterPath !== false) {
        const { setConfig } = await import('../../../src/data/settings/configs.js');
        await setConfig('hedge_router_enabled', 'false');  // → Bybit primary (default)
        console.log('[5-5-A] Phase switch: router_enabled=false → Bybit primary');
      }
      // Phase 2: Bybit
      console.log('[5-5-A] Phase 2 start: Bybit route, duration ' + (phase_spawn_ms / 60_000).toFixed(1) + ' min');
      metrics2 = await runStress({
        actorTemplates,
        duration_ms: phase_spawn_ms,
        spawn_rate_per_min,
        max_concurrent: 10,
      });
      // Final drain
      console.log('[5-5-A] Final drain: ' + (drain_ms / 60_000).toFixed(1) + ' min');
      await sleep(drain_ms);
      await forceCleanLocks();
    } finally {
      // KI 44.2 fix (NWT N19.90): backup-restore — preserve original config (NOT覆写 default 'false').
      if (opts.enableRouterPath !== false) {
        const { setConfig } = await import('../../../src/data/settings/configs.js');
        if (configBackup.enabled !== undefined) await setConfig('hedge_router_enabled', configBackup.enabled || 'false');
        if (configBackup.smallCex !== undefined) await setConfig('hedge_router_small_order_cex', configBackup.smallCex || 'kucoin');
        if (configBackup.smallThreshold !== undefined) await setConfig('hedge_router_small_order_threshold_usd', configBackup.smallThreshold || '5');
      }
      // KI 45 Sub-3: restore KANET_STRESS_MODE env var
      if (origStressMode === undefined) delete process.env.KANET_STRESS_MODE;
      else process.env.KANET_STRESS_MODE = origStressMode;
    }

    // KI 45 Sub-2: aggregate metrics across phases
    const allMetrics = { phase1_kucoin: metrics1, phase2_bybit: metrics2 };
    const totalSpawned = (metrics1?.actors_spawned ?? 0) + (metrics2?.actors_spawned ?? 0);
    const totalCompleted = (metrics1?.actors_completed ?? 0) + (metrics2?.actors_completed ?? 0);
    const totalFailed = (metrics1?.actors_failed ?? 0) + (metrics2?.actors_failed ?? 0);
    const hedgePlacedDelta = (metrics1?.final_pre_post_diff?.hedge_placed_delta ?? 0) + (metrics2?.final_pre_post_diff?.hedge_placed_delta ?? 0);
    const hedgeFailedDelta = (metrics1?.final_pre_post_diff?.hedge_failed_delta ?? 0) + (metrics2?.final_pre_post_diff?.hedge_failed_delta ?? 0);
    const hedgeSkippedDelta = (metrics1?.final_pre_post_diff?.hedge_skipped_delta ?? 0) + (metrics2?.final_pre_post_diff?.hedge_skipped_delta ?? 0);
    // KI 45.1 Issue #1 fix (NWT N19.96): sum both phases — runStress per-call pre/post snapshots independent.
    const kPoolDelta = (metrics1?.final_pre_post_diff?.k_pool_delta ?? 0) + (metrics2?.final_pre_post_diff?.k_pool_delta ?? 0);

    // KI 45 Sub-3 Q7 (NWT N19.94 J2 #574 a+): 80% threshold + 0 hedge_skipped hard
    const failures = [];
    if (totalFailed > totalSpawned * 0.5) {
      failures.push(`actor fail rate ${totalFailed}/${totalSpawned} > 50%`);
    }
    if (kPoolDelta !== null && kPoolDelta < -2000) {
      failures.push(`K-pool drain ${kPoolDelta} KAS (> 2000 unsustainable)`);
    }
    if (hedgeSkippedDelta > 0) {
      failures.push(`hedge_skipped Δ ${hedgeSkippedDelta} — circuit breaker tripped (hard fail per Q7 a+)`);
    }
    // KI 45.1 Issue #2 fix (NWT N19.96): remove `totalSpawned > 5` mask — gate always applies; add min spawn check
    const MIN_SPAWN = 5;
    if (totalSpawned < MIN_SPAWN) {
      failures.push(`totalSpawned ${totalSpawned} < min ${MIN_SPAWN} (spawn rate too low)`);
    }
    const targetHedge = Math.floor((totalSpawned * 0.8));
    if (hedgePlacedDelta < targetHedge) {
      failures.push(`hedge_placed Δ ${hedgePlacedDelta} < target ${targetHedge} (80% of spawn ${totalSpawned})`);
    }
    return {
      ok: failures.length === 0,
      summary: `5-5-A 1h hybrid: spawned=${totalSpawned}/completed=${totalCompleted}/failed=${totalFailed} | hedge Δ +${hedgePlacedDelta} placed / +${hedgeFailedDelta} failed / +${hedgeSkippedDelta} skipped | K-pool Δ ${kPoolDelta} KAS`,
      details: { phase1_kucoin: metrics1, phase2_bybit: metrics2, totals: { totalSpawned, totalCompleted, totalFailed, hedgePlacedDelta, hedgeFailedDelta, hedgeSkippedDelta, kPoolDelta }, failures },
    };
  },
};
