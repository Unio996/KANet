import Db from 'better-sqlite3';
const db = new Db('data/console.db', { readonly: true });
console.log('=== messages cols ===');
for (const c of db.prepare("PRAGMA table_info(messages)").all()) console.log(`  ${c.name} ${c.type}`);
console.log('\n=== broadcasts/broadcast_messages? ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%message%' OR name LIKE '%broadcast%' OR name LIKE '%channel%')").all();
for (const t of tables) console.log(`  ${t.name}`);
db.close();
