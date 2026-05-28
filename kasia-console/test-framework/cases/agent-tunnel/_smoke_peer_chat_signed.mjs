// Smoke test: signed peer chat end-to-end via /api/peer/:pair_id/chat
// 1. Insert a synthetic pair row (= simulate post-handshake)
// 2. Build signed POST via buildSignedChatRequest helper
// 3. Verify 200 + DB row inserted
// 4. Bad sig case (= different privkey) → 403

import Database from 'better-sqlite3';
import { generateEd25519Keypair, exportPubkeyBase64 } from '../../../src/services/nat-tunnel.mjs';
import { buildSignedChatRequest } from '../../../src/api/peer-coord.js';

const CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3200';
const A = generateEd25519Keypair();
const B = generateEd25519Keypair();
const addrA = 'kaspatest:qq_peerchat_test_A_xyz';
const addrB = 'kaspatest:qq_peerchat_test_B_abc';
const pairId = 'pair-smoke-' + Date.now();

// 1. Insert synthetic pair row
const db = new Database('./data/console.db');
try {
  db.prepare('DELETE FROM agent_pairs WHERE pair_id = ?').run(pairId);
  db.prepare(`
    INSERT INTO agent_pairs (pair_id, invite_txid, ack_txid,
      peer_a_addr, peer_b_addr, peer_a_pubkey, peer_b_pubkey,
      pair_scope, tunnel_status, established_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(pairId, 'smoke-invite-tx', 'smoke-ack-tx',
         addrA, addrB, exportPubkeyBase64(A.publicKey), exportPubkeyBase64(B.publicKey),
         'smoke-test', Date.now(), Date.now());
  console.log('--- inserted synthetic pair row ---');

  // 2. Build signed POST from A → B's pair_id/chat endpoint
  const req = buildSignedChatRequest({
    peer_console_url: CONSOLE,
    pair_id: pairId,
    from_addr: addrA,
    message: 'hello from A via signed peer/chat',
    local_privkey: A.privateKey,
  });
  console.log('signed request:', req.url, '| sig len:', req.headers['X-KANet-Pair-Signature'].length);

  const r = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body),
  });
  const j = await r.json();
  console.log('valid sig POST result:', r.status, JSON.stringify(j));
  if (r.status !== 200 || !j.ok) {
    console.error('❌ valid sig case FAILED');
    process.exit(1);
  }

  // 3. Verify DB row inserted
  const logged = db.prepare('SELECT * FROM peer_chat_log WHERE pair_id = ? ORDER BY id DESC LIMIT 1').get(pairId);
  console.log('logged chat:', JSON.stringify(logged));
  if (!logged || logged.message !== 'hello from A via signed peer/chat') {
    console.error('❌ DB row missing or mismatched');
    process.exit(1);
  }

  // 4. Bad sig case (= sign with C's privkey, claim from_addr=A → server verifies with A's pubkey → fail)
  const C = generateEd25519Keypair();
  const badReq = buildSignedChatRequest({
    peer_console_url: CONSOLE,
    pair_id: pairId,
    from_addr: addrA,
    message: 'attempted impersonation of A',
    local_privkey: C.privateKey,  // wrong key
  });
  const r2 = await fetch(badReq.url, {
    method: 'POST',
    headers: badReq.headers,
    body: JSON.stringify(badReq.body),
  });
  const j2 = await r2.json();
  console.log('bad sig POST result:', r2.status, JSON.stringify(j2));
  if (r2.status !== 403) {
    console.error('❌ bad sig case should be 403');
    process.exit(1);
  }

  // 5. Cleanup
  db.prepare('DELETE FROM agent_pairs WHERE pair_id = ?').run(pairId);
  db.prepare('DELETE FROM peer_chat_log WHERE pair_id = ?').run(pairId);
  console.log('\n✅ smoke peer-chat signed PASS — sig verify fail-closed verified');
} finally {
  db.close();
}
