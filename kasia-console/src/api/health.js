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

  // LLM upstream health — alive (port reachable) vs functioning (200 OK on probe).
  // KI-16 sediment: agent-health adapter=green hides upstream LLM silent crash. Probe :8000 + :4000 directly.
  fastify.get('/api/system/llm-health', async (request, reply) => {
    async function probe(url) {
      const out = { alive: false, functioning: false, latency_ms: null };
      const t0 = Date.now();
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        out.alive = true;
        out.latency_ms = Date.now() - t0;
        out.functioning = res.ok;
      } catch {}
      return out;
    }
    const llama = await probe('http://127.0.0.1:8000/health');
    const litellm = await probe('http://127.0.0.1:4000/health/liveliness');
    const overall = llama.functioning && litellm.functioning
      ? 'green'
      : (llama.alive || litellm.alive ? 'yellow' : 'red');
    return reply.send({
      ts: new Date().toISOString(),
      llama_server: llama,
      litellm,
      overall,
    });
  });
}
