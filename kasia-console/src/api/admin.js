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
      // KI 65 #N19.238 (Owner 5/23 钦定): include marketmaker-role relays (= MarketMaker-A template).
      // adapter_node_id NULL = template (= 真 future N-node 模板, 不报 down alert).
      const brokerRows = sqlite.prepare(`
        SELECT id, name, address, scope_json, dm_count_today, adapter_node_id, roles_json
        FROM relay_nodes rn
        WHERE is_dex_broker=1
           OR EXISTS (SELECT 1 FROM json_each(rn.roles_json) je WHERE je.value = 'marketmaker')
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
        // KI 65 #N19.238: adapter_node_id NULL = template (= 真保留 future N-node 模板, 不报 down).
        const isTemplate = !b.adapter_node_id;
        let status = 'unknown';
        if (isTemplate) {
          status = 'template';
        } else if (ageMin !== null && !isNaN(ageMin)) {
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
          is_template: isTemplate,  // KI 65 #N19.238: future N-node template marker
        };
      });

      // 1B.3.1 hotfix (NWT N19.186): aggregate single row 'broker 合计 24h' instead of per-broker array.
      // Bug: hedge_24h / completed stats are GLOBAL (chain_events 无 broker_relay_id col), 之前 map per broker
      // duplicated same value to both Trader-A + Trader-B → misleading admin.
      // Fix: single financials_total object. Per-broker attribution待 v138 chain_events.broker_relay_id col (排日).
      //
      // KI 65 B.4 wire (Owner 5/23 钦定): fee_exchange_24h_kas + trade_count_24h 真 populate
      // (filter = retail_dex_orders broker_fee_kas IS NOT NULL AND state NOT IN refund-path).
      // KI 65 #85.3 (Owner 5/23 钦定, NWT N19.234): test fixture isolation — default exclude test-*.
      // NWT 5/22 87.9 KAS '100x bug' 真因 test fixture 污染. ?include_test=1 query param 真 toggle.
      const includeTest = String(request.query?.include_test || '') === '1';
      const testFilter = includeTest ? '' : ` AND id NOT LIKE 'test-%' AND id NOT LIKE 'test_%'`;
      const feeAgg24h = sqlite.prepare(`
        SELECT COALESCE(SUM(CAST(broker_fee_kas AS REAL)), 0) AS fee_kas, COUNT(*) AS trades
        FROM retail_dex_orders
        WHERE broker_fee_kas IS NOT NULL
          AND state NOT IN ('expired','failed','refunded','refunding')
          AND created_at > datetime('now', '-1 day')
          ${testFilter}
      `).get();

      // KI 65 #85.2 (Owner 5/23 钦定, NWT N19.235): autoTaker skip 24h distribution by reason.
      // observability for filter calibration (= which gate rejects most offers).
      const autotakeSkip24h = sqlite.prepare(`
        SELECT json_extract(payload, '$.reason') AS reason, COUNT(*) AS c
        FROM chain_events
        WHERE event_type = 'autotake_skip' AND observed_at > datetime('now', '-1 day')
        GROUP BY reason ORDER BY c DESC LIMIT 20
      `).all();
      const autotakeAccepted24h = sqlite.prepare(`
        SELECT COUNT(*) AS c FROM chain_events
        WHERE event_type = 'autotake_accepted' AND observed_at > datetime('now', '-1 day')
      `).get();
      const financials_total = {
        scope: 'all_brokers_aggregate',
        broker_count: brokerRows.length,
        fee_exchange_24h_kas: Math.round(feeAgg24h.fee_kas * 1000) / 1000,  // KAS units (not USD)
        fee_exchange_24h_trades: feeAgg24h.trades,
        autotake_24h: {
          accepted: autotakeAccepted24h?.c || 0,
          skip_count: autotakeSkip24h.reduce((s, r) => s + r.c, 0),
          skip_by_reason: autotakeSkip24h.map(r => ({ reason: r.reason || 'unknown', count: r.c })),
        },
        fee_exchange_24h: null,  // legacy null (was $ placeholder, now superseded by fee_exchange_24h_kas)
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
      // 1B.4.1 hotfix (NWT N19.188): real schema has delivery_tx + payment_tx, NOT settle_tx
      let searchSql = '';
      const params = { limit, offset, status };
      if (search) {
        searchSql = `AND (id LIKE @search OR maker LIKE @search OR taker LIKE @search OR broadcast_tx_id LIKE @search OR delivery_tx LIKE @search OR payment_tx LIKE @search)`;
        params.search = `${search}%`;
      }

      // Note: scope filter ('exchange' vs 'prediction') currently only exchange_offers source.
      // prediction history待 Bettor B2 mainnet merge + pool_markets ingest. Phase 1B.4 v1 仅 exchange.
      const scopeNote = scope === 'prediction' ? `AND 0=1` : ''; // prediction returns 0 row
      // KI 65 #85.3: test fixture isolation — default exclude test-*. UI toggle 'show test data' → include_test=1.
      const includeTest = String(q.include_test || '') === '1';
      const testFilter = includeTest ? '' : ` AND id NOT LIKE 'test-%' AND id NOT LIKE 'test_%'`;

      const whereClause = `WHERE 1=1 ${rangeSql} ${statusSql} ${searchSql} ${scopeNote} ${testFilter}`;

      // Total count
      const totalRow = sqlite.prepare(`SELECT COUNT(*) AS total FROM exchange_offers ${whereClause}`).get(params);
      const total = totalRow?.total || 0;

      // Paged rows — 1B.4.1 hotfix (NWT N19.188): use real schema columns
      // - No `side` col; direction implicit from give_asset → want_asset (KAS→USDT = SELL, USDT→KAS = BUY)
      // - No `settle_tx` col; settlement has 2 legs: payment_tx (taker→maker USDT) + delivery_tx (maker→taker KAS)
      // - outcome_side exists only for prediction (YES/NO), unused for exchange flow
      const rows = sqlite.prepare(`
        SELECT id, maker, taker, market_key, give_asset, give_amount, want_asset, want_amount,
               protocol_status, broadcast_tx_id, payment_tx, delivery_tx, created_at, updated_at,
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
        items: rows.map(r => {
          // Derive direction from give_asset (KAS→USDT = SELL KAS, USDT→KAS = BUY KAS)
          const direction = r.give_asset === 'KAS' ? 'SELL' : r.give_asset === 'USDT' || r.give_asset === 'USDC' ? 'BUY' : '—';
          return {
            id: r.id,
            scope: 'exchange',  // prediction待 mainnet merge
            maker: r.maker,
            taker: r.taker,
            direction,  // derived, not from `side` col
            market_key: r.market_key,
            give: { asset: r.give_asset, amount: r.give_amount },
            want: { asset: r.want_asset, amount: r.want_amount },
            status: r.protocol_status,
            broadcast_tx: r.broadcast_tx_id,
            payment_tx: r.payment_tx,   // taker→maker USDT leg
            delivery_tx: r.delivery_tx, // maker→taker KAS leg
            source: r.source,
            created_at: r.created_at,
            updated_at: r.updated_at,
          };
        }),
      });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // KI 65 Block B.1 (Owner 5/23 钦定, NWT N19.227 path 钦定): broker fee aggregate per range.
  //
  // Filter semantics: `broker_fee_kas IS NOT NULL AND state NOT IN ('expired','failed','refunded','refunding')`.
  //   state='completed' (4 rows historical) OR 'confirming' (= broker delivered KAS, awaiting block confirm) 真 fee collected.
  //   state='expired'/'failed'/'refunded'/'refunding' 真 not collected (= refund path).
  //
  // multi-broker: defer Block B v2 (= retail_dex_orders no broker_id col, single broker implicit).
  //   broker_id query param reserved for future multi-broker enable.
  fastify.get('/api/admin/broker/fees', async (request, reply) => {
    try {
      const q = request.query || {};
      const range = String(q.range || '24h');  // 24h / 7d / 30d / all
      const brokerIdFilter = q.broker_id ? String(q.broker_id) : null;  // reserved, no-op v1
      const includeTest = String(q.include_test || '') === '1';  // KI 65 #85.3: default exclude test-*
      const testFilter = includeTest ? '' : ` AND id NOT LIKE 'test-%' AND id NOT LIKE 'test_%'`;
      const rangeSql = (() => {
        switch (range) {
          case '7d': return `AND created_at > datetime('now', '-7 days')`;
          case '30d': return `AND created_at > datetime('now', '-30 days')`;
          case 'all': return ``;
          case '24h':
          default: return `AND created_at > datetime('now', '-1 day')`;
        }
      })();
      const settleSql = `broker_fee_kas IS NOT NULL AND state NOT IN ('expired','failed','refunded','refunding')`;
      const agg = sqlite.prepare(`
        SELECT
          COUNT(*) AS trade_count,
          COALESCE(SUM(CAST(broker_fee_kas AS REAL)), 0) AS total_fee_kas,
          COALESCE(AVG(CAST(broker_fee_kas AS REAL)), 0) AS avg_fee_kas
        FROM retail_dex_orders
        WHERE ${settleSql} ${rangeSql} ${testFilter}
      `).get();
      const breakdown = sqlite.prepare(`
        SELECT side, COUNT(*) AS c, COALESCE(SUM(CAST(broker_fee_kas AS REAL)), 0) AS fee_kas
        FROM retail_dex_orders
        WHERE ${settleSql} ${rangeSql} ${testFilter}
        GROUP BY side
      `).all();
      const stateDist = sqlite.prepare(`
        SELECT state, COUNT(*) AS c
        FROM retail_dex_orders
        WHERE broker_fee_kas IS NOT NULL ${rangeSql} ${testFilter}
        GROUP BY state
      `).all();
      const broker = sqlite.prepare(`
        SELECT id, name, address FROM relay_nodes rn
        WHERE EXISTS (SELECT 1 FROM json_each(rn.roles_json) je WHERE je.value = 'broker')
        ORDER BY rn.created_at ASC LIMIT 1
      `).get();
      return reply.send({
        ok: true,
        ts: new Date().toISOString(),
        range,
        broker_id_filter: brokerIdFilter,  // reserved for multi-broker v2
        broker: broker ? { id: broker.id, name: broker.name, address: broker.address } : null,
        trade_count: agg.trade_count,
        total_fee_kas: Math.round(agg.total_fee_kas * 1000) / 1000,
        avg_fee_kas: Math.round(agg.avg_fee_kas * 10000) / 10000,
        breakdown: breakdown.map(b => ({ side: b.side, count: b.c, fee_kas: Math.round(b.fee_kas * 1000) / 1000 })),
        state_distribution: stateDist.map(s => ({ state: s.state, count: s.c })),
        filter_semantics: 'broker_fee_kas IS NOT NULL AND state NOT IN (expired/failed/refunded/refunding)',
      });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // KI 65 Block B.2 (Owner 5/23 钦定): broker self-query own fee history.
  //
  // GET /api/admin/broker/my-fees?relayId=<self id>
  //   collected_{24h,7d,30d,alltime}, pending_settle (= confirming未 chain block confirm),
  //   recent_trades (last 10), fee_rate config.
  //
  // multi-broker note: relayId param required (= broker self-identifies).
  // single-broker pre-v2: relayId mismatches primary broker → 404.
  fastify.get('/api/admin/broker/my-fees', async (request, reply) => {
    try {
      const relayId = String(request.query?.relayId || '').trim();
      if (!relayId) return reply.code(400).send({ error: 'relayId query param required' });
      const broker = sqlite.prepare(`
        SELECT id, name, address, roles_json, fee_rate_override FROM relay_nodes WHERE id = ?
      `).get(relayId);
      if (!broker) return reply.code(404).send({ error: `relay ${relayId} not found` });
      const isBroker = (() => {
        try { return JSON.parse(broker.roles_json || '[]').includes('broker'); }
        catch { return false; }
      })();
      if (!isBroker) return reply.code(400).send({ error: `relay ${broker.name} is not a broker (roles_json: ${broker.roles_json})` });

      const includeTest = String(request.query?.include_test || '') === '1';  // KI 65 #85.3
      const testFilter = includeTest ? '' : ` AND id NOT LIKE 'test-%' AND id NOT LIKE 'test_%'`;
      const settleSql = `broker_fee_kas IS NOT NULL AND state NOT IN ('expired','failed','refunded','refunding')`;
      const aggFor = (rangeSql) => sqlite.prepare(`
        SELECT COUNT(*) AS trade_count, COALESCE(SUM(CAST(broker_fee_kas AS REAL)), 0) AS total_fee_kas
        FROM retail_dex_orders WHERE ${settleSql} ${rangeSql} ${testFilter}
      `).get();
      const c24h = aggFor(`AND created_at > datetime('now', '-1 day')`);
      const c7d = aggFor(`AND created_at > datetime('now', '-7 days')`);
      const c30d = aggFor(`AND created_at > datetime('now', '-30 days')`);
      const cAll = aggFor('');
      // pending_settle = confirming state with fee allocated, awaiting Kaspa block confirm
      const pendingRow = sqlite.prepare(`
        SELECT COUNT(*) AS c, COALESCE(SUM(CAST(broker_fee_kas AS REAL)), 0) AS pending_fee
        FROM retail_dex_orders WHERE state='confirming' AND broker_fee_kas IS NOT NULL ${testFilter}
      `).get();
      const recent = sqlite.prepare(`
        SELECT id, side, state, qty, broker_fee_kas, net_delivery_kas, created_at
        FROM retail_dex_orders WHERE broker_fee_kas IS NOT NULL ${testFilter}
        ORDER BY created_at DESC LIMIT 10
      `).all();

      const FEE_RATE_FALLBACK = 0.005;
      const feeRate = (broker.fee_rate_override != null) ? broker.fee_rate_override : FEE_RATE_FALLBACK;
      return reply.send({
        ok: true,
        ts: new Date().toISOString(),
        broker: { id: broker.id, name: broker.name, address: broker.address, fee_rate: feeRate, fee_rate_source: broker.fee_rate_override != null ? 'override' : 'system_default' },
        collected: {
          d1: { trades: c24h.trade_count, fee_kas: Math.round(c24h.total_fee_kas * 1000) / 1000 },
          d7: { trades: c7d.trade_count, fee_kas: Math.round(c7d.total_fee_kas * 1000) / 1000 },
          d30: { trades: c30d.trade_count, fee_kas: Math.round(c30d.total_fee_kas * 1000) / 1000 },
          alltime: { trades: cAll.trade_count, fee_kas: Math.round(cAll.total_fee_kas * 1000) / 1000 },
        },
        pending_settle: {
          trades: pendingRow.c,
          fee_kas: Math.round(pendingRow.pending_fee * 1000) / 1000,
          note: 'state=confirming, KAS delivery TX broadcast but awaiting block confirm',
        },
        recent_trades: recent.map(r => ({
          id: r.id, side: r.side, state: r.state,
          qty_kas: r.qty, fee_kas: r.broker_fee_kas, net_delivery_kas: r.net_delivery_kas,
          created_at: r.created_at,
        })),
      });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // KI 65 Step 2 Phase 1B (Owner 5/23 钦定): stress test funding endpoint.
  //
  // POST /api/admin/stress-test-fund
  //   body: { dryRun: boolean=true, asset: 'USDT'=default, amount_per: 10=default, chain: 'bnb'=default }
  //   auth: x-ingest-secret (= mutation endpoint, Owner only)
  //
  // dryRun=true (default): simulate + return manifest, NO transfer.
  // dryRun=false: real transfer 10 × $amount_per from Trader-B BSC wallet to each stress-* relay.
  //
  // Safety:
  //   - Auth required (mutation endpoint)
  //   - dryRun default true (= 防 accidental fire)
  //   - Pre-flight: Trader-B BSC wallet balance >= 10 × amount_per + gas margin
  //   - Records chain_event 'stress_test_funded' per transfer (audit chain)
  //   - 0 stress-* relay → no-op return
  // KI 65 Step 2 Phase 4 (NWT N19.248): admin Panel D — stress test run dashboard.
  // GET /api/admin/stress-test-runs?limit=10
  //   List latest stress_test_runs + scenario summary + chain_event refs count.
  fastify.get('/api/admin/stress-test-runs', async (request, reply) => {
    try {
      const limit = Math.min(50, Math.max(1, parseInt(request.query?.limit || 10, 10)));
      const runs = sqlite.prepare(`
        SELECT id, seed, dry_run, mode, started_at, ended_at, status,
               scenarios_planned, scenarios_executed, aborted_at_scenario, notes
        FROM stress_test_runs ORDER BY started_at DESC LIMIT ?
      `).all(limit);
      const out = runs.map(r => {
        const okCount = sqlite.prepare(`SELECT COUNT(*) c FROM stress_test_scenario_results WHERE run_id=? AND ok=1`).get(r.id).c;
        const failCount = sqlite.prepare(`SELECT COUNT(*) c FROM stress_test_scenario_results WHERE run_id=? AND ok=0`).get(r.id).c;
        const chainRefCount = sqlite.prepare(`
          SELECT COUNT(*) c FROM stress_test_chain_event_refs
          WHERE scenario_result_id IN (SELECT id FROM stress_test_scenario_results WHERE run_id = ?)
        `).get(r.id).c;
        return {
          id: r.id,
          seed: r.seed,
          dry_run: !!r.dry_run,
          mode: r.mode,
          started_at: r.started_at,
          ended_at: r.ended_at,
          status: r.status,
          scenarios_planned: r.scenarios_planned,
          scenarios_executed: r.scenarios_executed,
          aborted_at_scenario: r.aborted_at_scenario,
          ok_count: okCount,
          fail_count: failCount,
          chain_event_count: chainRefCount,
          notes: r.notes,
        };
      });
      return reply.send({ ok: true, ts: new Date().toISOString(), runs: out });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET /api/admin/stress-test-runs/:id — detail of single run with scenario_results + chain_event refs.
  fastify.get('/api/admin/stress-test-runs/:id', async (request, reply) => {
    try {
      const run = sqlite.prepare(`SELECT * FROM stress_test_runs WHERE id = ?`).get(request.params.id);
      if (!run) return reply.code(404).send({ error: 'run not found' });
      const results = sqlite.prepare(`
        SELECT id, scenario_id, fired_at, ok, error, selected_relays
        FROM stress_test_scenario_results WHERE run_id = ?
        ORDER BY fired_at
      `).all(run.id);
      const refs = sqlite.prepare(`
        SELECT r.scenario_result_id, r.chain_event_id, r.event_type, r.attributed_at,
               ce.txid, ce.from_address, ce.to_address
        FROM stress_test_chain_event_refs r
        LEFT JOIN chain_events ce ON ce.id = r.chain_event_id
        WHERE r.scenario_result_id IN (SELECT id FROM stress_test_scenario_results WHERE run_id = ?)
      `).all(run.id);
      // Phase 4: enrich chain_event refs with explorer URLs (NWT gap (b) fold)
      const { getExplorerTxUrl } = await import('../services/chains.js');
      const enriched = refs.map(r => {
        const chain = r.event_type?.startsWith('exchange_') || r.event_type === 'broker_fee_collected' ? 'kaspa' : 'bnb';
        return { ...r, explorer_url: r.txid ? getExplorerTxUrl(chain, r.txid) : null };
      });
      return reply.send({
        ok: true,
        run: { ...run, dry_run: !!run.dry_run },
        scenario_results: results.map(s => ({ ...s, ok: !!s.ok, selected_relays: s.selected_relays ? JSON.parse(s.selected_relays) : [] })),
        chain_event_refs: enriched,
      });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.post(
    '/api/admin/stress-test-fund',
    async (request, reply) => {
      try {
        const body = request.body || {};
        const dryRun = body.dryRun !== false;  // default true
        // Auth: dryRun=true bypass (= read-only preview manifest). dryRun=false requires x-ingest-secret.
        if (!dryRun) {
          try { await verifyIngestRequest(request, reply); } catch { return; }
          if (reply.sent) return;
        }
        const amountPer = parseFloat(body.amount_per || 10);
        const asset = String(body.asset || 'USDT');
        const chain = String(body.chain || 'bnb');
        if (amountPer <= 0 || amountPer > 100) return reply.code(400).send({ error: 'amount_per must be 0-100' });

        const stressRelays = sqlite.prepare(`
          SELECT id, name FROM relay_nodes WHERE name LIKE 'stress-%'
        `).all();
        if (stressRelays.length === 0) return reply.code(400).send({ error: 'no stress-* relays found — run scripts/stress-test-v2-phase1-setup.mjs first' });

        const { sqlite: db } = await import('../db/client.js');
        const recipients = [];
        for (const r of stressRelays) {
          const w = db.prepare(`SELECT address FROM agent_wallets WHERE relay_node_id = ? AND chain = ? AND is_default = 1 LIMIT 1`).get(r.id, chain);
          if (!w) {
            recipients.push({ relay_id: r.id, name: r.name, error: `no ${chain} wallet` });
            continue;
          }
          recipients.push({ relay_id: r.id, name: r.name, address: w.address, amount: amountPer, asset, chain });
        }

        // Broker BSC wallet (= Trader-B 默认 source)
        const brokerWallet = db.prepare(`
          SELECT aw.privkey_encrypted, aw.address FROM agent_wallets aw
          INNER JOIN relay_nodes rn ON aw.relay_node_id = rn.id
          WHERE rn.is_dex_broker = 1 AND aw.chain = ? AND aw.is_default = 1
          ORDER BY rn.created_at ASC LIMIT 1
        `).get(chain);
        if (!brokerWallet) return reply.code(500).send({ error: `broker ${chain} wallet not found` });

        const totalNeeded = recipients.filter(r => !r.error).length * amountPer;

        if (dryRun) {
          return reply.send({
            ok: true,
            dryRun: true,
            asset, chain, amount_per: amountPer,
            total_needed: totalNeeded,
            source: { address: brokerWallet.address, broker: 'Trader-B' },
            recipients,
            note: 'dryRun=true — NO real transfer. POST with dryRun:false to fire (Owner explicit ack).',
          });
        }

        // Real transfer
        const { transferUsdt } = await import('../services/evm-transfer.js');
        const results = [];
        for (const r of recipients) {
          if (r.error) { results.push(r); continue; }
          try {
            const tx = await transferUsdt(chain, brokerWallet.privkey_encrypted, r.address, amountPer, asset);
            results.push({ ...r, ok: tx.ok, tx_hash: tx.txHash, error: tx.error });
            if (tx.ok) {
              recordChainEvent({
                txid: tx.txHash,
                eventType: 'stress_test_funded',
                fromAddress: brokerWallet.address,
                toAddress: r.address,
                payload: JSON.stringify({ relay_id: r.relay_id, name: r.name, amount: amountPer, asset, chain }),
              });
            }
          } catch (err) {
            results.push({ ...r, ok: false, error: err.message });
          }
        }
        return reply.send({ ok: true, dryRun: false, asset, chain, results });
      } catch (err) {
        return reply.code(500).send({ error: err.message });
      }
    },
  );
}
