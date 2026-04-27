import Db from 'better-sqlite3';
const db = new Db('data/console.db', { readonly: false });
const stuckEval = db.prepare(`SELECT id, give_amount, give_asset, expires_at FROM exchange_offers WHERE id LIKE '8de62092%' AND protocol_status='open'`).get();
if (stuckEval) {
  db.prepare(`UPDATE exchange_offers SET protocol_status='cancelled', updated_at=datetime('now') WHERE id=?`).run(stuckEval.id);
  console.log(`✓ cleanup ${stuckEval.id.slice(0,8)} (${stuckEval.give_amount} ${stuckEval.give_asset}) → cancelled`);
}
db.close();
