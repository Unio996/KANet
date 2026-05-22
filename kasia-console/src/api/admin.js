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

      // Latest broker activity from chain_events where from_address=broker.kasia OR observed_by mentions broker name
      const brokers = brokerRows.map(b => {
        let scope = [];
        try { scope = JSON.parse(b.scope_json || '[]'); } catch {}

        // Per-chain USDT/USDC balance (broker-specific filter)
        const balances = treasuryRows
          .filter(t => t.relay_node_id === b.id)
          .map(t => ({ chain: t.chain, asset: t.asset, amount: Number((t.balance_human || 0).toFixed(4)) }));

        const kasBalance = balances.find(x => x.chain === 'kaspa' && x.asset === 'KAS')?.amount ?? null;
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
          ageMin = Math.floor((Date.now() - new Date(lastActivityTs.replace(' ', 'T') + 'Z').getTime()) / 60000);
        }

        // Status derive: <5min active / <60min idle / else down
        let status = 'unknown';
        if (ageMin === null) status = 'unknown';
        else if (ageMin < 5) status = 'alive';
        else if (ageMin < 60) status = 'idle';
        else status = 'down';

        return {
          id: b.id,
          name: b.name,
          address: b.address,
          scope,
          kas_pool: kasBalance,
          usdt_by_chain: usdtByChain,
          dm_count_today: b.dm_count_today || 0,
          dm_cap: 200,  // Daily DM cap per relay (KI 63 sediment, fixed for now)
          hedge_24h: { placed: hedgeRow?.placed || 0, failed: hedgeRow?.failed || 0, skipped: hedgeRow?.skipped || 0 },
          last_activity: lastActivityTs,
          age_min: ageMin,
          status,
        };
      });

      return reply.send({
        ok: true,
        ts: new Date().toISOString(),
        market,
        brokers,
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
}
