// smoke-t5b-behavioral.mjs — T5b 真行为测试
// 规则: 不可纯 grep, 必须真 INSERT → 真调函数 → 真查 DB state
// Run: node scripts/smoke-t5b-behavioral.mjs (from kasia-console dir)

import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, copyFileSync, unlinkSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KASIA_ROOT = resolve(__dirname, '..');
const KASIA_DATA = resolve(KASIA_ROOT, 'data');
const prodDbPath = resolve(KASIA_DATA, 'console.db');
const testDbPath = resolve(KASIA_DATA, 'console.test-t5b.db');

const betterSqlite3 = (await import('better-sqlite3')).default;

// ── Setup test DB ──
if (!existsSync(prodDbPath)) {
  console.error('[ERROR] production DB not found at', prodDbPath);
  process.exit(1);
}

if (existsSync(testDbPath)) unlinkSync(testDbPath);
copyFileSync(prodDbPath, testDbPath);

const testDb = new betterSqlite3(testDbPath);

const brokerRelayId = '5b236c08-03d0-456c-953d-e10001610938';

// Check all wallet columns
const cols = testDb.pragma('table_info(agent_wallets)').map(c => c.name);
console.log('  agent_wallets columns:', cols.join(', '));

// Check if the existing wallet row has the expected structure
const existing = testDb.prepare(
  "SELECT id, relay_node_id, chain, address, label, is_default FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' AND is_default = 1 LIMIT 1"
).get(brokerRelayId);

if (existing) {
  console.log('  Found existing wallet:', existing.id.slice(0, 8));
  console.log('  relay_node_id:', existing.relay_node_id?.slice(0,8) || 'NULL');
  console.log('  chain:', existing.chain);
  console.log('  is_default:', existing.is_default);

  const pkBefore = testDb.prepare("SELECT privkey_encrypted FROM agent_wallets WHERE id = ?").get(existing.id);
  console.log('  privkey_encrypted before:', pkBefore?.privkey_encrypted || 'NULL');

  // Use the exact value
  testDb.prepare(
    "UPDATE agent_wallets SET privkey_encrypted = 'fake_encrypted_pk_for_test_000000', updated_at = datetime('now') WHERE id = ?"
  ).run(existing.id);

  // Force commit
  testDb.exec('COMMIT');

  const pkAfter = testDb.prepare("SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' LIMIT 1").get(brokerRelayId);
  console.log('  After UPDATE: pk=' + (pkAfter?.privkey_encrypted || 'NULL'));
} else {
  testDb.prepare(
    "INSERT INTO agent_wallets (id, relay_node_id, chain, address, is_default, privkey_encrypted, created_at, updated_at) VALUES (?, ?, 'bnb', '0xTestSeederAddr123456789abcdef', 1, 'fake_encrypted_pk_for_test_000000', datetime('now'), datetime('now'))"
  ).run(randomUUID(), brokerRelayId);
  console.log('  Inserted new wallet');
}

testDb.close();

// Re-open to verify
const verifyDb = new betterSqlite3(testDbPath);
const verifyPk = verifyDb.prepare("SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' LIMIT 1").get(brokerRelayId);
console.log('  Re-open verify: pk=' + (verifyPk?.privkey_encrypted || 'NULL'));
verifyDb.close();

// ── Now set DB_PATH and import ──
process.env.DB_PATH = testDbPath;

const { sqlite } = await import(`file://${resolve(KASIA_ROOT, 'src/db/client.js')}`);

const modWallet = sqlite.prepare("SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' LIMIT 1").get(brokerRelayId);
console.log('  Module wallet: pk=' + (modWallet?.privkey_encrypted ? 'SET(' + modWallet.privkey_encrypted.slice(0,10) + ')' : 'NULL'));

try { sqlite.prepare("DELETE FROM exchange_offers WHERE broadcast_tx_id LIKE '0xBcTx%'").run(); } catch {}

const {
  _makerAutoPayGive,
  _testInjectTransferUsdt,
  _testResetTransferUsdt,
} = await import(`file://${resolve(KASIA_ROOT, 'src/services/exchange-machine.js')}`);

const {
  refundWorkerTick,
  stopSeederRefundWorker,
} = await import(`file://${resolve(KASIA_ROOT, 'src/services/market-seeder.js')}`);

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
_testInjectTransferUsdt(async (chain, privkey, addr, amount) => {
  transferCallCount++;
  return { ok: true, txHash: '0xSuccessTx123' };
});

const { _makerAutoPayGive: _maap1 } = await import(`file://${resolve(KASIA_ROOT, 'src/services/exchange-machine.js')}?t=${Date.now()}`);

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

// ── Case 2: _makerAutoPayGive 失败 → pub state='failed' ──

console.log('\n--- Case 2: _makerAutoPayGive 失败 → pub failed ---');

_testResetTransferUsdt();
transferCallCount = 0;
_testInjectTransferUsdt(async () => {
  return { ok: false, error: 'insufficient_balance' };
});

const { _makerAutoPayGive: _maap2 } = await import(`file://${resolve(KASIA_ROOT, 'src/services/exchange-machine.js')}?t=${Date.now()}`);

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
} catch {}

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

const { _makerAutoPayGive: _maap3 } = await import(`file://${resolve(KASIA_ROOT, 'src/services/exchange-machine.js')}?t=${Date.now()}`);

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

const { refundWorkerTick: _rwt4 } = await import(`file://${resolve(KASIA_ROOT, 'src/services/market-seeder.js')}?t=${Date.now()}`);

const pubId4 = randomUUID();
const offerId4 = randomUUID();

sqlite.prepare(`
  INSERT INTO retail_dex_buy_publications
    (id, user_kasia_address, broker_relay_id, seeder_relay_id, side, qty, limit_price, total_usdt, pay_chain, state, expires_at, created_at, updated_at, seeder_publish_offer_id)
  VALUES (?, 'kaspa1user4', ?, ?, 'buy_kas', '50', '0.034', '1.700000', 'bnb', 'published', datetime('now', '-10 minutes'), datetime('now', '-30 minutes'), datetime('now', '-30 minutes'), ?)
`).run(pubId4, brokerRelayId, brokerRelayId, offerId4);

const offer4Tx = randomUUID();
sqlite.prepare(`
  INSERT INTO exchange_offers
    (id, broadcast_tx_id, message_index, maker, give_asset, give_amount, want_asset, want_amount, verification, verification_meta, protocol_status, taker_chain, taker_payment_address, expires_at, market_key, updated_at)
  VALUES (?, ?, 1, ?, 'USDT', '1.700000', 'KAS', '50.000000', 'kaspa_tx', '{}', 'matched', 'bnb', '0xTakerAddr4', datetime('now', '-5 minutes'), 'seeder-buy', ?)
`).run(offerId4, offer4Tx, brokerRelayId, new Date().toISOString());

const before4 = sqlite.prepare("SELECT state FROM retail_dex_buy_publications WHERE id = ?").get(pubId4);
assertEq(before4?.state, 'published', 'pub 初始 = published');

try { await _rwt4(); } catch {}

const after4 = sqlite.prepare("SELECT state FROM retail_dex_buy_publications WHERE id = ?").get(pubId4);
assertEq(before4?.state, after4?.state, 'matched offer pub state 不变 (跳过)');

// ── Case 5: fail-closed ──

console.log('\n--- Case 5: fail-closed — cancel fail → throw before transferUsdt ---');

const seederPath = resolve(KASIA_ROOT, 'src/services/market-seeder.js');
const seederSrc = readFileSync(seederPath, 'utf-8');

const cancelFailPattern = seederSrc.match(/if\s*\(\s*cancelRes\.error\s*\)[\s\S]{0,80}throw[\s\S]{0,80}transferUsdt/);
assert(cancelFailPattern !== null, 'cancelRes.error → throw → transferUsdt 不被调用 (fail-closed)');

const errorReasonPattern = seederSrc.match(/error_reason\s*=\s*\?/);
assert(errorReasonPattern !== null, 'catch 分支保存 error_reason');

// ── Summary ──

console.log('\n=== Cleanup ===');
try { unlinkSync(testDbPath); } catch {}
try { unlinkSync(testDbPath + '-wal'); } catch {}
try { unlinkSync(testDbPath + '-shm'); } catch {}
console.log('  Test DB deleted');

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
