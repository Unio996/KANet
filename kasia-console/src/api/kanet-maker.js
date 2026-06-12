// kanet-maker.js — maker 数据视图端点 (Lane① 数据三角色补齐, Bettor r639 事先审 PASS).
//
// 镜像 kanet-broker.js (markets + pnl). 守 Bettor 铁律: template↔endpoint 字段一开始对齐
// (broker 显 0 根因=不对齐; 这里 eta 读的字段名 = 此处 reply 的字段名, 逐字对应).
//
// P&L 算法 (读实际值非估算, J2 settler 记 phase2_maker_payout_sompi):
//   settled: pnl = phase2_maker_payout_sompi (maker winner output, 输=0) - maker_stake_amount
//            (赢 → pnl=净winnings 正; 输 → pnl=-stake 负)
//   active:  at_risk = maker_stake_amount (在押未结)
//   refunded: pnl=0 (stake 退回)
//   无 phase2_maker_payout_sompi (J2 backfill 前): status='settled_pending_payout', 不计入 realized (不瞎估)
import { sqlite } from '../db/client.js';

export async function registerKanetMakerRoutes(fastify) {
  // GET /api/kanet-maker/markets/:relay_id — maker 名下市场 + totals.
  // Response: { ok, relay_id, pool_markets: [...], totals: { pool_active, pool_settled, pool_refunded } }
  fastify.get('/api/kanet-maker/markets/:relay_id', async (request, reply) => {
    const { relay_id } = request.params;
    if (!relay_id) return reply.code(400).send({ ok: false, error: 'relay_id required' });

    const poolMarkets = sqlite.prepare(`
      SELECT id, protocol_status, maker_stake_amount, broker_fee_pct, outcome_side, settle_txid, refund_txid, updated_at
      FROM pool_markets WHERE maker_relay_id = ?
      ORDER BY updated_at DESC
    `).all(relay_id);

    const totals = {
      pool_active: poolMarkets.filter(m => !m.settle_txid && !m.refund_txid).length,
      pool_settled: poolMarkets.filter(m => !!m.settle_txid).length,
      pool_refunded: poolMarkets.filter(m => !!m.refund_txid).length,
    };

    return reply.send({ ok: true, relay_id, pool_markets: poolMarkets, totals });
  });

  // GET /api/kanet-maker/pnl/:relay_id — maker 盈亏 (镜像 kanet-broker earnings 结构).
  // Returns:
  //   { ok, relay_id,
  //     realized: { net_kas, n_markets },     // 已结算净盈亏 (payout - stake 之和; 可负)
  //     pending:  { at_risk_kas, n_markets },  // active 市场在押 stake
  //     refunded: { n_markets },               // 退回 (pnl=0)
  //     by_market: [{ id, stake_kas, payout_kas, pnl_kas, status }] }
  fastify.get('/api/kanet-maker/pnl/:relay_id', async (request, reply) => {
    const { relay_id } = request.params;
    if (!relay_id) return reply.code(400).send({ ok: false, error: 'relay_id required' });

    const rows = sqlite.prepare(`
      SELECT id, maker_stake_amount, settle_txid, refund_txid, protocol_status, metadata, updated_at
      FROM pool_markets WHERE maker_relay_id = ?
      ORDER BY updated_at DESC
    `).all(relay_id);

    let realizedNetSompi = 0n;
    let realizedN = 0;
    let pendingStakeSompi = 0n;
    let pendingN = 0;
    let refundedN = 0;
    const byMarket = [];

    for (const r of rows) {
      const stake = BigInt(r.maker_stake_amount || 0);
      const isSettled = !!r.settle_txid;
      const isRefunded = !!r.refund_txid;

      // J2 settler 记的实际 maker payout (winner output 额, 输=0). 无 = backfill 前.
      let payoutSompi = null;
      if (isSettled && r.metadata) {
        try { const _m = JSON.parse(r.metadata); if (_m.phase2_maker_payout_sompi != null) payoutSompi = BigInt(_m.phase2_maker_payout_sompi); } catch {}
      }

      let status, pnlSompi = null, payoutKas = null;
      if (isRefunded) {
        status = 'refunded';
        pnlSompi = 0n;
        refundedN += 1;
      } else if (isSettled && payoutSompi != null) {
        status = 'settled';
        pnlSompi = payoutSompi - stake;   // 赢=净winnings 正, 输=-stake 负
        payoutKas = (Number(payoutSompi) / 1e8).toFixed(8);
        realizedNetSompi += pnlSompi;
        realizedN += 1;
      } else if (isSettled) {
        // settled 但 J2 还没记 payout (backfill 前): 不瞎估, 标待回填
        status = 'settled_pending_payout';
      } else {
        // active: 在押
        status = 'active';
        pendingStakeSompi += stake;
        pendingN += 1;
      }

      byMarket.push({
        id: r.id,
        stake_kas: (Number(stake) / 1e8).toFixed(8),
        payout_kas: payoutKas,
        pnl_kas: pnlSompi != null ? (Number(pnlSompi) / 1e8).toFixed(8) : null,
        status,
      });
    }

    return reply.send({
      ok: true,
      relay_id,
      realized: { net_kas: (Number(realizedNetSompi) / 1e8).toFixed(8), n_markets: realizedN },
      pending: { at_risk_kas: (Number(pendingStakeSompi) / 1e8).toFixed(8), n_markets: pendingN },
      refunded: { n_markets: refundedN },
      by_market: byMarket,
    });
  });
}
