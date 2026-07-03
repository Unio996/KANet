// #27 (Owner 钦定 2026-07-03 公测门面): 重复盘 refund-cleanup admin endpoint.
// localhost-only, operator-triggered — 批量/单个把指定 market_id 走真退款路径 (dispatchRefund),
// 绝不裸 UPDATE protocol_status='cancelled' (会断 settler 退款路, 见记忆
// feedback-pool-market-status-cancel-breaks-settler-refund)。
import { sqlite } from '../db/client.js';
import { dispatchRefund } from '../services/pool-market-settler.js';
import { verifyIngestRequest } from '../services/ingest-auth.js';
import { getSidesByLogicalMarket } from '../lib/pool-bettor-sides-query.mjs';

export async function registerAdminDedupRoutes(fastify) {
  // POST /api/admin/dedup-refund { marketIds: [...], reason: '...' }
  fastify.post('/api/admin/dedup-refund', { preHandler: async (request, reply) => { await verifyIngestRequest(request, reply); } }, async (request, reply) => {
    const { marketIds, reason } = request.body || {};
    if (!Array.isArray(marketIds) || !marketIds.length) {
      return reply.code(400).send({ ok: false, error: 'marketIds must be a non-empty array' });
    }
    const results = [];
    for (const id of marketIds) {
      const market = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(id);
      if (!market) { results.push({ id, ok: false, error: 'not_found' }); continue; }
      if (!['pending_bettors', 'verifying', 'pending_oracle_deposits'].includes(market.protocol_status)) {
        results.push({ id, ok: false, error: `unexpected status ${market.protocol_status}, refused (safety)` });
        continue;
      }
      // dispatchRefund = maker-only "0-bet market" refund path (refund_maker_unjoined). A market
      // with real bettor stakes needs the all-bettor refund mechanism instead — calling dispatchRefund
      // on it would refund the maker and silently strand the bettors' funds. Refuse, don't guess.
      const betCount = getSidesByLogicalMarket(id, sqlite).length;
      if (betCount > 0) {
        results.push({ id, ok: false, error: `market has ${betCount} real bettor side(s) — dispatchRefund is maker-only, refused (safety)` });
        continue;
      }
      try {
        await dispatchRefund(market, { reason: reason || '#27 dedup cleanup' });
        const after = sqlite.prepare('SELECT protocol_status FROM pool_markets WHERE id = ?').get(id);
        results.push({ id, ok: after?.protocol_status === 'refunding', status: after?.protocol_status });
      } catch (e) {
        results.push({ id, ok: false, error: e.message });
      }
    }
    return reply.send({ ok: true, results });
  });
}
