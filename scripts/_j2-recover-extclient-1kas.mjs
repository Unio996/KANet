// LABEL keep-as-is (J2 #637 Group C audit, KI 63 整合, 5/21):
// Operator one-off N14.9 P0 recovery, NWT greenlight (a) + Owner aware. Historical use.
// production path fix shipped sub#3b.fix2. NOT regression test. Kept for operator pattern reference.
//
// J2 N14.9 P0 recovery: broker manual send 1 KAS → ExtClient + update escrow + DM audit
// Per NWT N14.9 greenlight (a) + Owner aware. NWT 测试损 OK 承担, production path 待 sub#3b.fix2 修.

const ESCROW_ID = '81101fd7-fc80-4917-b4fe-a7c9b6eae1e9';
const USER_TARGET = 'kaspa:qqg83hexltegwmtllv9ncftnuy3lhtcvh3tv07gp5xsjylx08ecmxh60gku9j';
const AMOUNT_KAS = 1;
const BROKER_RELAY_ID = '0a8e9723';  // Trader-B prefix

const CONSOLE_URL = 'http://127.0.0.1:3100';

// Step 1: resolve full relay_id
const relayRes = await fetch(`${CONSOLE_URL}/api/relay`).then(r => r.json()).catch(() => ({}));
const allRelays = relayRes.relayNodes || relayRes || [];
const broker = allRelays.find(r => r.id && r.id.startsWith(BROKER_RELAY_ID));
if (!broker) {
  console.error('Trader-B relay not found via /api/relay');
  process.exit(1);
}
console.log('broker:', broker.id, broker.name, broker.address);

// Step 2: send 1 KAS via relay-manager IPC (broker's process has signing key)
const sendRes = await fetch(`${CONSOLE_URL}/api/relay/${broker.id}/send`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    target: USER_TARGET,
    amount: AMOUNT_KAS,
    note: `N14.9 recovery escrow ${ESCROW_ID.slice(0, 8)}`,
  }),
}).then(r => r.json()).catch(e => ({ error: e.message }));

console.log('send result:', JSON.stringify(sendRes).slice(0, 400));

if (!sendRes.ok && !sendRes.txId && !sendRes.txid) {
  console.error('send failed, abort. Manual intervention needed.');
  process.exit(2);
}

const settleTx = sendRes.txId || sendRes.txid || sendRes.tx_id;
console.log('settle TX:', settleTx);

// Step 3: update escrow row with real settle_tx (currently 'queue-failed:81101fd7')
const updateRes = await fetch(`${CONSOLE_URL}/api/dev/sql`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sql: `UPDATE user_escrow_balances SET settle_tx = ?, updated_at = datetime('now') WHERE id = ?`,
    params: [settleTx, ESCROW_ID],
  }),
}).then(r => r.json()).catch(e => ({ error: e.message }));
console.log('escrow update:', updateRes);

// Step 4: DM ExtClient via broker relay
const dmRes = await fetch(`${CONSOLE_URL}/api/relay/${broker.id}/dm`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    target: USER_TARGET,
    message: `✓ 已 deliver ${AMOUNT_KAS} KAS (N14.9 recovery TX ${settleTx?.slice(0, 16)}...). 之前 escrow stuck 因 sub#3b 误删 imports + queue-failed silent mark. Owner aware NWT 测试承担.`,
  }),
}).then(r => r.json()).catch(e => ({ error: e.message }));
console.log('DM result:', JSON.stringify(dmRes).slice(0, 300));

// Step 5: verify
const escAfter = await fetch(`${CONSOLE_URL}/api/dev/sql`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sql: `SELECT id, status, settle_tx, updated_at FROM user_escrow_balances WHERE id = ?`,
    params: [ESCROW_ID],
  }),
}).then(r => r.json()).catch(e => ({ error: e.message }));
console.log('escrow post-recovery:', JSON.stringify(escAfter).slice(0, 300));
