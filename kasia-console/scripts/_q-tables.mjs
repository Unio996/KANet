import Database from 'better-sqlite3';
const db = new Database('C:/kanet/kasia-console/data/console.db', { readonly: true });
const t = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all();
console.log(t.map(r=>r.name).join('\n'));
