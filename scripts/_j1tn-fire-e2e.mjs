// J1tn R5 — fire Bettor reviewer e2e cycle: pending-offer → handshake → publish-v2 → stake → settle.
//
// Relay assignments (testnet-12, all alive + is_oracle=1 where required):
//   maker:  pred-maker  ede0772f-dba7-452d-a12a-ff9d3374d4fc (~34 KAS)
//   broker: pred-broker c1a81b8c-000e-41c6-b95f-63c4fbcc48eb (~5  KAS, < 10K oracle bond requirement)
//   taker:  J1tn-Alice  6a0a8eed-ce4f-4192-bb37-1d2843c626e4 (~98K KAS)
//   oracles (5): J1tn-Bob/Carol/Dave/Eve + UAT-Test-1 — all is_oracle=1

import { setTimeout as sleep } from 'node:timers/promises';

const CONSOLE = 'http://127.0.0.1:3300';
const MAKER = 'ede0772f-dba7-452d-a12a-ff9d3374d4fc';
const BROKER = 'c1a81b8c-000e-41c6-b95f-63c4fbcc48eb';
const TAKER = '6a0a8eed-ce4f-4192-bb37-1d2843c626e4';
const ORACLES = [
  '50902702-0646-4bb7-ae55-9b7b10ac7ab2', // Bob
  '523f9eb7-92f2-4b91-9ba8-088e6dde665b', // Carol
  '3b7a8fe6-5fe9-4124-8e1e-26c0b3c33c64', // Dave
  '905ee524-5679-4b05-9466-3269f1d1377e', // Eve
  '992fcfc1-267e-421e-96de-37dc4178f2f2', // UAT-Test-1
];

const conditionId = `j1tn-r5-e2e-${Date.now()}`;
const endDate = new Date(Date.now() + 25 * 60_000).toISOString();

async function post(path, body) {
  const r = await fetch(`${CONSOLE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  return { status: r.status, json };
}

async function get(path) {
  const r = await fetch(`${CONSOLE}${path}`);
  const json = await r.json();
  return { status: r.status, json };
}

console.log('═══ J1tn R5 Bettor reviewer e2e cycle ═══\n');
console.log('outcome_end_date:', endDate);
console.log('condition_id:', conditionId, '\n');

// Step 1: maker pending-offer
console.log('1) maker pending-offer...');
const s1 = await post('/api/prediction/pending-offer', {
  maker_relay_id: MAKER,
  market_question: 'J1tn R5 e2e cycle ship-block close',
  odds: 0.5,
  size_kas: 1,
  outcome_side: 'YES',
  outcome_market_source: 'kanet_native',
  outcome_condition_id: conditionId,
  outcome_token_id: 'j1tn_e2e_yes',
  resolution_rule_spec: 'Test market for ship-block e2e.',
  handshake_minutes: 30,
});
console.log('  status:', s1.status, 'body:', JSON.stringify(s1.json).slice(0, 300));
if (s1.status !== 200 || !s1.json.ok) { console.error('FAIL step 1'); process.exit(1); }
const offerId = s1.json.pending_offer_id;
console.log('  ✓ offer_id:', offerId, '\n');

// Step 2: taker handshake
console.log('2) taker handshake...');
const takerRow = await get(`/api/relay/${TAKER}`);
const takerAddr = takerRow.json.relay?.address;
console.log('  taker addr:', takerAddr);
const s2 = await post(`/api/prediction/taker-handshake/${offerId}`, {
  taker_kaspa_addr: takerAddr,
});
console.log('  status:', s2.status, 'body:', JSON.stringify(s2.json).slice(0, 300));
if (s2.status !== 200 || !s2.json.ok) { console.error('FAIL step 2'); process.exit(1); }
console.log('  ✓ taker_pubkey:', s2.json.taker_pubkey.slice(0, 20), '...\n');

// Step 3: maker publish-v2
console.log('3) maker publish-v2 (= SS contract compile + maker stake on chain)...');
const s3 = await post('/api/prediction/publish-v2', {
  maker_relay_id: MAKER,
  broker_relay_id: BROKER,
  outcome_oracle_relay_ids: ORACLES,
  outcome_market_source: 'kanet_native',
  outcome_condition_id: conditionId,
  outcome_token_id: 'j1tn_e2e_yes',
  outcome_side: 'YES',
  outcome_end_date: endDate,
  resolution_rule_spec: 'Test market for ship-block e2e.',
  price: 0.5,
  size_kas: 1,
  broker_fee_pct: 100,            // 1%
  oracle_fee_pct: 100,            // 1%
  pending_offer_id: offerId,
});
console.log('  status:', s3.status, 'body:', JSON.stringify(s3.json).slice(0, 500));
if (s3.status !== 200 || !s3.json.ok) { console.error('FAIL step 3'); process.exit(1); }
console.log('  ✓ escrow_p2sh:', s3.json.escrow_p2sh, '\n');

// Step 4: taker stake
console.log('4) taker stake (= Alice transfer stake KAS → P2SH)...');
await sleep(3000);  // let chain settle maker tx
const s4 = await post(`/api/prediction/taker-stake/${offerId}`, {
  taker_relay_id: TAKER,
});
console.log('  status:', s4.status, 'body:', JSON.stringify(s4.json).slice(0, 500));
if (s4.status !== 200 || !s4.json.ok) { console.error('FAIL step 4'); process.exit(1); }
console.log('  ✓ taker escrow tx:', s4.json.taker_escrow_tx_id || s4.json.txid, '\n');

// Step 5: check final state
console.log('5) post-stake offer state...');
await sleep(2000);
const s5 = await get(`/api/audit/prediction-trace/${encodeURIComponent(takerAddr)}`);
console.log('  audit trace status:', s5.status, 'total_markets:', s5.json.total_markets);

console.log('\n═══ e2e cycle stages 1-4 ship-block close ═══');
console.log('offer_id:', offerId);
console.log('Settlement (= consensus 5-of-5 oracle vote + settle TX) auto-triggers at deadline:', endDate);
console.log('Monitor: GET /api/audit/prediction-trace/' + encodeURIComponent(takerAddr));
