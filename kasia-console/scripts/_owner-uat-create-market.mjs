// Owner UAT 1 — create a pool prediction market (Owner acts as maker).
//
// Usage:
//   node scripts/_owner-uat-create-market.mjs "<question>" <deadline_minutes> <stake_kas>
//
// Example:
//   node scripts/_owner-uat-create-market.mjs "Will BTC top 100k by June?" 20 2
//
// Output: market_id + spine_p2sh + on-chain spine lock TX hash.
// Save the market_id — the other 3 UAT scripts need it.

const CONSOLE = process.env.UAT_CONSOLE_URL || 'http://127.0.0.1:3300';

// tn12 relay roles (fixed for UAT)
const MAKER_RELAY  = 'ede0772f-dba7-452d-a12a-ff9d3374d4fc';  // pred-maker
const BROKER_RELAY = 'c1a81b8c-000e-41c6-b95f-63c4fbcc48eb';  // pred-broker
const ORACLE_RELAYS = [
  '6a0a8eed-ce4f-4192-bb37-1d2843c626e4',  // J1tn-Alice
  '50902702-0646-4bb7-ae55-9b7b10ac7ab2',  // J1tn-Bob
  '523f9eb7-92f2-4b91-9ba8-088e6dde665b',  // J1tn-Carol
];

const [question, deadlineMinRaw, stakeKasRaw] = process.argv.slice(2);
if (!question || !deadlineMinRaw || !stakeKasRaw) {
  console.error('Usage: node scripts/_owner-uat-create-market.mjs "<question>" <deadline_minutes> <stake_kas>');
  console.error('Example: node scripts/_owner-uat-create-market.mjs "Will BTC top 100k?" 20 2');
  process.exit(1);
}
const deadlineMin = parseInt(deadlineMinRaw, 10);
const stakeKas = parseFloat(stakeKasRaw);
// Pain point #2: honor POOL_DEADLINE_MIN_OVERRIDE — testnet can set a short deadline for quick demos.
const minDeadline = (parseInt(process.env.POOL_DEADLINE_MIN_OVERRIDE, 10) || 15) + 1;
if (!Number.isFinite(deadlineMin) || deadlineMin < minDeadline) {
  console.error(`deadline_minutes must be an integer >= ${minDeadline} (got ${deadlineMinRaw})`);
  console.error(`(protocol minimum is ${minDeadline - 1} min; set POOL_DEADLINE_MIN_OVERRIDE on the Console env to relax it for testnet)`);
  process.exit(1);
}
if (!Number.isFinite(stakeKas) || stakeKas <= 0) {
  console.error(`stake_kas must be a positive number (got ${stakeKasRaw})`);
  process.exit(1);
}

const endDate = new Date(Date.now() + deadlineMin * 60_000).toISOString();
const body = {
  maker_relay_id: MAKER_RELAY,
  broker_relay_id: BROKER_RELAY,
  oracle_relay_ids: ORACLE_RELAYS,
  outcome_market_source: 'kanet_native',
  outcome_condition_id: 'uat-' + Date.now(),
  outcome_token_id: 'uat-token-' + Date.now(),
  outcome_side: 'YES',
  outcome_end_date: endDate,
  resolution_rule_spec: JSON.stringify({ data_source_canonical: question }),
  maker_stake_kas: String(stakeKas),
  oracle_bond_kas: '1',
  broker_fee_pct: '100',
};

console.log(`[UAT create-market] question: "${question}"`);
console.log(`[UAT create-market] deadline: ${endDate} (= +${deadlineMin} min)`);
console.log(`[UAT create-market] maker stake: ${stakeKas} KAS`);
console.log(`[UAT create-market] submitting...`);

const res = await fetch(`${CONSOLE}/api/pool/market/create`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const j = await res.json();
if (!j.ok) {
  console.error(`[UAT create-market] FAILED: ${j.error}`);
  process.exit(1);
}
console.log('');
console.log('=== MARKET CREATED ===');
console.log(`  market_id:      ${j.market_id}`);
console.log(`  spine_p2sh:     ${j.spine_p2sh}`);
console.log(`  spine_lock_tx:  ${j.spine_lock_tx}`);
console.log(`  explorer:       https://explorer-tn12.kaspa.org/txs/${j.spine_lock_tx}`);
console.log(`  status:         ${j.status}`);
console.log('');
console.log(`NEXT: 3 oracles must deposit bonds. Run (×3, role 1/2/3):`);
console.log(`  node scripts/_owner-uat-oracle-deposit.mjs ${j.market_id} 1`);
