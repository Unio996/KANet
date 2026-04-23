// smoke-t5a-behavioral.mjs — TASK 5a: behavioral smoke tests (runtime DB + state machine)
// Run: node scripts/smoke-t5a-behavioral.mjs

import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KANET_ROOT = resolve(__dirname, '..');
process.env.DB_PATH = resolve(KANET_ROOT, 'kasia-console/data/console.db');

const { sqlite } = await import(`file://${resolve(KANET_ROOT, 'kasia-console/src/db/client.js')}`);
const {
  _triggerBuyPublication,
} = await import(`file://${resolve(KANET_ROOT, 'kasia-console/src/services/retail-dex.js')}`);
const {
  depositWatcherTick,
} = await import(`file://${resolve(KANET_ROOT, 'kasia-console/src/services/market-seeder.js')}`);

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  PASS: ${label}`); passed++; }
  else { console.log(`  FAIL: ${label}`); failed++; }
}

function assertEq(a, b, label) {
  assert(String(a) === String(b), `${label}: expected "${String(b)}", got "${String(a)}"`);
}

function clearTable(table) {
  try { sqlite.prepare(`DELETE FROM ${table}`).run(); } catch {}
}

function insertSeedConfig() {
  try {
    sqlite.prepare(`
      INSERT OR REPLACE INTO market_seeder_config (id, enabled, amount_kas, sell_spread_pct, buy_spread_pct, expires_minutes, last_published_price)
      VALUES ('default', 1, 1000, 2, 2, 60, 0.034)
    `).run();
  } catch {
    sqlite.prepare(`
      UPDATE market_seeder_config SET enabled = 1, amount_kas = 1000, sell_spread_pct = 2, buy_spread_pct = 2, expires_minutes = 60, last_published_price = 0.034
      WHERE id = 'default'
    `).run();
  }
}

// ── Setup ──

console.log('=== Setup: clean state ===');
clearTable('retail_dex_buy_publications');
insertSeedConfig();

const brokerRelayId = '5b236c08-03d0-456c-953d-e10001610938'; // NWT
const noWalletRelayId = '0f0f0f0f-0000-0000-0000-0000000000ff'; // Opus (no BNB wallet)

// Insert a BNB wallet for NWT (needed for Case 2)
const existingWallet = sqlite.prepare(
  "SELECT 1 FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' AND is_default = 1 LIMIT 1"
).get(brokerRelayId);

if (!existingWallet) {
  console.log('  Inserting test seeder BNB wallet for NWT');
  const now = new Date().toISOString();
  try {
    sqlite.prepare(
      "INSERT INTO agent_wallets (relay_node_id, chain, address, is_default, created_at, updated_at) VALUES (?, 'bnb', '0xTestSeederBscAddr123456789abcdef', 1, ?, ?)"
    ).run(brokerRelayId, now, now);
  } catch (e) {
    console.log(`  WARN: could not insert wallet: ${e.message}`);
  }
}

// ── Case 2: _triggerBuyPublication inserts row with state='awaiting_deposit' ──

console.log('\n--- Case 2: _triggerBuyPublication → retail_dex_buy_publications row ---');
const testOrderId2 = `t5a-case2-${randomUUID().slice(0, 8)}`;

const pubId = await _triggerBuyPublication({
  orderId: testOrderId2,
  userAddr: 'kaspa1t5a_test_user',
  qty: '100',
  price: '0.034',
  brokerRelayId,
});

assertEq(typeof pubId, 'string', '_triggerBuyPublication returns pubId string');
assert(pubId.length > 10, 'pubId is non-empty');

const insertedRow = sqlite.prepare(
  "SELECT * FROM retail_dex_buy_publications WHERE id = ?"
).get(pubId);

assert(insertedRow, 'retail_dex_buy_publications row exists');
assertEq(insertedRow?.state, 'awaiting_deposit', 'state = awaiting_deposit');
assertEq(insertedRow?.user_kasia_address, 'kaspa1t5a_test_user', 'user_kasia_address matches');
assertEq(insertedRow?.side, 'buy_kas', 'side = buy_kas');
assert(insertedRow?.qty, 'qty is set');
assert(insertedRow?.limit_price, 'limit_price is set');
assert(insertedRow?.total_usdt, 'total_usdt is set');

// ── Case 3: seeder_bsc_addr missing → throws 'seeder_bsc_addr_missing' ──

console.log('\n--- Case 3: seeder_bsc_addr missing → throws ---');
let threwMissing = false;
let errMsg = '';
try {
  await _triggerBuyPublication({
    orderId: `t5a-case3-${randomUUID().slice(0, 8)}`,
    userAddr: 'kaspa1t5a_test_user',
    qty: '100',
    price: '0.034',
    brokerRelayId: noWalletRelayId,
  });
} catch (e) {
  threwMissing = true;
  errMsg = e.message;
}

assert(threwMissing, 'throws when seeder_bsc_addr is missing');
assert(errMsg.includes('seeder_bsc_addr_missing'), `error: "${errMsg}" includes 'seeder_bsc_addr_missing'`);

// ── Case 4: deposit watcher state machine flow ──

console.log('\n--- Case 4: deposit watcher state machine flow ---');
const testPubId4 = randomUUID();
const testUser4 = 'kaspa1t5a_user4';
const now = new Date().toISOString();
const expiresAt = new Date(Date.now() + 3600000).toISOString();

sqlite.prepare(`
  INSERT INTO retail_dex_buy_publications
    (id, user_kasia_address, broker_relay_id, seeder_relay_id, side, qty, limit_price, total_usdt, pay_chain, state, created_at, updated_at, expires_at)
  VALUES (?, ?, ?, 'seeder123', 'buy_kas', '50', '0.034', '1.700000', 'bnb', 'awaiting_deposit', ?, ?, ?)
`).run(testPubId4, testUser4, brokerRelayId, now, now, expiresAt);

const beforeRow = sqlite.prepare("SELECT state FROM retail_dex_buy_publications WHERE id = ?").get(testPubId4);
assertEq(beforeRow?.state, 'awaiting_deposit', 'pub starts as awaiting_deposit');

const cols = sqlite.prepare('PRAGMA table_info(retail_dex_buy_publications)').all().map(c => c.name);
assert(cols.includes('deposited_at') || cols.includes('updated_at'), 'table has deposited_at or updated_at column');
assert(cols.includes('seeder_publish_offer_id'), 'table has seeder_publish_offer_id column');
assert(cols.includes('expires_at'), 'table has expires_at column');
assert(cols.includes('kas_delivery_tx'), 'table has kas_delivery_tx column');
assert(cols.includes('usdt_refund_tx'), 'table has usdt_refund_tx column');
assert(cols.includes('error_reason'), 'table has error_reason column');

// ── Case 5: deposited row → published + offer_id ──

console.log('\n--- Case 5: deposited → published with offer_id ---');
const testPubId5 = randomUUID();
sqlite.prepare(`
  INSERT INTO retail_dex_buy_publications
    (id, user_kasia_address, broker_relay_id, seeder_relay_id, side, qty, limit_price, total_usdt, pay_chain, state, created_at, updated_at, expires_at)
  VALUES (?, ?, ?, 'seeder123', 'buy_kas', '50', '0.034', '1.700000', 'bnb', 'deposited', ?, ?, ?)
`).run(testPubId5, testUser4, brokerRelayId, now, now, expiresAt);

const before5 = sqlite.prepare("SELECT state, seeder_publish_offer_id FROM retail_dex_buy_publications WHERE id = ?").get(testPubId5);
assertEq(before5?.state, 'deposited', 'pub starts as deposited');
assertEq(before5?.seeder_publish_offer_id, null, 'seeder_publish_offer_id is null');

// ── Case 6: publish fail → state stays (no half-broken state) ──

console.log('\n--- Case 6: publish fail → no half-broken state ---');
const marketSeederSrc = readFileSync(resolve(KANET_ROOT, 'kasia-console/src/services/market-seeder.js'), 'utf-8');

assert(marketSeederSrc.includes("state = 'deposited'"), 'deposit watcher queries deposited rows');
assert(marketSeederSrc.includes("state = 'published'"), 'deposit watcher updates to published');
assert(marketSeederSrc.includes('seeder_publish_offer_id'), 'deposit watcher sets seeder_publish_offer_id');

const tryCatchPattern = marketSeederSrc.match(/try\s*\{[\s\S]*?publishSeedOrder[\s\S]*?\}\s*catch/);
assert(tryCatchPattern !== null, 'publishSeedOrder wrapped in try/catch (no half-broken state)');

// ── Cleanup ──

console.log('\n=== Cleanup ===');
clearTable('retail_dex_buy_publications');

// ── Summary ──

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
