// 救 Owner 1.9738 USDT 真测 #5 (14:00+).
// 真因: LLM 没真调 finalize_order tool (user "Yes" 后 broker 没创订单, offer 留 'open' + taker null)
// USDT 真到 broker BSC 但 broker 没发 KAS. 跟 #1 #2 同模式手动闭环.

import Database from 'better-sqlite3';
import crypto from 'crypto';

const OWNER          = 'kaspa:qqscw77lnjdjuafrjh8nz5hxlat83cehv0waauh40cmu09xhtnurgcqs3s588';
const BROKER_KASPA   = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const PRIMARY        = 'a34701fe-5b34-4774-80e4-68a3781774a4';
const PAYMENT_TX     = '0xad6e97d4e82bdc76fd6bffea8c1428cba0df120fe7d08cbce8e2dff8e414ae57';
const PAYMENT_CHAIN  = 'bnb';
const PAYMENT_AMOUNT = '1.9738';
const KAS_AMOUNT     = 58;

const db = new Database('C:/kanet/kasia-console/data/console.db');
const now = new Date().toISOString();

console.log('=== Owner 1.9738 USDT 真测 #5 救援 (LLM 没调 finalize_order) ===\n');

// Step 1: broker transfer 58 KAS via console endpoint
console.log(`Step 1: broker transfer ${KAS_AMOUNT} KAS → Owner Kasia`);
const tr = await fetch(`http://127.0.0.1:3100/api/relay/${BROKER_RELAY_ID}/transfer`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to: OWNER, amount: KAS_AMOUNT }),
});
const trJson = await tr.json();
console.log('  transfer response:', trJson);
if (!trJson.ok || !trJson.txId) {
  console.error('\n❌ TRANSFER FAILED.');
  process.exit(1);
}
const KAS_TX = trJson.txId;
console.log(`  ✓ KAS tx: ${KAS_TX}`);

// Step 2: mark offer completed
console.log('\nStep 2: SQL 标记 offer completed');
const offer = db.prepare('SELECT verification_meta FROM exchange_offers WHERE id=?').get(PRIMARY);
const meta = JSON.parse(offer?.verification_meta || '{}');
meta.verified_tx = PAYMENT_TX;
meta.verified_at = now;
meta.recovery_note = 'J2 manual rescue 2026-04-26 14:0X (Owner 真测 #5). LLM 没真调 finalize_order tool — user Yes 后 broker 没创订单 offer 留 open + taker null. bsc-watcher 真 detect USDT 1.9738 但 paid_v1 撞 invalid_status (offer 不 matched). 真因: history polluted LLM 跳过 tool. v1.1 ORDER_PROFILE 真根治. 此单走 manual rescue, payment_tx ' + PAYMENT_TX + ', broker 真发 KAS ' + KAS_TX;

db.prepare(`UPDATE exchange_offers SET
  taker=?, taker_chain='bnb', taker_payment_address='0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D',
  payment_tx=?, delivery_tx=?,
  protocol_status='completed',
  matched_at=?, verifying_started_at=?, delivering_at=?, completed_at=?,
  verification_meta=?, updated_at=?
  WHERE id=?`)
  .run(OWNER, PAYMENT_TX, KAS_TX, now, now, now, now, JSON.stringify(meta), now, PRIMARY);
console.log(`  ✓ offer ${PRIMARY.slice(0,8)} → completed`);

const r3 = db.prepare(`UPDATE fund_locks SET status='spent', released_at=? WHERE order_id=? AND status='locked'`).run(now, PRIMARY);
console.log(`  ✓ fund_lock 'spent' ${r3.changes}行`);

// Step 3: chain_event audit
db.prepare(`INSERT INTO chain_events (id, txid, from_address, to_address, event_type, payload, observed_by, observed_at)
  VALUES (?, ?, ?, ?, 'exchange_completed', ?, ?, ?)`)
  .run(crypto.randomUUID(), KAS_TX, BROKER_KASPA, OWNER,
    JSON.stringify({
      offer_id: PRIMARY,
      give_asset: 'KAS',  give_amount: String(KAS_AMOUNT),
      want_asset: 'USDT', want_amount: PAYMENT_AMOUNT,
      payment_tx: PAYMENT_TX, payment_chain: PAYMENT_CHAIN,
      delivery_tx: KAS_TX, delivery_chain: 'kaspa',
      verification: 'cross_chain_tx_manual_recovery_v3',
      recovery_by: 'J2_owner_real_test_5_2026-04-26',
      bug_context: 'LLM 没真调 finalize_order tool, offer 留 open. bsc-watcher detect USDT 但 processPaymentSubmit 拒 (invalid_status). v1.1 ORDER_PROFILE 真根治.',
    }),
    'rescue_j2_2026-04-26', now);
console.log(`  ✓ chain_event inserted`);

db.close();

console.log('\n=== ✅ RESCUE #5 COMPLETE ===');
console.log(`USDT ${PAYMENT_AMOUNT} BSC: 0x1417c... → broker 0xaD125... (tx ${PAYMENT_TX.slice(0,18)}...)`);
console.log(`KAS  ${KAS_AMOUNT}        : broker → Owner ${OWNER.slice(-12)} (tx ${KAS_TX})`);
console.log(`查 Kasia: https://explorer.kaspa.org/txs/${KAS_TX}`);
console.log(`查 BSC:   https://bscscan.com/tx/${PAYMENT_TX}`);
