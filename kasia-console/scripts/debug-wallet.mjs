// debug-wallet.mjs — check production wallet data
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
const db = new Database('data/console.db');
db.pragma('foreign_keys = ON');
const brokerRelayId = '5b236c08-03d0-456c-953d-e10001610938';

const existing = db.prepare(
  "SELECT id, relay_node_id, chain, address, label, is_default, privkey_encrypted, privkey_hint FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' AND is_default = 1 LIMIT 1"
).get(brokerRelayId);

console.log('Found:', existing ? 'yes' : 'no');
if (existing) {
  for (const [k, v] of Object.entries(existing)) {
    console.log(`  ${k}: ${v === null ? 'NULL' : (typeof v === 'string' ? v.slice(0,20) + '...' : v)}`);
  }
}

// Try UPDATE
if (existing) {
  console.log('\nAttempting UPDATE...');
  const r = db.prepare(
    "UPDATE agent_wallets SET privkey_encrypted = 'fake_encrypted_pk_for_test_000000' WHERE id = ?"
  ).run(existing.id);
  console.log('Update changes:', r.changes);
}

// Verify after
const after = db.prepare("SELECT privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? AND chain = 'bnb' LIMIT 1").get(brokerRelayId);
console.log('After check: pk=' + (after?.privkey_encrypted || 'NULL'));

db.close();
