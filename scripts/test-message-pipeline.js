#!/usr/bin/env node
/**
 * 消息链路测试 — 验证 Agent 发出的消息正确入库
 * 运行: cd D:/Anthropic/kasia-console && NODE_PATH=./node_modules node ../scripts/test-message-pipeline.js
 */
const Database = require('better-sqlite3');
const db = new Database('data/console.db');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}: ${detail || 'FAILED'}`); fail++; }
}

const agents = db.prepare('SELECT name, address FROM relay_nodes WHERE address IS NOT NULL').all();

console.log('=== 测试 1: replies vs messages outbound 数量对比 ===');
for (const a of agents) {
  const replies = db.prepare(`
    SELECT COUNT(*) as c FROM replies r
    JOIN conversations c ON c.id = r.conversation_id
    JOIN identities li ON li.id = c.local_identity_id
    WHERE li.address = ?
  `).get(a.address);
  const msgsOut = db.prepare(`
    SELECT COUNT(*) as c FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    JOIN identities li ON li.id = c.local_identity_id
    WHERE li.address = ? AND m.direction = 'outbound' AND m.message_type = 'text'
  `).get(a.address);
  const ratio = replies.c > 0 ? (msgsOut.c / replies.c * 100).toFixed(1) : '0';
  console.log(`  ${a.name}: replies=${replies.c} msgs_out_text=${msgsOut.c} (${ratio}%)`);
}

console.log('\n=== 测试 2: send-command API 返回结果 ===');
const http = require('http');
const checkApi = () => new Promise((resolve) => {
  const req = http.request({ hostname: '127.0.0.1', port: 3100, path: '/api/relay/nonexistent/send-command', method: 'POST',
    headers: { 'Content-Type': 'application/json' } }, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.write(JSON.stringify({ type: 'send_message', target: 'test', message: 'test' }));
  req.end();
});
checkApi().then(r => {
  check('send-command API 返回错误而非盲目 ok:true', r.status === 503 || r.body.includes('error'), `status=${r.status} body=${r.body.slice(0,60)}`);

  console.log('\n=== 测试 3: ingestMessage traceId 前缀 ===');
  const replyOutMsgs = db.prepare("SELECT COUNT(*) as c FROM messages WHERE trace_id LIKE 'reply-out:%'").get().c;
  const msgOutMsgs = db.prepare("SELECT COUNT(*) as c FROM messages WHERE trace_id LIKE 'msg-out:%'").get().c;
  console.log(`  reply-out: ${replyOutMsgs} 条, msg-out: ${msgOutMsgs} 条`);
  console.log(`  (修复后新消息才会有这些前缀)`);

  console.log('\n=== 测试 4: chain_events comm_sent 记录 ===');
  const commSent = db.prepare("SELECT COUNT(*) as c FROM chain_events WHERE event_type = 'comm_sent'").get().c;
  console.log(`  comm_sent 记录: ${commSent} 条`);

  console.log('\n=== 测试 5: replies.sent_txid 有值比例 ===');
  const total = db.prepare('SELECT COUNT(*) as c FROM replies').get().c;
  const withTx = db.prepare('SELECT COUNT(*) as c FROM replies WHERE sent_txid IS NOT NULL').get().c;
  console.log(`  total=${total} with_txid=${withTx} (${(withTx/total*100).toFixed(1)}%)`);

  console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
  process.exit(fail > 0 ? 1 : 0);
}).catch(e => { console.error('API test failed:', e.message); process.exit(1); });
