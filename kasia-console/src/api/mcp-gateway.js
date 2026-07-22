import { randomUUID } from 'node:crypto';
import { sqlite } from '../db/client.js';
import { getRelayNode } from '../data/settings/relay-nodes.js';
import { getStatus as getRelayRuntimeStatus } from '../services/relay-manager.js';
import {
  canReadChannel,
  canWriteChannel,
  hashMcpMessage,
  hasValidInternalToken,
  loadMcpPolicy,
} from '../services/mcp-policy.js';

function ensureAuditSchema() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS mcp_audit_log (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      action TEXT NOT NULL,
      channel_name TEXT,
      outcome TEXT NOT NULL,
      message_sha256 TEXT,
      txid TEXT,
      result_count INTEGER,
      error_code TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_audit_created_at ON mcp_audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_mcp_audit_request_id ON mcp_audit_log(request_id);
  `);
}

function requestId(request) {
  const supplied = request.headers['x-kanet-mcp-request-id'];
  return typeof supplied === 'string' && supplied.length <= 100 ? supplied : randomUUID();
}

function beginAudit({ request, toolName, action, channel, messageHash }) {
  const id = randomUUID();
  const safeChannel = typeof channel === 'string' ? channel.slice(0, 100) : null;
  sqlite.prepare(`
    INSERT INTO mcp_audit_log
      (id, request_id, tool_name, action, channel_name, outcome, message_sha256, created_at)
    VALUES (?, ?, ?, ?, ?, 'started', ?, ?)
  `).run(id, requestId(request), toolName, action, safeChannel, messageHash || null, new Date().toISOString());
  return id;
}

function finishAudit(id, { outcome, txid, resultCount, errorCode }) {
  sqlite.prepare(`
    UPDATE mcp_audit_log
    SET outcome = ?, txid = ?, result_count = ?, error_code = ?, completed_at = ?
    WHERE id = ?
  `).run(
    outcome,
    txid || null,
    Number.isInteger(resultCount) ? resultCount : null,
    errorCode || null,
    new Date().toISOString(),
    id,
  );
}

export async function registerMcpGatewayRoutes(fastify) {
  ensureAuditSchema();
  const policy = loadMcpPolicy(process.env);

  async function requireInternalToken(request, reply) {
    if (!policy.enabled) {
      return reply.code(503).send({ error: 'mcp_gateway_disabled', detail: 'KANET_MCP_INTERNAL_TOKEN is not configured' });
    }
    const provided = request.headers['x-kanet-mcp-internal-token'];
    if (!hasValidInternalToken(provided, policy.internalToken)) {
      return reply.code(403).send({ error: 'mcp_internal_auth_failed' });
    }
  }

  fastify.get('/api/internal/mcp/channels', { preHandler: requireInternalToken }, async (request, reply) => {
    const auditId = beginAudit({ request, toolName: 'kanet.channels.list', action: 'read' });
    try {
      const channels = [...policy.readChannels].sort().map(name => {
        const stats = sqlite.prepare(`
          SELECT COUNT(*) AS message_count, MAX(created_at) AS last_message_at
          FROM broadcast_messages
          WHERE channel_name = ? AND status != 'local'
        `).get(name);
        return {
          name,
          access: policy.writeChannels.has(name) ? 'read_write' : 'read_only',
          message_count: stats?.message_count || 0,
          last_message_at: stats?.last_message_at || null,
        };
      });
      finishAudit(auditId, { outcome: 'success', resultCount: channels.length });
      return reply.send({ ok: true, channels });
    } catch (error) {
      finishAudit(auditId, { outcome: 'failed', errorCode: 'db_read_failed' });
      throw error;
    }
  });

  fastify.get('/api/internal/mcp/messages', { preHandler: requireInternalToken }, async (request, reply) => {
    const { channel, after, limit: rawLimit } = request.query || {};
    const auditId = beginAudit({ request, toolName: 'kanet.messages.read', action: 'read', channel });
    if (!canReadChannel(policy, channel)) {
      finishAudit(auditId, { outcome: 'denied', errorCode: 'channel_not_readable' });
      return reply.code(403).send({ error: 'channel_not_readable', channel });
    }
    if (after !== undefined && (typeof after !== 'string' || after.length > 64)) {
      finishAudit(auditId, { outcome: 'denied', errorCode: 'invalid_cursor' });
      return reply.code(400).send({ error: 'invalid_cursor' });
    }
    const limit = Math.min(Math.max(Number.parseInt(rawLimit || '50', 10) || 50, 1), 100);
    let sql = `
      SELECT id, channel_name, sender_address, content, tx_hash AS txid, status, created_at
      FROM broadcast_messages
      WHERE channel_name = ? AND status != 'local'
    `;
    const params = [channel];
    if (after) {
      sql += ' AND created_at > ?';
      params.push(after);
    }
    sql += ' ORDER BY created_at ASC LIMIT ?';
    params.push(limit);
    try {
      const messages = sqlite.prepare(sql).all(...params);
      const cursor = messages.at(-1)?.created_at || after || null;
      finishAudit(auditId, { outcome: 'success', resultCount: messages.length });
      return reply.send({ ok: true, channel, messages, cursor });
    } catch (error) {
      finishAudit(auditId, { outcome: 'failed', errorCode: 'db_read_failed' });
      throw error;
    }
  });

  fastify.post('/api/internal/mcp/messages', { preHandler: requireInternalToken }, async (request, reply) => {
    const { channel, message } = request.body || {};
    const messageHash = typeof message === 'string' ? hashMcpMessage(message) : null;
    const auditId = beginAudit({
      request,
      toolName: 'kanet.messages.send',
      action: 'chain_broadcast',
      channel,
      messageHash,
    });
    if (!canWriteChannel(policy, channel)) {
      finishAudit(auditId, { outcome: 'denied', errorCode: 'channel_not_writable' });
      return reply.code(403).send({ error: 'channel_not_writable', channel });
    }
    if (typeof message !== 'string' || !message.trim() || message.length > policy.maxMessageChars) {
      finishAudit(auditId, { outcome: 'denied', errorCode: 'invalid_message' });
      return reply.code(400).send({
        error: 'invalid_message',
        detail: `message must be 1-${policy.maxMessageChars} characters`,
      });
    }
    if (!policy.relayId) {
      finishAudit(auditId, { outcome: 'failed', errorCode: 'mcp_relay_not_configured' });
      return reply.code(503).send({ error: 'mcp_relay_not_configured' });
    }

    const baseUrl = process.env.KANET_MCP_CONSOLE_LOOPBACK_URL
      || `http://127.0.0.1:${process.env.PORT || 3100}`;
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          relayId: policy.relayId,
          channel,
          message: message.trim(),
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok || !payload?.txId) {
        finishAudit(auditId, {
          outcome: 'failed',
          errorCode: String(payload?.error || `chat_send_http_${response.status}`).slice(0, 100),
        });
        return reply.code(response.status || 500).send({
          error: 'chain_send_failed',
          detail: payload?.detail || payload?.error || `HTTP ${response.status}`,
        });
      }
      finishAudit(auditId, { outcome: 'success', txid: payload.txId });
      return reply.send({
        ok: true,
        channel,
        txid: payload.txId,
        fee: payload.fee || null,
        sender: getRelayNode(policy.relayId)?.address || null,
        message_sha256: messageHash,
      });
    } catch (error) {
      finishAudit(auditId, { outcome: 'failed', errorCode: 'chain_send_exception' });
      return reply.code(500).send({ error: 'chain_send_exception', detail: error.message });
    }
  });

  fastify.get('/api/internal/mcp/status', { preHandler: requireInternalToken }, async (request, reply) => {
    const auditId = beginAudit({ request, toolName: 'kanet.status.get', action: 'read' });
    try {
      const relay = policy.relayId ? getRelayNode(policy.relayId) : null;
      const runtime = getRelayRuntimeStatus().find(item => item.relayNodeId === policy.relayId);
      const auditSummary = sqlite.prepare(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS success,
               MAX(created_at) AS last_request_at
        FROM mcp_audit_log
      `).get();
      finishAudit(auditId, { outcome: 'success', resultCount: 1 });
      return reply.send({
        ok: true,
        enabled: policy.enabled,
        read_channels: [...policy.readChannels].sort(),
        write_channels: [...policy.writeChannels].sort(),
        relay: relay ? {
          id: relay.id,
          name: relay.name,
          address: relay.address,
          network: relay.network,
          running: Boolean(runtime),
        } : null,
        audit: auditSummary,
      });
    } catch (error) {
      finishAudit(auditId, { outcome: 'failed', errorCode: 'status_failed' });
      throw error;
    }
  });
}
