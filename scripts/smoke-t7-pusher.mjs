// smoke-t7-pusher.mjs — T7 M5 状态推送 behavioral smoke
// Run from kasia-console cwd: cd kasia-console && node ../scripts/smoke-t7-pusher.mjs

import { randomUUID } from 'crypto';

const { sqlite } = await import('../kasia-console/src/db/client.js');
const {
  pushPubTransition,
  pushOrderTransition,
  _testInjectSendCommandAsync,
  _testResetSendCommandAsync,
  PUB_TEMPLATES,
  ORDER_TEMPLATES,
} = await import('../kasia-console/src/services/retail-dex-pusher.js');

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { console.log(`  PASS: ${label}`); passed++; }
  else { console.log(`  FAIL: ${label}`); failed++; }
}
function assertEq(a, b, label) { assert(String(a) === String(b), `${label}: expected "${String(b)}", got "${String(a)}"`); }

const BROKER_RELAY = 'broker-t7-' + randomUUID().slice(0, 8);
const USER = 'kaspa:qt7' + randomUUID().slice(0, 12);

// Mock collector
let sentDMs = [];
function resetMock() {
  sentDMs = [];
  _testInjectSendCommandAsync(async (relayId, command) => {
    sentDMs.push({ relayId, ...command });
    return { txId: 'mock_tx_' + sentDMs.length, error: null };
  });
}

// ── Case 1: pushPubTransition awaiting_deposit ──
console.log('\n--- Case 1: awaiting_deposit template + send ---');
resetMock();
const pub1 = {
  id: 'pub-1-' + randomUUID().slice(0, 8),
  user_kasia_address: USER,
  broker_relay_id: BROKER_RELAY,
  pay_chain: 'bnb',
  total_usdt: '1.500000',
};
await pushPubTransition({ pub: pub1, newState: 'awaiting_deposit', brokerRelayId: BROKER_RELAY });

assertEq(sentDMs.length, 1, 'Case 1: exactly 1 DM sent');
assertEq(sentDMs[0]?.relayId, BROKER_RELAY, 'Case 1: relayId = brokerRelayId');
assertEq(sentDMs[0]?.type, 'send_message', 'Case 1: type = send_message');
assertEq(sentDMs[0]?.target, USER, 'Case 1: target = user');
assert(sentDMs[0]?.message.includes('待充值'), 'Case 1: message 含 "待充值"');
assert(sentDMs[0]?.message.includes('1.500000'), 'Case 1: message 含 total_usdt');
assert(sentDMs[0]?.message.includes('BNB'), 'Case 1: message 含 chain');

// ── Case 2: pushPubTransition completed ──
console.log('\n--- Case 2: completed template ---');
resetMock();
const pub2 = {
  id: 'pub-2-' + randomUUID().slice(0, 8),
  user_kasia_address: USER,
  broker_relay_id: BROKER_RELAY,
  kas_delivery_tx: '0xDeliveryTxSuccess123',
  total_usdt: '5',
  pay_chain: 'bnb',
};
await pushPubTransition({ pub: pub2, newState: 'completed', brokerRelayId: BROKER_RELAY });

assertEq(sentDMs.length, 1, 'Case 2: 1 DM sent');
assert(sentDMs[0]?.message.includes('成交'), 'Case 2: message 含 "成交"');
assert(sentDMs[0]?.message.includes('0xDelivery'), 'Case 2: message 含 kas_delivery_tx prefix');

// ── Case 3: pushPubTransition refunded ──
console.log('\n--- Case 3: refunded template ---');
resetMock();
const pub3 = {
  id: 'pub-3-' + randomUUID().slice(0, 8),
  user_kasia_address: USER,
  broker_relay_id: BROKER_RELAY,
  total_usdt: '10',
  usdt_refund_tx: '0xRefundTxBack456',
  pay_chain: 'bnb',
};
await pushPubTransition({ pub: pub3, newState: 'refunded', brokerRelayId: BROKER_RELAY });

assertEq(sentDMs.length, 1, 'Case 3: 1 DM sent');
assert(sentDMs[0]?.message.includes('已退款'), 'Case 3: message 含 "已退款"');
assert(sentDMs[0]?.message.includes('10 USDT'), 'Case 3: message 含 amount');

// ── Case 4: unknown state → skip (no DM) ──
console.log('\n--- Case 4: unknown state skip ---');
resetMock();
await pushPubTransition({ pub: pub1, newState: 'unknownState', brokerRelayId: BROKER_RELAY });
assertEq(sentDMs.length, 0, 'Case 4: unknown state no DM');

// ── Case 5: missing userAddr → skip ──
console.log('\n--- Case 5: missing userAddr skip ---');
resetMock();
await pushPubTransition({ pub: { ...pub1, user_kasia_address: null }, newState: 'awaiting_deposit', brokerRelayId: BROKER_RELAY });
assertEq(sentDMs.length, 0, 'Case 5: missing userAddr no DM');

// ── Case 6: pushOrderTransition confirming ──
console.log('\n--- Case 6: order confirming template ---');
resetMock();
const order6 = {
  id: 'order-6-' + randomUUID().slice(0, 8),
  user_kasia_address: USER,
  qty: '50',
  mid_price_at_quote: '0.034',
};
await pushOrderTransition({ order: order6, newState: 'confirming', brokerRelayId: BROKER_RELAY });

assertEq(sentDMs.length, 1, 'Case 6: 1 DM sent');
assert(sentDMs[0]?.message.includes('报价'), 'Case 6: message 含 "报价"');
assert(sentDMs[0]?.message.includes('50 KAS'), 'Case 6: message 含 qty');
assert(sentDMs[0]?.message.includes('0.034'), 'Case 6: message 含 mid_price');

// ── Case 7: pushOrderTransition completed ──
console.log('\n--- Case 7: order completed template ---');
resetMock();
const order7 = {
  id: 'order-7-' + randomUUID().slice(0, 8),
  user_kasia_address: USER + '_test7',
  kas_delivery_tx: '0xKasDeliveryTxLong789',
};
await pushOrderTransition({ order: order7, newState: 'completed', brokerRelayId: BROKER_RELAY });

assertEq(sentDMs.length, 1, 'Case 7: 1 DM sent');
assert(sentDMs[0]?.message.includes('成交'), 'Case 7: message 含 "成交"');
assert(sentDMs[0]?.message.includes('0xKasDeliv'), 'Case 7: message 含 kas_delivery_tx');

// ── Case 8: templates 有全状态 ──
console.log('\n--- Case 8: 模板完整性 ---');
for (const state of ['awaiting_deposit', 'deposited', 'published', 'filled', 'completed', 'refunded', 'refunding', 'failed']) {
  assert(PUB_TEMPLATES[state] != null, `Case 8: PUB_TEMPLATES.${state} exists`);
}
for (const state of ['confirming', 'awaiting_payment', 'paid', 'executing', 'completed', 'expired', 'failed', 'refunded']) {
  assert(ORDER_TEMPLATES[state] != null, `Case 8: ORDER_TEMPLATES.${state} exists`);
}

// ── Cleanup ──
console.log('\n=== Cleanup ===');
_testResetSendCommandAsync();

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
