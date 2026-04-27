import Db from 'better-sqlite3';
const db = new Db('data/console.db', { readonly: true });
console.log('=== broadcast_messages cols ===');
for (const c of db.prepare("PRAGMA table_info(broadcast_messages)").all()) console.log(`  ${c.name} ${c.type}`);
console.log('\n=== channels cols ===');
for (const c of db.prepare("PRAGMA table_info(channels)").all()) console.log(`  ${c.name} ${c.type}`);
console.log('\n=== sample broadcast_messages dev-coord recent ===');
const rows = db.prepare("SELECT * FROM broadcast_messages ORDER BY rowid DESC LIMIT 2").all();
for (const r of rows) { console.log(JSON.stringify(r).slice(0,300)); }
db.close();
