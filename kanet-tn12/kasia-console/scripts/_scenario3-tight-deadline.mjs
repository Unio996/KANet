// Part A Scenario 3 — tight deadline (3 min). Verify oracle vote latency budget +
// no false-timeout (parseSqliteUtc fix) + settle works with a short deadline.
const CONSOLE = 'http://127.0.0.1:3300';
const MAKER = 'ede0772f-dba7-452d-a12a-ff9d3374d4fc';
const BROKER = 'c1a81b8c-000e-41c6-b95f-63c4fbcc48eb';
const ORACLES = ['6a0a8eed-ce4f-4192-bb37-1d2843c626e4','50902702-0646-4bb7-ae55-9b7b10ac7ab2','523f9eb7-92f2-4b91-9ba8-088e6dde665b'];
const BETTORS = ['a6fc6811-93a5-4af6-a258-b7d8f2936405','73a48b54-6fe0-4bc2-9b4d-7749d671d803'];

async function post(path, body) {
  const r = await fetch(`${CONSOLE}${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{}) });
  return r.json();
}

const end = new Date(Date.now() + 3 * 60_000).toISOString();  // 3-min tight deadline
const deadlineUnix = Math.floor(new Date(end).getTime() / 1000);
const c = await post('/api/pool/market/create', {
  maker_relay_id: MAKER, broker_relay_id: BROKER, oracle_relay_ids: ORACLES,
  outcome_market_source: 'kanet_native', outcome_condition_id: `s3-${Date.now()}`,
  outcome_token_id: 's3-tok', outcome_side: 'YES', outcome_end_date: end,
  resolution_rule_spec: JSON.stringify({ data_source_canonical: 'Scenario 3 tight deadline' }),
  maker_stake_kas: '2', oracle_bond_kas: '1', broker_fee_pct: '100',
});
if (!c.ok) { console.error(`create FAIL: ${c.error}`); process.exit(1); }
const MID = c.market_id;
console.log(`market: ${MID} (3-min deadline ${end})`);

for (let o = 0; o < 3; o++) {
  const j = await post(`/api/pool/market/${MID}/oracle/deposit`, { oracle_relay_id: ORACLES[o] });
  if (!j.ok) { console.error(`oracle${o+1} deposit FAIL: ${j.error}`); process.exit(1); }
}
console.log('3 oracle bonds deposited');
const y = await post(`/api/pool/market/${MID}/bettor/register`, { bettor_relay_id: BETTORS[0], direction: 0, stake_kas: '1' });
const n = await post(`/api/pool/market/${MID}/bettor/register`, { bettor_relay_id: BETTORS[1], direction: 1, stake_kas: '1' });
if (!y.ok || !n.ok) { console.error(`register FAIL: ${y.error||n.error}`); process.exit(1); }
console.log('2 bettors registered (YES + NO)');

// Wait deadline.
while (Math.floor(Date.now() / 1000) < deadlineUnix + 5) {
  await new Promise(r => setTimeout(r, 5_000));
}
console.log(`deadline passed ${new Date().toISOString()}`);

const s = await post(`/api/pool/market/${MID}/settle`);
console.log(`settle: ${s.ok ? s.status : 'FAIL '+s.error}`);
for (let o = 0; o < 3; o++) {
  await post(`/api/pool/market/${MID}/oracle/vote`, { oracle_relay_id: ORACLES[o], outcome: 'YES' });
}
console.log('3 votes cast YES');
console.log(`\n=== SCENARIO 3 setup+vote done — market ${MID} — settler cron will settle ===`);
