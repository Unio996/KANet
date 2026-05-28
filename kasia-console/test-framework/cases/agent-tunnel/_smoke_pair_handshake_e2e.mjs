// Chunk 4 E2E smoke: real chain pair_invite + pair_ack → pair-ingestor → agent_pairs row
//
// Setup:
//   - A = KANet-UI-tn relay (= sender of pair_invite)
//   - B = tester-1 relay (= sender of pair_ack with ref=invite_txid)
// Flow:
//   1. Generate 2 ed25519 keypairs locally (A_keys, B_keys)
//   2. POST /api/v1/messages from KANet-UI-tn → pair_invite envelope chain
//   3. Wait for chain confirm (= 5s)
//   4. POST /api/v1/messages from tester-1 → pair_ack envelope ref=invite_txid
//   5. Wait for chain confirm (= 5s)
//   6. Call scanAndIngestPairs() manually (= bypass 30s tick)
//   7. Verify agent_pairs row created with both pubkeys
//   8. GET /api/peer/pairs shows the pair
//   9. Cleanup

import Database from 'better-sqlite3';
import { generateEd25519Keypair, exportPubkeyBase64 } from '../../../src/services/nat-tunnel.mjs';
import { scanAndIngestPairs } from '../../../src/services/pair-ingestor.mjs';

const CONSOLE = 'http://127.0.0.1:3200';
const RELAY_A = 'f5cf6d85-58f4-4991-9cd5-7c6779f6822b';  // KANet-UI-tn
const RELAY_B = 'eb5a5864-a8e0-4376-8f61-38108abb301f';  // tester-1
const PAIR_SCOPE = 'tier21-chunk4-smoke-' + Date.now();

const A_keys = generateEd25519Keypair();
const B_keys = generateEd25519Keypair();

const A_pub_b64 = exportPubkeyBase64(A_keys.publicKey);
const B_pub_b64 = exportPubkeyBase64(B_keys.publicKey);

console.log('--- 1: fire pair_invite from KANet-UI-tn ---');
const inviteEnv = {
  v: 0,
  tag: 'general',
  intent: 'pair_invite',
  subject: `Tier 2.1 chunk 4 smoke pair invite (${PAIR_SCOPE.slice(-8)})`,
  body: 'Single-host e2e test: KANet-UI-tn → tester-1 handshake + ingestor verify',
  payload: {
    pair_scope: PAIR_SCOPE,
    nat_endpoint: { ip: '45.94.210.120', port: 51820, nat_type: 'full_cone' },
    ed25519_pubkey: A_pub_b64,
    tunnel_protocols: ['udp-signed-v1'],
  },
};
const r1 = await fetch(`${CONSOLE}/api/v1/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relay_id: RELAY_A, envelope: inviteEnv }),
});
const j1 = await r1.json();
console.log('invite result:', r1.status, JSON.stringify(j1).slice(0, 300));
if (!j1.ok) { console.error('❌ invite fire fail'); process.exit(1); }
const inviteTxid = j1.txid;

console.log('--- 2: wait 6s for chain confirm + scout ingest ---');
await new Promise(r => setTimeout(r, 6000));

console.log('--- 3: fire pair_ack from tester-1 with ref=invite_txid ---');
const ackEnv = {
  v: 0,
  tag: 'general',
  intent: 'pair_ack',
  subject: `Tier 2.1 chunk 4 pair ack`,
  body: 'tester-1 accepts pair invite from KANet-UI-tn',
  ref: inviteTxid,
  payload: {
    pair_scope: PAIR_SCOPE,
    nat_endpoint: { ip: '45.94.210.120', port: 51821, nat_type: 'full_cone' },
    ed25519_pubkey: B_pub_b64,
    tunnel_protocols: ['udp-signed-v1'],
    negotiated: 'udp-signed-v1',
  },
};
const r2 = await fetch(`${CONSOLE}/api/v1/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relay_id: RELAY_B, envelope: ackEnv }),
});
const j2 = await r2.json();
console.log('ack result:', r2.status, JSON.stringify(j2).slice(0, 300));
if (!j2.ok) { console.error('❌ ack fire fail'); process.exit(1); }
const ackTxid = j2.txid;

console.log('--- 4: wait 6s for chain confirm ---');
await new Promise(r => setTimeout(r, 6000));

console.log('--- 5: invoke scanAndIngestPairs() manually (= bypass 30s tick) ---');
const ingestResult = scanAndIngestPairs({ since_id: 0 });
console.log('ingest result:', JSON.stringify(ingestResult));

console.log('--- 6: verify agent_pairs row in DB ---');
const db = new Database('./data/console.db', { readonly: true });
const expectedPairId = `${inviteTxid}:${ackTxid}`;
const pairRow = db.prepare('SELECT * FROM agent_pairs WHERE pair_id = ?').get(expectedPairId);
console.log('pair row:', pairRow ? JSON.stringify(pairRow, null, 2).slice(0, 500) : '(missing)');
db.close();

if (!pairRow) {
  console.error('❌ agent_pairs row not found');
  process.exit(1);
}

console.log('--- 7: GET /api/peer/pairs shows it ---');
const r3 = await fetch(`${CONSOLE}/api/peer/pairs`);
const j3 = await r3.json();
const found = j3.pairs?.find(p => p.pair_id === expectedPairId);
console.log('found in /api/peer/pairs:', !!found, found ? `(scope=${found.pair_scope})` : '');

console.log('\n--- summary ---');
console.log('invite txid:', inviteTxid);
console.log('ack txid:', ackTxid);
console.log('pair_id:', expectedPairId);
console.log('ingest:', `${ingestResult.invites_processed}i / ${ingestResult.acks_processed}a → ${ingestResult.pairs_created} pairs`);

const ok = pairRow && found;
console.log(ok ? '\n✅ Tier 2.1 chunk 4 e2e PASS — chain handshake → agent_pairs materialized' : '\n❌ FAIL');

// Cleanup
const db2 = new Database('./data/console.db');
db2.prepare('DELETE FROM agent_pairs WHERE pair_id = ?').run(expectedPairId);
db2.close();
console.log('cleanup: agent_pairs row deleted (chain envelopes left intact for audit)');

process.exit(ok ? 0 : 1);
