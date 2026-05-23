// Verify Bug-Z6: SELL request with chain+addr should NOT trigger Bug-W det-preview
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const TRADER_B_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const TRADER_B_ADDR = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const FRESH = 'kaspa:qz6fix' + Math.random().toString(36).slice(2, 50);

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

// Inject STALE BUY history (simulate Eric's prior 1 USDC BUY)
const insertMsg = db.prepare(`
  INSERT INTO messages (id, trace_id, direction, sender_identity_id, receiver_identity_id, message_type, content_text, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, 'text', ?, ?, ?)
`);
const t1 = new Date(Date.now() - 60000).toISOString();
const t2 = new Date(Date.now() - 55000).toISOString();
insertMsg.run(randomUUID(), randomUUID(), 'inbound', peerIdent, brokerIdent, '想买 1 USDC, BSC', t1, t1);
insertMsg.run(randomUUID(), randomUUID(), 'outbound', brokerIdent, peerIdent, '好的, 买 1 USDC. 用哪个链 付 USDT?', t2, t2);
db.close();
console.log('Stale BUY history injected');

// Now probe with Eric's exact SELL bug case
console.log('\n[probe] Eric SELL: "卖 5 KAS, BSC, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74"');
const t = Date.now();
const r = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: FRESH, message: '卖 5 KAS, BSC, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74' }),
});
const d = await r.json();
console.log(`  ${Date.now()-t}ms reply:`, (d.reply || '<empty>').slice(0, 300));
console.log('  >>> Should NOT show "买 USDC" preview (Bug-Z6 fixed = Bug-W skips SELL keywords)');
