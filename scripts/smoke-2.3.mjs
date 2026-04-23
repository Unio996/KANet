// smoke-2.3.mjs — TASK 2.3 非托管 orderMonitor
// processPaidOrder / processExecutingOrder / processRefundingOrder

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../kasia-console/package.json'));
const Database = require('better-sqlite3');
const DB = path.join(__dirname, '../kasia-console/data/console.db');
const db = new Database(DB);

db.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address LIKE 'kaspa:qtest23-%'").run();
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.3-%'").run();

process.on('exit', () => {
  try {
    db.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address LIKE 'kaspa:qtest23-%'").run();
    db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.3-%'").run();
  } catch {}
});

const mod = await import('file:///' + path.join(__dirname, '../kasia-console/src/services/retail-dex.js').replace(/\\/g, '/'));
// 内部函数要访问 — retail-dex.js 只 export 了部分. orderMonitorTick 是 export 的, 其他是闭包内.
// 我们通过 orderMonitorTick() 触发, 观察 DB 状态变化.

const { _testInjectSendCommand, _testResetSendCommand, getOrderById, createOrder, updateState } = mod;

// mock send — 记录 broadcast
let bcastCalls = [];
function mockSendOk() {
  return (relayId, cmd) => {
    bcastCalls.push({ relayId, cmd });
    return Promise.resolve({ txId: '0xmocktx' + Math.random().toString(16).slice(2, 10).padEnd(58, '0') });
  };
}
function mockSendNoTx() {
  return (_relayId, _cmd) => Promise.resolve({ txId: null });
}

// 全局默认用 mockSendOk, 避免 orderMonitorTick 扫残留测试订单时调真 relay
mod._testInjectSendCommand(mockSendOk());

const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const now = new Date().toISOString();

function insertOffer(id, overrides = {}) {
  const base = {
    id, maker: 'kaspa:test-maker', taker: null,
    broadcast_tx_id: 'btx-' + id, message_index: 0,
    give_asset: 'KAS', give_amount: '10', want_asset: 'USDT', want_amount: '1.7',
    verification: 'cross_chain_tx', protocol_status: 'open',
    is_fully_observed: 1, market_key: 'KAS|USDT', expires_at: FUTURE,
    verification_meta: '{}', delivery_tx: null,
    created_at: now, updated_at: now,
  };
  const o = { ...base, ...overrides };
  db.prepare(`INSERT INTO exchange_offers
    (id, maker, taker, broadcast_tx_id, message_index, give_asset, give_amount, want_asset, want_amount,
     verification, protocol_status, is_fully_observed, market_key, expires_at, verification_meta, delivery_tx, created_at, updated_at)
    VALUES (@id,@maker,@taker,@broadcast_tx_id,@message_index,@give_asset,@give_amount,@want_asset,@want_amount,
            @verification,@protocol_status,@is_fully_observed,@market_key,@expires_at,@verification_meta,@delivery_tx,@created_at,@updated_at)`).run(o);
}

function insertOrder(id, overrides = {}) {
  const base = {
    id,
    user_kasia_address: 'kaspa:qtest23-default',
    side: 'buy_kas',
    order_type: 'market',
    qty: '10',
    price: null,
    pay_chain: 'BSC',
    pay_address: '0x0000000000000000000000000000000000001234',
    receive_address: null,
    quoted_usdt: '1.7',
    state: 'aligning',
    pay_tx_hash: null,
    exchange_offer_id: null,
    deliver_tx_hash: null,
    refund_tx_hash: null,
    error_reason: null,
    expires_at: FUTURE,
    created_at: now,
    updated_at: now,
    agent_pay_addr: '0xMaker000000000000000000000000000000BSC1',
    mid_price_at_quote: '0.17',
  };
  const o = { ...base, ...overrides };
  db.prepare(`INSERT INTO retail_dex_orders
    (id, user_kasia_address, side, order_type, qty, price, pay_chain, pay_address,
     receive_address, quoted_usdt, state, pay_tx_hash, exchange_offer_id,
     deliver_tx_hash, refund_tx_hash, error_reason, expires_at, created_at, updated_at,
     agent_pay_addr, mid_price_at_quote)
    VALUES (@id,@user_kasia_address,@side,@order_type,@qty,@price,@pay_chain,@pay_address,
            @receive_address,@quoted_usdt,@state,@pay_tx_hash,@exchange_offer_id,
            @deliver_tx_hash,@refund_tx_hash,@error_reason,@expires_at,@created_at,@updated_at,
            @agent_pay_addr,@mid_price_at_quote)`).run(o);
  return id;
}

// 直接调用 orderMonitorTick, 让它扫 DB. 需要 is_dex_broker=1 的 relay 存在.
const broker = db.prepare("SELECT id FROM relay_nodes WHERE is_dex_broker=1 LIMIT 1").get();
const BROKER_ID = broker?.id || 'fake-broker';

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

console.log('=== TASK 2.3 smoke: orderMonitor 非托管 ===\n');

// ─── 1. processPaidOrder 正常流: tx 齐 → broadcast paid_v1 → executing ───
bcastCalls = [];
_testInjectSendCommand(mockSendOk());
{
  db.prepare("DELETE FROM retail_dex_orders WHERE id='tst23-paid-ok'").run();
  db.prepare("DELETE FROM exchange_offers WHERE id='test-2.3-offer-ok'").run();
  insertOffer('test-2.3-offer-ok');
  insertOrder('tst23-paid-ok', {
    user_kasia_address: 'kaspa:qtest23-a',
    state: 'paid',
    pay_tx_hash: '0x' + 'a'.repeat(64),
    exchange_offer_id: 'test-2.3-offer-ok',
  });
  await mod.orderMonitorTick();
  await test('1. paid 正常流 → broadcast paid_v1 → executing', async () => {
    const o = getOrderById('tst23-paid-ok');
    if (o?.state !== 'executing') return false;
    const call = bcastCalls.find(c => {
      try { return JSON.parse(c.cmd.message).t === 'kanet_exchange_paid_v1'; } catch { return false; }
    });
    if (!call) return false;
    const msg = JSON.parse(call.cmd.message);
    return msg.offer_id === 'test-2.3-offer-ok'
      && msg.payment_tx === '0x' + 'a'.repeat(64)
      && msg.payment_chain === 'bnb'
      && call.cmd.channel === 'kanet-exchange';
  });
}

// ─── 2. processPaidOrder 字段缺失 → skip ───
bcastCalls = [];
{
  db.prepare("DELETE FROM retail_dex_orders WHERE id='tst23-paid-missing'").run();
  insertOrder('tst23-paid-missing', {
    user_kasia_address: 'kaspa:qtest23-b',
    state: 'paid',
    pay_tx_hash: null,  // 缺
    exchange_offer_id: 'nonexist',
  });
  await mod.orderMonitorTick();
  await test('2. 字段缺失 → skip 不转态 + 不广播', async () => {
    const o = getOrderById('tst23-paid-missing');
    return o?.state === 'paid' && bcastCalls.length === 0;
  });
}

// ─── 3. processPaidOrder broadcast no txId → 保留 paid ───
bcastCalls = [];
_testInjectSendCommand(mockSendNoTx());
{
  db.prepare("DELETE FROM retail_dex_orders WHERE id='tst23-paid-notx'").run();
  db.prepare("DELETE FROM exchange_offers WHERE id='test-2.3-offer-notx'").run();
  insertOffer('test-2.3-offer-notx');
  insertOrder('tst23-paid-notx', {
    user_kasia_address: 'kaspa:qtest23-c',
    state: 'paid',
    pay_tx_hash: '0x' + 'b'.repeat(64),
    exchange_offer_id: 'test-2.3-offer-notx',
  });
  await mod.orderMonitorTick();
  await test('3. broadcast no txId → 保留 paid 等下 tick', async () => {
    const o = getOrderById('tst23-paid-notx');
    return o?.state === 'paid';
  });
}
_testResetSendCommand();

// ─── 4. processExecutingOrder: offer completed → order completed + deliver_tx 落库 ───
{
  db.prepare("DELETE FROM retail_dex_orders WHERE id='tst23-exec-done'").run();
  db.prepare("DELETE FROM exchange_offers WHERE id='test-2.3-offer-done'").run();
  insertOffer('test-2.3-offer-done', {
    protocol_status: 'completed',
    delivery_tx: '0xdelivery000000000000000000000000000000000000000000000000DEADBEEF',
  });
  insertOrder('tst23-exec-done', {
    user_kasia_address: 'kaspa:qtest23-d',
    state: 'executing',
    pay_tx_hash: '0x' + 'c'.repeat(64),
    exchange_offer_id: 'test-2.3-offer-done',
  });
  await mod.orderMonitorTick();
  await test('4. offer.completed → order.completed + deliver_tx_hash 落库', async () => {
    const o = getOrderById('tst23-exec-done');
    return o?.state === 'completed'
      && o.deliver_tx_hash === '0xdelivery000000000000000000000000000000000000000000000000DEADBEEF';
  });
}

// ─── 5. processExecutingOrder: offer cancelled → order refunding ───
{
  db.prepare("DELETE FROM retail_dex_orders WHERE id='tst23-exec-cancel'").run();
  db.prepare("DELETE FROM exchange_offers WHERE id='test-2.3-offer-cancel'").run();
  insertOffer('test-2.3-offer-cancel', { protocol_status: 'cancelled' });
  insertOrder('tst23-exec-cancel', {
    user_kasia_address: 'kaspa:qtest23-e',
    state: 'executing',
    pay_tx_hash: '0x' + 'd'.repeat(64),
    exchange_offer_id: 'test-2.3-offer-cancel',
  });
  await mod.orderMonitorTick();
  // refunding 会在同 tick 被 processRefundingOrder 推到 failed (非托管)
  await test('5. offer.cancelled → order refunding → 同 tick failed 非托管', async () => {
    const o = getOrderById('tst23-exec-cancel');
    return o?.state === 'failed' && o.error_reason === 'non_custodial_maker_refund_required';
  });
}

// ─── 6. processExecutingOrder: offer disputed → refunding → failed ───
{
  db.prepare("DELETE FROM retail_dex_orders WHERE id='tst23-exec-dispute'").run();
  db.prepare("DELETE FROM exchange_offers WHERE id='test-2.3-offer-dispute'").run();
  insertOffer('test-2.3-offer-dispute', { protocol_status: 'disputed' });
  insertOrder('tst23-exec-dispute', {
    user_kasia_address: 'kaspa:qtest23-f',
    state: 'executing',
    exchange_offer_id: 'test-2.3-offer-dispute',
  });
  await mod.orderMonitorTick();
  await test('6. offer.disputed → refunding → failed 非托管', async () => {
    const o = getOrderById('tst23-exec-dispute');
    return o?.state === 'failed' && o.error_reason === 'non_custodial_maker_refund_required';
  });
}

// ─── 7. processExecutingOrder: offer verifying (still in progress) → 不动 ───
{
  db.prepare("DELETE FROM retail_dex_orders WHERE id='tst23-exec-wait'").run();
  db.prepare("DELETE FROM exchange_offers WHERE id='test-2.3-offer-wait'").run();
  insertOffer('test-2.3-offer-wait', { protocol_status: 'verifying' });
  insertOrder('tst23-exec-wait', {
    user_kasia_address: 'kaspa:qtest23-g',
    state: 'executing',
    exchange_offer_id: 'test-2.3-offer-wait',
  });
  await mod.orderMonitorTick();
  await test('7. offer.verifying → order 保留 executing (等)', async () => {
    const o = getOrderById('tst23-exec-wait');
    return o?.state === 'executing';
  });
}

// ─── 8. processRefundingOrder: 非托管 → 直接 failed + reason ───
{
  db.prepare("DELETE FROM retail_dex_orders WHERE id='tst23-refund-direct'").run();
  insertOrder('tst23-refund-direct', {
    user_kasia_address: 'kaspa:qtest23-h',
    state: 'refunding',
  });
  await mod.orderMonitorTick();
  await test('8. refunding → failed + error_reason=non_custodial_maker_refund_required', async () => {
    const o = getOrderById('tst23-refund-direct');
    return o?.state === 'failed' && o.error_reason === 'non_custodial_maker_refund_required';
  });
}

// ─── 9. offer 消失 (被删) executing → 不崩, 保留 ───
{
  db.prepare("DELETE FROM retail_dex_orders WHERE id='tst23-exec-orphan'").run();
  insertOrder('tst23-exec-orphan', {
    user_kasia_address: 'kaspa:qtest23-i',
    state: 'executing',
    exchange_offer_id: 'nonexistent-offer-id',
  });
  await mod.orderMonitorTick();
  await test('9. offer 消失 → order 保留 executing 不崩', async () => {
    const o = getOrderById('tst23-exec-orphan');
    return o?.state === 'executing';
  });
}

// ─── 10. offer delivering → 等 ───
{
  db.prepare("DELETE FROM retail_dex_orders WHERE id='tst23-exec-deliver'").run();
  db.prepare("DELETE FROM exchange_offers WHERE id='test-2.3-offer-deliver'").run();
  insertOffer('test-2.3-offer-deliver', { protocol_status: 'delivering' });
  insertOrder('tst23-exec-deliver', {
    user_kasia_address: 'kaspa:qtest23-j',
    state: 'executing',
    exchange_offer_id: 'test-2.3-offer-deliver',
  });
  await mod.orderMonitorTick();
  await test('10. offer.delivering → 保留 executing', async () => {
    const o = getOrderById('tst23-exec-deliver');
    return o?.state === 'executing';
  });
}

console.log(`\n=== ${pass} pass / ${fail} fail ===`);
db.close();
process.exit(fail === 0 ? 0 : 1);
