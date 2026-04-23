// smoke-t5b-exchange-refund.mjs — T5b: maker auto-pay-give + refund worker
// Behavioral smoke: real INSERT/UPDATE, real function calls, real DB state assertions
// Run from kasia-console cwd: cd kasia-console && node ../scripts/smoke-t5b-exchange-refund.mjs

import { randomUUID } from 'crypto';

const { sqlite } = await import('../kasia-console/src/db/client.js');
const {
  _makerAutoPayGive,
  _testInjectTransferUsdt: injectEmTransferUsdt,
  _testResetTransferUsdt: resetEmTransferUsdt,
} = await import('../kasia-console/src/services/exchange-machine.js');
const {
  refundWorkerTick,
  _testInjectSendCommandAsync,
  _testResetSendCommandAsync,
  _testInjectTransferUsdt: injectMsTransferUsdt,
  _testResetTransferUsdt: resetMsTransferUsdt,
} = await import('../kasia-console/src/services/market-seeder.js');

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { console.log(`  PASS: ${label}`); passed++; }
  else { console.log(`  FAIL: ${label}`); failed++; }
}
function assertEq(a, b, label) {
  assert(String(a) === String(b), `${label}: expected "${String(b)}", got "${String(a)}"`);
}

const SEEDER_RELAY = 'seeder-test-' + randomUUID().slice(0, 8);
const USER_KASIA = 'kaspa:qtest' + randomUUID().slice(0, 16);

function cleanup() {
  sqlite.prepare("DELETE FROM retail_dex_buy_publications WHERE user_kasia_address = ?").run(USER_KASIA);
  sqlite.prepare("DELETE FROM exchange_offers WHERE maker = ?").run(SEEDER_RELAY);
  sqlite.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address = ?").run(USER_KASIA);
  sqlite.prepare("DELETE FROM agent_wallets WHERE relay_node_id = ?").run(SEEDER_RELAY);
  sqlite.prepare("DELETE FROM relay_nodes WHERE id = ?").run(SEEDER_RELAY);
  resetEmTransferUsdt();
  resetMsTransferUsdt();
  _testResetSendCommandAsync();
}

function insertRelayNode() {
  const now = new Date().toISOString();
  sqlite.prepare(
    "INSERT OR REPLACE INTO relay_nodes (id, name, network, poll_ms, created_at, updated_at) VALUES (?, 'smoke-t5b-seeder', 'mainnet', 2000, ?, ?)"
  ).run(SEEDER_RELAY, now, now);
}

function insertWallet() {
  insertRelayNode();
  const now = new Date().toISOString();
  sqlite.prepare(
    "INSERT OR REPLACE INTO agent_wallets (relay_node_id, chain, address, privkey_encrypted, is_default, created_at, updated_at) VALUES (?, 'bnb', '0xSeeder', 'enc_fake', 1, ?, ?)"
  ).run(SEEDER_RELAY, now, now);
}

function insertOffer({ id, giveAsset = 'USDT', giveChain = 'bnb', takerAddr = '0xTakerFake', protocolStatus = 'verifying' }) {
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO exchange_offers (id, broadcast_tx_id, give_asset, give_amount, give_chain, want_asset, want_amount, maker, market_key, protocol_status, verification, taker_payment_address, broadcast_at, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, '10', ?, 'KAS', '100', ?, 'buy_kas_bnb', ?, 'cross_chain_tx', ?, ?, ?, ?, ?)
  `).run(id, 'tx_' + id, giveAsset, giveChain, SEEDER_RELAY, protocolStatus, takerAddr, now, now, now, now);
}

function insertPub({ id, offerId, state, expiresAt }) {
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO retail_dex_buy_publications (id, user_kasia_address, broker_relay_id, seeder_relay_id, side, qty, limit_price, total_usdt, pay_chain, seeder_publish_offer_id, state, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'buy_kas', '100', '0.1', '10', 'bnb', ?, ?, ?, ?, ?)
  `).run(id, USER_KASIA, SEEDER_RELAY, SEEDER_RELAY, offerId, state, expiresAt, now, now);
}

function insertOrder(id) {
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO retail_dex_orders (id, user_kasia_address, side, order_type, qty, price, pay_chain, pay_address, state, expires_at, created_at, updated_at)
    VALUES (?, ?, 'buy_kas', 'limit', '100', '0.1', 'bnb', '0xUserPayAddr', 'awaiting_payment', ?, ?, ?)
  `).run(id, USER_KASIA, now, now, now);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Case 2: maker auto-pay 成功 → pub state=completed + filled_at + kas_delivery_tx ──
console.log('\n--- Case 2: maker auto-pay success → completed ---');
cleanup();
insertWallet();
const offer2 = 'offer-2-' + randomUUID().slice(0, 8);
insertOffer({ id: offer2, protocolStatus: 'verifying' });
insertPub({ id: 'pub-2-' + randomUUID().slice(0, 8), offerId: offer2, state: 'filled', expiresAt: new Date(Date.now() + 3600000).toISOString() });

let txUsdtCallCount = 0;
injectEmTransferUsdt(async (chain, privkey, to, amount) => {
  txUsdtCallCount++;
  return { ok: true, txHash: '0xAutoPaySuccess', error: null };
});

// Fetch the offer just inserted and call _makerAutoPayGive directly
const offer2Row = sqlite.prepare("SELECT * FROM exchange_offers WHERE id = ?").get(offer2);
await _makerAutoPayGive(offer2Row);

const pub2After = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE seeder_publish_offer_id = ?").get(offer2);
assertEq(pub2After.state, 'completed', 'Case 2: pub.state → completed');
assert(pub2After.filled_at != null, 'Case 2: pub.filled_at set (non-null)');
assertEq(pub2After.kas_delivery_tx, '0xAutoPaySuccess', 'Case 2: pub.kas_delivery_tx = txHash');
assertEq(txUsdtCallCount, 1, 'Case 2: transferUsdt called exactly once');

// ── Case 3: maker auto-pay fail → pub state=failed + error_reason ──
console.log('\n--- Case 3: maker auto-pay fail → failed ---');
cleanup();
insertWallet();
const offer3 = 'offer-3-' + randomUUID().slice(0, 8);
insertOffer({ id: offer3 });
insertPub({ id: 'pub-3-' + randomUUID().slice(0, 8), offerId: offer3, state: 'filled', expiresAt: new Date(Date.now() + 3600000).toISOString() });

injectEmTransferUsdt(async () => ({ ok: false, error: 'insufficient_balance' }));

try {
  const offer3Row = sqlite.prepare("SELECT * FROM exchange_offers WHERE id = ?").get(offer3);
  await _makerAutoPayGive(offer3Row);
  assert(false, 'Case 3: should throw on transferUsdt fail');
} catch (e) {
  assert(/maker_auto_pay_failed.*insufficient_balance/.test(e.message), 'Case 3: throws maker_auto_pay_failed with error');
}

const pub3After = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE seeder_publish_offer_id = ?").get(offer3);
assertEq(pub3After.state, 'failed', 'Case 3: pub.state → failed');
assert(/maker_auto_pay_failed.*insufficient_balance/.test(pub3After.error_reason || ''), 'Case 3: error_reason has insufficient_balance');

// ── Case 4: refundWorkerTick success → pub state=refunded ──
console.log('\n--- Case 4: refundWorkerTick success → refunded ---');
cleanup();
insertWallet();
const offer4 = 'offer-4-' + randomUUID().slice(0, 8);
insertOffer({ id: offer4, protocolStatus: 'open' });
const order4 = 'ord-4-' + randomUUID().slice(0, 8);
insertOrder(order4);
insertPub({ id: 'pub-4-' + randomUUID().slice(0, 8), offerId: offer4, state: 'published', expiresAt: new Date(Date.now() - 60000).toISOString().slice(0, 19).replace('T', ' '), orderId: order4 });

_testInjectSendCommandAsync(async () => ({ txId: 'cancel_tx_4', error: null }));
injectMsTransferUsdt(async () => ({ txHash: '0xRefundSuccess', error: null }));

await refundWorkerTick();

const pub4After = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE seeder_publish_offer_id = ?").get(offer4);
assertEq(pub4After.state, 'refunded', 'Case 4: pub.state → refunded');
assertEq(pub4After.usdt_refund_tx, '0xRefundSuccess', 'Case 4: pub.usdt_refund_tx = refund txHash');

// ── Case 5: offer protocol_status != 'open' → skip refund ──
console.log('\n--- Case 5: offer matched → skip refund ---');
cleanup();
insertWallet();
const offer5 = 'offer-5-' + randomUUID().slice(0, 8);
insertOffer({ id: offer5, protocolStatus: 'matched' });   // 已 matched, 不应退款
insertPub({ id: 'pub-5-' + randomUUID().slice(0, 8), offerId: offer5, state: 'published', expiresAt: new Date(Date.now() - 60000).toISOString().slice(0, 19).replace('T', ' ') });

let case5SendCommandCount = 0;
_testInjectSendCommandAsync(async () => { case5SendCommandCount++; return { txId: 'x' }; });
injectMsTransferUsdt(async () => ({ txHash: 'x' }));

await refundWorkerTick();

const pub5After = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE seeder_publish_offer_id = ?").get(offer5);
assertEq(pub5After.state, 'published', 'Case 5: pub.state UNCHANGED (published, not refunded)');
assertEq(case5SendCommandCount, 0, 'Case 5: sendCommandAsync NOT called (matched skip)');

// ── Case 6: cancel broadcast fail → fail-closed, transferUsdt NOT called ──
console.log('\n--- Case 6: cancel fail → fail-closed no transfer ---');
cleanup();
insertWallet();
const offer6 = 'offer-6-' + randomUUID().slice(0, 8);
insertOffer({ id: offer6, protocolStatus: 'open' });
const order6 = 'ord-6-' + randomUUID().slice(0, 8);
insertOrder(order6);
insertPub({ id: 'pub-6-' + randomUUID().slice(0, 8), offerId: offer6, state: 'published', expiresAt: new Date(Date.now() - 60000).toISOString().slice(0, 19).replace('T', ' '), orderId: order6 });

_testInjectSendCommandAsync(async () => ({ txId: null, error: 'broadcast_network_down' }));
let case6TransferCount = 0;
injectMsTransferUsdt(async () => { case6TransferCount++; return { txHash: 'should_not_be_called' }; });

await refundWorkerTick();

const pub6After = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE seeder_publish_offer_id = ?").get(offer6);
assertEq(pub6After.state, 'failed', 'Case 6: pub.state → failed on cancel fail');
assert(/cancel_broadcast_failed.*broadcast_network_down/.test(pub6After.error_reason || ''), 'Case 6: error_reason has cancel_broadcast_failed');
assertEq(case6TransferCount, 0, 'Case 6: transferUsdt NOT called (fail-closed)');

// ── Case 7: pub state != 'filled' → skip maker auto-pay (防 double pay) ──
console.log('\n--- Case 7: pub state=deposited → skip auto-pay ---');
cleanup();
insertWallet();
const offer7 = 'offer-7-' + randomUUID().slice(0, 8);
insertOffer({ id: offer7 });
insertPub({ id: 'pub-7-' + randomUUID().slice(0, 8), offerId: offer7, state: 'deposited', expiresAt: new Date(Date.now() + 3600000).toISOString() });

let case7TransferCount = 0;
injectEmTransferUsdt(async () => { case7TransferCount++; return { ok: true, txHash: 'x' }; });

const offer7Row = sqlite.prepare("SELECT * FROM exchange_offers WHERE id = ?").get(offer7);
await _makerAutoPayGive(offer7Row);

const pub7After = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE seeder_publish_offer_id = ?").get(offer7);
assertEq(pub7After.state, 'deposited', 'Case 7: pub.state UNCHANGED (deposited, not touched)');
assertEq(case7TransferCount, 0, 'Case 7: transferUsdt NOT called (pub not filled)');

// ── Cleanup ──
console.log('\n=== Cleanup ===');
cleanup();

// ── Summary ──
console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
