import { readFileSync } from 'node:fs';
import { listEvents, getEventStats } from '../data/state/events.js';
import { fmtDate, relativeTime } from '../lib/time.js';
import { parseLang, getT, isRtl, LANG_NAMES } from '../i18n/index.js';
import { verifyIngestRequest } from '../services/ingest-auth.js';
import { sqlite } from '../db/client.js';

export async function registerEventRoutes(fastify) {
  // Trace query API — returns all events for a given trace_id
  fastify.get('/api/events/trace/:traceId', { preHandler: async (request, reply) => { await verifyIngestRequest(request, reply); } }, async (request, reply) => {
    const { traceId } = request.params;
    const events = sqlite.prepare('SELECT * FROM events WHERE trace_id = ? ORDER BY created_at ASC').all(traceId);
    return reply.send({ traceId, events });
  });

  // TG bot S1 (Bettor r211/r219 v1.3): GET /api/events/since/:ts?address=
  // 服务端按 from/to_address 过滤 chain_events, bot poller 30s 拉差量推 TG.
  // address required (= privacy + 省流: 不暴别人活动, 不全网广播).
  // optional: event_type filter (= 配合 user_notification_prefs.event_type 订阅).
  // optional: limit (default 100, cap 500).
  fastify.get('/api/events/since/:ts', { preHandler: async (request, reply) => { await verifyIngestRequest(request, reply); } }, async (request, reply) => {
    const { ts } = request.params;
    const { address, event_type, limit: limitParam } = request.query;
    if (!address || typeof address !== 'string' || !address.startsWith('kaspa')) {
      return reply.code(400).send({ ok: false, error: 'address required (kaspa: prefix)' });
    }
    const sinceMs = parseInt(ts, 10);
    if (!Number.isFinite(sinceMs) || sinceMs < 0) {
      return reply.code(400).send({ ok: false, error: 'ts required (ms epoch)' });
    }
    const sinceIso = new Date(sinceMs).toISOString();
    const limit = Math.min(parseInt(limitParam, 10) || 100, 500);
    const filters = ['(from_address = ? OR to_address = ?)', 'observed_at > ?'];
    const params = [address, address, sinceIso];
    if (event_type && typeof event_type === 'string') {
      filters.push('event_type = ?');
      params.push(event_type);
    }
    const sql = `SELECT txid, event_type, from_address, to_address, payload, observed_at, offer_id
                 FROM chain_events
                 WHERE ${filters.join(' AND ')}
                 ORDER BY observed_at ASC
                 LIMIT ?`;
    params.push(limit);
    const rows = sqlite.prepare(sql).all(...params);
    return reply.send({ ok: true, address, since: sinceIso, count: rows.length, events: rows });
  });

  fastify.get('/events', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    const { level = '', source = '', search = '', event_type = '', page = '1' } = request.query;
    const limit = 50;
    const offset = (parseInt(page) - 1) * limit;

    // Query distinct event_types for the filter dropdown
    const eventTypes = sqlite.prepare('SELECT DISTINCT event_type FROM events ORDER BY event_type').all().map(r => r.event_type);

    let unified;

    if (source === 'tx') {
      // TX Records data source — query tx_records table and format as events
      const txFilters = [];
      const txParams = [];
      if (search) { txFilters.push("(txid LIKE '%' || ? || '%' OR status LIKE '%' || ? || '%')"); txParams.push(search, search); }
      if (event_type) { txFilters.push('direction = ?'); txParams.push(event_type); }
      const txWhere = txFilters.length > 0 ? 'WHERE ' + txFilters.join(' AND ') : '';

      unified = sqlite.prepare(`
        SELECT id,
               direction as event_type,
               'relay' as source,
               'info' as level,
               direction || ' TX: ' || SUBSTR(txid, 1, 16) || '... | status: ' || status as summary,
               created_at,
               'tx' as scope
        FROM tx_records
        ${txWhere}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(...txParams, limit, offset);
    } else {
      // Unified activity log: merge events table + source tables (handshakes, messages, broadcasts)
      // Build dynamic WHERE filters
      const filters = [];
      const filterParams = [];
      if (level) { filters.push('level = ?'); filterParams.push(level); }
      if (source) { filters.push('source = ?'); filterParams.push(source); }
      if (event_type) { filters.push('event_type = ?'); filterParams.push(event_type); }
      if (search) { filters.push("summary LIKE '%' || ? || '%'"); filterParams.push(search); }
      const whereClause = filters.length > 0 ? 'WHERE ' + filters.join(' AND ') : '';

      unified = sqlite.prepare(`
        SELECT * FROM (
          -- System events (mind, skill, etc.)
          SELECT id, event_type, source, level, summary, created_at,
                 event_scope as scope
          FROM events

          UNION ALL

          -- Handshakes from chain_events (P1 migration 2026-04-06)
          SELECT txid as id,
                 CASE WHEN from_address IN (SELECT address FROM relay_nodes) THEN 'handshake_sent' ELSE 'handshake_received' END as event_type,
                 COALESCE(
                   (SELECT name FROM relay_nodes WHERE address = ce.from_address),
                   (SELECT name FROM relay_nodes WHERE address = ce.to_address),
                   'unknown'
                 ) as source,
                 'info' as level,
                 CASE WHEN from_address IN (SELECT address FROM relay_nodes)
                   THEN (SELECT COALESCE(name, address) FROM relay_nodes WHERE address = ce.from_address) || ' → ' || SUBSTR(ce.to_address, -8)
                   ELSE SUBSTR(ce.from_address, -8) || ' → ' || (SELECT COALESCE(name, address) FROM relay_nodes WHERE address = ce.to_address)
                 END as summary,
                 observed_at as created_at,
                 'handshake' as scope
          FROM chain_events ce
          WHERE event_type = 'handshake'

          UNION ALL

          -- Broadcasts
          SELECT bm.tx_hash as id,
                 'broadcast' as event_type,
                 COALESCE((SELECT name FROM relay_nodes WHERE address = bm.sender_address), SUBSTR(bm.sender_address, -8)) as source,
                 'info' as level,
                 '[#' || bm.channel_name || '] ' || COALESCE((SELECT name FROM relay_nodes WHERE address = bm.sender_address), SUBSTR(bm.sender_address, -8)) || ': "' || SUBSTR(bm.content, 1, 60) || '"' as summary,
                 bm.created_at,
                 'broadcast' as scope
          FROM broadcast_messages bm
          WHERE bm.tx_hash NOT LIKE 'test-%'
        )
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(...filterParams, limit, offset);
    }

    // Stats from unified view
    const stats = await getEventStats();

    // ── Agent Activity Briefings ──────────────────────────────────────────────
    const relays = sqlite.prepare('SELECT id, name, address FROM relay_nodes WHERE address IS NOT NULL').all();
    const now = Date.now();
    const day1 = new Date(now - 86400_000).toISOString();
    const day7 = new Date(now - 7 * 86400_000).toISOString();

    const briefings = relays.map(r => {
      // Messages sent (broadcasts by this agent)
      const msgs24h = sqlite.prepare(
        "SELECT COUNT(*) as c FROM broadcast_messages WHERE sender_address = ? AND created_at > ?"
      ).get(r.address, day1).c;
      const msgs7d = sqlite.prepare(
        "SELECT COUNT(*) as c FROM broadcast_messages WHERE sender_address = ? AND created_at > ?"
      ).get(r.address, day7).c;

      // Handshakes (sent or received) — from chain_events (P1 migration 2026-04-06)
      const hs24h = sqlite.prepare(
        "SELECT COUNT(*) as c FROM chain_events WHERE (from_address = ? OR to_address = ?) AND event_type = 'handshake' AND observed_at > ?"
      ).get(r.address, r.address, day1).c;
      const hs7d = sqlite.prepare(
        "SELECT COUNT(*) as c FROM chain_events WHERE (from_address = ? OR to_address = ?) AND event_type = 'handshake' AND observed_at > ?"
      ).get(r.address, r.address, day7).c;

      // Total interactions
      const interactions24h = sqlite.prepare(
        "SELECT COUNT(*) as c FROM chain_events WHERE (from_address = ? OR to_address = ?) AND observed_at > ?"
      ).get(r.address, r.address, day1).c;
      const interactions7d = sqlite.prepare(
        "SELECT COUNT(*) as c FROM chain_events WHERE (from_address = ? OR to_address = ?) AND observed_at > ?"
      ).get(r.address, r.address, day7).c;

      // Unique peers (7d)
      const peers7d = sqlite.prepare(
        "SELECT COUNT(DISTINCT CASE WHEN from_address = ? THEN to_address ELSE from_address END) as c FROM chain_events WHERE (from_address = ? OR to_address = ?) AND observed_at > ?"
      ).get(r.address, r.address, r.address, day7).c;

      // Mind events (reflections, proactive, skills)
      const mindEvents24h = sqlite.prepare(
        "SELECT COUNT(*) as c FROM events WHERE event_scope = ? AND created_at > ?"
      ).get(r.name, day1).c;

      // Trades (if any)
      const trades7d = sqlite.prepare(
        "SELECT COUNT(*) as c FROM trade_log WHERE relay_node_id = ? AND created_at > ?"
      ).get(r.id, day7).c;

      // Latest reflection
      let latestReflection = null;
      try {
        const nameDir = r.name.toLowerCase().replace(/[^a-z0-9_]/g, '');
        const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
        const reflPath = `${KANET_ROOT}/agent-mind/minds/${nameDir}/reflections.json`;
        const data = JSON.parse(readFileSync(reflPath, 'utf8'));
        if (data.reflections?.length > 0) {
          latestReflection = data.reflections[0].insight || data.reflections[data.reflections.length - 1].insight;
        }
      } catch {}

      return {
        name: r.name,
        msgs24h, msgs7d,
        hs24h, hs7d,
        interactions24h, interactions7d,
        peers7d,
        mindEvents24h,
        trades7d,
        latestReflection,
      };
    });

    return reply.view('events', { events: unified, stats, briefings, eventTypes, level, source, search, event_type, page: parseInt(page), fmtDate, relativeTime, title: 'Events', t, lang, dir, langs });
  });

  // CSV export
  fastify.get('/events/export.csv', async (request, reply) => {
    const events = await listEvents({ limit: 10000 });
    const header = 'id,event_type,source,level,summary,created_at\n';
    const rows = events.map(e => [e.id, e.event_type, e.source, e.level, `"${(e.summary || '').replace(/"/g, '""')}"`, e.created_at].join(',')).join('\n');
    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="events.csv"');
    return reply.send(header + rows);
  });
}
