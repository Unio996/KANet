// smoke-t5b-quick.mjs — 快速行为验证
// 策略: 直接用 mock 覆盖 _transferUsdtOverride，绕过 wallet 查询
// 关键修复: 测试脚本的 _transferUsdtOverride 注入点在模块加载后，
//           但 _makerAutoPayGive 内部先查 wallet，wallet 不存在就直接 return 了，
//           根本走不到 transferUsdt。所以 mock 没用。
// 真正问题: agent_wallets 表的 wallet 查询返回 null → 代码在 getTransferUsdt() 之前就 return。

import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync, copyFileSync, unlinkSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KASIA_ROOT = resolve(__dirname, '..');
const prodDb = resolve(KASIA_ROOT, 'data/console.db');
const testDb = resolve(KASIA_ROOT, 'data/console.test-t5b.db');
const betterSqlite3 = (await import('better-sqlite3')).default;

// ── Setup: copy prod → test, insert wallet ──
if (!existsSync(prodDb)) { console.error('No prod DB'); process.exit(1); }
if (existsSync(testDb)) unlinkSync(testDb);
copyFileSync(prodDb, testDb);

const td = new betterSqlite3(testDb);
const brokerId = '5b236c08-03d0-456c-953d-e10001610938';

// Check columns
const cols = td.pragma('table_info(agent_wallets)').map(c => c.name);
console.log('agent_wallets columns:', cols.join(', '));

// Check what's actually there
const allWallets = td.prepare("SELECT id, relay_node_id, chain, address, privkey_encrypted, is_default FROM agent_wallets").all();
console.log('Total wallets:', allWallets.length);
for (const w of allWallets) {
  console.log('  id=' + w.id.slice(0,8) + ' relay=' + (w.relay_node_id?.slice(0,8)||'NULL') + ' chain=' + w.chain + ' pk=' + (w.privkey_encrypted ? 'SET' : 'NULL') + ' is_default=' + w.is_default);
}

// Set wallet for broker relay
const existing = td.prepare("SELECT id FROM agent_wallets WHERE relay_node_id=? AND chain='bnb' AND is_default=1 LIMIT 1").get(brokerId);
if (existing) {
  console.log('\nFound broker wallet:', existing.id.slice(0,8));
  console.log('  Before: pk=' + (td.prepare("SELECT privkey_encrypted FROM agent_wallets WHERE id=?").get(existing.id)?.privkey_encrypted || 'NULL'));
  td.prepare("UPDATE agent_wallets SET privkey_encrypted='fake_encrypted_pk_for_test_000000' WHERE id=?").run(existing.id);
  const after = td.prepare("SELECT privkey_encrypted FROM agent_wallets WHERE id=?").get(existing.id);
  console.log('  After: pk=' + (after?.privkey_encrypted || 'NULL'));
} else {
  console.log('\nNo broker wallet found — will create one');
  try {
    td.prepare("INSERT INTO agent_wallets (id,relay_node_id,chain,address,is_default,privkey_encrypted,created_at,updated_at) VALUES (?,?,?,?,1,'fake_encrypted_pk_for_test_000000',datetime('now'),datetime('now'))")
      .run(randomUUID(), brokerId, 'bnb', '0xTestBroker');
    const verify = td.prepare("SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id=? AND chain='bnb' LIMIT 1").get(brokerId);
    console.log('  Created wallet, pk=' + (verify?.privkey_encrypted || 'NULL'));
  } catch (e) {
    console.log('  INSERT failed:', e.message);
  }
}

// Checkpoint to flush WAL
td.pragma('wal_checkpoint(TRUNCATE)');
const finalCheck = td.prepare("SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id=? AND chain='bnb' LIMIT 1").get(brokerId);
console.log('After checkpoint: pk=' + (finalCheck?.privkey_encrypted || 'NULL'));
td.close();

// Re-open to verify
const td2 = new betterSqlite3(testDb);
const verify = td2.prepare("SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id=? AND chain='bnb' LIMIT 1").get(brokerId);
console.log('Re-open verify: pk=' + (verify?.privkey_encrypted || 'NULL'));
td2.close();

// ── Switch DB_PATH ──
process.env.DB_PATH = testDb;

console.log('\n  DB_PATH=' + testDb);

const { sqlite } = await import(`file://${resolve(KASIA_ROOT, 'src/db/client.js')}`);

const modWallet = sqlite.prepare("SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id=? AND chain='bnb' LIMIT 1").get(brokerId);
console.log('  Module sees wallet: pk=' + (modWallet?.privkey_encrypted || 'NULL'));

if (!modWallet?.privkey_encrypted) {
  console.log('  *** Wallet not visible to module! ***');
  // Check what the module actually loaded
  const rows = sqlite.prepare("SELECT COUNT(*) as c FROM retail_dex_buy_publications").get();
  console.log('  retail_dex_buy_publications count:', rows.c);
  process.exit(1);
}

console.log('  *** Wallet OK ***');

const { _makerAutoPayGive, _testInjectTransferUsdt, _testResetTransferUsdt } = await import(`file://${resolve(KASIA_ROOT, 'src/services/exchange-machine.js')}?t=${Date.now()}`);
_testInjectTransferUsdt(async () => ({ ok: true, txHash: '0xSuccessTx123' }));

let passed = 0, failed = 0;
function assert(c, l) { if (c) { console.log('  PASS: ' + l); passed++; } else { console.log('  FAIL: ' + l); failed++; } }
function assertEq(a, b, l) { assert(String(a)==String(b), l + ': exp "' + String(b) + '" got "' + String(a) + '"'); }

// ── Case 1: _makerAutoPayGive 成功 → completed ──
console.log('\n--- Case 1: _makerAutoPayGive 成功 → completed ---');
const pubId1 = randomUUID();
const offerId1 = randomUUID();
sqlite.prepare("INSERT INTO retail_dex_buy_publications (id,user_kasia_address,broker_relay_id,seeder_relay_id,side,qty,limit_price,total_usdt,pay_chain,state,expires_at,created_at,updated_at,seeder_publish_offer_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
  .run(pubId1, 'kaspa1u', brokerId, brokerId, 'buy_kas', '50', '0.034', '1.70', 'bnb', 'filled', 'now', 'now', 'now', offerId1);
await _makerAutoPayGive({ id: offerId1, give_asset: 'USDT', give_chain: 'bnb', maker: brokerId, taker_payment_address: '0xTaker' });
const a1 = sqlite.prepare("SELECT state, filled_at, kas_delivery_tx FROM retail_dex_buy_publications WHERE id=?").get(pubId1);
assertEq(a1?.state, 'completed', 'pub state → completed');
assert(a1?.filled_at !== null, 'filled_at set');
assertEq(a1?.kas_delivery_tx, '0xSuccessTx123', 'kas_delivery_tx = txHash');

// ── Case 2: 失败 → failed ──
console.log('\n--- Case 2: 失败 → failed ---');
_testResetTransferUsdt();
const { _makerAutoPayGive: maap2 } = await import(`file://${resolve(KASIA_ROOT, 'src/services/exchange-machine.js')}?t=${Date.now()}`);
_testInjectTransferUsdt(async () => ({ ok: false, error: 'insufficient_balance' }));
const pubId2 = randomUUID();
const offerId2 = randomUUID();
sqlite.prepare("INSERT INTO retail_dex_buy_publications (id,user_kasia_address,broker_relay_id,seeder_relay_id,side,qty,limit_price,total_usdt,pay_chain,state,expires_at,created_at,updated_at,seeder_publish_offer_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
  .run(pubId2, 'kaspa1u', brokerId, brokerId, 'buy_kas', '50', '0.034', '2.00', 'bnb', 'filled', 'now', 'now', 'now', offerId2);
try { await maap2({ id: offerId2, give_asset: 'USDT', give_chain: 'bnb', maker: brokerId, taker_payment_address: '0xTaker' }); } catch {}
const a2 = sqlite.prepare("SELECT state, error_reason FROM retail_dex_buy_publications WHERE id=?").get(pubId2);
assertEq(a2?.state, 'failed', 'pub state → failed');
assert(a2?.error_reason?.includes('maker_auto_pay_failed'), 'error_reason contains maker_auto_pay_failed');

// ── Case 3: double pay guard ──
console.log('\n--- Case 3: double pay guard ---');
_testResetTransferUsdt();
let mockCalled = false;
const { _makerAutoPayGive: maap3 } = await import(`file://${resolve(KASIA_ROOT, 'src/services/exchange-machine.js')}?t=${Date.now()}`);
_testInjectTransferUsdt(async () => { mockCalled = true; return { ok: true, txHash: '0xnope' }; });
const pubId3 = randomUUID();
const offerId3 = randomUUID();
sqlite.prepare("INSERT INTO retail_dex_buy_publications (id,user_kasia_address,broker_relay_id,seeder_relay_id,side,qty,limit_price,total_usdt,pay_chain,state,expires_at,created_at,updated_at,seeder_publish_offer_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
  .run(pubId3, 'kaspa1u', brokerId, brokerId, 'buy_kas', '50', '0.034', '1.70', 'bnb', 'deposited', 'now', 'now', 'now', offerId3);
try { await maap3({ id: offerId3, give_asset: 'USDT', give_chain: 'bnb', maker: brokerId, taker_payment_address: '0xTaker' }); } catch {}
const a3 = sqlite.prepare("SELECT state FROM retail_dex_buy_publications WHERE id=?").get(pubId3);
assertEq(a3?.state, 'deposited', 'pub.state 不变');
assert(!mockCalled, 'transferUsdt 未调用');
_testResetTransferUsdt();

console.log(`\n=== Summary: ${passed}/${passed+failed} passed ===`);
try { unlinkSync(testDb); } catch {}
process.exit(failed > 0 ? 1 : 0);
