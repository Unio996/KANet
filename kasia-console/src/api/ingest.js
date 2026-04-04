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
