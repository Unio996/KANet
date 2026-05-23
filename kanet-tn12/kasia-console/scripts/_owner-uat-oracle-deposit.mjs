// Owner UAT 2 — oracle deposits its bond (Owner acts as oracle 1/2/3).
//
// Usage:
//   node scripts/_owner-uat-oracle-deposit.mjs <market_id> <oracle_role>
//
// Example:
//   node scripts/_owner-uat-oracle-deposit.mjs ext-pool-1779... 1
//
// oracle_role: 1 = Alice, 2 = Bob, 3 = Carol. Run all 3 to fill the bond requirement.
// Output: bond deposit TX hash.

const CONSOLE = process.env.UAT_CONSOLE_URL || 'http://127.0.0.1:3300';

const ORACLE_RELAYS = {
  '1': { id: '6a0a8eed-ce4f-4192-bb37-1d2843c626e4', name: 'J1tn-Alice' },
  '2': { id: '50902702-0646-4bb7-ae55-9b7b10ac7ab2', name: 'J1tn-Bob' },
  '3': { id: '523f9eb7-92f2-4b91-9ba8-088e6dde665b', name: 'J1tn-Carol' },
};

const [marketId, oracleRole] = process.argv.slice(2);
if (!marketId || !oracleRole) {
  console.error('Usage: node scripts/_owner-uat-oracle-deposit.mjs <market_id> <oracle_role 1|2|3>');
  console.error('Example: node scripts/_owner-uat-oracle-deposit.mjs ext-pool-1779... 1');
  process.exit(1);
}
const oracle = ORACLE_RELAYS[oracleRole];
if (!oracle) {
  console.error(`oracle_role must be 1, 2, or 3 (got ${oracleRole})`);
  process.exit(1);
}

console.log(`[UAT oracle-deposit] market: ${marketId}`);
console.log(`[UAT oracle-deposit] oracle: role ${oracleRole} (${oracle.name})`);
console.log(`[UAT oracle-deposit] submitting bond deposit...`);

const res = await fetch(`${CONSOLE}/api/pool/market/${marketId}/oracle/deposit`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ oracle_relay_id: oracle.id }),
});
const j = await res.json();
if (!j.ok) {
  console.error(`[UAT oracle-deposit] FAILED: ${j.error}`);
  process.exit(1);
}
console.log('');
console.log('=== ORACLE BOND DEPOSITED ===');
console.log(`  oracle:             ${oracle.name} (role ${oracleRole})`);
console.log(`  deposit_tx:         ${j.deposit_tx}`);
console.log(`  explorer:           https://explorer-tn12.kaspa.org/txs/${j.deposit_tx}`);
console.log(`  deposits_received:  ${j.deposits_received}/3`);
console.log(`  market_status:      ${j.market_status}`);
console.log('');
if (j.market_status === 'pending_bettors') {
  console.log('All 3 oracle bonds in. NEXT: bettors register. Run:');
  console.log(`  node scripts/_owner-uat-bettor-register.mjs ${marketId} YES 2`);
} else {
  const remaining = 3 - j.deposits_received;
  console.log(`${remaining} more oracle deposit(s) needed. Run with the remaining role number(s).`);
}
