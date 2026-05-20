// Catch-up queries: relay calls these on startup to find work it missed.
// Returns data from Console DB — no external API needed.
import { sqlite } from '../db/client.js';

/**
 * Find pending actions for Relay to execute.
 * Returns: [{ id, actionType, direction, remoteAddress, localAddress, txid, traceId, receivedAt }]
 *
 * v44: reads from pending_actions (意图队列), not relation_states (事实层).
 * Only returns actions that haven't exceeded max_retries.
 */
export function getPendingHandshakes(network = 'mainnet', localAddress = null) {
  const rows = sqlite.prepare(`
    SELECT
      pa.id,
      pa.action_type               AS actionType,
      pa.direction,
      pa.target_address            AS remoteAddress,
      pa.local_address             AS localAddress,
      pa.trigger_txid              AS txid,
      'catchup:' || pa.id          AS traceId,
      pa.created_at                AS receivedAt
    FROM pending_actions pa
    WHERE pa.status = 'pending'
      AND pa.action_type = 'handshake_accept'
      AND pa.retry_count < pa.max_retries
      ${localAddress ? 'AND pa.local_address = ?' : ''}
    ORDER BY pa.created_at ASC
    LIMIT 100
  `).all(...(localAddress ? [localAddress] : []));

  return rows;
}

/**
 * Optimistic lock: atomically claim a pending action before executing.
 * Returns true if claimed, false if already taken by another consumer.
 */
export function claimPendingAction(actionId) {
  const now = new Date().toISOString();
  const result = sqlite.prepare(
    `UPDATE pending_actions SET status = 'executing', updated_at = ? WHERE id = ? AND status = 'pending'`
  ).run(now, actionId);
  return result.changes > 0;
}

/**
 * Mark action as done after successful execution.
 */
export function completePendingAction(actionId, resultTxid) {
  const now = new Date().toISOString();
  sqlite.prepare(
    `UPDATE pending_actions SET status = 'done', result_txid = ?, updated_at = ? WHERE id = ?`
  ).run(resultTxid || null, now, actionId);
}

/**
 * Mark action as failed. Increments retry_count, expires if over max_retries.
 */
export function failPendingAction(actionId, errorMsg) {
  const now = new Date().toISOString();
  const row = sqlite.prepare('SELECT retry_count, max_retries FROM pending_actions WHERE id = ?').get(actionId);
  if (!row) return;

  const newRetry = row.retry_count + 1;
  const newStatus = newRetry >= row.max_retries ? 'expired' : 'failed';

  // failed → back to pending for next retry; expired → terminal
  const finalStatus = newStatus === 'failed' ? 'pending' : 'expired';

  sqlite.prepare(
    `UPDATE pending_actions SET status = ?, retry_count = ?, error = ?, updated_at = ? WHERE id = ?`
  ).run(finalStatus, newRetry, errorMsg || null, now, actionId);
}

/**
 * Find inbound messages that have no reply record.
 * Returns: [{ remoteAddress, localAddress, txid, traceId, message, receivedAt }]
 */
export function getUnrepliedMessages(network = 'mainnet', limit = 50, sinceTs = null) {
  // Bug NWT-N7.1 fix 5/18 (Owner 4-month Trader-B menu spam pain): 旧 NOT EXISTS replies 漏
  // — ingestReply HTTP fail / trace_id mismatch / restart 后 _seen 清 → catch-up replay 同 inbound.
  // Layer B fix: check 实际 outbound message presence (true source of truth, not replies table).
  // 必 JOIN conversation_id (防 broker 主动 DM 同 peer 别的 conversation 误判已 reply).
  //
  // NWT N19.45 / Owner 5/19 钦定 "解除限制" P0 fix: 加 sinceTs filter 防 SQLite 排队.
  // 旧: 8 relay × 3 endpoint × NOT EXISTS scan messages 40k rows = console event loop block 20s+.
  // 修后: 加 m.created_at > sinceTs filter, relay 传 last-seen timestamp (default 24h ago if null).
  // SQL scan reduce 40k → 最近 N min messages (~50-200 rows typical).
  const sinceCutoff = sinceTs || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
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
      AND m.created_at   > ?
      AND li.network     = ?
      AND ri.address LIKE 'kaspa:%'
      AND NOT EXISTS (
        SELECT 1 FROM replies r
        WHERE r.trace_id = m.trace_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM messages outm
        WHERE outm.conversation_id = m.conversation_id
          AND outm.direction = 'outbound'
          AND outm.created_at > m.created_at
      )
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(sinceCutoff, network, limit);

  return rows;
}
