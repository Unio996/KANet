// J1 真 LIVE 09:07 真 case 重现 — 看 broker 真 reply 跟 J1 trace 一致吗
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const TRADER_B_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const TRADER_B_ADDR = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const FRESH = 'kaspa:qzj1case' + Math.random().toString(36).slice(2, 50);

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
db.close();

console.log(`Fresh peer (no history): ${FRESH.slice(-12)}`);
const ericMsg = '我要卖 2 KAS, BSC 链收 USDT, 地址 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74';
console.log(`\n[probe J1-case] "${ericMsg}"`);
const t = Date.now();
const r = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer: FRESH, message: ericMsg }),
});
const d = await r.json();
console.log(`\n  ${Date.now()-t}ms`);
console.log(`  full reply: "${d.reply || '<empty>'}"`);
console.log(`  skip_reason: ${d.skip_reason || 'none'}`);
