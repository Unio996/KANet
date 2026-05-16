import { sqlite } from '../db/client.js';
import { runScan, isScanRunning } from '../services/bettor-scanner.js';
import { runScavengerScan, isScavengerRunning } from '../services/bettor-scavenger.js';
import { resolveExpired, isResolverRunning } from '../services/bettor-resolver.js';
import { snapshotOpenPositions, isTrackerRunning } from '../services/bettor-position-tracker.js';
import { evaluatePositions, isReactorRunning } from '../services/bettor-reactor.js';

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
                 reasoning_json, trigger_type, llm_tier, status, scanned_at,
                 fundamental_estimate, fundamental_sources, fundamental_confidence
          FROM bettor_recommendations
          WHERE scanned_at = ? AND relay_node_id = ?
          ORDER BY score DESC LIMIT ?
        `).all(latest.scanned_at, relayNodeId, limit)
      : sqlite.prepare(`
          SELECT id, relay_node_id, market_id, condition_id, slug, question,
                 decision, fraction, size_usd, edge, p_mid, sigma, info_gap_months,
                 yes_price, volume_24h, liquidity, end_date, score,
                 reasoning_json, trigger_type, llm_tier, status, scanned_at,
                 fundamental_estimate, fundamental_sources, fundamental_confidence
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
    return reply.send({ running: isScanRunning(), scavenger_running: isScavengerRunning() });
  });

  // POST /api/bettor/scavenger/scan — Owner 5/14 pivot, 新 scavenger algo (rules+trajectory+流动性)
  fastify.post('/api/bettor/scavenger/scan', async (request, reply) => {
    const trigger = request.body?.trigger_type || 'manual';
    const relayNodeId = request.body?.relay_node_id || null;
    if (isScavengerRunning()) {
      return reply.code(409).send({ ok: false, reason: 'scavenger scan already in progress' });
    }
    const result = await runScavengerScan(trigger, relayNodeId);
    return reply.send(result);
  });

  // POST /api/bettor/recommendation/:id/accept — 一键下单
  // 拿 recommendation row → fetch market clobTokenIds → call /api/predictions/order
  // Owner 5/14 钦定: 人工 final gate → ACCEPT 走 J2 wallet 自动下单
  fastify.post('/api/bettor/recommendation/:id/accept', async (request, reply) => {
    const recId = request.params.id;
    const overrideSize = request.body?.size ? parseFloat(request.body.size) : null;
    const overridePrice = request.body?.price ? parseFloat(request.body.price) : null;

    const rec = sqlite.prepare(`
      SELECT id, relay_node_id, condition_id, slug, question, decision,
             size_usd, yes_price, end_date, status
      FROM bettor_recommendations WHERE id = ?
    `).get(recId);
    if (!rec) return reply.code(404).send({ ok: false, error: 'recommendation not found' });
    if (rec.status !== 'pending') return reply.code(409).send({ ok: false, error: `recommendation status=${rec.status}, not pending` });
    if (!rec.condition_id) return reply.code(400).send({ ok: false, error: 'recommendation missing condition_id' });
    if (rec.decision !== 'YES' && rec.decision !== 'NO') return reply.code(400).send({ ok: false, error: `decision=${rec.decision} not tradeable` });

    // Fetch clobTokenIds from gamma
    let market;
    try {
      const https = await import('node:https');
      market = await new Promise((resolve, rej) => {
        https.default.get(`https://gamma-api.polymarket.com/markets?condition_ids=${rec.condition_id}`, (res) => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)[0]); } catch (e) { rej(e); } });
        }).on('error', rej);
      });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: `gamma fetch failed: ${e.message}` });
    }
    if (!market?.clobTokenIds) return reply.code(500).send({ ok: false, error: 'market missing clobTokenIds' });

    let tokens;
    try { tokens = JSON.parse(market.clobTokenIds); } catch { return reply.code(500).send({ ok: false, error: 'clobTokenIds parse failed' }); }
    const yesTokenId = tokens[0];
    const noTokenId = tokens[1];
    if (!yesTokenId || !noTokenId) return reply.code(500).send({ ok: false, error: 'missing yes/no token id' });
    const tokenId = rec.decision === 'YES' ? yesTokenId : noTokenId;

    // Current yes price → derive entry price (slight slip allowance)
    const yesPriceLive = parseFloat(JSON.parse(market.outcomePrices || '[]')[0] || rec.yes_price);
    const baseAsk = rec.decision === 'YES' ? yesPriceLive : (1 - yesPriceLive);
    const entryPrice = overridePrice || Math.min(0.995, baseAsk + 0.005);

    // Auto-cap size to available wallet balance (Owner-mandated bug fix 5/14)
    let sizeUsd = overrideSize || rec.size_usd;
    try {
      const statusRes = await fetch(`http://127.0.0.1:${process.env.CONSOLE_PORT || 3100}/api/polymarket/${rec.relay_node_id}/status`);
      const status = await statusRes.json();
      const availablePusd = Number(status.pusd) || 0;
      // Leave $1 buffer for rounding
      const maxAffordable = Math.max(0, availablePusd - 1);
      if (sizeUsd > maxAffordable) {
        console.log(`[bettor/accept] size cap: requested $${sizeUsd} > available $${availablePusd.toFixed(2)}, capping to $${maxAffordable.toFixed(2)}`);
        sizeUsd = maxAffordable;
      }
    } catch (e) {
      console.log(`[bettor/accept] balance check failed: ${e.message}, proceeding with requested size`);
    }

    const sizeShares = Math.floor(sizeUsd / entryPrice);
    if (sizeShares < 1) return reply.code(400).send({ ok: false, error: `size too small after balance cap: ${sizeShares} shares (available $${sizeUsd.toFixed(2)})` });

    // Call /api/predictions/order internally
    const orderRes = await fetch(`http://127.0.0.1:${process.env.CONSOLE_PORT || 3100}/api/predictions/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        relay_node_id: rec.relay_node_id,
        tokenId,
        side: 'BUY',
        price: entryPrice,
        size: sizeShares,
      }),
    });
    const orderData = await orderRes.json();

    // Mark rec as accepted/filled/failed
    if (orderData.ok || orderData.success) {
      sqlite.prepare(`UPDATE bettor_recommendations SET status='accepted' WHERE id=?`).run(recId);
      return reply.send({
        ok: true,
        recommendation_id: recId,
        order: orderData,
        cost_basis_usd: (sizeShares * entryPrice).toFixed(2),
        entry_price: entryPrice,
        size_shares: sizeShares,
      });
    } else {
      return reply.code(500).send({ ok: false, error: orderData.error || 'order failed', order: orderData });
    }
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

  // GET /api/bettor/history — 全部历史推荐 + sim_position drift + latest snapshot
  // Owner 5/10 钦定: 没历史的智能体没意义. 默认返全部 (不限批次), 按 opened_at 倒序.
  fastify.get('/api/bettor/history', async (request, reply) => {
    const relayNodeId = request.query.relay_node_id || null;
    const limit = Math.min(parseInt(request.query.limit) || 100, 500);

    let where = ['1=1'];
    const args = [];
    if (relayNodeId) { where.push('p.relay_node_id = ?'); args.push(relayNodeId); }

    const rows = sqlite.prepare(`
      SELECT
        p.id position_id, p.recommendation_id, p.relay_node_id, p.direction,
        p.entry_yes_price, p.entry_buy_price, p.size_usd, p.shares,
        p.opened_at, p.closed_at, p.close_reason, p.realized_pnl,
        p.max_drawdown_pp, p.max_unrealized_gain_pp, p.last_snapshot_at,
        r.market_id, r.condition_id, r.slug, r.question,
        r.p_mid, r.sigma, r.edge, r.info_gap_months,
        r.volume_24h, r.liquidity, r.end_date, r.score, r.trigger_type, r.llm_tier,
        r.outcome, r.was_correct, r.brier, r.pnl_hypothetical, r.status, r.scanned_at
      FROM bettor_sim_positions p
      JOIN bettor_recommendations r ON r.id = p.recommendation_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.opened_at DESC
      LIMIT ?
    `).all(...args, limit);

    // Attach latest snapshot per position (1 row, drift now)
    const snapStmt = sqlite.prepare(`
      SELECT snapshot_at, current_yes_price, current_buy_price, unrealized_pnl, drift_pp
      FROM bettor_sim_snapshots WHERE position_id = ?
      ORDER BY snapshot_at DESC LIMIT 1
    `);
    for (const r of rows) {
      r.latest_snapshot = snapStmt.get(r.position_id) || null;
    }

    // Aggregate by batch (scanned_at) for top-line summary
    const batches = {};
    for (const r of rows) {
      const key = r.scanned_at;
      if (!batches[key]) batches[key] = { scanned_at: key, n: 0, n_resolved: 0, n_open: 0, total_unrealized_pnl: 0, total_realized_pnl: 0 };
      batches[key].n++;
      if (r.closed_at) batches[key].n_resolved++;
      else batches[key].n_open++;
      if (r.realized_pnl != null) batches[key].total_realized_pnl += r.realized_pnl;
      if (r.latest_snapshot && r.latest_snapshot.unrealized_pnl != null) batches[key].total_unrealized_pnl += r.latest_snapshot.unrealized_pnl;
    }
    const batchSummary = Object.values(batches).sort((a, b) => b.scanned_at.localeCompare(a.scanned_at));

    return reply.send({
      ok: true,
      total: rows.length,
      batches: batchSummary,
      positions: rows,
    });
  });

  // Module 4 (Owner 5/15 推荐历史 + 胜率轨迹): per-market price history + recommendations + outcome.
  // GET /api/bettor/history-chart?market_id=X[&condition_id=Y][&limit=500]
  fastify.get('/api/bettor/history-chart', async (request, reply) => {
    const marketId = request.query.market_id || null;
    const conditionId = request.query.condition_id || null;
    const limit = Math.min(parseInt(request.query.limit) || 500, 2000);
    if (!marketId && !conditionId) return reply.code(400).send({ error: 'market_id OR condition_id required' });
    const where = marketId ? 'market_id = ?' : 'condition_id = ?';
    const arg = marketId || conditionId;

    const priceSeries = sqlite.prepare(`
      SELECT yes_price, no_price, volume_24h, liquidity, source, snapshot_at
      FROM bettor_market_price_history WHERE ${where} ORDER BY snapshot_at ASC LIMIT ?
    `).all(arg, limit);

    const recs = sqlite.prepare(`
      SELECT id, decision, fraction, size_usd, edge, p_mid, yes_price, score,
             trigger_type, llm_tier, status, scanned_at,
             fundamental_estimate, fundamental_confidence, outcome, was_correct, brier, pnl_hypothetical
      FROM bettor_recommendations WHERE ${where} ORDER BY scanned_at ASC
    `).all(arg);

    const outcomeRow = sqlite.prepare(`
      SELECT actual_outcome, recommended_outcome, was_correct, actual_pnl_usd, predicted_pnl_usd, resolved_at, close_price
      FROM bettor_outcome_log WHERE ${where} ORDER BY resolved_at DESC LIMIT 1
    `).get(arg);

    // Resolve question text from latest rec OR price_history join
    const meta = sqlite.prepare(`
      SELECT question, slug, condition_id, market_id FROM bettor_recommendations WHERE ${where} ORDER BY scanned_at DESC LIMIT 1
    `).get(arg);

    return reply.send({
      ok: true,
      market_id: meta?.market_id || marketId,
      condition_id: meta?.condition_id || conditionId,
      question: meta?.question || null,
      slug: meta?.slug || null,
      price_series: priceSeries,
      recommendations: recs,
      outcome: outcomeRow || null,
    });
  });

  // GET /api/bettor/hit-rate-timeline[?days=30][&relay_node_id=X]
  fastify.get('/api/bettor/hit-rate-timeline', async (request, reply) => {
    const days = Math.min(parseInt(request.query.days) || 30, 365);
    const relayNodeId = request.query.relay_node_id || null;
    const relayClause = relayNodeId ? `AND r.relay_node_id = ?` : '';
    const args = relayNodeId ? [days, relayNodeId] : [days];

    const daily = sqlite.prepare(`
      SELECT date(o.resolved_at) AS date,
             COUNT(*) AS total,
             SUM(o.was_correct) AS correct,
             SUM(o.actual_pnl_usd) AS pnl
      FROM bettor_outcome_log o
      LEFT JOIN bettor_recommendations r ON r.id = o.recommendation_id
      WHERE o.resolved_at >= datetime('now', '-' || ? || ' days') ${relayClause}
      GROUP BY date(o.resolved_at)
      ORDER BY date(o.resolved_at) ASC
    `).all(...args);

    const dailyWithRate = daily.map(d => ({
      ...d,
      hit_rate: d.total > 0 ? d.correct / d.total : null,
    }));

    // Cumulative
    let cumCorrect = 0, cumTotal = 0, cumPnl = 0;
    const cumulative = dailyWithRate.map(d => {
      cumCorrect += d.correct || 0;
      cumTotal += d.total || 0;
      cumPnl += d.pnl || 0;
      return {
        date: d.date,
        cum_total: cumTotal,
        cum_correct: cumCorrect,
        cum_hit_rate: cumTotal > 0 ? cumCorrect / cumTotal : null,
        cum_pnl: cumPnl,
      };
    });

    return reply.send({ ok: true, days, daily: dailyWithRate, cumulative });
  });

  // Phase B 持仓自动保护 (Owner 5/16 钦定 "你们先搞" + Bettor r139 architect spec) — Phase 1 CRUD endpoints.
  // Phase 3 will add /ack endpoint with HMAC token derivation. Phase 2 wires UI consumption.

  // GET /api/bettor/position-protect/rules?relay_node_id=X[&status=Y]
  fastify.get('/api/bettor/position-protect/rules', async (request, reply) => {
    const relayNodeId = request.query.relay_node_id || null;
    const status = request.query.status || null;
    const where = []; const args = [];
    if (relayNodeId) { where.push('relay_node_id = ?'); args.push(relayNodeId); }
    if (status) { where.push('status = ?'); args.push(status); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = sqlite.prepare(`SELECT * FROM position_protect_rules ${whereClause} ORDER BY created_at DESC LIMIT 500`).all(...args);
    return reply.send({ ok: true, count: rows.length, rules: rows });
  });

  // PUT /api/bettor/position-protect/rules/:id { stop_loss_pct?, cooldown_hours?, take_profit_price?, time_close_days? }
  // Owner UI 改 rule 阈值 — Phase 2 will surface this in /predictions sub-tab.
  fastify.put('/api/bettor/position-protect/rules/:id', async (request, reply) => {
    const { id } = request.params;
    const { stop_loss_pct, cooldown_hours, take_profit_price, time_close_days, time_drift_threshold_pp } = request.body || {};
    const updates = []; const args = [];
    if (stop_loss_pct != null) { updates.push('stop_loss_pct = ?'); args.push(stop_loss_pct); }
    if (cooldown_hours != null) { updates.push('cooldown_hours = ?'); args.push(cooldown_hours); }
    if (take_profit_price != null) { updates.push('take_profit_price = ?'); args.push(take_profit_price); }
    if (time_close_days != null) { updates.push('time_close_days = ?'); args.push(time_close_days); }
    if (time_drift_threshold_pp != null) { updates.push('time_drift_threshold_pp = ?'); args.push(time_drift_threshold_pp); }
    if (!updates.length) return reply.code(400).send({ error: 'no fields to update' });
    args.push(id);
    const info = sqlite.prepare(`UPDATE position_protect_rules SET ${updates.join(', ')} WHERE id = ?`).run(...args);
    return reply.send({ ok: true, changes: info.changes });
  });

  // DELETE /api/bettor/position-protect/rules/:id — manual 删 rule (Owner UI 删除按钮)
  fastify.delete('/api/bettor/position-protect/rules/:id', async (request, reply) => {
    const { id } = request.params;
    const info = sqlite.prepare(`DELETE FROM position_protect_rules WHERE id = ?`).run(id);
    return reply.send({ ok: true, changes: info.changes });
  });

  // GET /api/bettor/position-protect/audit?rule_id=X[&limit=50]
  fastify.get('/api/bettor/position-protect/audit', async (request, reply) => {
    const ruleId = request.query.rule_id;
    if (!ruleId) return reply.code(400).send({ error: 'rule_id required' });
    const limit = Math.min(parseInt(request.query.limit) || 50, 500);
    const rows = sqlite.prepare(`SELECT * FROM position_protect_audit WHERE rule_id = ? ORDER BY check_at DESC LIMIT ?`).all(ruleId, limit);
    return reply.send({ ok: true, count: rows.length, audit: rows });
  });

  // GET /api/bettor/variant-recommendations?parent_rec_id=X[&relay_node_id=Y]
  // Phase B Variant Expander (Owner 5/16 钦定 "B" + Bettor r141 spec) — list 3 档变种 per parent rec.
  fastify.get('/api/bettor/variant-recommendations', async (request, reply) => {
    const parentRecId = request.query.parent_rec_id || null;
    const relayNodeId = request.query.relay_node_id || null;
    if (parentRecId) {
      const rows = sqlite.prepare(`SELECT * FROM bettor_variant_recommendations WHERE parent_rec_id = ? ORDER BY strategy_tier`).all(parentRecId);
      return reply.send({ ok: true, count: rows.length, variants: rows });
    }
    // Without parent_rec_id, list latest variants joined with parent
    const relayClause = relayNodeId ? 'AND r.relay_node_id = ?' : '';
    const args = relayNodeId ? [relayNodeId] : [];
    const rows = sqlite.prepare(`
      SELECT v.*, r.question AS parent_question, r.yes_price AS parent_yes_price, r.decision AS parent_decision, r.scanned_at AS parent_scanned_at
      FROM bettor_variant_recommendations v
      LEFT JOIN bettor_recommendations r ON r.id = v.parent_rec_id
      WHERE r.scanned_at > datetime('now', '-7 days') ${relayClause}
      ORDER BY v.created_at DESC, v.strategy_tier LIMIT 200
    `).all(...args);
    return reply.send({ ok: true, count: rows.length, variants: rows });
  });

  // POST /api/bettor/position-protect/rules/:id/ack — Owner UI ACK rule (status pending_owner_ack → active)
  // 派 HMAC token containing max_price + max_size bounds (Phase 3 daemon firing will verify token in
  // /api/predictions/order header X-Owner-Ack). Token signed with CONSOLE_ENCRYPTION_KEY-derived secret.
  // Per Bettor r139 §4 spec: "daemon 不需 Owner 当场 ack — 规则 ack 时已派生 token 覆盖未来 action".
  fastify.post('/api/bettor/position-protect/rules/:id/ack', async (request, reply) => {
    const { id } = request.params;
    const { max_price_override, max_size_override } = request.body || {};
    const rule = sqlite.prepare(`SELECT * FROM position_protect_rules WHERE id = ?`).get(id);
    if (!rule) return reply.code(404).send({ error: 'rule not found' });
    if (rule.status !== 'pending_owner_ack') {
      return reply.code(400).send({ error: `rule status is '${rule.status}', not 'pending_owner_ack'` });
    }
    // Derive HMAC token: payload = {rule_id, relay_node_id, token_id, max_price, max_size, issued_at}.
    // Phase 3 daemon includes token in fire request; /api/predictions/order verifies HMAC + bounds.
    const crypto = await import('node:crypto');
    const secret = process.env.CONSOLE_ENCRYPTION_KEY || 'fallback-no-env-warn';
    const tokenPayload = {
      rule_id: rule.id,
      relay_node_id: rule.relay_node_id,
      token_id: rule.token_id,
      max_price: max_price_override ?? Math.min(0.999, rule.entry_avg_price * 1.5),  // max 150% entry as cap
      max_size: max_size_override ?? rule.current_size,
      issued_at: new Date().toISOString(),
    };
    const tokenJson = JSON.stringify(tokenPayload);
    const signature = crypto.createHmac('sha256', secret).update(tokenJson).digest('hex');
    const token = Buffer.from(tokenJson).toString('base64') + '.' + signature;

    sqlite.prepare(`
      UPDATE position_protect_rules
      SET status = 'active', owner_ack_token = ?, owner_ack_at = datetime('now')
      WHERE id = ?
    `).run(token, id);
    return reply.send({ ok: true, id, status: 'active', token_payload: tokenPayload });
  });

  // GET /api/bettor/recommendations/history?days=30&relay_node_id=X&limit=200
  // Bettor r132 (Owner 5/15 严训 "推荐 history 没保存") + J1 #206 ack: data IS saved in
  // bettor_recommendations (173 rows on Bettor host, similar on J1), Owner saw 战绩 tab
  // showing 0 outcome_log rows (legitimate UMA oracle delay 24-48h post deadline) and
  // assumed not saved. Real gap = no UI tab to browse raw rec rows. This endpoint backs
  // /predictions "推荐历史" sub-tab — flat table of all recs with outcome join (left, null
  // for pending).
  fastify.get('/api/bettor/recommendations/history', async (request, reply) => {
    const days = Math.min(parseInt(request.query.days) || 30, 365);
    const relayNodeId = request.query.relay_node_id || null;
    const limit = Math.min(parseInt(request.query.limit) || 200, 1000);
    const relayClause = relayNodeId ? `AND r.relay_node_id = ?` : '';
    const args = relayNodeId ? [days, relayNodeId, limit] : [days, limit];

    const rows = sqlite.prepare(`
      SELECT r.id, r.relay_node_id, r.market_id, r.condition_id, r.question,
             r.decision, r.fraction, r.size_usd, r.edge, r.p_mid,
             r.yes_price, r.volume_24h, r.liquidity, r.end_date, r.score,
             r.trigger_type, r.llm_tier, r.status, r.scanned_at,
             r.fundamental_estimate, r.fundamental_confidence,
             r.outcome AS rec_outcome, r.was_correct AS rec_was_correct,
             r.pnl_hypothetical AS rec_pnl,
             r.reasoning_json,
             o.actual_outcome AS outcome_actual, o.was_correct AS outcome_was_correct,
             o.actual_pnl_usd AS outcome_pnl, o.resolved_at AS outcome_resolved_at
      FROM bettor_recommendations r
      LEFT JOIN bettor_outcome_log o ON o.recommendation_id = r.id
      WHERE r.scanned_at >= datetime('now', '-' || ? || ' days') ${relayClause}
      ORDER BY r.scanned_at DESC
      LIMIT ?
    `).all(...args);

    const recs = rows.map(r => {
      let fundSource = null;
      try {
        const reasoning = r.reasoning_json ? JSON.parse(r.reasoning_json) : null;
        fundSource = reasoning?.fund_source || null;
      } catch {}
      return {
        id: r.id, relay_node_id: r.relay_node_id, market_id: r.market_id, condition_id: r.condition_id,
        question: r.question, decision: r.decision, yes_price: r.yes_price, size_usd: r.size_usd,
        edge: r.edge, p_mid: r.p_mid, end_date: r.end_date, score: r.score,
        scanned_at: r.scanned_at, status: r.status, trigger_type: r.trigger_type, llm_tier: r.llm_tier,
        fund_estimate: r.fundamental_estimate, fund_confidence: r.fundamental_confidence,
        fund_source: fundSource,  // 思路 H J1 #205 transparency — corpus_and / corpus_or / enricher
        outcome: r.outcome_actual ?? r.rec_outcome ?? null,
        was_correct: r.outcome_was_correct ?? r.rec_was_correct ?? null,
        actual_pnl_usd: r.outcome_pnl ?? r.rec_pnl ?? null,
        resolved_at: r.outcome_resolved_at ?? null,
      };
    });

    return reply.send({ ok: true, days, count: recs.length, recommendations: recs });
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

  // GET /api/bettor/adjustments — 调仓建议队列 (per-agent or global)
  fastify.get('/api/bettor/adjustments', async (request, reply) => {
    const relayNodeId = request.query.relay_node_id || null;
    const status = request.query.status || 'pending';
    const limit = Math.min(parseInt(request.query.limit) || 50, 200);

    const where = ['a.status = ?'];
    const args = [status];
    if (relayNodeId) { where.push('a.relay_node_id = ?'); args.push(relayNodeId); }

    const rows = sqlite.prepare(`
      SELECT
        a.id, a.position_id, a.recommendation_id, a.adj_type, a.trigger_reason,
        a.drift_pp, a.pnl_pct, a.unrealized_pnl, a.current_yes_price,
        a.severity, a.status, a.created_at, a.decided_at, a.decided_by,
        r.question, r.slug, r.condition_id, r.end_date,
        p.direction, p.entry_yes_price, p.size_usd
      FROM bettor_adjustments a
      JOIN bettor_recommendations r ON r.id = a.recommendation_id
      JOIN bettor_sim_positions p ON p.id = a.position_id
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
        a.created_at DESC
      LIMIT ?
    `).all(...args, limit);

    return reply.send({ ok: true, count: rows.length, adjustments: rows });
  });

  // POST /api/bettor/adjustments/:id/decide — Owner 审批/拒绝
  fastify.post('/api/bettor/adjustments/:id/decide', async (request, reply) => {
    const { id } = request.params;
    const decision = request.body?.decision; // 'approve' | 'reject'
    const decidedBy = request.body?.decided_by || 'owner';

    if (!['approve', 'reject'].includes(decision)) {
      return reply.code(400).send({ error: 'decision must be approve or reject' });
    }

    const adj = sqlite.prepare(`SELECT * FROM bettor_adjustments WHERE id = ?`).get(id);
    if (!adj) return reply.code(404).send({ error: 'adjustment not found' });
    if (adj.status !== 'pending') return reply.code(409).send({ error: `already ${adj.status}` });

    const now = new Date().toISOString();
    sqlite.prepare(`
      UPDATE bettor_adjustments SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?
    `).run(decision === 'approve' ? 'approved' : 'rejected', now, decidedBy, id);

    // 'approve' 在 paper trade 阶段标 sim_position 为 close_reason='stop_loss'
    // (实盘下单 Phase 3e-3 才接 Polymarket SDK)
    if (decision === 'approve') {
      const latestSnap = sqlite.prepare(`
        SELECT unrealized_pnl FROM bettor_sim_snapshots WHERE position_id = ?
        ORDER BY snapshot_at DESC LIMIT 1
      `).get(adj.position_id);
      sqlite.prepare(`
        UPDATE bettor_sim_positions
        SET closed_at = ?, close_reason = 'stop_loss', realized_pnl = ?
        WHERE id = ? AND closed_at IS NULL
      `).run(now, latestSnap?.unrealized_pnl || 0, adj.position_id);
    }

    return reply.send({ ok: true, status: decision === 'approve' ? 'approved' : 'rejected' });
  });

  // POST /api/bettor/evaluate-now — 手动触发 reactor
  fastify.post('/api/bettor/evaluate-now', async (_request, reply) => {
    if (isReactorRunning()) {
      return reply.code(409).send({ ok: false, reason: 'reactor already running' });
    }
    evaluatePositions().catch(err => console.log(`[api/bettor] evaluate error: ${err.message}`));
    return reply.send({ ok: true, message: 'reactor started' });
  });

  // POST /api/bettor/snapshot-now — 手动触发持仓快照
  fastify.post('/api/bettor/snapshot-now', async (_request, reply) => {
    if (isTrackerRunning()) {
      return reply.code(409).send({ ok: false, reason: 'tracker already running' });
    }
    snapshotOpenPositions().catch(err => console.log(`[api/bettor] snapshot error: ${err.message}`));
    return reply.send({ ok: true, message: 'tracker started' });
  });

  // POST /api/bettor/positions/close-all — Owner 直接介入一键出清全 sim 持仓 (Bettor r44 architect spec)
  // 不走 /decide adjustment 审批 path — close-all 是 Owner 直接操作 vs adjustment 是 reactor 推荐
  // close_reason='manual_close_all' 跟 reactor-driven close 概念分离 (战绩面板 future 可分流)
  fastify.post('/api/bettor/positions/close-all', async (request, reply) => {
    const relayNodeId = request.body?.relay_node_id;
    const decidedBy = request.body?.decided_by || 'owner-manual-close-all';
    if (!relayNodeId) return reply.code(400).send({ error: 'relay_node_id required' });

    // 取每 OPEN position 最新 snapshot unrealized_pnl 作 realized_pnl 锁仓
    const opens = sqlite.prepare(`
      SELECT p.id, COALESCE(s.unrealized_pnl, 0) upnl
      FROM bettor_sim_positions p
      LEFT JOIN (
        SELECT position_id, unrealized_pnl, ROW_NUMBER() OVER (PARTITION BY position_id ORDER BY snapshot_at DESC) rn
        FROM bettor_sim_snapshots
      ) s ON s.position_id = p.id AND s.rn = 1
      WHERE p.relay_node_id = ? AND p.closed_at IS NULL AND p.direction != 'SKIP' AND p.size_usd > 0
    `).all(relayNodeId);

    if (opens.length === 0) {
      return reply.send({ ok: true, closed_count: 0, total_realized_pnl: 0, positions: [] });
    }

    const now = new Date().toISOString();
    const update = sqlite.prepare(`
      UPDATE bettor_sim_positions
      SET closed_at = ?, close_reason = 'manual_close_all', realized_pnl = ?
      WHERE id = ?
    `);
    const tx = sqlite.transaction((items) => {
      for (const p of items) update.run(now, p.upnl, p.id);
    });
    tx(opens);

    const totalPnl = opens.reduce((s, p) => s + (p.upnl || 0), 0);
    console.log(`[bettor-api] close-all relay=${relayNodeId.slice(0, 8)} closed=${opens.length} pnl=$${totalPnl.toFixed(2)} by=${decidedBy}`);
    return reply.send({
      ok: true,
      closed_count: opens.length,
      total_realized_pnl: totalPnl,
      positions: opens.map(p => ({ id: p.id, realized_pnl: p.upnl })),
    });
  });

  // ── Phase 3f-0 (Owner 5/12 钦定): market blacklist endpoints ────────────────
  // 让 Owner 把 market_id 标 'Bettor 不要碰' — scanner skip, reactor skip.

  // GET /api/bettor/blacklist — list 所有 blacklisted markets (含 join market question)
  fastify.get('/api/bettor/blacklist', async (_request, reply) => {
    const rows = sqlite.prepare(`
      SELECT bl.market_id, bl.reason, bl.added_at, bl.added_by,
             (SELECT question FROM bettor_recommendations WHERE market_id = bl.market_id ORDER BY scanned_at DESC LIMIT 1) AS question
      FROM bettor_market_blacklist bl
      ORDER BY bl.added_at DESC
    `).all();
    return reply.send({ ok: true, count: rows.length, items: rows });
  });

  // POST /api/bettor/blacklist — add { market_id, reason, added_by }
  fastify.post('/api/bettor/blacklist', async (request, reply) => {
    const { market_id, reason, added_by } = request.body || {};
    if (!market_id || typeof market_id !== 'string') {
      return reply.code(400).send({ ok: false, error: 'market_id (string) required' });
    }
    try {
      sqlite.prepare(`
        INSERT INTO bettor_market_blacklist (market_id, reason, added_by, added_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(market_id) DO UPDATE SET reason = excluded.reason, added_by = excluded.added_by, added_at = datetime('now')
      `).run(String(market_id), reason || null, added_by || 'unknown');
      console.log(`[bettor-api] blacklist add market_id=${market_id} by=${added_by || 'unknown'} reason="${(reason || '').slice(0, 80)}"`);
      return reply.send({ ok: true, market_id: String(market_id), reason, added_by });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // DELETE /api/bettor/blacklist/:market_id — remove
  fastify.delete('/api/bettor/blacklist/:market_id', async (request, reply) => {
    const { market_id } = request.params;
    const r = sqlite.prepare(`DELETE FROM bettor_market_blacklist WHERE market_id = ?`).run(String(market_id));
    console.log(`[bettor-api] blacklist delete market_id=${market_id} changes=${r.changes}`);
    return reply.send({ ok: true, market_id: String(market_id), removed: r.changes });
  });

  // ── Phase 3f-1 Sub #6 (Bettor r55 spec + r63 green-light): event_calendar API ─────
  // Lifecycle SM 输入数据源 (Sub #4 + Sub #5 接). Owner / system 通过这些 endpoint
  // 喂入事件时间表 (Eurovision semifinal/final, BTC halving, FOMC meeting 等).

  // GET /api/bettor/event-calendar — list all events (optionally filter by ?market_id=X)
  fastify.get('/api/bettor/event-calendar', async (request, reply) => {
    const { market_id } = request.query || {};
    const where = market_id ? 'WHERE ec.market_id = ?' : '';
    const params = market_id ? [String(market_id)] : [];
    const rows = sqlite.prepare(`
      SELECT ec.id, ec.market_id, ec.event_type, ec.event_time_utc, ec.priority, ec.source, ec.notes, ec.added_at,
             (SELECT question FROM bettor_recommendations WHERE market_id = ec.market_id ORDER BY scanned_at DESC LIMIT 1) AS question
      FROM event_calendar ec
      ${where}
      ORDER BY ec.event_time_utc ASC
    `).all(...params);
    return reply.send({ ok: true, count: rows.length, items: rows });
  });

  // POST /api/bettor/event-calendar — upsert {market_id, event_type, event_time_utc, priority?, source?, notes?}
  fastify.post('/api/bettor/event-calendar', async (request, reply) => {
    const { market_id, event_type, event_time_utc, priority, source, notes } = request.body || {};
    if (!market_id || typeof market_id !== 'string') return reply.code(400).send({ ok: false, error: 'market_id (string) required' });
    if (!event_type || typeof event_type !== 'string') return reply.code(400).send({ ok: false, error: 'event_type (string) required' });
    if (!event_time_utc || typeof event_time_utc !== 'string' || Number.isNaN(new Date(event_time_utc).getTime())) {
      return reply.code(400).send({ ok: false, error: 'event_time_utc (ISO 8601 string) required' });
    }
    const prio = Number.isInteger(priority) ? priority : 5;
    if (prio < 1 || prio > 10) return reply.code(400).send({ ok: false, error: 'priority must be INT 1-10' });
    try {
      sqlite.prepare(`
        INSERT INTO event_calendar (market_id, event_type, event_time_utc, priority, source, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(market_id, event_type) DO UPDATE SET
          event_time_utc = excluded.event_time_utc,
          priority = excluded.priority,
          source = excluded.source,
          notes = excluded.notes
      `).run(String(market_id), String(event_type), String(event_time_utc), prio, source || null, notes || null);
      console.log(`[bettor-api] event_calendar upsert market_id=${market_id} type=${event_type} at=${event_time_utc} prio=${prio}`);
      return reply.send({ ok: true, market_id: String(market_id), event_type: String(event_type), event_time_utc, priority: prio });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // DELETE /api/bettor/event-calendar/:id — remove by id (AUTOINCREMENT PK per v100)
  fastify.delete('/api/bettor/event-calendar/:id', async (request, reply) => {
    const { id } = request.params;
    const idNum = Number(id);
    if (!Number.isInteger(idNum) || idNum < 1) return reply.code(400).send({ ok: false, error: 'id (positive integer) required' });
    const r = sqlite.prepare(`DELETE FROM event_calendar WHERE id = ?`).run(idNum);
    console.log(`[bettor-api] event_calendar delete id=${idNum} changes=${r.changes}`);
    return reply.send({ ok: true, id: idNum, removed: r.changes });
  });
}
