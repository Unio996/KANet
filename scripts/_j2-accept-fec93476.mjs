// LABEL keep-as-is (J2 #637 Group C audit, KI 63 整合, 5/21):
// Operator one-off: J2 cross-actor taker accept specific offer. Historical use.
// NOT regression test material. Kept for future operator pattern reference. DO NOT integrate.
//
// J2 cross-actor taker: accept offer fec93476 (5 KAS for 0.170873 USDT)
const J2_RELAY = 'c9c37c37-9a8c-484c-9893-20185d97ccf9';
const OFFER_ID = 'fec93476-9995-4131-9b8e-563c1b4f61c5';

console.log(`[accept] J2 → offer ${OFFER_ID.slice(0,8)} (5 KAS taker, kaspa_tx auto-send)`);
const r = await fetch('http://127.0.0.1:3100/api/exchange/accept', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayNodeId: J2_RELAY, offer_id: OFFER_ID }),
});
const j = await r.json().catch(() => ({}));
console.log('status:', r.status);
console.log('body:', JSON.stringify(j, null, 2).slice(0, 1500));
