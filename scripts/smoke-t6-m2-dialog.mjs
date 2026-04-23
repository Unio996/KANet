// smoke-t6-m2-dialog.mjs — T6: M2 限价买单 handleDm 全链路 behavioral smoke
// Run from kasia-console cwd: cd kasia-console && node ../scripts/smoke-t6-m2-dialog.mjs

import { randomUUID } from 'crypto';

const { sqlite } = await import('../kasia-console/src/db/client.js');
const retailDex = await import('../kasia-console/src/services/retail-dex.js');
const { handleDm } = retailDex;

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { console.log(`  PASS: ${label}`); passed++; }
  else { console.log(`  FAIL: ${label}`); failed++; }
}
function assertEq(a, b, label) { assert(String(a) === String(b), `${label}: expected "${String(b)}", got "${String(a)}"`); }

const SEEDER_RELAY = 'seeder-t6-' + randomUUID().slice(0, 8);
const USER_KASIA = 'kaspa:qtest6' + randomUUID().slice(0, 12);

function cleanupAll() {
  sqlite.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address = ?").run(USER_KASIA);
  sqlite.prepare("DELETE FROM retail_dex_buy_publications WHERE user_kasia_address = ?").run(USER_KASIA);
  sqlite.prepare("DELETE FROM agent_wallets WHERE relay_node_id = ?").run(SEEDER_RELAY);
  sqlite.prepare("DELETE FROM relay_nodes WHERE id = ?").run(SEEDER_RELAY);
}

function insertRelayWithWallet(chain = 'bnb', addr = '0xSeederBscAddr1234567890abcdef0000') {
  const now = new Date().toISOString();
  sqlite.prepare(
    "INSERT OR REPLACE INTO relay_nodes (id, name, network, poll_ms, created_at, updated_at) VALUES (?, 'smoke-t6-seeder', 'mainnet', 2000, ?, ?)"
  ).run(SEEDER_RELAY, now, now);
  sqlite.prepare(
    "INSERT OR REPLACE INTO agent_wallets (relay_node_id, chain, address, privkey_encrypted, is_default, created_at, updated_at) VALUES (?, ?, ?, 'enc_fake', 1, ?, ?)"
  ).run(SEEDER_RELAY, chain, addr, now, now);
}

// ── Case 1: fastPath 限价买 → INSERT pub + 返 deposit 文案 ──
console.log('\n--- Case 1: fastPath 限价买 "买 50 KAS @ 0.03 USDT" ---');
cleanupAll();
insertRelayWithWallet('bnb', '0xSeederBSC_case1_addr_test_aaaa000');

const reply1 = await handleDm(USER_KASIA, '买 50 KAS @ 0.03 USDT', SEEDER_RELAY);

assert(reply1.includes('挂单提交'), 'Case 1: reply 含 "挂单提交"');
assert(reply1.includes('0xSeederBSC_case1_addr_test_aaaa000'), 'Case 1: reply 含 Seeder BSC 地址');
assert(reply1.includes('1.500000 USDT') || reply1.includes('1.5 USDT'), 'Case 1: reply 含 expected USDT (50*0.03=1.5)');
assert(reply1.includes('awaiting_deposit'), 'Case 1: reply 含 state');

const pub1 = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE user_kasia_address = ?").get(USER_KASIA);
assert(pub1, 'Case 1: retail_dex_buy_publications row 建成');
assertEq(pub1?.state, 'awaiting_deposit', 'Case 1: pub.state = awaiting_deposit');
assertEq(pub1?.side, 'buy_kas', 'Case 1: side = buy_kas');
assertEq(pub1?.qty, '50', 'Case 1: qty = 50');
assertEq(pub1?.limit_price, '0.03', 'Case 1: limit_price = 0.03');
assertEq(pub1?.total_usdt, '1.500000', 'Case 1: total_usdt = 1.500000');
assertEq(pub1?.pay_chain, 'bnb', 'Case 1: pay_chain = bnb');

// ── Case 2: 市价买 "买 50 KAS" → 不走 M2 (回归) ──
console.log('\n--- Case 2: 市价买不触发 M2 publication ---');
cleanupAll();
insertRelayWithWallet('bnb');

const reply2 = await handleDm(USER_KASIA, '买 50 KAS', SEEDER_RELAY);
const pub2 = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE user_kasia_address = ?").get(USER_KASIA);

assert(!pub2, 'Case 2: 市价买不 INSERT buy_publications');
assert(!reply2.includes('挂单提交'), 'Case 2: reply 不含挂单提交文案');

// ── Case 3: seeder wallet 不存在 → 返 "挂单失败" 人话 ──
console.log('\n--- Case 3: seeder wallet 缺 → 人话错误 ---');
cleanupAll();
// 只建 relay_nodes 不建 wallet
const now3 = new Date().toISOString();
sqlite.prepare(
  "INSERT INTO relay_nodes (id, name, network, poll_ms, created_at, updated_at) VALUES (?, 'smoke-t6-noseed', 'mainnet', 2000, ?, ?)"
).run(SEEDER_RELAY, now3, now3);

const reply3 = await handleDm(USER_KASIA, '买 50 KAS @ 0.03 USDT', SEEDER_RELAY);

const pub3 = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE user_kasia_address = ?").get(USER_KASIA);
assert(!pub3, 'Case 3: seeder 缺时不 INSERT pub');
assert(reply3.includes('Seeder 挂单失败') || reply3.includes('挂单失败'), 'Case 3: reply 含挂单失败提示');
assert(reply3.includes('seeder_bsc_addr_missing'), 'Case 3: reply 含原因 seeder_bsc_addr_missing');

// ── Case 4: 卖单 → 不走 M2 (回归) ──
console.log('\n--- Case 4: 卖单不走 M2 ---');
cleanupAll();
insertRelayWithWallet('bnb');

const reply4 = await handleDm(USER_KASIA, '卖 50 KAS @ 0.04 USDT', SEEDER_RELAY);
const pub4 = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE user_kasia_address = ?").get(USER_KASIA);

assert(!pub4, 'Case 4: 卖单不 INSERT buy_publications');
assert(!reply4.includes('挂单提交') || reply4.includes('挂单确认'), 'Case 4: 卖单走不同路径 (不是 M2 deposit prompt)');

// ── Case 5: pubId + seederAddr + expectedUsdt 返回契约 ──
console.log('\n--- Case 5: _triggerBuyPublication 契约 ---');
cleanupAll();
insertRelayWithWallet('bnb', '0xSeederContractTest_bbbb0000000000');
const { _triggerBuyPublication } = retailDex;

const trig5 = await _triggerBuyPublication({
  orderId: 'order-t6-' + randomUUID().slice(0, 8),
  userAddr: USER_KASIA, qty: '100', price: '0.05',
  brokerRelayId: SEEDER_RELAY, payChain: 'bnb',
});

assert(typeof trig5.pubId === 'string', 'Case 5: 返 pubId string');
assertEq(trig5.seederAddr, '0xSeederContractTest_bbbb0000000000', 'Case 5: 返 seederAddr 正确');
assertEq(trig5.expectedUsdt, '5.000000', 'Case 5: 返 expectedUsdt = 100*0.05 = 5');

// ── Cleanup ──
console.log('\n=== Cleanup ===');
cleanupAll();

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
