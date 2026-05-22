// kasia-console/src/api/admin.js
//
// Admin endpoints — manual recovery utilities + admin Control Room dashboard.
//
// History:
// - Original: PZ-HANDSHAKE-bug-report-and-fix manual recovery (POST /api/admin/manual-handshake-accept)
// - 5/22 KI-64 Phase 1A: admin Control Room (Owner '重点中的重点' directive)
//   - GET /admin renders admin.eta
//   - GET /api/admin/overview returns aggregated market + stuck escrow state
//   - NWT N19.174/175 + J2 #647/648 v2 spec close (5 round mutual push)
//
// Auth: x-ingest-secret header for mutating endpoints. Read-only /admin + /api/admin/overview
// no-auth for now (排日 admin endpoint whitelist spec — `admin-endpoint-whitelist-spec-2026-05-22.md`).

import { verifyIngestRequest } from '../services/ingest-auth.js';
import { sendCommandAsync } from '../services/relay-manager.js';
import { sqlite } from '../db/client.js';
import { fmtDate, relativeTime } from '../lib/time.js';
import { parseLang, getT, isRtl, LANG_NAMES } from '../i18n/index.js';

export async function registerAdminRoutes(fastify) {
  // POST /api/admin/manual-handshake-accept — bypass chain protocol identification,
  // 直 trigger relay-side acceptHandshake 反向 (relay → remote address, 0.2 KAS TX).
  // Use case: user's Kasia client emitted wrong protocol prefix, KANet need 反向 handshake recovery.
  fastify.post(
    '/api/admin/manual-handshake-accept',
    { preHandler: [async (req, rep) => { await verifyIngestRequest(req, rep); }] },
    async (request, reply) => {
      const { relayNodeId, remoteAddress } = request.body || {};
      if (!relayNodeId || !remoteAddress) {
        return reply.code(400).send({ error: 'relayNodeId and remoteAddress required' });
      }
      try {
        const result = await sendCommandAsync(relayNodeId, { type: 'handshake', target: remoteAddress }, 15000);
        return reply.send({ ok: true, txId: result?.txId || null, fee: result?.fee || null });
      } catch (err) {
        return reply.code(503).send({ error: `relay send-command failed: ${err.message}` });
      }
    },
  );

  // KI-64 Phase 1A — admin Control Room page (Owner 5/21 22:00 '重点中的重点')
  fastify.get('/admin', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    return reply.view('admin', { fmtDate, relativeTime, title: 'Admin Control Room', t, lang, dir, langs });
  });

  // KI-64 Phase 1A — aggregate query for admin overview (MARKET STATE + STUCK ESCROW)
  // Single endpoint returns all section data — avoids N+1 endpoint per refresh.
  // No-auth for now (排日 whitelist spec). Returns JSON.
  fastify.get('/api/admin/overview', async (request, reply) => {
    try {
      // === MARKET STATE ===
      const offerCounts = sqlite.prepare(`
        SELECT protocol_status, COUNT(*) c FROM exchange_offers
        WHERE created_at > datetime('now', '-24 hours')
        GROUP BY protocol_status
      `).all();
      const offerByStatus = Object.fromEntries(offerCounts.map(r => [r.protocol_status, r.c]));

      const volRow = sqlite.prepare(`
        SELECT COALESCE(SUM(CASE WHEN want_asset='KAS' THEN CAST(want_amount AS REAL)
                                 WHEN give_asset='KAS' THEN CAST(give_amount AS REAL)
                                 ELSE 0 END), 0) AS kas_volume
        FROM exchange_offers
        WHERE protocol_status='completed' AND updated_at > datetime('now', '-24 hours')
      `).get();

      // Latest KAS mid price from kaspa_tx_log OR price oracle (placeholder: 0.035)
      // Not critical for Phase 1A; future: query /api/trade/kas-price
      const midPrice = 0.035;

      const market = {
        active_offers: offerByStatus.open || 0,
        matched: offerByStatus.matched || 0,
        completed_24h: offerByStatus.completed || 0,
        cancelled_24h: offerByStatus.cancelled || 0,
        disputed: offerByStatus.disputed || 0,
        kas_volume_24h: Number(volRow.kas_volume.toFixed(4)),
        mid_price: midPrice,
      };

      // === STUCK ESCROW PANEL (KI 63 实证 — surface silent stuck) ===
      // (a) active escrow > 1 hr old (broker未 settle/refund in time)
      // (b) refunded status BUT refund_tx=NULL with amount_received SET (KI 63 type lie)
      const stuck = sqlite.prepare(`
        SELECT id, side, asset, amount_received, chain, user_kasia_addr, status,
               prepayment_tx, refund_tx, created_at, updated_at,
               CAST((julianday('now') - julianday(created_at)) * 24 AS INTEGER) AS age_hours
        FROM user_escrow_balances
        WHERE (
          (status='active' AND created_at < datetime('now', '-1 hours'))
          OR
          (status='refunded' AND (refund_tx IS NULL OR refund_tx='') AND amount_received IS NOT NULL)
        )
        ORDER BY created_at DESC
        LIMIT 50
      `).all();

      // === KI 64 Phase 1B v3 sub 1B.2 — BROKER STATE (cross-product per scope_json) ===
      // Per broker: name / scope[] / KAS balance / USDT各 chain / hedge 24h / DM cap / 最后活动 / status
      const brokerRows = sqlite.prepare(`
        SELECT id, name, address, scope_json, dm_count_today
        FROM relay_nodes
        WHERE is_dex_broker=1
        ORDER BY name
      `).all();

      // Pre-fetch latest treasury balance per (relay, chain, asset) — most recent snapshot
      // Window 5 min ago to ensure 'live' freshness; older = stale
      const treasuryRows = sqlite.prepare(`
        SELECT t.relay_node_id, t.chain, t.asset, t.balance_human
        FROM treasury_snapshot t
        INNER JOIN (
          SELECT relay_node_id, chain, asset, MAX(snapshot_at) AS max_ts
          FROM treasury_snapshot
          WHERE snapshot_at > datetime('now', '-1 hour')
          GROUP BY relay_node_id, chain, asset
        ) latest ON t.relay_node_id=latest.relay_node_id
                AND t.chain=latest.chain
                AND t.asset=latest.asset
                AND t.snapshot_at=latest.max_ts
      `).all();

      // hedge 24h count per broker (chain_events.event_type IN hedge_*)
      // chain_events 没 explicit broker_relay_id col, hedge events 用 chain_events.txid which carries offer_id
      // 简化: COUNT all hedge_* events 24h (Trader-B is sole broker, attribute全)
      const hedgeRow = sqlite.prepare(`
        SELECT
          SUM(CASE WHEN event_type='hedge_placed' THEN 1 ELSE 0 END) AS placed,
          SUM(CASE WHEN event_type='hedge_failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN event_type='hedge_skipped' THEN 1 ELSE 0 END) AS skipped
        FROM chain_events
        WHERE event_type IN ('hedge_placed','hedge_failed','hedge_skipped')
          AND observed_at > datetime('now', '-24 hours')
      `).get();

      // 1B.3 Panel B 财务 KPI — hedge value 24h (qty × price summed from payload)
      // Per broker 拆 排日 (chain_events 现 lacks broker_relay_id col; single-broker era acceptable)
      const hedgePlacedDetails = sqlite.prepare(`
        SELECT payload FROM chain_events
        WHERE event_type='hedge_placed' AND observed_at > datetime('now', '-24 hours')
      `).all();
      let hedge24hKasVolume = 0;
      let hedge24hUsdValue = 0;
      for (const ev of hedgePlacedDetails) {
        try {
          const p = JSON.parse(ev.payload);
          const qty = Number(p.qty) || 0;
          const price = Number(p.price) || 0;
          hedge24hKasVolume += qty;
          hedge24hUsdValue += qty * price;
        } catch {}
      }

      // 24h completed offer stats (cross-product placeholder — exchange only现; prediction N/A 待 Bettor B2 mainnet)
      const completedStats = sqlite.prepare(`
        SELECT
          COUNT(*) AS count,
          COALESCE(SUM(CASE WHEN want_asset='KAS' THEN CAST(want_amount AS REAL)
                            WHEN give_asset='KAS' THEN CAST(give_amount AS REAL)
                            ELSE 0 END), 0) AS kas_volume,
          COALESCE(SUM(CASE WHEN want_asset='USDT' THEN CAST(want_amount AS REAL)
                            WHEN give_asset='USDT' THEN CAST(give_amount AS REAL)
                            ELSE 0 END), 0) AS usdt_volume
        FROM exchange_offers
        WHERE protocol_status='completed' AND updated_at > datetime('now', '-24 hours')
      `).get();

      // Latest broker activity from chain_events where from_address=broker.kasia OR observed_by mentions broker name
      const brokers = brokerRows.map(b => {
        let scope = [];
        try { scope = JSON.parse(b.scope_json || '[]'); } catch {}

        // Per-chain USDT/USDC balance (broker-specific filter)
        const balances = treasuryRows
          .filter(t => t.relay_node_id === b.id)
          .map(t => ({ chain: t.chain, asset: t.asset, amount: Number((t.balance_human || 0).toFixed(4)) }));

        // 1B.2.1 Fix 2 (NWT N19.184 P0): KAS pool sum across ALL chains by asset='KAS'.
        // Bug: Trader-B KAS lives on CEX legs (cex:bybit / cex:gateio / cex:mexc), not chain='kaspa'.
        // Filter chain='kaspa' missed 131,051 KAS, returned null.
        // Fix: aggregate all asset='KAS' across chains.
        const kasBalance = balances
          .filter(x => x.asset === 'KAS')
          .reduce((sum, x) => sum + (x.amount || 0), 0);
        const kas_pool = kasBalance > 0 ? Number(kasBalance.toFixed(4)) : null;

        const usdtByChain = balances.filter(x => x.asset === 'USDT').reduce((acc, x) => { acc[x.chain] = x.amount; return acc; }, {});

        // Last activity from chain_events (any event where from_address matches broker kasia OR observed_by mentions)
        const lastActivityRow = sqlite.prepare(`
          SELECT MAX(observed_at) AS last_ts
          FROM chain_events
          WHERE from_address=?
        `).get(b.address);

        const lastActivityTs = lastActivityRow?.last_ts || null;
        let ageMin = null;
        if (lastActivityTs) {
          // 1B.2.1 Fix 1 (NWT N19.184 P0): ageMin parse safe across timestamp formats.
          // Bug: '2026-05-21T18:35:53.559Z'.replace(' ', 'T') + 'Z' = double-Z → NaN → status='down' wrong.
          // Fix: detect format — if already has 'T' (ISO), use as-is; if has space (SQLite), convert.
          let isoTs = lastActivityTs;
          if (!isoTs.includes('T')) isoTs = isoTs.replace(' ', 'T') + 'Z';
          const parsed = new Date(isoTs);
          if (!isNaN(parsed.getTime())) {
            ageMin = Math.floor((Date.now() - parsed.getTime()) / 60000);
          }
          // else ageMin stays null → status='unknown' fallthrough
        }

        // Status derive — explicit NaN/null guard (Fix 1 part 2)
        let status = 'unknown';
        if (ageMin !== null && !isNaN(ageMin)) {
          if (ageMin < 5) status = 'alive';
          else if (ageMin < 60) status = 'idle';
          else status = 'down';
        }

        return {
          id: b.id,
          name: b.name,
          address: b.address,
          scope,
          kas_pool,
          usdt_by_chain: usdtByChain,
          dm_count_today: b.dm_count_today || 0,
          dm_cap: 200,  // Daily DM cap per relay (KI 63 sediment, fixed for now)
          hedge_24h: { placed: hedgeRow?.placed || 0, failed: hedgeRow?.failed || 0, skipped: hedgeRow?.skipped || 0 },
          last_activity: lastActivityTs,
          age_min: ageMin,
          status,
        };
      });

      // 1B.3.1 hotfix (NWT N19.186): aggregate single row 'broker 合计 24h' instead of per-broker array.
      // Bug: hedge_24h / completed stats are GLOBAL (chain_events 无 broker_relay_id col), 之前 map per broker
      // duplicated same value to both Trader-A + Trader-B → misleading admin.
      // Fix: single financials_total object. Per-broker attribution待 v138 chain_events.broker_relay_id col (排日).
      const financials_total = {
        scope: 'all_brokers_aggregate',
        broker_count: brokerRows.length,
        fee_exchange_24h: null,  // exchange offer fee not yet logged in DB — 排日 加 broker_fee_kas col
        fee_prediction_24h: null,  // prediction broker not yet exists — N/A til Bettor B2 mainnet merge
        hedge_24h_kas_volume: Number(hedge24hKasVolume.toFixed(4)),
        hedge_24h_usd_value: Number(hedge24hUsdValue.toFixed(4)),
        hedge_24h_avg_price: hedge24hKasVolume > 0 ? Number((hedge24hUsdValue / hedge24hKasVolume).toFixed(6)) : null,
        completed_offers_24h: completedStats.count,
        completed_kas_volume_24h: Number(completedStats.kas_volume.toFixed(4)),
        completed_usdt_volume_24h: Number(completedStats.usdt_volume.toFixed(4)),
        net_pnl_24h: null,  // null until fee tracking lands — propose Phase 1B follow-up 排日
        note: 'per-broker attribution待 chain_events.broker_relay_id col (v138排日)',
      };

      return reply.send({
        ok: true,
        ts: new Date().toISOString(),
        market,
        brokers,
        financials_total,
        stuck: stuck.map(e => ({
          id: e.id,
          side: e.side,
          asset: e.asset,
          amount: e.amount_received,
          chain: e.chain,
          status: e.status,
          age_hours: e.age_hours,
          user_addr: e.user_kasia_addr,
          paytx: e.prepayment_tx,
          refund_tx: e.refund_tx,
          stuck_reason: (e.status === 'refunded' && !e.refund_tx) ? 'refund_tx_lie' : 'active_overdue',
          updated_at: e.updated_at,
        })),
      });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // KI 64 Phase 1B v3 sub 1B.4 — admin Control Room history with pagination + filter + search + sort
  // Separate endpoint (not in /overview) — large dataset, query-driven,独立 page state.
  fastify.get('/api/admin/history', async (request, reply) => {
    try {
      const q = request.query || {};
      const range = String(q.range || '24h');  // 24h / 7d / 30d / all
      const search = String(q.search || '').trim();
      const sortBy = String(q.sort || 'updated_at');  // updated_at / give_amount / status
      const sortDir = String(q.dir || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      const scope = String(q.scope || 'all');  // all / exchange / prediction
      const status = String(q.status || 'all');  // all / completed / cancelled / disputed / expired
      const page = Math.max(1, parseInt(q.page, 10) || 1);
      const limit = Math.min(200, Math.max(10, parseInt(q.limit, 10) || 50));
      const offset = (page - 1) * limit;

      // SQL whitelist sort columns (防 SQL injection via sortBy param)
      const SORT_WHITELIST = new Set(['updated_at', 'created_at', 'give_amount', 'want_amount', 'protocol_status']);
      const safeSortBy = SORT_WHITELIST.has(sortBy) ? sortBy : 'updated_at';

      // Date range filter
      const rangeSql = (() => {
        switch (range) {
          case '7d': return `AND updated_at > datetime('now', '-7 days')`;
          case '30d': return `AND updated_at > datetime('now', '-30 days')`;
          case 'all': return ``;
          case '24h':
          default: return `AND updated_at > datetime('now', '-1 day')`;
        }
      })();

      // Status filter
      const statusSql = status === 'all' ? '' : `AND protocol_status=@status`;

      // Search filter (TX prefix / user prefix / offer_id prefix)
      let searchSql = '';
      const params = { limit, offset, status };
      if (search) {
        searchSql = `AND (id LIKE @search OR maker LIKE @search OR taker LIKE @search OR broadcast_tx_id LIKE @search OR settle_tx LIKE @search)`;
        params.search = `${search}%`;
      }

      // Note: scope filter ('exchange' vs 'prediction') currently only exchange_offers source.
      // prediction history待 Bettor B2 mainnet merge + pool_markets ingest. Phase 1B.4 v1 仅 exchange.
      const scopeNote = scope === 'prediction' ? `AND 0=1` : ''; // prediction returns 0 row

      const whereClause = `WHERE 1=1 ${rangeSql} ${statusSql} ${searchSql} ${scopeNote}`;

      // Total count
      const totalRow = sqlite.prepare(`SELECT COUNT(*) AS total FROM exchange_offers ${whereClause}`).get(params);
      const total = totalRow?.total || 0;

      // Paged rows
      const rows = sqlite.prepare(`
        SELECT id, maker, taker, side, market_key, give_asset, give_amount, want_asset, want_amount,
               protocol_status, broadcast_tx_id, settle_tx, created_at, updated_at,
               json_extract(metadata, '$.source') AS source
        FROM exchange_offers
        ${whereClause}
        ORDER BY ${safeSortBy} ${sortDir}
        LIMIT @limit OFFSET @offset
      `).all(params);

      return reply.send({
        ok: true,
        ts: new Date().toISOString(),
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
        filters: { range, search, sort: safeSortBy, dir: sortDir, scope, status },
        items: rows.map(r => ({
          id: r.id,
          scope: 'exchange',  // prediction待 mainnet merge
          maker: r.maker,
          taker: r.taker,
          side: r.side,
          market_key: r.market_key,
          give: { asset: r.give_asset, amount: r.give_amount },
          want: { asset: r.want_asset, amount: r.want_amount },
          status: r.protocol_status,
          broadcast_tx: r.broadcast_tx_id,
          settle_tx: r.settle_tx,
          source: r.source,
          created_at: r.created_at,
          updated_at: r.updated_at,
        })),
      });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });
}
