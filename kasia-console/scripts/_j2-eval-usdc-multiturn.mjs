// J2 #3 真 USDC multi-turn LLM probe 真验 broker side ready ship (NWT 24:36 阶段 1 J2 task)
// 真 invoke handleLlmDialog 真 USDC 'buy 1 USDC, BSC' → 'YES' → 真 publish offer real
// 缺 buyer 真转 USDT (J2 没 BSC USDT), 真完整 round-trip 留 Owner / Sophie / 真 fund 一个 buyer

import { handleLlmDialog } from '../src/services/broker-llm-agent.js';
import Db from 'better-sqlite3';
import { sqlite } from '../src/db/client.js';

const FRESH_PEER = 'kaspa:qpevalusdc' + Math.random().toString(36).slice(2, 10) + '_'.padEnd(40, 'x').slice(0, 40);

console.log('=== J2 #3 真 USDC multi-turn LLM probe (NWT 24:36 阶段 1 J2 task) ===');
console.log(`fresh peer: ${FRESH_PEER.slice(-30)}`);
console.log(`真 simulate user multi-turn DM by 手动 INSERT messages between turns (绕 cross-machine ingest delay)\n`);

// Helper: 真 INSERT messages table 让 _loadHistory 真 returns history per turn
function insertMsg(direction, peerAddr, content, brokerAddr) {
  const peerIdent = sqlite.prepare(`SELECT id FROM identities WHERE address=?`).get(peerAddr);
  const brokerIdent = sqlite.prepare(`SELECT id FROM identities WHERE address=?`).get(brokerAddr);
  if (!peerIdent || !brokerIdent) {
    // create fresh peer identity if missing
    if (!peerIdent) sqlite.prepare(`INSERT INTO identities (id, address, network, display_name, created_at, updated_at) VALUES (?, ?, 'kaspa', 'usdc-test-peer', datetime('now'), datetime('now'))`).run(crypto.randomUUID(), peerAddr);
    return null;
  }
  const senderId = direction === 'inbound' ? peerIdent.id : brokerIdent.id;
  const receiverId = direction === 'inbound' ? brokerIdent.id : peerIdent.id;
  sqlite.prepare(`INSERT INTO messages (id, conversation_id, source_message_id, source_txid, direction, sender_identity_id, receiver_identity_id, message_type, content_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'text', ?, datetime('now'))`).run(
    crypto.randomUUID(), `${peerAddr}__broker`, crypto.randomUUID(), 'sim_' + Math.random().toString(36).slice(2,10), direction, senderId, receiverId, content
  );
}

const BROKER_KASPA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const crypto = await import('crypto');

const turns = [
  { msg: '想买 1 USDC, BSC', desc: 'turn 1: USDC + chain' },
  { msg: 'YES', desc: 'turn 2: 确认 (期望 LLM 真调 finalize_order)' },
];

let totalLatency = 0;
for (const [i, t] of turns.entries()) {
  console.log(`--- ${t.desc} ---`);
  console.log(`  user DM: "${t.msg}"`);

  // 真 INSERT user DM into messages (simulate 真 production ingest)
  insertMsg('inbound', FRESH_PEER, t.msg, BROKER_KASPA);

  const start = Date.now();
  const reply = await handleLlmDialog(FRESH_PEER, t.msg);
  const ms = Date.now() - start;
  totalLatency += ms;

  console.log(`  broker reply (${ms}ms): "${(reply || '').slice(0, 280).replace(/\s+/g, ' ')}"`);

  // 真 INSERT broker reply into messages (simulate ack)
  if (reply) insertMsg('outbound', FRESH_PEER, reply, BROKER_KASPA);

  // Query DB after each turn for new offers
  const recent = sqlite.prepare(`SELECT id, give_asset, give_amount, want_asset, want_amount, protocol_status, broadcast_at FROM exchange_offers WHERE maker LIKE 'kaspa:qrxw%' AND broadcast_at > datetime('now','-3 minutes') ORDER BY broadcast_at DESC LIMIT 1`).get();
  if (recent && recent.give_asset === 'USDC') {
    console.log(`  ✓ DB: USDC offer 真 publish ${recent.id.slice(0,8)} ${recent.give_amount} USDC → ${recent.want_amount} USDT status=${recent.protocol_status}`);
  } else if (recent) {
    console.log(`  DB: latest offer ${recent.id.slice(0,8)} ${recent.give_asset} (期望 USDC, 真 publish 等 turn 2 YES)`);
  }
  console.log('');
}

console.log(`=== 真 result ===`);
console.log(`  total LLM latency: ${totalLatency}ms (~${(totalLatency/1000).toFixed(1)}s)`);

const usdcOffers = sqlite.prepare(`SELECT id, give_asset, give_amount, want_asset, want_amount, protocol_status FROM exchange_offers WHERE maker LIKE 'kaspa:qrxw%' AND give_asset='USDC' AND broadcast_at > datetime('now','-3 minutes')`).all();
console.log(`  USDC offers post test: ${usdcOffers.length}`);
for (const o of usdcOffers) console.log(`    ${o.id.slice(0,8)} ${o.give_amount} USDC → ${o.want_amount} ${o.want_asset} status=${o.protocol_status}`);

// Cleanup
console.log(`\n--- cleanup: cancel test USDC offers ---`);
for (const o of usdcOffers) {
  sqlite.prepare(`UPDATE exchange_offers SET protocol_status='cancelled', updated_at=datetime('now') WHERE id=?`).run(o.id);
  console.log(`  ✓ cancelled ${o.id.slice(0,8)}`);
}
sqlite.prepare(`DELETE FROM messages WHERE source_txid LIKE 'sim_%'`).run();
sqlite.prepare(`DELETE FROM identities WHERE display_name='usdc-test-peer'`).run();
console.log('  ✓ test messages + peer identity 真 clean');
