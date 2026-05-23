import Db from 'better-sqlite3';
const db = new Db('data/console.db', { readonly: true });
console.log('=== relay_nodes cols ===');
for (const c of db.prepare("PRAGMA table_info(relay_nodes)").all()) console.log(`  ${c.name}`);
console.log('\n=== relay_nodes (Trader-*) ===');
const r = db.prepare("SELECT * FROM relay_nodes WHERE name LIKE 'Trader%' OR name LIKE '%broker%'").all();
for (const x of r) console.log(`  name=${x.name} id=${x.id} addr=${(x.address||'').slice(0,40)}...`);

console.log('\n=== agent_wallets per Trader relay ===');
for (const x of r) {
  const ws = db.prepare("SELECT chain, label, address FROM agent_wallets WHERE relay_node_id=? ORDER BY chain").all(x.id);
  console.log(`  [${x.name}] relay=${x.id.slice(0,8)}: ${ws.length} wallets`);
  for (const w of ws) console.log(`    ${w.chain}: ${(w.address||'').slice(0,40)}... [${w.label||'-'}]`);
}
db.close();
