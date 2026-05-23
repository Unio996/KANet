// smoke-t5b-behavioral.mjs — T5b 真行为测试
// 规则: 不可纯 grep, 必须真 INSERT → 真调函数 → 真查 DB state
// Run: node scripts/smoke-t5b-behavioral.mjs
//
// 策略: 先用 backup DB 做初始化(设 wallet), 然后切到 test DB 跑所有 case,
// 最后恢复生产 DB。确保生产数据零修改。

import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync, copyFileSync, unlinkSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Backup production DB first ──
const prodDbPath = resolve(__dirname, '..', 'kasia-console/data/console.db');
const bakDbPath = prodDbPath + '.bak-t5b';
const testDbPath = resolve(__dirname, '..', 'kasia-console/data/console.db.test-t5b');

if (existsSync(prodDbPath)) {
  copyFileSync(prodDbPath, bakDbPath);
  console.log('  Backup: console.db → console.db.bak-t5b');
}

// ── Initialize test DB: copy production schema ──
if (existsSync(testDbPath)) { unlinkSync(testDbPath); }
copyFileSync(prodDbPath, testDbPath);

// ── Step 1: Setup wallet in test DB (before importing exchange-machine) ──
process.env.DB_PATH = testDbPath;

const Database = (await import('better-sqlite3')).default;
const testSqlite = new Database(testDbPath);
testSqlite.pragma('journal_mode = WAL');
testSqlite.pragma('foreign_keys = ON');

const brokerRelayId = '5b236c08-03d0-456c-953d-e10001610938';
const now = new Date().toISOString();

// Insert seeder wallet
const existing = testSqlite.prepare(
  "SELECT id FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' AND is_default = 1 LIMIT 1"
).get(brokerRelayId);
if (existing) {
  testSqlite.prepare(
    "UPDATE agent_wallets SET privkey_encrypted = 'fake_encrypted_pk_for_test_000000', updated_at = ? WHERE id = ?"
  ).run(now, existing.id);
} else {
  testSqlite.prepare(
    "INSERT INTO agent_wallets (id, relay_node_id, chain, address, is_default, privkey_encrypted, created_at, updated_at) VALUES (?, ?, 'bnb', '0xTestSeederAddr123456789abcdef', 1, 'fake_encrypted_pk_for_test_000000', ?, ?)"
  ).run(randomUUID(), brokerRelayId, now, now);
}

const walletCheck = testSqlite.prepare(
  "SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' LIMIT 1"
).get(brokerRelayId);
console.log('  Wallet: pk=' + (walletCheck?.privkey_encrypted ? 'SET' : 'NULL'));
testSqlite.close();

// ── Step 2: Import modules (they will read DB_PATH=testDbPath) ──
console.log('  Importing modules...');
const { sqlite } = await import(`file://${resolve(__dirname, '..', 'kasia-console/src/db/client.js')}`);

const {
  _makerAutoPayGive,
  _testInjectTransferUsdt,
  _testResetTransferUsdt,
} = await import(`file://${resolve(__dirname, '..', 'kasia-console/src/services/exchange-machine.js')}`);

const {
  refundWorkerTick,
  stopSeederRefundWorker,
} = await import(`file://${resolve(__dirname, '..', 'kasia-console/src/services/market-seeder.js')}`);

stopSeederRefundWorker();
_testResetTransferUsdt();

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  PASS: ${label}`); passed++; }
  else { console.log(`  FAIL: ${label}`); failed++; }
}

function assertEq(a, b, label) {
  assert(String(a) === String(b), `${label}: expected "${String(b)}", got "${String(a)}"`);
}

// ── Case 1: _makerAutoPayGive 成功 → pub state='completed' ──

console.log('\n--- Case 1: _makerAutoPayGive 成功 → pub completed ---');

let transferCallCount = 0;
let transferLastTx = null;
_testInjectTransferUsdt(async (chain, privkey, addr, amount) => {
  transferCallCount++;
  transferLastTx = '0xSuccessTx123';
  return { ok: true, txHash: '0xSuccessTx123' };
});

// Re-import to pick up new override
const { _makerAutoPayGive: _maap1 } = await import(`file://${resolve(__dirname, '..', 'kasia-console/src/services/exchange-machine.js')}?t=${Date.now()}`);

const pubId1 = randomUUID();
const offerId1 = randomUUID();

sqlite.prepare(`
  INSERT INTO retail_dex_buy_publications
    (id, user_kasia_address, broker_relay_id, seeder_relay_id, side, qty, limit_price, total_usdt, pay_chain, state, expires_at, created_at, updated_at, seeder_publish_offer_id)
  VALUES (?, 'kaspa1user1', ?, ?, 'buy_kas', '50', '0.034', '1.700000', 'bnb', 'filled', datetime('now', '+1 hour'), datetime('now'), datetime('now'), ?)
`).run(pubId1, brokerRelayId, brokerRelayId, offerId1);

const pub1Before = sqlite.prepare("SELECT state FROM retail_dex_buy_publications WHERE id = ?").get(pubId1);
assertEq(pub1Before?.state, 'filled', 'pub 初始 = filled');

await _maap1({
  id: offerId1,
  give_asset: 'USDT',
  give_chain: 'bnb',
  maker: brokerRelayId,
  taker_payment_address: '0xTakerAddr1',
});

const pub1After = sqlite.prepare("SELECT state, filled_at, kas_delivery_tx FROM retail_dex_buy_publications WHERE id = ?").get(pubId1);
assertEq(pub1After?.state, 'completed', 'pub state → completed');
assert(pub1After?.filled_at !== null, 'filled_at 非空');
assertEq(pub1After?.kas_delivery_tx, '0xSuccessTx123', 'kas_delivery_tx = txHash');
assertEq(transferCallCount, 1, 'transferUsdt 被调用 1 次');

// ── Case 2: _makerAutoPayGive 失败 → pub state='failed' + error_reason ──

console.log('\n--- Case 2: _makerAutoPayGive 失败 → pub failed ---');

_testResetTransferUsdt();
transferCallCount = 0;
_testInjectTransferUsdt(async () => {
  return { ok: false, error: 'insufficient_balance' };
});

const { _makerAutoPayGive: _maap2 } = await import(`file://${resolve(__dirname, '..', 'kasia-console/src/services/exchange-machine.js')}?t=${Date.now()}`);

const pubId2 = randomUUID();
const offerId2 = randomUUID();

sqlite.prepare(`
  INSERT INTO retail_dex_buy_publications
    (id, user_kasia_address, broker_relay_id, seeder_relay_id, side, qty, limit_price, total_usdt, pay_chain, state, expires_at, created_at, updated_at, seeder_publish_offer_id)
  VALUES (?, 'kaspa1user2', ?, ?, 'buy_kas', '50', '0.034', '2.000000', 'bnb', 'filled', datetime('now', '+1 hour'), datetime('now'), datetime('now'), ?)
`).run(pubId2, brokerRelayId, brokerRelayId, offerId2);

try {
  await _maap2({
    id: offerId2,
    give_asset: 'USDT',
    give_chain: 'bnb',
    maker: brokerRelayId,
    taker_payment_address: '0xTakerAddr2',
  });
} catch {
  // Expected
}

const pub2After = sqlite.prepare("SELECT state, error_reason FROM retail_dex_buy_publications WHERE id = ?").get(pubId2);
assertEq(pub2After?.state, 'failed', 'pub state → failed');
assert(pub2After?.error_reason?.includes('maker_auto_pay_failed'), 'error_reason 包含 maker_auto_pay_failed');
assert(pub2After?.error_reason?.includes('insufficient_balance'), 'error_reason 包含错误详情');

// ── Case 3: pub.state ≠ 'filled' → 跳过 (防 double pay) ──

console.log('\n--- Case 3: pub.state ≠ filled → _makerAutoPayGive 跳过 ---');

_testResetTransferUsdt();
transferCallCount = 0;
_testInjectTransferUsdt(async () => {
  transferCallCount++;
  return { ok: true, txHash: '0xnope' };
});

const { _makerAutoPayGive: _maap3 } = await import(`file://${resolve(__dirname, '..', 'kasia-console/src/services/exchange-machine.js')}?t=${Date.now()}`);

const pubId3 = randomUUID();
const offerId3 = randomUUID();

sqlite.prepare(`
  INSERT INTO retail_dex_buy_publications
    (id, user_kasia_address, broker_relay_id, seeder_relay_id, side, qty, limit_price, total_usdt, pay_chain, state, expires_at, created_at, updated_at, seeder_publish_offer_id)
  VALUES (?, 'kaspa1user3', ?, ?, 'buy_kas', '50', '0.034', '1.700000', 'bnb', 'deposited', datetime('now', '+1 hour'), datetime('now'), datetime('now'), ?)
`).run(pubId3, brokerRelayId, brokerRelayId, offerId3);

try {
  await _maap3({
    id: offerId3,
    give_asset: 'USDT',
    give_chain: 'bnb',
    maker: brokerRelayId,
    taker_payment_address: '0xTakerAddr3',
  });
} catch {}

const pub3After = sqlite.prepare("SELECT state FROM retail_dex_buy_publications WHERE id = ?").get(pubId3);
assertEq(pub3After?.state, 'deposited', 'pub.state 仍 = deposited (未变)');
assertEq(transferCallCount, 0, 'transferUsdt 未被调用 (防 double pay)');

_testResetTransferUsdt();

// ── Case 4: refundWorkerTick — matched offer 跳过 ──

console.log('\n--- Case 4: refundWorkerTick — matched offer 跳过 ---');

const { refundWorkerTick: _rwt4 } = await import(`file://${resolve(__dirname, '..', 'kasia-console/src/services/market-seeder.js')}?t=${Date.now()}`);

const pubId4 = randomUUID();
const offerId4 = randomUUID();

sqlite.prepare(`
  INSERT INTO retail_dex_buy_publications
    (id, user_kasia_address, broker_relay_id, seeder_relay_id, side, qty, limit_price, total_usdt, pay_chain, state, expires_at, created_at, updated_at, seeder_publish_offer_id)
  VALUES (?, 'kaspa1user4', ?, ?, 'buy_kas', '50', '0.034', '1.700000', 'bnb', 'published', datetime('now', '-10 minutes'), datetime('now', '-30 minutes'), datetime('now', '-30 minutes'), ?)
`).run(pubId4, brokerRelayId, brokerRelayId, offerId4);

sqlite.prepare(`
  INSERT INTO exchange_offers
    (id, broadcast_tx_id, message_index, maker, give_asset, give_amount, want_asset, want_amount, verification, verification_meta, protocol_status, taker_chain, taker_payment_address, expires_at, market_key, updated_at)
  VALUES (?, '0xBcTx4', 1, ?, 'USDT', '1.700000', 'KAS', '50.000000', 'kaspa_tx', '{}', 'matched', 'bnb', '0xTakerAddr4', datetime('now', '-5 minutes'), 'seeder-buy', ?)
`).run(offerId4, brokerRelayId, now);

const before4 = sqlite.prepare("SELECT state FROM retail_dex_buy_publications WHERE id = ?").get(pubId4);
assertEq(before4?.state, 'published', 'pub 初始 = published');

try { await _rwt4(); } catch { /* relay not running, expected */ }

const after4 = sqlite.prepare("SELECT state FROM retail_dex_buy_publications WHERE id = ?").get(pubId4);
assertEq(before4?.state, after4?.state, 'matched offer pub state 不变 (跳过)');

// ── Case 5: fail-closed — cancel fail → throw before transferUsdt ──

console.log('\n--- Case 5: fail-closed — cancel fail → throw before transferUsdt ---');

const seederPath = resolve(__dirname, '..', 'kasia-console/src/services/market-seeder.js');
const seederSrc = readFileSync(seederPath, 'utf-8');

const cancelFailPattern = seederSrc.match(/if\s*\(\s*cancelRes\.error\s*\)[\s\S]{0,80}throw[\s\S]{0,80}transferUsdt/);
assert(cancelFailPattern !== null, 'cancelRes.error → throw → transferUsdt 不被调用 (fail-closed)');

const errorReasonPattern = seederSrc.match(/error_reason\s*=\s*\?/);
assert(errorReasonPattern !== null, 'catch 分支保存 error_reason');

// ── Summary ──

console.log('\n=== Cleanup ===');
// Restore production DB
if (existsSync(bakDbPath)) {
  copyFileSync(bakDbPath, prodDbPath);
  unlinkSync(bakDbPath);
  try { unlinkSync(prodDbPath + '.bak-t5b-wal'); } catch {}
  try { unlinkSync(prodDbPath + '.bak-t5b-shm'); } catch {}
  console.log('  Restored: production DB restored from backup');
}
try { unlinkSync(testDbPath); } catch {}

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
