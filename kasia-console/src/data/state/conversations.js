import { sqlite } from '../../db/client.js';
import { nowIso } from '../../lib/time.js';
import { randomUUID } from 'crypto';

export async function upsertConversation({ network, localIdentityId, remoteIdentityId = null, channelType = 'dm', channelId = null, title = '', traceId = null }) {
  const now = nowIso();

  const existing = sqlite.prepare(`
    SELECT id FROM conversations
    WHERE network=? AND local_identity_id=? AND (remote_identity_id=? OR (remote_identity_id IS NULL AND ? IS NULL))
    AND channel_type=? AND (channel_id=? OR (channel_id IS NULL AND ? IS NULL))
  `).get(network, localIdentityId, remoteIdentityId, remoteIdentityId, channelType, channelId, channelId);

  if (existing) {
    sqlite.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(now, existing.id);
    return existing.id;
  }

  const id = randomUUID();
  sqlite.prepare(`INSERT INTO conversations (id,trace_id,network,channel_type,channel_id,local_identity_id,remote_identity_id,title,status,unread_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, traceId, network, channelType, channelId, localIdentityId, remoteIdentityId, title, 'active', 0, now, now);
  return id;
}

export async function getConversation(id) {
  return sqlite.prepare(`
    SELECT c.*,
      li.address as local_address, li.display_name as local_name,
      ri.address as remote_address, ri.display_name as remote_name
    FROM conversations c
    LEFT JOIN identities li ON c.local_identity_id = li.id
    LEFT JOIN identities ri ON c.remote_identity_id = ri.id
    WHERE c.id=?
  `).get(id);
}

export async function listConversations({ limit = 50, offset = 0, search = '', localAddress = null } = {}) {
  const searchParam = search ? `%${search}%` : null;
  const conditions = [];
  const params = [];

  if (searchParam) {
    conditions.push('(ri.address LIKE ? OR ri.display_name LIKE ? OR c.title LIKE ?)');
    params.push(searchParam, searchParam, searchParam);
  }
  if (localAddress) {
    conditions.push('li.address = ?');
    params.push(localAddress);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(limit, offset);

  return sqlite.prepare(`
    SELECT c.*,
      li.address as local_address, ri.address as remote_address, ri.display_name as remote_name,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) as message_count
    FROM conversations c
    LEFT JOIN identities li ON c.local_identity_id = li.id
    LEFT JOIN identities ri ON c.remote_identity_id = ri.id
    ${where}
    ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params);
}

export async function updateConversationTimestamps(id, { lastMessageAt, lastReplyAt, lastTxAt } = {}) {
  const now = nowIso();
  const updates = ['updated_at=?'];
  const values = [now];
  if (lastMessageAt) { updates.push('last_message_at=?'); values.push(lastMessageAt); }
  if (lastReplyAt) { updates.push('last_reply_at=?'); values.push(lastReplyAt); }
  if (lastTxAt) { updates.push('last_tx_at=?'); values.push(lastTxAt); }
  values.push(id);
  sqlite.prepare(`UPDATE conversations SET ${updates.join(',')} WHERE id=?`).run(...values);
}

export async function incrementUnread(id) {
  sqlite.prepare('UPDATE conversations SET unread_count=unread_count+1, updated_at=? WHERE id=?').run(nowIso(), id);
}

export async function getDashboardStats() {
  const total = sqlite.prepare('SELECT COUNT(*) as n FROM conversations').get();
  const active = sqlite.prepare("SELECT COUNT(*) as n FROM conversations WHERE status='active'").get();
  const todayMsgs = sqlite.prepare("SELECT COUNT(*) as n FROM messages WHERE created_at >= date('now')").get();
  const todayReplies = sqlite.prepare("SELECT COUNT(*) as n FROM replies WHERE created_at >= date('now')").get();
  const recentConvs = sqlite.prepare(`
    SELECT c.id, ri.address as remote_address, ri.display_name as remote_name,
      c.last_message_at, c.status
    FROM conversations c
    LEFT JOIN identities ri ON c.remote_identity_id = ri.id
    ORDER BY c.last_message_at DESC NULLS LAST LIMIT 5
  `).all();
  return { total: total.n, active: active.n, todayMsgs: todayMsgs.n, todayReplies: todayReplies.n, recentConvs };
}
