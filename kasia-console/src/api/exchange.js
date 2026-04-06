/**
 * Exchange API — 协议级自由市场
 *
 * 设计文档: 自由市场设计决策文档 v1.1
 * DB 表: exchange_offers (v38)
 * 协议消息: kanet_exchange_v1 / kanet_exchange_accept_v1 / kanet_exchange_cancel_v1
 */

import { sqlite } from '../db/client.js';
import { processAccept, processCancel, processManualConfirm, processPaymentSubmit, processDispute, expireStale } from '../services/exchange-machine.js';

export async function registerExchangeRoutes(fastify) {

  // ── GET /api/exchange/offers — 查询报价列表 ──────────────────
  fastify.get('/api/exchange/offers', async (request, reply) => {
    const {
      market_key,
      status,
      maker,
      limit = 50,
      offset = 0,
    } = request.query;

    let where = '1=1';
    const params = [];

    if (market_key) {
      where += ' AND market_key = ?';
      params.push(market_key);
    }
    if (status) {
      where += ' AND protocol_status = ?';
      params.push(status);
    } else {
      // Default: exclude expired/cancelled
      where += " AND protocol_status NOT IN ('expired', 'cancelled')";
    }
    if (maker) {
      where += ' AND maker = ?';
      params.push(maker);
    }

    // Expire stale offers
    sqlite.prepare(`
      UPDATE exchange_offers
      SET protocol_status = 'expired', updated_at = datetime('now')
      WHERE protocol_status = 'open' AND expires_at IS NOT NULL AND expires_at < datetime('now')
    `).run();

    const rows = sqlite.prepare(`
      SELECT * FROM exchange_offers
      WHERE ${where}
      ORDER BY broadcast_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, Number(limit), Number(offset));

    const total = sqlite.prepare(
      `SELECT COUNT(*) as cnt FROM exchange_offers WHERE ${where}`
    ).get(...params);

    // Market groups summary
    const groups = sqlite.prepare(`
      SELECT market_key, COUNT(*) as cnt
      FROM exchange_offers
      WHERE protocol_status = 'open'
      GROUP BY market_key
      ORDER BY cnt DESC
    `).all();

    return reply.send({
      offers: rows,
      total: total.cnt,
      groups,
      node_info: {
        note: '数据来自本节点索引，非全网完整订单簿',
      },
    });
  });

  // ── GET /api/exchange/offers/:id — 单个报价详情 ──────────────
  fastify.get('/api/exchange/offers/:id', async (request, reply) => {
    const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?')
      .get(request.params.id);
    if (!offer) return reply.code(404).send({ error: 'Offer not found' });
    return reply.send(offer);
  });

  // ── GET /api/exchange/markets — 活跃市场对列表 ──────────────
  fastify.get('/api/exchange/markets', async (request, reply) => {
    const markets = sqlite.prepare(`
      SELECT market_key,
        COUNT(*) as total_offers,
        SUM(CASE WHEN protocol_status = 'open' THEN 1 ELSE 0 END) as open_offers,
        SUM(CASE WHEN protocol_status = 'completed' THEN 1 ELSE 0 END) as completed,
        MIN(broadcast_at) as first_seen,
        MAX(broadcast_at) as last_seen
      FROM exchange_offers
      GROUP BY market_key
      ORDER BY open_offers DESC, total_offers DESC
    `).all();
    return reply.send({ markets });
  });

  // ── POST /api/exchange/publish — 发起报价（通过 Relay 广播）──
  fastify.post('/api/exchange/publish', async (request, reply) => {
    const {
      relayNodeId,
      give_asset, give_amount, give_chain,
      want_asset, want_amount, want_chain,
      expires_minutes = 60,
      verification = 'manual',
      verification_meta = {},
      channel = 'kanet-exchange',
    } = request.body || {};

    if (!relayNodeId || !give_asset || !give_amount || !want_asset || !want_amount) {
      return reply.code(400).send({ error: 'Missing required fields: relayNodeId, give_asset, give_amount, want_asset, want_amount' });
    }

    const { randomUUID } = await import('crypto');
    const offerId = randomUUID();
    const expiresAt = new Date(Date.now() + (expires_minutes * 60000)).toISOString();

    const now = new Date().toISOString();
    const marketKey = [give_asset, want_asset].sort().join('|');

    // Build protocol message
    const protocolMsg = {
      t: 'kanet_exchange_v1',
      id: offerId,
      give_asset,
      give_amount: String(give_amount),
      give_chain: give_chain || null,
      want_asset,
      want_amount: String(want_amount),
      want_chain: want_chain || null,
      expires_at: expiresAt,
      verification,
      verification_meta,
    };

    // Get maker address
    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relayNodeId);
    const makerAddr = relay?.address || relayNodeId;

    // Optimistic: write to local DB immediately (visible before chain confirms)
    sqlite.prepare(`
      INSERT OR IGNORE INTO exchange_offers (
        id, broadcast_tx_id, message_index,
        give_asset, give_amount, give_chain,
        want_asset, want_amount, want_chain,
        maker, broadcast_at, expires_at,
        verification, verification_meta,
        protocol_status, is_fully_observed, market_key,
        created_at, updated_at
      ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, ?, ?, ?)
    `).run(
      offerId, 'pending_' + offerId,
      give_asset, String(give_amount), give_chain || null,
      want_asset, String(want_amount), want_chain || null,
      makerAddr, now, expiresAt,
      verification, JSON.stringify(verification_meta),
      marketKey, now, now
    );

    // Async: broadcast to chain (anchor confirmation, non-blocking)
    let broadcastTx = null;
    try {
      const { sendCommandAsync } = await import('../services/relay-manager.js');
      const result = await sendCommandAsync(relayNodeId, {
        command: 'send_broadcast',
        channel,
        message: JSON.stringify(protocolMsg),
      });
      broadcastTx = result?.txId || null;
      // Update with real TX hash
      if (broadcastTx) {
        sqlite.prepare('UPDATE exchange_offers SET broadcast_tx_id = ? WHERE id = ?')
          .run(broadcastTx, offerId);
      }
    } catch (err) {
      console.log(`[exchange] Broadcast pending (relay may be syncing): ${err.message}`);
    }

    return reply.send({
      ok: true,
      offer_id: offerId,
      broadcast_tx: broadcastTx,
      expires_at: expiresAt,
    });
  });

  // ── POST /api/exchange/accept — 接单 ──────────────────────
  fastify.post('/api/exchange/accept', async (request, reply) => {
    const { relayNodeId, offer_id, channel = 'kanet-exchange' } = request.body || {};

    if (!relayNodeId || !offer_id) {
      return reply.code(400).send({ error: 'Missing relayNodeId or offer_id' });
    }

    const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
    if (!offer) return reply.code(404).send({ error: 'Offer not found' });
    if (offer.protocol_status !== 'open') {
      return reply.code(400).send({ error: `Offer is ${offer.protocol_status}, cannot accept` });
    }

    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relayNodeId);
    const takerAddr = relay?.address || relayNodeId;

    // Use state machine: open → matched → verification routing
    const result = processAccept({
      offer_id,
      _from: takerAddr,
      _tx: 'pending_accept_' + offer_id,
    });

    if (!result) {
      return reply.code(400).send({ error: 'Accept failed (offer may no longer be open)' });
    }

    // Async: broadcast to chain (anchor confirmation)
    let acceptTx = null;
    try {
      const { sendCommandAsync } = await import('../services/relay-manager.js');
      const res = await sendCommandAsync(relayNodeId, {
        command: 'send_broadcast',
        channel,
        message: JSON.stringify({ t: 'kanet_exchange_accept_v1', offer_id }),
      });
      acceptTx = res?.txId || null;
      if (acceptTx) {
        sqlite.prepare('UPDATE exchange_offers SET taker_tx_id = ? WHERE id = ?')
          .run(acceptTx, offer_id);
      }
    } catch (err) {
      console.log(`[exchange] Accept broadcast pending: ${err.message}`);
    }

    return reply.send({ ok: true, offer_id, status: result.protocol_status, accept_tx: acceptTx });
  });

  // ── POST /api/exchange/cancel — 取消报价 ─────────────────
  fastify.post('/api/exchange/cancel', async (request, reply) => {
    const { relayNodeId, offer_id, channel = 'kanet-exchange' } = request.body || {};

    if (!relayNodeId || !offer_id) {
      return reply.code(400).send({ error: 'Missing relayNodeId or offer_id' });
    }

    const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
    if (!offer) return reply.code(404).send({ error: 'Offer not found' });

    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relayNodeId);
    const makerAddr = relay?.address || relayNodeId;

    // Use state machine: only from open, only by maker
    const result = processCancel({ offer_id, _from: makerAddr });
    if (!result) {
      return reply.code(400).send({ error: 'Cancel failed (may not be open or not maker)' });
    }

    // Async: broadcast to chain
    let cancelTx = null;
    try {
      const { sendCommandAsync } = await import('../services/relay-manager.js');
      const res = await sendCommandAsync(relayNodeId, {
        command: 'send_broadcast',
        channel,
        message: JSON.stringify({ t: 'kanet_exchange_cancel_v1', offer_id }),
      });
      cancelTx = res?.txId || null;
    } catch (err) {
      console.log(`[exchange] Cancel broadcast pending: ${err.message}`);
    }

    return reply.send({ ok: true, offer_id, cancel_tx: cancelTx });
  });

  // ── POST /api/exchange/confirm — manual verification confirm ──
  fastify.post('/api/exchange/confirm', async (request, reply) => {
    const { relayNodeId, offer_id, role, channel = 'kanet-exchange' } = request.body || {};

    if (!relayNodeId || !offer_id || !role) {
      return reply.code(400).send({ error: 'Missing relayNodeId, offer_id, or role (maker/taker)' });
    }

    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relayNodeId);
    const addr = relay?.address || relayNodeId;

    const result = processManualConfirm({
      offer_id,
      role,
      confirmer_address: addr,
    });

    if (!result) {
      return reply.code(400).send({ error: 'Confirm failed' });
    }

    // Broadcast confirmation to chain
    try {
      const { sendCommandAsync } = await import('../services/relay-manager.js');
      await sendCommandAsync(relayNodeId, {
        command: 'send_broadcast',
        channel,
        message: JSON.stringify({ t: 'kanet_confirm_v1', offer_id, role, confirmer_address: addr }),
      });
    } catch (err) {
      console.log(`[exchange] Confirm broadcast pending: ${err.message}`);
    }

    return reply.send({ ok: true, offer_id, status: result.protocol_status });
  });

  // ── POST /api/exchange/submit-payment — taker 提交付款 TX ──
  fastify.post('/api/exchange/submit-payment', async (request, reply) => {
    const { relayNodeId, offer_id, payment_tx, payment_chain } = request.body || {};

    if (!offer_id || !payment_tx || !payment_chain) {
      return reply.code(400).send({ error: 'offer_id, payment_tx, payment_chain required' });
    }

    const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
    if (!offer) return reply.code(404).send({ error: 'offer_not_found' });

    const relay = relayNodeId ? sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relayNodeId) : null;
    if (!relay || relay.address !== offer.taker) {
      return reply.code(403).send({ error: 'only taker can submit payment' });
    }

    const result = processPaymentSubmit({ offer_id, payment_tx, payment_chain });
    if (result.error) return reply.code(400).send(result);
    return reply.send(result);
  });

  // ── POST /api/exchange/dispute — 发起争议 ─────────────────
  fastify.post('/api/exchange/dispute', async (request, reply) => {
    const { relayNodeId, offer_id, reason } = request.body || {};
    if (!offer_id) return reply.code(400).send({ error: 'offer_id required' });

    const relay = relayNodeId
      ? sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relayNodeId)
      : null;
    if (!relay) return reply.code(403).send({ error: 'relayNodeId required' });

    const result = processDispute({
      offer_id,
      disputer_address: relay.address,
      reason: reason || '',
    });

    if (result.error) return reply.code(400).send(result);
    return reply.send(result);
  });

  // ── GET /api/exchange/agents — 可用 Agent 列表 ───────────
  fastify.get('/api/exchange/agents', async (request, reply) => {
    const agents = sqlite.prepare(
      'SELECT id, name, address FROM relay_nodes ORDER BY name'
    ).all();
    return reply.send({ agents });
  });

  // ── /exchange 页面路由 ──────────────────────────────────
  fastify.get('/exchange', async (request, reply) => {
    return reply.view('exchange.eta', {
      _page: 'exchange',
      pageTitle: 'Free Market — KANet',
    });
  });
}
