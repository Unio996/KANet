import { verifyIngestRequest } from '../services/ingest-auth.js';
import { handleIngestMessage, handleIngestReply, handleIngestTx, handleIngestEvent } from '../services/ingest-service.js';
import { getPendingHandshakes, getUnrepliedMessages } from '../services/catchup-service.js';

export async function registerIngestRoutes(fastify) {
  // All ingest routes require PSK auth
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/ingest/')) {
      await verifyIngestRequest(request, reply);
    }
  });

  fastify.post('/ingest/message', async (request, reply) => {
    const result = await handleIngestMessage(request.body);
    return reply.code(201).send({ ok: true, ...result });
  });

  fastify.post('/ingest/reply', async (request, reply) => {
    const result = await handleIngestReply(request.body);
    return reply.code(201).send({ ok: true, ...result });
  });

  fastify.post('/ingest/tx', async (request, reply) => {
    const result = await handleIngestTx(request.body);
    return reply.code(201).send({ ok: true, ...result });
  });

  fastify.post('/ingest/event', async (request, reply) => {
    const result = await handleIngestEvent(request.body);
    return reply.code(201).send({ ok: true, ...result });
  });

  // ── POST /ingest/kaspa-tx — Relay reports an observed Kaspa TX ──
  //
  // Relay pre-filters blocks against watched-addresses set and only posts matches.
  // Console writes to kaspa_tx_log for later verification queries. Idempotent.
  //
  // Body: { txId, blockHash, blockTime, fromAddress, toAddress, amount, outputs, network }
  fastify.post('/ingest/kaspa-tx', async (request, reply) => {
    const { txId, blockHash, blockTime, fromAddress, toAddress, amount, outputs, network } = request.body || {};
    if (!txId || !toAddress || amount === undefined) {
      return reply.code(400).send({ error: 'txId, toAddress, amount required' });
    }
    try {
      const { sqlite } = await import('../db/client.js');
      const now = new Date().toISOString();
      sqlite.prepare(`
        INSERT OR IGNORE INTO kaspa_tx_log
          (tx_id, block_hash, block_time, from_address, to_address, amount, outputs_json, observed_at, network)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        txId,
        blockHash || null,
        blockTime || null,
        fromAddress || null,
        toAddress,
        parseFloat(amount),
        outputs ? JSON.stringify(outputs) : null,
        now,
        network || 'mainnet',
      );
      return reply.code(201).send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── POST /ingest/spc-daa-block — Relay reports a finality-safe SPC block ──
  // (docs/2026-07-08-backward-walk-daa-index-design.md §2.2, J1tn 2026-07-16 补落码)
  //
  // Relay only calls this once a block is SPC_INDEX_FINALITY_DEPTH deep (see rpc-listener.mjs) —
  // by the time Console sees it, the (daaScore, blockHash) binding is GHOSTDAG-final and cannot be
  // reorg'd out, so INSERT OR IGNORE is safe (NWT attack-surface review #o0056j MUST-FIX closed by
  // the finality gate living on the write side, not here).
  //
  // §2.5 覆盖区间维护: 判定新块是否与当前最新区间"相邻"——阈值(SPC_INDEX_ADJACENCY_PLACEHOLDER)是
  // 占位值(NWT note: 宁紧勿松, 明天用 backfill 实数据的相邻 daa_score 差值分布校准, 不是最终值)。
  //
  // Body: { daaScore, blockHash, timestampMs, network }
  const SPC_INDEX_ADJACENCY_PLACEHOLDER = 10; // TODO(J1tn, 明天): 用 spc_daa_index 实数据分布校准
  fastify.post('/ingest/spc-daa-block', async (request, reply) => {
    const { daaScore, blockHash, timestampMs } = request.body || {};
    if (!Number.isFinite(daaScore) || !blockHash) {
      return reply.code(400).send({ error: 'daaScore (number), blockHash required' });
    }
    try {
      const { sqlite } = await import('../db/client.js');
      sqlite.prepare(`
        INSERT OR IGNORE INTO spc_daa_index (daa_score, block_hash, timestamp_ms)
        VALUES (?, ?, ?)
      `).run(daaScore, blockHash, timestampMs || 0);

      const latest = sqlite.prepare(`
        SELECT id, start_daa, end_daa FROM spc_daa_index_coverage ORDER BY end_daa DESC LIMIT 1
      `).get();
      if (latest && (daaScore - latest.end_daa) >= 0 && (daaScore - latest.end_daa) <= SPC_INDEX_ADJACENCY_PLACEHOLDER) {
        sqlite.prepare(`UPDATE spc_daa_index_coverage SET end_daa = ? WHERE id = ?`).run(daaScore, latest.id);
      } else if (!latest || daaScore > latest.end_daa) {
        // 不相邻(relay 重启/console backoff 造成的洞)或首条区间——开新区间，旧区间原样保留(诚实标注洞)。
        sqlite.prepare(`
          INSERT INTO spc_daa_index_coverage (start_daa, end_daa) VALUES (?, ?)
        `).run(daaScore, daaScore);
      }
      // daaScore <= latest.end_daa（乱序到达）: 已在某区间内或早于当前覆盖起点, INSERT OR IGNORE 已处理数据本身, 覆盖区间不用动。

      return reply.code(201).send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── POST /ingest/spc-tip-heartbeat — Relay reports its locally-observed tip daaScore ──
  // Console 完整性巡检据此判断 spc_daa_index 写入器是否停更(§2.2 note①, 9ez2u 同族根因防线)，
  // 不直连 kaspad RPC(Relay 唯一链上出口, docs/KANet-Positioning.md)。
  //
  // Body: { daaScore, network }
  fastify.post('/ingest/spc-tip-heartbeat', async (request, reply) => {
    const { daaScore } = request.body || {};
    if (!Number.isFinite(daaScore)) {
      return reply.code(400).send({ error: 'daaScore (number) required' });
    }
    try {
      const { sqlite } = await import('../db/client.js');
      sqlite.prepare(`
        INSERT INTO spc_tip_heartbeat (id, daa_score, updated_at) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET daa_score = excluded.daa_score, updated_at = excluded.updated_at
      `).run(daaScore, new Date().toISOString());
      return reply.code(201).send({ ok: true });
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── GET /api/indexer/watched-addresses — Relay polls this to know what to index ──
  // (Note: this route is under /api, not /ingest, because it's a read not a write)
  //
  // Returns a flat array of Kaspa addresses that Relay should watch block outputs for.
  // Source: (1) local relay_nodes addresses, (2) exchange counterparties (makers/takers),
  // (3) identities observed recently.
  fastify.get('/api/indexer/watched-addresses', async (request, reply) => {
    const { sqlite } = await import('../db/client.js');
    const network = request.query?.network || 'mainnet';
    const addrs = new Set();

    // Local agents
    sqlite.prepare('SELECT address FROM relay_nodes WHERE address IS NOT NULL').all()
      .forEach(r => addrs.add(r.address));

    // Exchange counterparties (makers + takers from last 30 days)
    sqlite.prepare(`
      SELECT DISTINCT maker as addr FROM exchange_offers WHERE maker IS NOT NULL
      UNION SELECT DISTINCT taker as addr FROM exchange_offers WHERE taker IS NOT NULL
    `).all().forEach(r => addrs.add(r.addr));

    // Recent identities
    try {
      sqlite.prepare(`SELECT address FROM identities WHERE last_seen_at > datetime('now','-30 days')`).all()
        .forEach(r => addrs.add(r.address));
    } catch {}

    return reply.send({
      addresses: [...addrs].filter(Boolean),
      network,
      count: addrs.size,
    });
  });

  // Catch-up endpoints: relay queries these on startup to find work it missed
  fastify.get('/ingest/pending-handshakes', async (request, reply) => {
    const { claim } = request.query;

    // Optimistic lock: claim a specific pending action by id
    if (claim) {
      const { claimPendingAction } = await import('../services/catchup-service.js');
      const claimed = claimPendingAction(claim);
      return reply.send({ claimed });
    }

    // Atomic create + claim: write pending_action and lock it in one step
    // Used by realtime path (Relay) and Mind (action-executor) before spending KAS
    const { create_and_claim, local_address, target_address, trigger_txid,
            action_type: reqActionType, direction: reqDirection, source: reqSource } = request.query;
    if (create_and_claim && local_address && target_address) {
      const { claimPendingAction } = await import('../services/catchup-service.js');
      const { randomUUID } = await import('crypto');
      const { sqlite } = await import('../db/client.js');
      const now = new Date().toISOString();
      const id = randomUUID();
      const actionType = reqActionType || 'handshake_accept';
      const direction = reqDirection || 'inbound';
      const source = reqSource || 'relay';
      const key = `${actionType}:${local_address}:${target_address}`;

      // 2026-04-23 修复: 原 guard 用 handshake_observed_at 导致 inbound 握手首次也被拦,
      // accept 动作永远不触发. 改为 handshake_accepted_at 才是"我已接受过"的真实语义.
      if (actionType === 'handshake_accept' || actionType === 'handshake_init') {
        const already = sqlite.prepare(`
          SELECT 1 FROM relation_states
          WHERE local_address = ? AND peer_address = ?
            AND (handshake_accepted_at IS NOT NULL
              OR status IN ('accepted','confirmed','active'))
          LIMIT 1
        `).get(local_address, target_address);
        if (already) {
          console.log(`[ingest] reject ${actionType}: already active with ${target_address.slice(-12)}`);
          return reply.send({ claimed: false, reason: 'already_active' });
        }
      }

      // INSERT OR IGNORE — if already exists, this is a no-op
      sqlite.prepare(`
        INSERT OR IGNORE INTO pending_actions
          (id, action_type, direction, local_address, target_address, source, idempotent_key, status, trigger_txid, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `).run(id, actionType, direction, local_address, target_address, source, key, trigger_txid || null, now, now);

      // Claim — works whether we just inserted or record already existed
      const existing = sqlite.prepare(
        `SELECT id FROM pending_actions WHERE idempotent_key = ? AND status = 'pending'`
      ).get(key);
      const claimed = existing ? claimPendingAction(existing.id) : false;

      return reply.send({ claimed, actionId: existing?.id || id });
    }

    // Normal: return pending actions list
    const network = request.query.network || 'mainnet';
    const localAddress = request.query.address || null;
    const results = getPendingHandshakes(network, localAddress);
    return reply.send({ handshakes: results });
  });

  fastify.get('/ingest/unreplied-messages', async (request, reply) => {
    const network = request.query.network || 'mainnet';
    const limit = parseInt(request.query.limit) || 50;
    const results = getUnrepliedMessages(network, limit);
    return reply.send({ messages: results });
  });

}
