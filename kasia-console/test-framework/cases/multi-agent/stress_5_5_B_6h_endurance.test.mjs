// stress_5_5_B_6h_endurance — Phase 5-5-B KI 46 6h endurance sustained (Owner钦定 B / NWT N19.102 (i'))
//
// Single-switch protocol (J2 push back F-2): 175 min KuCoin + 10 min drain + 175 min Bybit = 6h.
// (vs NWT 等比 150-30-150-30 = 1h drain waste). Less drain = more data/$.
//
// Auto-emergency-stop (KI 46): 5 abort conditions checked per 60s sample tick.
// Abort → invoke _stress_rollback.mjs + broadcast dev-coord.
//
// Real-chain: real_chain + expensive + skip_in_batch. Owner real-run gate.

import autonomousBuyer from '../../personas/agent/autonomous_buyer.mjs';
import autonomousSeller from '../../personas/agent/autonomous_seller.mjs';
import { runStress } from '../../lib/stress-harness.mjs';
import { getRelayInfo } from '../../lib/real-chain-runner.mjs';

const BROKER_KASIA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';

export default {
  id: 'stress_5_5_B_6h_endurance',
  description: 'Phase 5-5-B: 6h endurance single-switch (175 KuCoin / 10 drain / 175 Bybit) + auto-emergency-stop',
  domain: 'multi-agent',
  tags: ['real_chain', 'expensive', 'p1', 'phase-5-5-B', 'stress', '6h-endurance'],
  skip_in_batch: true,
  expensive: true,

  async run(opts = {}) {
    // Minor-1 (NWT N19.102): cleaner opts API, no string parsing
    const phase1_ms = opts.phase1_ms || 175 * 60 * 1000;
    const drain_ms = opts.drain_ms || 10 * 60 * 1000;
    const phase2_ms = opts.phase2_ms || 175 * 60 * 1000;
    const total_duration_ms = phase1_ms + drain_ms + phase2_ms;
    const spawn_rate_per_min = opts.spawn_rate_per_min || 0.5;

    const buyerPool = opts.buyerPool || ['NWT', 'Trader-M', 'J2', 'Trader-A'];
    const sellerPool = opts.sellerPool || ['NWT', 'Trader-M', 'J2'];

    // KI 44.2 backup-restore + KI 45.2 atomic state file
    const configBackup = {};
    if (opts.enableRouterPath !== false) {
      const { setConfig, getConfig } = await import('../../../src/data/settings/configs.js');
      configBackup.enabled = await getConfig('hedge_router_enabled');
      configBackup.smallCex = await getConfig('hedge_router_small_order_cex');
      configBackup.smallThreshold = await getConfig('hedge_router_small_order_threshold_usd');
      await setConfig('hedge_router_enabled', 'true');
      await setConfig('hedge_router_small_order_cex', 'kucoin');
      await setConfig('hedge_router_small_order_threshold_usd', '5');
    }

    const origStressMode = process.env.KANET_STRESS_MODE;
    process.env.KANET_STRESS_MODE = '1';

    const runId = `${Date.now()}`;
    const markerPrefix = `stress_5_5_B_${runId}_`;
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
        test: 'stress_5_5_B_6h_endurance',
      };
      const tmpFile = `${STATE_DIR}/run-${runId}.json.tmp`;
      const finalFile = `${STATE_DIR}/run-${runId}.json`;
      writeFileSync(tmpFile, JSON.stringify(stateData, null, 2));
      renameSync(tmpFile, finalFile);
    } catch (e) { console.warn(`[5-5-B] state file write fail: ${e.message}`); }

    // Build actor templates
    const buyerTemplates = buyerPool.map((name) => {
      const r = getRelayInfo(name);
      if (!r) return null;
      return {
        id: `buyer_${name}`,
        personaFn: autonomousBuyer.run,
        persona: { id: `buyer_${name}` },
        optsBuilder: (i) => ({
          relayId: r.id, relayName: name, userKasia: r.address, brokerKasia: BROKER_KASIA,
          userEvmAddr: opts.userEvmAddrMap?.[name] || '0xd3618e37354700d21FE8728Bd278Dc1924974799',
          // KI 57 (NWT N19.140): mix 80% small (10-30 KAS) + 20% big (100-250 KAS) to真 exercise router 3-CEX paths.
          // Small → KuCoin route (<$5). Big → Bybit/Gate.io default/auto_e2e (≥$5). 6h × 30/hr × 0.2 = ~36 big cycles.
          qty: Math.random() < 0.8 ? (10 + Math.floor(Math.random() * 21)) : (100 + Math.floor(Math.random() * 151)),
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
        optsBuilder: () => ({ relayId: r.id, qty: Math.random() < 0.8 ? (10 + Math.floor(Math.random() * 21)) : (100 + Math.floor(Math.random() * 151)), pricePerKas: 0.034, expiresMin: 5 }),
      };
    }).filter(Boolean);
    const actorTemplates = [...buyerTemplates, ...sellerTemplates];

    // Sub-A drain protocol
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const forceCleanLocks = async () => {
      try {
        const { unlinkSync, existsSync } = await import('node:fs');
        const LOCK_DIR = 'C:/kanet/logs/agent-locks';
        const allRelays = [...new Set([...buyerPool, ...sellerPool])];
        const { getRelayInfo: getInfo } = await import('../../lib/real-chain-runner.mjs');
        for (const name of allRelays) {
          const r = getInfo(name);
          if (!r) continue;
          const brokerSlice = BROKER_KASIA.slice(6, 18);
          const lockFile = `${LOCK_DIR}/${r.id.slice(0, 8)}_${brokerSlice}.lock`;
          if (existsSync(lockFile)) try { unlinkSync(lockFile); } catch {}
        }
      } catch {}
    };

    // KI 46 (NWT N19.102 Minor-2): abortHook invokes _stress_rollback.mjs via spawn
    const J2_RELAY_ID = 'c9c37c37-9a8c-484c-9893-20185d97ccf9';
    const abortHook = async ({ reason }) => {
      console.error(`[5-5-B] AUTO-ABORT: ${reason} — invoking rollback`);
      try {
        const { spawn } = await import('node:child_process');
        spawn('node', ['C:/kanet/kasia-console/scripts/_stress_rollback.mjs', `--run=${runId}`], { detached: true, stdio: 'ignore' }).unref();
      } catch (e) { console.error(`[5-5-B] rollback spawn fail: ${e.message}`); }
      try {
        await fetch('http://127.0.0.1:3100/api/chat/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relayId: J2_RELAY_ID, channel: 'dev-coord', message: `🚨 [5-5-B AUTO-ABORT] run_id=${runId} reason=${reason} — rollback spawned` }),
        });
      } catch {}
    };

    let metrics1, metrics2;
    try {
      console.log(`[5-5-B] Phase 1 start: KuCoin route ${(phase1_ms / 60_000).toFixed(0)} min`);
      metrics1 = await runStress({ actorTemplates, duration_ms: phase1_ms, spawn_rate_per_min, max_concurrent: 10, abortHook });
      if (metrics1.aborted) {
        return { ok: false, error: `Phase 1 aborted: ${metrics1.abort_reason}`, details: { metrics1 } };
      }
      console.log(`[5-5-B] Drain ${(drain_ms / 60_000).toFixed(0)} min + force-clean locks + switch to Bybit`);
      await sleep(drain_ms);
      await forceCleanLocks();
      if (opts.enableRouterPath !== false) {
        const { setConfig } = await import('../../../src/data/settings/configs.js');
        await setConfig('hedge_router_enabled', 'false');
      }
      console.log(`[5-5-B] Phase 2 start: Bybit route ${(phase2_ms / 60_000).toFixed(0)} min`);
      metrics2 = await runStress({ actorTemplates, duration_ms: phase2_ms, spawn_rate_per_min, max_concurrent: 10, abortHook });
      if (metrics2.aborted) {
        return { ok: false, error: `Phase 2 aborted: ${metrics2.abort_reason}`, details: { metrics1, metrics2 } };
      }
      await forceCleanLocks();
    } finally {
      if (opts.enableRouterPath !== false) {
        const { setConfig } = await import('../../../src/data/settings/configs.js');
        if (configBackup.enabled !== undefined) await setConfig('hedge_router_enabled', configBackup.enabled || 'false');
        if (configBackup.smallCex !== undefined) await setConfig('hedge_router_small_order_cex', configBackup.smallCex || 'kucoin');
        if (configBackup.smallThreshold !== undefined) await setConfig('hedge_router_small_order_threshold_usd', configBackup.smallThreshold || '5');
      }
      if (origStressMode === undefined) delete process.env.KANET_STRESS_MODE;
      else process.env.KANET_STRESS_MODE = origStressMode;
    }

    // Aggregate
    const totalSpawned = (metrics1?.actors_spawned ?? 0) + (metrics2?.actors_spawned ?? 0);
    const totalCompleted = (metrics1?.actors_completed ?? 0) + (metrics2?.actors_completed ?? 0);
    const totalFailed = (metrics1?.actors_failed ?? 0) + (metrics2?.actors_failed ?? 0);
    const hedgePlacedDelta = (metrics1?.final_pre_post_diff?.hedge_placed_delta ?? 0) + (metrics2?.final_pre_post_diff?.hedge_placed_delta ?? 0);
    const hedgeFailedDelta = (metrics1?.final_pre_post_diff?.hedge_failed_delta ?? 0) + (metrics2?.final_pre_post_diff?.hedge_failed_delta ?? 0);
    const hedgeSkippedDelta = (metrics1?.final_pre_post_diff?.hedge_skipped_delta ?? 0) + (metrics2?.final_pre_post_diff?.hedge_skipped_delta ?? 0);
    const kPoolDelta = (metrics1?.final_pre_post_diff?.k_pool_delta ?? 0) + (metrics2?.final_pre_post_diff?.k_pool_delta ?? 0);

    const failures = [];
    if (totalFailed > totalSpawned * 0.5) failures.push(`actor fail rate ${totalFailed}/${totalSpawned} > 50%`);
    if (kPoolDelta < -2000) failures.push(`K-pool drain ${kPoolDelta} KAS > 2000 unsustainable`);
    if (hedgeSkippedDelta > 0) failures.push(`hedge_skipped Δ ${hedgeSkippedDelta} — circuit breaker trip HARD`);
    if (totalSpawned < 10) failures.push(`totalSpawned ${totalSpawned} < min 10 (6h endurance expects >=10)`);
    const targetHedge = Math.floor(totalSpawned * 0.8);
    if (hedgePlacedDelta < targetHedge) failures.push(`hedge_placed Δ ${hedgePlacedDelta} < target ${targetHedge}`);

    return {
      ok: failures.length === 0,
      summary: `5-5-B 6h endurance: spawned=${totalSpawned}/completed=${totalCompleted}/failed=${totalFailed} | hedge Δ +${hedgePlacedDelta} placed / +${hedgeFailedDelta} failed / +${hedgeSkippedDelta} skipped | K-pool Δ ${kPoolDelta} KAS | run_id=${runId}`,
      details: { phase1_kucoin: metrics1, phase2_bybit: metrics2, run_id: runId, failures },
    };
  },
};
