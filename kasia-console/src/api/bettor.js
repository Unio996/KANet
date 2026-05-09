import { sqlite } from '../db/client.js';
import { runScan, isScanRunning } from '../services/bettor-scanner.js';
import { resolveExpired, isResolverRunning } from '../services/bettor-resolver.js';
import { snapshotOpenPositions, isTrackerRunning } from '../services/bettor-position-tracker.js';

export async function registerBettorRoutes(fastify) {
  // GET /api/bettor/recommendations — top N most-recent batch (optional filter by relay_node_id)
  fastify.get('/api/bettor/recommendations', async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit) || 10, 50);
    const relayNodeId = request.query.relay_node_id || null;

    // Find latest scan timestamp (per agent if given, else global latest)
    const latest = relayNodeId
      ? sqlite.prepare(`SELECT scanned_at FROM bettor_recommendations WHERE relay_node_id = ? ORDER BY scanned_at DESC LIMIT 1`).get(relayNodeId)
      : sqlite.prepare(`SELECT scanned_at FROM bettor_recommendations ORDER BY scanned_at DESC LIMIT 1`).get();

    if (!latest) return reply.send({ ok: true, scanned_at: null, recommendations: [] });

    const rows = relayNodeId
      ? sqlite.prepare(`
          SELECT id, relay_node_id, market_id, condition_id, slug, question,
                 decision, fraction, size_usd, edge, p_mid, sigma, info_gap_months,
                 yes_price, volume_24h, liquidity, end_date, score,
                 reasoning_json, trigger_type, llm_tier, status, scanned_at
          FROM bettor_recommendations
          WHERE scanned_at = ? AND relay_node_id = ?
          ORDER BY score DESC LIMIT ?
        `).all(latest.scanned_at, relayNodeId, limit)
      : sqlite.prepare(`
          SELECT id, relay_node_id, market_id, condition_id, slug, question,
                 decision, fraction, size_usd, edge, p_mid, sigma, info_gap_months,
                 yes_price, volume_24h, liquidity, end_date, score,
                 reasoning_json, trigger_type, llm_tier, status, scanned_at
          FROM bettor_recommendations
          WHERE scanned_at = ?
          ORDER BY score DESC LIMIT ?
        `).all(latest.scanned_at, limit);

    const recs = rows.map(r => ({
      ...r,
      reasoning: r.reasoning_json ? JSON.parse(r.reasoning_json) : null,
      reasoning_json: undefined,
    }));

    return reply.send({
      ok: true,
      scanned_at: latest.scanned_at,
      count: recs.length,
      recommendations: recs,
    });
  });

  // POST /api/bettor/scan — manual trigger (for testing + spike triggers)
  // Body: { trigger_type, relay_node_id }  — relay_node_id determines whose adapter is used
  fastify.post('/api/bettor/scan', async (request, reply) => {
    const trigger = request.body?.trigger_type || 'manual';
    const relayNodeId = request.body?.relay_node_id || null;
    if (isScanRunning()) {
      return reply.code(409).send({ ok: false, reason: 'scan already in progress' });
    }
    runScan(trigger, relayNodeId).catch(err => console.log(`[api/bettor] scan error: ${err.message}`));
    return reply.send({ ok: true, message: 'scan started', trigger, relay_node_id: relayNodeId });
  });

  // GET /api/bettor/scan/status
  fastify.get('/api/bettor/scan/status', async (_request, reply) => {
    return reply.send({ running: isScanRunning() });
  });

  // GET /api/bettor/track-record — 战绩 (per-agent or global)
  fastify.get('/api/bettor/track-record', async (request, reply) => {
    const relayNodeId = request.query.relay_node_id || null;
    const where = relayNodeId ? 'WHERE relay_node_id = ?' : '';
    const args = relayNodeId ? [relayNodeId] : [];

    const stats = sqlite.prepare(`
      SELECT
        COUNT(*) total,
        SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) resolved,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending,
        SUM(CASE WHEN status='unresolvable' THEN 1 ELSE 0 END) unresolvable,
        SUM(CASE WHEN was_correct=1 THEN 1 ELSE 0 END) hits,
        SUM(CASE WHEN was_correct=0 THEN 1 ELSE 0 END) misses,
        SUM(CASE WHEN was_correct=1 AND decision != 'SKIP' THEN 1 ELSE 0 END) actionable_hits,
        SUM(CASE WHEN was_correct=0 AND decision != 'SKIP' THEN 1 ELSE 0 END) actionable_misses,
        AVG(CASE WHEN was_correct IS NOT NULL THEN brier END) mean_brier,
        SUM(CASE WHEN pnl_hypothetical IS NOT NULL THEN pnl_hypothetical ELSE 0 END) total_pnl_hypothetical
      FROM bettor_recommendations ${where}
    `).get(...args);

    const hitRate = stats.resolved > 0 ? stats.hits / stats.resolved : null;
    const actionableTotal = stats.actionable_hits + stats.actionable_misses;
    const actionableHitRate = actionableTotal > 0 ? stats.actionable_hits / actionableTotal : null;

    const recent = sqlite.prepare(`
      SELECT id, market_id, slug, condition_id, question, decision, p_mid, sigma, yes_price,
             size_usd, fraction, edge, outcome, was_correct, brier, pnl_hypothetical,
             end_date, scanned_at, outcome_resolved_at
      FROM bettor_recommendations
      ${where} ${relayNodeId ? 'AND' : 'WHERE'} status='resolved'
      ORDER BY outcome_resolved_at DESC LIMIT 20
    `).all(...args);

    return reply.send({
      ok: true,
      stats: { ...stats, hit_rate: hitRate, actionable_hit_rate: actionableHitRate },
      recent,
    });
  });

  // POST /api/bettor/resolve-now — 手动触发战绩结算 (一般 1h cron 自动)
  fastify.post('/api/bettor/resolve-now', async (_request, reply) => {
    if (isResolverRunning()) {
      return reply.code(409).send({ ok: false, reason: 'resolver already running' });
    }
    resolveExpired().catch(err => console.log(`[api/bettor] resolve error: ${err.message}`));
    return reply.send({ ok: true, message: 'resolver started' });
  });

  // GET /api/bettor/positions — 纸面持仓 + 时点快照
  fastify.get('/api/bettor/positions', async (request, reply) => {
    const relayNodeId = request.query.relay_node_id || null;
    const onlyOpen = request.query.open === '1' || request.query.open === 'true';
    const limit = Math.min(parseInt(request.query.limit) || 50, 200);

    let where = ['1=1'];
    const args = [];
    if (relayNodeId) { where.push('p.relay_node_id = ?'); args.push(relayNodeId); }
    if (onlyOpen) where.push('p.closed_at IS NULL');

    const positions = sqlite.prepare(`
      SELECT p.id, p.recommendation_id, p.relay_node_id, p.direction,
             p.entry_yes_price, p.entry_buy_price, p.size_usd, p.shares,
             p.opened_at, p.closed_at, p.close_reason, p.realized_pnl,
             p.max_drawdown_pp, p.max_unrealized_gain_pp, p.last_snapshot_at,
             r.question, r.market_id, r.condition_id, r.slug, r.end_date,
             r.p_mid, r.sigma, r.edge, r.outcome, r.was_correct
      FROM bettor_sim_positions p
      JOIN bettor_recommendations r ON r.id = p.recommendation_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.opened_at DESC LIMIT ?
    `).all(...args, limit);

    // Attach last 30 snapshots per position (for trajectory chart)
    const snapStmt = sqlite.prepare(`
      SELECT snapshot_at, current_yes_price, current_buy_price, unrealized_pnl, drift_pp
      FROM bettor_sim_snapshots
      WHERE position_id = ?
      ORDER BY snapshot_at DESC LIMIT 30
    `);
    for (const p of positions) {
      p.snapshots = snapStmt.all(p.id).reverse(); // chronological
    }

    return reply.send({ ok: true, count: positions.length, positions });
  });

  // POST /api/bettor/snapshot-now — 手动触发持仓快照
  fastify.post('/api/bettor/snapshot-now', async (_request, reply) => {
    if (isTrackerRunning()) {
      return reply.code(409).send({ ok: false, reason: 'tracker already running' });
    }
    snapshotOpenPositions().catch(err => console.log(`[api/bettor] snapshot error: ${err.message}`));
    return reply.send({ ok: true, message: 'tracker started' });
  });
}
