/**
 * Auth API — resolveRequestAuth endpoint for Adapter processes.
 *
 * Adapter calls GET /api/auth/resolve/:connectionId before each AI request.
 * Console returns the current valid auth context (headers, baseUrl, status).
 * Adapter never holds refresh_token or manages OAuth flow.
 */
import { resolveRequestAuth, getConnection, listConnections, ensureConnection, getConnectionByAdapter, updateConnectionStatus, retryRefresh } from '../services/connection-manager.js';
import { sqlite } from '../db/client.js';

export async function registerAuthRoutes(fastify) {

  // ── Core endpoint: Adapter calls this ──────────────────────────────────

  /**
   * GET /api/auth/resolve/:connectionId
   * Query: ?force_refresh=true (after 401)
   *
   * Returns RequestAuthContext:
   *   { connectionId, provider, status, headers, baseUrl, model, credentialVersion, ... }
   */
  fastify.get('/api/auth/resolve/:connectionId', async (request, reply) => {
    const { connectionId } = request.params;
    const forceRefresh = request.query.force_refresh === 'true';

    const ctx = await resolveRequestAuth(connectionId, forceRefresh);
    return reply.send(ctx);
  });

  // ── Adapter startup helper: resolve by adapter_node_id ─────────────────

  /**
   * GET /api/auth/resolve-by-adapter/:adapterNodeId
   * Convenience: find or create connection for an adapter, then resolve.
   */
  fastify.get('/api/auth/resolve-by-adapter/:adapterNodeId', async (request, reply) => {
    const { adapterNodeId } = request.params;
    const forceRefresh = request.query.force_refresh === 'true';

    const connectionId = ensureConnection(adapterNodeId);
    if (!connectionId) {
      return reply.code(404).send({
        status: 'error',
        errorCode: 'AUTH_PROVIDER_MISCONFIGURED',
        errorMessage: 'Adapter node not found',
      });
    }

    const ctx = await resolveRequestAuth(connectionId, forceRefresh);
    return reply.send(ctx);
  });

  // ── Management endpoints (for UI / debugging) ─────────────────────────

  /**
   * GET /api/auth/connections
   * List all connections with status.
   */
  fastify.get('/api/auth/connections', async (request, reply) => {
    const connections = listConnections();
    // Strip encrypted fields for UI safety
    const safe = connections.map(c => ({
      id: c.id,
      adapterNodeId: c.adapter_node_id,
      adapterName: c.adapter_name,
      adapterPort: c.adapter_port,
      provider: c.provider,
      authMode: c.auth_mode,
      status: c.status,
      baseUrl: c.base_url,
      model: c.model,
      expiresAt: c.expires_at,
      lastRefreshAt: c.last_refresh_at,
      lastRefreshError: c.last_refresh_error,
      credentialVersion: c.credential_version,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));
    return reply.send(safe);
  });

  /**
   * GET /api/auth/connection/:id
   * Single connection detail.
   */
  fastify.get('/api/auth/connection/:id', async (request, reply) => {
    const conn = getConnection(request.params.id);
    if (!conn) return reply.code(404).send({ error: 'Not found' });
    return reply.send({
      id: conn.id,
      adapterNodeId: conn.adapter_node_id,
      provider: conn.provider,
      authMode: conn.auth_mode,
      status: conn.status,
      baseUrl: conn.base_url,
      model: conn.model,
      expiresAt: conn.expires_at,
      lastRefreshAt: conn.last_refresh_at,
      lastRefreshError: conn.last_refresh_error,
      credentialVersion: conn.credential_version,
    });
  });

  /**
   * DELETE /api/auth/connection/:id
   * Remove a connection record.
   */
  fastify.delete('/api/auth/connection/:id', async (request, reply) => {
    const conn = getConnection(request.params.id);
    if (!conn) return reply.code(404).send({ error: 'Not found' });
    sqlite.prepare('DELETE FROM agent_connections WHERE id = ?').run(request.params.id);
    return reply.send({ ok: true });
  });

  /**
   * POST /api/auth/retry-refresh/:id
   * Manually force a token refresh for an OAuth connection. Used by UI to
   * revive an `expired` / `refresh_failed` connection without waiting for the
   * 60s worker tick. Returns updated status + expiresAt.
   */
  fastify.post('/api/auth/retry-refresh/:id', async (request, reply) => {
    try {
      const updated = await retryRefresh(request.params.id);
      return reply.send({
        ok: updated.status === 'connected',
        status: updated.status,
        expiresAt: updated.expires_at,
        error: updated.last_refresh_error,
      });
    } catch (e) {
      return reply.code(400).send({ ok: false, error: e.message });
    }
  });
}
