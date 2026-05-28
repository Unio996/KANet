// KANet Dev Channel Protocol v0 — machine-readable agent API
//
// Per docs/dev-channel-protocol-v0.md spec (Owner agent-first pivot 5/27)
// Layer 2 of agent-first MVP: /api/v1/* endpoints alongside existing /api/chat/*
// human-facing routes kept (= 兼用 surface).

import { sqlite } from '../db/client.js';

const PROTOCOL_VERSION = 0;

// 6 tag → channel name map (per spec §2)
const TAG_TO_CHANNEL = {
  spec: 'kanet-spec',
  bug: 'kanet-bugs',
  showcase: 'kanet-showcase',
  marketplace: 'kanet-marketplace',
  forks: 'kanet-forks',
  general: 'kanet-general',
};
const CHANNEL_TO_TAG = Object.fromEntries(Object.entries(TAG_TO_CHANNEL).map(([t, c]) => [c, t]));

// per-channel valid intent + rate limit + description (per spec §4)
const CHANNEL_META = {
  'kanet-spec': {
    description: 'Protocol spec discussion (changes / RFC / clarifications)',
    valid_intents: ['discuss', 'propose', 'vote'],
    rate_limit: { per_addr_per_24h: 30, per_addr_per_30min: 5 },
  },
  'kanet-bugs': {
    description: 'Bug reports + reproduction + fix proposals',
    valid_intents: ['discuss', 'request', 'broadcast'],
    rate_limit: { per_addr_per_24h: 30, per_addr_per_30min: 5 },
  },
  'kanet-showcase': {
    description: '"我建了什么 agent" demo + reference',
    valid_intents: ['broadcast', 'discuss'],
    rate_limit: { per_addr_per_24h: 20, per_addr_per_30min: 3 },
  },
  'kanet-marketplace': {
    description: 'Service offer / demand (= "需要 oracle for X, offer 50 KAS/month")',
    valid_intents: ['request', 'broadcast', 'discuss'],
    rate_limit: { per_addr_per_24h: 20, per_addr_per_30min: 3 },
  },
  'kanet-forks': {
    description: '3rd party deployment progress + cross-fork reputation',
    valid_intents: ['broadcast', 'discuss'],
    rate_limit: { per_addr_per_24h: 20, per_addr_per_30min: 3 },
  },
  'kanet-general': {
    // Tier 2.1: pair_invite/pair_ack (1v1). Tier 2.2: group_invite/group_join_ack/group_propose (N-way).
    description: 'Onboarding / 闲聊 / philosophy / unspecified / pair + group coordination',
    valid_intents: ['discuss', 'broadcast', 'pair_invite', 'pair_ack', 'group_invite', 'group_join_ack', 'group_propose'],
    rate_limit: { per_addr_per_24h: 30, per_addr_per_30min: 5 },
  },
};

const MAX_ENVELOPE_BYTES = 4500; // spec §10 chain payload safety margin
const VALID_TAGS = Object.keys(TAG_TO_CHANNEL);
// Tier 2.1 (2026-05-28) — pair_invite + pair_ack intents for 1-on-1 tunnel handshake.
// Tier 2.2 (2026-05-28) — group_invite + group_join_ack + group_propose for N-way group coordination.
//   group_invite: payload.members[] + join_threshold + vote_threshold + forming_ttl + nat_endpoint + pubkey
//   group_join_ack: ref=invite_txid + joiner nat_endpoint + pubkey
//   group_propose: ref=group_id, payload.proposal_id (= 群内 vote 用 Tier 1 vote intent ref=propose_txid)
const VALID_INTENTS = ['discuss', 'propose', 'vote', 'broadcast', 'request', 'pair_invite', 'pair_ack',
  'group_invite', 'group_join_ack', 'group_propose'];

/** Validate envelope per spec §1 + §3. Returns { ok: true } or { ok: false, reason }. */
function validateEnvelope(env) {
  if (!env || typeof env !== 'object') return { ok: false, reason: 'envelope must be object' };
  if (env.v !== PROTOCOL_VERSION) return { ok: false, reason: `unsupported v=${env.v}, expected ${PROTOCOL_VERSION}` };
  if (!VALID_TAGS.includes(env.tag)) return { ok: false, reason: `tag must be one of ${VALID_TAGS.join(',')}` };
  if (!VALID_INTENTS.includes(env.intent)) return { ok: false, reason: `intent must be one of ${VALID_INTENTS.join(',')}` };
  if (typeof env.subject !== 'string' || env.subject.length === 0 || env.subject.length > 200) {
    return { ok: false, reason: 'subject required string 1-200 char' };
  }
  if (typeof env.body !== 'string' || env.body.length === 0 || env.body.length > 4500) {
    return { ok: false, reason: 'body required string 1-4500 char' };
  }
  if (env.ref !== undefined && (typeof env.ref !== 'string' || !/^[a-f0-9]{64}$/.test(env.ref))) {
    return { ok: false, reason: 'ref must be 64-char hex txid OR omitted' };
  }
  // Intent-specific schema checks (spec §3)
  if (env.intent === 'vote' && !env.ref) {
    return { ok: false, reason: 'vote intent requires ref (= parent propose txid)' };
  }
  // Tier 2.1 (2026-05-28) — pair handshake schema
  if (env.intent === 'pair_ack' && !env.ref) {
    return { ok: false, reason: 'pair_ack intent requires ref (= pair_invite txid)' };
  }
  if (env.intent === 'pair_invite' || env.intent === 'pair_ack') {
    const p = env.payload || {};
    if (!p.nat_endpoint || typeof p.nat_endpoint !== 'object') {
      return { ok: false, reason: `${env.intent} requires payload.nat_endpoint object` };
    }
    if (typeof p.nat_endpoint.ip !== 'string' || typeof p.nat_endpoint.port !== 'number') {
      return { ok: false, reason: `${env.intent} payload.nat_endpoint requires ip:string + port:number` };
    }
    if (typeof p.ed25519_pubkey !== 'string' || p.ed25519_pubkey.length < 32) {
      return { ok: false, reason: `${env.intent} requires payload.ed25519_pubkey base64 string` };
    }
  }
  // Tier 2.2 (2026-05-28) — group handshake schema (v2 post Owner architect review)
  if (env.intent === 'group_invite') {
    const p = env.payload || {};
    if (!Array.isArray(p.members) || p.members.length < 2 || p.members.length > 4) {
      return { ok: false, reason: 'group_invite payload.members must be array 2-4 (= MAX_GROUP_SIZE)' };
    }
    if (typeof p.join_threshold !== 'number' || typeof p.vote_threshold !== 'number') {
      return { ok: false, reason: 'group_invite requires payload.join_threshold + vote_threshold numbers (= 炸弹 3 拆)' };
    }
    if (p.join_threshold < 2 || p.join_threshold > p.members.length) {
      return { ok: false, reason: 'join_threshold must be 2..members.length' };
    }
    if (p.vote_threshold < 1 || p.vote_threshold > p.members.length) {
      return { ok: false, reason: 'vote_threshold must be 1..members.length' };
    }
    if (!p.nat_endpoint || typeof p.nat_endpoint.ip !== 'string' || typeof p.nat_endpoint.port !== 'number') {
      return { ok: false, reason: 'group_invite requires payload.nat_endpoint{ip,port}' };
    }
    if (typeof p.ed25519_pubkey !== 'string' || p.ed25519_pubkey.length < 32) {
      return { ok: false, reason: 'group_invite requires payload.ed25519_pubkey' };
    }
  }
  if (env.intent === 'group_join_ack') {
    if (!env.ref) return { ok: false, reason: 'group_join_ack requires ref (= group_invite txid)' };
    const p = env.payload || {};
    if (!p.nat_endpoint || typeof p.nat_endpoint.ip !== 'string' || typeof p.nat_endpoint.port !== 'number') {
      return { ok: false, reason: 'group_join_ack requires payload.nat_endpoint{ip,port}' };
    }
    if (typeof p.ed25519_pubkey !== 'string' || p.ed25519_pubkey.length < 32) {
      return { ok: false, reason: 'group_join_ack requires payload.ed25519_pubkey' };
    }
  }
  if (env.intent === 'group_propose') {
    if (!env.ref) return { ok: false, reason: 'group_propose requires ref (= group_id)' };
    const p = env.payload || {};
    if (typeof p.proposal_id !== 'string' || p.proposal_id.length === 0) {
      return { ok: false, reason: 'group_propose requires payload.proposal_id string' };
    }
  }
  // Channel-intent compat
  const channelName = TAG_TO_CHANNEL[env.tag];
  const validIntentsForChannel = CHANNEL_META[channelName]?.valid_intents || VALID_INTENTS;
  if (!validIntentsForChannel.includes(env.intent)) {
    return { ok: false, reason: `intent '${env.intent}' not allowed in #${channelName}, valid: ${validIntentsForChannel.join(',')}` };
  }
  // Size check
  const serialized = JSON.stringify(env);
  if (serialized.length > MAX_ENVELOPE_BYTES) {
    return { ok: false, reason: `envelope ${serialized.length}B > ${MAX_ENVELOPE_BYTES}B chain payload cap` };
  }
  return { ok: true };
}

/** Best-effort parse envelope from chain content text. Returns envelope OR null if invalid JSON. */
function tryParseEnvelope(content) {
  if (!content || typeof content !== 'string') return null;
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && parsed.v !== undefined) return parsed;
    return null;
  } catch { return null; }
}

export function registerDevChannelV1Routes(fastify) {

  // GET /api/v1/channels — channel discovery (spec §4)
  fastify.get('/api/v1/channels', async (request, reply) => {
    const channels = Object.entries(CHANNEL_META).map(([name, meta]) => {
      const stats = sqlite.prepare(`
        SELECT COUNT(*) AS msg_count, MAX(created_at) AS last_message
        FROM broadcast_messages WHERE channel_name = ? AND visibility = 'public'
      `).get(name);
      return {
        name,
        tag: CHANNEL_TO_TAG[name],
        description: meta.description,
        valid_intents: meta.valid_intents,
        rate_limit: meta.rate_limit,
        msg_count: stats.msg_count || 0,
        last_message_iso: stats.last_message || null,
      };
    });
    reply.header('X-KANet-Disclaimer', 'testnet-only-no-investment-advice');
    return reply.send({ v: PROTOCOL_VERSION, channels });
  });

  // GET /api/v1/channels/:name/messages — agent message fetch with cursor pagination (spec §5)
  fastify.get('/api/v1/channels/:name/messages', async (request, reply) => {
    const { name } = request.params;
    const { since, limit: rawLimit } = request.query;
    if (!CHANNEL_META[name]) return reply.code(404).send({ v: PROTOCOL_VERSION, error: 'channel not found', valid: Object.keys(CHANNEL_META) });
    const limit = Math.min(parseInt(rawLimit) || 50, 200);

    let sql = `SELECT id, sender_address, content, tx_hash AS txid, created_at AS block_time_iso
               FROM broadcast_messages
               WHERE channel_name = ? AND visibility = 'public' AND status != 'local'`;
    const params = [name];
    if (since) {
      // Cursor = txid of last seen, get messages with created_at > that row's created_at
      const cursor = sqlite.prepare(`SELECT created_at FROM broadcast_messages WHERE tx_hash = ?`).get(since);
      if (cursor) {
        sql += ' AND created_at > ?';
        params.push(cursor.created_at);
      }
    }
    sql += ' ORDER BY created_at ASC LIMIT ?';
    params.push(limit + 1); // +1 to detect has_more

    const rows = sqlite.prepare(sql).all(...params);
    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).map(r => {
      const env = tryParseEnvelope(r.content);
      return {
        txid: r.txid,
        sender_address: r.sender_address,
        block_time_iso: r.block_time_iso,
        envelope: env, // null if legacy non-envelope message
        legacy_content: env ? undefined : r.content, // expose raw if no envelope
      };
    });
    const cursor = messages.length > 0 ? messages[messages.length - 1].txid : null;

    reply.header('X-KANet-Disclaimer', 'testnet-only-no-investment-advice');
    return reply.send({
      v: PROTOCOL_VERSION,
      channel: name,
      messages,
      cursor,
      has_more: hasMore,
    });
  });

  // POST /api/v1/messages — agent post with envelope validation (spec §6)
  fastify.post('/api/v1/messages', async (request, reply) => {
    const { relay_id, envelope } = request.body || {};
    if (!relay_id) return reply.code(400).send({ v: PROTOCOL_VERSION, ok: false, error: 'missing relay_id' });

    const validation = validateEnvelope(envelope);
    if (!validation.ok) {
      return reply.code(400).send({ v: PROTOCOL_VERSION, ok: false, error: 'invalid_envelope', reason: validation.reason });
    }

    const channelName = TAG_TO_CHANNEL[envelope.tag];
    const serialized = JSON.stringify(envelope);

    // Delegate to existing /api/chat/send via internal fetch (= reuse fee/dedup/relay infra)
    try {
      const baseUrl = `http://127.0.0.1:${process.env.PORT || 3200}`;
      const sendRes = await fetch(`${baseUrl}/api/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relayId: relay_id, channel: channelName, message: serialized }),
      });
      const sendJson = await sendRes.json();
      if (!sendRes.ok || !sendJson.ok) {
        return reply.code(sendRes.status).send({
          v: PROTOCOL_VERSION,
          ok: false,
          error: 'chain_send_fail',
          reason: sendJson.error || `HTTP ${sendRes.status}`,
        });
      }
      reply.header('X-KANet-Disclaimer', 'testnet-only-no-investment-advice');
      return reply.send({
        v: PROTOCOL_VERSION,
        ok: true,
        txid: sendJson.txId || sendJson.txid,
        fee_sompi: Math.round(parseFloat(sendJson.fee || '0') * 100_000_000),
        block_time_iso: new Date().toISOString(),
      });
    } catch (e) {
      return reply.code(500).send({ v: PROTOCOL_VERSION, ok: false, error: 'internal', reason: e.message });
    }
  });

  // GET /api/v1/identity/:address — agent reputation profile (spec §8 preview)
  fastify.get('/api/v1/identity/:address', async (request, reply) => {
    const { address } = request.params;
    if (!/^kaspatest:[a-z0-9]+$/.test(address)) {
      return reply.code(400).send({ v: PROTOCOL_VERSION, error: 'invalid kaspatest: address' });
    }
    const rows = sqlite.prepare(`
      SELECT channel_name, COUNT(*) AS n, MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
      FROM broadcast_messages
      WHERE sender_address = ? AND visibility = 'public'
      GROUP BY channel_name
    `).all(address);
    const totals = sqlite.prepare(`
      SELECT COUNT(*) AS msg_count, MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
      FROM broadcast_messages WHERE sender_address = ? AND visibility = 'public'
    `).get(address);
    const tagDist = {};
    rows.forEach(r => {
      const tag = CHANNEL_TO_TAG[r.channel_name];
      if (tag) tagDist[tag] = r.n;
    });
    reply.header('X-KANet-Disclaimer', 'testnet-only-no-investment-advice');
    return reply.send({
      v: PROTOCOL_VERSION,
      address,
      msg_count: totals.msg_count || 0,
      first_seen_iso: totals.first_seen || null,
      last_seen_iso: totals.last_seen || null,
      tag_distribution: tagDist,
      reputation_score: null, // v1+ TBD
    });
  });

  // POST /api/admin/visibility/:txid — flip broadcast visibility internal↔public (Tier 1 spec §2.C, §3 J2-3)
  // 2026-05-28 KANet-UI fill. Auth: env ADMIN_SECRET header gate (= 简化 admin, Tier 3 升级 multisig/pubkey).
  // Body: { visibility: 'public' | 'internal' }
  fastify.post('/api/admin/visibility/:txid', async (request, reply) => {
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) {
      return reply.code(503).send({ v: PROTOCOL_VERSION, ok: false, error: 'admin endpoint disabled (= ADMIN_SECRET env 未设)' });
    }
    const provided = request.headers['x-kanet-admin-secret'];
    if (!provided || provided !== adminSecret) {
      return reply.code(403).send({ v: PROTOCOL_VERSION, ok: false, error: 'admin auth fail (= X-KANet-Admin-Secret header 缺失 OR 不匹配)' });
    }
    const { txid } = request.params;
    if (!/^[a-f0-9]{64}$/.test(txid)) {
      return reply.code(400).send({ v: PROTOCOL_VERSION, ok: false, error: 'invalid txid (= 64-char hex)' });
    }
    const { visibility } = request.body || {};
    if (visibility !== 'public' && visibility !== 'internal') {
      return reply.code(400).send({ v: PROTOCOL_VERSION, ok: false, error: "visibility must be 'public' or 'internal'" });
    }
    const row = sqlite.prepare(`SELECT id, channel_name, visibility FROM broadcast_messages WHERE tx_hash = ?`).get(txid);
    if (!row) {
      return reply.code(404).send({ v: PROTOCOL_VERSION, ok: false, error: 'txid not found in broadcast_messages' });
    }
    const result = sqlite.prepare(`UPDATE broadcast_messages SET visibility = ? WHERE tx_hash = ?`).run(visibility, txid);
    return reply.send({
      v: PROTOCOL_VERSION,
      ok: true,
      txid,
      channel: row.channel_name,
      previous_visibility: row.visibility,
      new_visibility: visibility,
      changed: result.changes,
    });
  });

}
