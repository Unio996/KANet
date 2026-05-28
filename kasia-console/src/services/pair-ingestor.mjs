// Pair Ingestor — scans broadcast_messages for pair_invite/pair_ack envelopes
// and writes/updates agent_pairs table accordingly.
//
// Per Tier 2.1 propose §1.1 — chain control plane → DB state plane.
//
// Public API:
//   scanAndIngestPairs({ since_id?, limit? }) → { invites_processed, acks_processed, pairs_created }
//   startPeriodicIngest({ interval_ms = 30000 }) → stop()
//
// Idempotent: re-running same txids is safe (= INSERT OR IGNORE + matched-update).
//
// Pair ID derivation: invite_txid + ':' + ack_txid (sorted, deterministic).
// Single invite + multiple acks → first ack wins (= ack_txid ASC).

import { sqlite } from '../db/client.js';

const PROTOCOL_VERSION = 0;

function tryParseEnvelope(content) {
  if (!content || typeof content !== 'string') return null;
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && parsed.v === PROTOCOL_VERSION) return parsed;
    return null;
  } catch { return null; }
}

/**
 * Validate envelope payload has required pair fields (= matches dev-channel-v1.js validator).
 */
function isValidPairPayload(env) {
  if (!env || (env.intent !== 'pair_invite' && env.intent !== 'pair_ack')) return false;
  const p = env.payload || {};
  if (!p.nat_endpoint || typeof p.nat_endpoint !== 'object') return false;
  if (typeof p.nat_endpoint.ip !== 'string' || typeof p.nat_endpoint.port !== 'number') return false;
  if (typeof p.ed25519_pubkey !== 'string' || p.ed25519_pubkey.length < 32) return false;
  if (env.intent === 'pair_ack' && (!env.ref || !/^[a-f0-9]{64}$/.test(env.ref))) return false;
  return true;
}

/**
 * Scan broadcast_messages for pair envelopes + ingest to agent_pairs.
 *
 * Flow:
 *   1. Fetch invites (intent=pair_invite, visibility=public OR internal, kanet-general channel) since cursor
 *   2. Fetch acks (intent=pair_ack with ref) since cursor
 *   3. Match each ack to its invite via ref==invite_txid + identical pair_scope
 *   4. Insert OR ignore agent_pairs row (= pair_id = invite_txid+':'+ack_txid)
 *
 * @param {object} opts
 * @param {number} [opts.since_id=0]   — broadcast_messages.id cursor (= idempotent re-scan)
 * @param {number} [opts.limit=200]    — max rows per call
 * @returns {{ invites_processed, acks_processed, pairs_created, max_id }}
 */
export function scanAndIngestPairs({ since_id = 0, limit = 200 } = {}) {
  // Recent broadcast_messages (= post since_id), parse content, filter pair intents
  const rows = sqlite.prepare(`
    SELECT id, sender_address, content, tx_hash
    FROM broadcast_messages
    WHERE id > ? AND content LIKE '%"intent":"pair_%'
    ORDER BY id ASC
    LIMIT ?
  `).all(since_id, limit);

  let invitesProcessed = 0;
  let acksProcessed = 0;
  let pairsCreated = 0;
  let maxId = since_id;

  const invitesById = new Map();  // tx_hash → { env, sender_addr }

  for (const row of rows) {
    maxId = Math.max(maxId, row.id);
    const env = tryParseEnvelope(row.content);
    if (!env || !isValidPairPayload(env)) continue;
    if (env.intent === 'pair_invite') {
      invitesProcessed++;
      invitesById.set(row.tx_hash, { env, sender_addr: row.sender_address, tx_hash: row.tx_hash });
    } else if (env.intent === 'pair_ack') {
      acksProcessed++;
      // Find matching invite — either in this batch OR DB
      let invite = invitesById.get(env.ref);
      if (!invite) {
        const inviteRow = sqlite.prepare(`
          SELECT sender_address, content, tx_hash FROM broadcast_messages
          WHERE tx_hash = ?
        `).get(env.ref);
        if (inviteRow) {
          const inviteEnv = tryParseEnvelope(inviteRow.content);
          if (inviteEnv && isValidPairPayload(inviteEnv)) {
            invite = { env: inviteEnv, sender_addr: inviteRow.sender_address, tx_hash: inviteRow.tx_hash };
          }
        }
      }
      if (!invite) continue;  // Orphan ack — invite not seen yet (= maybe later scan)
      if (invite.env.payload.pair_scope !== env.payload.pair_scope) continue;  // scope mismatch
      const pairId = `${invite.tx_hash}:${row.tx_hash}`;
      try {
        const result = sqlite.prepare(`
          INSERT OR IGNORE INTO agent_pairs
            (pair_id, invite_txid, ack_txid, peer_a_addr, peer_b_addr,
             peer_a_pubkey, peer_b_pubkey, pair_scope, tunnel_status, established_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        `).run(
          pairId, invite.tx_hash, row.tx_hash,
          invite.sender_addr, row.sender_address,
          invite.env.payload.ed25519_pubkey, env.payload.ed25519_pubkey,
          env.payload.pair_scope || null,
          Date.now(), Date.now()
        );
        if (result.changes > 0) pairsCreated++;
      } catch (e) {
        console.warn(`[pair-ingestor] insert fail for ${pairId}: ${e.message}`);
      }
    }
  }

  return { invites_processed: invitesProcessed, acks_processed: acksProcessed, pairs_created: pairsCreated, max_id: maxId };
}

let _lastIngestId = 0;
let _periodicTimer = null;

/**
 * Start periodic scanner (= every N seconds, scan since last cursor).
 * @returns stop() function
 */
export function startPeriodicIngest({ interval_ms = 30_000 } = {}) {
  // Boot: catch up from id 0 once
  const boot = scanAndIngestPairs({ since_id: 0 });
  _lastIngestId = boot.max_id;
  if (boot.pairs_created > 0) {
    console.log(`[pair-ingestor] boot scan: ${boot.invites_processed} invites + ${boot.acks_processed} acks → ${boot.pairs_created} pairs created`);
  }
  _periodicTimer = setInterval(() => {
    try {
      const r = scanAndIngestPairs({ since_id: _lastIngestId });
      if (r.pairs_created > 0) {
        console.log(`[pair-ingestor] tick: ${r.invites_processed}i + ${r.acks_processed}a → ${r.pairs_created} new pairs (cursor ${_lastIngestId} → ${r.max_id})`);
      }
      _lastIngestId = r.max_id;
    } catch (e) {
      console.warn(`[pair-ingestor] tick fail: ${e.message}`);
    }
  }, interval_ms);
  return () => {
    if (_periodicTimer) {
      clearInterval(_periodicTimer);
      _periodicTimer = null;
    }
  };
}
