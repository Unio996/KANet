// J1tn R8 — fire Bettor r116 ops workaround on our stuck offer ext-pred-1779931503151-ty096.
// Steps (per Bettor r116 2/3 + Bettor r115 e2e path):
//  1. Manual SQL transition open_awaiting_taker_stake → matched (= bypass Path A canonical)
//  2. POST /api/prediction/consensual-confirm with maker_relay winner=0
//  3. POST /api/prediction/consensual-confirm with taker_relay winner=0 → dispatchPhase2Consensual fires settle TX

import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
const require = createRequire('file:///D:/kanet-testnet/kasia-console/');
const Database = require('better-sqlite3');

const CONSOLE = 'http://127.0.0.1:3300';
const DB = 'D:/kanet-testnet/kasia-console/data/console.db';
const OFFER_ID = 'ext-pred-1779931503151-ty096';
const MAKER_RELAY = 'ede0772f-dba7-452d-a12a-ff9d3374d4fc';   // pred-maker
const TAKER_RELAY = '6a0a8eed-ce4f-4192-bb37-1d2843c626e4';   // J1tn-Alice

async function post(path, body) {
  const r = await fetch(`${CONSOLE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

console.log('═══ J1tn R8: fire Bettor r116 workaround for offer', OFFER_ID, '═══\n');

// Pre-check offer state
const db = new Database(DB, { readonly: true });
const pre = db.prepare(`SELECT id, protocol_status, escrow_p2sh, taker_escrow_lock_tx FROM exchange_offers WHERE id = ?`).get(OFFER_ID);
db.close();
console.log('pre status:', pre?.protocol_status, '  P2SH:', pre?.escrow_p2sh?.slice(0, 24) + '...');
if (!pre) { console.error('offer not found'); process.exit(1); }

// Step 1: manual transition → matched (workaround, bypass Path A canonical broadcast)
console.log('\n1) manual SQL transition open_awaiting_taker_stake → matched ...');
const wdb = new Database(DB);
try {
  const r = wdb.prepare(`UPDATE exchange_offers SET protocol_status = 'matched', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND protocol_status = 'open_awaiting_taker_stake'`).run(OFFER_ID);
  console.log('  changes:', r.changes);
  if (r.changes !== 1) console.warn('  ⚠ status already not open_awaiting_taker_stake — may have transitioned otherwise');
} finally { wdb.close(); }

// Step 2: maker consensual-confirm winner=0 (= maker wins outcome YES)
console.log('\n2) maker consensual-confirm winner=0 ...');
const s2 = await post(`/api/prediction/consensual-confirm/${OFFER_ID}`, {
  relay_id: MAKER_RELAY,
  winner: 0,
});
console.log('  status:', s2.status, 'body:', JSON.stringify(s2.json).slice(0, 400));
if (s2.status !== 200 || !s2.json.ok) { console.error('FAIL step 2'); process.exit(1); }

await sleep(2000);

// Step 3: taker consensual-confirm winner=0 (= taker also says maker wins)
console.log('\n3) taker consensual-confirm winner=0 → dispatchPhase2Consensual ...');
const s3 = await post(`/api/prediction/consensual-confirm/${OFFER_ID}`, {
  relay_id: TAKER_RELAY,
  winner: 0,
});
console.log('  status:', s3.status, 'body:', JSON.stringify(s3.json).slice(0, 800));
if (s3.status !== 200 || !s3.json.ok) { console.error('FAIL step 3'); process.exit(1); }
console.log('  both_agreed:', s3.json.both_agreed, 'dispatched:', s3.json.dispatched);

await sleep(5000);

// Step 4: post-dispatch state check
console.log('\n4) post-dispatch status ...');
const db2 = new Database(DB, { readonly: true });
const post4 = db2.prepare(`SELECT id, protocol_status, settle_txid, refund_txid FROM exchange_offers WHERE id = ?`).get(OFFER_ID);
db2.close();
console.log('  status:', post4.protocol_status, '  settle_txid:', post4.settle_txid, '  refund_txid:', post4.refund_txid);

console.log('\n═══ J1tn R8 workaround complete ═══');
if (post4.settle_txid) {
  console.log('🎯 SETTLE TX:', post4.settle_txid);
  console.log('Tier 2b CLOSE — funds unlocked from P2SH via consensual settle.');
}
