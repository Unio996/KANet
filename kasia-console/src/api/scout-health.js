// scout-health.js — ④ pull-based scout health endpoint for external monitoring
// (root-cure for the 2026-06-21 :3200 6h silent-death incident).
//
// External monitors (curl / prometheus blackbox / uptime checks) poll this. It returns HTTP 503 when
// the scout ingest is unhealthy so a monitor can alarm on status code ALONE, without parsing JSON.
import { getScoutHealth } from '../services/scout-health.mjs';

export function registerScoutHealthRoutes(fastify) {
  // GET /api/system/scout-health — system-level health probe, no auth (read-only liveness signal).
  fastify.get('/api/system/scout-health', async (_request, reply) => {
    const h = getScoutHealth();
    // warming (fresh scout still writing its first checkpoint) is reported 200 — not an outage.
    reply.code(h.healthy || h.warming ? 200 : 503);
    return h;
  });
}
