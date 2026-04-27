// NWT 接位 #2 — Layer 2 LLM verbatim 真测 (seed-history probe)
//
// 设计: 真插 identity + messages turn 1 (绕 chain DM 路径直接造 history),
// 然后 /api/agent/reply turn 2 'BSC' → broker LLM _loadHistory 真返 turn 1 →
// step 3 触 preview_order tool → preview_text → LLM 应**一字不改**转发.
//
// **侵入性**: 真写 identities + messages 行. 跑完 cleanup DELETE WHERE address LIKE seed marker.
// 不污染 Sophie/Eric/Martin 真 history.

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const DB_PATH = 'data/console.db';
const TRADER_B_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const SEED_MARKER = 'kaspa:qpr_nwt_seed_';
const PEER = SEED_MARKER + Date.now().toString(36) + 'xpqfaketestnwt9999';

const db = new Database(DB_PATH);

// 1. broker identity (TRADER_B)
const broker = db.prepare(`SELECT id, address FROM relay_nodes WHERE id=?`).get(TRADER_B_RELAY_ID);
if (!broker?.address) { console.error('broker not found'); process.exit(2); }
const brokerIdent = db.prepare(`SELECT id FROM identities WHERE address=?`).get(broker.address);
if (!brokerIdent?.id) { console.error('broker identity not found'); process.exit(2); }
console.log(`broker identity_id=${brokerIdent.id}`);

// 2. seed peer identity (insert if not exist)
const now = new Date().toISOString();
let peerIdent = db.prepare(`SELECT id FROM identities WHERE address=?`).get(PEER);
if (!peerIdent) {
  const peerId = randomUUID();
  db.prepare(`
    INSERT INTO identities (id, network, address, identity_type, created_at, updated_at, is_blocked, trust_level, discovery_status, interaction_count, probe_attempt_count, successful_contact_count, confidence_score, card_has_ext)
    VALUES (?, 'kaspa-mainnet', ?, 'kasia_user', ?, ?, 0, 'unknown', 'discovered', 0, 0, 0, 0.5, 0)
  `).run(peerId, PEER, now, now);
  peerIdent = { id: peerId };
}
console.log(`peer identity_id=${peerIdent.id} addr=${PEER}`);

// 3. seed turn 1 — user → broker '想买 5 KAS'
const m1 = randomUUID();
db.prepare(`
  INSERT INTO messages (id, trace_id, direction, message_type, content_text, sender_identity_id, receiver_identity_id, created_at, updated_at)
  VALUES (?, ?, 'inbound', 'text', ?, ?, ?, ?, ?)
`).run(m1, 'seed-' + m1.slice(0, 8), '想买 5 KAS', peerIdent.id, brokerIdent.id, now, now);

// 4. seed turn 1 broker reply
const m2 = randomUUID();
const t1Reply = '好的, 买 5 KAS. 用哪个链 付 USDT? (BSC / Polygon / SOL / TRON)';
db.prepare(`
  INSERT INTO messages (id, trace_id, direction, message_type, content_text, sender_identity_id, receiver_identity_id, created_at, updated_at)
  VALUES (?, ?, 'outbound', 'text', ?, ?, ?, ?, ?)
`).run(m2, 'seed-' + m2.slice(0, 8), t1Reply, brokerIdent.id, peerIdent.id, now, now);

console.log(`seeded 2 msgs: m1=${m1.slice(0,8)} m2=${m2.slice(0,8)}`);

// 5. probe turn 2: 'BSC' — broker LLM should _loadHistory turn 1 → preview_order → verbatim
console.log('\n── turn 2 probe: peer says BSC ──');
const t0 = Date.now();
const res = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ relayNodeId: TRADER_B_RELAY_ID, peer: PEER, message: 'BSC' }),
});
const dt = Date.now() - t0;
const data = await res.json().catch(() => ({}));
const reply = data.reply ?? data.error ?? '';
console.log(`(${dt}ms) reply length=${reply.length}`);
console.log('---');
console.log(reply);
console.log('---\n');

// 6. assert critfix
const REAL_BROKER_BSC = '0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe';
const FAKE_PLACEHOLDER_RE = /0x1234[0-9a-fA-F]{0,4}/;
const c1 = reply.includes(REAL_BROKER_BSC);
const c2 = !FAKE_PLACEHOLDER_RE.test(reply);
const c3 = reply.includes(PEER);
const c4 = reply.includes('📋');
const c5 = /订单画像/.test(reply);

console.log('=== L2 LLM verbatim 验证 ===');
console.log(`[${c1 ? '✓' : '✗'}] reply 含真 broker BSC 0xaD12544E... (LLM 没缩写没编)`);
console.log(`[${c2 ? '✓' : '✗'}] reply NOT contains fake 0x1234* placeholder`);
console.log(`[${c3 ? '✓' : '✗'}] reply 含真 peer kasia (LLM 没换 placeholder)`);
console.log(`[${c4 ? '✓' : '✗'}] reply 含 📋 anchor (LLM 没 strip emoji)`);
console.log(`[${c5 ? '✓' : '✗'}] reply 含 '订单画像' (LLM 没改标题)`);

const allPass = c1 && c2 && c3 && c4 && c5;

// 7. cleanup — DELETE seed rows + identity (不污染 DB)
db.prepare(`DELETE FROM messages WHERE sender_identity_id=? OR receiver_identity_id=?`).run(peerIdent.id, peerIdent.id);
db.prepare(`DELETE FROM identities WHERE id=?`).run(peerIdent.id);
console.log(`\ncleanup: removed peer identity ${peerIdent.id} + its messages`);

console.log(`\n=== ${allPass ? '🎉 L2 LLM VERBATIM 真测 PASS — critfix 4-layer 全闭环' : '🚨 L2 LLM verbatim 真测 FAIL — escalate'} ===`);
process.exit(allPass ? 0 : 1);
