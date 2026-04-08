import { sqlite } from '../../db/client.js';
import { nowIso } from '../../lib/time.js';
import { randomUUID } from 'crypto';

const VALID_IDENTITY_TYPES = ['local', 'unknown', 'human', 'agent', 'kanet_agent'];
const VALID_DISCOVERY_STATUS = ['discovered', 'probing', 'identified', 'connected', 'inactive'];

/**
 * Register a newly discovered address from on-chain probe.
 * Returns identity id (existing or new).
 *
 * Discovery data is a shared KANet resource — writes to identities (global) only.
 * Relationship state is tracked in relation_states (per-agent, keyed by address).
 * relayNodeId parameter is accepted but ignored (backward compatibility).
 */
export function registerDiscoveredAddress({ network = 'mainnet', address, sourceProtocol = 'kasia', txHash = null }) {
  const now = nowIso();

  // Check if already known
  const existing = sqlite.prepare(
    'SELECT id, discovery_status FROM identities WHERE network = ? AND address = ?'
  ).get(network, address);

  if (existing) {
    // Update last_seen — global identity only
    sqlite.prepare(`
      UPDATE identities SET last_seen_at = ?, last_seen_tx = COALESCE(?, last_seen_tx),
        interaction_count = interaction_count + 1, updated_at = ?
      WHERE id = ?
    `).run(now, txHash, now, existing.id);

    return { id: existing.id, isNew: false, status: existing.discovery_status };
  }

  // New address — insert into global identities
  const id = randomUUID();
  sqlite.prepare(`
    INSERT INTO identities (id, network, address, identity_type, trust_level, discovery_status,
      discovered_at, last_seen_at, source_protocol, first_seen_tx, last_seen_tx,
      interaction_count, probe_attempt_count, successful_contact_count, confidence_score,
      created_at, updated_at)
    VALUES (?, ?, ?, 'unknown', 'normal', 'discovered', ?, ?, ?, ?, ?, 1, 0, 0, 0, ?, ?)
  `).run(id, network, address, now, now, sourceProtocol, txHash, txHash, now, now);

  return { id, isNew: true, status: 'discovered' };
}

/**
 * Update discovery status of an identity.
 */
export function setDiscoveryStatus(identityId, status) {
  if (!VALID_DISCOVERY_STATUS.includes(status)) return false;
  sqlite.prepare('UPDATE identities SET discovery_status = ?, updated_at = ? WHERE id = ?')
    .run(status, nowIso(), identityId);
  return true;
}

/**
 * Update identity type after identification.
 */
export function setIdentityType(identityId, type) {
  if (!VALID_IDENTITY_TYPES.includes(type)) return false;
  sqlite.prepare('UPDATE identities SET identity_type = ?, updated_at = ? WHERE id = ?')
    .run(type, nowIso(), identityId);
  return true;
}

/**
 * Record a probe attempt on an identity.
 */
export function recordProbeAttempt(identityId) {
  const now = nowIso();
  sqlite.prepare(`
    UPDATE identities SET discovery_status = 'probing', last_probed_at = ?,
      probe_attempt_count = probe_attempt_count + 1, updated_at = ?
    WHERE id = ?
  `).run(now, now, identityId);
}

/**
 * Record a successful contact (reply received).
 */
export function recordSuccessfulContact(identityId, { identityType = null, confidenceScore = null } = {}) {
  const now = nowIso();
  const updates = [
    'last_replied_at = ?', 'successful_contact_count = successful_contact_count + 1',
    'discovery_status = ?', 'updated_at = ?'
  ];
  const values = [now, identityType ? 'identified' : 'probing', now];

  if (identityType && VALID_IDENTITY_TYPES.includes(identityType)) {
    updates.push('identity_type = ?');
    values.push(identityType);
  }
  if (confidenceScore !== null) {
    updates.push('confidence_score = ?');
    values.push(confidenceScore);
  }
  values.push(identityId);

  sqlite.prepare(`UPDATE identities SET ${updates.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * Get addresses ready for probing (discovered but not yet probed, or inactive for retry).
 */
export function getProbeTargets({ limit = 20, network = 'mainnet' } = {}) {
  return sqlite.prepare(`
    SELECT * FROM identities
    WHERE network = ? AND identity_type != 'local'
      AND discovery_status IN ('discovered', 'inactive')
      AND (last_probed_at IS NULL OR last_probed_at < datetime('now', '-1 day'))
    ORDER BY discovered_at ASC
    LIMIT ?
  `).all(network, limit);
}

/**
 * Get discovery funnel stats.
 * If relayNodeId is provided, query from relation_states (per-agent view).
 * Otherwise, query global view from identities.
 */
export function getDiscoveryStats(relayNodeId = null) {
  if (relayNodeId) {
    // Per-agent stats from relation_states (v46: account_relations dropped)
    const addr = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(relayNodeId)?.address;
    if (!addr) return { total: 0, by_status: {}, relayNodeId };

    const byStatus = sqlite.prepare(`
      SELECT status, COUNT(*) as cnt FROM relation_states
      WHERE local_address = ?
      GROUP BY status
    `).all(addr);

    const total = sqlite.prepare(
      'SELECT COUNT(*) as n FROM relation_states WHERE local_address = ?'
    ).get(addr).n;

    return {
      total,
      by_status: Object.fromEntries(byStatus.map(r => [r.status, r.cnt])),
      relayNodeId,
    };
  }

  // Global stats from identities (backward compatible)
  const byStatus = sqlite.prepare(`
    SELECT discovery_status, COUNT(*) as cnt FROM identities
    WHERE identity_type != 'local'
    GROUP BY discovery_status
  `).all();

  const byType = sqlite.prepare(`
    SELECT identity_type, COUNT(*) as cnt FROM identities
    WHERE identity_type != 'local'
    GROUP BY identity_type
  `).all();

  const total = sqlite.prepare(
    "SELECT COUNT(*) as n FROM identities WHERE identity_type != 'local'"
  ).get().n;

  return {
    total,
    by_status: Object.fromEntries(byStatus.map(r => [r.discovery_status, r.cnt])),
    by_type: Object.fromEntries(byType.map(r => [r.identity_type, r.cnt])),
  };
}
