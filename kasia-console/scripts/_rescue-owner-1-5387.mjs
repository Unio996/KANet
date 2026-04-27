// 救 Owner 1.5387 USDT 第 2 次真测 (15:30). 复用 1-88 范式.
// Bug 链: broker 这次 PAID_NO_TX 截胡 work, 但 Owner '我不太好查请你们自己处理' →
// broker LLM 仍坚持要 tx hash (因为 tools 没给链查能力). 这是 v1 限制 — broker 没把
// BSC RPC 反查 wire 进 LLM tools. v1.1 任务: cross-chain auto-scan tool 给 LLM.

import Database from 'better-sqlite3';
import crypto from 'crypto';

const OWNER          = 'kaspa:qqscw77lnjdjuafrjh8nz5hxlat83cehv0waauh40cmu09xhtnurgcqs3s588';
const BROKER_KASPA   = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const PRIMARY        = '232dd9c8-e56e-4bcd-9754-7a1e9ccf8a81';
const PAYMENT_TX     = '0x557be21aabb59ec272260aca710661259e076f9cf0d9ba63eb9c60b6ad165d83';
const PAYMENT_CHAIN  = 'bnb';
const PAYMENT_AMOUNT = '1.5387';
const KAS_AMOUNT     = 45;

const db = new Database('C:/kanet/kasia-console/data/console.db');
const now = new Date().toISOString();

console.log('=== Owner 1.5387 USDT 真测 #2 救援 (NWT 接位时) ===\n');

// Step 1: broker transfer 45 KAS via console endpoint
console.log(`Step 1: broker transfer ${KAS_AMOUNT} KAS → Owner Kasia`);
const tr = await fetch(`http://127.0.0.1:3100/api/relay/${BROKER_RELAY_ID}/transfer`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to: OWNER, amount: KAS_AMOUNT }),
});
const trJson = await tr.json();
console.log('  transfer response:', trJson);
if (!trJson.ok || !trJson.txId) {
  console.error('\n❌ TRANSFER FAILED. SQL not updated.');
  process.exit(1);
}
const KAS_TX = trJson.txId;
console.log(`  ✓ KAS tx: ${KAS_TX}`);

// Step 2: mark offer completed (SQL, 双锚点)
console.log('\nStep 2: SQL 标记 offer completed');
const offer = db.prepare('SELECT verification_meta FROM exchange_offers WHERE id=?').get(PRIMARY);
const meta = JSON.parse(offer?.verification_meta || '{}');
meta.verified_tx = PAYMENT_TX;
meta.verified_at = now;
meta.recovery_note = 'J2 manual rescue 2026-04-26 15:31 (Owner 真测 #2). Owner "已经支付" PAID_NO_TX 截胡 OK 但 "我不太好查请你们自己处理" — broker LLM 没 BSC 链查 tool, 让用户手贴 tx hash 反人类. v1.1 任务: cross-chain auto-scan tool. 此单走 manual rescue 同 1-88. Payment in: ' + PAYMENT_TX + ' BSC USDT ' + PAYMENT_AMOUNT;

db.prepare(`UPDATE exchange_offers SET
  taker=?, taker_chain=?, taker_payment_address='0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D',
  payment_tx=?, delivery_tx=?,
  protocol_status='completed',
  matched_at=?, verifying_started_at=?, delivering_at=?, completed_at=?,
  verification_meta=?, updated_at=?
  WHERE id=?`)
  .run(OWNER, PAYMENT_CHAIN, PAYMENT_TX, KAS_TX, now, now, now, now, JSON.stringify(meta), now, PRIMARY);
console.log(`  ✓ offer ${PRIMARY.slice(0,8)} → completed`);

const r3 = db.prepare(`UPDATE fund_locks SET status='spent', released_at=? WHERE order_id=? AND status='locked'`).run(now, PRIMARY);
console.log(`  ✓ fund_lock 'spent' ${r3.changes}行`);

// Step 3: chain_event audit
console.log('\nStep 3: chain_event exchange_completed');
db.prepare(`INSERT INTO chain_events (id, txid, from_address, to_address, event_type, payload, observed_by, observed_at)
  VALUES (?, ?, ?, ?, 'exchange_completed', ?, ?, ?)`)
  .run(crypto.randomUUID(), KAS_TX, BROKER_KASPA, OWNER,
    JSON.stringify({
      offer_id: PRIMARY,
      give_asset: 'KAS',  give_amount: String(KAS_AMOUNT),
      want_asset: 'USDT', want_amount: PAYMENT_AMOUNT,
      payment_tx: PAYMENT_TX, payment_chain: PAYMENT_CHAIN,
      delivery_tx: KAS_TX, delivery_chain: 'kaspa',
      verification: 'cross_chain_tx_manual_recovery_v2',
      recovery_by: 'J2_owner_real_test_2_2026-04-26',
      bug_context: 'broker LLM 没链查 tool, Owner 拒手贴 tx hash 合理. v1.1 加 cross-chain auto-scan.',
    }),
    'rescue_j2_2026-04-26', now);
console.log(`  ✓ chain_event inserted`);

db.close();

console.log('\n=== ✅ RESCUE #2 COMPLETE ===');
console.log(`USDT ${PAYMENT_AMOUNT} BSC: Owner 0x1417c... → broker 0xaD125... (tx ${PAYMENT_TX.slice(0,18)}...)`);
console.log(`KAS  ${KAS_AMOUNT}        : broker → Owner (tx ${KAS_TX})`);
console.log(`查 Kasia explorer: https://explorer.kaspa.org/txs/${KAS_TX}`);
console.log(`查 BSC explorer:   https://bscscan.com/tx/${PAYMENT_TX}`);
