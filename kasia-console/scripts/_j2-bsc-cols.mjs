import Db from 'better-sqlite3';
const db = new Db('data/console.db', { readonly: true });
console.log('agent_wallets cols:');
for (const c of db.prepare("PRAGMA table_info(agent_wallets)").all()) console.log(`  ${c.name}`);
const BROKER = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const w = db.prepare(`SELECT * FROM agent_wallets WHERE relay_node_id=? LIMIT 5`).all(BROKER);
console.log('\nbroker wallets:');
for (const r of w) console.log(`  chain=${r.chain} addr=${(r.address||'').slice(0,30)}... privkey_len=${(r.privkey_encrypted||r.private_key_encrypted||'').length}`);
db.close();
