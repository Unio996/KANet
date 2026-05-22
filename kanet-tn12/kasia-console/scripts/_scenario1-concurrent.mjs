// Part A Scenario 1 — 3 concurrent pool markets. Verify the settler handles multiple
// 'verifying' markets in one tick without race / cross-contamination.
const CONSOLE = 'http://127.0.0.1:3300';
const MAKER = 'ede0772f-dba7-452d-a12a-ff9d3374d4fc';
const BROKER = 'c1a81b8c-000e-41c6-b95f-63c4fbcc48eb';
const ORACLES = ['6a0a8eed-ce4f-4192-bb37-1d2843c626e4','50902702-0646-4bb7-ae55-9b7b10ac7ab2','523f9eb7-92f2-4b91-9ba8-088e6dde665b'];
const BETTORS = ['a6fc6811-93a5-4af6-a258-b7d8f2936405','73a48b54-6fe0-4bc2-9b4d-7749d671d803'];

async function post(path, body) {
  const r = await fetch(`${CONSOLE}${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{}) });
  return r.json();
}

const markets = [];
// Create 3 markets sequentially (transferAndConfirm serializes maker transfers, no double-spend).
for (let i = 1; i <= 3; i++) {
  const end = new Date(Date.now() + 17 * 60_000).toISOString();  // 17-min deadline (protocol min 15)
  const j = await post('/api/pool/market/create', {
    maker_relay_id: MAKER, broker_relay_id: BROKER, oracle_relay_ids: ORACLES,
    outcome_market_source: 'kanet_native', outcome_condition_id: `s1-m${i}-${Date.now()}`,
    outcome_token_id: `s1-tok-${i}`, outcome_side: 'YES', outcome_end_date: end,
    resolution_rule_spec: JSON.stringify({ data_source_canonical: `Scenario 1 concurrency market ${i}` }),
    maker_stake_kas: '2', oracle_bond_kas: '1', broker_fee_pct: '100',
  });
  if (!j.ok) { console.error(`market ${i} create FAIL: ${j.error}`); process.exit(1); }
  markets.push(j.market_id);
  console.log(`market ${i}: ${j.market_id} (deadline ${end})`);
}

// Oracle deposits + bettor registers for all 3 (sequential — endpoints serialize via transferAndConfirm).
for (let i = 0; i < markets.length; i++) {
  const mid = markets[i];
  for (let o = 0; o < 3; o++) {
    const j = await post(`/api/pool/market/${mid}/oracle/deposit`, { oracle_relay_id: ORACLES[o] });
    if (!j.ok) { console.error(`m${i+1} oracle${o+1} deposit FAIL: ${j.error}`); process.exit(1); }
  }
  const y = await post(`/api/pool/market/${mid}/bettor/register`, { bettor_relay_id: BETTORS[0], direction: 0, stake_kas: '1' });
  if (!y.ok) { console.error(`m${i+1} bettor1 register FAIL: ${y.error}`); process.exit(1); }
  const n = await post(`/api/pool/market/${mid}/bettor/register`, { bettor_relay_id: BETTORS[1], direction: 1, stake_kas: '1' });
  if (!n.ok) { console.error(`m${i+1} bettor2 register FAIL: ${n.error}`); process.exit(1); }
  console.log(`market ${i+1} setup complete (3 oracle bonds + 2 bettor sides)`);
}

console.log('\n=== ALL 3 MARKETS SETUP COMPLETE ===');
console.log('market_ids:', JSON.stringify(markets));
console.log('deadlines ~4 min out. Next: wait deadline, settle-trigger + vote all 3.');
