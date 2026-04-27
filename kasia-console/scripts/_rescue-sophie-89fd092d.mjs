// J2 #3 manual rescue offer 89fd092d (J1 真测 dispute, Sophie underpayment 12%)
// 严标准: broker 真发等比例 KAS = (0.03/0.0342) × 1 = 0.877 KAS, 不慷慨送 1 KAS
// J1 underpayment 0.123 KAS 自吃 (Owner 钦点不慷慨, 真测代价归发起方)

import Database from 'better-sqlite3';
import crypto from 'crypto';

const SOPHIE         = 'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp';
const BROKER_KASPA   = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const OFFER_ID       = '89fd092d-1717-4af5-a34b-398f4cbb3dec';
const PAYMENT_TX     = '0xf8f2e76e65505b0f4e573f53cc26527ed91d6775a088a2af436516911e7adbbf';
const PAYMENT_CHAIN  = 'bnb';
const PAYMENT_AMOUNT = '0.03';   // J1 真转 (NWT 22:21 broker.log 真 grep 实证)
const EXPECTED_USDT  = '0.0342'; // broker 期望 (1 KAS × 0.0342 单价)
// 严比例: 0.03 / 0.0342 = 0.877192...
const KAS_AMOUNT     = +(0.03 / 0.0342).toFixed(6);  // 0.877193

console.log(`=== J2 #3 manual rescue 89fd092d (J1 真测 dispute) ===`);
console.log(`Sophie payment: ${PAYMENT_AMOUNT} USDT (BSC tx ${PAYMENT_TX.slice(0,18)}...)`);
console.log(`broker expected: ${EXPECTED_USDT} USDT (underpayment 12.3%, broker auto-dispute correct)`);
console.log(`严标准 rescue: broker 真发 ${KAS_AMOUNT} KAS (= ${PAYMENT_AMOUNT}/${EXPECTED_USDT} × 1) → Sophie`);
console.log(`broker zero-loss, J1 underpayment 0.123 KAS 自吃\n`);

const db = new Database('C:/kanet/kasia-console/data/console.db');
const now = new Date().toISOString();

// Step 1: broker transfer 0.877 KAS to Sophie via console endpoint
console.log(`Step 1: broker → Sophie ${KAS_AMOUNT} KAS`);
const tr = await fetch(`http://127.0.0.1:3100/api/relay/${BROKER_RELAY_ID}/transfer`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to: SOPHIE, amount: KAS_AMOUNT }),
});
const trJson = await tr.json();
console.log('  transfer response:', trJson);
if (!trJson.ok || !trJson.txId) {
  console.error('\n❌ TRANSFER FAILED.');
  process.exit(1);
}
const KAS_TX = trJson.txId;
console.log(`  ✓ KAS tx: ${KAS_TX}`);

// Step 2: SQL UPDATE offer 89fd092d → 'completed' (from 'disputed')
console.log('\nStep 2: SQL UPDATE 89fd092d disputed → completed');
const offer = db.prepare('SELECT verification_meta FROM exchange_offers WHERE id=?').get(OFFER_ID);
const meta = JSON.parse(offer?.verification_meta || '{}');
meta.rescue_kas_tx = KAS_TX;
meta.rescue_kas_amount = KAS_AMOUNT;
meta.rescue_at = now;
meta.rescue_note = `J2 #3 严标准 rescue 2026-04-26: J1 hardcode 0.03 USDT (期望 0.0342 underpayment 12.3% > 0.5% tolerance) → broker auto-dispute correct. Manual rescue: broker 真发等比例 ${KAS_AMOUNT} KAS to Sophie (0.03/0.0342 × 1). broker zero-loss. J1 真测代价 0.123 KAS underpayment 自吃 (Owner 钦点严标准不慷慨). NWT wire fix v3 (36087428d) 真生效 verified — step 1-4 全 wire 通, step 5 dispute 是 buyer underpayment 不是 broker bug.`;

db.prepare(`UPDATE exchange_offers SET
  delivery_tx=?,
  protocol_status='completed',
  delivering_at=?, completed_at=?,
  verification_meta=?, updated_at=?
  WHERE id=?`)
  .run(KAS_TX, now, now, JSON.stringify(meta), now, OFFER_ID);
console.log(`  ✓ offer ${OFFER_ID.slice(0,8)} disputed → completed`);

// Step 3: chain_event audit
db.prepare(`INSERT INTO chain_events (id, txid, from_address, to_address, event_type, payload, observed_by, observed_at)
  VALUES (?, ?, ?, ?, 'exchange_completed', ?, ?, ?)`)
  .run(crypto.randomUUID(), KAS_TX, BROKER_KASPA, SOPHIE,
    JSON.stringify({
      offer_id: OFFER_ID,
      give_asset: 'KAS',  give_amount: String(KAS_AMOUNT),
      want_asset: 'USDT', want_amount: PAYMENT_AMOUNT,
      payment_tx: PAYMENT_TX, payment_chain: PAYMENT_CHAIN,
      delivery_tx: KAS_TX, delivery_chain: 'kaspa',
      verification: 'manual_rescue_post_dispute_strict_proportion',
      recovery_by: 'J2_3_2026-04-26_J1_realtest_underpayment',
      bug_context: 'J1 真测 step 5 dispute, J1 hardcode 0.03 USDT vs broker 期望 0.0342, underpayment 12.3% broker auto-dispute correct. NWT wire fix v3 (36087428d) verified working. 严标准 rescue: broker 真发 0.877 KAS = 等比例, 不慷慨补 1 KAS.',
      original_underpayment_kas: 0.123,
    }),
    'rescue_j2_3_2026-04-26_strict', now);
console.log(`  ✓ chain_event inserted (exchange_completed strict_proportion)`);

db.close();

console.log('\n=== ✅ RESCUE COMPLETE (严标准, broker zero-loss) ===');
console.log(`USDT 0.03   BSC : Sophie → broker (tx ${PAYMENT_TX.slice(0,18)}...)`);
console.log(`KAS  ${KAS_AMOUNT} KAS: broker → Sophie (tx ${KAS_TX})`);
console.log(`查 Kasia: https://explorer.kaspa.org/txs/${KAS_TX}`);
console.log(`查 BSC:   https://bscscan.com/tx/${PAYMENT_TX}`);
console.log(`\nJ1 真测代价: 0.123 KAS underpayment 自吃 (Owner 钦定严标准, 教训不慷慨)`);
