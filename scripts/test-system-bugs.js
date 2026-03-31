#!/usr/bin/env node
/**
 * 系统 Bug 修复验证脚本
 *
 * 验证三个修复：
 *   Bug 1: replies.sent_txid 不再全是 NULL
 *   Bug 2: chain_events 有 comm_sent（Agent 外发记录）
 *   Bug 3: chain_events 去重计数（unique_total vs raw total）
 *
 * 运行: cd D:/Anthropic/kasia-console && node ../scripts/test-system-bugs.js
 */
const Database = require('better-sqlite3');
const db = new Database('data/console.db');

let pass = 0, fail = 0;
function check(name, condition, detail) {
  if (condition) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ FAIL: ' + name + (detail ? ' — ' + detail : '')); fail++; }
}

console.log('=== Bug 1: replies.sent_txid 回填 ===');
const totalReplies = db.prepare('SELECT COUNT(*) as c FROM replies').get().c;
const withTxid = db.prepare('SELECT COUNT(*) as c FROM replies WHERE sent_txid IS NOT NULL').get().c;
const recentWithTxid = db.prepare(
  "SELECT COUNT(*) as c FROM replies WHERE sent_txid IS NOT NULL AND created_at > datetime('now', '-48 hours')"
).get().c;
check('replies 表有 sent_txid 记录', withTxid > 0, `total=${totalReplies} with_txid=${withTxid}`);
console.log(`  总 replies: ${totalReplies}, 有 txid: ${withTxid} (${(withTxid/totalReplies*100).toFixed(1)}%), 近48h: ${recentWithTxid}`);

console.log('\n=== Bug 2: Agent 外发 chain_events ===');
const commSent = db.prepare("SELECT COUNT(*) as c FROM chain_events WHERE event_type = 'comm_sent'").get().c;
check('chain_events 有 comm_sent 记录', commSent > 0, `count=${commSent}`);
console.log(`  comm_sent 记录: ${commSent}`);

// 分 Agent 查
const agents = db.prepare('SELECT name, address FROM relay_nodes WHERE address IS NOT NULL').all();
for (const a of agents) {
  const cnt = db.prepare("SELECT COUNT(*) as c FROM chain_events WHERE event_type = 'comm_sent' AND from_address = ?").get(a.address).c;
  console.log(`  ${a.name}: ${cnt} 条外发记录`);
}

console.log('\n=== Bug 3: chain_events 去重 ===');
for (const a of agents) {
  const raw = db.prepare('SELECT COUNT(*) as c FROM chain_events WHERE from_address = ? OR to_address = ?').get(a.address, a.address).c;
  const unique = db.prepare('SELECT COUNT(DISTINCT txid) as c FROM chain_events WHERE from_address = ? OR to_address = ?').get(a.address, a.address).c;
  const dupeRate = raw > 0 ? ((1 - unique / raw) * 100).toFixed(1) : '0';
  console.log(`  ${a.name}: raw=${raw} unique=${unique} 重复率=${dupeRate}%`);
}

console.log('\n=== Bug 4: messages outbound 完整性 ===');
for (const a of agents) {
  const replies = db.prepare(`
    SELECT COUNT(*) as c FROM replies r
    JOIN conversations c ON c.id = r.conversation_id
    JOIN identities li ON li.id = c.local_identity_id
    WHERE li.address = ?
  `).get(a.address).c;
  const msgsOut = db.prepare(`
    SELECT COUNT(*) as c FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    JOIN identities li ON li.id = c.local_identity_id
    WHERE li.address = ? AND m.direction = 'outbound'
  `).get(a.address).c;
  console.log(`  ${a.name}: replies=${replies} outbound_msgs=${msgsOut}`);
}

// 新消息管道验证（修复后新数据）
console.log('\n=== Bug 5: 新消息管道（修复后数据）===');
const replyOut = db.prepare("SELECT COUNT(*) as c FROM messages WHERE trace_id LIKE 'reply-out:%'").get().c;
const msgOut = db.prepare("SELECT COUNT(*) as c FROM messages WHERE trace_id LIKE 'msg-out:%'").get().c;
console.log(`  reply-out: ${replyOut} 条 (DM 回复入库)`);
console.log(`  msg-out: ${msgOut} 条 (IPC 发消息入库)`);
check('新管道有数据流入', replyOut + msgOut > 0, `reply-out=${replyOut} msg-out=${msgOut}`);

// 外部对话双向内容
console.log('\n=== Bug 6: 外部对话双向内容 ===');
const agentAddrs = new Set(agents.map(a => a.address));
const externalPeers = db.prepare(`
  SELECT DISTINCT CASE WHEN from_address IN (${agents.map(()=>'?').join(',')}) THEN to_address ELSE from_address END as peer
  FROM chain_events
  WHERE (from_address IN (${agents.map(()=>'?').join(',')}) OR to_address IN (${agents.map(()=>'?').join(',')}))
`).all(...agents.map(a=>a.address), ...agents.map(a=>a.address), ...agents.map(a=>a.address))
  .filter(r => r.peer && !agentAddrs.has(r.peer));

let hasContent = 0, noContent = 0;
for (const { peer } of externalPeers) {
  const conv = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN identities li ON li.id = c.local_identity_id
    JOIN identities ri ON ri.id = c.remote_identity_id
    WHERE ri.address = ?
  `).get(peer);
  if (conv) {
    const reps = db.prepare('SELECT COUNT(*) as c FROM replies WHERE conversation_id = ? AND reply_text IS NOT NULL').get(conv.id).c;
    if (reps > 0) hasContent++; else noContent++;
  } else noContent++;
}
check('外部对话有 Agent 回复内容', hasContent > 0, `有内容: ${hasContent}, 无: ${noContent}`);
console.log(`  有回复: ${hasContent}, 无回复: ${noContent}, 总外部 peer: ${externalPeers.length}`);

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
db.close();
process.exit(fail > 0 ? 1 : 0);
