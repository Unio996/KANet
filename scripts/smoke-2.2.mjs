// smoke-2.2.mjs — TASK 2.2 验证: handleDm 非托管改造 + accept_v1 广播
// 依赖真实 console.db + 注入 mock sendCommandAsync

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../kasia-console/package.json'));
const Database = require('better-sqlite3');
const DB = path.join(__dirname, '../kasia-console/data/console.db');

const db = new Database(DB);

// 环境预清
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.2-%'").run();
db.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address LIKE 'kaspa:qtest22-%'").run();
// 暂隐真实 open 挂单
const hiddenCount = db.prepare(
  "UPDATE exchange_offers SET protocol_status='smoke_paused' WHERE protocol_status='open' AND give_asset='KAS' AND want_asset='USDT'"
).run().changes;
console.log(`[smoke] 暂隐 ${hiddenCount} 条真实挂单`);

process.on('exit', () => {
  try {
    db.prepare("UPDATE exchange_offers SET protocol_status='open' WHERE protocol_status='smoke_paused'").run();
    db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.2-%'").run();
    db.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address LIKE 'kaspa:qtest22-%'").run();
  } catch {}
});

const now = new Date().toISOString();
const FUTURE = new Date(Date.now() + 3600_000).toISOString();

function insertOffer(id, overrides = {}) {
  const base = {
    id, maker: 'kaspa:test-maker', taker: null,
    broadcast_tx_id: 'btx-' + id, message_index: 0,
    give_asset: 'KAS', give_amount: '10', want_asset: 'USDT', want_amount: '1.7',
    verification: 'cross_chain_tx', protocol_status: 'open',
    is_fully_observed: 1, market_key: 'KAS|USDT', expires_at: FUTURE,
    verification_meta: JSON.stringify({
      accepted_chains: [{ chain: 'bnb', address: '0xMaker00000000000000000000000000000000BSC' }],
      expected_asset: 'USDT',
    }),
    created_at: now, updated_at: now,
  };
  const o = { ...base, ...overrides };
  db.prepare(`INSERT INTO exchange_offers
    (id, maker, taker, broadcast_tx_id, message_index, give_asset, give_amount, want_asset, want_amount,
     verification, protocol_status, is_fully_observed, market_key, expires_at, verification_meta, created_at, updated_at)
    VALUES (@id,@maker,@taker,@broadcast_tx_id,@message_index,@give_asset,@give_amount,@want_asset,@want_amount,
            @verification,@protocol_status,@is_fully_observed,@market_key,@expires_at,@verification_meta,@created_at,@updated_at)`).run(o);
}

const mod = await import('file:///' + path.join(__dirname, '../kasia-console/src/services/retail-dex.js').replace(/\\/g, '/'));
const {
  handleDm, getActiveOrderForUser, getOrderById,
  _broadcastAcceptV1, _testInjectSendCommand, _testResetSendCommand,
  _testInjectMidPrice, _testResetMidPrice,
} = mod;

// 所有测试 fixture 都用 0.17 USDT/KAS — mock midprice 保 preCheck 不拦
_testInjectMidPrice(0.17);

// ── Mock sendCommandAsync 记录调用 ───
let bcastCalls = [];
function mockSendOk(relayId, cmd) {
  bcastCalls.push({ relayId, cmd });
  return Promise.resolve({ txId: '0xmocktx' + Math.random().toString(16).slice(2, 10).padEnd(58, '0') });
}
function mockSendFail() {
  return Promise.resolve({ txId: null });
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

console.log('=== TASK 2.2 smoke: handleDm non-custodial ===\n');

// 常用 broker + user
const BROKER_RELAY = db.prepare("SELECT id FROM relay_nodes WHERE is_dex_broker=1 LIMIT 1").get()?.id
  || 'fake-broker-relay-id';
const USER_A = 'kaspa:qtest22-user-a';
const USER_B = 'kaspa:qtest22-user-b';

// ── 1. 无 offer → 订单保留在 aligning ───
db.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address = ?").run(USER_A);
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.2-%'").run();
await test('1. 无 offer → aligning 不转态', async () => {
  await handleDm(USER_A, '买 10 KAS', BROKER_RELAY);
  await handleDm(USER_A, 'BSC', BROKER_RELAY);
  const r = await handleDm(USER_A, '0x0000000000000000000000000000000000001234', BROKER_RELAY);
  const o = getActiveOrderForUser(USER_A);
  return o && o.state === 'aligning' && r.includes('无匹配挂单');
});

// ── 2. 有 offer → confirming + confirm text 含 Maker 直收 ───
db.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address = ?").run(USER_A);
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.2-%'").run();
insertOffer('test-2.2-m1', { give_amount: '10', want_amount: '1.7' });
await test('2. 有 offer → confirming + text 含 Maker 直收 + 非托管', async () => {
  await handleDm(USER_A, '买 10 KAS', BROKER_RELAY);
  await handleDm(USER_A, 'BSC', BROKER_RELAY);
  const r = await handleDm(USER_A, '0x0000000000000000000000000000000000001234', BROKER_RELAY);
  const o = getActiveOrderForUser(USER_A);
  return o && o.state === 'confirming'
    && r.includes('Maker 直收')
    && r.includes('非托管')
    && !r.includes('原路退回')
    && o.exchange_offer_id === 'test-2.2-m1'
    && o.agent_pay_addr === '0xMaker00000000000000000000000000000000BSC';
});

// ── 3. YES + mock 广播成功 → awaiting_payment + 广播参数对 ───
bcastCalls = [];
_testInjectSendCommand(mockSendOk);
await test('3. YES + 广播成功 → awaiting_payment + payload 正确', async () => {
  const r = await handleDm(USER_A, 'YES', BROKER_RELAY);
  const o = getActiveOrderForUser(USER_A);
  if (!o || o.state !== 'awaiting_payment') return false;
  if (bcastCalls.length !== 1) return false;
  const call = bcastCalls[0];
  if (call.relayId !== BROKER_RELAY) return false;
  if (call.cmd.type !== 'send_broadcast') return false;
  if (call.cmd.channel !== 'kanet-exchange') return false;
  const msg = JSON.parse(call.cmd.message);
  if (msg.t !== 'kanet_exchange_accept_v1') return false;
  if (msg.offer_id !== 'test-2.2-m1') return false;
  if (msg.selected_chain !== 'bnb') return false;          // 归一化
  if (msg.receive_address !== USER_A) return false;        // 用户 Kasia 直收 KAS
  if (msg.payment_asset !== 'usdt') return false;
  if (!r.includes('已上链挂单')) return false;
  return true;
});
_testResetSendCommand();

// ── 4. YES + mock 广播失败 → 保留 confirming ───
db.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address = ?").run(USER_B);
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.2-%'").run();
insertOffer('test-2.2-m2', { give_amount: '10', want_amount: '1.7' });
await handleDm(USER_B, '买 10 KAS', BROKER_RELAY);
await handleDm(USER_B, 'BSC', BROKER_RELAY);
await handleDm(USER_B, '0x0000000000000000000000000000000000005678', BROKER_RELAY);
_testInjectSendCommand(mockSendFail);
await test('4. YES + 广播 no txId → 保留 confirming', async () => {
  const r = await handleDm(USER_B, 'YES', BROKER_RELAY);
  const o = getActiveOrderForUser(USER_B);
  return o && o.state === 'confirming' && r.includes('上链失败');
});
_testResetSendCommand();

// ── 5. offer 被吃掉 (status 变 matched) → YES → expired ───
db.prepare("UPDATE exchange_offers SET protocol_status='matched' WHERE id='test-2.2-m2'").run();
_testInjectSendCommand(mockSendOk);
await test('5. offer 失效 → YES → expired (不发广播)', async () => {
  bcastCalls = [];
  const r = await handleDm(USER_B, 'YES', BROKER_RELAY);
  const o = getActiveOrderForUser(USER_B);
  // expired 终态 → getActiveOrderForUser 返 null
  return o === undefined || o === null
    ? r.includes('原挂单已失效') && bcastCalls.length === 0
    : false;
});
_testResetSendCommand();

// ── 6. 连发两次 YES → 第二次 default 分支 ───
db.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address = ?").run(USER_A);
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.2-%'").run();
insertOffer('test-2.2-m3');
await handleDm(USER_A, '买 10 KAS', BROKER_RELAY);
await handleDm(USER_A, 'BSC', BROKER_RELAY);
await handleDm(USER_A, '0x0000000000000000000000000000000000009999', BROKER_RELAY);
_testInjectSendCommand(mockSendOk);
await handleDm(USER_A, 'YES', BROKER_RELAY);  // → awaiting_payment
await test('6. 第二次 YES (state=awaiting_payment) → 默认提示', async () => {
  const r = await handleDm(USER_A, 'YES', BROKER_RELAY);
  const o = getActiveOrderForUser(USER_A);
  return o && o.state === 'awaiting_payment' && (r.includes('请发付款 tx hash') || r.includes('已记录'));
});
_testResetSendCommand();

// ── 7. awaiting_payment + 有效 tx hash → paid ───
await test('7. awaiting_payment + 合法 tx hash → paid + pay_tx_hash 落库', async () => {
  const fakeHash = '0x' + 'f'.repeat(64);
  const r = await handleDm(USER_A, fakeHash, BROKER_RELAY);
  const o = getActiveOrderForUser(USER_A);
  return o && o.state === 'paid' && o.pay_tx_hash === fakeHash && r.includes('等待验证');
});

// ── 8. _broadcastAcceptV1 独立测试 (payload 构造) ───
_testInjectSendCommand(mockSendOk);
bcastCalls = [];
await test('8. _broadcastAcceptV1 payload 构造 + receive_address 正确', async () => {
  const fakeOrder = {
    id: 'fake-id-xx', exchange_offer_id: 'fake-offer-xx',
    pay_chain: 'BEP20', user_kasia_address: 'kaspa:qxyz',
  };
  const res = await _broadcastAcceptV1('broker-abc', fakeOrder);
  if (!res.ok) return false;
  const msg = bcastCalls[bcastCalls.length - 1].cmd.message;
  const p = JSON.parse(msg);
  return p.t === 'kanet_exchange_accept_v1'
    && p.offer_id === 'fake-offer-xx'
    && p.selected_chain === 'bnb'   // BEP20 归一 bnb
    && p.receive_address === 'kaspa:qxyz'
    && p.payment_asset === 'usdt';
});
_testResetSendCommand();

// ── 9. aligning isCancel → expired ───
db.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address = ?").run(USER_A);
await handleDm(USER_A, '买 10 KAS', BROKER_RELAY);
await test('9. aligning NO → expired', async () => {
  const r = await handleDm(USER_A, 'NO', BROKER_RELAY);
  const o = getActiveOrderForUser(USER_A);
  return (o === undefined || o === null) && r.includes('已取消');
});

// ── 10. confirming isCancel → expired ───
db.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address = ?").run(USER_A);
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.2-%'").run();
insertOffer('test-2.2-m4');
await handleDm(USER_A, '买 10 KAS', BROKER_RELAY);
await handleDm(USER_A, 'BSC', BROKER_RELAY);
await handleDm(USER_A, '0x0000000000000000000000000000000000001111', BROKER_RELAY);
await test('10. confirming NO → expired', async () => {
  const r = await handleDm(USER_A, 'NO', BROKER_RELAY);
  const o = getActiveOrderForUser(USER_A);
  return (o === undefined || o === null) && r.includes('已取消');
});

// ── bonus: getOrderById 确认 exchange_offer_id 被锁定 ───
db.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address = ?").run(USER_A);
db.prepare("DELETE FROM exchange_offers WHERE id LIKE 'test-2.2-%'").run();
insertOffer('test-2.2-lock', { give_amount: '10', want_amount: '1.7' });
await handleDm(USER_A, '买 10 KAS', BROKER_RELAY);
await handleDm(USER_A, 'BSC', BROKER_RELAY);
await handleDm(USER_A, '0x0000000000000000000000000000000000002222', BROKER_RELAY);
await test('bonus-A: confirming 时 exchange_offer_id 已锁定', async () => {
  const o = getActiveOrderForUser(USER_A);
  return o && o.exchange_offer_id === 'test-2.2-lock' && o.state === 'confirming'
    && parseFloat(o.quoted_usdt) > 0;
});

// ── bonus-B: quoted_usdt ≈ offer.want_amount (精确匹配) ───
await test('bonus-B: 精确 qty 匹配时 quoted = want_amount', async () => {
  const o = getActiveOrderForUser(USER_A);
  return Math.abs(parseFloat(o.quoted_usdt) - 1.7) < 0.0001;
});

console.log(`\n=== ${pass} pass / ${fail} fail ===`);
db.close();
process.exit(fail === 0 ? 0 : 1);
