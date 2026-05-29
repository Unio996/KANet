// TG bot S2 (Bettor r211/r219 v1.3) — /link 0-key nonce + verifyMessage 绑定.
//
// 流程: 用户 TG /link <kaspa_addr> → bot POST /api/link/nonce → 返 nonce.
// 用户 Console UI 调 relay ecdsa_sign(nonce) → 拿 signature → 粘回 bot.
// bot POST /api/link/verify {address, telegram_user_id, signature, nonce}
//   → Console kaspa.verifyMessage → 成功 → INSERT user_notification_prefs (default subscribe 通用 event).
//
// 0-key 硬线 (memory feedback_kanet_skill_http_api_only + KI-12 ecdsa_sign sediment):
//   - bot 0 持 kaspa privkey, 仅传 message/signature/address.
//   - 签发生 relay (= 用户 own relay process, 已守 wallet boundary).
//   - Console 仅 verify 不 sign. address proof = 控制对应 relay = 控制 kaspa key.
//
// nonce in-memory Map TTL 5min (= 短暂, restart 丢失用户重申, 不上 DB 减表 churn).

import { sqlite } from '../db/client.js';
import { verifyIngestRequest } from '../services/ingest-auth.js';
import { randomBytes } from 'node:crypto';

const NONCE_TTL_MS = 5 * 60 * 1000;
const nonceCache = new Map(); // key = nonce, value = { address, tg_user_id, expires_at }

function pruneExpired() {
  const now = Date.now();
  for (const [k, v] of nonceCache) if (v.expires_at < now) nonceCache.delete(k);
}

export async function registerLinkRoutes(fastify) {
  // POST /api/link/nonce {address, telegram_user_id}
  // 返 nonce + expires_at. 用户拿 nonce 去 relay ecdsa_sign.
  fastify.post('/api/link/nonce', { preHandler: async (request, reply) => { await verifyIngestRequest(request, reply); } }, async (request, reply) => {
    pruneExpired();
    const { address, telegram_user_id } = request.body || {};
    if (!address || typeof address !== 'string' || !address.startsWith('kaspa')) {
      return reply.code(400).send({ ok: false, error: 'address required (kaspa: prefix)' });
    }
    if (!telegram_user_id || typeof telegram_user_id !== 'string') {
      return reply.code(400).send({ ok: false, error: 'telegram_user_id required' });
    }
    const nonce = `kanet-link-${randomBytes(16).toString('hex')}`;
    const expires_at = Date.now() + NONCE_TTL_MS;
    nonceCache.set(nonce, { address, tg_user_id: telegram_user_id, expires_at });
    return reply.send({ ok: true, nonce, expires_at, message_to_sign: nonce });
  });

  // POST /api/link/verify {address, telegram_user_id, nonce, signature}
  // verifyMessage → bind tg_user_id ↔ kaspa_address with default subscription.
  fastify.post('/api/link/verify', { preHandler: async (request, reply) => { await verifyIngestRequest(request, reply); } }, async (request, reply) => {
    pruneExpired();
    const { address, telegram_user_id, nonce, signature } = request.body || {};
    if (!address || !telegram_user_id || !nonce || !signature) {
      return reply.code(400).send({ ok: false, error: 'address + telegram_user_id + nonce + signature required' });
    }
    const cached = nonceCache.get(nonce);
    if (!cached) {
      return reply.code(400).send({ ok: false, error: 'nonce unknown or expired (5min TTL)' });
    }
    if (cached.address !== address || cached.tg_user_id !== telegram_user_id) {
      return reply.code(400).send({ ok: false, error: 'nonce binding mismatch (address or tg_user_id changed)' });
    }
    if (cached.expires_at < Date.now()) {
      nonceCache.delete(nonce);
      return reply.code(400).send({ ok: false, error: 'nonce expired (5min TTL)' });
    }
    // Resolve kaspa pubkey from address (verifyMessage needs publicKey; address is x-only encoded).
    // Pattern from prediction-params-cache.js: kaspa.verifyMessage({ message, signature, publicKey }).
    // For an address-controlled key the pubkey is derivable; but verifyMessage takes pubkey not address.
    // Resolution: caller must provide pubkey via relay get_pubkey path OR Console looks up relay_nodes.address → relay_id → relay get_pubkey IPC.
    let valid = false;
    let reason = '';
    try {
      const kaspa = await import('kaspa-wasm');
      // Try address-derived x-only pubkey path (= existing get_pubkey relay pattern).
      const xpk = kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(address));
      const xOnlyHex = xpk.toString();
      valid = kaspa.verifyMessage({ message: nonce, signature, publicKey: xOnlyHex });
    } catch (e) {
      reason = `verifyMessage exception: ${e.message}`;
    }
    if (!valid) {
      return reply.code(401).send({ ok: false, error: reason || 'signature verification failed' });
    }
    // Bind: default subscribe to generic 'notify' event_type. User refines via /subscribe later.
    nonceCache.delete(nonce);
    const stmt = sqlite.prepare(`
      INSERT OR REPLACE INTO user_notification_prefs (telegram_user_id, kaspa_address, event_type, subscribed, linked_at, updated_at)
      VALUES (?, ?, 'notify', 1, COALESCE((SELECT linked_at FROM user_notification_prefs WHERE telegram_user_id=? AND kaspa_address=? AND event_type='notify'), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
    `);
    stmt.run(telegram_user_id, address, telegram_user_id, address);
    return reply.send({ ok: true, address, telegram_user_id, linked: true });
  });

  // POST /api/link/subscribe {telegram_user_id, kaspa_address, event_type, subscribed}
  // 用户管订阅 — 唯一允许 bot Console write 项 (S5 lint+test 边界).
  // Requires prior /link/verify binding for (tg_user, addr) tuple (= 任意 row exists).
  fastify.post('/api/link/subscribe', { preHandler: async (request, reply) => { await verifyIngestRequest(request, reply); } }, async (request, reply) => {
    const { telegram_user_id, kaspa_address, event_type, subscribed } = request.body || {};
    if (!telegram_user_id || !kaspa_address || !event_type) {
      return reply.code(400).send({ ok: false, error: 'telegram_user_id + kaspa_address + event_type required' });
    }
    const sub = subscribed === false || subscribed === 0 ? 0 : 1;
    // Guard: require prior link (any row for this tg_user + addr) before allowing new subscription.
    const linked = sqlite.prepare(
      'SELECT 1 FROM user_notification_prefs WHERE telegram_user_id=? AND kaspa_address=? LIMIT 1'
    ).get(telegram_user_id, kaspa_address);
    if (!linked) {
      return reply.code(403).send({ ok: false, error: 'address not linked (call /api/link/verify first)' });
    }
    sqlite.prepare(`
      INSERT OR REPLACE INTO user_notification_prefs (telegram_user_id, kaspa_address, event_type, subscribed, linked_at, updated_at)
      VALUES (?, ?, ?, ?, COALESCE((SELECT linked_at FROM user_notification_prefs WHERE telegram_user_id=? AND kaspa_address=? AND event_type=?), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
    `).run(telegram_user_id, kaspa_address, event_type, sub, telegram_user_id, kaspa_address, event_type);
    return reply.send({ ok: true, telegram_user_id, kaspa_address, event_type, subscribed: sub });
  });
}
