import Database from 'better-sqlite3';
const db = new Database('C:/kanet/kasia-console/data/console.db', { readonly: true });

const BROKER = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';

// chain_events 13:18-13:40 (UTC 06:18-06:40)
const events = db.prepare(`
  SELECT id, txid, from_address, to_address, event_type, observed_by, observed_at
  FROM chain_events
  WHERE observed_at > '2026-04-26T06:18:00Z'
    AND (to_address = ? OR from_address = ?)
  ORDER BY observed_at ASC
`).all(BROKER, BROKER);
console.log(`## chain_events touching broker since 06:18 UTC (${events.length}):`);
for (const e of events) {
  console.log(`${e.observed_at?.slice(11,19)} ${e.event_type?.padEnd(20)} from=${e.from_address?.slice(-16)} to=${e.to_address?.slice(-16)} obs=${e.observed_by} tx=${e.txid?.slice(0,12)}`);
}

// kanet_message_index 同时间段
const idx = db.prepare(`
  SELECT * FROM kanet_message_index WHERE created_at > '2026-04-26T06:18:00Z' ORDER BY created_at ASC LIMIT 30
`).all();
console.log(`\n## kanet_message_index (${idx.length}):`);
for (const m of idx) {
  console.log(JSON.stringify(m).slice(0,200));
}

// Sophie identity
const sophie = db.prepare(`SELECT id, address, display_name FROM identities WHERE address LIKE '%je4cgx2ktetp'`).get();
console.log(`\n## Sophie identity (J1 e2e sender):`, sophie);

db.close();
