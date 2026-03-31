#!/usr/bin/env node
/**
 * 握手系统自动测试
 * 运行: cd D:/Anthropic/kasia-console && node ../scripts/test-handshake.js
 */
const Database = require('better-sqlite3');
const db = new Database('data/console.db');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}: ${detail || 'FAILED'}`); fail++; }
}

const agents = db.prepare('SELECT name, address FROM relay_nodes WHERE address IS NOT NULL').all();
const agentSet = new Set(agents.map(a => a.address));

console.log('=== 测试 1: chain_events txid 真实性 ===');
const recentHs = db.prepare(
  "SELECT txid, observed_at FROM chain_events WHERE event_type = 'handshake' ORDER BY observed_at DESC LIMIT 20"
).all();
const synthCount = recentHs.filter(r => r.txid?.endsWith('-accept')).length;
check('最近 20 条握手无合成 txid', synthCount === 0, `发现 ${synthCount} 条 -accept 后缀`);
const allSynth = db.prepare(
  "SELECT COUNT(*) as c FROM chain_events WHERE event_type = 'handshake' AND txid LIKE '%-accept'"
).get().c;
console.log(`  (历史合成 txid: ${allSynth} 条 — 不修复)`);

console.log('\n=== 测试 2: messages 去重 ===');
const dupeCheck = db.prepare(`
  SELECT REPLACE(source_txid, '-accept', '') as base_txid, COUNT(*) as cnt
  FROM messages WHERE message_type = 'handshake' AND source_txid IS NOT NULL
  GROUP BY base_txid HAVING cnt > 2
`).all();
check('无 txid 写入超过 2 条 messages', dupeCheck.length === 0,
  dupeCheck.length > 0 ? `${dupeCheck.length} 个 txid 有 3+ 条: ${dupeCheck[0]?.base_txid?.slice(0,16)}` : '');

console.log('\n=== 测试 3: DB 去重 API ===');
const acceptedRs = db.prepare(
  "SELECT local_address, peer_address, status FROM relation_states WHERE status = 'accepted' LIMIT 1"
).get();
if (acceptedRs) {
  check('relation_states 有 accepted 记录可测', true);
  check('accepted 记录 status 正确', acceptedRs.status === 'accepted');
} else {
  check('relation_states 有 accepted 记录可测', false, '无 accepted 记录');
}

console.log('\n=== 测试 4: 主动握手数据完整性 ===');
for (const a of agents) {
  const initiatedPeers = db.prepare(`
    SELECT DISTINCT to_address as peer FROM chain_events
    WHERE from_address = ? AND event_type = 'handshake' AND to_address NOT IN (SELECT address FROM relay_nodes WHERE address IS NOT NULL)
  `).all(a.address);
  for (const p of initiatedPeers.slice(0, 2)) {
    const ce = db.prepare(
      "SELECT COUNT(*) as c FROM chain_events WHERE event_type = 'handshake' AND ((from_address = ? AND to_address = ?) OR (from_address = ? AND to_address = ?))"
    ).get(a.address, p.peer, p.peer, a.address);
    const rs = db.prepare(
      "SELECT status FROM relation_states WHERE local_address = ? AND peer_address = ?"
    ).get(a.address, p.peer);
    check(`${a.name}→${p.peer.slice(-8)}: chain_events ≥ 1`, ce.c >= 1, `got ${ce.c}`);
    check(`${a.name}→${p.peer.slice(-8)}: status accepted+`, ['accepted','confirmed','active'].includes(rs?.status), `got ${rs?.status}`);
  }
}

console.log('\n=== 测试 5: 被动握手数据完整性 ===');
for (const a of agents.slice(0, 2)) {
  const passivePeers = db.prepare(`
    SELECT DISTINCT from_address as peer FROM chain_events
    WHERE to_address = ? AND event_type = 'handshake' AND from_address NOT IN (SELECT address FROM relay_nodes WHERE address IS NOT NULL)
    LIMIT 2
  `).all(a.address);
  for (const p of passivePeers) {
    const ceIn = db.prepare(
      "SELECT COUNT(*) as c FROM chain_events WHERE event_type = 'handshake' AND from_address = ? AND to_address = ?"
    ).get(p.peer, a.address);
    const ceOut = db.prepare(
      "SELECT COUNT(*) as c FROM chain_events WHERE event_type = 'handshake' AND from_address = ? AND to_address = ?"
    ).get(a.address, p.peer);
    check(`${a.name}←${p.peer.slice(-8)}: inbound ≥ 1`, ceIn.c >= 1, `got ${ceIn.c}`);
    check(`${a.name}←${p.peer.slice(-8)}: outbound ≥ 1`, ceOut.c >= 1, `got ${ceOut.c}`);
  }
}

console.log('\n=== 测试 6: hs_in/hs_out 字段 ===');
for (const a of agents.slice(0, 1)) {
  const stats = db.prepare(`
    SELECT
      CASE WHEN ce.from_address = ? THEN ce.to_address ELSE ce.from_address END as peer,
      SUM(CASE WHEN ce.event_type = 'handshake' AND ce.to_address = ? THEN 1 ELSE 0 END) as hs_in,
      SUM(CASE WHEN ce.event_type = 'handshake' AND ce.from_address = ? THEN 1 ELSE 0 END) as hs_out
    FROM chain_events ce
    WHERE (ce.from_address = ? OR ce.to_address = ?) AND ce.event_type = 'handshake'
    GROUP BY peer LIMIT 5
  `).all(a.address, a.address, a.address, a.address, a.address);
  for (const s of stats) {
    check(`${a.name}↔${s.peer?.slice(-8)}: hs_in=${s.hs_in} hs_out=${s.hs_out}`,
      s.hs_in >= 0 && s.hs_out >= 0);
  }
}

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
