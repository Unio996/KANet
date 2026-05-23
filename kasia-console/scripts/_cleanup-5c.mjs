import Database from 'better-sqlite3';
const db = new Database('./data/console.db', { readonly: true });
const row = db.prepare(`
  SELECT id, give_amount, want_amount, protocol_status, broadcast_at
  FROM exchange_offers
  WHERE json_extract(metadata, '$.source')='broker_dynamic_quote'
    AND give_amount='1' AND give_asset='KAS'
    AND protocol_status='open'
  ORDER BY broadcast_at DESC LIMIT 5
`).all();
db.close();
console.log('open broker_dynamic 1 KAS offers:', row);
if (!row.length) {
  console.log('no leak');
  process.exit(0);
}
const Database2 = (await import('better-sqlite3')).default;
const db2 = new Database2('./data/console.db', { readonly: true });
const broker = db2.prepare(`SELECT id FROM relay_nodes WHERE name='Trader-B'`).get();
db2.close();
for (const o of row) {
  const r = await fetch('http://127.0.0.1:3100/api/exchange/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayNodeId: broker.id, offer_id: o.id, reason: 'PROBE_J2_5c_cleanup' }),
  });
  const j = await r.json().catch(() => ({}));
  console.log(`cancel ${o.id.slice(0,8)} HTTP ${r.status}`, JSON.stringify(j).slice(0, 200));
}
