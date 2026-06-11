// KANet broker API — cross-domain broker stats (Bettor r30 钦定 namespace /api/kanet-broker/*).
//
// KANet broker 跨 3 domain: pool prediction markets + retail dex orders (+ exchange OTC P2P 无 broker).
// 数据源 grep 实证 (J2 r109):
//   - pool_markets (v62+): broker_relay_id (v135) + broker_fee_pct bps + maker_stake_amount + settle_txid
//   - retail_dex_orders (v83): broker_relay_id + broker_fee_kas (TEXT) + state + agent_pay_addr
//
// Iron Rule (Bettor r21/r22/r23 + Owner 钦定):
//   ① user-need: broker 第一视角看自己赚多少 / 跑了多少市场 / 跨域统一视图
//   ② 必要: UI Gap 1 broker home 必需 (= role-home 模板 5 块的"收入" + "状态" 块数据源)
//   ③ 不重复: 不撞 /api/broker/* (= 美股证券 broker namespace, broker.js 已占), 不撞 /api/pool/* (= 单 market 视角不 broker 维度)
//   ④ 充分理由: 跨域聚合 = broker 看不到分散视图, UI 必汇总, 1 endpoint 替 UI 多 RTT
//   ⑤ 简单高效: 2 endpoint 直 SQL JOIN, 无中间层

import { sqlite } from '../db/client.js';

export async function registerKanetBrokerRoutes(fastify) {
  // GET /api/kanet-broker/markets/:relay_id — 列名下市场 + 订单 (跨域)
  // Response: { relay_id, pool_markets: [...], retail_dex_orders: [...], totals: {...} }
  fastify.get('/api/kanet-broker/markets/:relay_id', async (request, reply) => {
    const { relay_id } = request.params;
    if (!relay_id) return reply.code(400).send({ ok: false, error: 'relay_id required' });

    const poolMarkets = sqlite.prepare(`
      SELECT id, protocol_status, broker_fee_pct, maker_stake_amount,
             outcome_market_source, outcome_condition_id, resolution_rule_spec,
             deadline, settle_txid, refund_txid, created_at
      FROM pool_markets
      WHERE broker_relay_id = ?
      ORDER BY created_at DESC
    `).all(relay_id);

    // retail-dex orders use system-wide configured broker (retail_dex_broker_config) not per-order
    // broker_relay_id. So: return all retail orders only if THIS relay_id is configured retail broker.
    const isRetailBroker = sqlite.prepare(
      'SELECT 1 FROM retail_dex_broker_config WHERE broker_relay_id = ? LIMIT 1'
    ).get(relay_id);
    const retailOrders = isRetailBroker ? sqlite.prepare(`
      SELECT id, state, broker_fee_kas, agent_pay_addr,
             mid_price_at_quote, expires_at, created_at, deliver_tx_hash, refund_tx_hash
      FROM retail_dex_orders
      ORDER BY created_at DESC
    `).all() : [];

    const totals = {
      pool_active: poolMarkets.filter(m => !m.settle_txid && !m.refund_txid).length,
      pool_settled: poolMarkets.filter(m => !!m.settle_txid).length,
      pool_refunded: poolMarkets.filter(m => !!m.refund_txid).length,
      retail_active: retailOrders.filter(o => o.state !== 'completed' && o.state !== 'refunded' && o.state !== 'cancelled').length,
      retail_completed: retailOrders.filter(o => o.state === 'completed').length,
      retail_refunded: retailOrders.filter(o => o.state === 'refunded').length,
    };

    return reply.send({
      ok: true,
      relay_id,
      pool_markets: poolMarkets,
      retail_dex_orders: retailOrders,
      totals,
    });
  });

  // GET /api/kanet-broker/earnings/:relay_id — 历史 broker fee 累计 (跨域)
  //
  // Pool fee math: fee_kas = (maker_stake_amount × broker_fee_pct / 10000) / 1e8
  //   (per PoolSpine_v06.sil L165 + bettor-prediction-settler.js:282 strict require)
  //   Realized only when settle_txid set; pending if status active.
  //
  // Retail fee: broker_fee_kas stored directly as TEXT KAS (v72), realized when settle_tx_hash set.
  //
  // Returns:
  //   { relay_id,
  //     realized: { pool_kas, retail_kas, total_kas, n_markets, n_orders },
  //     pending:  { pool_kas, retail_kas, total_kas, n_markets, n_orders },
  //     by_market: [{ source: 'pool'|'retail', id, fee_kas, status, settled_at }, ...] }
  fastify.get('/api/kanet-broker/earnings/:relay_id', async (request, reply) => {
    const { relay_id } = request.params;
    if (!relay_id) return reply.code(400).send({ ok: false, error: 'relay_id required' });

    const poolRows = sqlite.prepare(`
      SELECT id, broker_fee_pct, maker_stake_amount, protocol_status, settle_txid, refund_txid, updated_at, metadata
      FROM pool_markets WHERE broker_relay_id = ?
    `).all(relay_id);

    // Same retail-broker scope as above: system-wide broker config, return all if configured.
    const isRetailBroker = sqlite.prepare(
      'SELECT 1 FROM retail_dex_broker_config WHERE broker_relay_id = ? LIMIT 1'
    ).get(relay_id);
    const retailRows = isRetailBroker ? sqlite.prepare(`
      SELECT id, broker_fee_kas, state, deliver_tx_hash, refund_tx_hash, updated_at
      FROM retail_dex_orders
    `).all() : [];

    let realizedPoolSompi = 0n;
    let pendingPoolSompi = 0n;
    let refundedPoolSompi = 0n; // KANet-UI (Bettor r618): refunded 市场 fee (被退, broker 未赚)
    let realizedPoolN = 0;
    let pendingPoolN = 0;
    let refundedPoolN = 0;
    const byMarket = [];

    for (const r of poolRows) {
      const isRealized = !!r.settle_txid;
      // J2-tn (Bettor r617 ②): settled 市场用【实际落链 broker fee】= settler 记的 phase2_broker_fee_sompi
      // (losingPool×fee_pct, L1364-1366), 非 maker_stake×fee_pct 估算 (gz5g7 估 2.0 KAS vs 实落 6.73 KAS)。
      // 无记录 (pending 未 settle / 旧 settle 无 phase2_broker_fee_sompi) 回退估算 (兼容 + pending 显示)。
      let actualFeeSompi = null;
      if (isRealized && r.metadata) {
        try { const _m = JSON.parse(r.metadata); if (_m.phase2_broker_fee_sompi != null) actualFeeSompi = BigInt(_m.phase2_broker_fee_sompi); } catch {}
      }
      const feeSompi = actualFeeSompi != null
        ? actualFeeSompi
        : (BigInt(r.maker_stake_amount || 0) * BigInt(r.broker_fee_pct || 0)) / 10000n;
      const isRefunded = !!r.refund_txid;
      const status = isRealized ? 'settled' : (isRefunded ? 'refunded' : r.protocol_status);
      if (isRealized) {
        realizedPoolSompi += feeSompi;
        realizedPoolN += 1;
      } else if (isRefunded) {
        refundedPoolSompi += feeSompi;
        refundedPoolN += 1;
      } else {
        pendingPoolSompi += feeSompi;
        pendingPoolN += 1;
      }
      byMarket.push({
        source: 'pool',
        id: r.id,
        fee_kas: (Number(feeSompi) / 1e8).toFixed(8),
        status,
        settled_at: isRealized ? r.updated_at : null,
      });
    }

    let realizedRetailKas = 0;
    let pendingRetailKas = 0;
    let refundedRetailKas = 0;
    let realizedRetailN = 0;
    let pendingRetailN = 0;
    let refundedRetailN = 0;

    for (const r of retailRows) {
      const fee = parseFloat(r.broker_fee_kas || '0') || 0;
      const isRealized = !!r.deliver_tx_hash && r.state === 'completed';
      const isRefunded = !!r.refund_tx_hash || r.state === 'refunded' || r.state === 'cancelled';
      const status = isRealized ? 'settled' : (isRefunded ? 'refunded' : r.state);
      if (isRealized) {
        realizedRetailKas += fee;
        realizedRetailN += 1;
      } else if (isRefunded) {
        refundedRetailKas += fee;
        refundedRetailN += 1;
      } else {
        pendingRetailKas += fee;
        pendingRetailN += 1;
      }
      byMarket.push({
        source: 'retail',
        id: r.id,
        fee_kas: fee.toFixed(8),
        status,
        settled_at: isRealized ? r.updated_at : null,
      });
    }

    const realizedPoolKas = Number(realizedPoolSompi) / 1e8;
    const pendingPoolKas = Number(pendingPoolSompi) / 1e8;
    const refundedPoolKas = Number(refundedPoolSompi) / 1e8;

    return reply.send({
      ok: true,
      relay_id,
      realized: {
        pool_kas: realizedPoolKas.toFixed(8),
        retail_kas: realizedRetailKas.toFixed(8),
        total_kas: (realizedPoolKas + realizedRetailKas).toFixed(8),
        n_markets: realizedPoolN,
        n_orders: realizedRetailN,
      },
      pending: {
        pool_kas: pendingPoolKas.toFixed(8),
        retail_kas: pendingRetailKas.toFixed(8),
        total_kas: (pendingPoolKas + pendingRetailKas).toFixed(8),
        n_markets: pendingPoolN,
        n_orders: pendingRetailN,
      },
      refunded: {
        pool_kas: refundedPoolKas.toFixed(8),
        retail_kas: refundedRetailKas.toFixed(8),
        total_kas: (refundedPoolKas + refundedRetailKas).toFixed(8),
        n_markets: refundedPoolN,
        n_orders: refundedRetailN,
      },
      by_market: byMarket,
    });
  });
}
