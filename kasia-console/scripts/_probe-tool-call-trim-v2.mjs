// With injected history simulating broker prior reply, does Qwen call preview_order?
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const TRADER_B_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const TRADER_B_ADDR = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const FRESH = 'kaspa:qprobtrm' + Math.random().toString(36).slice(2, 50);

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

const insertMsg = db.prepare(`
  INSERT INTO messages (id, trace_id, direction, sender_identity_id, receiver_identity_id, message_type, content_text, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, 'text', ?, ?, ?)
`);
const t1 = new Date(Date.now() - 60000).toISOString();
const t2 = new Date(Date.now() - 55000).toISOString();
// Inject: user said "想买 2 KAS", broker asked for chain
insertMsg.run(randomUUID(), randomUUID(), 'inbound', peerIdent, brokerIdent, '想买 2 KAS', t1, t1);
insertMsg.run(randomUUID(), randomUUID(), 'outbound', brokerIdent, peerIdent, '好的, 买 2 KAS. 用哪个链 付 USDT? (BSC / Polygon / SOL / TRON)', t2, t2);
db.close();
console.log('History injected: user "想买 2 KAS" → broker asked chain');

console.log('\n[probe Turn 2] User: "BSC" (alone)');
let t = Date.now();
let r = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: FRESH, message: 'BSC' }),
});
let d = await r.json();
console.log(`  ${Date.now()-t}ms reply:`, (d.reply || '<empty>').slice(0, 400));
console.log('\n  Look for: 📋 订单画像 = tool was called');
console.log('  Vs: NLG asking for more info = tool NOT called');
