#!/usr/bin/env node
// Phase 3g Sub 5 (A) — Auto-decision engine: sim auto-approve + per-event_type confidence_band 自动派 + real config-gate.
//
// Bettor r80 architect spec PASS + 3 决断 + 3 加:
//   - process 隔离 (新 script, 5min cron)
//   - v104 bettor_action_decisions audit 独立
//   - confidence_band 自动派 from event_calendar.event_type (final 95 / semi 85 / null 75)
//   - quality check 3 band (high → auto / mid → small delta only / low → keep pending)
//   - real path graceful degrade (B-1 sub 6 前 SKIP)
//   - 一次性 backfill 历史 recommendations.confidence_band (启动时一次)

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const kasiaRequire = createRequire(`${KANET_ROOT}/kasia-console/`);
const Database = kasiaRequire('better-sqlite3');
const DB_PATH = `${KANET_ROOT}/kasia-console/data/console.db`;
const LOG_FILE = `${KANET_ROOT}/logs/bettor-auto-decider.log`;
const CONSOLE_URL = 'http://127.0.0.1:3100';
const TICK_MS = 5 * 60_000;  // 5min

// Confidence band auto-派 by event_type
const EVENT_TYPE_TO_BAND = {
  'final': 'high_threshold',         // 95% confidence 严档 (Eurovision-like noise market)
  'semifinal': 'mid_threshold',       // 85% 中档
  'staging': 'mid_threshold',
  'jury_show': 'mid_threshold',
  'running_order': 'mid_threshold',
};

const MID_DELTA_THRESHOLD = 0.30;  // 30% size delta cap for 'mid' band auto-approve

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) {
  const line = `[${ts()}] ${msg}`;
  process.stdout.write(line + '\n');
  try { writeFileSync(LOG_FILE, line + '\n', { flag: 'a' }); } catch {}
}

// ── one-time backfill historical confidence_band (启动时一次) ───────────────────

function backfillConfidenceBand(db) {
  // For recommendations 老 row (Phase 3f-1 前) 的 confidence_band IS NULL, 自动派 by event_type.
  // 不动 scanner (production code), 留 A-2 / Phase 3h 改写入路径.
  const stmt = db.prepare(`
    UPDATE bettor_recommendations
    SET calibrator_confidence = COALESCE(
      calibrator_confidence,
      CASE
        WHEN EXISTS (SELECT 1 FROM event_calendar ec WHERE ec.market_id = bettor_recommendations.market_id AND ec.event_type = 'final') THEN 'low'
        WHEN EXISTS (SELECT 1 FROM event_calendar ec WHERE ec.market_id = bettor_recommendations.market_id) THEN 'mid'
        ELSE 'mid'
      END
    )
    WHERE calibrator_confidence IS NULL
  `);
  const r = stmt.run();
  if (r.changes > 0) log(`backfill historical confidence_band: ${r.changes} rows updated`);
}

// ── quality check (r80 architect 加 2) ─────────────────────────────────────────

function autoApproveQuality(adj, currentSize) {
  // band = adj.calibrator_confidence (JOIN recommendation), severity = adj.severity
  if (adj.severity === 'critical') {
    return { auto: true, reason: 'critical severity → auto-approve' };
  }
  const band = adj.calibrator_confidence || 'mid';
  if (band === 'high') {
    return { auto: true, reason: 'high confidence → auto-approve' };
  }
  if (band === 'mid') {
    // Only auto-approve if size delta < MID_DELTA_THRESHOLD
    const delta = currentSize > 0 ? Math.abs((adj.target_size || 0) - currentSize) / currentSize : 0;
    if (delta < MID_DELTA_THRESHOLD) return { auto: true, reason: `mid + delta ${(delta * 100).toFixed(1)}% < 30%` };
    return { auto: false, reason: `mid + delta ${(delta * 100).toFixed(1)}% ≥ 30% — keep pending` };
  }
  // band === 'low' → keep pending (高 gap 高不确定)
  return { auto: false, reason: 'low confidence (gap > 30pp) — keep pending for Owner review' };
}

// ── real path graceful degrade (B-1 sub 6 前 SKIP) ─────────────────────────────

function decideRealPath(db, adj) {
  try {
    const cfg = db.prepare('SELECT * FROM bettor_real_config WHERE id = 1').get();
    if (!cfg) return { action: 'skip', reason: 'bettor_real_config row missing (B-1 not seeded)' };
    if (cfg.kill_switch_enabled) return { action: 'skip', reason: 'kill_switch_enabled=1 hard stop' };
    if (!cfg.enabled) return { action: 'skip', reason: 'enabled=0 (default OFF until Owner flip)' };
    // 6 gate check 简化 placeholder — B-1 sub 6 完整实现
    return { action: 'skip', reason: 'real path B-1 sub 6 完整逻辑待 ship' };
  } catch (e) {
    return { action: 'skip', reason: `B-1 not shipped: ${e.message?.slice(0, 50)}` };
  }
}

// ── auto-decide pending adjustments ─────────────────────────────────────────────

async function decideAdjustments(db) {
  const pending = db.prepare(`
    SELECT a.id, a.position_id, a.recommendation_id, a.adj_type, a.severity, a.trigger_reason,
           p.size_usd AS current_size,
           r.calibrator_confidence
    FROM bettor_adjustments a
    JOIN bettor_sim_positions p ON p.id = a.position_id
    JOIN bettor_recommendations r ON r.id = a.recommendation_id
    WHERE a.status = 'pending'
    ORDER BY a.created_at ASC
    LIMIT 50
  `).all();
  if (pending.length === 0) return { sim: 0, real: 0 };

  let simApproved = 0, simSkipped = 0, realSkipped = 0;

  for (const adj of pending) {
    // sim decision
    const sim = autoApproveQuality(adj, adj.current_size);
    if (sim.auto) {
      try {
        const res = await fetch(`${CONSOLE_URL}/api/bettor/adjustments/${adj.id}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'approve', decided_by: 'bettor-auto-decider' }),
        });
        if (res.ok) {
          simApproved++;
          db.prepare(`INSERT INTO bettor_action_decisions (decided_for_type, decided_for_id, action, reason, mode, confidence_band) VALUES (?, ?, ?, ?, ?, ?)`)
            .run('adjustment', adj.id, 'approve', sim.reason, 'sim', adj.calibrator_confidence);
        } else { log(`sim approve HTTP ${res.status} for ${adj.id.slice(0, 8)}`); }
      } catch (e) { log(`sim approve ERR ${adj.id.slice(0, 8)}: ${e.message?.slice(0, 60)}`); }
    } else {
      simSkipped++;
      db.prepare(`INSERT INTO bettor_action_decisions (decided_for_type, decided_for_id, action, reason, mode, confidence_band) VALUES (?, ?, ?, ?, ?, ?)`)
        .run('adjustment', adj.id, 'skip', sim.reason, 'sim', adj.calibrator_confidence);
    }

    // real decision (graceful degrade until B-1 ship)
    const real = decideRealPath(db, adj);
    if (real.action === 'skip') {
      realSkipped++;
      // Only log first 3 real-skips per tick to avoid noise (B-1 ship 前每 adj 都 skip)
      if (realSkipped <= 3) log(`[real] SKIP ${adj.id.slice(0, 8)}: ${real.reason}`);
    }
  }

  log(`tick decisions: sim approved=${simApproved} skipped=${simSkipped} | real skipped=${realSkipped}/${pending.length}`);
  return { sim: simApproved, real: 0 };
}

// ── main loop ───────────────────────────────────────────────────────────────────

async function tick() {
  const db = new Database(DB_PATH);
  try { await decideAdjustments(db); } catch (e) { log(`tick ERR: ${e.message?.slice(0, 80)}`); }
  finally { db.close(); }
}

// Startup: one-time backfill + first tick
const startupDb = new Database(DB_PATH);
try { backfillConfidenceBand(startupDb); } finally { startupDb.close(); }
log(`Phase 3g A bettor-auto-decider starting · cron ${TICK_MS / 60_000}min · sim auto / real B-1 graceful degrade`);
await tick();
setInterval(async () => { try { await tick(); } catch (e) { log(`outer tick err: ${e.message?.slice(0, 80)}`); } }, TICK_MS);
