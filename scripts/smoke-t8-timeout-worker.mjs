// smoke-t8-timeout-worker.mjs — T8 系统兜底 worker behavioral smoke
// processTimeouts 扫超时 order → expired + push DM
// Run from kasia-console cwd: cd kasia-console && node ../scripts/smoke-t8-timeout-worker.mjs

import { randomUUID } from 'crypto';

const { sqlite } = await import('../kasia-console/src/db/client.js');
const {
  processTimeouts, getOrderById, createOrder, updateState,
  _testInjectSendCommand, _testResetSendCommand,
} = await import('../kasia-console/src/services/retail-dex.js');
const {
  _testInjectSendCommandAsync: pusherInject,
  _testResetSendCommandAsync: pusherReset,
} = await import('../kasia-console/src/services/retail-dex-pusher.js');

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { console.log(`  PASS: ${label}`); passed++; }
  else { console.log(`  FAIL: ${label}`); failed++; }
}
function assertEq(a, b, label) { assert(String(a) === String(b), `${label}: expected "${String(b)}", got "${String(a)}"`); }

const BROKER_RELAY = 'broker-t8-' + randomUUID().slice(0, 8);
const USER = 'kaspa:qt8' + randomUUID().slice(0, 12);

let sentDMs = [];
let sentCommands = [];

function setupMocks() {
  sentDMs = [];
  sentCommands = [];
  pusherInject(async (relayId, command) => {
    sentDMs.push({ relayId, ...command });
    return { txId: 'push_tx_' + sentDMs.length, error: null };
  });
  _testInjectSendCommand(async (relayId, command) => {
    sentCommands.push({ relayId, ...command });
    return { txId: 'cmd_tx_' + sentCommands.length, error: null };
  });
}

function cleanupAll() {
  sqlite.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address = ?").run(USER);
  sqlite.prepare("DELETE FROM relay_nodes WHERE id = ?").run(BROKER_RELAY);
  pusherReset();
  _testResetSendCommand();
}

function insertBrokerRelay() {
  const now = new Date().toISOString();
  sqlite.prepare(
    "INSERT OR REPLACE INTO relay_nodes (id, name, network, poll_ms, is_dex_broker, created_at, updated_at) VALUES (?, 'smoke-t8-broker', 'mainnet', 2000, 1, ?, ?)"
  ).run(BROKER_RELAY, now, now);
}

function insertExpiredOrder({ state, expiresAgoMs = 60000, offerId = null }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() - expiresAgoMs).toISOString();
  sqlite.prepare(`
    INSERT INTO retail_dex_orders (id, user_kasia_address, side, order_type, qty, price, pay_chain, state, expires_at, exchange_offer_id, created_at, updated_at)
    VALUES (?, ?, 'buy_kas', 'market', '50', '0.034', 'bnb', ?, ?, ?, ?, ?)
  `).run(id, USER, state, expiresAt, offerId, now, now);
  return id;
}

// ── Case 1: aligning 过期 → expired ──
console.log('\n--- Case 1: aligning 超时 → expired ---');
cleanupAll();
insertBrokerRelay();
setupMocks();

const o1 = insertExpiredOrder({ state: 'aligning' });
await processTimeouts(BROKER_RELAY);

const o1After = getOrderById(o1);
assertEq(o1After?.state, 'expired', 'Case 1: aligning → expired');
assert(o1After?.error_reason?.includes('timeout'), 'Case 1: error_reason 含 timeout');

// 等 .then() 异步 push 完成 (fire-and-forget)
await new Promise(r => setTimeout(r, 200));
assert(sentDMs.length >= 1, 'Case 1: 至少 1 条 DM 推送');
assert(sentDMs[0]?.message?.includes('超时已取消'), 'Case 1: DM 含 "超时已取消"');

// ── Case 2: confirming 过期 → expired ──
console.log('\n--- Case 2: confirming 超时 → expired ---');
cleanupAll();
insertBrokerRelay();
setupMocks();

const o2 = insertExpiredOrder({ state: 'confirming' });
await processTimeouts(BROKER_RELAY);

const o2After = getOrderById(o2);
assertEq(o2After?.state, 'expired', 'Case 2: confirming → expired');
await new Promise(r => setTimeout(r, 200));
assert(sentDMs.length >= 1, 'Case 2: 1 DM sent');

// ── Case 3: awaiting_payment 过期 → 广播 cancel_v1 + expired ──
console.log('\n--- Case 3: awaiting_payment 超时 → cancel_v1 + expired ---');
cleanupAll();
insertBrokerRelay();
setupMocks();

const offerId3 = 'mock-offer-' + randomUUID().slice(0, 8);
const o3 = insertExpiredOrder({ state: 'awaiting_payment', offerId: offerId3 });
await processTimeouts(BROKER_RELAY);

const o3After = getOrderById(o3);
assertEq(o3After?.state, 'expired', 'Case 3: awaiting_payment → expired');
assertEq(sentCommands.length, 1, 'Case 3: cancel_v1 broadcast 1 次');
assertEq(sentCommands[0]?.relayId, BROKER_RELAY, 'Case 3: broadcast 走 broker relay');
assert(sentCommands[0]?.message?.includes('kanet_exchange_cancel_v1'), 'Case 3: broadcast 含 cancel_v1');
assert(sentCommands[0]?.message?.includes(offerId3), 'Case 3: broadcast 含 offer_id');
assert(sentCommands[0]?.message?.includes('taker_timeout'), 'Case 3: broadcast 含原因');

// ── Case 4: 未超时 order 不动 (回归) ──
console.log('\n--- Case 4: 未超时不动 ---');
cleanupAll();
await new Promise(r => setTimeout(r, 300)); // 排干上轮 fire-and-forget push
insertBrokerRelay();
setupMocks();

const id4 = randomUUID();
const futureExpire = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const now4 = new Date().toISOString();
sqlite.prepare(`
  INSERT INTO retail_dex_orders (id, user_kasia_address, side, order_type, qty, price, pay_chain, state, expires_at, created_at, updated_at)
  VALUES (?, ?, 'buy_kas', 'market', '50', '0.034', 'bnb', 'aligning', ?, ?, ?)
`).run(id4, USER, futureExpire, now4, now4);

await processTimeouts(BROKER_RELAY);

const o4After = getOrderById(id4);
assertEq(o4After?.state, 'aligning', 'Case 4: 未超时 state 不改');
await new Promise(r => setTimeout(r, 200));
assertEq(sentDMs.length, 0, 'Case 4: 未超时无 DM');
assertEq(sentCommands.length, 0, 'Case 4: 未超时无 broadcast');

// ── Case 5: 不同终态不扫 (completed/failed/refunded) ──
console.log('\n--- Case 5: 终态不扫 ---');
cleanupAll();
await new Promise(r => setTimeout(r, 300));
insertBrokerRelay();
setupMocks();

// completed 已终态但 expires_at 过期 — 不应被扫
const idC = randomUUID();
const pastExpire = new Date(Date.now() - 60000).toISOString();
sqlite.prepare(`
  INSERT INTO retail_dex_orders (id, user_kasia_address, side, order_type, qty, price, pay_chain, state, expires_at, created_at, updated_at)
  VALUES (?, ?, 'buy_kas', 'market', '50', '0.034', 'bnb', 'completed', ?, ?, ?)
`).run(idC, USER, pastExpire, new Date().toISOString(), new Date().toISOString());

await processTimeouts(BROKER_RELAY);

const oCAfter = getOrderById(idC);
assertEq(oCAfter?.state, 'completed', 'Case 5: completed 终态不改');
assertEq(sentDMs.length, 0, 'Case 5: 终态无 DM');

// ── Case 6: updateState 自动 push DM (T7 hook via updateState) ──
console.log('\n--- Case 6: updateState → auto push ---');
cleanupAll();
await new Promise(r => setTimeout(r, 300));
insertBrokerRelay();
setupMocks();

const id6 = randomUUID();
const now6 = new Date().toISOString();
sqlite.prepare(`
  INSERT INTO retail_dex_orders (id, user_kasia_address, side, order_type, qty, price, pay_chain, state, expires_at, mid_price_at_quote, created_at, updated_at)
  VALUES (?, ?, 'buy_kas', 'market', '50', '0.034', 'bnb', 'aligning', ?, '0.034', ?, ?)
`).run(id6, USER, new Date(Date.now() + 3600000).toISOString(), now6, now6);

updateState(id6, 'confirming', {}, BROKER_RELAY);
await new Promise(r => setTimeout(r, 200));

assert(sentDMs.length >= 1, 'Case 6: updateState 自动 push');
assert(sentDMs[0]?.message?.includes('报价'), 'Case 6: DM 含 "报价"');

// ── Cleanup ──
console.log('\n=== Cleanup ===');
cleanupAll();

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
