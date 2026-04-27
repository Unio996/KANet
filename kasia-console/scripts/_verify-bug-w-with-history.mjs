// Inject fake history to simulate broker prior reply, then test det-preview
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const TRADER_B_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const TRADER_B_ADDR = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const FRESH_PEER = 'kaspa:qbugwh' + Math.random().toString(36).slice(2, 50);

const db = new Database('./data/console.db');
// Get/create identities
function getOrCreateIdent(addr) {
  let row = db.prepare('SELECT id FROM identities WHERE address = ?').get(addr);
  if (row) return row.id;
  const id = randomUUID();
  db.prepare("INSERT INTO identities (id, address, network, created_at, updated_at) VALUES (?, ?, 'mainnet', datetime('now'), datetime('now'))").run(id, addr);
  return id;
}
const peerIdent = getOrCreateIdent(FRESH_PEER);
const brokerIdent = getOrCreateIdent(TRADER_B_ADDR);

// Insert simulated history:
// 1. Peer says "想买 2 KAS, BSC"
// 2. Broker replied "好的, 买 2 KAS. 用哪个链 付 USDT? (BSC / Polygon / SOL / TRON)"
const insertMsg = db.prepare(`
  INSERT INTO messages (id, trace_id, direction, sender_identity_id, receiver_identity_id, message_type, content_text, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, 'text', ?, ?, ?)
`);
const now = Date.now();
const t1Iso = new Date(now - 30000).toISOString();
const t2Iso = new Date(now - 25000).toISOString();
insertMsg.run(randomUUID(), randomUUID(), 'inbound', peerIdent, brokerIdent, '想买 2 KAS, BSC', t1Iso, t1Iso);
insertMsg.run(randomUUID(), randomUUID(), 'outbound', brokerIdent, peerIdent, '好的, 买 2 KAS. 用哪个链 付 USDT? (BSC / Polygon / SOL / TRON)', t2Iso, t2Iso);
console.log('Injected fake history for', FRESH_PEER.slice(-12));
db.close();

// Now probe with field-followup msg
console.log('\n[probe] simulate user T2 "USDT, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74"');
const t = Date.now();
const r = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: FRESH_PEER, message: 'USDT, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74' }),
});
const d = await r.json();
console.log(`  ${Date.now()-t}ms reply:`, (d.reply || '<empty>').slice(0, 400));
const hasPreview = /📋|订单画像|订单详情|sold/.test(d.reply || '');
console.log(`  >>> det-preview hit: ${hasPreview ? '✓ YES' : '✗ NO'}`);

// Also check pendingPreview by simulating YES
await new Promise(r => setTimeout(r, 1500));
console.log('\n[probe] now simulate "YES" — should hit _pendingPreview shortcut');
const t2 = Date.now();
const r2 = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: FRESH_PEER, message: 'YES' }),
});
const d2 = await r2.json();
console.log(`  ${Date.now()-t2}ms reply:`, (d2.reply || '<empty>').slice(0, 200));
