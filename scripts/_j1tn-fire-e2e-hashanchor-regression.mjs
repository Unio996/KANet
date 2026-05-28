// J1tn R12 regression — fire fresh e2e against NWT 079c4c696 hash-anchor build.
// Goal: verify Path A 真链 broadcast 过 + status auto-transitions matched (= NO SQL workaround needed).
// Maker, broker, taker, 5 oracles same as R6 fire.

import { setTimeout as sleep } from 'node:timers/promises';

const CONSOLE = 'http://127.0.0.1:3300';
const MAKER = 'ede0772f-dba7-452d-a12a-ff9d3374d4fc';
const BROKER = 'c1a81b8c-000e-41c6-b95f-63c4fbcc48eb';
const TAKER = '6a0a8eed-ce4f-4192-bb37-1d2843c626e4';
const ORACLES = [
  '50902702-0646-4bb7-ae55-9b7b10ac7ab2',
  '523f9eb7-92f2-4b91-9ba8-088e6dde665b',
  '3b7a8fe6-5fe9-4124-8e1e-26c0b3c33c64',
  '905ee524-5679-4b05-9466-3269f1d1377e',
  '992fcfc1-267e-421e-96de-37dc4178f2f2',
];

const conditionId = `j1tn-r12-hashanchor-${Date.now()}`;
const endDate = new Date(Date.now() + 25 * 60_000).toISOString();

async function post(path, body) {
  const r = await fetch(`${CONSOLE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}
async function get(path) {
  const r = await fetch(`${CONSOLE}${path}`);
  return { status: r.status, json: await r.json() };
}

console.log('═══ J1tn R12 hash-anchor regression e2e ═══\n');
console.log('condition_id:', conditionId);
console.log('end_date:', endDate, '\n');

// 1. pending-offer
console.log('1) maker pending-offer...');
const s1 = await post('/api/prediction/pending-offer', {
  maker_relay_id: MAKER,
  market_question: 'J1tn R12 hash-anchor regression',
  odds: 0.5, size_kas: 1,
  outcome_side: 'YES',
  outcome_market_source: 'kanet_native',
  outcome_condition_id: conditionId,
  outcome_token_id: 'j1tn_r12_yes',
  resolution_rule_spec: 'Hash-anchor regression test.',
  handshake_minutes: 30,
});
if (s1.status !== 200 || !s1.json.ok) { console.error('FAIL 1:', s1.json); process.exit(1); }
const offerId = s1.json.pending_offer_id;
console.log('  ✓ offer:', offerId, '\n');

// 2. taker handshake
console.log('2) taker handshake...');
const takerRow = await get(`/api/relay/${TAKER}`);
const takerAddr = takerRow.json.relay?.address;
const s2 = await post(`/api/prediction/taker-handshake/${offerId}`, { taker_kaspa_addr: takerAddr });
if (s2.status !== 200 || !s2.json.ok) { console.error('FAIL 2:', s2.json); process.exit(1); }
console.log('  ✓ pubkey:', s2.json.taker_pubkey.slice(0, 24), '...\n');

// 3. maker publish-v2 (= triggers hash-anchor Path A broadcast at 535 chars per NWT r86)
console.log('3) maker publish-v2 (= hash-anchor Path A broadcast embedded)...');
const s3 = await post('/api/prediction/publish-v2', {
  maker_relay_id: MAKER,
  broker_relay_id: BROKER,
  outcome_oracle_relay_ids: ORACLES,
  outcome_market_source: 'kanet_native',
  outcome_condition_id: conditionId,
  outcome_token_id: 'j1tn_r12_yes',
  outcome_side: 'YES',
  outcome_end_date: endDate,
  resolution_rule_spec: 'Hash-anchor regression test.',
  price: 0.5, size_kas: 1,
  broker_fee_pct: 100, oracle_fee_pct: 100,
  pending_offer_id: offerId,
});
if (s3.status !== 200 || !s3.json.ok) { console.error('FAIL 3:', s3.json); process.exit(1); }
console.log('  ✓ escrow_p2sh:', s3.json.escrow_p2sh);
console.log('  ✓ maker_escrow_lock_tx:', s3.json.maker_escrow_lock_tx, '\n');

await sleep(3000);

// 4. taker stake — KEY: this is where Path A broadcast happens internally.
//    With hash-anchor it should NOT fail with storage mass.
console.log('4) taker stake (= Path A hash-anchor broadcast internal)...');
const s4 = await post(`/api/prediction/taker-stake/${offerId}`, { taker_relay_id: TAKER });
console.log('  status:', s4.status);
console.log('  body:', JSON.stringify(s4.json).slice(0, 500));
if (s4.status !== 200 || !s4.json.ok) {
  console.error('FAIL 4 — hash-anchor regression DID NOT pass Path A. Inspect.');
  process.exit(2);
}
console.log('  ✓ taker_escrow_tx:', s4.json.taker_escrow_tx_id || s4.json.txid, '\n');

await sleep(4000);

// 5. consensual-confirm 2x (= verify state machine progresses without manual SQL)
console.log('5) consensual-confirm maker winner=0...');
const s5 = await post(`/api/prediction/consensual-confirm/${offerId}`, { relay_id: MAKER, winner: 0 });
console.log('  status:', s5.status, 'both_agreed:', s5.json.both_agreed);

console.log('6) consensual-confirm taker winner=0...');
const s6 = await post(`/api/prediction/consensual-confirm/${offerId}`, { relay_id: TAKER, winner: 0 });
console.log('  status:', s6.status, 'both_agreed:', s6.json.both_agreed, 'dispatched:', s6.json.dispatched);
console.log('  body:', JSON.stringify(s6.json).slice(0, 500));

await sleep(5000);

// 7. final state
console.log('\n7) final state...');
const final = await get(`/api/exchange/offers/${offerId}`).catch(() => null);
if (final?.json) {
  console.log('  protocol_status:', final.json.protocol_status, '  settle_txid:', final.json.settle_txid);
}

// Verify Path A chain_event row exists (= source=hash_anchor_cache should resolve from chain)
console.log('\n8) audit trace verify hash-anchor source...');
const audit = await get(`/api/audit/prediction-trace/${encodeURIComponent(takerAddr)}`);
console.log('  total_markets:', audit.json.total_markets, 'total_dm_actions:', audit.json.total_dm_actions);

console.log('\n═══ J1tn R12 hash-anchor regression COMPLETE ═══');
console.log('offer:', offerId);
console.log('If status=completed + settle_txid populated AND no manual SQL transition needed → hash-anchor verified.');
