// NWT 接位 #2 — verify J2 a47789c29 R19-EXT fix
//
// 三层验证:
//   L1 unit: assertReplyAddressInvariant 单调 — 真假地址都判对
//   L2 wiring: /api/agent/reply 真路径 happy path 未退化 (R19-EXT 不误伤真 reply)
//   L3 reverse-injection: 构造确定 fake reply 看 R19-EXT 真拦 (sanity check)

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { assertReplyAddressInvariant } from '../src/services/broker-action-queue.js';

const DB_PATH = 'data/console.db';
const TRADER_B_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const REAL_BROKER_BSC = '0xaD12544E7020e16D1279c65Cc5810c8D8a3efcEe';
const FAKE_ADDR_J1 = '0x1234567890abcdef1234567890abcdef12345678';

let pass = 0, fail = 0;
const t = (name, ok, info) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}  ${info || ''}`); }
};

console.log('=== L1 unit: assertReplyAddressInvariant ===\n');

// fake address 应判 violated
const v1 = assertReplyAddressInvariant(`broker reply 测 ${FAKE_ADDR_J1} pretend fake`);
t('L1.1 fake J1-style 0x1234... 判 violated', !!v1 && v1.foreign_address?.toLowerCase().startsWith('0x123456'), JSON.stringify(v1));

// real broker 地址应 PASS
const v2 = assertReplyAddressInvariant(`broker reply 真 ${REAL_BROKER_BSC} 自己`);
t('L1.2 real broker 0xaD12544E... 判 OK (无 violated)', v2 === null, JSON.stringify(v2));

// 无地址 reply 应 PASS
const v3 = assertReplyAddressInvariant('好的, 你想买 KAS 还是卖?');
t('L1.3 无地址 reply 无 false positive', v3 === null, JSON.stringify(v3));

// 多地址里有 fake 也判 violated
const v4 = assertReplyAddressInvariant(`第一 ${REAL_BROKER_BSC} 第二 ${FAKE_ADDR_J1}`);
t('L1.4 mix real+fake → violated (拦 fake)', !!v4 && v4.foreign_address?.toLowerCase().startsWith('0x123456'), JSON.stringify(v4));

console.log('\n=== L2 wiring: happy path (regression — R19-EXT 不误伤真 reply) ===\n');

const db = new Database(DB_PATH);
const broker = db.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(TRADER_B_RELAY_ID);
const brokerIdent = db.prepare(`SELECT id FROM identities WHERE address=?`).get(broker.address);

const PEER = 'kaspa:qpr_nwt_r19ext_seed_' + Date.now().toString(36) + 'fakeprobe9999';
let peerIdent = db.prepare(`SELECT id FROM identities WHERE address=?`).get(PEER);
if (!peerIdent) {
  const peerId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO identities (id, network, address, identity_type, created_at, updated_at, is_blocked, trust_level, discovery_status, interaction_count, probe_attempt_count, successful_contact_count, confidence_score, card_has_ext)
    VALUES (?, 'kaspa-mainnet', ?, 'kasia_user', ?, ?, 0, 'unknown', 'discovered', 0, 0, 0, 0.5, 0)
  `).run(peerId, PEER, now, now);
  peerIdent = { id: peerId };
}

const now = new Date().toISOString();
const m1 = randomUUID();
db.prepare(`INSERT INTO messages (id, trace_id, direction, message_type, content_text, sender_identity_id, receiver_identity_id, created_at, updated_at) VALUES (?, ?, 'inbound', 'text', ?, ?, ?, ?, ?)`).run(m1, 'r19s-' + m1.slice(0, 8), '想买 5 KAS', peerIdent.id, brokerIdent.id, now, now);
const m2 = randomUUID();
db.prepare(`INSERT INTO messages (id, trace_id, direction, message_type, content_text, sender_identity_id, receiver_identity_id, created_at, updated_at) VALUES (?, ?, 'outbound', 'text', ?, ?, ?, ?, ?)`).run(m2, 'r19s-' + m2.slice(0, 8), '好的, 买 5 KAS. 用哪个链 付 USDT? (BSC / Polygon / SOL / TRON)', brokerIdent.id, peerIdent.id, now, now);

// turn 2: BSC → expect real preview_text 含 0xaD12544E (NOT 兜底)
const t0 = Date.now();
const res = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ relayNodeId: TRADER_B_RELAY_ID, peer: PEER, message: 'BSC' }),
});
const dt = Date.now() - t0;
const data = await res.json();
const reply = data.reply || '';
console.log(`(${dt}ms) reply length=${reply.length}\n--- reply ---\n${reply}\n---\n`);

t('L2.1 happy path reply 含真 broker 0xaD12544E (R19-EXT 不误伤)', reply.includes(REAL_BROKER_BSC));
t('L2.2 happy path reply NOT 含 fake 0x1234*', !/0x1234[0-9a-fA-F]{6,}/.test(reply));
t('L2.3 happy path reply NOT 兜底文 (R19 EXT 没误触)', !reply.includes('R19 拦截'));

// cleanup
db.prepare(`DELETE FROM messages WHERE sender_identity_id=? OR receiver_identity_id=?`).run(peerIdent.id, peerIdent.id);
db.prepare(`DELETE FROM identities WHERE id=?`).run(peerIdent.id);

console.log('\n=== 总结 ===');
console.log(`PASS: ${pass}/${pass+fail}`);
if (fail > 0) {
  console.log(`🚨 R19-EXT verify FAIL`);
  process.exit(1);
}
console.log('🎉 R19-EXT functional + wiring 双验证 PASS');
console.log('NEXT (J1): Sophie polluted real chain DM → R19-EXT 真触发 [R19-EXT] log + 兜底 reply');
process.exit(0);
