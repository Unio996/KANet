// LABEL keep-as-is (J2 #637 Group C audit, KI 63 整合, 5/21):
// Operator one-off P0 recovery post-N14.7 hotfix. Historical use.
// NOT regression test. Kept for future operator pattern reference. DO NOT integrate.
//
// J2 P0 recover stuck offer b4f51fc1 — re-trigger processPaymentSubmit post-N14.7 hotfix
const offer_id = 'b4f51fc1-b2a';
const payment_tx = '549175db16621ac53a8058a0bc3b5c8d1fc49a750fa7407bde159c6106b36347';
const payment_chain = 'kaspa';

const { processPaymentSubmit } = await import('../kasia-console/src/services/exchange-machine.js');
const { sqlite } = await import('../kasia-console/src/db/client.js');

// First find the full offer_id
const offer = sqlite.prepare(`SELECT id, protocol_status FROM exchange_offers WHERE substr(id, 1, 12) = ?`).get('b4f51fc1-b2a');
console.log('offer:', offer);

if (!offer) {
  console.error('offer not found');
  process.exit(1);
}

if (offer.protocol_status !== 'verifying') {
  console.log('offer not in verifying, current=', offer.protocol_status, '— maybe auto-resumed');
  process.exit(0);
}

console.log('Calling processPaymentSubmit...');
const result = processPaymentSubmit({
  offer_id: offer.id,
  payment_tx,
  payment_chain,
  payment_asset: 'kas',
});
console.log('result:', result);

// Wait 10s for async _verifyAndComplete
await new Promise(r => setTimeout(r, 12000));

const updated = sqlite.prepare(`SELECT id, protocol_status, payment_tx, delivery_tx, verification_meta, completed_at FROM exchange_offers WHERE id = ?`).get(offer.id);
console.log('post-verify state:', {
  id: updated.id.slice(0, 12),
  status: updated.protocol_status,
  payment_tx: updated.payment_tx?.slice(0, 16),
  delivery_tx: updated.delivery_tx?.slice(0, 16),
  completed_at: updated.completed_at,
  meta_verified: !!JSON.parse(updated.verification_meta || '{}').verified_tx,
});
