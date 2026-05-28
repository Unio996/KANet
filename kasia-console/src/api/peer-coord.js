// Peer Coordination API — HTTP endpoints for paired agents (Tier 2.1)
//
// Per propose dev-channel-tier2-tunnel-propose-2026-05-28.md §2d.
//
// Routes (all require pair handshake established + ed25519 signed header):
//   GET  /api/peer/pairs                            — list my pairs (= no sig, internal)
//   GET  /api/peer/:pair_id/status                  — pair state + tunnel status
//   POST /api/peer/:pair_id/chat                    — send chat message to paired peer
//   GET  /api/peer/:pair_id/messages                — fetch chat history
//
// Sig verify (all POST + sensitive GET):
//   Header: X-KANet-Pair-Signature: base64(ed25519_sig)
//   Sig over: `${method} ${path} ${timestamp_ms} ${body_sha256_hex}`
//   Caller's pubkey resolved by request body.from_addr → agent_pairs row → peer_X_pubkey
//
// MVP scope: HTTP only (= UDP tunnel from nat-tunnel.mjs for Tier 2.2 file/stream).
// Encryption: none yet (= testnet, payloads not sensitive; Tier 2.2 加 TLS/ChaCha).

import crypto from 'node:crypto';
import { sqlite } from '../db/client.js';
import { importPubkeyBase64 } from '../services/nat-tunnel.mjs';

const SIG_TIMESTAMP_WINDOW_MS = 60_000;  // Reject sig > 60s old
const MAX_CHAT_LEN = 4500;

function getPairForRequester(pairId, fromAddr) {
  const row = sqlite.prepare(`
    SELECT * FROM agent_pairs WHERE pair_id = ?
  `).get(pairId);
  if (!row) return null;
  if (row.peer_a_addr === fromAddr) {
    return { ...row, requester_pubkey_b64: row.peer_a_pubkey, peer_addr: row.peer_b_addr };
  }
  if (row.peer_b_addr === fromAddr) {
    return { ...row, requester_pubkey_b64: row.peer_b_pubkey, peer_addr: row.peer_a_addr };
  }
  return null;
}

function verifyPairSignature(request, pairRow) {
  const sigHeader = request.headers['x-kanet-pair-signature'];
  const tsHeader = request.headers['x-kanet-pair-timestamp'];
  if (!sigHeader || !tsHeader) {
    return { ok: false, reason: 'missing X-KANet-Pair-Signature or X-KANet-Pair-Timestamp header' };
  }
  const ts = parseInt(tsHeader, 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'X-KANet-Pair-Timestamp not numeric' };
  const age = Date.now() - ts;
  if (Math.abs(age) > SIG_TIMESTAMP_WINDOW_MS) {
    return { ok: false, reason: `timestamp out of window (age ${age}ms)` };
  }
  const bodyStr = request.body ? JSON.stringify(request.body) : '';
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
  const challenge = `${request.method} ${request.url.split('?')[0]} ${ts} ${bodyHash}`;
  const challengeBuf = Buffer.from(challenge, 'utf-8');
  let sigBuf;
  try {
    sigBuf = Buffer.from(sigHeader, 'base64');
  } catch (e) {
    return { ok: false, reason: 'sig base64 decode fail' };
  }
  let pubkey;
  try {
    pubkey = importPubkeyBase64(pairRow.requester_pubkey_b64);
  } catch (e) {
    return { ok: false, reason: `pubkey import fail: ${e.message}` };
  }
  let sigOk;
  try {
    sigOk = crypto.verify(null, challengeBuf, pubkey, sigBuf);
  } catch (e) {
    return { ok: false, reason: `verify exception: ${e.message}` };
  }
  if (!sigOk) return { ok: false, reason: 'sig verify failed (= wrong key OR tampered request)' };
  return { ok: true };
}

export function registerPeerCoordRoutes(fastify) {
  // Lazy create peer_chat_log table on first use (defer schema migration to Tier 2.2)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS peer_chat_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pair_id TEXT NOT NULL,
      from_addr TEXT NOT NULL,
      to_addr TEXT NOT NULL,
      message TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      received_at INTEGER NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound'))
    );
    CREATE INDEX IF NOT EXISTS idx_peer_chat_pair_time ON peer_chat_log(pair_id, sent_at);
  `);

  // GET /api/peer/pairs — list all my pairs (= no sig, internal use)
  fastify.get('/api/peer/pairs', async (request, reply) => {
    const pairs = sqlite.prepare(`
      SELECT pair_id, peer_a_addr, peer_b_addr, pair_scope, tunnel_status,
             established_at, last_seen_at, bytes_sent, bytes_received
      FROM agent_pairs
      ORDER BY last_seen_at DESC, established_at DESC
      LIMIT 50
    `).all();
    return reply.send({ v: 0, pairs });
  });

  // GET /api/peer/:pair_id/status — pair state + tunnel status
  fastify.get('/api/peer/:pair_id/status', async (request, reply) => {
    const { pair_id } = request.params;
    const row = sqlite.prepare(`SELECT * FROM agent_pairs WHERE pair_id = ?`).get(pair_id);
    if (!row) return reply.code(404).send({ v: 0, ok: false, error: 'pair not found' });
    return reply.send({
      v: 0, ok: true,
      pair_id,
      peer_a_addr: row.peer_a_addr,
      peer_b_addr: row.peer_b_addr,
      pair_scope: row.pair_scope,
      tunnel_status: row.tunnel_status,
      tunnel_protocol: row.tunnel_protocol,
      established_at: row.established_at,
      last_seen_at: row.last_seen_at,
      bytes_sent: row.bytes_sent,
      bytes_received: row.bytes_received,
    });
  });

  // POST /api/peer/:pair_id/chat — send chat to paired peer
  // Body: { from_addr, message }
  // Headers: X-KANet-Pair-Signature, X-KANet-Pair-Timestamp
  fastify.post('/api/peer/:pair_id/chat', async (request, reply) => {
    const { pair_id } = request.params;
    const b = request.body || {};
    if (!b.from_addr) return reply.code(400).send({ v: 0, ok: false, error: 'missing body.from_addr' });
    if (!b.message || typeof b.message !== 'string') return reply.code(400).send({ v: 0, ok: false, error: 'missing body.message string' });
    if (b.message.length > MAX_CHAT_LEN) return reply.code(400).send({ v: 0, ok: false, error: `message exceeds ${MAX_CHAT_LEN} char` });

    const pair = getPairForRequester(pair_id, b.from_addr);
    if (!pair) return reply.code(404).send({ v: 0, ok: false, error: 'pair not found OR from_addr not party to pair' });

    const sigResult = verifyPairSignature(request, pair);
    if (!sigResult.ok) return reply.code(403).send({ v: 0, ok: false, error: 'sig_verify_fail', reason: sigResult.reason });

    const now = Date.now();
    sqlite.prepare(`
      INSERT INTO peer_chat_log (pair_id, from_addr, to_addr, message, sent_at, received_at, direction)
      VALUES (?, ?, ?, ?, ?, ?, 'inbound')
    `).run(pair_id, b.from_addr, pair.peer_addr, b.message, b.sent_at || now, now);

    // Update pair last_seen + bytes
    sqlite.prepare(`
      UPDATE agent_pairs SET last_seen_at = ?, bytes_received = bytes_received + ?
      WHERE pair_id = ?
    `).run(now, Buffer.byteLength(b.message, 'utf-8'), pair_id);

    return reply.send({ v: 0, ok: true, received_at: now });
  });

  // GET /api/peer/:pair_id/messages — chat history (= no sig, viewer-local read of inbox)
  fastify.get('/api/peer/:pair_id/messages', async (request, reply) => {
    const { pair_id } = request.params;
    const { since, limit: rawLimit } = request.query;
    const limit = Math.min(parseInt(rawLimit) || 50, 200);
    let sql = `SELECT id, from_addr, to_addr, message, sent_at, received_at, direction FROM peer_chat_log WHERE pair_id = ?`;
    const params = [pair_id];
    if (since) {
      sql += ' AND sent_at > ?';
      params.push(parseInt(since, 10));
    }
    sql += ' ORDER BY sent_at ASC LIMIT ?';
    params.push(limit);
    const messages = sqlite.prepare(sql).all(...params);
    return reply.send({ v: 0, pair_id, messages });
  });
}

/**
 * Helper for clients — build signed POST request to a peer's /api/peer/:pair_id/chat endpoint.
 * Returns { url, body, headers } ready to fetch.
 *
 * @param {object} opts
 * @param {string} opts.peer_console_url — e.g. http://192.168.1.108:3200
 * @param {string} opts.pair_id
 * @param {string} opts.from_addr — own kaspa addr
 * @param {string} opts.message
 * @param {KeyObject} opts.local_privkey — for ed25519 sign
 */
export function buildSignedChatRequest({ peer_console_url, pair_id, from_addr, message, local_privkey }) {
  const body = { from_addr, message, sent_at: Date.now() };
  const bodyStr = JSON.stringify(body);
  const bodyHash = crypto.createHash('sha256').update(bodyStr).digest('hex');
  const ts = Date.now();
  const path = `/api/peer/${pair_id}/chat`;
  const challenge = `POST ${path} ${ts} ${bodyHash}`;
  const sig = crypto.sign(null, Buffer.from(challenge, 'utf-8'), local_privkey);
  return {
    url: peer_console_url + path,
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-KANet-Pair-Signature': sig.toString('base64'),
      'X-KANet-Pair-Timestamp': String(ts),
    },
  };
}
