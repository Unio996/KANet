import { getConfig } from '../data/settings/configs.js';
import { computeAllHealth } from '../services/agent-health.js';

export async function registerHealthRoutes(fastify) {
  fastify.get('/health', async (request, reply) => {
    return reply.send({ ok: true, ts: new Date().toISOString() });
  });

  // Returns the ingest secret for display during setup
  fastify.get('/api/ingest-secret', async (request, reply) => {
    const secret = await getConfig('ingest_secret');
    const hint = secret ? secret.slice(0, 8) + '...' : null;
    return reply.send({ hint, configured: !!secret });
  });

  // Agent health monitor — per-agent traffic light status
  // Cached 30s, safe to poll at 60s intervals from UI
  fastify.get('/api/health/agents', async (request, reply) => {
    try {
      const data = await computeAllHealth();
      return reply.send(data);
    } catch (err) {
      console.error('[health] agent health error:', err.message);
      return reply.code(500).send({ error: 'health_check_failed' });
    }
  });
}
