/**
 * Chain Data API — Kaspa chain intelligence from KANet's own DB
 * Data source: Console DB (fed by Scout chain scanning)
 * Zero external dependencies. Our data, our infrastructure.
 *
 * v2: Added chain_snapshots — Kaspa blockchain fundamentals
 *     (block count, difficulty, hashrate, supply, DAA score)
 *     Fed by Scout's chain-fundamentals collector.
 */

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';
import { verifyIngestRequest } from '../services/ingest-auth.js';

export async function registerChainDataRoutes(fastify) {

  // GET /api/chain/stats — chain intelligence from KANet DB
  fastify.get('/api/chain/stats', async (request, reply) => {
    try {
      // 1. Interaction volume (network activity) — from chain_events (P1 migration 2026-04-06)
      const total = sqlite.prepare('SELECT COUNT(*) as n FROM chain_events').get().n;
      const last24h = sqlite.prepare(
        "SELECT COUNT(*) as n FROM chain_events WHERE observed_at > datetime('now','-1 day')"
      ).get().n;
      const last7d = sqlite.prepare(
        "SELECT COUNT(*) as n FROM chain_events WHERE observed_at > datetime('now','-7 day')"
      ).get().n;
      const prev7d = sqlite.prepare(
        "SELECT COUNT(*) as n FROM chain_events WHERE observed_at > datetime('now','-14 day') AND observed_at <= datetime('now','-7 day')"
      ).get().n;

      // Week-over-week trend
      const weekTrend = prev7d > 0 ? Math.round((last7d - prev7d) / prev7d * 100) : null;

      // 2. Protocol breakdown
      const protocols = sqlite.prepare(
        'SELECT event_type, COUNT(*) as n FROM chain_events GROUP BY event_type'
      ).all();
      const protocolMap = {};
      protocols.forEach(p => { protocolMap[p.event_type] = p.n; });

      // 3. Address intelligence
      const totalAddresses = sqlite.prepare('SELECT COUNT(*) as n FROM identities').get().n;
      const activeAddresses = sqlite.prepare(
        'SELECT COUNT(*) as n FROM identities WHERE last_seen_at IS NOT NULL'
      ).get().n;
      const newAddresses7d = sqlite.prepare(
        "SELECT COUNT(*) as n FROM identities WHERE discovered_at > datetime('now','-7 day')"
      ).get().n;
      const newAddresses24h = sqlite.prepare(
        "SELECT COUNT(*) as n FROM identities WHERE discovered_at > datetime('now','-1 day')"
      ).get().n;

      // 4. Agent Cards (ecosystem maturity indicator)
      const agentCards = sqlite.prepare(
        'SELECT COUNT(*) as n FROM identities WHERE card_mode IS NOT NULL'
      ).get().n;

      // 5. Top active addresses (potential whales)
      const topAddresses = sqlite.prepare(
        'SELECT address, display_name, interaction_count, trust_level, card_entity_type FROM identities WHERE interaction_count > 0 ORDER BY interaction_count DESC LIMIT 10'
      ).all();

      // 6. Our agents' data
      const agents = sqlite.prepare(
        'SELECT name, address FROM relay_nodes WHERE address IS NOT NULL'
      ).all();

      // 7. Hourly activity trend (last 24h)
      const hourlyActivity = sqlite.prepare(`
        SELECT strftime('%H', observed_at) as hour, COUNT(*) as n
        FROM chain_events
        WHERE observed_at > datetime('now','-1 day')
        GROUP BY hour ORDER BY hour
      `).all();

      // 8. Recent broadcast activity
      const broadcastCount = sqlite.prepare('SELECT COUNT(*) as n FROM broadcast_messages').get().n;
      const broadcast24h = sqlite.prepare(
        "SELECT COUNT(*) as n FROM broadcast_messages WHERE created_at > datetime('now','-1 day')"
      ).get().n;

      return reply.send({
        source: 'kanet-db',
        activity: {
          total,
          last24h,
          last7d,
          weekTrend,
          protocols: protocolMap,
        },
        addresses: {
          total: totalAddresses,
          active: activeAddresses,
          new7d: newAddresses7d,
          new24h: newAddresses24h,
        },
        ecosystem: {
          agentCards,
          broadcasts: broadcastCount,
          broadcasts24h: broadcast24h,
        },
        topAddresses: topAddresses.map(a => ({
          address: a.address,
          name: a.display_name,
          interactions: a.interaction_count,
          trust: a.trust_level,
          type: a.card_entity_type,
        })),
        agents: agents.map(a => ({
          name: a.name,
          address: a.address,
        })),
        hourlyActivity,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/chain/snapshot — Scout reports blockchain fundamentals
  fastify.post('/api/chain/snapshot', async (request, reply) => {
    await verifyIngestRequest(request, reply);
    if (reply.sent) return;

    const {
      blockCount, difficulty, daaScore, tipsCount,
      virtualDaaScore, pastMedianTime,
      hashrate, circulatingSupply, maxSupply,
    } = request.body || {};

    if (!blockCount && !daaScore) {
      return reply.code(400).send({ error: 'blockCount or daaScore required' });
    }

    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT INTO chain_snapshots
        (id, block_count, difficulty, daa_score, tips_count, virtual_daa_score,
         past_median_time, hashrate, circulating_supply, max_supply, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      blockCount || null,
      difficulty || null,
      daaScore || null,
      tipsCount || null,
      virtualDaaScore || null,
      pastMedianTime || null,
      hashrate || null,
      circulatingSupply || null,
      maxSupply || null,
      now,
    );

    // Prune old snapshots (keep last 2000 = ~7 days at 5min intervals)
    sqlite.prepare(`
      DELETE FROM chain_snapshots WHERE id NOT IN (
        SELECT id FROM chain_snapshots ORDER BY created_at DESC LIMIT 2000
      )
    `).run();

    return reply.send({ ok: true, ts: now });
  });

  // POST /api/chain/balances — Scout reports address balance snapshots
  fastify.post('/api/chain/balances', async (request, reply) => {
    await verifyIngestRequest(request, reply);
    if (reply.sent) return;

    const { balances } = request.body || {};
    if (!Array.isArray(balances) || balances.length === 0) {
      return reply.code(400).send({ error: 'balances array required' });
    }

    const now = new Date().toISOString();
    const insert = sqlite.prepare(`
      INSERT INTO address_balances (id, address, balance_sompi, balance_kas, address_tag, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = sqlite.transaction((items) => {
      for (const b of items) {
        insert.run(randomUUID(), b.address, b.balanceSompi, b.balanceKas, b.tag || null, now);
      }
    });
    insertMany(balances);

    // Prune old balance records (keep last 5000)
    sqlite.prepare(`
      DELETE FROM address_balances WHERE id NOT IN (
        SELECT id FROM address_balances ORDER BY created_at DESC LIMIT 5000
      )
    `).run();

    return reply.send({ ok: true, recorded: balances.length, ts: now });
  });

  // GET /api/chain/watchlist — get whale watchlist
  fastify.get('/api/chain/watchlist', async (request, reply) => {
    const rows = sqlite.prepare('SELECT * FROM whale_watchlist WHERE active = 1 ORDER BY tag, label').all();
    return reply.send(rows);
  });

  // POST /api/chain/watchlist — add address to watchlist
  fastify.post('/api/chain/watchlist', async (request, reply) => {
    const { address, tag, label } = request.body || {};
    if (!address) return reply.code(400).send({ error: 'address required' });

    const now = new Date().toISOString();
    sqlite.prepare(`
      INSERT OR REPLACE INTO whale_watchlist (id, address, tag, label, source, active, created_at)
      VALUES (?, ?, ?, ?, 'manual', 1, ?)
    `).run(randomUUID(), address, tag || 'whale', label || null, now);

    return reply.send({ ok: true });
  });

  // GET /api/chain/whale-activity — whale balance changes summary
  fastify.get('/api/chain/whale-activity', async (request, reply) => {
    try {
      // Get latest balance for each tracked address
      const latest = sqlite.prepare(`
        SELECT ab.address, ab.balance_kas, ab.address_tag, ab.created_at,
               ww.label, ww.tag
        FROM address_balances ab
        JOIN whale_watchlist ww ON ww.address = ab.address
        WHERE ab.id IN (
          SELECT id FROM address_balances ab2
          WHERE ab2.address = ab.address
          ORDER BY ab2.created_at DESC LIMIT 1
        )
        ORDER BY ab.balance_kas DESC
      `).all();

      // Get previous balance (1h ago) for change detection
      const changes = [];
      for (const addr of latest) {
        const prev = sqlite.prepare(`
          SELECT balance_kas FROM address_balances
          WHERE address = ? AND created_at <= datetime('now', '-1 hour')
          ORDER BY created_at DESC LIMIT 1
        `).get(addr.address);

        const changePct = prev ? ((addr.balance_kas - prev.balance_kas) / prev.balance_kas * 100) : null;

        changes.push({
          address: addr.address,
          label: addr.label || addr.address.slice(-12),
          tag: addr.tag || addr.address_tag,
          balance: addr.balance_kas,
          prevBalance: prev?.balance_kas || null,
          changePct: changePct !== null ? Math.round(changePct * 100) / 100 : null,
          timestamp: addr.created_at,
        });
      }

      // Separate by tag
      const exchanges = changes.filter(c => c.tag === 'exchange');
      const whales = changes.filter(c => c.tag === 'whale');
      const agents = changes.filter(c => c.tag === 'agent');

      // Summary stats
      const exchangeTotal = exchanges.reduce((s, e) => s + e.balance, 0);
      const whaleTotal = whales.reduce((s, w) => s + w.balance, 0);
      const significantMoves = changes.filter(c => c.changePct !== null && Math.abs(c.changePct) > 5);

      return reply.send({
        summary: {
          trackedAddresses: changes.length,
          exchangeBalance: exchangeTotal,
          whaleBalance: whaleTotal,
          significantMoves: significantMoves.length,
        },
        exchanges,
        whales,
        agents,
        significantMoves,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/chain/whale-alert — Scout reports real-time large transfer
  // Dedup: same address within 30min window → skip (was 10min, too short for exchange hot wallets)
  const _whaleAlertRecent = new Map();
  const WHALE_DEDUP_WINDOW_MS = 1_800_000; // 30 min — exchanges & hot wallets need longer cooldown

  fastify.post('/api/chain/whale-alert', async (request, reply) => {
    await verifyIngestRequest(request, reply);
    if (reply.sent) return;

    const alert = request.body || {};
    const now = new Date().toISOString();
    const nowMs = Date.now();

    // Dedup by address+direction — same address+direction within window is duplicate
    const dedupKey = `${alert.address || ''}:${alert.direction || ''}`;
    const lastSeen = _whaleAlertRecent.get(dedupKey);
    if (lastSeen && nowMs - lastSeen < WHALE_DEDUP_WINDOW_MS) {
      return reply.send({ ok: true, duplicate: true });
    }
    _whaleAlertRecent.set(dedupKey, nowMs);

    // Cleanup old entries
    if (_whaleAlertRecent.size > 500) {
      for (const [k, ts] of _whaleAlertRecent) {
        if (nowMs - ts > WHALE_DEDUP_WINDOW_MS * 2) _whaleAlertRecent.delete(k);
      }
    }

    // Use severity from Scout (critical/warning), default to warning
    const level = alert.severity || 'warning';

    // Store as event
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', 'whale_alert', 'scout', ?, ?, ?, ?)
    `).run(
      randomUUID(),
      level,
      `${alert.direction} ${Math.round(alert.amountKas).toLocaleString()} KAS | ${alert.label} (${alert.tag})`,
      JSON.stringify(alert),
      now,
    );

    console.log(`[whale-alert] [${level.toUpperCase()}] ${alert.direction} ${Math.round(alert.amountKas).toLocaleString()} KAS | ${alert.label}`);
    return reply.send({ ok: true, duplicate: false });
  });

  // GET /api/chain/whale-alerts — recent whale alerts
  fastify.get('/api/chain/whale-alerts', async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit) || 50, 200);
    const alerts = sqlite.prepare(`
      SELECT summary, payload_json, created_at
      FROM events
      WHERE event_type = 'whale_alert'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);

    return reply.send(alerts.map(a => ({
      summary: a.summary,
      ...JSON.parse(a.payload_json || '{}'),
      timestamp: a.created_at,
    })));
  });

  // ── Whale Signal Page ──────────────────────────────────────────
  fastify.get('/whale-signal', async (request, reply) => {
    return reply.view('whale-signal', {});
  });

  // ── Whale Signal API ──────────────────────────────────────────

  // GET /api/chain/whale-signal — compute current whale signal score
  fastify.get('/api/chain/whale-signal', async (request, reply) => {
    const { computeWhaleSignal, getParams } = await import('../services/whale-signal.js');
    const params = getParams();
    // Allow query param overrides for experimentation
    if (request.query.window) params.windowMinutes = parseInt(request.query.window);
    if (request.query.threshold) params.usdThreshold = parseInt(request.query.threshold);
    const signal = computeWhaleSignal(params);
    return reply.send(signal);
  });

  // GET /api/chain/whale-signal/params — get current params
  fastify.get('/api/chain/whale-signal/params', async (request, reply) => {
    const { getParams } = await import('../services/whale-signal.js');
    return reply.send(getParams());
  });

  // PUT /api/chain/whale-signal/params — update params
  fastify.put('/api/chain/whale-signal/params', async (request, reply) => {
    const { setParams } = await import('../services/whale-signal.js');
    const updated = setParams(request.body || {});
    return reply.send({ ok: true, params: updated });
  });

  // GET /api/chain/fundamentals — latest chain fundamentals + trend
  fastify.get('/api/chain/fundamentals', async (request, reply) => {
    try {
      const latest = sqlite.prepare(
        'SELECT * FROM chain_snapshots ORDER BY created_at DESC LIMIT 1'
      ).get();

      if (!latest) {
        return reply.send({ available: false, message: 'No chain snapshots yet. Scout needs to collect data.' });
      }

      // 1h ago snapshot for trend
      const hourAgo = sqlite.prepare(
        "SELECT * FROM chain_snapshots WHERE created_at <= datetime('now','-1 hour') ORDER BY created_at DESC LIMIT 1"
      ).get();

      // 24h ago snapshot for daily trend
      const dayAgo = sqlite.prepare(
        "SELECT * FROM chain_snapshots WHERE created_at <= datetime('now','-1 day') ORDER BY created_at DESC LIMIT 1"
      ).get();

      // Snapshot count (data health indicator)
      const snapshotCount = sqlite.prepare('SELECT COUNT(*) as n FROM chain_snapshots').get().n;

      return reply.send({
        available: true,
        latest: {
          blockCount: latest.block_count,
          difficulty: latest.difficulty,
          daaScore: latest.daa_score,
          tipsCount: latest.tips_count,
          hashrate: latest.hashrate,
          circulatingSupply: latest.circulating_supply,
          maxSupply: latest.max_supply,
          timestamp: latest.created_at,
        },
        trend1h: hourAgo ? {
          difficultyChange: latest.difficulty && hourAgo.difficulty
            ? ((latest.difficulty - hourAgo.difficulty) / hourAgo.difficulty * 100).toFixed(2) + '%'
            : null,
          hashrateChange: latest.hashrate && hourAgo.hashrate
            ? ((latest.hashrate - hourAgo.hashrate) / hourAgo.hashrate * 100).toFixed(2) + '%'
            : null,
          newBlocks: latest.block_count && hourAgo.block_count
            ? latest.block_count - hourAgo.block_count
            : null,
        } : null,
        trend24h: dayAgo ? {
          difficultyChange: latest.difficulty && dayAgo.difficulty
            ? ((latest.difficulty - dayAgo.difficulty) / dayAgo.difficulty * 100).toFixed(2) + '%'
            : null,
          hashrateChange: latest.hashrate && dayAgo.hashrate
            ? ((latest.hashrate - dayAgo.hashrate) / dayAgo.hashrate * 100).toFixed(2) + '%'
            : null,
          newBlocks: latest.block_count && dayAgo.block_count
            ? latest.block_count - dayAgo.block_count
            : null,
        } : null,
        dataHealth: {
          snapshots: snapshotCount,
          oldestSnapshot: sqlite.prepare('SELECT created_at FROM chain_snapshots ORDER BY created_at ASC LIMIT 1').get()?.created_at,
        },
      });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}
