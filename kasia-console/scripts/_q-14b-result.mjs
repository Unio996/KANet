import Database from 'better-sqlite3';
const db = new Database('./data/console.db', { readonly: true });
const o = db.prepare(`SELECT id, protocol_status, broadcast_at, expires_at, cancelled_at, timed_out_at FROM exchange_offers WHERE id=?`).get('f902e889-9484-4b32-a658-9afaf974f2dc');
const l = db.prepare(`SELECT id, status, created_at, released_at FROM fund_locks WHERE order_id=?`).get('f902e889-9484-4b32-a658-9afaf974f2dc');
db.close();
console.log('offer:', o);
console.log('fund_lock:', l);
const now = new Date().toISOString();
console.log('now:', now);
if (o) {
  const expires = new Date(o.expires_at).getTime();
  const nowMs = Date.now();
  console.log(`time-to-expire: ${Math.round((expires - nowMs)/1000)}s`);
}
