import Db from 'better-sqlite3';
const db = new Db('data/console.db', { readonly: true });
const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const w = db.prepare(`SELECT chain, address, encrypted_privkey IS NOT NULL AS has_pk FROM agent_wallets WHERE relay_node_id=?`).all(BROKER_RELAY_ID);
console.log('broker wallets:');
for (const r of w) console.log(`  ${r.chain}: ${(r.address||'').slice(0,30)}... has_pk=${r.has_pk}`);
db.close();
