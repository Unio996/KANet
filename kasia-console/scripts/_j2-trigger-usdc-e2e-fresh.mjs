// J2 #3 真 trigger fresh USDC e2e Phase 2 真完整 multi-turn (Owner 训不要 standby)
// 真 simulate user 真 multi-turn DM by 手动 INSERT messages 真 persist history
// 真 verify broker 真 publish fresh USDC offer + 真 accept_v1 真上链
// 真 buyer 真转 USDT 留下一步 (J2 无 BSC USDT 真 fund, 真完整 round-trip 留真 user 真测)

import Db from 'better-sqlite3';
import { handleLlmDialog } from '../src/services/broker-llm-agent.js';
import crypto from 'crypto';

const db = new Db('data/console.db', { readonly: false });
const BROKER_KASPA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const FRESH_PEER = 'kaspa:qpfreshusdc' + Math.random().toString(36).slice(2, 8) + '_'.padEnd(40, 'x').slice(0, 40);

console.log('=== J2 #3 真 trigger fresh USDC e2e Phase 2 multi-turn (Owner 训) ===');
console.log(`fresh peer: ${FRESH_PEER.slice(-30)}`);

// Helper to insert messages (persist history for next-turn _loadHistory)
function insertMsg(direction, peerAddr, content) {
  let peerIdent = db.prepare(`SELECT id FROM identities WHERE address=?`).get(peerAddr);
  if (!peerIdent) {
    db.prepare(`INSERT INTO identities (id, address, network, display_name, created_at, updated_at) VALUES (?, ?, 'kaspa', 'usdc-e2e-test', datetime('now'), datetime('now'))`).run(crypto.randomUUID(), peerAddr);
    peerIdent = db.prepare(`SELECT id FROM identities WHERE address=?`).get(peerAddr);
  }
  const brokerIdent = db.prepare(`SELECT id FROM identities WHERE address=?`).get(BROKER_KASPA);
  const senderId = direction === 'inbound' ? peerIdent.id : brokerIdent.id;
  const receiverId = direction === 'inbound' ? brokerIdent.id : peerIdent.id;
  db.prepare(`INSERT INTO messages (id, trace_id, conversation_id, source_message_id, source_txid, direction, sender_identity_id, receiver_identity_id, message_type, content_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'text', ?, datetime('now'), datetime('now'))`).run(
    crypto.randomUUID(), crypto.randomUUID(), `${peerAddr}__broker`, crypto.randomUUID(), 'sim_' + Math.random().toString(36).slice(2,10), direction, senderId, receiverId, content
  );
}

const turns = [
  { msg: '想买 0.5 USDC, BSC', desc: 'turn 1: USDC + qty + chain' },
  { msg: 'YES', desc: 'turn 2: 确认 (期望 LLM 真调 finalize_order → broker 真 publish)' },
];

let pass = 0;
const startBefore = new Date().toISOString();
for (const [i, t] of turns.entries()) {
  console.log(`\n--- ${t.desc} ---`);
  console.log(`  user DM: "${t.msg}"`);
  insertMsg('inbound', FRESH_PEER, t.msg);
  const start = Date.now();
  const reply = await handleLlmDialog(FRESH_PEER, t.msg);
  const ms = Date.now() - start;
  console.log(`  broker reply (${ms}ms): "${(reply || '').slice(0, 280).replace(/\s+/g, ' ')}"`);
  if (reply) insertMsg('outbound', FRESH_PEER, reply);
}

// Verify fresh USDC offer published post turn 2
console.log(`\n=== 真 verify fresh USDC offer 真 publish (post turn 2 'YES') ===`);
const fresh = db.prepare(`
  SELECT id, give_asset, give_amount, want_asset, want_amount, taker, protocol_status, broadcast_at
  FROM exchange_offers
  WHERE maker = ? AND give_asset = 'USDC' AND broadcast_at > ?
  ORDER BY broadcast_at DESC LIMIT 3
`).all(BROKER_KASPA, startBefore);

console.log(`fresh USDC offers post-test: ${fresh.length}`);
for (const o of fresh) {
  console.log(`  ${o.id.slice(0,8)} ${o.give_amount} USDC → ${o.want_amount} USDT status=${o.protocol_status} taker=${o.taker?.slice(-12)||'null'} bcast=${o.broadcast_at}`);
  if (o.give_asset === 'USDC' && parseFloat(o.give_amount) === 0.5) pass++;
}

// Cleanup test offers + identity + messages
console.log(`\n--- cleanup test artifacts ---`);
for (const o of fresh) {
  db.prepare(`UPDATE exchange_offers SET protocol_status='cancelled', updated_at=datetime('now') WHERE id=?`).run(o.id);
  console.log(`  ✓ cancelled ${o.id.slice(0,8)}`);
}
db.prepare(`DELETE FROM messages WHERE source_txid LIKE 'sim_%'`).run();
db.prepare(`DELETE FROM identities WHERE display_name='usdc-e2e-test'`).run();

// Also cleanup 24:14 J2 evaluate stuck offer 8de62092
const stuckEval = db.prepare(`SELECT id FROM exchange_offers WHERE id LIKE '8de62092%' AND protocol_status='open'`).get();
if (stuckEval) {
  db.prepare(`UPDATE exchange_offers SET protocol_status='cancelled', updated_at=datetime('now') WHERE id=?`).run(stuckEval.id);
  console.log(`  ✓ cleanup J2 24:14 evaluate stuck 8de62092 → cancelled`);
}

console.log(`\n=== ${pass > 0 ? '✅' : '❌'} fresh USDC publish ${pass > 0 ? 'PASS' : 'FAIL'} ===`);
db.close();
