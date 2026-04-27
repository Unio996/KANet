// Bug-Z8 直接 unit-test _r19Guard 真路径 — 模拟 J1 09:11 真 confirm step 真 false positive
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { sqlite } from '../src/db/client.js';
import { assertReplyAddressInvariant } from '../src/services/broker-action-queue.js';

const TRADER_B_ADDR = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const PEER = 'kaspa:qzbz8d' + Math.random().toString(36).slice(2, 50);
const ERIC_EVM = '0x94053e04feE8d863cFa29DF10938a7A2E2b71D74';

// inject identities + history
function getOrCreateIdent(addr) {
  let row = sqlite.prepare('SELECT id FROM identities WHERE address = ?').get(addr);
  if (row) return row.id;
  const id = randomUUID();
  sqlite.prepare("INSERT INTO identities (id, address, network, created_at, updated_at) VALUES (?, ?, 'mainnet', datetime('now'), datetime('now'))").run(id, addr);
  return id;
}
const peerIdent = getOrCreateIdent(PEER);
const brokerIdent = getOrCreateIdent(TRADER_B_ADDR);

// inject 真 J1 09:09-09:11 真 trace 真 history
const ericMsgs = [
  `卖 5 KAS, BSC, ${ERIC_EVM}`,
  `BSC, ${ERIC_EVM}`,
  '好',
];
for (const m of ericMsgs) {
  sqlite.prepare(`
    INSERT INTO messages (id, trace_id, direction, sender_identity_id, receiver_identity_id, message_type, content_text, created_at, updated_at)
    VALUES (?, ?, 'inbound', ?, ?, 'text', ?, datetime('now'), datetime('now'))
  `).run(randomUUID(), randomUUID(), peerIdent, brokerIdent, m);
}

// 模拟 broker confirm reply 真 含 user EVM addr (J1 09:11:58 真 reply 真 generated DM)
const brokerConfirmReply = `✓ 卖单已建.

请转 5 KAS 到 broker (Kaspa):
${TRADER_B_ADDR}

转完后 broker 自动挂 SELL 单, 接单后 USDT 直付到你 BSC:
${ERIC_EVM}

2h 内无人接 → broker 自动退原 5 KAS.`;

console.log('=== 模拟 J1 09:11 真 confirm step ===');
console.log(`broker reply 含 user EVM ${ERIC_EVM}`);

// === Test 1: Pre-fix 行为 (userContext = '好' only) ===
console.log('\n[Test 1] PRE-FIX userContext = current msg only ("好"):');
const v1 = assertReplyAddressInvariant(brokerConfirmReply, '好');
console.log(`  result: ${v1 ? `VIOLATED foreign=${v1.foreign_address}` : 'PASS'}`);
console.log(`  expected: VIOLATED (J1 真测撞的 false positive)`);

// === Test 2: Post-fix 行为 (userContext = current msg + recent user history) ===
console.log('\n[Test 2] POST-FIX userContext = current + recent 5 user msgs:');
const recent = sqlite.prepare(`
  SELECT m.content_text FROM messages m
  LEFT JOIN identities si ON si.id = m.sender_identity_id
  WHERE si.address = ? AND m.message_type='text' AND m.direction='inbound'
  ORDER BY m.created_at DESC LIMIT 5
`).all(PEER);
console.log(`  recent user msgs: ${recent.map(r => `"${r.content_text?.slice(0, 30)}..."`).join(', ')}`);
const userContext2 = '好' + ' ' + recent.map(r => r.content_text || '').join(' ');
const v2 = assertReplyAddressInvariant(brokerConfirmReply, userContext2);
console.log(`  result: ${v2 ? `VIOLATED foreign=${v2.foreign_address}` : 'PASS ✓'}`);
console.log(`  expected: PASS (Bug-Z8 fix 真生效, user prior turn addr 真 whitelisted)`);

// === Test 3: 攻击 vector — broker LLM 编 fake addr 应该仍被拒 ===
console.log('\n[Test 3] 攻击 case: broker LLM 编 fake 0xDEADBEEF... addr:');
const fakeReply = `请转 5 KAS 到 broker. 然后 USDT 会发到 0xDEADBEEFcafebabe1234567890abcdef0987654321 (我编的!)`;
const v3 = assertReplyAddressInvariant(fakeReply, userContext2);
console.log(`  result: ${v3 ? `VIOLATED foreign=${v3.foreign_address} ✓ (R19 仍堵 broker hallucinate)` : 'PASS (BAD)'}`);
console.log(`  expected: VIOLATED (R19 仍 protect broker fake addr)`);

console.log('\n=== summary ===');
console.log(`Test 1 (pre-fix repro): ${v1 ? '✓ shows the bug' : '✗ unexpected'}`);
console.log(`Test 2 (post-fix verify): ${!v2 ? '✓ Bug-Z8 fixed' : '✗ still blocks'}`);
console.log(`Test 3 (attack still rejected): ${v3 ? '✓ R19 still protects' : '✗ R19 weakened'}`);
