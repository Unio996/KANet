// Part A Scenario 1 — wait deadline, settle-trigger + vote all 3 markets concurrently.
const CONSOLE = 'http://127.0.0.1:3300';
const ORACLES = ['6a0a8eed-ce4f-4192-bb37-1d2843c626e4','50902702-0646-4bb7-ae55-9b7b10ac7ab2','523f9eb7-92f2-4b91-9ba8-088e6dde665b'];
const MARKETS = ['ext-pool-1779441629475-dop3h','ext-pool-1779441632564-7u0kt','ext-pool-1779441635644-pfgih'];
const DEADLINE_UNIX = Math.floor(new Date('2026-05-22T09:37:32Z').getTime() / 1000);

async function post(path, body) {
  const r = await fetch(`${CONSOLE}${path}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{}) });
  return r.json();
}

// Wait until past the latest deadline + a margin.
while (Math.floor(Date.now() / 1000) < DEADLINE_UNIX + 5) {
  await new Promise(r => setTimeout(r, 10_000));
}
console.log(`deadline passed ${new Date().toISOString()}`);

// Settle-trigger all 3.
for (const mid of MARKETS) {
  const j = await post(`/api/pool/market/${mid}/settle`);
  console.log(`settle ${mid.slice(-6)}: ${j.ok ? j.status : 'FAIL '+j.error}`);
}

// Vote YES unanimous on all 3.
for (const mid of MARKETS) {
  for (let o = 0; o < 3; o++) {
    const j = await post(`/api/pool/market/${mid}/oracle/vote`, { oracle_relay_id: ORACLES[o], outcome: 'YES' });
    if (!j.ok) console.log(`vote ${mid.slice(-6)} o${o+1}: FAIL ${j.error}`);
  }
  console.log(`market ${mid.slice(-6)}: 3 votes cast`);
}
console.log('\n=== ALL 3 MARKETS: settle triggered + voted — settler cron will process concurrently ===');
