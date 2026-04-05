import { sqlite } from '../../db/client.js';
import { nowIso } from '../../lib/time.js';
import { randomUUID } from 'crypto';

export async function upsertTxRecord({ traceId, conversationId = null, messageId = null, replyId = null, direction = 'outbound', network = 'mainnet', txid, amount = null, fee = null, localAddress = null, status = 'broadcasted', rawTxJson = null }) {
  const now = nowIso();
  const existing = sqlite.prepare('SELECT id FROM tx_records WHERE txid=?').get(txid);
  if (existing) {
    sqlite.prepare('UPDATE tx_records SET status=?,updated_at=?,conversation_id=COALESCE(?,conversation_id),reply_id=COALESCE(?,reply_id),local_address=COALESCE(?,local_address) WHERE txid=?')
      .run(status, now, conversationId, replyId, localAddress, txid);
    return existing.id;
  }
  const id = randomUUID();
  sqlite.prepare(`INSERT INTO tx_records (id,trace_id,conversation_id,message_id,reply_id,direction,network,txid,amount,fee,local_address,status,raw_tx_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, traceId, conversationId, messageId, replyId, direction, network, txid, amount, fee, localAddress, status, rawTxJson ? JSON.stringify(rawTxJson) : null, now, now);
  return id;
}

export async function getTxsByConversation(conversationId) {
  return sqlite.prepare('SELECT * FROM tx_records WHERE conversation_id=? ORDER BY created_at DESC').all(conversationId);
}
