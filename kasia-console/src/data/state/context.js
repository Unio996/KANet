import { sqlite } from '../../db/client.js';

// ── Prepared statements (lazy init) ────────────────────────────────────
// fresh-db-first-start (2026-09-13, J2): 原来是模块顶层立即 sqlite.prepare(...) ——
// ESM 静态 import 提升到 index.js 自己的 runMigrations() 调用之前执行, 全新空 DB(0 表)首启时
// `no such table: identities` 直接崩进程。改惰性 + 缓存(同 agent-health.js:48-49 既有形): 首次
// 真正被调用(getContextByAddress 执行时)才 prepare, 此时 runMigrations() 早已跑完。
let _stmts = null;
function stmts() {
  if (_stmts) return _stmts;
  _stmts = {
    lookup: sqlite.prepare(`
      SELECT
        i.display_name, i.metadata_json,
        i.trust_level, i.tags, i.notes,
        c.id AS conv_id, c.status AS conv_status
      FROM identities i
      LEFT JOIN conversations c
        ON c.remote_identity_id = i.id AND c.status = 'active'
      WHERE i.network = ? AND i.address = ?
      ORDER BY c.last_message_at DESC
      LIMIT 1
    `),
    // Interaction statistics: total messages, first/last interaction, conversation count
    stats: sqlite.prepare(`
      SELECT
        COUNT(*)                         AS message_count,
        MIN(m.created_at)                AS first_seen,
        MAX(m.created_at)                AS last_seen,
        COUNT(DISTINCT m.conversation_id) AS conversation_count
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.remote_identity_id = (
        SELECT id FROM identities WHERE network = ? AND address = ? LIMIT 1
      )
    `),
    history: sqlite.prepare(`
      SELECT role, text, at FROM (
        SELECT 'user'      AS role, content_text AS text, created_at AS at
        FROM messages
        WHERE conversation_id = ? AND direction = 'inbound' AND content_text != ''
        UNION ALL
        SELECT 'assistant' AS role, reply_text   AS text, created_at AS at
        FROM replies
        WHERE conversation_id = ? AND reply_text != '' AND status != 'error'
        ORDER BY at DESC
        LIMIT ?
      )
      ORDER BY at ASC
    `),
  };
  return _stmts;
}

export function getContextByAddress(address, network = 'mainnet', limit = 10) {
  const row = stmts().lookup.get(network, address);
  if (!row) return null;

  const identity = {
    displayName: row.display_name || null,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    trustLevel: row.trust_level || 'normal',
    tags: row.tags || null,
    notes: row.notes || null,
  };

  // Interaction statistics
  const statsRow = stmts().stats.get(network, address);
  const stats = statsRow?.message_count ? {
    messageCount: statsRow.message_count,
    firstSeen: statsRow.first_seen,
    lastSeen: statsRow.last_seen,
    conversationCount: statsRow.conversation_count,
  } : null;

  if (!row.conv_id) return { identity, stats, conv: null, history: [] };

  const history = stmts().history.all(row.conv_id, row.conv_id, limit);
  return {
    identity,
    stats,
    conv: { id: row.conv_id, status: row.conv_status },
    history,
  };
}
