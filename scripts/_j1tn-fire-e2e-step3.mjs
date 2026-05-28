// Resume e2e at step 3 (publish-v2) — pending offer already in handshake_done.
import { setTimeout as sleep } from 'node:timers/promises';

const CONSOLE = 'http://127.0.0.1:3300';
const OFFER_ID = process.argv[2] || 'ext-pred-1779931503151-ty096';
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
const conditionId = `j1tn-r5-e2e-${OFFER_ID.slice(-5)}`;
const endDate = new Date(Date.now() + 25 * 60_000).toISOString();

async function post(path, body) {
  const r = await fetch(`${CONSOLE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
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

console.log('resuming e2e at step 3, offer:', OFFER_ID, '\n');

const takerRow = await get(`/api/relay/${TAKER}`);
const takerAddr = takerRow.json.relay?.address;

// Step 3: publish-v2
console.log('3) publish-v2 with bumped fee floor 3M sompi...');
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
  broker_fee_pct: 100,
  oracle_fee_pct: 100,
  pending_offer_id: OFFER_ID,
});
console.log('  status:', s3.status, 'body:', JSON.stringify(s3.json).slice(0, 600));
if (s3.status !== 200 || !s3.json.ok) {
  console.error('FAIL step 3');
  process.exit(1);
}
console.log('  ✓ escrow_p2sh:', s3.json.escrow_p2sh, '\n');

const finalOfferId = s3.json.offer_id || OFFER_ID;

await sleep(4000);

// Step 4: taker stake
console.log('4) taker stake...');
const s4 = await post(`/api/prediction/taker-stake/${finalOfferId}`, {
  taker_relay_id: TAKER,
});
console.log('  status:', s4.status, 'body:', JSON.stringify(s4.json).slice(0, 600));
if (s4.status !== 200 || !s4.json.ok) {
  console.error('FAIL step 4');
  process.exit(1);
}
console.log('  ✓ taker escrow tx:', s4.json.taker_escrow_tx_id || s4.json.txid, '\n');

await sleep(2000);

// Step 5: audit
console.log('5) audit trace...');
const s5 = await get(`/api/audit/prediction-trace/${encodeURIComponent(takerAddr)}`);
console.log('  total_markets:', s5.json.total_markets, '  total_sides:', s5.json.total_sides);
console.log('  trace[0]:', JSON.stringify(s5.json.trace?.[0] || null).slice(0, 400));

console.log('\n═══ e2e stages 1-4 SHIP-BLOCK CLOSE ═══');
console.log('offer:', finalOfferId);
console.log('deadline:', endDate, '(settle auto via 5-of-5 oracle consensus)');
