import { verifyIngestRequest } from '../services/ingest-auth.js';
import { getContextByAddress } from '../data/state/context.js';

export async function registerContextRoutes(fastify) {
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/api/context')) {
      await verifyIngestRequest(request, reply);
    }
  });

  // GET /api/context/:address?network=mainnet&limit=10
  // Returns identity metadata + last N conversation turns, ready to inject into prompt.
  fastify.get('/api/context/:address', async (request, reply) => {
    const { address } = request.params;
    const network = request.query.network || 'mainnet';
    const limit = Math.min(parseInt(request.query.limit) || 10, 50);

    const ctx = getContextByAddress(address, network, limit);
    if (!ctx) return reply.code(404).send({ error: 'Unknown address' });

    return reply.send(ctx);
  });
}
