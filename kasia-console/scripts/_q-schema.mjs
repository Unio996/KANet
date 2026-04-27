import Database from 'better-sqlite3';
const db = new Database('C:/kanet/kasia-console/data/console.db', { readonly: true });
for (const t of ['messages', 'exchange_offers', 'pending_actions']) {
  const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE name=?`).get(t);
  console.log(`==== ${t} ====`);
  console.log(sql?.sql);
}
db.close();
