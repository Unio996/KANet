import Db from 'better-sqlite3';
const db = new Db('data/console.db', { readonly: true });
console.log('=== agent_wallets 表 chain 真值 distribution ===');
const chains = db.prepare("SELECT chain, COUNT(*) AS n FROM agent_wallets GROUP BY chain ORDER BY n DESC").all();
for (const c of chains) console.log(`  ${c.chain}: ${c.n} wallets`);
console.log('\n=== broker (Trader-A) 真有钱包 ===');
const broker = db.prepare("SELECT chain, address, label FROM agent_wallets WHERE relay_node_id='0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0'").all();
for (const w of broker) console.log(`  ${w.chain}: ${(w.address||'').slice(0,40)}... [${w.label}]`);
db.close();
