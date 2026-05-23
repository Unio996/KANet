// Verify Bug-Z5 fix: current msg asset/qty trumps stale history
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const TRADER_B_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const TRADER_B_ADDR = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const FRESH_PEER = 'kaspa:qz5fix' + Math.random().toString(36).slice(2, 50);

const db = new Database('./data/console.db');
function getOrCreateIdent(addr) {
  let row = db.prepare('SELECT id FROM identities WHERE address = ?').get(addr);
  if (row) return row.id;
  const id = randomUUID();
  db.prepare("INSERT INTO identities (id, address, network, created_at, updated_at) VALUES (?, ?, 'mainnet', datetime('now'), datetime('now'))").run(id, addr);
  return id;
}
const peerIdent = getOrCreateIdent(FRESH_PEER);
const brokerIdent = getOrCreateIdent(TRADER_B_ADDR);

// Inject STALE broker history mentioning "买 1 KAS, BSC" (simulates Eric's prior PASS)
const insertMsg = db.prepare(`
  INSERT INTO messages (id, trace_id, direction, sender_identity_id, receiver_identity_id, message_type, content_text, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, 'text', ?, ?, ?)
`);
const t1 = new Date(Date.now() - 60000).toISOString();
const t2 = new Date(Date.now() - 55000).toISOString();
insertMsg.run(randomUUID(), randomUUID(), 'inbound', peerIdent, brokerIdent, '买 1 KAS', t1, t1);
insertMsg.run(randomUUID(), randomUUID(), 'outbound', brokerIdent, peerIdent, '好的, 买 1 KAS. 用哪个链 付 USDT? (BSC / Polygon / SOL / TRON)', t2, t2);
db.close();
console.log('Injected STALE history: peer prev "买 1 KAS"');

// Now probe with USDC request (should NOT pick up stale KAS asset)
console.log('\n[probe] simulate user "想买 0.5 USDC, BSC, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74" (Eric exact bug case)');
const t = Date.now();
const r = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: FRESH_PEER, message: '想买 0.5 USDC, BSC, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74' }),
});
const d = await r.json();
console.log(`  ${Date.now()-t}ms reply:`, (d.reply || '<empty>').slice(0, 200));
