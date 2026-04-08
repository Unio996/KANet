import { sqlite } from '../../db/client.js';
import { nowIso } from '../../lib/time.js';
import { randomUUID } from 'crypto';

/**
 * Record an on-chain interaction between two addresses.
 */
export function recordInteraction({ addressA, addressB, protocol = 'kasia', txHash, interactionType = 'message', occurredAt, weight = 1.0 }) {
  const id = randomUUID();
  const now = nowIso();
  sqlite.prepare(`
    INSERT OR IGNORE INTO interaction_records (id, address_a, address_b, protocol, tx_hash, interaction_type, occurred_at, weight, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, addressA, addressB, protocol, txHash, interactionType, occurredAt || now, weight, now);
  return id;
}

/**
 * Check if a tx_hash has already been recorded.
 */
export function hasInteraction(txHash) {
  return !!sqlite.prepare('SELECT 1 FROM interaction_records WHERE tx_hash = ?').get(txHash);
}

/**
 * Get interaction count for an address.
 */
export function getInteractionCount(address) {
  const row = sqlite.prepare(
    'SELECT COUNT(*) as cnt FROM interaction_records WHERE address_a = ? OR address_b = ?'
  ).get(address, address);
  return row.cnt;
}

/**
 * List interactions for an address, most recent first.
 */
export function listInteractions(address, { limit = 50, offset = 0 } = {}) {
  return sqlite.prepare(`
    SELECT * FROM interaction_records
    WHERE address_a = ? OR address_b = ?
    ORDER BY occurred_at DESC
    LIMIT ? OFFSET ?
  `).all(address, address, limit, offset);
}

/**
 * Get all unique addresses that interacted with a given address.
 */
export function getInteractionPeers(address) {
  const rows = sqlite.prepare(`
    SELECT DISTINCT CASE WHEN address_a = ? THEN address_b ELSE address_a END as peer
    FROM interaction_records
    WHERE address_a = ? OR address_b = ?
  `).all(address, address, address);
  return rows.map(r => r.peer);
}

/**
 * Get activity profiles for all Kasia addresses.
 * Returns per-address: first/last active, total count, type breakdown, hours active.
 */
export function getActivityProfiles(limit = 200) {
  return sqlite.prepare(`
    SELECT
      addr as address,
      MIN(occurred_at) as first_active,
      MAX(occurred_at) as last_active,
      COUNT(*) as total,
      SUM(CASE WHEN t='comm' THEN 1 ELSE 0 END) as comm,
      SUM(CASE WHEN t='handshake' THEN 1 ELSE 0 END) as handshake,
      SUM(CASE WHEN t='self_stash' THEN 1 ELSE 0 END) as self_stash,
      SUM(CASE WHEN t='legacy' THEN 1 ELSE 0 END) as legacy,
      SUM(CASE WHEN t='bcast' THEN 1 ELSE 0 END) as bcast,
      ROUND((julianday(MAX(occurred_at)) - julianday(MIN(occurred_at))) * 24, 1) as hours_active
    FROM (
      SELECT address_a as addr, interaction_type as t, occurred_at FROM interaction_records
      UNION ALL
      SELECT address_b as addr, interaction_type as t, occurred_at FROM interaction_records
      WHERE address_b != address_a
    )
    GROUP BY addr
    ORDER BY total DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Get handshake social graph (all directed connections).
 */
export function getHandshakeGraph() {
  return sqlite.prepare(`
    SELECT address_a as from_addr, address_b as to_addr, occurred_at, tx_hash
    FROM interaction_records
    WHERE interaction_type = 'handshake'
    ORDER BY occurred_at
  `).all();
}

/**
 * Get global summary stats.
 */
export function getNetworkStats() {
  return sqlite.prepare(`
    SELECT
      COUNT(*) as total_interactions,
      (SELECT COUNT(*) FROM (
        SELECT address_a AS addr FROM interaction_records
        UNION
        SELECT address_b AS addr FROM interaction_records
      )) as unique_addresses,
      (SELECT COUNT(*) FROM (
        SELECT DISTINCT
          CASE WHEN address_a < address_b THEN address_a ELSE address_b END AS a,
          CASE WHEN address_a < address_b THEN address_b ELSE address_a END AS b
        FROM interaction_records
        WHERE interaction_type = 'handshake'
      )) as unique_handshakes,
      MIN(occurred_at) as earliest,
      MAX(occurred_at) as latest
    FROM interaction_records
  `).get();
}
