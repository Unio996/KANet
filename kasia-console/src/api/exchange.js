/**
 * Exchange API — 协议级自由市场
 *
 * 设计文档: 自由市场设计决策文档 v1.1
 * DB 表: exchange_offers (v38)
 * 协议消息: kanet_exchange_v1 / kanet_exchange_accept_v1 / kanet_exchange_cancel_v1
 */

import { sqlite } from '../db/client.js';
import { processAccept, processCancel, processManualConfirm, processPaymentSubmit, processDispute, expireStale } from '../services/exchange-machine.js';
import { executeHedge } from '../services/trade-protocol-filter.js';

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

    // Inject price_vs_market for KAS offers
    let kasPrice = null;
    try {
      const { getCachedKasPrice } = await import('../services/market-data.js');
      kasPrice = getCachedKasPrice();
    } catch { /* market-data may not be loaded */ }

    const enriched = rows.map(offer => {
      if (!kasPrice) return offer;
      let unitPrice = null;
      let priceVsMarket = null;
      // KAS seller: give KAS, want USDT
      if (offer.give_asset?.toUpperCase() === 'KAS' && parseFloat(offer.give_amount) > 0) {
        unitPrice = parseFloat(offer.want_amount) / parseFloat(offer.give_amount);
        priceVsMarket = ((unitPrice - kasPrice) / kasPrice * 100).toFixed(2);
      }
      // KAS buyer: want KAS, give USDT
      if (offer.want_asset?.toUpperCase() === 'KAS' && parseFloat(offer.want_amount) > 0) {
        unitPrice = parseFloat(offer.give_amount) / parseFloat(offer.want_amount);
        priceVsMarket = ((unitPrice - kasPrice) / kasPrice * 100).toFixed(2);
      }
      return { ...offer, unit_price: unitPrice, price_vs_market: priceVsMarket ? parseFloat(priceVsMarket) : null, kas_market_price: kasPrice };
    });

    return reply.send({
      offers: enriched,
      total: total.cnt,
      groups,
      kas_market_price: kasPrice,
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
      metadata = {},
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

    // Fund lock: lock KAS before broadcast (prevent oversell)
    if (give_asset === 'KAS') {
      try {
        const { lockFunds } = await import('../services/fund-lock.js');
        const balRes = await fetch(`http://127.0.0.1:${process.env.PORT || 3100}/api/relay/${relayNodeId}/balance`, { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => null);
        const currentBalance = parseFloat(balRes?.balance || '0');
        const lockResult = lockFunds(makerAddr, offerId, 'KAS', parseFloat(give_amount), currentBalance);
        if (!lockResult.ok) {
          return reply.code(400).send({ error: `Insufficient KAS: ${lockResult.error}`, available: lockResult.available });
        }
      } catch (err) {
        console.log(`[exchange] Fund lock skipped (non-critical): ${err.message}`);
      }
    }

    // Broadcast FIRST — chain is the source of truth. No chain = no offer.
    let broadcastTx = null;
    const { sendCommandAsync } = await import('../services/relay-manager.js');
    const MAX_BROADCAST_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_BROADCAST_ATTEMPTS; attempt++) {
      try {
        const result = await sendCommandAsync(relayNodeId, {
          type: 'send_broadcast',
          channel,
          message: JSON.stringify(protocolMsg),
        });
        broadcastTx = result?.txId || null;
        if (broadcastTx) break;
      } catch (err) {
        console.log(`[exchange] Broadcast attempt ${attempt}/${MAX_BROADCAST_ATTEMPTS} failed: ${err.message}`);
        if (attempt < MAX_BROADCAST_ATTEMPTS) await new Promise(r => setTimeout(r, 3000));
      }
    }

    if (!broadcastTx) {
      // Release fund lock on broadcast failure
      if (give_asset === 'KAS') {
        try { const { releaseFunds } = await import('../services/fund-lock.js'); releaseFunds(offerId); } catch {}
      }
      return reply.code(503).send({ error: 'Broadcast failed — offer not created. Relay may be syncing.' });
    }

    // Chain confirmed — now write to DB
    sqlite.prepare(`
      INSERT OR IGNORE INTO exchange_offers (
        id, broadcast_tx_id, message_index,
        give_asset, give_amount, give_chain,
        want_asset, want_amount, want_chain,
        maker, broadcast_at, expires_at,
        verification, verification_meta, metadata,
        protocol_status, is_fully_observed, market_key,
        created_at, updated_at
      ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, ?, ?, ?)
    `).run(
      offerId, broadcastTx,
      give_asset, String(give_amount), give_chain || null,
      want_asset, String(want_amount), want_chain || null,
      makerAddr, now, expiresAt,
      verification, JSON.stringify(verification_meta),
      JSON.stringify(metadata),
      marketKey, now, now
    );

    return reply.send({
      ok: true,
      offer_id: offerId,
      broadcast_tx: broadcastTx,
      expires_at: expiresAt,
    });
  });

  // ── POST /api/exchange/accept — 接单 ──────────────────────
  fastify.post('/api/exchange/accept', async (request, reply) => {
    const { relayNodeId, offer_id, selected_chain, channel = 'kanet-exchange' } = request.body || {};

    if (!relayNodeId || !offer_id) {
      return reply.code(400).send({ error: 'Missing relayNodeId or offer_id' });
    }

    const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
    if (!offer) return reply.code(404).send({ error: 'Offer not found' });
    if (offer.protocol_status !== 'open') {
      return reply.code(400).send({ error: `Offer is ${offer.protocol_status}, cannot accept` });
    }

    // Cross-chain offers require selected_chain
    if (offer.verification === 'cross_chain_tx') {
      if (!selected_chain) {
        return reply.code(400).send({ error: 'selected_chain is required for cross_chain_tx offers' });
      }
      const meta = JSON.parse(offer.verification_meta || '{}');
      const acceptedChains = meta.accepted_chains || [];
      const selectedWallet = acceptedChains.find(w => w.chain === selected_chain);
      if (!selectedWallet) {
        return reply.code(400).send({ error: `Chain ${selected_chain} not accepted by maker. Available: ${acceptedChains.map(w => w.chain).join(', ')}` });
      }
      // Write receive_address into verification_meta (verifier reads this) + taker_chain/taker_payment_address (UI reads these)
      const updatedMeta = { ...meta, receive_address: selectedWallet.address, receive_chain: selected_chain };
      sqlite.prepare('UPDATE exchange_offers SET taker_chain = ?, taker_payment_address = ?, verification_meta = ? WHERE id = ?')
        .run(selected_chain, selectedWallet.address, JSON.stringify(updatedMeta), offer_id);
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

    // === NO TX NO STATE CHANGE ===
    // Broadcast accept to chain with retry. Must succeed before triggering auto-pay.
    let acceptTx = null;
    const { sendCommandAsync } = await import('../services/relay-manager.js');
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const res = await sendCommandAsync(relayNodeId, {
          type: 'send_broadcast',
          channel,
          message: JSON.stringify({
            t: 'kanet_exchange_accept_v1', offer_id, taker: takerAddr,
            selected_chain: selected_chain || null,
            receive_address: result.taker_payment_address || null,
          }),
        });
        acceptTx = res?.txId || null;
        if (acceptTx) {
          sqlite.prepare('UPDATE exchange_offers SET taker_tx_id = ? WHERE id = ?')
            .run(acceptTx, offer_id);
          break;
        }
      } catch (err) {
        console.error(`[exchange] Accept broadcast attempt ${attempt}/5: ${err.message}`);
      }
      if (attempt < 5) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
    if (!acceptTx) {
      console.error(`[exchange] Accept broadcast failed after 5 attempts for offer ${offer_id.slice(0,8)}`);
      // Accept was written to DB but not on chain — log warning but continue
      // (accept is local-first, broadcast is confirmation, not blocker for local taker)
    }

    // Trigger auto-pay if taker is a local agent with cross_chain_tx verification
    if (result.verification === 'cross_chain_tx' && selected_chain && result.taker_payment_address) {
      const localTaker = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(takerAddr);
      if (localTaker) {
        // Wait 3s for accept TX UTXO to settle before auto-pay (prevents UTXO conflict on paid broadcast)
        console.log(`[exchange] local taker accept → auto-pay in 3s for offer ${offer_id.slice(0,8)}`);
        setTimeout(() => {
          import('../services/trade-protocol-filter.js').then(mod => {
            const latestOffer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
            if (latestOffer && ['matched', 'verifying'].includes(latestOffer.protocol_status)) {
              mod.triggerAutoPay(latestOffer, localTaker.id);
            }
          }).catch(err => console.error(`[exchange] auto-pay trigger error: ${err.message}`));
        }, 3000);
      }
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

    // === NO TX NO STATE CHANGE === broadcast cancel with retry
    let cancelTx = null;
    const { sendCommandAsync: sendCancelCmd } = await import('../services/relay-manager.js');
    for (let ca = 1; ca <= 3; ca++) {
      try {
        const res = await sendCancelCmd(relayNodeId, {
          type: 'send_broadcast', channel,
          message: JSON.stringify({ t: 'kanet_exchange_cancel_v1', offer_id }),
        });
        cancelTx = res?.txId || null;
        if (cancelTx) break;
      } catch (err) {
        console.error(`[exchange] Cancel broadcast attempt ${ca}/3: ${err.message}`);
      }
      if (ca < 3) await new Promise(r => setTimeout(r, 2000));
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

    // Trigger hedge after manual confirm → completed
    if (result.protocol_status === 'completed' && result.maker) {
      const localAgent = sqlite.prepare('SELECT id, name FROM relay_nodes WHERE address = ?').get(result.maker);
      if (localAgent) {
        const makerGaveKas = result.give_asset === 'KAS';
        const hedgeSide = makerGaveKas ? 'BUY' : 'SELL';
        const hedgeQty = makerGaveKas ? parseFloat(result.give_amount) : parseFloat(result.want_amount);
        if (hedgeQty > 0) {
          setImmediate(() => {
            executeHedge(result.id, localAgent.name, hedgeSide, hedgeQty).catch(err =>
              console.error(`[exchange-hedge] complete-path trigger error: ${err.message}`)
            );
          });
        }
      }
    }

    // Broadcast confirmation to chain
    try {
      const { sendCommandAsync } = await import('../services/relay-manager.js');
      await sendCommandAsync(relayNodeId, {
        type: 'send_broadcast',
        channel,
        message: JSON.stringify({ t: 'kanet_confirm_v1', offer_id, role, confirmer_address: addr }),
      });
    } catch (err) {
      console.log(`[exchange] Confirm broadcast pending: ${err.message}`);
    }

    return reply.send({ ok: true, offer_id, status: result.protocol_status });
  });

  // ── POST /api/exchange/submit-payment — DEPRECATED: replaced by kanet_exchange_paid_v1 protocol message ──
  // Kept for backward compatibility. New flow: auto-pay → broadcast paid_v1 → handler triggers verification.
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
      'SELECT id, name, address, focus FROM relay_nodes ORDER BY name'
    ).all();
    return reply.send({ agents });
  });

  // ── Seeder API ─────────────────────────────────────────

  // GET /api/exchange/seeder/config — 读做市播种器配置
  fastify.get('/api/exchange/seeder/config', async (request, reply) => {
    const row = sqlite.prepare('SELECT * FROM market_seeder_config WHERE id = ?').get('default');
    if (!row) return reply.send({ enabled: false, sell_spread_pct: 1.0, buy_spread_pct: 1.0, amount_kas: 100, expires_minutes: 30, sell_agent_id: '', buy_agent_id: '' });
    return reply.send({
      enabled: !!row.enabled,
      sell_spread_pct: row.sell_spread_pct,
      buy_spread_pct: row.buy_spread_pct,
      amount_kas: row.amount_kas,
      expires_minutes: row.expires_minutes,
      sell_agent_id: row.sell_agent_id || '',
      buy_agent_id: row.buy_agent_id || '',
    });
  });

  // PUT /api/exchange/seeder/config — 写配置（含 enabled 开关）
  fastify.put('/api/exchange/seeder/config', async (request, reply) => {
    const { enabled, sell_spread_pct, buy_spread_pct, amount_kas, expires_minutes, sell_agent_id, buy_agent_id } = request.body || {};
    sqlite.prepare(`
      UPDATE market_seeder_config SET
        enabled = ?, sell_spread_pct = ?, buy_spread_pct = ?,
        amount_kas = ?, expires_minutes = ?,
        sell_agent_id = ?, buy_agent_id = ?,
        updated_at = ?
      WHERE id = 'default'
    `).run(
      enabled ? 1 : 0,
      sell_spread_pct ?? 1.0,
      buy_spread_pct ?? 1.0,
      amount_kas ?? 100,
      expires_minutes ?? 30,
      sell_agent_id || null,
      buy_agent_id || null,
      new Date().toISOString()
    );
    return reply.send({ ok: true });
  });

  // POST /api/exchange/seeder/trigger — 手动触发一次 tick
  fastify.post('/api/exchange/seeder/trigger', async (request, reply) => {
    try {
      const { triggerTick } = await import('../services/market-seeder.js');
      const result = await triggerTick();
      return reply.send({ ok: true, result });
    } catch (err) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  // GET /api/exchange/seeder/status — 活跃种子单 + 今日统计
  fastify.get('/api/exchange/seeder/status', async (request, reply) => {
    // Active seed orders (exclude expired)
    const nowISO = new Date().toISOString();
    const activeRows = sqlite.prepare(`
      SELECT id, give_asset, give_amount, want_asset, want_amount,
             protocol_status, expires_at, metadata, maker
      FROM exchange_offers
      WHERE protocol_status = 'open'
        AND metadata LIKE '%"source":"seeder"%'
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY broadcast_at DESC
    `).all(nowISO);

    const now = Date.now();
    const activeOrders = activeRows.map(o => {
      const meta = JSON.parse(o.metadata || '{}');
      const expiresMs = new Date(o.expires_at).getTime();
      const minutesLeft = Math.max(0, Math.round((expiresMs - now) / 60000));
      const side = o.give_asset === 'KAS' ? 'sell' : 'buy';
      const price = side === 'sell'
        ? parseFloat(o.want_amount) / parseFloat(o.give_amount)
        : parseFloat(o.give_amount) / parseFloat(o.want_amount);
      return {
        id: o.id, side, give_amount: o.give_amount, want_amount: o.want_amount,
        price, spread_pct: meta.spread_pct || 0,
        protocol_status: o.protocol_status, expires_at: o.expires_at, minutes_left: minutesLeft,
        maker: o.maker,
      };
    });

    // Today's stats
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();

    const seeded = sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM exchange_offers
      WHERE metadata LIKE '%"source":"seeder"%'
        AND created_at >= ?
    `).get(todayISO)?.cnt || 0;

    const takenRows = sqlite.prepare(`
      SELECT give_asset, give_amount, want_amount, metadata FROM exchange_offers
      WHERE metadata LIKE '%"source":"seeder"%'
        AND protocol_status = 'completed'
        AND completed_at >= ?
    `).all(todayISO);

    let netUsdt = 0;
    for (const t of takenRows) {
      const meta = JSON.parse(t.metadata || '{}');
      const midPrice = meta.mid_price || 0;
      if (t.give_asset === 'KAS' && midPrice > 0) {
        const soldPrice = parseFloat(t.want_amount) / parseFloat(t.give_amount);
        netUsdt += (soldPrice - midPrice) * parseFloat(t.give_amount);
      } else if (t.give_asset !== 'KAS' && midPrice > 0) {
        const boughtPrice = parseFloat(t.give_amount) / parseFloat(t.want_amount);
        netUsdt += (midPrice - boughtPrice) * parseFloat(t.want_amount);
      }
    }

    return reply.send({
      active_orders: activeOrders,
      today: { seeded, taken: takenRows.length, net_usdt: Math.round(netUsdt * 100) / 100 },
    });
  });

  // ── GET /api/exchange/reputation/:address — 对手方信誉评估 ──
  fastify.get('/api/exchange/reputation/:address', async (request, reply) => {
    const { address } = request.params;
    const { my_address } = request.query;
    if (!address) return reply.code(400).send({ error: 'address required' });

    try {
      const { assessReputation } = await import('../services/reputation.js');
      const reputation = assessReputation(my_address || null, address);

      // Star rating for UI (based on design doc)
      let stars = 0;
      if (reputation.completed >= 50) stars = 5;
      else if (reputation.completed >= 21) stars = 4;
      else if (reputation.completed >= 6) stars = 3;
      else if (reputation.completed >= 1) stars = 2;
      // dispute penalty
      if (reputation.totalTrades > 0 && reputation.disputed / reputation.totalTrades > 0.1) {
        stars = Math.max(0, stars - 1);
      }

      return { ...reputation, stars };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── GET /api/exchange/reputation/batch — 批量信誉查询 ──────
  fastify.get('/api/exchange/reputation/batch', async (request, reply) => {
    const { addresses, my_address } = request.query;
    if (!addresses) return reply.code(400).send({ error: 'addresses required (comma-separated)' });

    try {
      const { assessReputation } = await import('../services/reputation.js');
      const addrList = [...new Set(addresses.split(',').map(a => a.trim()).filter(Boolean))].slice(0, 50);
      const result = {};

      for (const addr of addrList) {
        const rep = assessReputation(my_address || null, addr);
        let stars = 0;
        if (rep.completed >= 50) stars = 5;
        else if (rep.completed >= 21) stars = 4;
        else if (rep.completed >= 6) stars = 3;
        else if (rep.completed >= 1) stars = 2;
        if (rep.totalTrades > 0 && rep.disputed / rep.totalTrades > 0.1) {
          stars = Math.max(0, stars - 1);
        }
        result[addr] = { stars, risk: rep.risk, completed: rep.completed, disputed: rep.disputed, totalTrades: rep.totalTrades, summary: rep.summary };
      }

      return result;
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── GET /api/exchange/overview — 市场概览数据 ──────────────
  fastify.get('/api/exchange/overview', async (request, reply) => {
    try {
      // Active offers count
      const activeOffers = sqlite.prepare(
        "SELECT COUNT(*) as cnt FROM exchange_offers WHERE protocol_status = 'open'"
      ).get();

      // Best sell (lowest give_amount/want_amount for KAS sellers)
      const bestSell = sqlite.prepare(`
        SELECT give_amount, want_amount,
               CAST(want_amount AS REAL) / CAST(give_amount AS REAL) as unit_price
        FROM exchange_offers
        WHERE protocol_status = 'open'
          AND UPPER(give_asset) = 'KAS'
          AND CAST(give_amount AS REAL) > 0
        ORDER BY unit_price ASC LIMIT 1
      `).get();

      // Best buy (highest want_amount/give_amount for KAS buyers)
      const bestBuy = sqlite.prepare(`
        SELECT give_amount, want_amount,
               CAST(give_amount AS REAL) / CAST(want_amount AS REAL) as unit_price
        FROM exchange_offers
        WHERE protocol_status = 'open'
          AND UPPER(want_asset) = 'KAS'
          AND CAST(want_amount AS REAL) > 0
        ORDER BY unit_price DESC LIMIT 1
      `).get();

      // 24h completed trades
      const recent24h = sqlite.prepare(`
        SELECT COUNT(*) as cnt,
               COALESCE(SUM(CAST(give_amount AS REAL)), 0) as volume_kas
        FROM exchange_offers
        WHERE protocol_status = 'completed'
          AND UPPER(give_asset) = 'KAS'
          AND updated_at > datetime('now', '-1 day')
      `).get();

      // Last trade time
      const lastTrade = sqlite.prepare(`
        SELECT updated_at FROM exchange_offers
        WHERE protocol_status = 'completed'
        ORDER BY updated_at DESC LIMIT 1
      `).get();

      // Avg settlement time (matched_at → completed_at), only if >= 5 completed
      const totalCompleted = sqlite.prepare(
        "SELECT COUNT(*) as cnt FROM exchange_offers WHERE protocol_status = 'completed' AND matched_at IS NOT NULL AND completed_at IS NOT NULL"
      ).get();

      let avgSettlementSeconds = null;
      if (totalCompleted?.cnt >= 5) {
        const avgResult = sqlite.prepare(`
          SELECT AVG((julianday(completed_at) - julianday(matched_at)) * 86400) as avg_sec
          FROM exchange_offers
          WHERE protocol_status = 'completed'
            AND matched_at IS NOT NULL AND completed_at IS NOT NULL
        `).get();
        avgSettlementSeconds = avgResult?.avg_sec ? Math.round(avgResult.avg_sec) : null;
      }

      // Current KAS market price (from market-data cache)
      let marketPrice = null;
      try {
        const { getCachedKasPrice } = await import('../services/market-data.js');
        marketPrice = getCachedKasPrice();
      } catch { /* market-data may not be available */ }

      return {
        active_offers: activeOffers?.cnt || 0,
        best_sell_price: bestSell?.unit_price || null,
        best_buy_price: bestBuy?.unit_price || null,
        trades_24h: recent24h?.cnt || 0,
        volume_24h_kas: Math.round(recent24h?.volume_kas || 0),
        total_completed: totalCompleted?.cnt || 0,
        avg_settlement_seconds: avgSettlementSeconds,
        last_trade_at: lastTrade?.updated_at || null,
        kas_market_price: marketPrice,
      };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── /exchange 页面路由 ──────────────────────────────────
  fastify.get('/exchange', async (request, reply) => {
    return reply.view('exchange.eta', {
      _page: 'exchange',
      pageTitle: 'Free Market — KANet',
    });
  });
}
