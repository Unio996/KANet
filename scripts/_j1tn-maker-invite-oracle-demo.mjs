// J1tn — maker-invite oracle demo (Owner P0 GO r175, demo③ ship-blocker resolution path (a)).
//
// WHAT THIS PROVES
//   A maker can invite a NEWCOMER oracle relay — one with ZERO prior prediction-market
//   participation — into a real market's 5-of-5 oracle set, using the EXISTING publish-v2
//   parameter `outcome_oracle_relay_ids`. The newcomer then casts a REAL on-chain signed
//   vote and co-signs the REAL 5-of-5 settle TX. Its first on-chain oracle standing is
//   earned by genuine participation, not granted.
//
// ⚠ FRAMING (Bettor r174 honesty caveat — DO NOT misread):
//   This is "maker-INVITED", NOT "permissionless". The maker explicitly puts the newcomer's
//   relay_id into the 5-set. There is NO open/permissionless registry where anyone auto-joins.
//   Open-registry is Phase-2 tier-2 (economically unproven, hard-gated) — NOT done, NOT here.
//   Net: ZERO protocol change — this uses a parameter that already exists.
//
// TIER 4 GATE (Bettor r175): newcomer real-chain vote + settle TX, NO mock. Evidence captured:
//   1. newcomer `oracle_vote` chain_event (real ECDSA-signed vote payload)
//   2. newcomer `oracle_tx_sig` chain_event (real settle-TX input signature)
//   3. the on-chain settle_txid
//
// RESOLUTION SOURCE: real resolved Polymarket/UMA market (Espresso FDV $200M, resolved YES,
//   >48h finalized — the same market proven by release-note settle c045c58a). Deterministic
//   gamma read, no LLM dependency, so all 5 oracles reach the same outcome → unanimous.
//
// Run: node scripts/_j1tn-maker-invite-oracle-demo.mjs [--wait-min=30]

import { setTimeout as sleep } from 'node:timers/promises';

const CONSOLE = 'http://127.0.0.1:3300';

// ── Cast (testnet-12) ───────────────────────────────────────────────────────
const MAKER    = 'ede0772f-dba7-452d-a12a-ff9d3374d4fc'; // pred-maker
const BROKER   = 'c1a81b8c-000e-41c6-b95f-63c4fbcc48eb'; // pred-broker
const TAKER    = '6a0a8eed-ce4f-4192-bb37-1d2843c626e4'; // J1tn-Alice
const NEWCOMER = '36ad0e1a-cbb1-4eda-bd93-13b52122b28a'; // UAT-Test-2 — in_5sets=0, prior_votes=0 (genuine newcomer)
const ESTABLISHED = [
  '50902702-0646-4bb7-ae55-9b7b10ac7ab2', // Bob
  '523f9eb7-92f2-4b91-9ba8-088e6dde665b', // Carol
  '3b7a8fe6-5fe9-4124-8e1e-26c0b3c33c64', // Dave
  '905ee524-5679-4b05-9466-3269f1d1377e', // Eve
];
// maker INVITES the newcomer into the 5-set (newcomer first, 4 established fill the rest):
const ORACLES = [NEWCOMER, ...ESTABLISHED];

// Real resolved Polymarket market — Espresso FDV $200M one day after launch? → YES.
const TOKEN_ID  = '106824408592813020013301350134034008352555643908738093172210459345634665782526';
const conditionId = `espresso-fdv-200m-makerinvite-${Date.now()}`;
// publish-v2 guard: outcome_end_date must be > now + 15 min. Voter processes after the deadline.
const endDate   = new Date(Date.now() + 16 * 60_000).toISOString();

const WAIT_MIN = parseInt((process.argv.find(a => a.startsWith('--wait-min=')) || '').split('=')[1], 10) || 30;

async function post(path, body) {
  const r = await fetch(`${CONSOLE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
async function get(path) {
  const r = await fetch(`${CONSOLE}${path}`);
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

console.log('═══════════════════════════════════════════════════════════════');
console.log(' J1tn maker-INVITE oracle demo (demo③ path (a), Owner P0 r175)');
console.log('═══════════════════════════════════════════════════════════════');
console.log('newcomer (invited):', NEWCOMER, '(UAT-Test-2, zero prior prediction participation)');
console.log('5-oracle set      :', ORACLES.map(o => o.slice(0, 8)).join(', '));
console.log('market            : Espresso FDV $200M (resolved YES, >48h UMA-finalized)');
console.log('betting deadline  :', endDate, '\n');

// 1. maker pending-offer (off-chain draft)
console.log('1) maker pending-offer...');
const s1 = await post('/api/prediction/pending-offer', {
  maker_relay_id: MAKER,
  market_question: 'Espresso FDV above $200M one day after launch?',
  odds: 0.5, size_kas: 1,
  outcome_side: 'YES',
  outcome_market_source: 'polymarket',
  outcome_condition_id: conditionId,
  outcome_token_id: TOKEN_ID,
  outcome_oracle_relay_ids: ORACLES,
  broker_relay_id: BROKER,
  resolution_rule_spec: 'Resolves per Polymarket/UMA finalized outcome (mirror).',
  handshake_minutes: 60,
});
if (s1.status !== 200 || !s1.json.ok) { console.error('FAIL 1:', s1.json); process.exit(1); }
const offerId = s1.json.pending_offer_id;
console.log('   ✓ offer:', offerId, '\n');

// 2. taker handshake
console.log('2) taker handshake (Alice)...');
const takerRow = await get(`/api/relay/${TAKER}`);
const takerAddr = takerRow.json.relay?.address;
const s2 = await post(`/api/prediction/taker-handshake/${offerId}`, { taker_kaspa_addr: takerAddr });
if (s2.status !== 200 || !s2.json.ok) { console.error('FAIL 2:', s2.json); process.exit(1); }
console.log('   ✓ taker_pubkey:', s2.json.taker_pubkey.slice(0, 24), '...\n');

// 3. maker publish-v2 — newcomer goes into the 5-set here (existing param, 0 protocol change)
console.log('3) maker publish-v2 (newcomer in the 5-set, SS escrow compile + maker lock)...');
const s3 = await post('/api/prediction/publish-v2', {
  maker_relay_id: MAKER,
  broker_relay_id: BROKER,
  outcome_oracle_relay_ids: ORACLES,
  outcome_market_source: 'polymarket',
  outcome_condition_id: conditionId,
  outcome_token_id: TOKEN_ID,
  outcome_side: 'YES',
  outcome_end_date: endDate,
  resolution_rule_spec: 'Resolves per Polymarket/UMA finalized outcome (mirror).',
  price: 0.5, size_kas: 1,
  // oracle_fee_pct >= 200 required: PredictionEscrowUnanimous5.sil settle_dispute has a KIP-9 dust
  // guard `require(spendable * oracleFeePct >= 1.25e12)` (per-oracle fee output must be >= 0.25 KAS).
  // At size_kas=1 (spendable ~6.25e9), oracleFeePct=100 fails it; 300 → per-oracle 0.375 KAS, passes.
  broker_fee_pct: 100, oracle_fee_pct: 300,
  // miner_fee must cover the settle_dispute TX mass (7 outputs + 10 oracle sigs ≈ mass 16366 →
  // 1_636_600 sompi req at kaspad v1.2.0 post-Toccata 100 sompi/mass). The 1_000_000 default is sized
  // for settle_consensual (mass ~7898); the oracle/dispute path needs more or kaspad rejects.
  miner_fee: 2_500_000,
  pending_offer_id: offerId,
});
if (s3.status !== 200 || !s3.json.ok) { console.error('FAIL 3:', s3.json); process.exit(1); }
console.log('   ✓ escrow_p2sh:', s3.json.escrow_p2sh);
console.log('   ✓ maker_escrow_lock_tx:', s3.json.maker_escrow_lock_tx, '\n');

await sleep(3000);

// 4. taker stake → matched
console.log('4) taker stake (Alice locks → matched)...');
const s4 = await post(`/api/prediction/taker-stake/${offerId}`, { taker_relay_id: TAKER });
if (s4.status !== 200 || !s4.json.ok) { console.error('FAIL 4:', s4.json); process.exit(2); }
console.log('   ✓ taker_escrow_tx:', s4.json.taker_escrow_tx_id || s4.json.txid, '\n');

// 5. poll for the voter cron to vote + settle (deadline + 5-min cron drive it)
console.log(`5) waiting for voter cron (5-min tick) to vote + settle — up to ${WAIT_MIN} min...`);
console.log('   (voter eligible after deadline; newcomer + 4 read gamma → YES → unanimous → 5-of-5 settle)\n');
const newcomerAddr = (await get(`/api/relay/${NEWCOMER}`)).json.relay?.address;
const deadline = Date.now() + WAIT_MIN * 60_000;
let settled = false, lastStatus = '';
while (Date.now() < deadline) {
  await sleep(30_000);
  const o = await get(`/api/exchange/offers/${offerId}`).catch(() => null);
  const st = o?.json?.protocol_status || '?';
  const ev = await get(`/api/audit/prediction-trace/${encodeURIComponent(newcomerAddr)}`).catch(() => null);
  if (st !== lastStatus) { console.log(`   [${new Date().toISOString().slice(11, 19)}] status=${st} settle_txid=${o?.json?.settle_txid || '-'}`); lastStatus = st; }
  if (st === 'completed' || o?.json?.settle_txid) { settled = true; break; }
}

console.log('\n═══ EVIDENCE (Tier 4 — query chain directly, no mock) ═══');
console.log('Run this to inspect the newcomer\'s real on-chain participation:');
console.log(`  offer_id = ${offerId}`);
console.log(`  newcomer = ${NEWCOMER} (addr ${newcomerAddr})`);
console.log('  → newcomer oracle_vote + oracle_tx_sig chain_events + settle_txid prove real vote+settle.');
console.log(settled ? '\n✓ SETTLED — see settle_txid above.' : `\n⏳ not settled within ${WAIT_MIN} min — poll the offer + chain_events; cron will continue.`);
console.log('\nFRAMING REMINDER: maker-INVITED (maker chose the relay_id). NOT permissionless. 0 protocol change.');
