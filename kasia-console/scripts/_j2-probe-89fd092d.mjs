import Db from 'better-sqlite3';
const db = new Db('data/console.db', { readonly: true });
const offer = db.prepare(`SELECT id, maker, taker, taker_chain, taker_payment_address, give_asset, give_amount, want_asset, want_amount, payment_tx, protocol_status, broadcast_at, matched_at, verification_meta FROM exchange_offers WHERE id LIKE '89fd092d%'`).get();
console.log(JSON.stringify(offer, null, 2));
console.log('\n--- chain_events for 89fd092d ---');
const ev = db.prepare(`SELECT event_type, txid, from_address, to_address, observed_at FROM chain_events WHERE txid LIKE '%89fd092d%' OR payload LIKE '%89fd092d%' ORDER BY observed_at`).all();
for (const e of ev) console.log(`  ${e.observed_at} ${e.event_type} ${(e.txid||'').slice(0,20)} from=${(e.from_address||'').slice(-12)} to=${(e.to_address||'').slice(-12)}`);
db.close();
