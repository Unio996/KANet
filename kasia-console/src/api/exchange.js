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
import { recordChainEvent } from '../services/chain-event.js';

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

    // T-J2-2026-05-11 Phase 2 A.2 (NWT #18 ABE audit): inline UPDATE → expireStale() transition() loop。
    // 现 expireStale (exchange-machine.js:575) 真 SELECT stale + transition(id, 'expired') loop, 走 transition() invariant 路径
    // (timestamp 设 expired_at + audit log)。inline UPDATE bypass transition() 是 A 断点根因。
    expireStale();

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

    // P0-1b (NWT r185 architect γ defense-in-depth): publish endpoint reputation hard-block.
    // matcher Stage 2 已 stranger 早 reject (P0-1a), 但 endpoint 真 server-side 第二层防御 — 任意 caller path
    // (script / direct API / future intent skill) 真 enforce reputation gate, 防 broker fund abuse vector.
    // pattern reference: api/exchange.js:413 accept (warning) + trade-protocol-filter.js:541 autoTaker (hard-block).
    {
      const relayForRep = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relayNodeId);
      const makerAddrForRep = relayForRep?.address;
      if (makerAddrForRep && verification_meta?.taker_for_reputation_check) {
        try {
          const { assessReputation } = await import('../services/reputation.js');
          const rep = assessReputation(verification_meta.taker_for_reputation_check, makerAddrForRep);
          if (rep.risk === 'high') {
            return reply.code(403).send({
              error: 'reputation_gate_blocked',
              risk: rep.risk,
              reason: rep.warnings?.join('; ') || 'high-risk peer',
              summary: rep.summary,
            });
          }
        } catch (e) {
          console.error(`[exchange] publish reputation check err: ${e.message}`);
        }
      }
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

    // P1-B: Exchange exposure limits
    if (give_asset === 'KAS') {
      const { getConfig } = await import('../data/settings/configs.js');
      const perOfferLimit = parseFloat(await getConfig('exchange_per_offer_kas_limit')) || 5000;
      const totalExposureLimit = parseFloat(await getConfig('exchange_total_exposure_kas_limit')) || 20000;
      const giveAmt = parseFloat(give_amount);

      if (giveAmt > perOfferLimit) {
        return reply.code(400).send({
          error: 'Exceeds per-offer KAS limit',
          amount: giveAmt, limit: perOfferLimit, exceeded_by: giveAmt - perOfferLimit,
        });
      }

      const currentExposure = sqlite.prepare(`
        SELECT COALESCE(SUM(CAST(give_amount AS REAL)), 0) as total
        FROM exchange_offers
        WHERE protocol_status = 'open' AND give_asset = 'KAS' AND maker = ?
      `).get(makerAddr);
      const totalAfter = (currentExposure?.total || 0) + giveAmt;

      if (totalAfter > totalExposureLimit) {
        return reply.code(400).send({
          error: 'Exceeds total KAS exposure limit',
          current_exposure: currentExposure?.total || 0, new_amount: giveAmt,
          total_after: totalAfter, limit: totalExposureLimit, exceeded_by: totalAfter - totalExposureLimit,
        });
      }
    }

    // ── 事前余额校验（EVM give assets）──
    // For KAS, fund-lock below handles it. For USDT/USDC on EVM chains, check we actually have it.
    if (give_asset !== 'KAS' && give_chain) {
      try {
        const walletsRes = await fetch(
          `http://127.0.0.1:${process.env.PORT || 3100}/api/relay/${relayNodeId}/wallets`,
          { signal: AbortSignal.timeout(8000) }
        ).then(r => r.json()).catch(() => null);
        const chains = walletsRes?.chains || [];
        const chainWallet = chains.find(c => c.chain === give_chain);
        if (!chainWallet) {
          return reply.code(400).send({
            error: `No ${give_chain} wallet for this agent`,
            give_asset, give_chain,
          });
        }
        const assetKey = give_asset.toLowerCase();
        const balanceField = assetKey === 'usdt' ? 'usdtBalance'
                           : assetKey === 'usdc' ? 'usdcBalance'
                           : null;
        if (balanceField) {
          const have = parseFloat(chainWallet[balanceField] || 0);
          const need = parseFloat(give_amount);
          if (have < need) {
            return reply.code(400).send({
              error: `余额不足：${give_chain} 钱包只有 ${have.toFixed(4)} ${give_asset.toUpperCase()}，挂单需要 ${need}`,
              have, need, give_asset, give_chain,
              address: chainWallet.address,
            });
          }
        }
      } catch (e) {
        console.log(`[exchange] pre-publish balance check skipped (non-fatal): ${e.message}`);
      }
    }

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
    // T-J2-2026-04-28 Phase D P0 fix: Trader-B mempool UTXO contention reject "already spent" —
    // 2 attempts × 3s (~6s) too short. Increase to 5 × exp backoff (5/10/15/20s ≈ 50s) to clear mempool.
    // Real fix is relay UTXO selector mempool-aware (Layer 2, R39 SOP follow-up case J1 territory).
    let broadcastTx = null;
    const { sendCommandAsync } = await import('../services/relay-manager.js');
    const MAX_BROADCAST_ATTEMPTS = 5;
    for (let attempt = 1; attempt <= MAX_BROADCAST_ATTEMPTS; attempt++) {
      try {
        const result = await sendCommandAsync(relayNodeId, {
          type: 'send_broadcast',
          channel,
          message: JSON.stringify(protocolMsg),
        });
        broadcastTx = result?.txId || null;
        if (broadcastTx) break;
        // T-J2-2026-04-28 Phase D P0 Layer 1 v2 (NWT f8e7221a catch): sendCommandAsync 'already spent' 走 result.error
        // path (no throw), if 不 trigger break, catch 不 fire — 没 sleep 5 attempts 立即跑 ~400ms 全 fail.
        // 修: sleep also on 'no txId without throw' branch.
        if (attempt < MAX_BROADCAST_ATTEMPTS) {
          console.log(`[exchange] Broadcast attempt ${attempt}/${MAX_BROADCAST_ATTEMPTS} returned no txId (mempool conflict?)`);
          await new Promise(r => setTimeout(r, attempt * 5000));
        }
      } catch (err) {
        console.log(`[exchange] Broadcast attempt ${attempt}/${MAX_BROADCAST_ATTEMPTS} failed: ${err.message}`);
        if (attempt < MAX_BROADCAST_ATTEMPTS) await new Promise(r => setTimeout(r, attempt * 5000));
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
    const { relayNodeId, offer_id, selected_chain, payment_asset, channel = 'kanet-exchange' } = request.body || {};

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
      // Write receive_address + payment_asset into verification_meta (verifier reads these)
      const updatedMeta = { ...meta, receive_address: selectedWallet.address, receive_chain: selected_chain };
      if (payment_asset) updatedMeta.payment_asset = payment_asset.toLowerCase();
      sqlite.prepare('UPDATE exchange_offers SET taker_chain = ?, taker_payment_address = ?, verification_meta = ? WHERE id = ?')
        .run(selected_chain, selectedWallet.address, JSON.stringify(updatedMeta), offer_id);
    }

    const relay = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relayNodeId);
    const takerAddr = relay?.address || relayNodeId;

    // ── 事前余额校验（taker pay capacity）──
    // Taker needs to pay offer.want_asset (amount = offer.want_amount) on the chosen chain.
    // For cross-chain offers, selected_chain is required (already validated above).
    // For KAS want_asset, check local kaspa balance.
    const wantAssetUp = (offer.want_asset || '').toUpperCase();
    if (wantAssetUp === 'KAS') {
      try {
        const balRes = await fetch(
          `http://127.0.0.1:${process.env.PORT || 3100}/api/relay/${relayNodeId}/balance`,
          { signal: AbortSignal.timeout(5000) }
        ).then(r => r.json()).catch(() => null);
        const kasBal = parseFloat(balRes?.balance || 0);
        const need = parseFloat(offer.want_amount);
        if (kasBal < need) {
          return reply.code(400).send({
            error: `余额不足：你的 KAS 钱包只有 ${kasBal.toFixed(2)} KAS，接单需支付 ${need} KAS`,
            have: kasBal, need,
          });
        }
      } catch (e) {
        console.log(`[exchange] pre-accept KAS balance check skipped (non-fatal): ${e.message}`);
      }
    } else if (selected_chain && ['usdt', 'usdc'].includes(wantAssetUp.toLowerCase())) {
      // EVM / multi-chain want_asset
      try {
        const walletsRes = await fetch(
          `http://127.0.0.1:${process.env.PORT || 3100}/api/relay/${relayNodeId}/wallets`,
          { signal: AbortSignal.timeout(8000) }
        ).then(r => r.json()).catch(() => null);
        const chains = walletsRes?.chains || [];
        const chainWallet = chains.find(c => c.chain === selected_chain);
        if (!chainWallet) {
          return reply.code(400).send({
            error: `你没有 ${selected_chain} 钱包，无法通过此链支付`,
            selected_chain,
          });
        }
        const balanceField = wantAssetUp === 'USDT' ? 'usdtBalance' : 'usdcBalance';
        const have = parseFloat(chainWallet[balanceField] || 0);
        const need = parseFloat(offer.want_amount);
        if (have < need) {
          return reply.code(400).send({
            error: `余额不足：你的 ${selected_chain} 钱包只有 ${have.toFixed(4)} ${wantAssetUp}，接单需支付 ${need}`,
            have, need, selected_chain,
            address: chainWallet.address,
          });
        }
      } catch (e) {
        console.log(`[exchange] pre-accept EVM balance check skipped (non-fatal): ${e.message}`);
      }
    }

    // ── Reputation check on maker (non-blocking for manual accept) ──
    // Unlike autoTaker which hard-blocks, manual accept proceeds but returns warning.
    // UI should surface the warning if present.
    let reputationWarning = null;
    try {
      const { assessReputation } = await import('../services/reputation.js');
      const rep = assessReputation(takerAddr, offer.maker);
      if (rep.risk === 'high') {
        reputationWarning = {
          level: 'high',
          summary: rep.summary,
          warnings: rep.warnings,
          message: `⚠ 高风险对手方：${rep.warnings.join('；')}`,
        };
        console.log(`[exchange] manual accept on HIGH-risk maker ${offer.maker.slice(-12)} — ${rep.warnings.join(';')}`);
      } else if (rep.risk === 'medium') {
        reputationWarning = {
          level: 'medium',
          summary: rep.summary,
          warnings: rep.warnings,
          message: `注意：${rep.warnings.join('；')}`,
        };
      }
    } catch (e) {
      console.error(`[exchange] reputation check error: ${e.message}`);
    }

    // Re-read offer for broadcast message (taker_payment_address already written above)
    const offerForBcast = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);

    // === NO TX NO STATE CHANGE (③ consensus) ===
    // Broadcast accept FIRST. Only advance DB state after TX is on chain.
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
            receive_address: offerForBcast?.taker_payment_address || null,
            payment_asset: payment_asset || null,
          }),
        });
        acceptTx = res?.txId || null;
        if (acceptTx) break;
      } catch (err) {
        console.error(`[exchange] Accept broadcast attempt ${attempt}/5: ${err.message}`);
      }
      if (attempt < 5) await new Promise(r => setTimeout(r, 200 * attempt));
    }
    if (!acceptTx) {
      // Broadcast failed — DB stays untouched, no state change, no auto-pay.
      console.error(`[exchange] Accept broadcast failed after 5 attempts for offer ${offer_id.slice(0,8)}`);
      return reply.code(500).send({ error: 'Accept broadcast failed — offer unchanged. Retry later.' });
    }

    // Broadcast on chain — NOW safe to advance local state
    const result = processAccept({
      offer_id,
      _from: takerAddr,
      _tx: acceptTx,
    });

    if (!result) {
      return reply.code(400).send({ error: 'Accept failed (offer may no longer be open)' });
    }

    // Write the real on-chain txId
    sqlite.prepare('UPDATE exchange_offers SET taker_tx_id = ? WHERE id = ?')
      .run(acceptTx, offer_id);

    // Trigger auto-pay if taker is a local agent with cross_chain_tx verification
    if (result.verification === 'cross_chain_tx' && selected_chain && result.taker_payment_address) {
      const localTaker = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(takerAddr);
      if (localTaker) {
        console.log(`[exchange] local taker accept → triggering auto-pay for offer ${offer_id.slice(0,8)}`);
        import('../services/trade-protocol-filter.js').then(mod => {
          const latestOffer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
          if (latestOffer && ['matched', 'verifying'].includes(latestOffer.protocol_status)) {
            mod.triggerAutoPay(latestOffer, localTaker.id);
          }
        }).catch(err => console.error(`[exchange] auto-pay trigger error: ${err.message}`));
      }
    }

    // Trigger auto-send-KAS if taker is a local agent with kaspa_tx verification
    if (result.verification === 'kaspa_tx' && result.want_asset?.toUpperCase() === 'KAS') {
      const localTaker = sqlite.prepare('SELECT id FROM relay_nodes WHERE address = ?').get(takerAddr);
      if (localTaker) {
        console.log(`[exchange] local taker accept → triggering auto-send-KAS for offer ${offer_id.slice(0, 8)}`);
        import('../services/trade-protocol-filter.js').then(mod => {
          const latestOffer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
          if (latestOffer && ['matched', 'verifying'].includes(latestOffer.protocol_status)) {
            mod._autoSendKas(latestOffer, localTaker.id);
          }
        }).catch(err => console.error(`[exchange] auto-send-KAS trigger error: ${err.message}`));
      }
    }

    return reply.send({ ok: true, offer_id, status: result.protocol_status, accept_tx: acceptTx, reputationWarning });
  });

  // ── GET /api/exchange/peer-reputation?peer=... — 查询对手方信誉（供 UI badge）──
  fastify.get('/api/exchange/peer-reputation', async (request, reply) => {
    const { peer, from } = request.query;
    if (!peer) return reply.code(400).send({ error: 'peer required' });
    try {
      const { assessReputation } = await import('../services/reputation.js');
      // 'from' 是查询者 (my) 地址；可选。没有 from 也能给出基本信誉（只是缺 mutual 历史）
      const rep = assessReputation(from || null, peer);
      return reply.send({ ok: true, reputation: rep });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
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
      if (ca < 3) await new Promise(r => setTimeout(r, 200));
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

    const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
    if (!offer) return reply.code(404).send({ error: 'offer_not_found' });

    // === NO TX NO STATE CHANGE: 先广播到 #kanet-disputes 再推进本地状态 ===
    let disputeTx = null;
    const { sendCommandAsync } = await import('../services/relay-manager.js');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await sendCommandAsync(relayNodeId, {
          type: 'send_broadcast',
          channel: 'kanet-disputes',
          message: JSON.stringify({
            t: 'kanet_exchange_dispute_v1',
            offer_id,
            maker: offer.maker,
            taker: offer.taker,
            give_asset: offer.give_asset,
            give_amount: offer.give_amount,
            want_asset: offer.want_asset,
            want_amount: offer.want_amount,
            disputer: relay.address,
            reason: reason || 'no_reason_given',
            raised_at: new Date().toISOString(),
          }),
        });
        disputeTx = res?.txId || null;
        if (disputeTx) break;
      } catch (err) {
        console.error(`[exchange] Dispute broadcast attempt ${attempt}/3: ${err.message}`);
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 300 * attempt));
    }
    if (!disputeTx) {
      return reply.code(503).send({ error: 'Dispute broadcast failed — state unchanged (NO TX NO STATE CHANGE)' });
    }

    // 本地推进状态
    const result = processDispute({
      offer_id,
      disputer_address: relay.address,
      reason: reason || '',
    });

    if (result.error) return reply.code(400).send(result);
    return reply.send({ ...result, dispute_tx: disputeTx });
  });

  // ── POST /api/exchange/resolve — 裁决争议 ─────────────────
  //
  // Phase 1 stress test S10 confirmed this endpoint was missing — disputed offers
  // were stuck forever with no code path back to terminal state. This implementation
  // is v1: local party (maker or taker) can resolve; future versions may add arbiter.
  //
  // Outcome enum:
  //   - maker_wins  → offer moves to 'completed', fund_lock stays spent (or is marked spent)
  //   - taker_wins  → offer moves to 'cancelled', fund_lock released back to maker
  //   - split       → NOT YET SUPPORTED (returns 501)
  fastify.post('/api/exchange/resolve', async (request, reply) => {
    // 2026-04-14: concede-only 语义 — 调用方只能"认输", 不能"宣判对方输".
    // maker 调 resolve → 自动设 taker_wins (maker 认输)
    // taker 调 resolve → 自动设 maker_wins (taker 认输)
    // 客户端不再需要传 outcome, 传了也必须和 concede 规则一致.
    const { relayNodeId, offer_id, outcome: clientOutcome, reason, channel = 'kanet-disputes' } = request.body || {};
    if (!offer_id) return reply.code(400).send({ error: 'offer_id required' });

    const offer = sqlite.prepare('SELECT * FROM exchange_offers WHERE id = ?').get(offer_id);
    if (!offer) return reply.code(404).send({ error: 'Offer not found' });
    if (offer.protocol_status !== 'disputed') {
      return reply.code(400).send({ error: `Offer is ${offer.protocol_status}, not disputed (cannot resolve)` });
    }

    const relay = relayNodeId
      ? sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relayNodeId)
      : null;
    if (!relay) return reply.code(403).send({ error: 'relayNodeId required' });

    // Permission + concede-only 派生 outcome
    let outcome;
    if (relay.address === offer.maker) {
      outcome = 'taker_wins'; // maker concedes
    } else if (relay.address === offer.taker) {
      outcome = 'maker_wins'; // taker concedes
    } else {
      return reply.code(403).send({ error: 'Only offer maker or taker can resolve dispute' });
    }
    // 如果客户端传了 outcome, 必须和 concede 规则一致 (防止误传)
    if (clientOutcome && clientOutcome !== outcome) {
      return reply.code(400).send({
        error: `concede-only: as ${relay.address === offer.maker ? 'maker' : 'taker'}, you can only concede (outcome=${outcome}), not declare ${clientOutcome}`,
      });
    }

    // === NO TX NO STATE CHANGE: broadcast resolve first ===
    let resolveTx = null;
    const { sendCommandAsync } = await import('../services/relay-manager.js');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await sendCommandAsync(relayNodeId, {
          type: 'send_broadcast',
          channel,
          message: JSON.stringify({
            t: 'kanet_exchange_resolve_v1',
            offer_id,
            outcome,
            resolver: relay.address,
            reason: reason || null,
          }),
        });
        resolveTx = res?.txId || null;
        if (resolveTx) break;
      } catch (err) {
        console.error(`[exchange] Resolve broadcast attempt ${attempt}/3: ${err.message}`);
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 300 * attempt));
    }
    if (!resolveTx) {
      return reply.code(503).send({ error: 'Resolve broadcast failed — state unchanged' });
    }

    // Broadcast on chain → advance state locally (other nodes will sync via protocol filter)
    try {
      const { transition } = await import('../services/exchange-machine.js');
      // Need to allow disputed → completed/cancelled. Check VALID_TRANSITIONS in exchange-machine.js.
      // disputed is terminal per TERMINAL set, so we need direct SQL update + event recording.
      const now = new Date().toISOString();
      const newStatus = outcome === 'maker_wins' ? 'completed' : 'cancelled';

      // Direct SQL because disputed is terminal — transition() would refuse.
      sqlite.prepare(`
        UPDATE exchange_offers
        SET protocol_status = ?, updated_at = ?,
            verification_meta = json_patch(COALESCE(verification_meta, '{}'), ?)
        WHERE id = ?
      `).run(newStatus, now, JSON.stringify({
        resolved_at: now,
        resolve_outcome: outcome,
        resolve_reason: reason || null,
        resolved_by: relay.address,
        resolve_tx: resolveTx,
      }), offer_id);

      // Fund lock resolution
      const { releaseFunds, spendFunds } = await import('../services/fund-lock.js');
      if (outcome === 'maker_wins') {
        // Maker delivered (allegedly); mark locked funds as spent
        try { spendFunds(offer_id); } catch (e) { console.error(`[resolve] spendFunds: ${e.message}`); }
      } else {
        // Taker wins — refund maker's locked funds
        try { releaseFunds(offer_id); } catch (e) { console.error(`[resolve] releaseFunds: ${e.message}`); }
      }

      // Audit event
      recordChainEvent({
        txid: resolveTx,
        eventType: 'exchange_resolved',
        fromAddress: relay.address,
        toAddress: newStatus === 'completed' ? offer.taker : offer.maker,
        payload: JSON.stringify({
          offer_id,
          outcome,
          from_status: 'disputed',
          to_status: newStatus,
          resolver: relay.address,
          reason: reason || null,
        }),
      });

      console.log(`[exchange] offer ${offer_id.slice(0, 8)} disputed → ${newStatus} (outcome=${outcome}, resolver=${relay.address.slice(-12)})`);

      return reply.send({
        ok: true,
        offer_id,
        outcome,
        new_status: newStatus,
        resolve_tx: resolveTx,
      });
    } catch (err) {
      console.error(`[exchange] resolve state update error: ${err.message}`);
      return reply.code(500).send({ error: err.message, resolve_tx: resolveTx });
    }
  });

  // ── GET /api/exchange/agents — 可用 Agent 列表 ───────────
  fastify.get('/api/exchange/agents', async (request, reply) => {
    const agents = sqlite.prepare(
      'SELECT id, name, address, focus FROM relay_nodes ORDER BY name'
    ).all();
    return reply.send({ agents });
  });

  // T-J2-2026-05-11 Phase 2 γ.1 (Owner 5/11 钦定 NWT #17): /api/exchange/deposit-address
  // user UI 直接下单 SELL flow 需 broker kasia address (user 真转 KAS 来), 现 broker DM 才发, UI 路径缺。
  // 给 maker_relay_id (broker active broker) 返 kasia address + offer 真 expected give_amount。
  fastify.get('/api/exchange/deposit-address', async (request, reply) => {
    const { offer_id, maker_relay_id } = request.query || {};
    if (!offer_id && !maker_relay_id) {
      return reply.code(400).send({ error: 'offer_id OR maker_relay_id required' });
    }
    let makerAddr = null;
    let offer = null;
    if (offer_id) {
      offer = sqlite.prepare(`
        SELECT id, maker, give_asset, give_amount, give_chain, want_asset, want_amount, want_chain, protocol_status
        FROM exchange_offers WHERE id = ?
      `).get(offer_id);
      if (!offer) return reply.code(404).send({ error: 'offer_not_found' });
      makerAddr = offer.maker;
    } else {
      const relay = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id = ? AND role IN ('broker','trader')`).get(maker_relay_id);
      if (!relay) return reply.code(404).send({ error: 'maker_relay_not_found_or_not_trading_role' });
      makerAddr = relay.address;
    }
    return reply.send({
      ok: true,
      deposit_address: makerAddr,
      offer: offer ? {
        id: offer.id,
        expected_amount: offer.give_amount,
        expected_asset: offer.give_asset,
        expected_chain: offer.give_chain,
        want_asset: offer.want_asset,
        want_amount: offer.want_amount,
        want_chain: offer.want_chain,
        status: offer.protocol_status,
      } : null,
    });
  });

  // T-J2-2026-05-11 Phase 2 γ.2 (Owner 5/11 钦定 NWT #17): /api/exchange/my-orders
  // user UI 查看自己的 SELL/BUY 订单 — list retail_dex_orders + exchange_offers JOIN
  // 支持 status filter (active / completed / refunded / all) + limit
  fastify.get('/api/exchange/my-orders', async (request, reply) => {
    const { user_kasia, status = 'active', limit = 20 } = request.query || {};
    if (!user_kasia) return reply.code(400).send({ error: 'user_kasia required' });
    const limitN = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const activeStates = ['aligning', 'confirming', 'awaiting_payment', 'paid', 'executing', 'refunding'];
    const terminalStates = ['completed', 'refunded', 'failed', 'expired'];
    let whereStates;
    if (status === 'active') whereStates = activeStates;
    else if (status === 'completed') whereStates = ['completed'];
    else if (status === 'refunded') whereStates = ['refunded', 'failed', 'expired'];
    else whereStates = [...activeStates, ...terminalStates];
    const placeholders = whereStates.map(() => '?').join(',');
    const orders = sqlite.prepare(`
      SELECT id, side, qty, pay_chain, pay_address, agent_pay_addr, receive_address,
             state, exchange_offer_id, pay_tx_hash, deliver_tx_hash, refund_tx_hash,
             mid_price_at_quote, broker_fee_kas, net_delivery_kas, error_reason,
             created_at, updated_at, expires_at
      FROM retail_dex_orders
      WHERE user_kasia_address = ? AND state IN (${placeholders})
      ORDER BY created_at DESC LIMIT ?
    `).all(user_kasia, ...whereStates, limitN);
    return reply.send({ ok: true, count: orders.length, orders });
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

  // ── Exchange Limits & Asset Status ─────────────────────

  // GET /api/exchange/limits — 读取限额配置 + 当前资产状态
  fastify.get('/api/exchange/limits', async (request, reply) => {
    const { relayNodeId } = request.query;

    // Limits from config_entries (via getConfig helper — handles value_encrypted column)
    const { getConfig } = await import('../data/settings/configs.js');
    const perOfferLimit = parseFloat(await getConfig('exchange_per_offer_kas_limit')) || 5000;
    const totalExposureLimit = parseFloat(await getConfig('exchange_total_exposure_kas_limit')) || 20000;
    const priceDeviationPct = parseFloat(await getConfig('seeder_price_deviation_pct')) || 5;

    // Current exposure: sum of open KAS offers by all local agents
    const localAddresses = sqlite.prepare('SELECT address FROM relay_nodes').all().map(r => r.address);
    let currentExposure = 0;
    if (localAddresses.length > 0) {
      const placeholders = localAddresses.map(() => '?').join(',');
      const row = sqlite.prepare(`
        SELECT COALESCE(SUM(CAST(give_amount AS REAL)), 0) as total
        FROM exchange_offers
        WHERE protocol_status IN ('open', 'matched', 'verifying', 'delivering')
        AND give_asset = 'KAS' AND maker IN (${placeholders})
      `).get(...localAddresses);
      currentExposure = row?.total || 0;
    }

    // Fund locks
    const lockedRow = sqlite.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM fund_locks WHERE status = 'locked'
    `).get();
    const lockedKas = lockedRow?.total || 0;

    // KAS balance (if relayNodeId provided) — query via internal API
    let kasBalance = null;
    if (relayNodeId) {
      try {
        const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3100}/api/relay/${relayNodeId}/balance`);
        const data = await res.json();
        kasBalance = data?.balance != null ? parseFloat(data.balance) : null;
      } catch {}
    }

    return reply.send({
      limits: { per_offer_kas: perOfferLimit, total_exposure_kas: totalExposureLimit, price_deviation_pct: priceDeviationPct },
      status: {
        current_exposure_kas: Math.round(currentExposure * 100) / 100,
        available_kas: Math.round((totalExposureLimit - currentExposure) * 100) / 100,
        locked_kas: Math.round(lockedKas * 100) / 100,
        kas_balance: kasBalance,
      },
    });
  });

  // ── GET/PUT /api/exchange/autotaker-config — AutoTaker 配置 ──
  fastify.get('/api/exchange/autotaker-config', async (request, reply) => {
    const { getConfig } = await import('../data/settings/configs.js');
    return reply.send({
      enabled:          (await getConfig('autotake_enabled')) === 'true',
      mode:             (await getConfig('autotake_mode')) || 'approval',
      min_discount:     parseFloat(await getConfig('autotake_min_discount_pct') || '0.5'),
      max_amount:       parseFloat(await getConfig('autotake_max_amount_usdt') || '50'),
      daily_limit:      parseInt(await getConfig('autotake_daily_limit') || '3'),
      cooldown_sec:     parseInt(await getConfig('autotake_cooldown_sec') || '30'),
    });
  });

  fastify.put('/api/exchange/autotaker-config', async (request, reply) => {
    const { enabled, mode, min_discount, max_amount, daily_limit, cooldown_sec } = request.body || {};
    const { setConfig } = await import('../data/settings/configs.js');
    const cat = { category: 'exchange_autotaker' };
    const updates = [];
    if (enabled !== undefined) {
      await setConfig('autotake_enabled', enabled ? 'true' : 'false', cat);
      updates.push(`enabled=${enabled}`);
    }
    if (mode !== undefined) {
      if (!['approval', 'auto'].includes(mode))
        return reply.code(400).send({ error: 'mode must be approval|auto' });
      await setConfig('autotake_mode', mode, cat);
      updates.push(`mode=${mode}`);
    }
    if (min_discount !== undefined) {
      const v = parseFloat(min_discount);
      if (isNaN(v) || v < 0 || v > 50)
        return reply.code(400).send({ error: 'min_discount must be 0-50' });
      await setConfig('autotake_min_discount_pct', String(v), cat);
      updates.push(`min_discount=${v}`);
    }
    if (max_amount !== undefined) {
      const v = parseFloat(max_amount);
      if (isNaN(v) || v < 1)
        return reply.code(400).send({ error: 'max_amount must be >= 1' });
      await setConfig('autotake_max_amount_usdt', String(v), cat);
      updates.push(`max_amount=${v}`);
    }
    if (daily_limit !== undefined) {
      const v = parseInt(daily_limit);
      if (isNaN(v) || v < 1 || v > 100)
        return reply.code(400).send({ error: 'daily_limit must be 1-100' });
      await setConfig('autotake_daily_limit', String(v), cat);
      updates.push(`daily_limit=${v}`);
    }
    if (cooldown_sec !== undefined) {
      const v = parseInt(cooldown_sec);
      if (isNaN(v) || v < 5 || v > 3600)
        return reply.code(400).send({ error: 'cooldown_sec must be 5-3600' });
      await setConfig('autotake_cooldown_sec', String(v), cat);
      updates.push(`cooldown_sec=${v}`);
    }
    if (updates.length === 0) return reply.code(400).send({ error: 'No valid fields' });
    return reply.send({ ok: true, updated: updates });
  });

  // PUT /api/exchange/limits — 更新限额配置
  fastify.put('/api/exchange/limits', async (request, reply) => {
    const { per_offer_kas, total_exposure_kas, price_deviation_pct } = request.body || {};

    const { setConfig } = await import('../data/settings/configs.js');
    const updates = [];
    if (per_offer_kas !== undefined) {
      const val = parseFloat(per_offer_kas);
      if (isNaN(val) || val < 10) return reply.code(400).send({ error: 'per_offer_kas must be >= 10' });
      await setConfig('exchange_per_offer_kas_limit', String(val), { category: 'exchange_limits' });
      updates.push(`per_offer_kas=${val}`);
    }
    if (total_exposure_kas !== undefined) {
      const val = parseFloat(total_exposure_kas);
      if (isNaN(val) || val < 100) return reply.code(400).send({ error: 'total_exposure_kas must be >= 100' });
      await setConfig('exchange_total_exposure_kas_limit', String(val), { category: 'exchange_limits' });
      updates.push(`total_exposure_kas=${val}`);
    }
    if (price_deviation_pct !== undefined) {
      const val = parseFloat(price_deviation_pct);
      if (isNaN(val) || val < 1 || val > 50) return reply.code(400).send({ error: 'price_deviation_pct must be 1-50' });
      await setConfig('seeder_price_deviation_pct', String(val), { category: 'exchange_limits' });
      updates.push(`price_deviation_pct=${val}`);
    }

    if (updates.length === 0) return reply.code(400).send({ error: 'No valid fields provided' });
    return reply.send({ ok: true, updated: updates });
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

  // ── T9: Broker tab API ─────────────────────────────────
  fastify.get('/api/broker/stats', async (request, reply) => {
    try {
      // 当前 broker agent (is_dex_broker = 1)
      const broker = sqlite.prepare(
        "SELECT id, name, address FROM relay_nodes WHERE is_dex_broker = 1 LIMIT 1"
      ).get() || null;

      // 撮合费率 (从 retail_dex_broker_config, fallback '0.1')
      let feeKasPerOrder = '0.1';
      if (broker?.id) {
        const cfg = sqlite.prepare(
          "SELECT fee_kas_per_order FROM retail_dex_broker_config WHERE broker_relay_id = ?"
        ).get(broker.id);
        if (cfg?.fee_kas_per_order) feeKasPerOrder = cfg.fee_kas_per_order;
      }

      // 服务中订单 (active state)
      const activeOrders = sqlite.prepare(`
        SELECT id, user_kasia_address, side, order_type, qty, price, state, quoted_usdt, updated_at
        FROM retail_dex_orders
        WHERE state IN ('aligning', 'confirming', 'awaiting_payment', 'paid', 'executing')
        ORDER BY updated_at DESC
        LIMIT 50
      `).all();

      // 服务中 M2 限价挂单
      const activePublications = sqlite.prepare(`
        SELECT id, user_kasia_address, qty, limit_price, total_usdt, pay_chain, state, updated_at
        FROM retail_dex_buy_publications
        WHERE state IN ('awaiting_deposit', 'deposited', 'published', 'filled')
        ORDER BY updated_at DESC
        LIMIT 50
      `).all();

      // 累计成交
      const completed = sqlite.prepare(`
        SELECT COUNT(*) as cnt,
               COALESCE(SUM(CAST(qty AS REAL)), 0) as total_kas,
               COALESCE(SUM(CAST(broker_fee_kas AS REAL)), 0) as total_fee_kas
        FROM retail_dex_orders
        WHERE state = 'completed'
      `).get();

      const completedPubs = sqlite.prepare(`
        SELECT COUNT(*) as cnt,
               COALESCE(SUM(CAST(qty AS REAL)), 0) as total_kas_m2
        FROM retail_dex_buy_publications
        WHERE state = 'completed'
      `).get();

      return {
        broker: broker ? {
          relay_id: broker.id,
          name: broker.name,
          address: broker.address,
        } : null,
        fee_kas_per_order: feeKasPerOrder,
        active_orders: activeOrders,
        active_publications: activePublications,
        totals: {
          completed_orders: completed?.cnt || 0,
          completed_m2: completedPubs?.cnt || 0,
          total_kas_settled: Math.round(((completed?.total_kas || 0) + (completedPubs?.total_kas_m2 || 0)) * 100) / 100,
          total_broker_fee_kas: Math.round((completed?.total_fee_kas || 0) * 1000) / 1000,
        },
        policy: {
          non_custodial: true,
          timeout_minutes: 10,
          fee_transparent: true,
        },
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
