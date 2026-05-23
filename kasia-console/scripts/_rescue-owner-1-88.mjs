// 救 Owner 1.88 USDT 真测这单. 走系统 transfer endpoint + SQL 闭环.
// 不绕协议层完整数据 (双锚点: BSC USDT in + KAS out + chain_event).
//
// Bug 链: Owner DM '空不？我想买55个Kas' → broker LLM 调 finalize_order 创 3 个重复 offer (broker LLM bug B 重复 publish + bug A "已付!" 静默)
// fix 已 ship T-J2-26 (broker-buy-handler.js +25 LOC, smoke 8/9), 但**这单已经发生**, 需手动闭环.

import Database from 'better-sqlite3';
import crypto from 'crypto';

const OWNER          = 'kaspa:qqscw77lnjdjuafrjh8nz5hxlat83cehv0waauh40cmu09xhtnurgcqs3s588';
const BROKER_KASPA   = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const PRIMARY        = 'df688ee2-67ac-4fd7-8374-f5419c77d838';  // broker DM '订单已创建' 12:14:17 对应的 offer (12:14:13 创建)
const CANCEL         = [
  '1f34f454-0308-4bc1-bec1-861329db69e7',  // 12:13:09 (Owner '嗯' 后第一次误调 finalize_order)
  '43c0a4f8-72b5-4ef1-9bd4-b1d9a5f8e439',  // 12:15:45 (Owner '已付！' 后 LLM 误判第二次 finalize_order)
];
const PAYMENT_TX     = '0x2ac678562e09be650c6a41936c93f5496952331a038484297dbeeaa654c5ed2b';  // BSC USDT 真链上 1.8806 USDT 已确认
const PAYMENT_CHAIN  = 'bnb';
const PAYMENT_AMOUNT = '1.8806';

const db = new Database('C:/kanet/kasia-console/data/console.db');
const now = new Date().toISOString();

console.log('=== Owner 1.88 USDT 真测救援 (T-J2-26 + manual close) ===\n');

// ── Step 1: cancel 重复 offer + 释放 fund_locks ─────────────────
console.log('Step 1: cancel 重复 offer (释放 110 KAS lock)');
for (const id of CANCEL) {
  const r1 = db.prepare(`UPDATE exchange_offers SET protocol_status='cancelled', cancelled_at=?, updated_at=? WHERE id=? AND protocol_status='open'`).run(now, now, id);
  const r2 = db.prepare(`UPDATE fund_locks SET status='released', released_at=? WHERE order_id=? AND status='locked'`).run(now, id);
  console.log(`  ✓ ${id.slice(0,8)}: offer ${r1.changes}行, lock ${r2.changes}行`);
}

db.close();

// ── Step 2: broker transfer 55 KAS to Owner via console endpoint ─
console.log('\nStep 2: broker transfer 55 KAS → Owner Kasia via /api/relay/.../transfer');
const tr = await fetch(`http://127.0.0.1:3100/api/relay/${BROKER_RELAY_ID}/transfer`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to: OWNER, amount: 55 }),
});
const trJson = await tr.json();
console.log('  transfer response:', trJson);
if (!trJson.ok || !trJson.txId) {
  console.error('\n❌ TRANSFER FAILED. SQL state not updated to keep consistent. Investigate before retry.');
  process.exit(1);
}
const KAS_TX = trJson.txId;
console.log(`  ✓ KAS tx: ${KAS_TX}`);

// ── Step 3: 标记 primary offer completed (SQL, 双锚点) ───────────
console.log('\nStep 3: SQL 标记 primary offer completed (BSC USDT in + KAS out)');
const db2 = new Database('C:/kanet/kasia-console/data/console.db');
const offer = db2.prepare('SELECT verification_meta FROM exchange_offers WHERE id=?').get(PRIMARY);
const meta = JSON.parse(offer?.verification_meta || '{}');
meta.verified_tx = PAYMENT_TX;
meta.verified_at = now;
meta.recovery_note = 'J2 manual rescue 2026-04-26 12:5x. Owner real test撞 broker LLM bug A (静默) + bug B (重复 publish). T-J2-26 已 fix, 这单是 fix 前发生, 手动闭环. Owner USDT 1.8806 → broker BSC tx 0x2ac678 (链上确认), broker KAS 55 → Owner Kasia tx ' + KAS_TX;

db2.prepare(`UPDATE exchange_offers SET
  taker=?, taker_chain=?, taker_payment_address=?,
  payment_tx=?, delivery_tx=?,
  protocol_status='completed',
  matched_at=?, verifying_started_at=?, delivering_at=?, completed_at=?,
  verification_meta=?, updated_at=?
  WHERE id=?`)
  .run(OWNER, PAYMENT_CHAIN, '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D',
    PAYMENT_TX, KAS_TX,
    now, now, now, now,
    JSON.stringify(meta), now,
    PRIMARY);
console.log(`  ✓ offer ${PRIMARY.slice(0,8)} → completed`);

// fund_lock primary: locked → spent (broker 真出了 55 KAS)
const r3 = db2.prepare(`UPDATE fund_locks SET status='spent', released_at=? WHERE order_id=? AND status='locked'`).run(now, PRIMARY);
console.log(`  ✓ fund_lock 'spent' ${r3.changes}行`);

// ── Step 4: chain_event exchange_completed (协议层数据完整) ──────
console.log('\nStep 4: chain_event exchange_completed (审计 + 协议数据完整)');
db2.prepare(`INSERT INTO chain_events (id, txid, from_address, to_address, event_type, payload, observed_by, observed_at)
  VALUES (?, ?, ?, ?, 'exchange_completed', ?, ?, ?)`)
  .run(crypto.randomUUID(), KAS_TX, BROKER_KASPA, OWNER,
    JSON.stringify({
      offer_id: PRIMARY,
      give_asset: 'KAS',  give_amount: '55',
      want_asset: 'USDT', want_amount: PAYMENT_AMOUNT,
      payment_tx: PAYMENT_TX, payment_chain: PAYMENT_CHAIN,
      delivery_tx: KAS_TX, delivery_chain: 'kaspa',
      verification: 'cross_chain_tx_manual_recovery',
      recovery_by: 'J2_T-J2-26_rescue',
      bug_context: 'broker LLM bug A (已付! 静默) + bug B (重复 publish 3 单). T-J2-26 ship 后新单不会撞.',
    }),
    'rescue_j2_2026-04-26', now);
console.log(`  ✓ chain_event inserted`);

db2.close();

console.log('\n=== ✅ RESCUE COMPLETE ===');
console.log(`USDT 1.8806 BSC: Owner 0x1417c... → broker 0xaD125... (tx ${PAYMENT_TX.slice(0,18)}...)`);
console.log(`KAS  55       : broker → Owner ${OWNER.slice(-12)} (tx ${KAS_TX})`);
console.log(`offer        : ${PRIMARY.slice(0,8)} completed`);
console.log(`重复 offers   : ${CANCEL.map(c=>c.slice(0,8)).join(', ')} cancelled (110 KAS 释放)`);
console.log(`查 Kasia explorer: https://explorer.kaspa.org/txs/${KAS_TX}`);
console.log(`查 BSC explorer:   https://bscscan.com/tx/${PAYMENT_TX}`);
