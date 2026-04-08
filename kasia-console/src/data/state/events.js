import { sqlite } from '../../db/client.js';
import { nowIso } from '../../lib/time.js';
import { randomUUID } from 'crypto';

export async function insertEvent({ traceId = null, eventScope = 'system', eventType, source, level = 'info', conversationId = null, messageId = null, replyId = null, txRecordId = null, summary, payloadJson = null, agentAddress = null }) {
  const now = nowIso();
  const id = randomUUID();
  sqlite.prepare(`INSERT INTO events (id,trace_id,event_scope,event_type,source,level,conversation_id,message_id,reply_id,tx_record_id,summary,payload_json,agent_address,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, traceId, eventScope, eventType, source, level, conversationId, messageId, replyId, txRecordId, summary, payloadJson ? JSON.stringify(payloadJson) : null, agentAddress, now);
  return id;
}

export async function listEvents({ limit = 100, offset = 0, level = null, source = null, eventScope = null, search = '' } = {}) {
  const conditions = [];
  const params = [];
  if (level) { conditions.push('level=?'); params.push(level); }
  if (source) { conditions.push('source=?'); params.push(source); }
  if (eventScope) { conditions.push('event_scope=?'); params.push(eventScope); }
  if (search) { conditions.push('(summary LIKE ? OR event_type LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(limit, offset);
  return sqlite.prepare(`SELECT * FROM events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params);
}

export async function getEventStats() {
  return {
    total: sqlite.prepare('SELECT COUNT(*) as n FROM events').get().n,
    errors: sqlite.prepare("SELECT COUNT(*) as n FROM events WHERE level='error'").get().n,
    warns: sqlite.prepare("SELECT COUNT(*) as n FROM events WHERE level='warn'").get().n,
    today: sqlite.prepare("SELECT COUNT(*) as n FROM events WHERE created_at >= date('now')").get().n,
  };
}
