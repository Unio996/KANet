import Database from 'better-sqlite3';
const db = new Database('./data/console.db', { readonly: true });

// Find any fund_lock-ish table
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%lock%' OR name LIKE '%fund%' OR name LIKE '%spend%')").all();
console.log('=== fund/lock/spend tables ===');
console.log(tables);

for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  console.log(`\n--- ${t.name} ---`);
  console.log(cols.map(c => `${c.name}:${c.type}`).join(' | '));
  const cnt = db.prepare(`SELECT COUNT(*) c FROM ${t.name}`).get();
  console.log('  rows:', cnt.c);
  const sample = db.prepare(`SELECT * FROM ${t.name} ORDER BY rowid DESC LIMIT 3`).all();
  for (const r of sample) console.log('  ', r);
}
db.close();
