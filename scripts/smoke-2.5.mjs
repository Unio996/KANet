// smoke-2.5.mjs — Stage 5 Hardening: 超时扫描 + cancel_v1 释放

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../kasia-console/package.json'));
const Database = require('better-sqlite3');
const DB = path.join(__dirname, '../kasia-console/data/console.db');
const db = new Database(DB);

// 清理所有 smoke 残留 (qtest2x-, test-2.x-)
db.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address LIKE 'kaspa:qtest2%'").run();
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.%'").run();

process.on('exit', () => {
  try {
    db.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address LIKE 'kaspa:qtest25-%'").run();
    db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.5-%'").run();
  } catch {}
});

const mod = await import('file:///' + path.join(__dirname, '../kasia-console/src/services/retail-dex.js').replace(/\\/g, '/'));
const { getOrderById, orderMonitorTick, _testInjectSendCommand, _testResetSendCommand } = mod;

let bcastCalls = [];
function mockSendOk() {
  return (_relayId, cmd) => {
    bcastCalls.push(cmd);
    return Promise.resolve({ txId: '0xmocktx' + Math.random().toString(16).slice(2, 10).padEnd(58, '0') });
  };
}

_testInjectSendCommand(mockSendOk());

const PAST = new Date(Date.now() - 60_000).toISOString();  // 1 分钟前, 已过期
const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const now = new Date().toISOString();

function insertOrder(id, overrides = {}) {
  const base = {
    id, user_kasia_address: 'kaspa:qtest25-default',
    side: 'buy_kas', order_type: 'market', qty: '10', price: null,
    pay_chain: 'BSC', pay_address: '0x0000000000000000000000000000000000001234',
    receive_address: null, quoted_usdt: '1.7', state: 'aligning',
    pay_tx_hash: null, exchange_offer_id: null,
    deliver_tx_hash: null, refund_tx_hash: null, error_reason: null,
    expires_at: FUTURE, created_at: now, updated_at: now,
    agent_pay_addr: '0xMaker0000000000000000000000000000000BSC',
    mid_price_at_quote: '0.17',
  };
  const o = { ...base, ...overrides };
  db.prepare(`INSERT INTO retail_dex_orders
    (id,user_kasia_address,side,order_type,qty,price,pay_chain,pay_address,
     receive_address,quoted_usdt,state,pay_tx_hash,exchange_offer_id,
     deliver_tx_hash,refund_tx_hash,error_reason,expires_at,created_at,updated_at,
     agent_pay_addr,mid_price_at_quote)
    VALUES (@id,@user_kasia_address,@side,@order_type,@qty,@price,@pay_chain,@pay_address,
            @receive_address,@quoted_usdt,@state,@pay_tx_hash,@exchange_offer_id,
            @deliver_tx_hash,@refund_tx_hash,@error_reason,@expires_at,@created_at,@updated_at,
            @agent_pay_addr,@mid_price_at_quote)`).run(o);
}

function insertOffer(id) {
  db.prepare(`INSERT INTO exchange_offers
    (id, maker, broadcast_tx_id, message_index, give_asset, give_amount, want_asset, want_amount,
     verification, protocol_status, is_fully_observed, market_key, expires_at, verification_meta, created_at, updated_at)
    VALUES (?, 'kaspa:maker', ?, 0, 'KAS', '10', 'USDT', '1.7', 'cross_chain_tx', 'matched', 1, 'KAS|USDT', ?, '{}', ?, ?)`)
    .run(id, 'btx-' + id, FUTURE, now, now);
}

let pass = 0, fail = 0;
async function test(name, fn) {
  try {
    const r = await fn();
    if (r) { console.log(`  [PASS] ${name}`); pass++; }
    else { console.log(`  [FAIL] ${name}`); fail++; }
  } catch (e) {
    console.log(`  [FAIL] ${name} THROW: ${e.message}`);
    fail++;
  }
}

console.log('=== TASK 2.5 smoke: hardening 超时 ===\n');

// ─── 1. aligning 过期 → expired, 不发广播 ───
bcastCalls = [];
db.prepare("DELETE FROM retail_dex_orders WHERE id='tst25-align-stale'").run();
insertOrder('tst25-align-stale', { user_kasia_address: 'kaspa:qtest25-a', state: 'aligning', expires_at: PAST });
await orderMonitorTick();
await test('1. aligning 过期 → expired, 不发广播', async () => {
  const o = getOrderById('tst25-align-stale');
  return o?.state === 'expired' && bcastCalls.length === 0;
});

// ─── 2. confirming 过期 → expired, 不发广播 ───
bcastCalls = [];
db.prepare("DELETE FROM retail_dex_orders WHERE id='tst25-conf-stale'").run();
insertOrder('tst25-conf-stale', {
  user_kasia_address: 'kaspa:qtest25-b', state: 'confirming', expires_at: PAST,
  exchange_offer_id: 'test-2.5-unused',
});
await orderMonitorTick();
await test('2. confirming 过期 → expired, 不发广播 (accept 未上链过)', async () => {
  const o = getOrderById('tst25-conf-stale');
  return o?.state === 'expired' && bcastCalls.length === 0;
});

// ─── 3. awaiting_payment 过期 + offer 存在 → cancel_v1 广播 + expired ───
bcastCalls = [];
db.prepare("DELETE FROM retail_dex_orders WHERE id='tst25-await-stale'").run();
db.prepare("DELETE FROM exchange_offers WHERE id='test-2.5-offer-await'").run();
insertOffer('test-2.5-offer-await');
insertOrder('tst25-await-stale', {
  user_kasia_address: 'kaspa:qtest25-c', state: 'awaiting_payment', expires_at: PAST,
  exchange_offer_id: 'test-2.5-offer-await',
});
await orderMonitorTick();
await test('3. awaiting_payment 过期 → cancel_v1 广播 + expired', async () => {
  const o = getOrderById('tst25-await-stale');
  if (o?.state !== 'expired') return false;
  const cancel = bcastCalls.find(c => {
    try { return JSON.parse(c.message).t === 'kanet_exchange_cancel_v1'; } catch { return false; }
  });
  if (!cancel) return false;
  const p = JSON.parse(cancel.message);
  return p.offer_id === 'test-2.5-offer-await' && p.reason === 'taker_timeout_no_payment';
});

// ─── 4. awaiting_payment 过期 + 无 offer_id → expired 不发广播 ───
bcastCalls = [];
db.prepare("DELETE FROM retail_dex_orders WHERE id='tst25-await-noid'").run();
insertOrder('tst25-await-noid', {
  user_kasia_address: 'kaspa:qtest25-d', state: 'awaiting_payment', expires_at: PAST,
  exchange_offer_id: null,
});
await orderMonitorTick();
await test('4. awaiting_payment 过期 + 无 offer_id → expired 不发广播', async () => {
  const o = getOrderById('tst25-await-noid');
  const hasCancel = bcastCalls.some(c => {
    try { return JSON.parse(c.message).t === 'kanet_exchange_cancel_v1'; } catch { return false; }
  });
  return o?.state === 'expired' && !hasCancel;
});

// ─── 5. paid 不被 sweeper 清 ───
bcastCalls = [];
db.prepare("DELETE FROM retail_dex_orders WHERE id='tst25-paid-stale'").run();
db.prepare("DELETE FROM exchange_offers WHERE id='test-2.5-offer-paid'").run();
insertOffer('test-2.5-offer-paid');
insertOrder('tst25-paid-stale', {
  user_kasia_address: 'kaspa:qtest25-e', state: 'paid', expires_at: PAST,
  exchange_offer_id: 'test-2.5-offer-paid',
  pay_tx_hash: '0x' + 'e'.repeat(64),
});
await orderMonitorTick();
await test('5. paid 过期但不被 sweeper 清 (会被 processPaidOrder 推 executing)', async () => {
  const o = getOrderById('tst25-paid-stale');
  // paid → 被 processPaidOrder 广播 paid_v1 → executing (mock 返 txId)
  return o?.state === 'executing';
});

// ─── 6. executing 过期也不被 sweeper 清 ───
bcastCalls = [];
db.prepare("DELETE FROM retail_dex_orders WHERE id='tst25-exec-stale'").run();
db.prepare("DELETE FROM exchange_offers WHERE id='test-2.5-offer-exec'").run();
insertOffer('test-2.5-offer-exec');  // status=matched, 非 completed/cancelled
insertOrder('tst25-exec-stale', {
  user_kasia_address: 'kaspa:qtest25-f', state: 'executing', expires_at: PAST,
  exchange_offer_id: 'test-2.5-offer-exec',
});
await orderMonitorTick();
await test('6. executing 过期不被 sweeper 清, 继续等 offer', async () => {
  const o = getOrderById('tst25-exec-stale');
  return o?.state === 'executing';
});

// ─── 7. expires_at IS NULL → 不被扫 ───
bcastCalls = [];
db.prepare("DELETE FROM retail_dex_orders WHERE id='tst25-noexp'").run();
insertOrder('tst25-noexp', {
  user_kasia_address: 'kaspa:qtest25-g', state: 'aligning', expires_at: null,
});
await orderMonitorTick();
await test('7. expires_at=null → sweeper 跳过', async () => {
  const o = getOrderById('tst25-noexp');
  return o?.state === 'aligning';
});

// ─── 8. 同一 tick 大批过期 (LIMIT 20 内) 全处理 ───
bcastCalls = [];
for (let i = 0; i < 5; i++) {
  db.prepare("DELETE FROM retail_dex_orders WHERE id=?").run(`tst25-bulk-${i}`);
  insertOrder(`tst25-bulk-${i}`, {
    user_kasia_address: `kaspa:qtest25-bulk-${i}`, state: 'aligning', expires_at: PAST,
  });
}
await orderMonitorTick();
await test('8. 5 条同时过期 → 全推 expired', async () => {
  for (let i = 0; i < 5; i++) {
    const o = getOrderById(`tst25-bulk-${i}`);
    if (o?.state !== 'expired') return false;
  }
  return true;
});

console.log(`\n=== ${pass} pass / ${fail} fail ===`);
_testResetSendCommand();
db.close();
process.exit(fail === 0 ? 0 : 1);
