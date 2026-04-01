// Catch-up queries: relay calls these on startup to find work it missed.
// Returns data from Console DB — no external API needed.
import { sqlite } from '../db/client.js';

/**
 * Find handshakes that need Relay to accept — relation_states status = 'observed'.
 * Returns: [{ remoteAddress, txid, traceId, receivedAt }]
 *
 * v28: reads from relation_states (single source of truth).
 * 'observed' = Scout/ingest saw the handshake, Relay hasn't accepted yet.
 * This eliminates the old half-blind problem where catch-up only checked messages table.
 */
export function getPendingHandshakes(network = 'mainnet', localAddress = null) {
  const rows = sqlite.prepare(`
    SELECT
      rs.peer_address              AS remoteAddress,
      rs.first_seen_tx             AS txid,
      'catchup:' || rs.id          AS traceId,
      rs.handshake_observed_at     AS receivedAt
    FROM relation_states rs
    WHERE rs.status = 'observed'
      ${localAddress ? 'AND rs.local_address = ?' : ''}
    ORDER BY rs.handshake_observed_at DESC
    LIMIT 100
  `).all(...(localAddress ? [localAddress] : []));

  return rows;
}

/**
 * Find inbound messages that have no reply record.
 * Returns: [{ remoteAddress, localAddress, txid, traceId, message, receivedAt }]
 */
export function getUnrepliedMessages(network = 'mainnet', limit = 50) {
  const rows = sqlite.prepare(`
    SELECT
      m.source_txid   AS txid,
      m.trace_id      AS traceId,
      m.content_text  AS message,
      m.received_at   AS receivedAt,
      ri.address      AS remoteAddress,
      li.address      AS localAddress
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    JOIN identities ri  ON ri.id = c.remote_identity_id
    JOIN identities li  ON li.id = c.local_identity_id
    WHERE m.direction    = 'inbound'
      AND m.message_type = 'text'
      AND li.network     = ?
      AND ri.address LIKE 'kaspa:%'
      AND NOT EXISTS (
        SELECT 1 FROM replies r
        WHERE r.trace_id = m.trace_id
      )
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(network, limit);

  return rows;
}
