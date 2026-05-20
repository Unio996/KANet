// stress-harness.mjs — Phase 5-5 KI 44 long-run stress orchestrator (NWT N19.74 spec)
//
// vs multi-actor-orchestrator.mjs (N19.33): orchestrator fires N actors once + waits all.
// Stress harness runs duration_ms, continuously spawns actors at spawn_rate_per_min, collects metrics.
//
// Metrics sampled every 60s via chain_events + treasury_snapshot + exchange_offers SQL.

import Database from 'better-sqlite3';

const DB_PATH = 'C:/kanet/kasia-console/data/console.db';

/**
 * Run stress test for duration_ms with continuous actor spawn.
 *
 * @param {Object} opts
 * @param {Array} opts.actorTemplates — [{ id, personaFn, persona, optsBuilder }] — optsBuilder(i) returns fresh opts per spawn
 * @param {number} opts.duration_ms — total run time
 * @param {number} opts.spawn_rate_per_min — new actor spawn rate
 * @param {number} [opts.max_concurrent=20] — cap concurrent actors
 * @returns {Promise<{ metrics, spawned, completed }>}
 */
export async function runStress({ actorTemplates, duration_ms, spawn_rate_per_min, max_concurrent = 20, abortHook = null }) {
  if (!actorTemplates?.length) throw new Error('runStress: actorTemplates required');
  if (!duration_ms || duration_ms < 1000) throw new Error('runStress: duration_ms required (>= 1s)');

  const start = Date.now();
  const startIso = new Date(start).toISOString();
  const deadline = start + duration_ms;
  const spawnIntervalMs = Math.max(1000, 60_000 / spawn_rate_per_min);

  const metrics = {
    start_iso: startIso,
    duration_ms,
    spawn_rate_per_min,
    actors_spawned: 0,
    actors_completed: 0,
    actors_failed: 0,
    samples: [],  // { ts_iso, k_pool, usdt_pool_bsc, hedge_placed, hedge_failed, hedge_skipped, offers_open, offers_completed }
    final_pre_post_diff: null,
  };

  const db = new Database(DB_PATH, { readonly: true });
  // Pre-snapshot
  const pre = collectMetrics(db, startIso);
  metrics.samples.push({ ts_iso: startIso, phase: 'pre', ...pre });

  const active = new Set();
  let templateIdx = 0;

  // KI 46 (NWT N19.102): auto-emergency-stop — 5 abort conditions, invoke rollback on trigger.
  let aborted = false;
  let abortReason = null;
  const consecutiveSampleFails = { count: 0 };
  const brokerDmLatencies = [];  // populated by abortHook if available
  async function checkAbort(s) {
    const conds = [];
    // 1. actor fail rate > 70%
    if (metrics.actors_spawned > 5 && metrics.actors_failed / metrics.actors_spawned > 0.7) {
      conds.push(`actor_fail_rate ${(metrics.actors_failed / metrics.actors_spawned * 100).toFixed(0)}%`);
    }
    // 2. K-pool drain > 1000 KAS early warning
    if (pre.k_pool != null && s.k_pool != null && (pre.k_pool - s.k_pool) > 1000) {
      conds.push(`k_pool_drain ${pre.k_pool - s.k_pool} KAS`);
    }
    // 3. hedge_skipped > 0 (circuit trip)
    if (pre.hedge_skipped != null && s.hedge_skipped > pre.hedge_skipped) {
      conds.push(`hedge_skipped +${s.hedge_skipped - pre.hedge_skipped}`);
    }
    // 4. Console crash (5 consecutive sample fail)
    if (consecutiveSampleFails.count >= 5) {
      conds.push(`5_consecutive_sample_fail (console_crash)`);
    }
    // 5. broker DM stuck (5 consecutive > 60s)
    if (brokerDmLatencies.length >= 5 && brokerDmLatencies.slice(-5).every(l => l > 60_000)) {
      conds.push(`broker_dm_stuck (5 cycles > 60s)`);
    }
    if (conds.length > 0) {
      aborted = true;
      abortReason = conds.join('; ');
      console.error(`[stress-harness] ABORT TRIGGER: ${abortReason}`);
      if (abortHook) try { await abortHook({ reason: abortReason, metrics }); } catch {}
    }
  }

  // Metric sampler (every 60s)
  const sampleTimer = setInterval(async () => {
    try {
      const s = collectMetrics(db, startIso);
      metrics.samples.push({ ts_iso: new Date().toISOString(), phase: 'sample', ...s });
      consecutiveSampleFails.count = 0;
      await checkAbort(s);
    } catch (err) {
      metrics.samples.push({ ts_iso: new Date().toISOString(), phase: 'sample_err', error: err.message });
      consecutiveSampleFails.count++;
    }
  }, 60_000);

  // Spawn loop
  while (Date.now() < deadline && !aborted) {
    if (active.size < max_concurrent) {
      const tmpl = actorTemplates[templateIdx % actorTemplates.length];
      templateIdx++;
      const actorId = `${tmpl.id}_${metrics.actors_spawned}`;
      metrics.actors_spawned++;
      const promise = (async () => {
        try {
          await tmpl.personaFn({ id: actorId }, tmpl.optsBuilder(metrics.actors_spawned));
          metrics.actors_completed++;
        } catch (err) {
          metrics.actors_failed++;
        } finally {
          active.delete(actorId);
        }
      })();
      active.add(actorId);
      // Detach — don't await, but track via active Set
    }
    await sleep(spawnIntervalMs);
  }

  clearInterval(sampleTimer);

  // Drain remaining actors with 30s wait
  const drainStart = Date.now();
  while (active.size > 0 && Date.now() - drainStart < 30_000) {
    await sleep(1000);
  }

  // Post-snapshot
  const post = collectMetrics(db, startIso);
  metrics.samples.push({ ts_iso: new Date().toISOString(), phase: 'post', ...post });
  metrics.final_pre_post_diff = {
    k_pool_delta: post.k_pool - pre.k_pool,
    hedge_placed_delta: post.hedge_placed - pre.hedge_placed,
    hedge_failed_delta: post.hedge_failed - pre.hedge_failed,
    hedge_skipped_delta: post.hedge_skipped - pre.hedge_skipped,
    offers_completed_delta: post.offers_completed - pre.offers_completed,
  };
  metrics.aborted = aborted;
  metrics.abort_reason = abortReason;
  db.close();

  return metrics;
}

function collectMetrics(db, sinceIso) {
  const m = {};
  // Broker K-pool (latest treasury_snapshot KAS row)
  const kRow = db.prepare(`SELECT balance_human FROM treasury_snapshot WHERE chain='kaspa' AND asset='KAS' ORDER BY id DESC LIMIT 1`).get();
  m.k_pool = kRow ? Number(kRow.balance_human) : null;
  // Broker BSC USDT
  const uRow = db.prepare(`SELECT balance_human FROM treasury_snapshot WHERE chain='bnb' AND asset='USDT' ORDER BY id DESC LIMIT 1`).get();
  m.usdt_pool_bsc = uRow ? Number(uRow.balance_human) : null;
  // Hedge lifetime (all-time, then subtract pre-snapshot for delta)
  m.hedge_placed = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_placed'`).get().c;
  m.hedge_failed = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_failed'`).get().c;
  m.hedge_skipped = db.prepare(`SELECT COUNT(*) c FROM chain_events WHERE event_type='hedge_skipped'`).get().c;
  // Offers since stress start
  m.offers_open = db.prepare(`SELECT COUNT(*) c FROM exchange_offers WHERE protocol_status='open' AND created_at > ?`).get(sinceIso).c;
  m.offers_completed = db.prepare(`SELECT COUNT(*) c FROM exchange_offers WHERE protocol_status='completed' AND created_at > ?`).get(sinceIso).c;
  return m;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
