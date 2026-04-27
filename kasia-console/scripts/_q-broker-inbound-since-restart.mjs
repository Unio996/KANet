import Database from 'better-sqlite3';
const db = new Database('C:/kanet/kasia-console/data/console.db', { readonly: true });

const TraderB = db.prepare(`SELECT id FROM identities WHERE display_name='Trader-B'`).get();
console.log('Trader-B id:', TraderB.id);

// All inbound to Trader-B since 06:18 (console restart) UTC
const msgs = db.prepare(`
  SELECT m.created_at, m.direction, m.content_text,
         si.address as sender_addr
  FROM messages m
  LEFT JOIN identities si ON si.id = m.sender_identity_id
  WHERE m.receiver_identity_id = ?
    AND m.created_at > '2026-04-26T06:18:00Z'
  ORDER BY m.created_at ASC
`).all(TraderB.id);

console.log(`\n## Inbound to Trader-B since 06:18 UTC (${msgs.length} msgs):`);
for (const m of msgs) {
  console.log(`${m.created_at?.slice(11,19)} ← ${m.sender_addr?.slice(-16) || '?'}  ${(m.content_text||'').replace(/\s+/g,' ').slice(0,80)}`);
}

const out = db.prepare(`
  SELECT m.created_at, m.content_text, ri.address as recv_addr
  FROM messages m
  LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
  WHERE m.sender_identity_id = ?
    AND m.created_at > '2026-04-26T06:18:00Z'
  ORDER BY m.created_at ASC
`).all(TraderB.id);
console.log(`\n## Outbound from Trader-B since 06:18 UTC (${out.length} msgs):`);
for (const m of out) {
  console.log(`${m.created_at?.slice(11,19)} → ${m.recv_addr?.slice(-16) || '?'}  ${(m.content_text||'').replace(/\s+/g,' ').slice(0,100)}`);
}

db.close();
