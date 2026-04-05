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
