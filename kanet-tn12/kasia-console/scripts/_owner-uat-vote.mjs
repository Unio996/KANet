// Owner UAT 4 — oracle casts a vote with explicit outcome (Owner acts as oracle).
//
// Usage:
//   node scripts/_owner-uat-vote.mjs <market_id> <oracle_role> <outcome YES|NO|DISPUTE>
//
// Example:
//   node scripts/_owner-uat-vote.mjs ext-pool-1779... 1 YES
//
// oracle_role: 1 = Alice, 2 = Bob, 3 = Carol.
// NOTE: market must be in 'verifying' state (= deadline passed + settle triggered).
//       Run the settle trigger first if needed:
//         curl -X POST http://127.0.0.1:3300/api/pool/market/<id>/settle
// Output: vote record + remaining votes needed. Once 3 votes in, the pool-settler
//         cron auto-aggregates consensus + dispatches the settle TX.

const CONSOLE = process.env.UAT_CONSOLE_URL || 'http://127.0.0.1:3300';

const ORACLE_RELAYS = {
  '1': { id: '6a0a8eed-ce4f-4192-bb37-1d2843c626e4', name: 'J1tn-Alice' },
  '2': { id: '50902702-0646-4bb7-ae55-9b7b10ac7ab2', name: 'J1tn-Bob' },
  '3': { id: '523f9eb7-92f2-4b91-9ba8-088e6dde665b', name: 'J1tn-Carol' },
};

const [marketId, oracleRole, outcomeRaw] = process.argv.slice(2);
if (!marketId || !oracleRole || !outcomeRaw) {
  console.error('Usage: node scripts/_owner-uat-vote.mjs <market_id> <oracle_role 1|2|3> <outcome YES|NO|DISPUTE>');
  console.error('Example: node scripts/_owner-uat-vote.mjs ext-pool-1779... 1 YES');
  process.exit(1);
}
const oracle = ORACLE_RELAYS[oracleRole];
if (!oracle) {
  console.error(`oracle_role must be 1, 2, or 3 (got ${oracleRole})`);
  process.exit(1);
}
const outcome = outcomeRaw.toUpperCase();
if (outcome !== 'YES' && outcome !== 'NO' && outcome !== 'DISPUTE') {
  console.error(`outcome must be YES, NO, or DISPUTE (got ${outcomeRaw})`);
  process.exit(1);
}

console.log(`[UAT vote] market: ${marketId}`);
console.log(`[UAT vote] oracle: ${oracle.name} (role ${oracleRole})`);
console.log(`[UAT vote] outcome: ${outcome}`);
console.log(`[UAT vote] submitting...`);

const res = await fetch(`${CONSOLE}/api/pool/market/${marketId}/oracle/vote`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ oracle_relay_id: oracle.id, outcome }),
});
const j = await res.json();
if (!j.ok) {
  console.error(`[UAT vote] FAILED: ${j.error}`);
  process.exit(1);
}
console.log('');
console.log('=== VOTE RECORDED ===');
console.log(`  oracle:          ${oracle.name}`);
console.log(`  outcome:         ${outcome}`);
console.log(`  votes_recorded:  ${j.votes_recorded}/3`);
console.log(`  next:            ${j.next_step}`);
console.log('');
if (j.votes_recorded >= 3) {
  console.log('All 3 votes in. Watch the market settle (status → completed):');
  console.log(`  curl -s http://127.0.0.1:3300/api/pool/market/${marketId} 2>/dev/null || echo "(check pool-settler logs)"`);
}
