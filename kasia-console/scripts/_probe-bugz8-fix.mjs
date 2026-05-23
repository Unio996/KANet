// Bug-Z8 fix verify — multi-turn 模拟 J1 09:09-09:11 真 case
// 1. user '卖 5 KAS, BSC, 0x9405...' (含 EVM addr) → broker reply
// 2. user '好' (CONFIRM, no addr) → broker reply 应该不被 R19 拦
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const TRADER_B_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const TRADER_B_ADDR = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const FRESH = 'kaspa:qzbz8' + Math.random().toString(36).slice(2, 50);

const db = new Database('./data/console.db');
function getOrCreateIdent(addr) {
  let row = db.prepare('SELECT id FROM identities WHERE address = ?').get(addr);
  if (row) return row.id;
  const id = randomUUID();
  db.prepare("INSERT INTO identities (id, address, network, created_at, updated_at) VALUES (?, ?, 'mainnet', datetime('now'), datetime('now'))").run(id, addr);
  return id;
}
const peerIdent = getOrCreateIdent(FRESH);
const brokerIdent = getOrCreateIdent(TRADER_B_ADDR);

console.log(`Fresh peer: ${FRESH.slice(-12)}\n`);

// === Turn 1: user 给齐字段, broker preview ===
const msg1 = '卖 5 KAS, BSC, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74';
console.log(`[turn 1] user → broker: "${msg1}"`);
const t1 = Date.now();
const r1 = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: FRESH, message: msg1 }),
});
const d1 = await r1.json();
console.log(`  ${Date.now()-t1}ms reply head: "${(d1.reply || '').slice(0, 100)}..."`);
console.log(`  has preview: ${(d1.reply || '').includes('卖单画像') || (d1.reply || '').includes('订单画像')}`);

// 真 broker reply 真 manually 写 history table 让第二轮 _loadHistory 能看到
db.prepare(`
  INSERT INTO messages (id, trace_id, direction, sender_identity_id, receiver_identity_id, message_type, content_text, created_at, updated_at)
  VALUES (?, ?, 'inbound', ?, ?, 'text', ?, datetime('now', '-30 seconds'), datetime('now', '-30 seconds'))
`).run(randomUUID(), randomUUID(), peerIdent, brokerIdent, msg1);
db.prepare(`
  INSERT INTO messages (id, trace_id, direction, sender_identity_id, receiver_identity_id, message_type, content_text, created_at, updated_at)
  VALUES (?, ?, 'outbound', ?, ?, 'text', ?, datetime('now', '-25 seconds'), datetime('now', '-25 seconds'))
`).run(randomUUID(), randomUUID(), brokerIdent, peerIdent, d1.reply || '');

// === Turn 2: user '好' (confirm, no addr), broker 真 confirm DM 真 echo user 0x9405 → R19 应 pass ===
const msg2 = '好';
console.log(`\n[turn 2] user → broker: "${msg2}"`);
const t2 = Date.now();
const r2 = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: FRESH, message: msg2 }),
});
const d2 = await r2.json();
console.log(`  ${Date.now()-t2}ms`);
console.log(`  full reply: "${d2.reply || '<empty>'}"`);
console.log(`  R19 blocked? ${(d2.reply || '').includes('地址异常') || (d2.reply || '').includes('R19 拦截')}`);

db.close();
