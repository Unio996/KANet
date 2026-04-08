import { sqlite } from '../../db/client.js';
import { nowIso } from '../../lib/time.js';
import { randomUUID } from 'crypto';

export async function insertMessage({ traceId, conversationId = null, sourceMessageId = null, sourceTxid = null, direction = 'inbound', senderIdentityId = null, receiverIdentityId = null, messageType = 'text', contentText = '', contentJson = null, rawPayload = null, receivedAt = null }) {
  const now = nowIso();
  const id = randomUUID();
  sqlite.prepare(`INSERT INTO messages (id,trace_id,conversation_id,source_message_id,source_txid,direction,sender_identity_id,receiver_identity_id,message_type,content_text,content_json,raw_payload,received_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, traceId, conversationId, sourceMessageId, sourceTxid, direction, senderIdentityId, receiverIdentityId, messageType, contentText, contentJson ? JSON.stringify(contentJson) : null, rawPayload ? JSON.stringify(rawPayload) : null, receivedAt || now, now, now);
  return id;
}

export async function linkMessageToConversation(messageId, conversationId) {
  sqlite.prepare('UPDATE messages SET conversation_id=?, updated_at=? WHERE id=?').run(conversationId, nowIso(), messageId);
}

export async function getMessagesByConversation(conversationId) {
  return sqlite.prepare(`
    SELECT m.*,
      si.address as sender_address, ri.address as receiver_address
    FROM messages m
    LEFT JOIN identities si ON m.sender_identity_id = si.id
    LEFT JOIN identities ri ON m.receiver_identity_id = ri.id
    WHERE m.conversation_id=? ORDER BY m.received_at ASC
  `).all(conversationId);
}

export async function findMessageByTraceId(traceId) {
  return sqlite.prepare('SELECT * FROM messages WHERE trace_id=? LIMIT 1').get(traceId);
}

export async function findMessageByTxId(txid) {
  return sqlite.prepare('SELECT * FROM messages WHERE source_txid=? LIMIT 1').get(txid);
}
