// treasury.js — Phase 5-2 Sub-4 KI 39 trend endpoint (NWT N19.70 spec, J2 ship)
//
// /api/treasury/trend?days=7&chain=&asset=  → 时序聚合 treasury_snapshot 表
// 用于 docs/exchange-asset-snapshot-*.md Sec 4 修 7-day trend (现 placeholder).

import { sqlite } from '../db/client.js';

export async function registerTreasuryRoutes(fastify) {
  fastify.get('/api/treasury/trend', async (request, reply) => {
    const days = Math.min(parseInt(request.query?.days) || 7, 30);
    const chain = request.query?.chain || null;
    const asset = request.query?.asset || null;
    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    try {
      const params = [sinceIso];
      let sql = `
        SELECT DATE(snapshot_at) day, chain, asset,
               MIN(balance_human) min_bal,
               MAX(balance_human) max_bal,
               AVG(balance_human) avg_bal,
               COUNT(*) sample_count
        FROM treasury_snapshot
        WHERE snapshot_at > ?
      `;
      if (chain) { sql += ' AND chain = ?'; params.push(chain); }
      if (asset) { sql += ' AND asset = ?'; params.push(asset); }
      sql += ' GROUP BY day, chain, asset ORDER BY day DESC, chain, asset';
      const rows = sqlite.prepare(sql).all(...params);
      return reply.send({
        ok: true,
        days, chain, asset,
        data: rows.map(r => ({
          day: r.day,
          chain: r.chain,
          asset: r.asset,
          min: Number(r.min_bal.toFixed(4)),
          max: Number(r.max_bal.toFixed(4)),
          avg: Number(r.avg_bal.toFixed(4)),
          samples: r.sample_count,
        })),
      });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });

  // Latest snapshot per (chain, asset) — convenience for current state
  fastify.get('/api/treasury/latest', async (request, reply) => {
    try {
      const rows = sqlite.prepare(`
        SELECT chain, asset, balance_human, snapshot_at, source
        FROM treasury_snapshot
        WHERE id IN (
          SELECT MAX(id) FROM treasury_snapshot GROUP BY chain, asset
        )
        ORDER BY chain, asset
      `).all();
      return reply.send({ ok: true, latest: rows });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });
}
