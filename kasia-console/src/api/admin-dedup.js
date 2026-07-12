// #27 (Owner 钦定 2026-07-03 公测门面): 重复盘 refund-cleanup admin endpoint.
// localhost-only, operator-triggered — 批量/单个把指定 market_id 走真退款路径 (dispatchRefund),
// 绝不裸 UPDATE protocol_status='cancelled' (会断 settler 退款路, 见记忆
// feedback-pool-market-status-cancel-breaks-settler-refund)。
import { sqlite } from '../db/client.js';
import { dispatchRefund } from '../services/pool-market-settler.js';
import { verifyIngestRequest } from '../services/ingest-auth.js';
import { getSidesByLogicalMarket } from '../lib/pool-bettor-sides-query.mjs';

const HEX64 = /^[0-9a-fA-F]{64}$/;

// 🔴 容器①/②普适口径(2026-07-12, 7pori 撞见, Bettor 裁"(a)带交叉核验"+NWT 加固 #hnppoc.2 后续):
// dispatchRefund 本体只退 maker(见上方注释), 对"bettor 已经通过独立机制(容器②/cancelMarketLive)全额
// 安全退完"的终态盘(status='refunded')原逻辑会双重拒(status 不在白名单 + betCount>0)——但这类盘
// 恰恰是唯一还差 maker bond 没收口的情况, 反而被现有 guard 挡死, 逼人手动碰未审计的临时调用点。
// 本函数判定"是否已有可信的容器②完成证据"——不只查字段存在(caller 可摆布的裸 flag), 而是交叉核对
// refund_evidence.refunds[] 与该市场【实际 pool_bettor_sides 行】逐笔 pk+amount 双向吻合(bijective,
// 无多无少), 且 cancel_txid 是真 64-hex(非占位符)。任一环节不吻合 → 视为"没有可信证据", 照旧拒绝
// (fail-closed, 不猜)。
export function hasVerifiedContainer2Evidence(market, sides) {
  let meta = {};
  try { meta = JSON.parse(market.metadata || '{}'); } catch { return false; }
  const ev = meta.refund_evidence;
  if (!ev || typeof ev !== 'object') return false;
  if (ev.complete !== true) return false;
  if (typeof ev.cancel_txid !== 'string' || !HEX64.test(ev.cancel_txid)) return false;
  if (!Array.isArray(ev.refunds) || ev.refunds.length !== sides.length) return false;
  const sidesByPk = new Map(sides.map((s) => [String(s.bettor_pk).toLowerCase(), String(s.stake_amount)]));
  const seenPks = new Set();
  for (const r of ev.refunds) {
    if (!r || typeof r.pk !== 'string') return false;
    const pk = r.pk.toLowerCase();
    if (seenPks.has(pk)) return false;   // 防重复条目虚报覆盖度
    seenPks.add(pk);
    const expectedStake = sidesByPk.get(pk);
    if (expectedStake === undefined) return false;   // refund 里有条目对不上任何一行真实 bettor_pk
    if (String(r.amount) !== expectedStake) return false;   // 金额必须逐位吻合(非"差不多")
  }
  return seenPks.size === sides.length;   // 双向: 每一行真实 bettor 都被覆盖, 无遗漏
}

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
      const sides = getSidesByLogicalMarket(id, sqlite);
      const betCount = sides.length;
      const isStandardStatus = ['pending_bettors', 'verifying', 'pending_oracle_deposits'].includes(market.protocol_status);
      const isPostContainer2 = market.protocol_status === 'refunded' && betCount > 0 && hasVerifiedContainer2Evidence(market, sides);
      if (!isStandardStatus && !isPostContainer2) {
        results.push({ id, ok: false, error: `unexpected status ${market.protocol_status}, refused (safety)` });
        continue;
      }
      // dispatchRefund = maker-only "0-bet market" refund path (refund_maker_unjoined). A market
      // with real bettor stakes needs the all-bettor refund mechanism instead — calling dispatchRefund
      // on it would refund the maker and silently strand the bettors' funds. Refuse, don't guess.
      // isPostContainer2 例外: bettor 侧已经过独立机制(容器②)交叉验证完全退完, betCount>0 不再是
      // "会 strand bettor 资金"的信号, 而是"maker bond 还没收口"的信号——两种情形要区分对待。
      if (betCount > 0 && !isPostContainer2) {
        results.push({ id, ok: false, error: `market has ${betCount} real bettor side(s) — dispatchRefund is maker-only, refused (safety)` });
        continue;
      }
      try {
        await dispatchRefund(market, { reason: reason || (isPostContainer2 ? 'container1 maker bond recovery (post-container2 verified refund)' : '#27 dedup cleanup') });
        const after = sqlite.prepare('SELECT protocol_status FROM pool_markets WHERE id = ?').get(id);
        results.push({ id, ok: after?.protocol_status === 'refunding', status: after?.protocol_status });
      } catch (e) {
        results.push({ id, ok: false, error: e.message });
      }
    }
    return reply.send({ ok: true, results });
  });
}
