import Database from 'better-sqlite3';
const db = new Database('./data/console.db', { readonly: true });
const lock = db.prepare(`SELECT * FROM fund_locks WHERE order_id=?`).get('021ef937-a62e-496b-8f2e-b9833e604f46');
const offer = db.prepare(`SELECT id, protocol_status, cancelled_at FROM exchange_offers WHERE id=?`).get('021ef937-a62e-496b-8f2e-b9833e604f46');
console.log('=== offer ===');
console.log(offer);
console.log('\n=== fund_lock ===');
console.log(lock);
db.close();
