// kasia-console/src/api/admin.js
//
// Admin endpoints — manual recovery utilities, NOT user-facing.
// Per task PZ-HANDSHAKE-bug-report-and-fix v1.0 §方案 C: manual handshake accept
// when chain protocol path fails (e.g., counterparty client emitted self_stash 而非
// handshake 前缀, system 正确 reject 但 user 期望 KANet 接受).
//
// Auth: x-ingest-secret header (canonical KANet admin auth pattern, 9 sites convention).
// Permission gate keeps the endpoint local-only / privileged-callers-only.

import { verifyIngestRequest } from '../services/ingest-auth.js';
import { sendCommandAsync } from '../services/relay-manager.js';

export async function registerAdminRoutes(fastify) {
  // POST /api/admin/manual-handshake-accept — bypass chain protocol identification,
  // 直 trigger relay-side acceptHandshake 反向 (relay → remote address, 0.2 KAS TX).
  // Use case: user's Kasia client emitted wrong protocol prefix, KANet need 反向 handshake recovery.
  fastify.post(
    '/api/admin/manual-handshake-accept',
    { preHandler: [async (req, rep) => { await verifyIngestRequest(req, rep); }] },
    async (request, reply) => {
      const { relayNodeId, remoteAddress } = request.body || {};
      if (!relayNodeId || !remoteAddress) {
        return reply.code(400).send({ error: 'relayNodeId and remoteAddress required' });
      }
      try {
        const result = await sendCommandAsync(relayNodeId, { type: 'handshake', target: remoteAddress }, 15000);
        return reply.send({ ok: true, txId: result?.txId || null, fee: result?.fee || null });
      } catch (err) {
        return reply.code(503).send({ error: `relay send-command failed: ${err.message}` });
      }
    },
  );
}
