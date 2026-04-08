import { sqlite } from '../../db/client.js';
import { nowIso } from '../../lib/time.js';
import { randomUUID } from 'crypto';

export async function insertReply({ traceId, conversationId = null, messageId = null, replyType = 'ai', provider = 'openclaw', modelName = null, promptVersion = null, replyText = '', replyJson = null, intentCapturedJson = null, intentStatus = null, status = 'draft', sentTxid = null, errorText = null }) {
  const now = nowIso();
  const id = randomUUID();
  sqlite.prepare(`INSERT INTO replies (id,trace_id,conversation_id,message_id,reply_type,provider,model_name,prompt_version,reply_text,reply_json,intent_captured_json,intent_status,status,sent_txid,error_text,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, traceId, conversationId, messageId, replyType, provider, modelName, promptVersion, replyText, replyJson ? JSON.stringify(replyJson) : null, intentCapturedJson ? JSON.stringify(intentCapturedJson) : null, intentStatus, status, sentTxid, errorText, now, now);
  return id;
}

/** @deprecated 2026-03-27 — 全项目零调用。sent_txid 回填链路未实现。保留函数签名以防外部调用。 */
export async function updateReplyStatus(id, { status, sentTxid = null, errorText = null, intentCapturedJson = null, intentStatus = null }) {
  const now = nowIso();
  sqlite.prepare('UPDATE replies SET status=?,sent_txid=COALESCE(?,sent_txid),error_text=COALESCE(?,error_text),intent_captured_json=COALESCE(?,intent_captured_json),intent_status=COALESCE(?,intent_status),updated_at=? WHERE id=?')
    .run(status, sentTxid, errorText, intentCapturedJson ? JSON.stringify(intentCapturedJson) : null, intentStatus, now, id);
}

export async function getRepliesByConversation(conversationId) {
  return sqlite.prepare('SELECT * FROM replies WHERE conversation_id=? ORDER BY created_at ASC').all(conversationId);
}

export async function findReplyByTraceId(traceId) {
  return sqlite.prepare('SELECT * FROM replies WHERE trace_id=? ORDER BY created_at DESC LIMIT 1').get(traceId);
}
